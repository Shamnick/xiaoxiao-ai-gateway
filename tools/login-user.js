'use strict';
/**
 * 用真实 Chrome 完成 user.yutiankejiai.com 的登录（含 Cloudflare Turnstile），
 * 拿到会话 Cookie 后落盘，供后续 curl 批量抓取控制台页面。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'https://user.yutiankejiai.com';
const USER = process.env.YT_USER || 'sham';
const PASS = process.env.YT_PASS || 'ioioio000';
const OUT = path.resolve(__dirname, '../src-user');
const PORT = 9555;
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(u) {
    this.ws = new WebSocket(u); this.id = 0; this.pending = new Map(); this.handlers = new Map();
    this.ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      } else if (m.method) (this.handlers.get(m.method) || []).forEach(f => f(m.params));
    });
  }
  ready() { return new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', rej, { once: true }); }); }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 40000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  }
}

(async () => {
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/ytk-user-' + Date.now(),
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,980',
    '--lang=zh-CN', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    let cdp = null;
    for (let i = 0; i < 60 && !cdp; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
        const page = list.find(t => t.type === 'page');
        if (page) { cdp = new CDP(page.webSocketDebuggerUrl); await cdp.ready(); }
      } catch (e) { /* retry */ }
      if (!cdp) await sleep(250);
    }
    if (!cdp) throw new Error('chrome not ready');
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 1, mobile: false });

    await cdp.send('Page.navigate', { url: BASE + '/?page=login' });
    await sleep(2500);
    await cdp.shot('login-page');

    // 等 Cloudflare Turnstile 自己完成（headless 下可能失败，失败则报出可见提示）
    let tokenReady = false;
    for (let i = 0; i < 40; i++) {
      tokenReady = await cdp.eval(`(() => {
        const t = document.querySelector('textarea[name="cf-turnstile-response"], input[name="cf-turnstile-response"]');
        const btn = document.querySelector('form[data-auth-pane="pwd"] button[type="submit"]');
        return !!((t && t.value && t.value.length > 20) || (btn && !btn.disabled));
      })()`);
      if (tokenReady) break;
      await sleep(700);
    }
    console.log('turnstile:', tokenReady ? '已通过/按钮可用' : '未通过（继续尝试提交）');

    await cdp.eval(`(() => {
      const f = document.querySelector('form[data-auth-pane="pwd"]');
      f.querySelector('input[name="username"]').value = ${JSON.stringify(USER)};
      f.querySelector('input[name="password"]').value = ${JSON.stringify(PASS)};
      return true;
    })()`);
    await sleep(300);
    await cdp.eval(`(() => {
      const f = document.querySelector('form[data-auth-pane="pwd"]');
      f.querySelector('button[type="submit"]').disabled = false;
      f.submit();
      return true;
    })()`);
    await sleep(4500);

    const url = await cdp.eval('location.href');
    const title = await cdp.eval('document.title');
    const cookies = (await cdp.send('Network.getAllCookies')).cookies;
    fs.writeFileSync(path.join(OUT, 'cookies.json'), JSON.stringify(cookies, null, 1));
    console.log('登录后 URL:', url);
    console.log('标题:', title);
    console.log('Cookie:', cookies.map(c => c.name + '=' + String(c.value).slice(0, 12) + '…').join(', '));
    await cdp.shot('after-login');

    const html = await cdp.eval("document.documentElement.outerHTML");
    fs.writeFileSync(path.join(OUT, 'after-login.html'), html);
    console.log('页面字节:', html.length, html.includes('退出') ? '(含退出=已登录)' : '(未见登录态)');
  } catch (e) {
    console.error('失败:', e.message);
    process.exitCode = 1;
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) { /* ignore */ }
  }
})();
