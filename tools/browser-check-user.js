'use strict';
/** 用户中心本地副本：真实 Chrome 逐页检查脚本错误、失败请求与关键交互 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.UBASE || 'http://127.0.0.1:8849';
const OUT = path.resolve(__dirname, '../logs/shots-user');
const PORT = 9666;
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(u) {
    this.ws = new WebSocket(u); this.id = 0; this.pending = new Map(); this.handlers = new Map();
    this.ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
      else if (m.method) (this.handlers.get(m.method) || []).forEach(f => f(m.params));
    });
  }
  ready() { return new Promise((res, rej) => { this.ws.addEventListener('open', res, { once: true }); this.ws.addEventListener('error', rej, { once: true }); }); }
  on(method, fn) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(fn); }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
    });
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  }
  async waitFor(e, t = 9000) {
    const t0 = Date.now();
    while (Date.now() - t0 < t) { try { if (await this.eval(e)) return true; } catch (err) { /* retry */ } await sleep(120); }
    throw new Error('waitFor timeout: ' + e);
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/ytk-u-' + Date.now(),
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,980', 'about:blank'], { stdio: 'ignore' });
  const errors = [];
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
    cdp.on('Runtime.exceptionThrown', p => errors.push('exception: ' + (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)));
    cdp.on('Runtime.consoleAPICalled', p => { if (p.type === 'error') errors.push('console: ' + p.args.map(a => a.value || a.description || '').join(' ')); });
    cdp.on('Network.loadingFailed', p => { if (p.errorText !== 'net::ERR_ABORTED') errors.push('failed: ' + p.errorText + ' ' + p.requestId); });
    cdp.on('Network.responseReceived', p => { if (p.response.status >= 400) errors.push('HTTP ' + p.response.status + ' ' + p.response.url); });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 2, mobile: false });

    const pages = [['dashboard', '/'], ['subscription', '/?page=subscription'], ['keys', '/?page=keys'], ['billing', '/?page=billing'],
      ['recharge', '/?page=recharge'], ['invite', '/?page=invite'], ['settings', '/?page=settings'], ['docs', '/?page=docs'],
      ['image', '/image/'], ['video', '/video/']];
    for (const [name, p] of pages) {
      await cdp.send('Page.navigate', { url: BASE + p });
      await cdp.waitFor("document.readyState === 'complete'");
      await sleep(1100);
      await cdp.shot('u-' + name);
      const info = await cdp.eval(`(() => ({ title: document.title, h: document.body.scrollHeight, txt: document.body.innerText.length }))()`);
      console.log('  ✓ ' + name.padEnd(13) + ' title=' + info.title.slice(0, 22) + '  高度=' + info.h + ' 文本=' + info.txt);
    }

    // 订阅页交互：tab 切换 + 查看模型弹窗
    await cdp.send('Page.navigate', { url: BASE + '/?page=subscription' });
    await cdp.waitFor("document.readyState === 'complete'");
    await sleep(1200);
    const tabs = await cdp.eval("document.querySelectorAll('.sub-tabs [data-sub-tab], .sub-tabs button').length");
    console.log('  订阅页 tab 数：' + tabs);
    if (tabs > 1) {
      await cdp.eval("document.querySelectorAll('.sub-tabs button')[1].click()");
      await sleep(500);
    }
    const modelBtn = await cdp.eval("(document.querySelector('[data-sub-models], .sub-models') ? 1 : 0)");
    console.log('  套餐卡「查看可用模型」入口：' + (modelBtn ? '存在' : '未找到'));

    // 价格表弹窗（dashboard）
    await cdp.send('Page.navigate', { url: BASE + '/' });
    await cdp.waitFor("document.readyState === 'complete'");
    await sleep(1200);
    const price = await cdp.eval(`fetch('/?ajax=model_prices',{credentials:'same-origin'}).then(r=>r.json()).then(d=>d.prices?d.prices.length:-1)`);
    console.log('  model_prices 返回模型数：' + price);

    console.log('\n错误清单：' + (errors.length ? '\n - ' + errors.slice(0, 25).join('\n - ') : '无'));
    console.log('截图：' + OUT);
    process.exitCode = errors.length ? 2 : 0;
  } catch (e) {
    console.error('失败:', e.message); process.exitCode = 1;
  } finally { try { chrome.kill('SIGKILL'); } catch (e) { /* ignore */ } }
})();
