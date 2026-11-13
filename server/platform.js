'use strict';
/**
 * 业务平台层：用户 / 会话 / API Key / 渠道 / 计费 / 用量日志 / OpenAI 兼容转发。
 * 与"页面渲染"解耦，后台与用户中心共用同一套数据。
 */
const crypto = require('crypto');
const store = require('./store');
const adapters = require('./adapters');
const googleAuth = require('./google-auth');

const KEY_PREFIX = 'sk-yt-';

/* ------------------------------ 基础 ------------------------------ */
function now() { return new Date().toISOString(); }

function data() {
  const d = store.load();
  if (!d.platform) d.platform = {};
  const p = d.platform;
  p.users = p.users || [];
  p.keys = p.keys || [];
  p.channels = p.channels || [];
  p.logs = p.logs || [];
  p.orders = p.orders || [];
  p.seq = p.seq || 1;
  if (!p.secret) { p.secret = crypto.randomBytes(32).toString('hex'); store.save(); }
  return { db: d, p };
}

function nextId(p, prefix) { return prefix + (p.seq++).toString(36) + Date.now().toString(36).slice(-4); }

function hashPwd(pwd, salt) { return crypto.scryptSync(String(pwd), salt, 32).toString('hex'); }

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, email: u.email || '',
    balance: Number((Number(u.balance || 0) - Number(u.frozen || 0)).toFixed(6)),
    frozen: Number(u.frozen || 0),
    status: u.status || 'active', role: u.role || 'user', created_at: u.created_at,
    last_login: u.last_login || null, invite_code: u.invite_code || '',
  };
}

/* ------------------------------ 用户 ------------------------------ */
function seedPlatformUsers() {
  const { db, p } = data();
  if (p._seeded) return;
  p._seeded = true;
  // 把后台演示用户升级为可登录的平台用户（统一初始密码 yt123456）
  (db.users || []).forEach(u => {
    if (!u.pwd_salt) {
      const salt = crypto.randomBytes(16).toString('hex');
      u.pwd_salt = salt;
      u.pwd_hash = hashPwd('yt123456', salt);
      u.balance = Number(u.balance) || 0;
      u.status = u.status === 'banned' ? 'banned' : 'active';
      u.role = 'user';
      u.invite_code = u.invite_code || ('INV' + crypto.randomBytes(3).toString('hex').toUpperCase());
    }
  });
  // 演示账号 sham（本次抓取到的控制台账号）
  if (!db.users.some(u => u.username === 'sham')) {
    const salt = crypto.randomBytes(16).toString('hex');
    db.users.push({
      id: 'u-sh...'.replace('...', 'am'), username: 'sham', email: 'sham@example.com',
      pwd_salt: salt, pwd_hash: hashPwd('ioioio000', salt), balance: 0, status: 'active',
      role: 'user', invite_code: 'INVSHAM', created_at: now(), plan: null,
      nickname: 'sham', phone: '',
    });
  }
  // 默认 demo 渠道（内置 mock 上游，开箱即可调用）
  if (!p.channels.length) {
    p.channels.push({
      id: 'ch-demo', name: '内置演示渠道（无需上游 Key）', type: 'mock',
      base_url: '', api_key: '', models: ['*'], weight: 1, enabled: true,
      status: 'ok', last_check: now(), note: '返回模拟回复，用于验证计费与日志链路',
    });
  }
  store.save();
}

function register(username, password, email, inviteCode) {
  seedPlatformUsers();
  const { db, p } = data();
  const name = String(username || '').trim();
  const pwd = String(password || '');
  if (!/^[a-zA-Z0-9_.@-]{3,32}$/.test(name)) return { error: '用户名 3-32 位，仅限字母数字 _ . @ -' };
  if (pwd.length < 6) return { error: '密码至少 6 位' };
  if (db.users.some(u => String(u.username).toLowerCase() === name.toLowerCase())) return { error: '用户名已被注册' };
  const salt = crypto.randomBytes(16).toString('hex');
  const cfg = (db.settings && db.settings.platform) || {};
  let inviter = null, bonus = Number(cfg.new_user_points) || 0;
  if (inviteCode) {
    const inv = db.users.find(u => u.invite_code === String(inviteCode).trim().toUpperCase());
    if (!inv) return { error: '邀请码无效' };
    inviter = inv.id;
    const inviteBonus = Number(cfg.invite_bonus != null ? cfg.invite_bonus : 5);
    bonus = Number(bonus) + inviteBonus;               // 被邀请人得一份
    inv.balance = Number((Number(inv.balance) || 0) + inviteBonus).toFixed(6) * 1; // 邀请人得一份
    if (!p.referrals) p.referrals = [];
    p.referrals.unshift({ at: now(), inviter: inv.id, invitee: name, points: inviteBonus, kind: 'register' });
  }
  const u = {
    id: nextId(p, 'u'), username: name, email: email || '',
    pwd_salt: salt, pwd_hash: hashPwd(pwd, salt),
    balance: bonus, status: 'active', role: 'user',
    invite_code: 'INV' + crypto.randomBytes(3).toString('hex').toUpperCase(),
    inviter, created_at: now(), last_login: now(),
  };
  db.users.push(u);
  store.save();
  return { user: u };
}

function login(username, password) {
  seedPlatformUsers();
  const { db } = data();
  password = String(password == null ? '' : password).trim();
  const u = db.users.find(x => String(x.username).toLowerCase() === String(username || '').trim().toLowerCase());
  if (!u) return { error: '账号或密码错误' };
  if (u.status === 'banned') return { error: '账号已被封禁' };
  const h = hashPwd(password, u.pwd_salt || '');
  if (h !== u.pwd_hash) return { error: '账号或密码错误' };
  u.last_login = now();
  store.save();
  return { user: u };
}

function findUser(id) {
  const { db } = data();
  return db.users.find(u => u.id === id) || null;
}

/* ------------------------------ 会话 ------------------------------ */
const SESSIONS = new Map();
const SESSION_TTL = 1000 * 60 * 60 * 24 * 7;

function issueSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  SESSIONS.set(token, { userId, exp: Date.now() + SESSION_TTL });
  return token;
}

function readSession(token) {
  if (!token) return null;
  const s = SESSIONS.get(token);
  if (!s) return null;
  if (s.exp < Date.now()) { SESSIONS.delete(token); return null; }
  s.exp = Date.now() + SESSION_TTL;
  return s;
}

function sessionUser(req) {
  const cookie = String(req.headers.cookie || '');
  const m = cookie.match(/(?:^|;\s*)ytk_uid=([^;]+)/);
  if (!m) return null;
  const s = readSession(decodeURIComponent(m[1]));
  return s ? findUser(s.userId) : null;
}

function dropSession(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)ytk_uid=([^;]+)/);
  if (m) SESSIONS.delete(decodeURIComponent(m[1]));
}

/* ------------------------------ Key ------------------------------ */
function maskKey(k) {
  const s = String(k || '');
  return s.length <= 14 ? s : s.slice(0, 11) + '••••' + s.slice(-4);
}

function createKey(userId, opts) {
  seedPlatformUsers();
  const { p } = data();
  const o = opts || {};
  const key = {
    id: nextId(p, 'k'), user_id: userId,
    name: String(o.name || '默认密钥').slice(0, 40),
    key: KEY_PREFIX + crypto.randomBytes(24).toString('hex'),
    enabled: true,
    quota: o.quota == null ? 0 : Number(o.quota) || 0,   // 0 = 不限，按用户余额计费
    used: 0,
    models: Array.isArray(o.models) && o.models.length ? o.models : ['*'],
    allowed_ips: Array.isArray(o.allowed_ips) ? o.allowed_ips.filter(Boolean) : [],
    limit_rpm: Number(o.limit_rpm) || 0,
    limit_tpm: Number(o.limit_tpm) || 0,
    expires_at: o.expires_days ? new Date(Date.now() + Number(o.expires_days) * 864e5).toISOString() : null,
    created_at: now(), last_used_at: null,
  };
  p.keys.push(key);
  store.save();
  return key;
}

function listKeys(userId) {
  const { p } = data();
  return p.keys.filter(k => k.user_id === userId);
}

function findKeyBySecret(secret) {
  const { p } = data();
  return p.keys.find(k => k.key === secret) || null;
}

/* ------------------------------ 渠道 ------------------------------ */
function listChannels() {
  const { p } = data();
  return p.channels;
}

/** 候选渠道：按 priority 降序、同优先级按权重加权随机（失败可回退） */
function routeCandidates(model, userGroup) {
  const nowTs = Date.now();
  const list = listChannels().filter(c => {
    if (c.enabled === false) return false;
    if (c.status === 'down' && c.cooldown_until && Number(c.cooldown_until) > nowTs) return false;
    return true;
  });
  let hit = list.filter(c => (c.models || []).includes('*') || (c.models || []).includes(model));
  if (!hit.length) return [];
  // 渠道分组：优先匹配用户所在分组，其次不限分组，最后才用其它分组
  const g = userGroup || 'default';
  const inGroup = hit.filter(c => Array.isArray(c.groups) && c.groups.length && c.groups.indexOf(g) !== -1);
  const anyGroup = hit.filter(c => !Array.isArray(c.groups) || !c.groups.length);
  const otherGroup = hit.filter(c => Array.isArray(c.groups) && c.groups.length && c.groups.indexOf(g) === -1);
  // 分组匹配度作为最高优先级（+1000），再做同层权重随机
  const rank = c => (inGroup.indexOf(c) !== -1 ? 2000 : (anyGroup.indexOf(c) !== -1 ? 1000 : 0));
  const byPriority = {};
  hit.forEach(c => {
    const p = (Number(c.priority) || 0) + rank(c);
    (byPriority[p] = byPriority[p] || []).push(c);
  });
  const out = [];
  Object.keys(byPriority).sort((a, b) => Number(b) - Number(a)).forEach(p => {
    const group = byPriority[p].slice();
    while (group.length) {
      const total = group.reduce((n, c) => n + (Number(c.weight) || 1), 0);
      let r = Math.random() * total;
      let idx = 0;
      for (let i = 0; i < group.length; i++) { r -= (Number(group[i].weight) || 1); if (r <= 0) { idx = i; break; } }
      out.push(group.splice(idx, 1)[0]);
    }
  });
  return out;
}

function pickChannel(model) { return routeCandidates(model)[0] || null; }

/* ------------------------------ 令牌 IP 白名单 ------------------------------ */
function ipToLong(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p2 of parts) {
    const v = Number(p2);
    if (!(v >= 0 && v <= 255)) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

function ipMatch(ip, rule) {
  const r = String(rule || '').trim();
  if (!r) return false;
  if (r === ip) return true;
  if (r.indexOf('/') !== -1) {
    const [base, bitsRaw] = r.split('/');
    const bits = Number(bitsRaw);
    const a = ipToLong(ip);
    const b = ipToLong(base);
    if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (a & mask) === (b & mask);
  }
  // 支持简单通配 10.0.0.*
  if (r.indexOf('*') !== -1) {
    const rx = new RegExp('^' + r.replace(/\./g, '\\.').replace(/\*/g, '\\d{1,3}') + '$');
    return rx.test(ip);
  }
  return false;
}

function keyIpAllowed(key, ip) {
  const list = key && key.allowed_ips;
  if (!Array.isArray(list) || !list.length) return true;
  if (list.some(x => String(x).trim() === '*')) return true;
  return list.some(x => ipMatch(ip, x));
}

/* ------------------------------ 限流 ------------------------------ */
const RATE = new Map();
const AUTH_FAIL_HITS = new Map();
function rateLimit(key, tokens) {
  const now = Date.now();
  const win = 60000;
  const id = key.id;
  let st = RATE.get(id);
  if (!st || now - st.start > win) { st = { start: now, requests: 0, tokens: 0 }; RATE.set(id, st); }
  const rpm = Number(key.limit_rpm) || 0;
  const tpm = Number(key.limit_tpm) || 0;
  if (rpm && st.requests >= rpm) return { ok: false, error: 'Key 每分钟请求数超限（' + rpm + ' RPM）' };
  if (tpm && st.tokens + tokens > tpm) return { ok: false, error: 'Key 每分钟 token 超限（' + tpm + ' TPM）' };
  st.requests += 1;
  st.tokens += tokens;
  return { ok: true };
}

/* ------------------------------ 充值订单与支付 ------------------------------ */
const POINT_PER_YUAN = 10;      // 1 元 = 10 积分
const BONUS_RATE = 0.10;        // 充值赠送 10%

function rechargePlans() {
  return [50, 100, 200, 500].map(y => ({
    yuan: y, points: Math.round(y * POINT_PER_YUAN * (1 + BONUS_RATE)),
    bonus: Math.round(y * POINT_PER_YUAN * BONUS_RATE),
  }));
}

function createOrder(userId, yuan) {
  const { p } = data();
  const amount = Number(yuan) || 0;
  if (!rechargePlans().some(x => x.yuan === amount)) {
    return { error: '不支持的充值金额' };
  }
  const plan = rechargePlans().find(x => x.yuan === amount);
  const order = {
    id: 'R' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6).toUpperCase(),
    user_id: userId, type: 'recharge', amount, points: plan.points,
    status: 'pending', channel: 'mock', trade_no: '', created_at: now(), paid_at: null,
  };
  p.orders.unshift(order);
  store.save();
  return { order };
}

function findOrder(id) {
  const { p } = data();
  return (p.orders || []).find(o => o.id === id) || null;
}

function markPaid(orderId, tradeNo) {
  const { db, p } = data();
  const o = findOrder(orderId);
  if (!o) return { error: '订单不存在' };
  if (o.status === 'paid') return { order: o, duplicated: true };
  o.status = 'paid';
  o.paid_at = now();
  o.trade_no = tradeNo || ('MOCK' + Date.now());
  const u = db.users.find(x => x.id === o.user_id);
  if (u) u.balance = Number((Number(u.balance || 0) + o.points).toFixed(6));
  // 邀请返利：被邀请人充值，邀请人按比例获得积分
  if (u && u.inviter) {
    const cfg = (db.settings && db.settings.platform) || {};
    const rate = Number(cfg.referral_rate != null ? cfg.referral_rate : 10) / 100;
    const reward = Number((o.points * rate).toFixed(6));
    if (reward > 0) {
      const inviter = db.users.find(x => x.id === u.inviter);
      if (inviter) {
        inviter.balance = Number((Number(inviter.balance || 0) + reward).toFixed(6));
        p.referrals = p.referrals || [];
        p.referrals.unshift({ at: now(), inviter: inviter.id, invitee: u.username, points: reward, kind: 'recharge', base: o.points, rate: rate * 100 });
        addNotification(inviter.id, '邀请返利到账', '好友 ' + u.username + ' 充值 ¥' + o.amount + '，你获得 ' + reward + ' 积分返利。', 'referral');
      }
    }
  }
  addLog({ user_id: o.user_id, key_id: '', model: '充值', status: 'success', cost: -o.points, ms: 0, note: '充值 ' + o.amount + ' 元 → ' + o.points + ' 积分' });
  store.save();
  return { order: o };
}

/* ------------------------------ 渠道健康检查 ------------------------------ */
const HEALTH = { checking: false, lastRun: null };
async function checkChannel(ch) {
  if (!ch || ch.type === 'mock') { if (ch) { ch.status = 'ok'; ch.last_check = now(); ch.fail_count = 0; } return { ok: true }; }
  if (!ch.base_url) return { ok: false, error: '未配置上游地址' };
  const t0 = Date.now();
  try {
    const r = await fetch(String(ch.base_url).replace(/\/$/, '') + '/v1/models', {
      headers: { authorization: 'Bearer ' + ch.api_key },
      signal: AbortSignal.timeout ? AbortSignal.timeout(Number(ch.timeout_ms) || 8000) : undefined,
    });
    ch.last_check = now();
    ch.latency_ms = Date.now() - t0;
    if (r.ok) { ch.status = 'ok'; ch.fail_count = 0; ch.cooldown_until = null; return { ok: true, latency: ch.latency_ms }; }
    ch.fail_count = (ch.fail_count || 0) + 1;
    ch.status = ch.fail_count >= 3 ? 'down' : 'warn';
    if (ch.status === 'down') ch.cooldown_until = Date.now() + 5 * 60000;
    return { ok: false, error: 'HTTP ' + r.status };
  } catch (e) {
    ch.last_check = now();
    ch.fail_count = (ch.fail_count || 0) + 1;
    ch.status = ch.fail_count >= 3 ? 'down' : 'warn';
    if (ch.status === 'down') ch.cooldown_until = Date.now() + 5 * 60000;
    return { ok: false, error: e.message };
  }
}

async function healthTick() {
  if (HEALTH.checking) return;
  HEALTH.checking = true;
  try {
    const list = listChannels().filter(c => c.enabled !== false && c.type !== 'mock');
    for (const ch of list) await checkChannel(ch);
    HEALTH.lastRun = now();
    store.save();
  } finally { HEALTH.checking = false; }
}

/* ------------------------------ 计费 ------------------------------ */
function modelPricing(model) {
  const { db } = data();
  const m = (db.models || []).find(x => x.name === model);
  if (!m) return { prompt: 1000, completion: 1000, request: 0.01, unit: 'points/1M_tokens' };
  if (m.pricing) return m.pricing;
  const n = String(m.price || '').match(/(\d+(?:\.\d+)?)/);
  const per = n ? Number(n[1]) : 1;
  return { prompt: per * 1000, completion: per * 1000, request: per * 0.02, unit: 'points/1M_tokens' };
}

/** 按 token 计费：固定请求费 + 输入/输出 token 单价 */
function computeCost(model, usage) {
  const pr = modelPricing(model);
  const pt = Number(usage && usage.prompt_tokens) || 0;
  const ct = Number(usage && usage.completion_tokens) || 0;
  const cost = (Number(pr.request) || 0)
    + pt / 1e6 * (Number(pr.prompt) || 0)
    + ct / 1e6 * (Number(pr.completion) || 0);
  return Number(cost.toFixed(6));
}

/** 兼容旧调用 */
function modelPrice(model) { return Number(modelPricing(model).request) || 0.01; }

/* ------------------------------ 日志 ------------------------------ */
const BODY_LIMIT = 8000;

/** 记录用截断：超长内容保留头尾，避免数据库膨胀 */
function capBody(v) {
  if (v == null) return '';
  let str = typeof v === 'string' ? v : safeJson(v);
  if (str.length <= BODY_LIMIT) return str;
  return str.slice(0, BODY_LIMIT - 200) + '\n…（已截断，共 ' + str.length + ' 字符）';
}

function safeJson(v) {
  try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); }
}

/** 简单脱敏：api key / 密码类字段 */
function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  Object.keys(obj).forEach(k => {
    const v = obj[k];
    if (/^(api_key|api_secret|authorization|password|key|secret|token)$/i.test(k)) out[k] = '***';
    else if (v && typeof v === 'object') out[k] = redact(v);
    else out[k] = v;
  });
  return out;
}

function logBodiesEnabled() {
  const { db } = data();
  const v = db.settings && db.settings.platform && db.settings.platform.log_bodies;
  return v === undefined ? true : !!v;
}

let SAVE_TIMER = null;
/** 合并写盘：200ms 内的多次变更只落盘一次，兼顾吞吐与持久化 */
function scheduleSave() {
  if (SAVE_TIMER) return;
  SAVE_TIMER = setTimeout(() => {
    SAVE_TIMER = null;
    try { store.save(); } catch (e) { /* ignore */ }
  }, 200);
  if (SAVE_TIMER.unref) SAVE_TIMER.unref();
}

function addLog(row) {
  const { p } = data();
  p.logs.unshift(Object.assign({ id: nextId(p, 'l'), at: now() }, row));
  if (p.logs.length > 2000) p.logs.length = 2000;
  scheduleSave();
}

function listLogs(filter) {
  const { p } = data();
  const f = filter || {};
  let list = p.logs.slice();
  if (f.user_id) list = list.filter(l => l.user_id === f.user_id);
  if (f.key_id) list = list.filter(l => l.key_id === f.key_id);
  if (f.status) list = list.filter(l => l.status === f.status);
  if (f.model) list = list.filter(l => l.model === f.model);
  if (f.since) list = list.filter(l => l.at >= f.since);
  return list;
}

/* ------------------------------ 转发 ------------------------------ */
function mockCompletion(model, messages, stream) {
  const last = (messages || []).slice(-1)[0];
  const q = last && last.content ? String(last.content).slice(0, 200) : '';
  const answer = `（演示渠道）已收到对 ${model} 的请求。你的问题：${q || '（空）'}。` +
    '当前为内置模拟上游，接入真实渠道后此处会返回真实模型输出。';
  const id = 'chatcmpl-' + crypto.randomBytes(8).toString('hex');
  const created = Math.floor(Date.now() / 1000);
  if (!stream) {
    return {
      id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }],
      usage: { prompt_tokens: Math.max(1, Math.ceil(q.length / 2)), completion_tokens: Math.ceil(answer.length / 2), total_tokens: 0 },
    };
  }
  const chunks = [];
  const pieces = answer.match(/[\s\S]{1,12}/g) || [];
  pieces.forEach((p, i) => {
    chunks.push('data: ' + JSON.stringify({
      id, object: 'chat.completion.chunk', created, model,
      choices: [{ index: 0, delta: i === 0 ? { role: 'assistant', content: p } : { content: p }, finish_reason: null }],
    }) + '\n\n');
  });
  chunks.push('data: ' + JSON.stringify({
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  }) + '\n\n');
  chunks.push('data: [DONE]\n\n');
  return chunks;
}

/**
 * 核心：鉴权 → 选渠道 → 转发/模拟 → 计费 → 记日志
 * 返回 { ok, data } 或 { ok:false, status, error }
 */
async function relayChat(secret, body, clientIp, opts) {
  seedPlatformUsers();
  const { db } = data();
  const started = Date.now();
  const key = findKeyBySecret(secret);
  if (!key) {
    const k = 'authfail:' + String(clientIp || '') + ':' + Math.floor(Date.now() / 60000);
    const n = (AUTH_FAIL_HITS.get(k) || 0) + 1;
    AUTH_FAIL_HITS.set(k, n);
    if (AUTH_FAIL_HITS.size > 500) AUTH_FAIL_HITS.clear();
    if (n <= 5) {
      addLog({
        user_id: 'anonymous', key_id: '', model: String((body && body.model) || '').slice(0, 60),
        status: 'error', cost: 0, ms: Date.now() - started,
        error: '无效的 API Key（' + String(secret || '').slice(0, 8) + '…）',
        kind: 'auth_fail', client_ip: clientIp || '',
      });
    }
    return { ok: false, status: 401, error: '无效的 API Key', type: 'invalid_api_key' };
  }
  if (key.enabled === false) return { ok: false, status: 403, error: 'API Key 已被停用', type: 'key_disabled' };
  if (!keyIpAllowed(key, clientIp)) {
    addLog({ user_id: key.user_id, key_id: key.id, model: body.model || '', status: 'error', cost: 0, ms: 0, error: 'IP 不在白名单：' + (clientIp || 'unknown') });
    return { ok: false, status: 403, error: '当前 IP（' + (clientIp || 'unknown') + '）不在该 Key 的白名单内', type: 'ip_forbidden' };
  }
  if (key.expires_at && new Date(key.expires_at) < new Date()) return { ok: false, status: 403, error: 'API Key 已过期', type: 'key_expired' };
  const user = findUser(key.user_id);
  if (!user || user.status === 'banned') return { ok: false, status: 403, error: '账号不可用', type: 'account_disabled' };

  const model = String((body && body.model) || '').trim();
  if (!model) return { ok: false, status: 400, error: '缺少 model 参数', type: 'invalid_request' };
  if (Array.isArray(key.models) && key.models.length && !key.models.includes('*') && !key.models.includes(model)) {
    return { ok: false, status: 403, error: '该 Key 未授权使用模型 ' + model, type: 'model_forbidden' };
  }

  const pr = modelPricing(model);
  const balance = Number(user.balance) || 0;
  const frozen = Number(user.frozen) || 0;
  const estTokens = Math.ceil(JSON.stringify(body.messages || '').length / 3);
  const groupR = groupRatio(user);
  const estCost = Number((((Number(pr.request) || 0) + estTokens / 1e6 * (Number(pr.prompt) || 0)) * (groupR || 1)).toFixed(6));
  const limit = rateLimit(key, estTokens);
  if (!limit.ok) {
    addLog({ user_id: user.id, key_id: key.id, model, status: 'error', cost: 0, ms: Date.now() - started, error: limit.error });
    return { ok: false, status: 429, error: limit.error, type: 'rate_limited' };
  }
  if (key.quota > 0) {
    if (key.used >= key.quota) return { ok: false, status: 402, error: 'Key 额度已用尽', type: 'quota_exceeded' };
  } else if (balance - frozen < estCost) {
    return { ok: false, status: 402, error: '积分余额不足（可用 ' + (balance - frozen).toFixed(4) + '，预估需要 ' + estCost + '）', type: 'insufficient_quota' };
  }
  // 预扣：先冻结预估费用，返回后按实际结算
  if (key.quota <= 0) user.frozen = Number((frozen + estCost).toFixed(6));

  const stream = !!(body && body.stream);
  const candidates = routeCandidates(model, user.group);
  let payload = null, usage = null, usedChannel = null, lastErr = '';

  const settle = (u, ch, respText) => {
    const pt = Number(u && u.prompt_tokens) || 0;
    const ct = Number(u && u.completion_tokens) || 0;
    const baseCost = computeCost(model, { prompt_tokens: pt, completion_tokens: ct });
    const ratio = groupRatio(user);
    const free = !!(opts && opts.free);
    const cost = free ? 0 : Number((baseCost * (ratio || 0)).toFixed(6));
    if (free) { /* 管理员重放不计费 */ }
    else if (key.quota > 0) key.used += 1;
    else if (!free) {
      user.frozen = Number(Math.max(0, (Number(user.frozen) || 0) - estCost).toFixed(6));
      user.balance = Number((Number(user.balance) - cost).toFixed(6));
    }
    key.last_used_at = now();
    const withBodies = logBodiesEnabled();
    addLog(Object.assign({
      user_id: user.id, key_id: key.id, model,
      status: 'success', cost, ms: Date.now() - started,
      prompt_tokens: pt, completion_tokens: ct,
      channel: ch ? ch.name : 'unknown',
      stream: !!stream,
      replay_of: (opts && opts.replayOf) || null,
      kind: (opts && opts.replayOf) ? 'replay' : undefined,
    }, withBodies ? {
      request_body: capBody(redact(body)),
      response_body: capBody(respText || ''),
      req_bytes: Buffer.byteLength(safeJson(body)),
      resp_bytes: Buffer.byteLength(String(respText || '')),
      client_ip: clientIp || '',
    } : {}));
    scheduleSave();
    return cost;
  };

  for (const channel of candidates) {
    if (channel.type === 'mock') {
      payload = mockCompletion(model, body.messages || [], stream);
      usage = stream ? { prompt_tokens: Math.ceil(estTokens), completion_tokens: 120 } : payload.usage;
      usedChannel = channel;
      break;
    }
    if (!channel.base_url) continue;
    if (channel.type === 'vertex' && channel.service_account) {
      try { channel.__access_token = await googleAuth.getAccessToken(channel.id, channel.service_account); }
      catch (e) { /* 换取失败则回退到 api_key */ delete channel.__access_token; }
    }
    const adapter = adapters.forType(channel.type);
    const req = adapter.buildRequest(channel, model, body, stream);
    try {
      const upstream = await fetch(req.url, Object.assign({}, req.options, {
        signal: AbortSignal.timeout ? AbortSignal.timeout(Number(channel.timeout_ms) || 60000) : undefined,
      }));
      if (!upstream.ok) {
        lastErr = '上游 ' + channel.name + ' 返回 ' + upstream.status;
        channel.status = 'warn';
        continue;
      }
      channel.status = 'ok';
      channel.last_check = now();
      if (stream) {
        return {
          ok: true, stream: true, upstreamRes: upstream, adapter,
          ctx: { id: 'chatcmpl-' + Date.now(), created: Math.floor(Date.now() / 1000), model, usage: {}, finished: false },
          settle: (u) => settle(u, channel),
          channelName: channel.name,
        };
      }
      const raw = await upstream.json();
      payload = adapter.parseResponse(raw, model);
      usage = payload.usage || {};
      usedChannel = channel;
      break;
    } catch (e) {
      lastErr = '上游 ' + channel.name + ' 不可达：' + e.message;
      channel.status = 'warn';
    }
  }

  if (!payload) {
    if (key.quota <= 0) user.frozen = Number(Math.max(0, (Number(user.frozen) || 0) - estCost).toFixed(6));
    addLog({ user_id: user.id, key_id: key.id, model, status: 'error', cost: 0, ms: Date.now() - started, error: (lastErr || '无可用渠道').slice(0, 200),
      request_body: logBodiesEnabled() ? capBody(redact(body)) : '', client_ip: clientIp || '' });
    return { ok: false, status: 502, error: lastErr || '无可用渠道', type: 'upstream_error' };
  }

  if (Array.isArray(payload)) {
    const cost = settle(usage, usedChannel, payload.join(''));
    return { ok: true, data: payload, stream: true, usage, cost, channel: usedChannel ? usedChannel.name : '' };
  }

  const cost = settle(usage, usedChannel, safeJson(payload));
  return { ok: true, data: payload, stream: false, usage, cost, channel: usedChannel ? usedChannel.name : '' };
}

/** 用量统计：按天 / 按模型 / 按 Key */
function usageStats(userId, days) {
  const d = Math.min(90, Number(days) || 14);
  const logs = listLogs({ user_id: userId }).filter(l => {
    if (l.model === '充值' || l.kind === 'recharge') return false;
    const t = new Date(l.at).getTime();
    return Date.now() - t <= d * 864e5;
  });
  const byDay = {};
  const byModel = {};
  const byKey = {};
  let tokens = 0, cost = 0, calls = 0, errors = 0;
  logs.forEach(l => {
    const day = l.at.slice(0, 10);
    if (!byDay[day]) byDay[day] = { day, calls: 0, tokens: 0, cost: 0 };
    byDay[day].calls += 1;
    byDay[day].tokens += (l.prompt_tokens || 0) + (l.completion_tokens || 0);
    byDay[day].cost += Number(l.cost) || 0;
    if (!byModel[l.model]) byModel[l.model] = { model: l.model, calls: 0, tokens: 0, cost: 0 };
    byModel[l.model].calls += 1;
    byModel[l.model].tokens += (l.prompt_tokens || 0) + (l.completion_tokens || 0);
    byModel[l.model].cost += Number(l.cost) || 0;
    if (!byKey[l.key_id]) byKey[l.key_id] = { key_id: l.key_id, calls: 0, cost: 0 };
    byKey[l.key_id].calls += 1;
    byKey[l.key_id].cost += Number(l.cost) || 0;
    tokens += (l.prompt_tokens || 0) + (l.completion_tokens || 0);
    cost += Number(l.cost) || 0;
    calls += 1;
    if (l.status !== 'success') errors += 1;
  });
  return {
    days: d, calls, tokens, cost: Number(cost.toFixed(4)), errors,
    by_day: Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day)),
    by_model: Object.values(byModel).sort((a, b) => b.cost - a.cost).slice(0, 12),
    by_key: Object.values(byKey).sort((a, b) => b.cost - a.cost),
  };
}

/** embeddings：mock 返回确定性向量；有上游则转发 */
async function relayEmbeddings(secret, body, clientIp) {
  seedPlatformUsers();
  const { db } = data();
  const started = Date.now();
  const key = findKeyBySecret(secret);
  if (!key) {
    const k = 'authfail:' + String(clientIp || '') + ':' + Math.floor(Date.now() / 60000);
    const n = (AUTH_FAIL_HITS.get(k) || 0) + 1;
    AUTH_FAIL_HITS.set(k, n);
    if (AUTH_FAIL_HITS.size > 500) AUTH_FAIL_HITS.clear();
    if (n <= 5) {
      addLog({
        user_id: 'anonymous', key_id: '', model: String((body && body.model) || '').slice(0, 60),
        status: 'error', cost: 0, ms: Date.now() - started,
        error: '无效的 API Key（' + String(secret || '').slice(0, 8) + '…）',
        kind: 'auth_fail', client_ip: clientIp || '',
      });
    }
    return { ok: false, status: 401, error: '无效的 API Key', type: 'invalid_api_key' };
  }
  if (key.enabled === false) return { ok: false, status: 403, error: 'API Key 已被停用', type: 'key_disabled' };
  if (!keyIpAllowed(key, clientIp)) {
    addLog({ user_id: key.user_id, key_id: key.id, model: body.model || '', status: 'error', cost: 0, ms: 0, error: 'IP 不在白名单：' + (clientIp || 'unknown') });
    return { ok: false, status: 403, error: '当前 IP（' + (clientIp || 'unknown') + '）不在该 Key 的白名单内', type: 'ip_forbidden' };
  }
  const user = findUser(key.user_id);
  if (!user || user.status === 'banned') return { ok: false, status: 403, error: '账号不可用', type: 'account_disabled' };
  const model = String(body.model || 'text-embedding-3-small');
  const input = body.input;
  const texts = Array.isArray(input) ? input : [input];
  if (!texts.length || texts.some(t => typeof t !== 'string')) return { ok: false, status: 400, error: 'input 必须是字符串或字符串数组', type: 'invalid_request' };
  const tokens = texts.reduce((n, t) => n + Math.ceil(String(t).length / 4), 0);
  const pr = modelPricing(model);
  const cost = Number(((Number(pr.request) || 0) * texts.length + tokens / 1e6 * (Number(pr.prompt) || 0)).toFixed(6));
  const balance = Number(user.balance) || 0;
  if (balance - (Number(user.frozen) || 0) < cost) return { ok: false, status: 402, error: '积分余额不足', type: 'insufficient_quota' };

  function detVec(text, dim) {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
    const out = [];
    for (let i = 0; i < dim; i++) {
      h = Math.imul(h ^ (i + 1), 16777619);
      out.push((((h >>> 0) % 20000) / 10000) - 1);
    }
    const norm = Math.sqrt(out.reduce((s2, v) => s2 + v * v, 0)) || 1;
    return out.map(v => Number((v / norm).toFixed(6)));
  }
  const data2 = texts.map((t, i) => ({ object: 'embedding', index: i, embedding: detVec(String(t), 512) }));
  user.balance = Number((balance - cost).toFixed(6));
  key.last_used_at = now();
  addLog({ user_id: user.id, key_id: key.id, model, status: 'success', cost, ms: Date.now() - started, prompt_tokens: tokens, completion_tokens: 0, kind: 'embeddings' });
  scheduleSave();
  return { ok: true, data: { object: 'list', data: data2, model, usage: { prompt_tokens: tokens, total_tokens: tokens } } };
}

/** images：mock 返回 SVG data URL；有上游则转发 */
async function relayImages(secret, body, clientIp) {
  seedPlatformUsers();
  const { db } = data();
  const started = Date.now();
  const key = findKeyBySecret(secret);
  if (!key) {
    const k = 'authfail:' + String(clientIp || '') + ':' + Math.floor(Date.now() / 60000);
    const n = (AUTH_FAIL_HITS.get(k) || 0) + 1;
    AUTH_FAIL_HITS.set(k, n);
    if (AUTH_FAIL_HITS.size > 500) AUTH_FAIL_HITS.clear();
    if (n <= 5) {
      addLog({
        user_id: 'anonymous', key_id: '', model: String((body && body.model) || '').slice(0, 60),
        status: 'error', cost: 0, ms: Date.now() - started,
        error: '无效的 API Key（' + String(secret || '').slice(0, 8) + '…）',
        kind: 'auth_fail', client_ip: clientIp || '',
      });
    }
    return { ok: false, status: 401, error: '无效的 API Key', type: 'invalid_api_key' };
  }
  if (key.enabled === false) return { ok: false, status: 403, error: 'API Key 已被停用', type: 'key_disabled' };
  if (!keyIpAllowed(key, clientIp)) {
    addLog({ user_id: key.user_id, key_id: key.id, model: body.model || '', status: 'error', cost: 0, ms: 0, error: 'IP 不在白名单：' + (clientIp || 'unknown') });
    return { ok: false, status: 403, error: '当前 IP（' + (clientIp || 'unknown') + '）不在该 Key 的白名单内', type: 'ip_forbidden' };
  }
  const user = findUser(key.user_id);
  if (!user || user.status === 'banned') return { ok: false, status: 403, error: '账号不可用', type: 'account_disabled' };
  const model = String(body.model || 'image-gen-1');
  const prompt = String(body.prompt || '').slice(0, 2000);
  const n = Math.min(4, Math.max(1, Number(body.n) || 1));
  if (!prompt) return { ok: false, status: 400, error: 'prompt 不能为空', type: 'invalid_request' };
  const pr = modelPricing(model);
  const cost = Number(((Number(pr.request) || 0.01) * n + Number(pr.prompt || 0) / 1e6).toFixed(6));
  const balance = Number(user.balance) || 0;
  if (balance - (Number(user.frozen) || 0) < cost) return { ok: false, status: 402, error: '积分余额不足', type: 'insufficient_quota' };
  const svg = function (i) {
    const t = prompt.replace(/[<>&]/g, '');
    return 'data:image/svg+xml;base64,' + Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#0b1220"/>' +
      '<text x="256" y="240" fill="#22d3ee" font-size="20" text-anchor="middle" font-family="sans-serif">' + t.slice(0, 28) + '</text>' +
      '<text x="256" y="280" fill="#6d829c" font-size="14" text-anchor="middle" font-family="sans-serif">demo image ' + (i + 1) + '/' + n + '</text></svg>'
    ).toString('base64');
  };
  const data2 = Array.from({ length: n }).map((_, i) => ({ url: svg(i), revised_prompt: prompt }));
  user.balance = Number((balance - cost).toFixed(6));
  key.last_used_at = now();
  addLog({ user_id: user.id, key_id: key.id, model, status: 'success', cost, ms: Date.now() - started, prompt_tokens: 0, completion_tokens: 0, kind: 'images', images: n });
  scheduleSave();
  return { ok: true, data: { created: Math.floor(Date.now() / 1000), data: data2 } };
}

/* ------------------------------ 音频 / 重排 ------------------------------ */
/** 生成一段可播放的 WAV（正弦波，长度按文本估算），用于 mock 上游 */
function makeWav(text) {
  const seconds = Math.min(6, Math.max(0.6, String(text || '').length / 24));
  const rate = 16000;
  const samples = Math.floor(rate * seconds);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const v = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.08 * 32767;
    buf.writeInt16LE(Math.round(v), 44 + i * 2);
  }
  return buf;
}

async function relaySpeech(secret, body, clientIp) {
  seedPlatformUsers();
  const { db } = data();
  const started = Date.now();
  const key = findKeyBySecret(secret);
  if (!key) {
    const k = 'authfail:' + String(clientIp || '') + ':' + Math.floor(Date.now() / 60000);
    const n = (AUTH_FAIL_HITS.get(k) || 0) + 1;
    AUTH_FAIL_HITS.set(k, n);
    if (AUTH_FAIL_HITS.size > 500) AUTH_FAIL_HITS.clear();
    if (n <= 5) {
      addLog({
        user_id: 'anonymous', key_id: '', model: String((body && body.model) || '').slice(0, 60),
        status: 'error', cost: 0, ms: Date.now() - started,
        error: '无效的 API Key（' + String(secret || '').slice(0, 8) + '…）',
        kind: 'auth_fail', client_ip: clientIp || '',
      });
    }
    return { ok: false, status: 401, error: '无效的 API Key', type: 'invalid_api_key' };
  }
  if (key.enabled === false) return { ok: false, status: 403, error: 'API Key 已被停用', type: 'key_disabled' };
  if (!keyIpAllowed(key, clientIp)) return { ok: false, status: 403, error: 'IP 不在白名单内', type: 'ip_forbidden' };
  const user = findUser(key.user_id);
  if (!user || user.status === 'banned') return { ok: false, status: 403, error: '账号不可用', type: 'account_disabled' };
  const model = String(body.model || 'tts-1');
  const input = String(body.input || '').slice(0, 4000);
  if (!input) return { ok: false, status: 400, error: 'input 不能为空', type: 'invalid_request' };
  const chars = input.length;
  const pr = modelPricing(model);
  const cost = Number(((Number(pr.request) || 0.01) + chars / 1000 * (Number(pr.prompt) || 0) / 1000).toFixed(6));
  const bal = Number(user.balance) || 0;
  if (bal - (Number(user.frozen) || 0) < cost) return { ok: false, status: 402, error: '积分余额不足', type: 'insufficient_quota' };

  const ch = routeCandidates(model, user.group).find(c => c.type !== 'mock' && c.base_url);
  let audio = null;
  let usedChannel = 'mock';
  if (ch) {
    try {
      const r = await fetch(String(ch.base_url).replace(/\/$/, '') + '/v1/audio/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + ch.api_key },
        body: JSON.stringify(Object.assign({}, body, { model: (ch.model_map && ch.model_map[model]) || model })),
      });
      if (r.ok) { audio = Buffer.from(await r.arrayBuffer()); usedChannel = ch.name; }
    } catch (e) { /* 回退 mock */ }
  }
  if (!audio) { audio = makeWav(input); usedChannel = ch ? (ch.name + '（回退）') : 'mock'; }

  user.balance = Number((bal - cost).toFixed(6));
  key.last_used_at = now();
  addLog({ user_id: user.id, key_id: key.id, model, status: 'success', cost, ms: Date.now() - started, prompt_tokens: chars, completion_tokens: 0, kind: 'speech', channel: usedChannel });
  scheduleSave();
  return { ok: true, audio, contentType: 'audio/wav' };
}

function parseMultipart(raw, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const boundary = '--' + (m[1] || m[2]).trim();
  const parts = [];
  let idx = raw.indexOf(boundary);
  while (idx !== -1) {
    const start = idx + boundary.length + 2;
    const next = raw.indexOf(boundary, start);
    if (next === -1) break;
    const chunk = raw.slice(start, next - 2);
    const sep = chunk.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const head = chunk.slice(0, sep).toString('utf8');
      const bodyBuf = chunk.slice(sep + 4);
      const nameM = /name="([^"]+)"/.exec(head);
      parts.push({ name: nameM ? nameM[1] : '', headers: head, data: bodyBuf });
    }
    idx = next;
  }
  return parts;
}

async function relayTranscription(secret, raw, contentType, clientIp) {
  seedPlatformUsers();
  const { db } = data();
  const started = Date.now();
  const key = findKeyBySecret(secret);
  if (!key) {
    const k = 'authfail:' + String(clientIp || '') + ':' + Math.floor(Date.now() / 60000);
    const n = (AUTH_FAIL_HITS.get(k) || 0) + 1;
    AUTH_FAIL_HITS.set(k, n);
    if (AUTH_FAIL_HITS.size > 500) AUTH_FAIL_HITS.clear();
    if (n <= 5) {
      addLog({
        user_id: 'anonymous', key_id: '', model: String((body && body.model) || '').slice(0, 60),
        status: 'error', cost: 0, ms: Date.now() - started,
        error: '无效的 API Key（' + String(secret || '').slice(0, 8) + '…）',
        kind: 'auth_fail', client_ip: clientIp || '',
      });
    }
    return { ok: false, status: 401, error: '无效的 API Key', type: 'invalid_api_key' };
  }
  if (key.enabled === false) return { ok: false, status: 403, error: 'API Key 已被停用', type: 'key_disabled' };
  if (!keyIpAllowed(key, clientIp)) return { ok: false, status: 403, error: 'IP 不在白名单内', type: 'ip_forbidden' };
  const user = findUser(key.user_id);
  if (!user || user.status === 'banned') return { ok: false, status: 403, error: '账号不可用', type: 'account_disabled' };

  let model = 'whisper-1';
  let fileSize = 0;
  const isJson = /application\/json/i.test(contentType || '');
  if (isJson) {
    let b = {}; try { b = JSON.parse(raw.toString('utf8')); } catch (e) {}
    model = String(b.model || model);
    fileSize = Buffer.byteLength(String(b.file || b.audio || ''));
  } else {
    const parts = parseMultipart(raw, contentType) || [];
    const file = parts.find(p => p.name === 'file');
    const mdl = parts.find(p => p.name === 'model');
    if (mdl) model = mdl.data.toString('utf8').trim() || model;
    fileSize = file ? file.data.length : raw.length;
  }
  if (!fileSize) return { ok: false, status: 400, error: '缺少音频文件', type: 'invalid_request' };

  const pr = modelPricing(model);
  const cost = Number(((Number(pr.request) || 0.01) + fileSize / 1e6 * (Number(pr.prompt) || 0)).toFixed(6));
  const bal = Number(user.balance) || 0;
  if (bal - (Number(user.frozen) || 0) < cost) return { ok: false, status: 402, error: '积分余额不足', type: 'insufficient_quota' };

  user.balance = Number((bal - cost).toFixed(6));
  key.last_used_at = now();
  addLog({ user_id: user.id, key_id: key.id, model, status: 'success', cost, ms: Date.now() - started, prompt_tokens: 0, completion_tokens: 0, kind: 'transcription', bytes: fileSize });
  scheduleSave();
  return { ok: true, data: { text: '（演示转写）已接收 ' + Math.round(fileSize / 1024) + ' KB 音频。接入真实上游后此处返回识别文本。', usage: { seconds: Math.round(fileSize / 32000) } } };
}

/** 重排：本地用词重叠打分，接上游则转发 */
async function relayRerank(secret, body, clientIp) {
  seedPlatformUsers();
  const { db } = data();
  const started = Date.now();
  const key = findKeyBySecret(secret);
  if (!key) {
    const k = 'authfail:' + String(clientIp || '') + ':' + Math.floor(Date.now() / 60000);
    const n = (AUTH_FAIL_HITS.get(k) || 0) + 1;
    AUTH_FAIL_HITS.set(k, n);
    if (AUTH_FAIL_HITS.size > 500) AUTH_FAIL_HITS.clear();
    if (n <= 5) {
      addLog({
        user_id: 'anonymous', key_id: '', model: String((body && body.model) || '').slice(0, 60),
        status: 'error', cost: 0, ms: Date.now() - started,
        error: '无效的 API Key（' + String(secret || '').slice(0, 8) + '…）',
        kind: 'auth_fail', client_ip: clientIp || '',
      });
    }
    return { ok: false, status: 401, error: '无效的 API Key', type: 'invalid_api_key' };
  }
  if (key.enabled === false) return { ok: false, status: 403, error: 'API Key 已被停用', type: 'key_disabled' };
  if (!keyIpAllowed(key, clientIp)) return { ok: false, status: 403, error: 'IP 不在白名单内', type: 'ip_forbidden' };
  const user = findUser(key.user_id);
  if (!user || user.status === 'banned') return { ok: false, status: 403, error: '账号不可用', type: 'account_disabled' };
  const model = String(body.model || 'rerank-v1');
  const query = String(body.query || '');
  const docs = Array.isArray(body.documents) ? body.documents : [];
  if (!query || !docs.length) return { ok: false, status: 400, error: 'query 与 documents 必填', type: 'invalid_request' };
  const pr = modelPricing(model);
  const cost = Number(((Number(pr.request) || 0.01) + docs.length * 0.0001).toFixed(6));
  const bal = Number(user.balance) || 0;
  if (bal - (Number(user.frozen) || 0) < cost) return { ok: false, status: 402, error: '积分余额不足', type: 'insufficient_quota' };

  // 优先转发到真实上游（Cohere / Jina / 通用 /v1/rerank），失败再本地打分
  const ch = routeCandidates(model, user.group).find(c => c.base_url && c.type !== 'mock');
  if (ch) {
    try {
      const up = await rerankUpstream(ch, model, body);
      user.balance = Number((bal - cost).toFixed(6));
      key.last_used_at = now();
      addLog({ user_id: user.id, key_id: key.id, model, status: 'success', cost, ms: Date.now() - started, prompt_tokens: 0, completion_tokens: 0, kind: 'rerank', channel: ch.name });
      scheduleSave();
      return { ok: true, data: up };
    } catch (e) { /* 回退本地 */ }
  }

  const terms = query.toLowerCase().split(/\s+|(?=[\u4e00-\u9fa5])/).filter(Boolean);
  const results = docs.map((d, i) => {
    const t = String(typeof d === 'string' ? d : (d && d.text) || '').toLowerCase();
    let hit = 0;
    terms.forEach(x => { if (x && t.indexOf(x) !== -1) hit += 1; });
    return { index: i, relevance_score: Number((terms.length ? hit / terms.length : 0).toFixed(6)) };
  }).sort((a, b) => b.relevance_score - a.relevance_score);
  if (body.top_n) results.length = Math.min(results.length, Number(body.top_n));

  user.balance = Number((bal - cost).toFixed(6));
  key.last_used_at = now();
  addLog({ user_id: user.id, key_id: key.id, model, status: 'success', cost, ms: Date.now() - started, prompt_tokens: 0, completion_tokens: 0, kind: 'rerank' });
  scheduleSave();
  return { ok: true, data: { id: 'rerank-' + Date.now(), model, results, usage: { documents: docs.length } } };
}

/* ------------------------------ 日志归档 ------------------------------ */
const fsx = require('fs');
const pathx = require('path');
const LOG_DIR = pathx.join(__dirname, '..', 'logs');
const LOG_KEEP = 2000;

/** 超出保留量的日志按月份归档到 logs/archive-YYYY-MM.jsonl（不丢数据，只是移出主库） */
function archiveLogs(force) {
  const { p } = data();
  if (!Array.isArray(p.logs)) return { archived: 0 };
  const keep = Number(force) || LOG_KEEP;
  if (p.logs.length <= keep) return { archived: 0, kept: p.logs.length };
  const overflow = p.logs.splice(keep);
  const buckets = {};
  overflow.forEach(l => {
    const m = String(l.at || '').slice(0, 7) || 'unknown';
    (buckets[m] = buckets[m] || []).push(l);
  });
  try {
    if (!fsx.existsSync(LOG_DIR)) fsx.mkdirSync(LOG_DIR, { recursive: true });
    Object.keys(buckets).forEach(m => {
      const file = pathx.join(LOG_DIR, 'archive-' + m + '.jsonl');
      fsx.appendFileSync(file, buckets[m].map(x => JSON.stringify(x)).join('\n') + '\n');
    });
  } catch (e) {
    // 写盘失败则回填，绝不丢日志
    p.logs = p.logs.concat(overflow);
    return { archived: 0, error: e.message };
  }
  scheduleSave();
  return { archived: overflow.length, kept: p.logs.length, months: Object.keys(buckets) };
}

function listArchives() {
  try {
    if (!fsx.existsSync(LOG_DIR)) return [];
    return fsx.readdirSync(LOG_DIR)
      .filter(f => /^archive-\d{4}-\d{2}\.jsonl$/.test(f))
      .map(f => {
        const full = pathx.join(LOG_DIR, f);
        const st = fsx.statSync(full);
        let lines = 0;
        try { lines = fsx.readFileSync(full, 'utf8').split('\n').filter(Boolean).length; } catch (e) {}
        return { name: f, size: st.size, lines, mtime: st.mtime.toISOString(), month: f.replace('archive-', '').replace('.jsonl', '') };
      })
      .sort((a, b) => b.month.localeCompare(a.month));
  } catch (e) { return []; }
}

/** 从归档里检索（按月，最多读 20000 行） */
function searchArchive(month, q, limit) {
  const file = pathx.join(LOG_DIR, 'archive-' + String(month || '').replace(/[^0-9-]/g, '') + '.jsonl');
  if (!fsx.existsSync(file)) return [];
  const out = [];
  const kw = String(q || '').toLowerCase();
  const lines = fsx.readFileSync(file, 'utf8').split('\n');
  for (let i = lines.length - 1; i >= 0 && out.length < (Number(limit) || 100); i--) {
    if (!lines[i]) continue;
    if (out.length >= 20000) break;
    if (kw && lines[i].toLowerCase().indexOf(kw) === -1) continue;
    try { out.push(JSON.parse(lines[i])); } catch (e) { /* skip */ }
  }
  return out;
}

/* ------------------------------ 渠道余额 ------------------------------ */
/** 查询上游余额：目前仅 OpenAI 系（含中转）提供 billing 接口，其它厂商返回 supported=false */
async function queryChannelBalance(ch) {
  if (!ch || !ch.base_url) return { supported: false, error: '未配置上游地址' };
  if (ch.type === 'mock') return { supported: false, error: '内置渠道无需余额' };
  const base = String(ch.base_url).replace(/\/$/, '');
  try {
    const r = await fetch(base + '/dashboard/billing/subscription', {
      headers: ch.type === 'azure' ? { 'api-key': ch.api_key || '' } : { authorization: 'Bearer ' + (ch.api_key || '') },
      signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
    });
    if (!r.ok) return { supported: false, error: '上游未提供余额接口（HTTP ' + r.status + '）' };
    const d = await r.json().catch(() => null);
    if (!d || d.hard_limit_usd == null) return { supported: false, error: '返回格式非标准 billing 接口' };
    const limit = Number(d.hard_limit_usd) || 0;
    let used = 0;
    try {
      const u = await fetch(base + '/dashboard/billing/usage?start_date=' + new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10) +
        '&end_date=' + new Date().toISOString().slice(0, 10), {
        headers: { authorization: 'Bearer ' + (ch.api_key || '') },
        signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined,
      });
      const ud = await u.json().catch(() => null);
      if (ud && ud.total_usage != null) used = Number(ud.total_usage) / 100;
    } catch (e) { /* ignore */ }
    return { supported: true, remaining: Number(Math.max(0, limit - used).toFixed(2)), total: limit, used: Number(used.toFixed(2)), currency: 'USD', unit: '美元' };
  } catch (e) {
    return { supported: false, error: e.message };
  }
}

/* ------------------------------ 告警 ------------------------------ */
function alerts() {
  const { p } = data();
  if (!p.alerts) p.alerts = [];
  return p.alerts;
}

function addAlert(level, title, detail, key) {
  const list = alerts();
  if (key) {
    const dup = list.find(a => a.key === key && !a.read && Date.now() - new Date(a.at).getTime() < 30 * 60000);
    if (dup) { dup.count = (dup.count || 1) + 1; dup.at = now(); scheduleSave(); return dup; }
  }
  const a = { id: 'al' + Date.now().toString(36), level: level || 'warning', title, detail, key: key || '', read: false, count: 1, at: now() };
  list.unshift(a);
  if (list.length > 200) list.length = 200;
  scheduleSave();
  pushAlert(a).catch(() => {});
  return a;
}

/** 告警外发：邮件 + Webhook（钉钉/飞书/Slack 通用 text 字段） */
async function pushAlert(a) {
  const { db } = data();
  const cfg = (db.settings && db.settings.platform) || {};
  const results = { email: null, webhook: null };
  const emoji = a.level === 'critical' ? '🚨' : (a.level === 'warning' ? '⚠️' : 'ℹ️');
  const text = emoji + ' 【小小科技】' + a.title + '\n' + (a.detail || '') + '\n时间：' + (a.at || now());

  if (cfg.alert_webhook) {
    try {
      const r = await fetch(cfg.alert_webhook, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: text }, content: text, text_content: text }),
        signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
      });
      results.webhook = { ok: r.ok, status: r.status };
    } catch (e) { results.webhook = { ok: false, error: e.message }; }
  }
  if (cfg.alert_email && cfg.smtp && cfg.smtp.host) {
    try {
      const r = await mailer.sendMail(cfg.smtp, { to: cfg.alert_email, subject: '【小小科技告警】' + a.title, text });
      results.email = { ok: !!r.ok, error: r.error || '' };
    } catch (e) { results.email = { ok: false, error: e.message }; }
  }
  return { ok: true, results };
}

/** 每分钟检查：近 10 分钟失败率 / 余额不足 / 渠道熔断 */
function alertTick() {
  const { p, db } = data();
  const since = Date.now() - 10 * 60000;
  const recent = (p.logs || []).filter(l => new Date(l.at).getTime() >= since && l.model !== '充值' && l.kind !== 'recharge');
  if (recent.length >= 10) {
    const errors = recent.filter(l => l.status !== 'success').length;
    const rate = errors / recent.length;
    const thr = Number((db.settings && db.settings.platform && db.settings.platform.alert_fail_rate) || 30) / 100;
    if (rate >= thr) {
      addAlert('critical', '调用失败率异常',
        '近 10 分钟 ' + recent.length + ' 次调用中失败 ' + errors + ' 次（' + Math.round(rate * 100) + '%），阈值 ' + Math.round(thr * 100) + '%。',
        'fail-rate');
    }
  }
  const down = (p.channels || []).filter(c => c.status === 'down');
  if (down.length) {
    addAlert('warning', down.length + ' 个上游渠道熔断中', down.map(c => c.name).join('、'), 'channel-down');
  }
  const lowBalance = (db.users || []).filter(u => Number(u.balance || 0) < 1 && u.status === 'active').length;
  if (lowBalance >= 10) {
    addAlert('info', lowBalance + ' 个用户余额不足 1 积分', '可能影响付费转化，可在用户管理查看。', 'low-balance');
  }
  return { ok: true };
}

/* ------------------------------ 邀请体系 ------------------------------ */
function inviteStats(user) {
  const { db, p } = data();
  const invitees = (db.users || []).filter(u => u.inviter === user.id);
  const records = (p.referrals || []).filter(r => r.inviter === user.id);
  const total = records.reduce((n, r) => n + Number(r.points || 0), 0);
  const rechargeTotal = (p.orders || [])
    .filter(o => o.status === 'paid' && invitees.some(u => u.id === o.user_id))
    .reduce((n, o) => n + Number(o.amount || 0), 0);
  return {
    code: user.invite_code || '',
    count: invitees.length,
    total_reward: Number(total.toFixed(4)),
    recharge_amount: Number(rechargeTotal.toFixed(2)),
    rate: Number(((db.settings && db.settings.platform && db.settings.platform.referral_rate) != null
      ? db.settings.platform.referral_rate : 10)),
    invitees: invitees.map(u => ({
      username: u.username, at: u.created_at,
      paid: Number((p.orders || []).filter(o => o.user_id === u.id && o.status === 'paid').reduce((n, o) => n + o.amount, 0).toFixed(2)),
    })).slice(0, 50),
    records: records.slice(0, 50),
  };
}

/** Rerank 上游转发（Cohere / Jina / 通用 /v1/rerank） */
async function rerankUpstream(channel, model, body) {
  const base = String(channel.base_url).replace(/\/$/, '');
  const mapped = (channel.model_map && channel.model_map[model]) || model;
  const payload = { model: mapped, query: body.query, documents: body.documents, top_n: body.top_n };
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + (channel.api_key || '') };
  const isCohere = channel.type === 'cohere';
  const url = isCohere ? base + '/v2/rerank' : base + '/v1/rerank';
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload),
    signal: AbortSignal.timeout ? AbortSignal.timeout(Number(channel.timeout_ms) || 30000) : undefined });
  if (!r.ok) throw new Error('上游返回 ' + r.status);
  const raw = await r.json();
  const list = raw.results || (raw.data) || [];
  return {
    id: raw.id || 'rerank-' + Date.now(),
    model,
    results: list.map(x => ({ index: x.index, relevance_score: Number(x.relevance_score != null ? x.relevance_score : x.score) || 0 })),
    usage: raw.meta && raw.meta.billed_units ? raw.meta.billed_units : { documents: (body.documents || []).length },
  };
}

/** 公开排行榜：近 30 天按调用量 */
function leaderboard(days) {
  const { p } = data();
  const since = Date.now() - (Number(days) || 30) * 864e5;
  const map = {};
  (p.logs || []).forEach(l => {
    if (new Date(l.at).getTime() < since) return;
    if (l.model === '充值' || l.kind === 'recharge') return;
    if (!map[l.model]) map[l.model] = { model: l.model, calls: 0, tokens: 0, cost: 0 };
    map[l.model].calls += 1;
    map[l.model].tokens += (l.prompt_tokens || 0) + (l.completion_tokens || 0);
    map[l.model].cost += Number(l.cost) || 0;
  });
  return Object.values(map).sort((a, b) => b.calls - a.calls).slice(0, 20);
}

/* ------------------------------ 站内通知 + 邮件 ------------------------------ */
const mailer = require('./mailer');

function notifications() {
  const { p } = data();
  if (!p.notifications) p.notifications = [];
  return p.notifications;
}

function addNotification(userId, title, body, kind) {
  const list = notifications();
  const n = { id: 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), user_id: userId, title, body: body || '', kind: kind || 'info', read: false, at: now() };
  list.unshift(n);
  if (list.length > 500) list.length = 500;
  scheduleSave();
  return n;
}

function listNotifications(userId, limit) {
  return notifications().filter(n => n.user_id === userId).slice(0, Number(limit) || 50);
}

function markNotificationsRead(userId, id) {
  notifications().forEach(n => {
    if (n.user_id !== userId) return;
    if (!id || n.id === id) n.read = true;
  });
  scheduleSave();
}

const DEFAULT_MAIL_TEMPLATES = {
  welcome: { subject: '欢迎加入小小科技', body: '你好 {{username}}，账号已创建。到「我的 Key」签发密钥即可调用接口。' },
  payment: { subject: '充值到账通知', body: '你好 {{username}}，充值 ¥{{amount}} 已到账，获得 {{points}} 积分。' },
};

function mailTemplate(kind) {
  const { db } = data();
  const t = (db.settings && db.settings.platform && db.settings.platform.mail_templates) || {};
  return Object.assign({}, DEFAULT_MAIL_TEMPLATES[kind] || {}, t[kind] || {});
}

function renderTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : ''));
}

function mailConfig() {
  const { db } = data();
  const cfg = (db.settings && db.settings.platform && db.settings.platform.smtp) || {};
  return cfg;
}

/** 通知：站内必达；配置了 SMTP 且有邮箱再异步发邮件 */
function notify(userId, opts) {
  const n = addNotification(userId, opts.title, opts.body, opts.kind);
  const cfg = mailConfig();
  if (cfg && cfg.host && opts.email) {
    const tpl = opts.kind ? mailTemplate(opts.kind) : null;
    const subject = tpl && tpl.subject ? renderTemplate(tpl.subject, opts.vars || {}) : opts.title;
    const text = tpl && tpl.body ? renderTemplate(tpl.body, opts.vars || {}) : (opts.body || opts.title);
    mailer.sendMail(cfg, { to: opts.email, subject, text })
      .then(r => {
        const { p } = data();
        p.mailLog = p.mailLog || [];
        p.mailLog.unshift({ at: now(), to: opts.email, subject, ok: !!r.ok, error: r.error || '' });
        if (p.mailLog.length > 200) p.mailLog.length = 200;
        scheduleSave();
      })
      .catch(() => {});
  }
  return n;
}

/* ------------------------------ 用户分组与倍率 ------------------------------ */
function ensureGroups() {
  const { db, p } = data();
  if (!p.groups) {
    p.groups = [
      { id: 'default', name: '默认分组', ratio: 1, description: '标准倍率，适用于大多数用户' },
      { id: 'svip', name: '高级分组', ratio: 0.85, description: '85 折倍率，适合长期高消耗客户' },
      { id: 'internal', name: '内部测试', ratio: 0, description: '内部账号免计费' },
    ];
    store.save();
  }
  return p.groups;
}

function groupRatio(user) {
  const groups = ensureGroups();
  const g = groups.find(x => x.id === (user && user.group)) || groups.find(x => x.id === 'default');
  return g ? Number(g.ratio) || 0 : 1;
}

/* ------------------------------ 备份 ------------------------------ */
const BACKUP_DIR = require('path').join(__dirname, '..', 'backups');

function listBackups() {
  const fs = require('fs');
  const path = require('path');
  try {
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
    return fs.readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => {
        const st = fs.statSync(path.join(BACKUP_DIR, f));
        return { name: f, size: st.size, mtime: st.mtime.toISOString() };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
  } catch (e) { return []; }
}

function createBackup(tag) {
  const fs = require('fs');
  const path = require('path');
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const name = 'db-' + stamp + (tag ? '-' + tag : '') + '.json';
  fs.copyFileSync(store.DB_FILE, path.join(BACKUP_DIR, name));
  // 只保留最近 30 份
  const all = listBackups();
  if (all.length > 30) {
    all.slice(30).forEach(b => { try { fs.unlinkSync(path.join(BACKUP_DIR, b.name)); } catch (e) {} });
  }
  return { name, size: fs.statSync(path.join(BACKUP_DIR, name)).size, mtime: new Date().toISOString() };
}

function restoreBackup(name) {
  const fs = require('fs');
  const path = require('path');
  const safe = String(name || '').replace(/[\/\\]/g, '');
  const file = path.join(BACKUP_DIR, safe);
  if (!fs.existsSync(file)) return { error: '备份不存在' };
  createBackup('pre-restore');
  fs.copyFileSync(file, store.DB_FILE);
  store.reload();
  return { ok: true };
}

module.exports = {
  queryChannelBalance, pushAlert,
  archiveLogs, listArchives, searchArchive, alerts, addAlert, alertTick,
  capBody, redact, logBodiesEnabled,
  googleAuth,
  inviteStats, rerankUpstream,
  DEFAULT_MAIL_TEMPLATES, mailTemplate, renderTemplate,
  relaySpeech, relayTranscription, relayRerank,
  addNotification, listNotifications, markNotificationsRead, notify, mailConfig,
  keyIpAllowed, ipMatch, scheduleSave, ensureGroups, groupRatio, listBackups, createBackup, restoreBackup,
  rechargePlans, createOrder, findOrder, markPaid, checkChannel, healthTick, HEALTH, POINT_PER_YUAN,
  relayEmbeddings, relayImages, leaderboard,
  modelPricing, computeCost, routeCandidates, rateLimit, usageStats,
  seedPlatformUsers, register, login, findUser, publicUser,
  issueSession, readSession, sessionUser, dropSession,
  createKey, listKeys, findKeyBySecret, maskKey,
  listChannels, pickChannel, modelPrice,
  addLog, listLogs, relayChat, data,
};
