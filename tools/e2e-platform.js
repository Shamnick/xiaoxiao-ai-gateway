'use strict';
/** 端到端：注册/登录 → 控制台真实数据 → 建 Key → 调用模型 → 客服会话 → 后台处理 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(__dirname, '../logs/e2e');
const PORT = 9922;
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP {
  constructor(u) { this.ws = new WebSocket(u); this.id = 0; this.pending = new Map(); this.h = new Map();
    this.ws.addEventListener('message', e => { const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
      else if (m.method) (this.h.get(m.method) || []).forEach(f => f(m.params)); }); }
  ready() { return new Promise((r, j) => { this.ws.addEventListener('open', r, { once: true }); this.ws.addEventListener('error', j, { once: true }); }); }
  on(method, fn) { if (!this.h.has(method)) this.h.set(method, []); this.h.get(method).push(fn); }
  send(m, p) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej });
    this.ws.send(JSON.stringify({ id, method: m, params: p || {} })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + m)); } }, 30000); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; }
  async waitFor(e, t = 9000) { const t0 = Date.now(); while (Date.now() - t0 < t) { try { if (await this.eval(e)) return true; } catch (err) {} await sleep(120); } throw new Error('timeout ' + e); }
  async shot(n) { const r = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true }); fs.writeFileSync(path.join(OUT, n + '.png'), Buffer.from(r.data, 'base64')); console.log('  ✓ ' + n); }
  async go(u, w = 1200) { await this.send('Page.navigate', { url: u }); await this.waitFor("document.readyState === 'complete'"); await sleep(w); }
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/ytk-e2e-' + Date.now(),
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,980', '--force-device-scale-factor=2', 'about:blank'], { stdio: 'ignore' });
  const errs = [];
  try {
    let cdp = null;
    for (let i = 0; i < 60 && !cdp; i++) {
      try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
        const p = l.find(t => t.type === 'page'); if (p) { cdp = new CDP(p.webSocketDebuggerUrl); await cdp.ready(); } } catch (e) {}
      if (!cdp) await sleep(250);
    }
    cdp.on('Runtime.exceptionThrown', p => errs.push('exception: ' + (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text)));
    cdp.on('Network.responseReceived', p => { if (p.response.status >= 400 && !/favicon/.test(p.response.url)) errs.push('HTTP ' + p.response.status + ' ' + p.response.url); });
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 2, mobile: false });

    await cdp.go('http://127.0.0.1:8849/', 1500);
    console.log('  未登录 → ' + (await cdp.eval('location.href')));
    await cdp.shot('01-login');

    await cdp.eval(`(() => { const f=document.querySelector('form[data-auth-pane="pwd"]');
      f.querySelector('input[name="username"]').value='sham';
      f.querySelector('input[name="password"]').value='ioioio000';
      f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); return 1; })()`);
    await cdp.waitFor("location.search.indexOf('page=login') === -1", 12000);
    await sleep(1800);
    await cdp.shot('02-console');
    const bal = await cdp.eval("document.querySelector('[data-wallet-display]') ? document.querySelector('[data-wallet-display]').textContent : 'n/a'");
    console.log('  控制台余额显示：' + bal);

    await cdp.go('http://127.0.0.1:8849/?page=keys', 2000);
    const hasPanel = await cdp.eval("!!document.getElementById('ytkKeyPanel')");
    console.log('  Key 面板：' + (hasPanel ? '已注入' : '缺失'));
    if (hasPanel) {
      await cdp.eval("document.getElementById('ytkKeyNew').click(); 1");
      await sleep(500);
      await cdp.eval("document.getElementById('ytkNewName').value='E2E测试Key'; document.getElementById('ytkNewOk').click(); 1");
      await sleep(1500);
      const rows = await cdp.eval("document.querySelectorAll('#ytkKeyBody .ytk-table tbody tr').length");
      console.log('  创建后 Key 行数：' + rows);
      await cdp.shot('03-keys');
    }

    // 客服浮窗
    await cdp.go('http://127.0.0.1:8849/', 1500);
    await cdp.eval("document.getElementById('ytkSupportBtn').click(); 1");
    await sleep(600);
    await cdp.eval(`(() => {
      const nm=document.getElementById('ytkSName'), ip=document.getElementById('ytkSInput');
      nm.value='sham'; nm.dispatchEvent(new Event('input'));
      ip.value='这个 Key 的并发上限是多少？'; ip.dispatchEvent(new Event('input'));
      document.getElementById('ytkSSend').click(); return 1; })()`);
    await sleep(1500);
    const msgCount = await cdp.eval("document.querySelectorAll('#ytkSBody .ytk-s-msg').length");
    console.log('  客服消息条数：' + msgCount);
    await cdp.shot('04-support');

    // 后台
    await cdp.go('http://127.0.0.1:8848/admin/', 1000);
    await cdp.eval(`(() => { document.querySelector('#loginUser').value='admin';
      document.querySelector('#loginPass').value='admin123';
      document.querySelector('#loginForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); return 1; })()`);
    await cdp.waitFor("!!document.querySelector('#content .stat')", 12000);
    for (const m of ['channels', 'logs', 'support']) {
      await cdp.eval("location.hash='#/" + m + "'; 1");
      await sleep(1400);
      await cdp.waitFor("!document.querySelector('#content .skeleton')", 8000);
      await cdp.shot('05-admin-' + m);
    }
    // 后台回复客服
    await cdp.eval("location.hash='#/support'; 1"); await sleep(1300);
    const hasThread = await cdp.eval("!!document.querySelector('[data-act=\\\"sup-pick\\\"]')");
    if (hasThread) {
      await cdp.eval("document.querySelector('[data-act=\\\"sup-pick\\\"]').click(); 1"); await sleep(900);
      await cdp.eval(`(() => { document.getElementById('supReply').value='默认 2 并发，超出会被拒绝且不扣次数。';
        document.querySelector('[data-act="sup-send"]').click(); return 1; })()`);
      await sleep(1300);
      await cdp.shot('06-admin-reply');
      console.log('  后台已回复客服会话');
    }

    console.log('\n错误：' + (errs.length ? '\n - ' + errs.slice(0, 12).join('\n - ') : '无'));
    process.exitCode = errs.length ? 2 : 0;
  } catch (e) { console.error('失败:', e.message); process.exitCode = 1; }
  finally { try { chrome.kill('SIGKILL'); } catch (e) {} }
})();
