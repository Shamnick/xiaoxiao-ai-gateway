'use strict';
/** 本地演示截图：官网 / 后台 / 用户中心，含真实登录态 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(__dirname, '../docs/demo');
const PORT = 9811;
const sleep = ms => new Promise(r => setTimeout(r, ms));
class CDP {
  constructor(u) { this.ws = new WebSocket(u); this.id = 0; this.pending = new Map(); this.h = new Map();
    this.ws.addEventListener('message', e => { const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) { const p = this.pending.get(m.id); this.pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
      else if (m.method) (this.h.get(m.method) || []).forEach(f => f(m.params)); }); }
  ready() { return new Promise((r, j) => { this.ws.addEventListener('open', r, { once: true }); this.ws.addEventListener('error', j, { once: true }); }); }
  send(method, params) { const id = ++this.id; return new Promise((res, rej) => { this.pending.set(id, { resolve: res, reject: rej });
    this.ws.send(JSON.stringify({ id, method, params: params || {} })); setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000); }); }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; }
  async waitFor(e, t = 9000) { const t0 = Date.now(); while (Date.now() - t0 < t) { try { if (await this.eval(e)) return true; } catch (err) {} await sleep(120); } throw new Error('timeout ' + e); }
  async shot(name) { const r = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.data, 'base64')); console.log('  ✓ ' + name); }
  async go(url, wait = 1300) { await this.send('Page.navigate', { url }); await this.waitFor("document.readyState === 'complete'"); await sleep(wait); }
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/ytk-demo-' + Date.now(),
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=1440,900', '--force-device-scale-factor=2', 'about:blank'], { stdio: 'ignore' });
  try {
    let cdp = null;
    for (let i = 0; i < 60 && !cdp; i++) {
      try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
        const p = l.find(t => t.type === 'page'); if (p) { cdp = new CDP(p.webSocketDebuggerUrl); await cdp.ready(); } } catch (e) {}
      if (!cdp) await sleep(250);
    }
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });

    await cdp.go('http://127.0.0.1:8848/', 2200); await cdp.shot('01-a1-home');
    await cdp.go('http://127.0.0.1:8848/?page=models', 2000);
    await cdp.eval("document.querySelector('.models-section')?.scrollIntoView({block:'start'}); 1"); await sleep(900);
    await cdp.shot('02-a1-models');

    await cdp.go('http://127.0.0.1:8848/admin/', 1200); await cdp.shot('03-admin-login');
    await cdp.eval(`(() => { document.querySelector('#loginUser').value='admin'; document.querySelector('#loginPass').value='admin123';
      document.querySelector('#loginForm').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true})); return 1; })()`);
    await cdp.waitFor("!!document.querySelector('#content .stat')", 12000); await sleep(900);
    await cdp.shot('04-admin-dashboard');
    await cdp.eval("location.hash='#/ucPlans'; 1"); await sleep(1500); await cdp.shot('05-admin-plans');
    await cdp.eval("location.hash='#/ucPages'; 1"); await sleep(1500); await cdp.shot('06-admin-ucpages');
    await cdp.eval("location.hash='#/models'; 1"); await sleep(1500); await cdp.shot('07-admin-models');

    await cdp.go('http://127.0.0.1:8849/', 2200); await cdp.shot('08-user-dashboard');
    await cdp.go('http://127.0.0.1:8849/?page=subscription', 2200); await cdp.shot('09-user-subscription');
    await cdp.go('http://127.0.0.1:8849/?page=keys', 1800); await cdp.shot('10-user-keys');
    await cdp.go('http://127.0.0.1:8849/image/', 2200); await cdp.shot('11-user-image');
    await cdp.go('http://127.0.0.1:8849/?page=billing', 1800); await cdp.shot('12-user-billing');
    console.log('输出目录：' + OUT);
  } catch (e) { console.error('失败:', e.message); process.exitCode = 1; }
  finally { try { chrome.kill('SIGKILL'); } catch (e) {} }
})();
