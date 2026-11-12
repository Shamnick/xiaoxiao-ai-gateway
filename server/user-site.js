'use strict';
/**
 * 用户中心（user 子站）服务端：
 *   · 页面：以线上快照为母版渲染（默认与线上逐字节一致）
 *   · 接口：/?ajax=* 的本地实现，返回与线上同构的数据，保证前端交互闭环
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC_USER = path.join(ROOT, 'public/user');
const renderUser = require('./render-user');
const { applyBrand } = require('./render');
const { transform } = require('./transform');
const store = require('./store');

const PAGE_MAP = {
  subscription: 'subscription', keys: 'keys', billing: 'billing', recharge: 'recharge',
  invite: 'invite', settings: 'settings', docs: 'docs', dashboard: 'dashboard',
  login: 'login', register: 'login',
};

const USER_SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'content-security-policy': "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://kefu.yutiankejiai.com; frame-src https://challenges.cloudflare.com https://kefu.yutiankejiai.com; style-src 'self' https://kefu.yutiankejiai.com; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  'expires': 'Thu, 19 Nov 1981 08:52:00 GMT',
  'cache-control': 'no-store, no-cache, must-revalidate',
  'pragma': 'no-cache',
  'vary': 'Accept-Encoding',
};

function userPageFromUrl(url) {
  const p = url.pathname;
  if (p === '/image/' || p === '/image') return 'image';
  if (p === '/video/' || p === '/video') return 'video';
  const pg = url.searchParams.get('page');
  if (pg && Object.prototype.hasOwnProperty.call(PAGE_MAP, pg) && PAGE_MAP[pg]) return PAGE_MAP[pg];
  return 'dashboard';
}

/* ---------------- 页面 ---------------- */
function escA(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 后台可运营的套餐卡片：对原文卡片做字段级替换（值不变则字节不变） */
function applyCard(raw, p) {
  let out = raw;
  const put = (re, val) => { out = out.replace(re, (m, a, b) => a + val + b); };
  put(/(data-price=")[^"]*(")/, p.price);
  put(/(<span class="sub-price-num">)[^<]*(<\/span>)/, p.price);
  put(/(data-name=")[^"]*(")/, escA(p.name));
  put(/(<h3 class="sub-name">)[^<]*(<\/h3>)/, p.name);
  put(/(<p class="sub-subtitle">)[^<]*(<\/p>)/, p.subtitle || '');
  put(/(<p class="sub-period">)[^<]*(<\/p>)/, p.period || '');
  if (p.badge) {
    if (/<span class="sub-badge">/.test(out)) put(/(<span class="sub-badge">)[^<]*(<\/span>)/, p.badge);
  }
  // 特性列表
  const features = Array.isArray(p.features) ? p.features : [];
  const liCount = (out.match(/<li>/g) || []).length;
  if (liCount === features.length) {
    let i = 0;
    out = out.replace(/(<li>)([^<]*)(<\/li>)/g, (m, a, _t, b) => a + features[i++] + b);
  } else if (features.length) {
    const ulRe = /(<ul class="sub-features">)([\s\S]*?)(<\/ul>)/;
    const m = out.match(ulRe);
    if (m) {
      const indent = (m[2].match(/\n(\s*)<li>/) || [null, '                                          '])[1];
      const body = features.map(f => '\n' + indent + '<li>' + f + '</li>').join('');
      out = out.replace(ulRe, (all, a, _b, c) => a + body + '\n' + indent.slice(0, Math.max(0, indent.length - 26)) + c);
    }
  }
  put(/(<span>总次数 <b>)[^<]*(<\/b><\/span>)/, p.total);
  put(/(<span>每日 <b>)[^<]*(<\/b><\/span>)/, p.daily);
  put(/(<span>并发 <b>)[^<]*(<\/b><\/span>)/, p.concurrency);
  if (p.models_count != null) put(/(查看可用模型（)\d+(）)/, String(p.models_count));
  return out;
}

function applyPlans(html, plans) {
  let out = html;
  plans.forEach(p => {
    if (!p.origHtml || !out.includes(p.origHtml)) return;
    out = out.split(p.origHtml).join(p.visible === false ? '' : applyCard(p.origHtml, p));
  });
  return out;
}

function renderPage(page, db) {
  const site = db.userSite;
  let html = renderUser.pageHtml(page, site);
  const uc0 = db.userCenter;
  if (page === 'subscription' && uc0 && Array.isArray(uc0.plansV2)) {
    html = applyPlans(html, uc0.plansV2);
  }
  html = applyBrand(html, db.settings || {});
  html = transform(html, { userBase: '' });
  if (page === 'login') {
    if (!html.includes('ytk-auth.js')) {
      html = html.replace('</body>', '<script src="/assets/js/ytk-auth.js" defer></script></body>');
    }
  } else if (page === 'recharge') {
    if (!html.includes('ytk-recharge.js')) {
      const qrInject = html.includes('qrcode.min.js') ? '' : '<script src="/assets/js/qrcode.min.js"></script>';
      html = html.replace('</body>', qrInject + '<script src="/assets/js/ytk-recharge.js" defer></script></body>');
    }
  } else if (!html.includes('ytk-bind.js')) {
    html = html.replace('</body>',
      '<link rel="stylesheet" href="/assets/css/ytk-panel.css"><script src="/assets/js/ytk-bind.js" defer></script></body>');
  }
  return html;
}

/* ---------------- 数据视图 ---------------- */
function uc(db) {
  if (!db.userCenter) {
    db.userCenter = {
      profile: { username: 'sham', nickname: 'sham', email: '', points: 0, balance: 0, plan: null, joined: '' },
      subscriptions: [], keys: [], billing: [], invite: { codes: [], invitees: [] },
      redeemCodes: [], usage: [], media: [], tasks: [], videoStyles: [],
    };
  }
  return db.userCenter;
}

function brandLabels(db) {
  const map = {};
  (db.brands || []).forEach(b => { map[b.id] = b.label; });
  return map;
}

function priceNumber(p) {
  const m = String(p == null ? '' : p).match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

function pricesPayload(db) {
  const labels = brandLabels(db);
  const rows = (db.models || [])
    .filter(m => m.enabled !== false)
    .map((m, i) => {
      const tags = (m.tags || []).map(t => t.text);
      const ctx = tags.find(t => /上下文/.test(t)) || '';
      return {
        model: m.name,
        price: priceNumber(m.price),
        available: true,
        brand: m.brand,
        brand_label: labels[m.brand] || m.brand,
        vision: tags.some(t => /视觉/.test(t)),
        description: String(m.desc || '').replace(/<[^>]+>/g, ''),
        tags: tags.filter(t => !/上下文/.test(t)),
        context: (ctx.match(/[\d.]+\s*[MK]/i) || [''])[0] || '',
        is_new: !!m.is_new,
      };
    });
  return {
    ok: true,
    revision: String((db.models || []).length) + '-' + (db.meta && db.meta.updated_at ? db.meta.updated_at : 'seed'),
    scope: 'all',
    prices: rows,
  };
}

function qrSvg(amount) {
  // 伪二维码占位（确定性点阵 + 定位角），仅用于演示界面观感
  const n = 25, cell = 8, size = n * cell;
  let seed = 0;
  for (const ch of String(amount)) seed = (seed * 131 + ch.charCodeAt(0)) % 100000;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let rects = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const corner = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
      if (!corner && rnd() > 0.52) {
        rects += `<rect x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`;
      }
    }
  }
  const eye = (x, y) => `<rect x="${x * cell}" y="${y * cell}" width="${cell * 7}" height="${cell * 7}"/>` +
    `<rect x="${(x + 1) * cell}" y="${(y + 1) * cell}" width="${cell * 5}" height="${cell * 5}" fill="#fff"/>` +
    `<rect x="${(x + 2) * cell}" y="${(y + 2) * cell}" width="${cell * 3}" height="${cell * 3}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><g fill="#0b1220">${rects}${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}</g>` +
    `<rect x="${size * 0.38}" y="${size * 0.38}" width="${size * 0.24}" height="${size * 0.24}" rx="6" fill="#fff"/>` +
    `<text x="${size / 2}" y="${size * 0.53}" font-size="${size * 0.12}" text-anchor="middle" fill="#0b1220" font-family="sans-serif">¥${amount}</text></svg>`;
}

/* ---------------- 接口 ---------------- */
async function handleAjax(req, res, url, sendJson, readBody) {
  const db = store.load();
  const data = uc(db);
  const action = url.searchParams.get('ajax') || '';
  let body = {};
  if (req.method === 'POST') {
    try { body = await readBody(req); } catch (e) { body = {}; }
  }
  const q = k => url.searchParams.get(k);

  switch (action) {
    case 'model_prices':
      return sendJson(res, 200, pricesPayload(db));

    case 'subscriptions':
      return sendJson(res, 200, { ok: true, subscriptions: data.subscriptions || [] });

    case 'subscription_claim': {
      const plan = body.plan || q('plan') || '';
      const found = (data.plans || []).find(p => p.id === plan || p.name === plan);
      if (!found) return sendJson(res, 200, { ok: false, error: '套餐不存在' });
      const sub = {
        id: 'sub' + Date.now().toString(36), plan: found.name, status: 'active',
        key: 'sk-yt-demo-' + Math.random().toString(36).slice(2, 14),
        started_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + (found.days || 30) * 864e5).toISOString(),
        used: 0, quota: found.daily || 0, concurrency: found.concurrency || 1,
      };
      data.subscriptions.push(sub);
      store.save();
      return sendJson(res, 200, { ok: true, subscription: sub });
    }

    case 'subscription_redeem': {
      const code = String(body.code || q('code') || '').trim().toUpperCase();
      const idx = (data.redeemCodes || []).findIndex(c => c.code === code && !c.used);
      if (!code) return sendJson(res, 200, { ok: false, error: '请输入兑换码' });
      if (idx < 0) return sendJson(res, 200, { ok: false, error: '兑换码无效或已被使用' });
      const c = data.redeemCodes[idx];
      c.used = true; c.used_at = new Date().toISOString();
      const sub = {
        id: 'sub' + Date.now().toString(36), plan: c.plan, status: 'active',
        key: 'sk-yt-' + Math.random().toString(36).slice(2, 16),
        started_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + (c.days || 30) * 864e5).toISOString(),
        used: 0, quota: c.daily || 0, concurrency: c.concurrency || 1,
      };
      data.subscriptions.push(sub);
      store.save();
      return sendJson(res, 200, { ok: true, subscription: sub });
    }

    case 'invite_codes':
      return sendJson(res, 200, { ok: true, codes: data.invite.codes || [] });
    case 'invite_invitees':
      return sendJson(res, 200, { ok: true, invitees: data.invite.invitees || [] });

    case 'usage_logs':
      return sendJson(res, 200, {
        ok: true, from: q('from') || '', to: q('to') || '', key_id: null, key_name: null, key_masked: null,
        total: (data.usage || []).length, page: 1, pageSize: 15, records: data.usage || [],
      });

    case 'media_logs':
      return sendJson(res, 200, {
        ok: true, type: q('type') || 'image', from: q('from') || '', to: q('to') || '',
        total: (data.media || []).length, page: 1, pageSize: 15, records: data.media || [],
      });

    case 'client_setup_status':
      return sendJson(res, 200, { ok: true, items: data.clientSetup || [] });
    case 'client_setup':
      return sendJson(res, 200, { ok: true, items: data.clientSetup || [] });

    case 'video_wizard_styles':
      return sendJson(res, 200, { ok: true, styles: data.videoStyles || [] });
    case 'video_wizard':
      return sendJson(res, 200, { ok: true, id: body.id || q('id') || '', steps: [], fields: [] });
    case 'video_tasks':
      return sendJson(res, 200, { ok: true, items: data.tasks || [] });
    case 'video_estimate':
      return sendJson(res, 200, { ok: true, points: 0, seconds: 8, cost: 0 });
    case 'video_submit':
      return sendJson(res, 200, { ok: true, task_id: 'task' + Date.now().toString(36), status: 'queued' });
    case 'video_optimize':
      return sendJson(res, 200, { ok: true, prompt: String(body.prompt || ''), note: '演示环境：已返回原始提示词' });
    case 'video_cancel':
      return sendJson(res, 200, { ok: true });
    case 'video_frame':
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#0b1220"/><text x="160" y="96" fill="#4b6b8a" font-size="14" text-anchor="middle" font-family="sans-serif">demo frame</text></svg>`);

    case 'recharge_qr': {
      const amount = q('amount') || body.amount || '100';
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' });
      return res.end(qrSvg(amount));
    }
    case 'recharge_claim':
      return sendJson(res, 200, { ok: true, claimed: 0, message: '演示环境：支付回调未接入' });

    case 'patch_key': {
      const id = body.id || q('id');
      const key = (data.keys || []).find(k => k.id === id);
      if (!key) return sendJson(res, 200, { ok: false, error: 'Key 不存在' });
      if (body.name != null) key.name = String(body.name);
      if (body.enabled != null) key.enabled = !!body.enabled;
      store.save();
      return sendJson(res, 200, { ok: true, key });
    }
    case 'delete_key_estimate': {
      const id = body.id || q('id');
      const key = (data.keys || []).find(k => k.id === id);
      return sendJson(res, 200, { ok: true, id, used: key ? key.used || 0 : 0, refund_points: 0 });
    }
    case 'delete_key': {
      const id = body.id || q('id');
      data.keys = (data.keys || []).filter(k => k.id !== id);
      store.save();
      return sendJson(res, 200, { ok: true });
    }

    default:
      return sendJson(res, 200, { ok: true, note: 'demo' });
  }
}

module.exports = {
  userPageFromUrl, renderPage, handleAjax, USER_SEC_HEADERS, PUBLIC_USER, PAGE_MAP,
};
