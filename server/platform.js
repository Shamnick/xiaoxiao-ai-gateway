'use strict';
/**
 * 业务平台层：用户 / 会话 / API Key / 渠道 / 计费 / 用量日志 / OpenAI 兼容转发。
 * 与"页面渲染"解耦，后台与用户中心共用同一套数据。
 */
const crypto = require('crypto');
const store = require('./store');

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
  let inviter = null, bonus = 0;
  if (inviteCode) {
    const inv = db.users.find(u => u.invite_code === String(inviteCode).trim().toUpperCase());
    if (!inv) return { error: '邀请码无效' };
    inviter = inv.id;
    bonus = 5;
    inv.balance = (Number(inv.balance) || 0) + 5;
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
function routeCandidates(model) {
  const nowTs = Date.now();
  const list = listChannels().filter(c => {
    if (c.enabled === false) return false;
    if (c.status === 'down' && c.cooldown_until && Number(c.cooldown_until) > nowTs) return false;
    return true;
  });
  const hit = list.filter(c => (c.models || []).includes('*') || (c.models || []).includes(model));
  if (!hit.length) return [];
  const byPriority = {};
  hit.forEach(c => {
    const p = Number(c.priority) || 0;
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

/* ------------------------------ 限流 ------------------------------ */
const RATE = new Map();
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
  if (p.logs.length > 5000) p.logs.length = 5000;
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
async function relayChat(secret, body) {
  seedPlatformUsers();
  const { db } = data();
  const started = Date.now();
  const key = findKeyBySecret(secret);
  if (!key) return { ok: false, status: 401, error: '无效的 API Key', type: 'invalid_api_key' };
  if (key.enabled === false) return { ok: false, status: 403, error: 'API Key 已被停用', type: 'key_disabled' };
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
  const candidates = routeCandidates(model);
  let payload = null, usage = null, usedChannel = null, lastErr = '';

  for (const channel of candidates) {
    if (channel.type === 'mock') {
      payload = mockCompletion(model, body.messages || [], stream);
      usage = stream ? { prompt_tokens: Math.ceil(estTokens), completion_tokens: 120 } : payload.usage;
      usedChannel = channel;
      break;
    }
    if (!channel.base_url) continue;
    try {
      const upBody = Object.assign({}, body);
      const mapped = channel.model_map && channel.model_map[model];
      if (mapped) upBody.model = mapped;
      const upstream = await fetch(String(channel.base_url).replace(/\/$/, '') + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + channel.api_key },
        body: JSON.stringify(upBody),
        signal: AbortSignal.timeout ? AbortSignal.timeout(Number(channel.timeout_ms) || 60000) : undefined,
      });
      if (!upstream.ok) {
        lastErr = '上游 ' + channel.name + ' 返回 ' + upstream.status;
        channel.status = 'warn';
        continue;
      }
      payload = await upstream.json();
      usage = payload.usage || {};
      usedChannel = channel;
      channel.status = 'ok';
      channel.last_check = now();
      break;
    } catch (e) {
      lastErr = '上游 ' + channel.name + ' 不可达：' + e.message;
      channel.status = 'warn';
    }
  }

  if (!payload) {
    if (key.quota <= 0) user.frozen = Number(Math.max(0, (Number(user.frozen) || 0) - estCost).toFixed(6));
    addLog({ user_id: user.id, key_id: key.id, model, status: 'error', cost: 0, ms: Date.now() - started, error: (lastErr || '无可用渠道').slice(0, 200) });
    return { ok: false, status: 502, error: lastErr || '无可用渠道', type: 'upstream_error' };
  }

  const pt = Number(usage && usage.prompt_tokens) || 0;
  const ct = Number(usage && usage.completion_tokens) || 0;
  const baseCost = computeCost(model, usage);
  const ratio = groupRatio(user);
  const cost = Number((baseCost * (ratio || 0)).toFixed(6));

  if (key.quota > 0) key.used += 1;
  else {
    user.frozen = Number(Math.max(0, (Number(user.frozen) || 0) - estCost).toFixed(6));
    user.balance = Number((balance - cost).toFixed(6));
  }
  key.last_used_at = now();

  addLog({
    user_id: user.id, key_id: key.id, model,
    status: 'success', cost, ms: Date.now() - started,
    prompt_tokens: pt, completion_tokens: ct,
    channel: usedChannel ? usedChannel.name : 'unknown',
    stream: !!stream,
  });
  scheduleSave();
  return { ok: true, data: payload, stream, usage, cost, channel: usedChannel ? usedChannel.name : '' };
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
async function relayEmbeddings(secret, body) {
  seedPlatformUsers();
  const { db } = data();
  const started = Date.now();
  const key = findKeyBySecret(secret);
  if (!key) return { ok: false, status: 401, error: '无效的 API Key', type: 'invalid_api_key' };
  if (key.enabled === false) return { ok: false, status: 403, error: 'API Key 已被停用', type: 'key_disabled' };
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
async function relayImages(secret, body) {
  seedPlatformUsers();
  const { db } = data();
  const started = Date.now();
  const key = findKeyBySecret(secret);
  if (!key) return { ok: false, status: 401, error: '无效的 API Key', type: 'invalid_api_key' };
  if (key.enabled === false) return { ok: false, status: 403, error: 'API Key 已被停用', type: 'key_disabled' };
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
  scheduleSave, ensureGroups, groupRatio, listBackups, createBackup, restoreBackup,
  rechargePlans, createOrder, findOrder, markPaid, checkChannel, healthTick, HEALTH, POINT_PER_YUAN,
  relayEmbeddings, relayImages, leaderboard,
  modelPricing, computeCost, routeCandidates, rateLimit, usageStats,
  seedPlatformUsers, register, login, findUser, publicUser,
  issueSession, readSession, sessionUser, dropSession,
  createKey, listKeys, findKeyBySecret, maskKey,
  listChannels, pickChannel, modelPrice,
  addLog, listLogs, relayChat, data,
};
