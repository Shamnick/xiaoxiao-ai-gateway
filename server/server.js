'use strict';
/**
 * 宇天科技站点镜像 + 后台管理服务
 * 零依赖 Node.js（>=18）HTTP 服务。
 *   · 前台：字节级复刻 a1.yutiankejiai.com（数据驱动，默认与线上一致）
 *   · 后台：/admin/ 管理模型、品牌、页面区块、公告、用户、订单、工单、设置、日志
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const store = require('./store');
const render = require('./render');
const userSite = require('./user-site');
const platform = require('./platform');

const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const ADMIN = path.join(PUBLIC, 'admin');
const PORT = Number(process.env.PORT || 8848);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=UTF-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
};

const SEC_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  'content-security-policy': "default-src 'self'; script-src 'self' https://kefu.yutiankejiai.com; style-src 'self' https://kefu.yutiankejiai.com; frame-src https://kefu.yutiankejiai.com; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests",
};

const NGNIX_404 = `<html>\r\n<head><title>404 Not Found</title></head>\r\n<body>\r\n<center><h1>404 Not Found</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n<!-- a padding to disable MSIE and Chrome friendly error page -->\r\n`;

/* ------------------------------ 工具 ------------------------------ */
const sessions = new Map();
const SESSION_TTL = 1000 * 60 * 60 * 12;

function nowIso() { return new Date().toISOString(); }

function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(res.req && res.req.method === 'HEAD' ? undefined : body);
}

function sendText(res, code, text, ctype) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(code, {
    'content-type': ctype || 'text/plain; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res, code, html, opts) {
  const o = opts || {};
  const buf = Buffer.from(html, 'utf8');
  const headers = Object.assign({
    'content-type': 'text/html; charset=UTF-8',
    vary: 'Accept-Encoding',
  }, o.headers ? o.headers : (o.secure === false ? {} : SEC_HEADERS));

  const ae = String((res.req && res.req.headers['accept-encoding']) || '');
  if (o.gzip !== false && /\bgzip\b/.test(ae) && buf.length > 512) {
    const gz = zlib.gzipSync(buf, { level: 6 });
    headers['content-encoding'] = 'gzip';
    headers['content-length'] = gz.length;
    res.writeHead(code, headers);
    res.end(res.req.method === 'HEAD' ? undefined : gz);
    return;
  }
  headers['content-length'] = buf.length;
  res.writeHead(code, headers);
  res.end(res.req.method === 'HEAD' ? undefined : buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > 4 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const ct = String(req.headers['content-type'] || '');
      if (ct.includes('multipart/form-data')) return resolve({});
      if (ct.includes('application/x-www-form-urlencoded')) {
        const o = {};
        new URLSearchParams(raw).forEach((v, k) => { o[k] = v; });
        return resolve(o);
      }
      try { resolve(JSON.parse(raw)); } catch (e) {
        const o = {};
        try { new URLSearchParams(raw).forEach((v, k) => { o[k] = v; }); } catch (e2) { /* ignore */ }
        resolve(o);
      }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function currentSession(req) {
  const sid = parseCookies(req)['ytk_sid'];
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(sid); return null; }
  s.exp = Date.now() + SESSION_TTL;
  return Object.assign({ sid }, s);
}

/* ------------------------------ 访问统计 ------------------------------ */
const visitBuffer = new Map();
let visitTimer = null;
function hitPage(page) {
  const day = new Date().toISOString().slice(0, 10);
  const key = day + '|' + page;
  visitBuffer.set(key, (visitBuffer.get(key) || 0) + 1);
  if (!visitTimer) {
    visitTimer = setTimeout(flushVisits, 5000);
    if (visitTimer.unref) visitTimer.unref();
  }
}
function flushVisits() {
  visitTimer = null;
  if (!visitBuffer.size) return;
  const db = store.load();
  db.visits = db.visits || [];
  visitBuffer.forEach((n, key) => {
    const [day, page] = key.split('|');
    const row = db.visits.find(v => v.day === day && v.page === page);
    if (row) { row.pv += n; row.uv += Math.round(n * 0.72); }
    else db.visits.push({ day, page, pv: n, uv: Math.round(n * 0.72) });
  });
  visitBuffer.clear();
  store.save();
}

/* ------------------------------ 用户 API / OpenAI 兼容端点 ------------------------------ */
function setUserCookie(res, token) {
  res.setHeader('set-cookie', 'ytk_uid=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + 7 * 86400);
}

async function handleUserApi(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '');
  const method = req.method.toUpperCase();
  let body = {};
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: '请求体解析失败' }); }
  }

  if (p === '/api/user/register' && method === 'POST') {
    const r = platform.register(body.username, body.password, body.email, body.invite_code);
    if (r.error) return sendJson(res, 400, { ok: false, error: r.error });
    const token = platform.issueSession(r.user.id);
    setUserCookie(res, token);
    return sendJson(res, 200, { ok: true, user: platform.publicUser(r.user) });
  }

  if (p === '/api/user/login' && method === 'POST') {
    const r = platform.login(body.username, body.password);
    if (r.error) return sendJson(res, 401, { ok: false, error: r.error });
    const token = platform.issueSession(r.user.id);
    setUserCookie(res, token);
    return sendJson(res, 200, { ok: true, user: platform.publicUser(r.user) });
  }

  if (p === '/api/user/logout' && method === 'POST') {
    platform.dropSession(req);
    res.setHeader('set-cookie', 'ytk_uid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }

  const me = platform.sessionUser(req);
  if (!me) return sendJson(res, 401, { ok: false, error: '未登录' });

  if (p === '/api/user/me' && method === 'GET') {
    return sendJson(res, 200, { ok: true, user: platform.publicUser(me) });
  }

  if (p === '/api/user/keys' && method === 'GET') {
    const keys = platform.listKeys(me.id).map(k => ({
      id: k.id, name: k.name, key: k.key, masked: platform.maskKey(k.key),
      enabled: k.enabled, quota: k.quota, used: k.used, models: k.models,
      expires_at: k.expires_at, created_at: k.created_at, last_used_at: k.last_used_at,
    }));
    return sendJson(res, 200, { ok: true, items: keys });
  }
  if (p === '/api/user/keys' && method === 'POST') {
    const k = platform.createKey(me.id, body);
    return sendJson(res, 200, { ok: true, key: Object.assign({}, k, { key: k.key, masked: platform.maskKey(k.key) }) });
  }
  const keyRe = /^\/api\/user\/keys\/([\w-]+)$/.exec(p);
  if (keyRe) {
    const k = platform.listKeys(me.id).find(x => x.id === keyRe[1]);
    if (!k) return sendJson(res, 404, { ok: false, error: 'Key 不存在' });
    if (method === 'PUT') {
      ['name', 'enabled', 'quota'].forEach(f => { if (body[f] != null) k[f] = body[f]; });
      if (Array.isArray(body.models)) k.models = body.models;
      store.save();
      return sendJson(res, 200, { ok: true, key: k });
    }
    if (method === 'DELETE') {
      const d = store.load();
      d.platform.keys = d.platform.keys.filter(x => x.id !== k.id);
      store.save();
      return sendJson(res, 200, { ok: true });
    }
  }

  if (p === '/api/user/logs' && method === 'GET') {
    const items = platform.listLogs({
      user_id: me.id, key_id: url.searchParams.get('key_id') || undefined,
      since: url.searchParams.get('from') || undefined,
    }).slice(0, 200);
    return sendJson(res, 200, { ok: true, items, total: items.length });
  }

  if (p === '/api/user/recharge/plans' && method === 'GET') {
    return sendJson(res, 200, { ok: true, plans: platform.rechargePlans(), point_per_yuan: platform.POINT_PER_YUAN });
  }
  if (p === '/api/user/recharge/create' && method === 'POST') {
    const r = platform.createOrder(me.id, body.amount);
    if (r.error) return sendJson(res, 400, { ok: false, error: r.error });
    const o = r.order;
    return sendJson(res, 200, { ok: true, order: o, pay_url: '/pay/' + o.id, points: o.points });
  }
  if (p === '/api/user/recharge/status' && method === 'GET') {
    const o = platform.findOrder(url.searchParams.get('order'));
    if (!o || o.user_id !== me.id) return sendJson(res, 404, { ok: false, error: '订单不存在' });
    return sendJson(res, 200, { ok: true, status: o.status, order: o, balance: platform.publicUser(me).balance });
  }
  if (p === '/api/user/orders' && method === 'GET') {
    const d = store.load();
    const list = ((d.platform && d.platform.orders) || []).filter(o => o.user_id === me.id).slice(0, 50);
    return sendJson(res, 200, { ok: true, items: list });
  }

  if (p === '/api/user/usage' && method === 'GET') {
    return sendJson(res, 200, Object.assign({ ok: true }, platform.usageStats(me.id, url.searchParams.get('days'))));
  }

  if (p === '/api/user/generation' && method === 'GET') {
    const id = url.searchParams.get('id');
    const logs = platform.listLogs({ user_id: me.id });
    const row = logs.find(l => l.id === id) || logs[0];
    return sendJson(res, 200, { ok: !!row, generation: row || null });
  }

  if (p === '/api/user/overview' && method === 'GET') {
    const logs = platform.listLogs({ user_id: me.id });
    const keys = platform.listKeys(me.id);
    const spent = logs.reduce((s2, l) => s2 + (Number(l.cost) || 0), 0);
    return sendJson(res, 200, {
      ok: true, user: platform.publicUser(me),
      keys: keys.length, calls: logs.length, spent: Number(spent.toFixed(4)),
      today_calls: logs.filter(l => l.at.slice(0, 10) === new Date().toISOString().slice(0, 10)).length,
    });
  }

  return sendJson(res, 404, { ok: false, error: '接口不存在' });
}

/** OpenAI 兼容：/v1/models、/v1/chat/completions */
async function handleV1(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '').replace(/^\/api\/v1/, '/v1');
  if (p === '/v1/models' && req.method === 'GET') {
    const db = store.load();
    const brands = {};
    (db.brands || []).forEach(b => { brands[b.id] = b.label; });
    const data = (db.models || []).filter(m => m.enabled !== false).map(m => {
      const pr = m.pricing || {};
      return {
        id: m.name,
        canonical_slug: String(m.name).toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        name: m.name,
        description: String(m.desc || '').replace(/<[^>]+>/g, ''),
        created: Math.floor(Date.now() / 1000),
        object: 'model',
        owned_by: m.brand || 'xiaoxiao',
        context_length: m.context_length || 128000,
        architecture: {
          modality: (m.modalities || ['text']).join('+'),
          input_modalities: m.modalities || ['text'],
          output_modalities: ['text'],
          tokenizer: 'GPT',
        },
        pricing: {
          prompt: String(((Number(pr.prompt) || 0) / 1000).toFixed(6)),
          completion: String(((Number(pr.completion) || 0) / 1000).toFixed(6)),
          request: String((Number(pr.request) || 0).toFixed(6)),
          currency: 'POINTS',
          unit: 'per 1K tokens',
        },
        top_provider: {
          context_length: m.context_length || 128000,
          max_completion_tokens: m.max_output || 64000,
          is_moderated: false,
        },
        supported_parameters: ['temperature', 'top_p', 'max_tokens', 'stream', 'tools', 'response_format'],
        provider_label: brands[m.brand] || m.brand || 'xiaoxiao',
      };
    });
    return sendJson(res, 200, { data });
  }
  if (p === '/v1/chat/completions' && req.method === 'POST') {
    let body = {};
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: { message: 'invalid json', type: 'invalid_request_error' } }); }
    const auth = String(req.headers.authorization || '');
    const secret = auth.replace(/^Bearer\s+/i, '').trim();
    const r = await platform.relayChat(secret, body);
    if (!r.ok) {
      return sendJson(res, r.status, { error: { message: r.error, type: r.type || 'error' } });
    }
    if (r.stream && Array.isArray(r.data)) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      r.data.forEach(chunk => res.write(chunk));
      return res.end();
    }
    return sendJson(res, 200, r.data);
  }
  if (p === '/v1/embeddings' && req.method === 'POST') {
    let body = {};
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: { message: 'invalid json', type: 'invalid_request_error' } }); }
    const secret = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const r = await platform.relayEmbeddings(secret, body);
    if (!r.ok) return sendJson(res, r.status, { error: { message: r.error, type: r.type || 'error' } });
    return sendJson(res, 200, r.data);
  }
  if (p === '/v1/images/generations' && req.method === 'POST') {
    let body = {};
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: { message: 'invalid json', type: 'invalid_request_error' } }); }
    const secret = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const r = await platform.relayImages(secret, body);
    if (!r.ok) return sendJson(res, r.status, { error: { message: r.error, type: r.type || 'error' } });
    return sendJson(res, 200, r.data);
  }

  return sendJson(res, 404, { error: { message: 'not found', type: 'invalid_request_error' } });
}

/* ------------------------------ 在线客服（自建） ------------------------------ */
function supportStore(db) {
  if (!db.support) db.support = { threads: [] };
  db.support.threads = db.support.threads || [];
  return db.support;
}

async function handleSupport(req, res, url) {
  const db = store.load();
  const sp = supportStore(db);
  const p = url.pathname.replace(/\/+$/, '');
  if (p === '/api/support/send' && req.method === 'POST') {
    let body = {};
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { ok: false, error: '请求体解析失败' }); }
    const text = String(body.text || '').trim().slice(0, 2000);
    const name = String(body.name || '').trim().slice(0, 32);
    if (!text) return sendJson(res, 400, { ok: false, error: '消息不能为空' });
    if (!name) return sendJson(res, 400, { ok: false, error: '请填写称呼' });
    let thread = body.thread_id ? sp.threads.find(t => t.id === body.thread_id) : null;
    if (!thread) {
      thread = {
        id: 'st' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name, source: String(body.source || '').slice(0, 200),
        status: 'open', unread: 0, created_at: nowIso(), messages: [],
      };
      sp.threads.unshift(thread);
    }
    thread.messages.push({ role: 'user', text, at: nowIso(), name });
    thread.unread = (thread.unread || 0) + 1;
    thread.updated_at = nowIso();
    store.save();
    return sendJson(res, 200, { ok: true, thread_id: thread.id, thread });
  }
  if (p === '/api/support/poll') {
    const id = url.searchParams.get('thread_id');
    const thread = sp.threads.find(t => t.id === id);
    if (!thread) return sendJson(res, 404, { ok: false, error: '会话不存在' });
    return sendJson(res, 200, { ok: true, thread });
  }
  return sendJson(res, 404, { ok: false, error: '接口不存在' });
}

/* ------------------------------ 前台页面 ------------------------------ */
const PAGE_ALIAS = { models: 'models', terms: 'terms', privacy: 'privacy', refund: 'refund', ip: 'ip' };

function userBaseFor(req) {
  const host = String(req.headers.host || '').split(':')[0] || '127.0.0.1';
  return 'http://' + host + ':' + USER_PORT;
}

const USER_ONLY_PAGES = ['login', 'register', 'keys', 'billing', 'recharge', 'invite', 'settings', 'docs', 'subscription', 'image', 'video'];

function servePage(req, res, url) {
  const reqPage = url.searchParams.get('page');
  if (reqPage && USER_ONLY_PAGES.indexOf(reqPage) !== -1) {
    res.writeHead(302, { location: userBaseFor(req) + '/?page=' + reqPage });
    return res.end();
  }
  const page = PAGE_ALIAS[reqPage] || 'home';
  const db = store.load();
  const html = render.pageHtml(page, db, { userBase: userBaseFor(req) });
  hitPage(url.searchParams.get('page') || '/');
  if (db.settings && db.settings.maintenance && page !== 'home') {
    return sendHtml(res, 503, '<!doctype html><meta charset="utf-8"><title>维护中</title><body style="font-family:system-ui;background:#060b14;color:#e6f1ff;display:grid;place-items:center;height:100vh;margin:0"><div><h1>站点维护中</h1><p>请稍后访问。</p></div>');
  }
  sendHtml(res, 200, html);
}

/* ------------------------------ 静态资源 ------------------------------ */
function serveStatic(req, res, baseDir, relPath, noCache) {
  let rel = decodeURIComponent(relPath.split('?')[0]);
  if (rel.includes('\u0000')) return nginx404(res);
  const abs = path.normalize(path.join(baseDir, rel));
  if (!abs.startsWith(baseDir + path.sep) && abs !== baseDir) return nginx404(res);
  let stat;
  try { stat = fs.statSync(abs); } catch (e) { return nginx404(res); }
  if (stat.isDirectory()) {
    const idx = path.join(abs, 'index.html');
    if (fs.existsSync(idx)) return serveFile(req, res, idx, true);
    return nginx404(res);
  }
  return serveFile(req, res, abs, !!noCache);
}

function serveFile(req, res, abs, noCache) {
  const ext = path.extname(abs).toLowerCase();
  const ctype = MIME[ext] || 'application/octet-stream';
  let buf;
  try { buf = fs.readFileSync(abs); } catch (e) { return nginx404(res); }
  const etag = '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '-' + buf.length.toString(16) + '"';
  const headers = {
    'server': 'nginx',
    'content-type': ctype,
    'etag': etag,
    'accept-ranges': 'bytes',
    'cache-control': noCache ? 'no-cache' : 'public, max-age=31536000, immutable',
  };
  if (!noCache) headers.vary = 'Accept-Encoding';
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  const range = req.headers.range;
  if (range && /^bytes=/.test(range)) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : buf.length - 1;
    if (isNaN(start) || isNaN(end) || start > end || start >= buf.length) {
      res.writeHead(416, { 'content-range': 'bytes */' + buf.length });
      return res.end();
    }
    end = Math.min(end, buf.length - 1);
    const part = buf.slice(start, end + 1);
    headers['content-range'] = 'bytes ' + start + '-' + end + '/' + buf.length;
    headers['content-length'] = part.length;
    res.writeHead(206, headers);
    return res.end(req.method === 'HEAD' ? undefined : part);
  }
  headers['content-length'] = buf.length;
  res.writeHead(200, headers);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

function nginx404(res) {
  const body = Buffer.from(NGNIX_404, 'utf8');
  res.writeHead(404, {
    'server': 'nginx',
    'content-type': 'text/html',
    'content-length': body.length,
  });
  res.end(body);
}

/* ------------------------------ 后台 API ------------------------------ */
function requireAuth(req, res) {
  const s = currentSession(req);
  if (!s) { sendJson(res, 200, { admin: null, error: '未登录' }); return null; }
  return s;
}

function isMeProbe(url) { return url.pathname === '/api/admin/me'; }

function paginate(list, url, defaultSize) {
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const size = Math.min(200, Math.max(1, parseInt(url.searchParams.get('size') || String(defaultSize || 20), 10) || 20));
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const items = list.slice((page - 1) * size, page * size);
  return { items, total, page: Math.min(page, pages), size, pages };
}

function textMatch(obj, q, fields) {
  if (!q) return true;
  const s = String(q).toLowerCase();
  return fields.some(f => String(obj[f] == null ? '' : obj[f]).toLowerCase().includes(s));
}

const api = async (req, res, url) => {
  const p = url.pathname.replace(/\/+$/, '');
  const method = req.method.toUpperCase();
  const db = store.load();
  let body = {};
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: '请求体解析失败' }); }
  }

  /* ---- 登录 ---- */
  if (p === '/api/admin/login' && method === 'POST') {
    const u = String(body.username || '').trim();
    const pw = String(body.password || '');
    const admin = (db.admins || []).find(a => a.username === u);
    if (!admin || admin.enabled === false || !store.verifyPwd(pw, admin)) {
      store.audit('匿名', 'login-failed', u, '用户名或密码错误');
      return sendJson(res, 401, { error: '用户名或密码错误' });
    }
    const sid = crypto.randomBytes(24).toString('hex');
    sessions.set(sid, { adminId: admin.id, exp: Date.now() + SESSION_TTL });
    admin.last_login = nowIso();
    store.audit(admin.username, 'login', '后台', '登录成功');
    store.save();
    res.setHeader('set-cookie', 'ytk_sid=' + sid + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + Math.floor(SESSION_TTL / 1000));
    return sendJson(res, 200, { ok: true, admin: publicAdmin(admin) });
  }

  if (p === '/api/admin/logout' && method === 'POST') {
    const s = currentSession(req);
    if (s) {
      sessions.delete(s.sid);
      const a = (db.admins || []).find(x => x.id === s.adminId);
      store.audit(a ? a.username : 'system', 'logout', '后台', '退出登录');
    }
    res.setHeader('set-cookie', 'ytk_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return sendJson(res, 200, { ok: true });
  }

  if (isMeProbe(url) && method === 'GET' && !currentSession(req)) {
    return sendJson(res, 200, { admin: null });
  }
  const sess = requireAuth(req, res);
  if (!sess) return;
  const admin = (db.admins || []).find(a => a.id === sess.adminId);
  if (!admin || admin.enabled === false) return sendJson(res, 401, { error: '账号已被禁用' });

  /* ---- 当前用户 ---- */
  if (p === '/api/admin/me' && method === 'GET') {
    return sendJson(res, 200, { admin: publicAdmin(admin) });
  }

  if (p === '/api/admin/password' && method === 'POST') {
    if (!store.verifyPwd(String(body.old_password || ''), admin)) {
      return sendJson(res, 400, { error: '原密码不正确' });
    }
    const np = String(body.new_password || '');
    if (np.length < 6) return sendJson(res, 400, { error: '新密码至少 6 位' });
    store.setPwd(admin, np);
    store.audit(admin.username, 'change-password', admin.username, '修改登录密码');
    store.save();
    return sendJson(res, 200, { ok: true });
  }

  /* ---- 概览 ---- */
  if (p === '/api/admin/overview' && method === 'GET') {
    return sendJson(res, 200, overview(db));
  }

  /* ---- 模型 ---- */
  if (p === '/api/admin/models' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const brand = url.searchParams.get('brand') || '';
    const status = url.searchParams.get('status') || '';
    let list = (db.models || []).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    if (brand) list = list.filter(m => m.brand === brand);
    if (status === 'on') list = list.filter(m => m.enabled !== false);
    if (status === 'off') list = list.filter(m => m.enabled === false);
    if (q) list = list.filter(m => textMatch(m, q, ['name', 'brand', 'desc', 'vendor']) ||
      (m.tags || []).some(t => String(t.text).toLowerCase().includes(q.toLowerCase())));
    return sendJson(res, 200, paginate(list, url, 20));
  }

  if (p === '/api/admin/models' && method === 'POST') {
    const err = validateModel(body, db);
    if (err) return sendJson(res, 400, { error: err });
    const id = 'm' + Date.now().toString(36);
    const model = normalizeModel(body, db);
    model.id = id;
    model.order = (db.models || []).reduce((m, x) => Math.max(m, x.order || 0), -1) + 1;
    db.models.push(model);
    store.audit(admin.username, 'model-create', model.name, '新增模型 ' + model.name);
    store.save();
    return sendJson(res, 200, { ok: true, model });
  }

  if (p === '/api/admin/models/reorder' && method === 'POST') {
    const ids = Array.isArray(body.ids) ? body.ids : [];
    ids.forEach((id, i) => {
      const m = db.models.find(x => x.id === id);
      if (m) m.order = i;
    });
    store.audit(admin.username, 'model-reorder', '模型', '调整排序 ' + ids.length + ' 项');
    store.save();
    return sendJson(res, 200, { ok: true });
  }

  const modelRe = /^\/api\/admin\/models\/([\w-]+)$/.exec(p);
  if (modelRe) {
    const model = (db.models || []).find(m => m.id === modelRe[1]);
    if (!model) return sendJson(res, 404, { error: '模型不存在' });
    if (method === 'PUT') {
      const err = validateModel(Object.assign({}, model, body), db, model.id);
      if (err) return sendJson(res, 400, { error: err });
      const next = normalizeModel(Object.assign({}, model, body), db);
      Object.assign(model, next, { id: model.id, order: model.order });
      if (body.order != null && !isNaN(Number(body.order))) model.order = Number(body.order);
      store.audit(admin.username, 'model-update', model.name, '更新模型 ' + model.name);
      store.save();
      return sendJson(res, 200, { ok: true, model });
    }
    if (method === 'DELETE') {
      db.models = db.models.filter(m => m.id !== model.id);
      store.audit(admin.username, 'model-delete', model.name, '删除模型 ' + model.name);
      store.save();
      return sendJson(res, 200, { ok: true });
    }
  }

  /* ---- 品牌 ---- */
  if (p === '/api/admin/brands' && method === 'GET') {
    return sendJson(res, 200, { items: (db.brands || []).slice().sort((a, b) => a.order - b.order) });
  }
  if (p === '/api/admin/brands' && method === 'POST') {
    const id = String(body.id || '').trim();
    if (!id) return sendJson(res, 400, { error: '品牌标识不能为空' });
    if ((db.brands || []).some(b => b.id === id)) return sendJson(res, 400, { error: '品牌已存在' });
    const b = { id, label: body.label || id, order: db.brands.length, enabled: body.enabled !== false, logo: 'assets/img/brands/' + id + '.svg' };
    db.brands.push(b);
    store.audit(admin.username, 'brand-create', id, '新增品牌 ' + b.label);
    store.save();
    return sendJson(res, 200, { ok: true, brand: b });
  }
  if (p === '/api/admin/brands/reorder' && method === 'POST') {
    (body.ids || []).forEach((id, i) => {
      const b = db.brands.find(x => x.id === id);
      if (b) b.order = i;
    });
    store.save();
    return sendJson(res, 200, { ok: true });
  }
  const brandRe = /^\/api\/admin\/brands\/([\w.-]+)$/.exec(p);
  if (brandRe) {
    const b = (db.brands || []).find(x => x.id === brandRe[1]);
    if (!b) return sendJson(res, 404, { error: '品牌不存在' });
    if (method === 'PUT') {
      Object.assign(b, {
        label: body.label != null ? body.label : b.label,
        enabled: body.enabled != null ? !!body.enabled : b.enabled,
        order: body.order != null ? Number(body.order) : b.order,
      });
      store.audit(admin.username, 'brand-update', b.id, '更新品牌 ' + b.label);
      store.save();
      return sendJson(res, 200, { ok: true, brand: b });
    }
    if (method === 'DELETE') {
      const used = db.models.filter(m => m.brand === b.id).length;
      if (used) return sendJson(res, 400, { error: '该品牌下还有 ' + used + ' 个模型，请先迁移或删除' });
      db.brands = db.brands.filter(x => x.id !== b.id);
      store.audit(admin.username, 'brand-delete', b.id, '删除品牌');
      store.save();
      return sendJson(res, 200, { ok: true });
    }
  }

  /* ---- 页面区块 ---- */
  if (p === '/api/admin/blocks' && method === 'GET') {
    const page = url.searchParams.get('page') || '';
    const items = Object.values(db.blocks || {})
      .filter(b => (!page || b.page === page))
      .map(b => ({
        key: b.key, page: b.page, scope: b.scope, tag: b.tag, title: b.title, html: b.html,
        len: (b.html || '').length, driver: b.driver || null,
      }));
    return sendJson(res, 200, { items, pages: Object.keys(db.pages || {}) });
  }
  const blockRe = /^\/api\/admin\/blocks\/(.+)$/.exec(p);
  if (blockRe && method === 'PUT') {
    const key = decodeURIComponent(blockRe[1]);
    const b = (db.blocks || {})[key];
    if (!b) return sendJson(res, 404, { error: '区块不存在' });
    if (body.html != null) b.html = String(body.html);
    if (body.title != null) b.title = String(body.title);
    store.audit(admin.username, 'block-update', key, '编辑区块 ' + (b.title || key));
    store.save();
    return sendJson(res, 200, { ok: true });
  }

  /* ---- 公告 ---- */
  if (p === '/api/admin/notice' && method === 'GET') return sendJson(res, 200, db.notice || {});
  if (p === '/api/admin/notice' && method === 'PUT') {
    db.notice = Object.assign({}, db.notice, body);
    store.audit(admin.username, 'notice-update', '公告', '更新模型广场公告');
    store.save();
    return sendJson(res, 200, { ok: true, notice: db.notice });
  }

  /* ---- 站点设置 ---- */
  if (p === '/api/admin/settings' && method === 'GET') return sendJson(res, 200, db.settings || {});
  if (p === '/api/admin/settings' && method === 'PUT') {
    db.settings = Object.assign({}, db.settings, body);
    store.audit(admin.username, 'settings-update', '站点设置', '更新站点设置');
    store.save();
    return sendJson(res, 200, { ok: true, settings: db.settings });
  }

  /* ---- 预览 ---- */
  if (p === '/api/admin/preview' && method === 'GET') {
    const page = url.searchParams.get('page') || 'home';
    return sendJson(res, 200, { html: render.pageHtml(page, db, { userBase: userBaseFor(req) }) });
  }

  /* ---- 用户 ---- */
  if (p === '/api/admin/users' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const status = url.searchParams.get('status') || '';
    let list = (db.users || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (status) list = list.filter(u => u.status === status);
    if (q) list = list.filter(u => textMatch(u, q, ['username', 'email', 'phone', 'id', 'plan']));
    return sendJson(res, 200, paginate(list, url, 20));
  }
  const userRe = /^\/api\/admin\/users\/([\w-]+)$/.exec(p);
  if (userRe) {
    const u = (db.users || []).find(x => x.id === userRe[1]);
    if (!u) return sendJson(res, 404, { error: '用户不存在' });
    if (method === 'PUT') {
      ['plan', 'status', 'note'].forEach(k => { if (body[k] != null) u[k] = body[k]; });
      if (body.balance != null) u.balance = Number(body.balance) || 0;
      store.audit(admin.username, 'user-update', u.username, '更新用户 ' + u.username);
      store.save();
      return sendJson(res, 200, { ok: true, user: u });
    }
    if (method === 'DELETE') {
      db.users = db.users.filter(x => x.id !== u.id);
      store.audit(admin.username, 'user-delete', u.username, '删除用户 ' + u.username);
      store.save();
      return sendJson(res, 200, { ok: true });
    }
  }

  /* ---- 订单 ---- */
  if (p === '/api/admin/orders' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const status = url.searchParams.get('status') || '';
    const users = {};
    (db.users || []).forEach(u => { users[u.id] = u.username; });
    const plat = ((db.platform && db.platform.orders) || []).map(o => ({
      id: o.id, username: users[o.user_id] || o.user_id, plan: '充值 ¥' + o.amount + ' → ' + o.points + ' 积分',
      amount: o.amount, channel: o.channel === 'mock' ? '模拟支付' : '易支付', status: o.status === 'paid' ? 'paid' : (o.status === 'expired' ? 'closed' : 'pending'),
      created_at: o.created_at, paid_at: o.paid_at, source: 'platform', points: o.points,
    }));
    let list = plat.concat(db.orders || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    if (status) list = list.filter(o => o.status === status);
    if (q) list = list.filter(o => textMatch(o, q, ['id', 'username', 'plan', 'channel']));
    return sendJson(res, 200, paginate(list, url, 20));
  }
  const orderRe = /^\/api\/admin\/orders\/([\w-]+)$/.exec(p);
  if (orderRe && method === 'PUT') {
    const o = (db.orders || []).find(x => x.id === orderRe[1]);
    if (!o) return sendJson(res, 404, { error: '订单不存在' });
    if (body.status) o.status = body.status;
    if (body.status === 'refunded') o.refunded_at = nowIso();
    if (body.note != null) o.note = body.note;
    store.audit(admin.username, 'order-update', o.id, '订单 ' + o.id + ' → ' + o.status);
    store.save();
    return sendJson(res, 200, { ok: true, order: o });
  }

  /* ---- 工单 ---- */
  if (p === '/api/admin/tickets' && method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const status = url.searchParams.get('status') || '';
    let list = (db.tickets || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
    if (status) list = list.filter(t => t.status === status);
    if (q) list = list.filter(t => textMatch(t, q, ['id', 'subject', 'body', 'user']));
    return sendJson(res, 200, paginate(list, url, 20));
  }
  const ticketRe = /^\/api\/admin\/tickets\/([\w-]+)(\/reply)?$/.exec(p);
  if (ticketRe) {
    const t = (db.tickets || []).find(x => x.id === ticketRe[1]);
    if (!t) return sendJson(res, 404, { error: '工单不存在' });
    if (ticketRe[2] && method === 'POST') {
      const text = String(body.text || '').trim();
      if (!text) return sendJson(res, 400, { error: '回复内容不能为空' });
      t.messages = t.messages || [];
      t.messages.push({ role: 'admin', at: nowIso(), text, by: admin.username });
      t.status = 'pending';
      store.audit(admin.username, 'ticket-reply', t.id, '回复工单 ' + t.subject);
      store.save();
      return sendJson(res, 200, { ok: true, ticket: t });
    }
    if (method === 'PUT') {
      ['status', 'priority'].forEach(k => { if (body[k] != null) t[k] = body[k]; });
      store.audit(admin.username, 'ticket-update', t.id, '更新工单 ' + t.id);
      store.save();
      return sendJson(res, 200, { ok: true, ticket: t });
    }
  }

  /* ---- 线索 ---- */
  if (p === '/api/admin/leads' && method === 'GET') {
    return sendJson(res, 200, { items: (db.leads || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at)) });
  }
  const leadRe = /^\/api\/admin\/leads\/([\w-]+)$/.exec(p);
  if (leadRe && method === 'PUT') {
    const l = (db.leads || []).find(x => x.id === leadRe[1]);
    if (!l) return sendJson(res, 404, { error: '线索不存在' });
    if (body.status) l.status = body.status;
    store.save();
    return sendJson(res, 200, { ok: true, lead: l });
  }

  /* ---- 管理员 ---- */
  if (p === '/api/admin/admins' && method === 'GET') {
    return sendJson(res, 200, { items: (db.admins || []).map(publicAdmin) });
  }
  if (p === '/api/admin/admins' && method === 'POST') {
    const u = String(body.username || '').trim();
    const pw = String(body.password || '');
    if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(u)) return sendJson(res, 400, { error: '用户名 3-24 位字母数字下划线' });
    if (pw.length < 6) return sendJson(res, 400, { error: '密码至少 6 位' });
    if ((db.admins || []).some(a => a.username === u)) return sendJson(res, 400, { error: '用户名已存在' });
    const a = { id: 'a' + Date.now().toString(36), username: u, nickname: body.nickname || u, role: body.role || 'operator', created_at: nowIso(), last_login: null, enabled: true };
    store.setPwd(a, pw);
    db.admins.push(a);
    store.audit(admin.username, 'admin-create', u, '新增管理员 ' + u);
    store.save();
    return sendJson(res, 200, { ok: true, admin: publicAdmin(a) });
  }
  const adminRe = /^\/api\/admin\/admins\/([\w-]+)$/.exec(p);
  if (adminRe) {
    const a = (db.admins || []).find(x => x.id === adminRe[1]);
    if (!a) return sendJson(res, 404, { error: '管理员不存在' });
    if (method === 'PUT') {
      if (body.nickname != null) a.nickname = body.nickname;
      if (body.role != null) a.role = body.role;
      if (body.enabled != null) {
        if (a.id === admin.id && body.enabled === false) return sendJson(res, 400, { error: '不能禁用当前登录账号' });
        a.enabled = !!body.enabled;
      }
      if (body.password) {
        if (String(body.password).length < 6) return sendJson(res, 400, { error: '密码至少 6 位' });
        store.setPwd(a, String(body.password));
      }
      store.audit(admin.username, 'admin-update', a.username, '更新管理员 ' + a.username);
      store.save();
      return sendJson(res, 200, { ok: true, admin: publicAdmin(a) });
    }
    if (method === 'DELETE') {
      if (a.id === admin.id) return sendJson(res, 400, { error: '不能删除当前登录账号' });
      db.admins = db.admins.filter(x => x.id !== a.id);
      store.audit(admin.username, 'admin-delete', a.username, '删除管理员');
      store.save();
      return sendJson(res, 200, { ok: true });
    }
  }

  /* ---- 用户中心：订阅套餐 ---- */
  if (p === '/api/admin/uc/plans' && method === 'GET') {
    const uc = db.userCenter || {};
    return sendJson(res, 200, { items: uc.plansV2 || [] });
  }
  const planRe = /^\/api\/admin\/uc\/plans\/([\w-]+)$/.exec(p);
  if (planRe) {
    const uc = db.userCenter || {};
    const pl = (uc.plansV2 || []).find(x => x.id === planRe[1]);
    if (!pl) return sendJson(res, 404, { error: '套餐不存在' });
    if (method === 'PUT') {
      ['price', 'name', 'subtitle', 'period', 'daily', 'total', 'concurrency', 'badge'].forEach(k => {
        if (body[k] != null) pl[k] = String(body[k]);
      });
      if (Array.isArray(body.features)) pl.features = body.features.map(String).filter(Boolean);
      if (body.models_count != null) pl.models_count = Number(body.models_count) || 0;
      if (body.visible != null) pl.visible = !!body.visible;
      if (body.category != null) pl.category = String(body.category);
      store.audit(admin.username, 'uc-plan-update', pl.id, '更新套餐 ' + pl.name + ' → ¥' + pl.price);
      store.save();
      return sendJson(res, 200, { ok: true, plan: pl });
    }
  }

  /* ---- 用户中心：页面区块 ---- */
  if (p === '/api/admin/uc/blocks' && method === 'GET') {
    const us = db.userSite || { pages: {}, blocks: {} };
    const page = url.searchParams.get('page') || '';
    const items = Object.values(us.blocks || {})
      .filter(b => (!page || b.page === page))
      .map(b => ({ key: b.key, page: b.page, tag: b.tag, title: b.title, html: b.html, len: (b.html || '').length }));
    return sendJson(res, 200, { items, pages: Object.keys(us.pages || {}) });
  }
  if (p.startsWith('/api/admin/uc/blocks/') && method === 'PUT') {
    const key = decodeURIComponent(p.slice('/api/admin/uc/blocks/'.length));
    const b = (db.userSite && db.userSite.blocks) ? db.userSite.blocks[key] : null;
    if (!b) return sendJson(res, 404, { error: '区块不存在' });
    if (body.html != null) b.html = String(body.html);
    if (body.title != null) b.title = String(body.title);
    store.audit(admin.username, 'uc-block-update', key, '编辑用户中心区块 ' + (b.title || key));
    store.save();
    return sendJson(res, 200, { ok: true });
  }

  /* ---- 用户中心：账户资料 ---- */
  if (p === '/api/admin/uc/profile') {
    const uc = db.userCenter || {};
    if (method === 'GET') return sendJson(res, 200, uc.profile || {});
    if (method === 'PUT') {
      uc.profile = Object.assign({}, uc.profile, {
        username: body.username != null ? String(body.username) : uc.profile.username,
        nickname: body.nickname != null ? String(body.nickname) : uc.profile.nickname,
        email: body.email != null ? String(body.email) : uc.profile.email,
        phone: body.phone != null ? String(body.phone) : uc.profile.phone,
        points: body.points != null ? Number(body.points) : uc.profile.points,
        balance: body.balance != null ? Number(body.balance) : uc.profile.balance,
        plan: body.plan != null ? String(body.plan) : uc.profile.plan,
        note: body.note != null ? String(body.note) : uc.profile.note,
      });
      store.audit(admin.username, 'uc-profile-update', uc.profile.username, '更新用户中心资料');
      store.save();
      return sendJson(res, 200, { ok: true, profile: uc.profile });
    }
  }

  /* ---- 用户中心：兑换码 ---- */
  if (p === '/api/admin/uc/redeem') {
    const uc = db.userCenter || {};
    uc.redeemCodes = uc.redeemCodes || [];
    if (method === 'GET') return sendJson(res, 200, { items: uc.redeemCodes });
    if (method === 'POST') {
      const code = String(body.code || '').trim().toUpperCase();
      if (!code) return sendJson(res, 400, { error: '兑换码不能为空' });
      if (uc.redeemCodes.some(c => c.code === code)) return sendJson(res, 400, { error: '兑换码已存在' });
      const rec = {
        code, plan: body.plan || '无限额度-周订阅-【双并发】', days: Number(body.days) || 7,
        concurrency: Number(body.concurrency) || 2, daily: Number(body.daily) || 0,
        used: false, created_at: new Date().toISOString(),
      };
      uc.redeemCodes.unshift(rec);
      store.audit(admin.username, 'uc-redeem-create', code, '新增兑换码 ' + code);
      store.save();
      return sendJson(res, 200, { ok: true, item: rec });
    }
  }
  const rdRe = /^\/api\/admin\/uc\/redeem\/([\w-]+)$/.exec(p);
  if (rdRe) {
    const uc = db.userCenter || {};
    const rec = (uc.redeemCodes || []).find(c => c.code === rdRe[1]);
    if (!rec) return sendJson(res, 404, { error: '兑换码不存在' });
    if (method === 'DELETE') {
      uc.redeemCodes = uc.redeemCodes.filter(c => c.code !== rdRe[1]);
      store.save();
      return sendJson(res, 200, { ok: true });
    }
    if (method === 'PUT') {
      if (body.used != null) rec.used = !!body.used;
      if (body.plan != null) rec.plan = String(body.plan);
      if (body.days != null) rec.days = Number(body.days);
      store.save();
      return sendJson(res, 200, { ok: true, item: rec });
    }
  }

  /* ---- 用户中心：订阅 / Key ---- */
  if (p === '/api/admin/uc/subscriptions' && method === 'GET') {
    const uc = db.userCenter || {};
    return sendJson(res, 200, { items: uc.subscriptions || [] });
  }
  if (p === '/api/admin/uc/keys' && method === 'GET') {
    const uc = db.userCenter || {};
    return sendJson(res, 200, { items: uc.keys || [] });
  }

  /* ---- 渠道管理 ---- */
  if (p === '/api/admin/channels' && method === 'GET') {
    const items = (db.platform && db.platform.channels) || [];
    return sendJson(res, 200, { items });
  }
  if (p === '/api/admin/channels' && method === 'POST') {
    const d = store.load();
    d.platform = d.platform || {};
    d.platform.channels = d.platform.channels || [];
    const ch = {
      id: 'ch' + Date.now().toString(36),
      name: String(body.name || '新渠道'), type: body.type || 'openai',
      base_url: String(body.base_url || ''), api_key: String(body.api_key || ''),
      models: Array.isArray(body.models) ? body.models : (String(body.models || '*').split(',').map(s2 => s2.trim()).filter(Boolean)),
      weight: Number(body.weight) || 1, enabled: body.enabled !== false,
      status: 'unknown', last_check: null, note: body.note || '',
    };
    d.platform.channels.push(ch);
    store.audit(admin.username, 'channel-create', ch.name, '新增渠道 ' + ch.name);
    store.save();
    return sendJson(res, 200, { ok: true, channel: ch });
  }
  const chRe = /^\/api\/admin\/channels\/([\w-]+)$/.exec(p);
  if (chRe) {
    const d = store.load();
    const ch = (d.platform && d.platform.channels || []).find(c => c.id === chRe[1]);
    if (!ch) return sendJson(res, 404, { error: '渠道不存在' });
    if (method === 'PUT') {
      ['name', 'type', 'base_url', 'api_key', 'enabled', 'weight', 'note', 'status'].forEach(f => { if (body[f] != null) ch[f] = body[f]; });
      if (body.models != null) ch.models = Array.isArray(body.models) ? body.models : String(body.models).split(',').map(s2 => s2.trim()).filter(Boolean);
      store.audit(admin.username, 'channel-update', ch.name, '更新渠道 ' + ch.name);
      store.save();
      return sendJson(res, 200, { ok: true, channel: ch });
    }
    if (method === 'DELETE') {
      d.platform.channels = d.platform.channels.filter(c => c.id !== ch.id);
      store.save();
      return sendJson(res, 200, { ok: true });
    }
  }

  if (p.startsWith('/api/admin/channels/') && p.endsWith('/check') && method === 'POST') {
    const id = p.slice('/api/admin/channels/'.length).replace('/check', '');
    const d = store.load();
    const ch = (d.platform && d.platform.channels || []).find(c => c.id === id);
    if (!ch) return sendJson(res, 404, { error: '渠道不存在' });
    const r = await platform.checkChannel(ch);
    store.save();
    return sendJson(res, 200, { ok: r.ok, channel: ch, result: r });
  }

  /* ---- 调用日志 ---- */
  if (p === '/api/admin/logs' && method === 'GET') {
    const d = store.load();
    const q = url.searchParams.get('q') || '';
    const status = url.searchParams.get('status') || '';
    let list = ((d.platform && d.platform.logs) || []).slice();
    if (status) list = list.filter(l => l.status === status);
    if (q) list = list.filter(l => textMatch(l, q, ['model', 'key_id', 'user_id', 'error']));
    const users = {};
    (d.users || []).forEach(u => { users[u.id] = u.username; });
    list = list.map(l => Object.assign({}, l, { username: users[l.user_id] || l.user_id }));
    return sendJson(res, 200, paginate(list, url, 30));
  }

  /* ---- 在线客服（自建） ---- */
  if (p === '/api/admin/support/threads' && method === 'GET') {
    const sp = db.support || { threads: [] };
    const q = url.searchParams.get('q') || '';
    let list = (sp.threads || []).slice().sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
    if (q) list = list.filter(t => textMatch(t, q, ['id', 'name', 'source']) ||
      (t.messages || []).some(m => String(m.text).toLowerCase().includes(q.toLowerCase())));
    return sendJson(res, 200, { items: list, unread: list.reduce((n, t) => n + (t.unread || 0), 0) });
  }
  const sthRe = /^\/api\/admin\/support\/([\w-]+)(\/reply)?$/.exec(p);
  if (sthRe) {
    const sp = db.support || { threads: [] };
    const t = (sp.threads || []).find(x => x.id === sthRe[1]);
    if (!t) return sendJson(res, 404, { error: '会话不存在' });
    if (sthRe[2] && method === 'POST') {
      const text = String(body.text || '').trim();
      if (!text) return sendJson(res, 400, { error: '回复内容不能为空' });
      t.messages.push({ role: 'agent', text, at: nowIso(), by: admin.username });
      t.unread = 0;
      t.updated_at = nowIso();
      store.audit(admin.username, 'support-reply', t.id, '回复客服会话 ' + t.name);
      store.save();
      return sendJson(res, 200, { ok: true, thread: t });
    }
    if (method === 'PUT') {
      if (body.status) t.status = String(body.status);
      if (body.unread === 0) t.unread = 0;
      store.save();
      return sendJson(res, 200, { ok: true, thread: t });
    }
  }

  /* ---- 审计日志 ---- */
  if (p === '/api/admin/audit' && method === 'GET') {
    return sendJson(res, 200, paginate((db.audit || []).slice(), url, 30));
  }

  /* ---- 流量 ---- */
  if (p === '/api/admin/visits' && method === 'GET') {
    const days = Math.min(90, parseInt(url.searchParams.get('days') || '30', 10) || 30);
    const map = new Map();
    (db.visits || []).forEach(v => {
      if (!map.has(v.day)) map.set(v.day, { day: v.day, pv: 0, uv: 0 });
      const r = map.get(v.day);
      r.pv += v.pv; r.uv += v.uv;
    });
    const list = Array.from(map.values()).sort((a, b) => a.day.localeCompare(b.day)).slice(-days);
    return sendJson(res, 200, { items: list });
  }

  return sendJson(res, 404, { error: '接口不存在' });
};

function publicAdmin(a) {
  return { id: a.id, username: a.username, nickname: a.nickname, role: a.role, enabled: a.enabled, created_at: a.created_at, last_login: a.last_login };
}

function validateModel(m, db, selfId) {
  if (!m.name || !String(m.name).trim()) return '模型名称不能为空';
  if (!m.brand) return '请选择品牌';
  if (!db.brands.some(b => b.id === m.brand)) return '品牌不存在：' + m.brand;
  const dup = db.models.find(x => x.name === m.name && x.id !== selfId);
  if (dup) return '模型名称已存在：' + m.name;
  if (m.price != null && !/^[^<>]{0,40}$/.test(String(m.price))) return '价格文案不合法';
  return '';
}

function normalizeModel(m, db) {
  const tags = Array.isArray(m.tags) ? m.tags.map(t => {
    if (typeof t === 'string') return { cls: '', text: t };
    return { cls: String(t.cls || ''), text: String(t.text || '') };
  }).filter(t => t.text) : [];
  const brand = String(m.brand || '');
  const logo = m.logo !== false;
  return {
    brand,
    name: String(m.name || '').trim(),
    is_new: !!m.is_new,
    has_variants: !!m.has_variants,
    variants: Array.isArray(m.variants) ? m.variants : [],
    tags,
    desc: String(m.desc || ''),
    vendor: m.vendor != null ? String(m.vendor) : brand,
    price: String(m.price || ''),
    price_attrs: m.price_attrs != null ? String(m.price_attrs) : ' title="' + String(m.price || '') + '"',
    logo,
    logo_src: m.logo_src || ('assets/img/brands/' + brand + '.svg'),
    has_refill: m.has_refill !== false,
    refill_attrs: m.refill_attrs != null ? String(m.refill_attrs)
      : ' href="https://a10.yutiankejiai.com/client/" target="_blank" rel="noopener noreferrer" data-tip="去使用无限额度" aria-label="去使用无限额度"',
    refill_html: m.refill_html != null ? String(m.refill_html) : '无限续杯时¥0.00/次<i>限时</i>',
    enabled: m.enabled !== false,
  };
}

function overview(db) {
  const users = db.users || [];
  const orders = db.orders || [];
  const paid = orders.filter(o => o.status === 'paid');
  const revenue = paid.reduce((s, o) => s + Number(o.amount || 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const vs = db.visits || [];
  const todayPv = vs.filter(v => v.day === today).reduce((s, v) => s + v.pv, 0);
  const dayMap = new Map();
  vs.forEach(v => {
    if (!dayMap.has(v.day)) dayMap.set(v.day, { day: v.day, pv: 0, uv: 0 });
    const r = dayMap.get(v.day); r.pv += v.pv; r.uv += v.uv;
  });
  const trend = Array.from(dayMap.values()).sort((a, b) => a.day.localeCompare(b.day)).slice(-14);
  return {
    models: (db.models || []).length,
    models_online: (db.models || []).filter(m => m.enabled !== false).length,
    brands: (db.brands || []).length,
    users: users.length,
    users_active: users.filter(u => u.status === 'active').length,
    orders: orders.length,
    orders_today: orders.filter(o => String(o.created_at).slice(0, 10) === today).length,
    revenue,
    tickets_open: (db.tickets || []).filter(t => t.status !== 'closed').length,
    leads_new: (db.leads || []).filter(l => l.status === 'new').length,
    pv_today: todayPv,
    trend,
    top_models: topModels(db),
    recent_audit: (db.audit || []).slice(0, 8),
    recent_orders: orders.slice(0, 6),
  };
}

function topModels(db) {
  const brands = {};
  (db.models || []).forEach(m => { brands[m.brand] = (brands[m.brand] || 0) + 1; });
  return Object.keys(brands).map(k => ({ brand: k, count: brands[k] })).sort((a, b) => b.count - a.count).slice(0, 6);
}

/* ------------------------------ 用户中心（user 子站） ------------------------------ */
const USER_PORT = Number(process.env.USER_PORT || 8849);

function sendUserHtml(res, code, html) {
  const buf = Buffer.from(html, 'utf8');
  const headers = Object.assign({ 'content-type': 'text/html; charset=UTF-8' }, userSite.USER_SEC_HEADERS);
  const ae = String((res.req && res.req.headers['accept-encoding']) || '');
  if (/\bgzip\b/.test(ae) && buf.length > 512) {
    const gz = zlib.gzipSync(buf, { level: 6 });
    headers['content-encoding'] = 'gzip';
    headers['content-length'] = gz.length;
    res.writeHead(code, headers);
    return res.end(res.req.method === 'HEAD' ? undefined : gz);
  }
  headers['content-length'] = buf.length;
  res.writeHead(code, headers);
  res.end(res.req.method === 'HEAD' ? undefined : buf);
}

async function handleUserSite(req, res, url) {
  const p = url.pathname;
  if (p.startsWith('/assets/')) {
    const rel = p.slice('/assets'.length);
    const own = path.join(PUBLIC, 'user/assets', decodeURIComponent(rel));
    if (fs.existsSync(own)) return serveStatic(req, res, path.join(PUBLIC, 'user/assets'), rel);
    return serveStatic(req, res, path.join(PUBLIC, 'assets'), rel);
  }
  if (url.searchParams.has('ajax')) {
    return userSite.handleAjax(req, res, url, sendJson, readBody);
  }
  const page = userSite.userPageFromUrl(url);
  const u = platform.sessionUser(req);
  if (page === 'login') {
    if (u) { res.writeHead(302, { location: '/' }); return res.end(); }
    const db2 = store.load();
    return sendUserHtml(res, 200, userSite.renderPage('login', db2));
  }
  if (!u) { res.writeHead(302, { location: '/?page=login' }); return res.end(); }
  if (p === '/image/' || p === '/image' || p === '/video/' || p === '/video' || p === '/' || p === '') {
    const db2 = store.load();
    return sendUserHtml(res, 200, userSite.renderPage(page, db2));
  }
  return nginx404(res);
}

/* ------------------------------ 入口 ------------------------------ */
async function handler(req, res) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = url.pathname;
  const host = String(req.headers.host || '').toLowerCase();
  const localPort = req.socket && req.socket.localPort;
  if (p === '/api/public/models' && req.method === 'GET') {
    const db = store.load();
    const brands = {};
    (db.brands || []).forEach(b => { brands[b.id] = b.label; });
    const items = (db.models || []).filter(m => m.enabled !== false).map(m => {
      const pr = m.pricing || {};
      return {
        id: m.name, brand: m.brand, brand_label: brands[m.brand] || m.brand,
        desc: String(m.desc || '').replace(/<[^>]+>/g, ''),
        tags: (m.tags || []).map(t => t.text),
        context_length: m.context_length || 128000,
        modalities: m.modalities || ['text'],
        pricing: { prompt: pr.prompt || 0, completion: pr.completion || 0, request: pr.request || 0, unit: pr.unit || 'points/1M_tokens' },
        is_new: !!m.is_new,
      };
    });
    return sendJson(res, 200, { ok: true, total: items.length, items });
  }

  if (p === '/api/public/leaderboard' && req.method === 'GET') {
    return sendJson(res, 200, { ok: true, items: platform.leaderboard(url.searchParams.get('days') || 30) });
  }

  if (p === '/pricing' || p === '/docs' || p === '/leaderboard') {
    const name = p === '/pricing' ? 'pricing.html' : (p === '/docs' ? 'docs.html' : 'leaderboard.html');
    return serveFile(req, res, path.join(PUBLIC, 'pages', name), true);
  }

  if (p.startsWith('/pay/')) {
    const id = p.slice('/pay/'.length);
    const o = platform.findOrder(id);
    if (!o) return nginx404(res);
    return serveFile(req, res, path.join(PUBLIC, 'pages', 'pay.html'), true);
  }
  if (p.startsWith('/api/pay/mock/') && req.method === 'POST') {
    const id = p.slice('/api/pay/mock/'.length);
    const r = platform.markPaid(id, 'MOCK' + Date.now());
    if (r.error) return sendJson(res, 404, { ok: false, error: r.error });
    return sendJson(res, 200, { ok: true, order: r.order });
  }
  if (p === '/api/pay/notify/epay') {
    // 易支付异步通知：验签后到账
    const q = {};
    url.searchParams.forEach((v, k) => { q[k] = v; });
    const cfg = (store.load().settings || {}).epay || {};
    const sign = q.sign || '';
    const rest = Object.keys(q).filter(k => k !== 'sign' && k !== 'sign_type' && q[k] !== '').sort()
      .map(k => k + '=' + q[k]).join('&');
    const expect = require('crypto').createHash('md5').update(rest + (cfg.key || '')).digest('hex');
    if (cfg.key && sign !== expect) return sendText(res, 400, 'fail');
    if (q.trade_status === 'TRADE_SUCCESS' && q.out_trade_no) platform.markPaid(q.out_trade_no, q.trade_no);
    return sendText(res, 200, 'success');
  }

  if (p === '/playground' || p === '/usage') {
    const u = platform.sessionUser(req);
    if (!u) { res.writeHead(302, { location: userBaseFor(req) + '/?page=login' }); return res.end(); }
    const file = path.join(PUBLIC, 'pages', p === '/playground' ? 'playground.html' : 'usage.html');
    return serveFile(req, res, file, true);
  }

  const isUserHost = /^user\./.test(host) || localPort === USER_PORT;
  if (isUserHost && !p.startsWith('/api/') && !p.startsWith('/v1/')) {
    try { return await handleUserSite(req, res, url); }
    catch (e) {
      console.error('[user error]', p, e && e.stack || e);
      if (!res.headersSent) return nginx404(res);
      return res.end();
    }
  }
  try {
    if (p.startsWith('/api/support/')) return await handleSupport(req, res, url);
    if (p.startsWith('/api/user/')) return await handleUserApi(req, res, url);
    if (p.startsWith('/v1/') || p.startsWith('/api/v1/')) return await handleV1(req, res, url);
    if (p.startsWith('/api/')) return await api(req, res, url);

    if (p.startsWith('/admin/preview/')) {
      if (!currentSession(req)) return sendJson(res, 401, { error: '未登录' });
      const pg = p.slice('/admin/preview/'.length) || 'home';
      const db = store.load();
      return sendHtml(res, 200, render.pageHtml(PAGE_ALIAS[pg] ? pg : 'home', db, { userBase: userBaseFor(req) }), { secure: false });
    }
    if (p === '/admin' || p === '/admin/') return serveStatic(req, res, ADMIN, '/index.html');
    if (p.startsWith('/admin/')) return serveStatic(req, res, ADMIN, p.slice('/admin'.length), true);

    if (p.startsWith('/assets/')) return serveStatic(req, res, path.join(PUBLIC, 'assets'), p.slice('/assets'.length));

    if (p === '/' || p === '') return servePage(req, res, url);

    if (p === '/kefu/widget.js') return serveStatic(req, res, path.join(PUBLIC, 'assets/js'), '/kefu-widget.js');

    if (p === '/healthz') return sendJson(res, 200, { ok: true, ts: nowIso() });

    return nginx404(res);
  } catch (e) {
    console.error('[error]', p, e && e.stack || e);
    if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误' });
    else res.end();
  }
}

const server = http.createServer(handler);
const userServer = http.createServer(handler);

server.listen(PORT, HOST, () => {
  console.log('小小科技镜像站已启动');
  console.log('  前台: http://' + HOST + ':' + PORT + '/');
  console.log('  后台: http://' + HOST + ':' + PORT + '/admin/   (默认 admin / admin123)');
});

setTimeout(() => platform.healthTick().catch(() => {}), 4000);
setInterval(() => platform.healthTick().catch(() => {}), 60000).unref();

userServer.listen(USER_PORT, HOST, () => {
  console.log('  用户中心: http://' + HOST + ':' + USER_PORT + '/   (或 http://user.localhost:' + PORT + '/)');
});

process.on('SIGINT', () => { flushVisits(); process.exit(0); });
process.on('SIGTERM', () => { flushVisits(); process.exit(0); });
