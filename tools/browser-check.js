'use strict';
/**
 * 后台交互自检：用 Chrome DevTools Protocol 驱动 headless Chrome，
 * 走一遍登录 → 各菜单 → 关键弹窗 → 创建/删除模型 → 公告/区块/设置保存，
 * 收集 console 报错与失败请求，并落截图。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://127.0.0.1:8848';
const OUT = path.resolve(__dirname, '../logs/shots');
const PORT = 9333;
const sleep = ms => new Promise(r => setTimeout(r, ms));

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        (this.handlers.get(msg.method) || []).forEach(fn => fn(msg.params));
      }
    });
  }
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP timeout: ' + method)); }
      }, 30000);
    });
  }
  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval error: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  }
  async waitFor(expr, timeout = 8000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try { if (await this.eval(expr)) return true; } catch (e) { /* retry */ }
      await sleep(120);
    }
    throw new Error('waitFor timeout: ' + expr);
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    const file = path.join(OUT, name + '.png');
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = '/tmp/ytk-cdp-profile';
  fs.rmSync(profile, { recursive: true, force: true });
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--window-size=1440,980', '--force-device-scale-factor=2', 'about:blank',
  ], { stdio: 'ignore' });

  const errors = [];
  let cdp;
  try {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
        const list = await r.json();
        const page = list.find(t => t.type === 'page');
        if (page) { cdp = new CDP(page.webSocketDebuggerUrl); await cdp.ready(); break; }
      } catch (e) { /* not ready */ }
      await sleep(250);
    }
    if (!cdp) throw new Error('Chrome 未就绪');

    cdp.on('Runtime.consoleAPICalled', p => {
      if (p.type === 'error') errors.push('console.error: ' + p.args.map(a => a.value || a.description || '').join(' '));
    });
    cdp.on('Runtime.exceptionThrown', p => {
      errors.push('exception: ' + (p.exceptionDetails.exception && p.exceptionDetails.exception.description || p.exceptionDetails.text));
    });
    cdp.on('Network.loadingFailed', p => {
      if (p.errorText !== 'net::ERR_ABORTED') errors.push('request failed: ' + p.errorText);
    });
    cdp.on('Network.responseReceived', p => {
      if (p.response.status >= 400 && !/favicon/.test(p.response.url)) errors.push('HTTP ' + p.response.status + ' ' + p.response.url);
    });

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Network.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 980, deviceScaleFactor: 2, mobile: false });

    const step = async (name, fn) => {
      try { await fn(); console.log('  ✓ ' + name); }
      catch (e) { console.log('  ✗ ' + name + ' → ' + e.message); errors.push('step[' + name + ']: ' + e.message); }
    };

    console.log('后台自检开始 → ' + BASE + '/admin/');
    await cdp.send('Page.navigate', { url: BASE + '/admin/' });
    await cdp.waitFor("document.readyState === 'complete'");

    await step('登录页渲染', async () => {
      await cdp.waitFor("!document.querySelector('#loginView').hidden");
      await cdp.shot('01-login');
    });

    await step('登录成功进入控制台', async () => {
      await cdp.eval(`(() => {
        document.querySelector('#loginUser').value = 'admin';
        document.querySelector('#loginPass').value = 'admin123';
        document.querySelector('#loginForm').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        return true;
      })()`);
      await cdp.waitFor("!document.querySelector('#shellView').hidden", 10000);
      await cdp.waitFor("!!document.querySelector('#content .stat')", 10000);
      await cdp.shot('02-dashboard');
    });

    const menus = ['models', 'brands', 'notice', 'pages', 'ucPlans', 'ucPages', 'ucRedeem', 'ucProfile',
      'users', 'orders', 'tickets', 'leads', 'settings', 'security', 'audit'];
    for (const m of menus) {
      await step('菜单 ' + m, async () => {
        await cdp.eval(`(() => { location.hash = '#/${m}'; return true; })()`);
        await sleep(700);
        await cdp.waitFor("document.querySelector('#content').innerHTML.length > 200", 9000);
        await cdp.waitFor("!document.querySelector('#content .skeleton')", 9000);
        await cdp.shot('03-menu-' + m);
      });
    }

    await step('模型编辑弹窗', async () => {
      await cdp.eval(`(() => { location.hash = '#/models'; return true; })()`);
      await sleep(700);
      await cdp.waitFor("!!document.querySelector('[data-act=\"model-edit\"]')");
      await cdp.eval("document.querySelector('[data-act=\"model-edit\"]').click()");
      await cdp.waitFor("!document.querySelector('#modalMask').hidden");
      await cdp.shot('04-model-modal');
      await cdp.eval("document.querySelector('#modalX').click()");
    });

    await step('新建模型 → 前台同步', async () => {
      await cdp.eval(`(() => {
        document.querySelector('[data-act="model-new"]').click();
        return true;
      })()`);
      await cdp.waitFor("!document.querySelector('#modalMask').hidden && !!document.querySelector('#fSave')");
      await cdp.eval(`(() => {
        document.querySelector('#fName').value = 'TEST-CDP-MODEL';
        const sel = document.querySelector('#fBrand');
        sel.value = 'OpenAI';
        document.querySelector('#fPrice').value = '¥0.01/次';
        document.querySelector('#fDesc').value = '自动化自检创建，稍后删除';
        document.querySelector('#fTags').value = '1M 上下文\\n推理';
        document.querySelector('#fCtx').checked = true;
        return true;
      })()`);
      await cdp.eval("document.querySelector('#fSave').click()");
      await sleep(1200);
      const found = await cdp.eval(`fetch('/?page=models').then(r => r.text()).then(t => t.includes('TEST-CDP-MODEL'))`);
      if (!found) throw new Error('前台模型广场未出现新模型');
      await cdp.shot('05-model-created');
    });

    await step('删除测试模型', async () => {
      await cdp.eval(`(() => { location.hash = '#/models'; return true; })()`);
      await sleep(600);
      await cdp.eval(`(() => { document.querySelector('#modelQ').value = 'TEST-CDP-MODEL'; document.querySelector('[data-act="model-query"]').click(); return true; })()`);
      await sleep(900);
      await cdp.eval("document.querySelector('[data-act=\"model-del\"]').click()");
      await cdp.waitFor("!document.querySelector('#confirmMask').hidden");
      await cdp.eval("document.querySelector('#confirmOk').click()");
      await sleep(1000);
      const gone = await cdp.eval(`fetch('/?page=models').then(r => r.text()).then(t => !t.includes('TEST-CDP-MODEL'))`);
      if (!gone) throw new Error('测试模型未从前台移除');
    });

    await step('页面区块保存', async () => {
      await cdp.eval(`(() => { location.hash = '#/pages'; return true; })()`);
      await sleep(800);
      await cdp.waitFor("!!document.querySelector('#blockHtml')");
      await cdp.eval(`(() => {
        const t = document.querySelector('#blockHtml');
        t.value = t.value.replace('智联云端 · 安全赋能', '智联云端 · 安全赋能');
        document.querySelector('[data-act="block-save"]').click();
        return true;
      })()`);
      await sleep(900);
      const same = await cdp.eval("fetch('/').then(r=>r.text()).then(t=>t.length===15057 && t.includes('智联云端'))");
      if (!same) throw new Error('保存区块后首页与原始快照不再一致');
      await cdp.shot('06-pages');
    });

    await step('公告保存', async () => {
      await cdp.eval(`(() => { location.hash = '#/notice'; return true; })()`);
      await sleep(800);
      await cdp.waitFor("!!document.querySelector('[data-act=\"notice-save\"]')");
      await cdp.eval("document.querySelector('[data-act=\"notice-save\"]').click()");
      await sleep(800);
      await cdp.shot('07-notice');
    });

    await step('设置保存', async () => {
      await cdp.eval(`(() => { location.hash = '#/settings'; return true; })()`);
      await sleep(800);
      await cdp.waitFor("!!document.querySelector('[data-act=\"settings-save\"]')");
      await cdp.eval("document.querySelector('[data-act=\"settings-save\"]').click()");
      await sleep(800);
      await cdp.shot('08-settings');
    });

    await step('订单状态切换', async () => {
      await cdp.eval(`(() => { location.hash = '#/orders'; return true; })()`);
      await sleep(800);
      await cdp.waitFor("!!document.querySelector('[data-order-status]')");
      await cdp.eval(`(() => {
        const sel = document.querySelector('[data-order-status]');
        sel.value = sel.value === 'paid' ? 'closed' : 'paid';
        sel.dispatchEvent(new Event('change'));
        return sel.value;
      })()`);
      await sleep(700);
    });

    await step('工单详情与回复', async () => {
      await cdp.eval(`(() => { location.hash = '#/tickets'; return true; })()`);
      await sleep(800);
      await cdp.waitFor("!!document.querySelector('[data-act=\"ticket-open\"]')");
      await cdp.eval("document.querySelector('[data-act=\"ticket-open\"]').click()");
      await cdp.waitFor("!document.querySelector('#modalMask').hidden");
      await cdp.shot('09-ticket');
      await cdp.eval(`(() => {
        document.querySelector('#tkReply').value = '已收到，正在为您处理（自检回复）';
        document.querySelector('#tkSend').click();
        return true;
      })()`);
      await sleep(900);
    });

    await step('前台六页渲染无脚本错误', async () => {
      for (const p of ['/', '/?page=models', '/?page=terms', '/?page=privacy', '/?page=refund', '/?page=ip']) {
        await cdp.send('Page.navigate', { url: BASE + p });
        await cdp.waitFor("document.readyState === 'complete'");
        await sleep(400);
      }
    });

    await cdp.send('Page.navigate', { url: BASE + '/' });
    await cdp.waitFor("document.readyState === 'complete'");
    await sleep(1200);
    await cdp.shot('10-front-home');
    await cdp.send('Page.navigate', { url: BASE + '/?page=models' });
    await cdp.waitFor("document.readyState === 'complete'");
    await sleep(1200);
    await cdp.shot('11-front-models');

    console.log('\nconsole/请求错误：', errors.length ? '\n - ' + errors.join('\n - ') : '无');
    console.log('截图目录：' + OUT);
    process.exitCode = errors.length ? 2 : 0;
  } catch (e) {
    console.error('自检失败：', e.message);
    process.exitCode = 1;
  } finally {
    try { chrome.kill('SIGKILL'); } catch (e) { /* ignore */ }
  }
})();
