'use strict';
/** 用户中心视觉采样：线上（带登录 Cookie）与本地副本，同视口同流程截图 + 布局快照 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(__dirname, '../logs/visual-user');
const label = process.argv[2];
const url = process.argv[3];
const W = Number(process.argv[4] || 1440);
const H = Number(process.argv[5] || 900);
const sid = (() => { try { return fs.readFileSync(path.resolve(__dirname, '../src-user/sid.txt'), 'utf8').trim(); } catch (e) { return ''; } })();
const PORT = 9700 + Math.floor(Math.random() * 200);
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
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 40000);
    });
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=/tmp/ytk-su-' + Date.now(),
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=' + W + ',' + H, 'about:blank'], { stdio: 'ignore' });
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
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    if (sid && /yutiankejiai/.test(url)) {
      await cdp.send('Network.setCookie', { name: 'PHPSESSID', value: sid, domain: 'user.yutiankejiai.com', path: '/', secure: true, httpOnly: true });
    }
    await cdp.send('Page.navigate', { url });
    await sleep(2800);
    await cdp.eval(`(() => {
      try { document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; }); } catch (e) {}
      document.querySelectorAll('canvas').forEach(e => { e.style.visibility = 'hidden'; });
      window.scrollTo(0, 0);
      return true;
    })()`);
    await sleep(500);
    const layout = await cdp.eval(`(() => {
      const out = []; let i = 0;
      document.querySelectorAll('body *').forEach(el => {
        const tag = el.tagName.toLowerCase();
        if (['script','style','link','meta','br'].includes(tag)) return;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) return;
        out.push({ i: i++, tag, cls: (el.getAttribute('class') || '').trim(), id: el.id || '',
          x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10,
          text: el.children.length === 0 ? (el.textContent || '').trim().slice(0, 40) : '' });
      });
      return { viewport: { w: innerWidth, h: innerHeight }, docHeight: document.documentElement.scrollHeight, nodes: out };
    })()`);
    fs.writeFileSync(path.join(OUT, label + '.layout.json'), JSON.stringify(layout));
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, label + '.png'), Buffer.from(shot.data, 'base64'));
    const full = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, label + '-full.png'), Buffer.from(full.data, 'base64'));
    console.log('saved ' + label + '  nodes=' + layout.nodes.length + ' docH=' + layout.docHeight + ' url=' + url);
  } catch (e) {
    console.error('失败 ' + label + ':', e.message); process.exitCode = 1;
  } finally { try { chrome.kill('SIGKILL'); } catch (e) { /* ignore */ } }
})();
