'use strict';
/**
 * 视觉/布局对齐采样：对"原站"和"本地镜像"用同一视口、同一时机取
 *   ① 全页截图  ② 所有可见元素的 class + 绝对布局矩形
 * 供 tools/visual-diff.py 做像素与布局双维度对比。
 *
 * 用法: node tools/snap.js <label> <url> [width] [height]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.resolve(__dirname, '../logs/visual');
const PORT = 9444 + Math.floor(Math.random() * 200);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const label = process.argv[2] || 'local-home';
const url = process.argv[3] || 'http://127.0.0.1:8848/';
const W = Number(process.argv[4] || 1440);
const H = Number(process.argv[5] || 900);

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
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('timeout ' + method)); } }, 30000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = '/tmp/ytk-snap-' + process.pid;
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--window-size=' + W + ',' + H,
    '--force-device-scale-factor=1', 'about:blank',
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
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url });
    await sleep(2600); // 等字体、动画、外链 widget 稳定

    // 归一化：把滚动触发的 reveal 动画推进到终态，关闭过渡，固定随机文案，
    // 让"同一份 HTML/CSS/JS"的布局可以被逐元素比较。
    await cdp.eval(`(() => {
      // 页面带 CSP（style-src 'self'），内联 style 会被拦；改用 Web Animations API 直接定格相位
      document.querySelectorAll('.reveal').forEach(e => e.classList.add('in'));
      try {
        document.getAnimations().forEach(a => { a.pause(); a.currentTime = 0; });
      } catch (e) { /* ignore */ }
      const term = document.querySelector('#termOut');
      if (term && term.parentNode) term.parentNode.removeChild(term);
      [['#mLat','12ms'],['#mNode','328'],['#mTok','46,208']].forEach(([s,v]) => {
        const e = document.querySelector(s); if (e) e.textContent = v;
      });
      document.querySelectorAll('#ytbBot,#ytbBot2,#ytbBubble,#ytbBubbleText,#ytbHudA,#ytbHudB').forEach(e => { e.style.visibility = 'hidden'; });
      // canvas 背景是随机粒子，与复刻无关；截图对比时统一隐藏，避免噪声
      document.querySelectorAll('canvas').forEach(e => { e.style.visibility = 'hidden'; });
      window.scrollTo(0, 0);
      return true;
    })()`);
    await sleep(600);

    const layout = await cdp.eval(`(() => {
      const out = [];
      const all = document.querySelectorAll('body *');
      let i = 0;
      all.forEach(el => {
        const tag = el.tagName.toLowerCase();
        if (['script','style','link','meta','br'].includes(tag)) return;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        out.push({
          i: i++,
          tag,
          cls: (el.getAttribute('class') || '').trim(),
          id: el.id || '',
          x: Math.round(r.x * 10) / 10,
          y: Math.round(r.y * 10) / 10,
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
          text: (el.children.length === 0 ? (el.textContent || '').trim().slice(0, 40) : ''),
        });
      });
      return { viewport: { w: innerWidth, h: innerHeight }, docHeight: document.documentElement.scrollHeight, nodes: out };
    })()`);
    fs.writeFileSync(path.join(OUT, label + '.layout.json'), JSON.stringify(layout, null, 0));

    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    fs.writeFileSync(path.join(OUT, label + '.png'), Buffer.from(shot.data, 'base64'));
    // 整页截图（用于对比长页面）
    const full = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, label + '-full.png'), Buffer.from(full.data, 'base64'));
    console.log('saved ' + label + ': ' + layout.nodes.length + ' nodes, docHeight=' + layout.docHeight);
  } catch (e) {
    console.error('snap failed:', e.message);
    process.exitCode = 1;
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) { /* ignore */ }
  }
})();
