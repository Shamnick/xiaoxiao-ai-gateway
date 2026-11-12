'use strict';
/**
 * 数据存储：单文件 JSON + 原子写 + 内存缓存。
 * 首次启动用 data/seed.json 复制出 data/db.json（保留 seed 作为出厂快照）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');

let cache = null;

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    if (!fs.existsSync(SEED_FILE)) throw new Error('缺少 data/seed.json，请先运行 node tools/build-seed.js');
    fs.copyFileSync(SEED_FILE, DB_FILE);
  }
}

function bootstrapExtras(db) {
  // 后台账号、运营数据、审计等只在首次补齐
  if (!db.admins) {
    const salt = crypto.randomBytes(16).toString('hex');
    db.admins = [{
      id: 'a1', username: 'admin', nickname: '超级管理员', role: 'owner',
      salt, hash: hashPwd('admin123', salt), created_at: now(), last_login: null, enabled: true,
    }];
  }
  if (!db.users) db.users = seedUsers();
  setSeedUsers(db.users);
  if (!db.orders) db.orders = seedOrders(db.users);
  if (!db.tickets) db.tickets = seedTickets();
  if (!db.audit) db.audit = [];
  if (!db.visits) db.visits = seedVisits();
  if (!db.leads) db.leads = seedLeads();
  if (!db.userSite) {
    const f = path.join(DATA_DIR, 'seed-user.json');
    if (fs.existsSync(f)) db.userSite = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  if (!db.userCenter) db.userCenter = seedUserCenter();
  if (db.userCenter && !db.userCenter.plansV2) {
    try {
      const f = path.join(DATA_DIR, 'plans-seed.json');
      if (fs.existsSync(f)) {
        db.userCenter.plansV2 = JSON.parse(fs.readFileSync(f, 'utf8'));
        db.userCenter.plansV2.forEach(pl => { pl.origHtml = pl.html; });
      }
    } catch (e) { /* ignore */ }
  }
  return db;
}

function now() { return new Date().toISOString(); }

function load() {
  if (cache) return cache;
  ensure();
  const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  cache = bootstrapExtras(raw);
  return cache;
}

function save() {
  if (!cache) return;
  cache.meta = cache.meta || {};
  cache.meta.updated_at = now();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 1), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

function reload() { cache = null; return load(); }

/* ---------- 密码 ---------- */
function hashPwd(pwd, salt) {
  return crypto.scryptSync(String(pwd), salt, 64).toString('hex');
}
function verifyPwd(pwd, admin) {
  if (!admin || !admin.salt || !admin.hash) return false;
  const h = hashPwd(pwd, admin.salt);
  const a = Buffer.from(h, 'hex');
  const b = Buffer.from(admin.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function setPwd(admin, pwd) {
  admin.salt = crypto.randomBytes(16).toString('hex');
  admin.hash = hashPwd(pwd, admin.salt);
}

/* ---------- 审计 ---------- */
function audit(actor, action, target, detail) {
  const db = load();
  db.audit.unshift({
    id: db.audit.length ? db.audit[0].id + 1 : 1,
    at: now(), actor: actor || 'system', action, target: target || '', detail: detail || '',
    ip: (audit.__ip || ''),
  });
  if (db.audit.length > 500) db.audit.length = 500;
  save();
}

/* ---------- 种子运营数据 ---------- */
function rnd(n, m) { return Math.floor(Math.random() * (m - n + 1)) + n; }
function pick(arr) { return arr[rnd(0, arr.length - 1)]; }

function seedUsers() {
  const names = ['风起云涌', 'NeuralMax', '小宇', 'API猎人', '橙子AI', 'DeepNight', '白泽', '量化小王子',
    '云上漫步', 'TokenGo', '夜航船', '三体迷', '模型收藏家', 'ByteSmith', '智械师', '流萤',
    '草木深', '随机数', '推理者', '千面', '星尘', 'Rustacean', 'Moonshot粉', '小满'];
  const plans = [
    { name: '无限续杯 · 月卡', price: 57 }, { name: '无限续杯 · 季卡', price: 152 },
    { name: '无限续杯 · 年卡', price: 499 }, { name: 'API 无限 · 月卡', price: 68 },
    { name: 'API 无限 · 季卡', price: 182 }, { name: '按量充值 · 100 元', price: 100 },
    { name: '按量充值 · 500 元', price: 500 }, { name: '试用 · 3 天', price: 1.9 },
  ];
  const out = [];
  for (let i = 0; i < 48; i++) {
    const plan = pick(plans);
    const created = new Date(Date.now() - rnd(0, 120) * 864e5);
    out.push({
      id: 'u' + (1001 + i),
      username: names[i % names.length] + (i > 23 ? rnd(10, 99) : ''),
      email: 'user' + (1001 + i) + '@' + pick(['qq.com', '163.com', 'gmail.com', 'outlook.com', 'foxmail.com']),
      phone: '1' + pick(['38', '39', '50', '58', '86', '88']) + '****' + rnd(1000, 9999),
      plan: plan.name,
      amount: plan.price,
      balance: rnd(0, 300) + 0.5,
      status: pick(['active', 'active', 'active', 'active', 'expired', 'banned']),
      refill: Math.random() > 0.45,
      created_at: created.toISOString(),
      last_login: new Date(Date.now() - rnd(0, 20) * 864e5).toISOString(),
      note: '',
    });
  }
  return out;
}

function seedOrders(users) {
  const out = [];
  const status = ['paid', 'paid', 'paid', 'paid', 'pending', 'refunded', 'closed'];
  users.forEach((u, i) => {
    const n = rnd(1, 3);
    for (let k = 0; k < n; k++) {
      const at = new Date(Date.now() - rnd(0, 110) * 864e5 - rnd(0, 86400) * 1000);
      out.push({
        id: 'YT' + (20260101 + i * 7 + k).toString(),
        user_id: u.id, username: u.username,
        plan: u.plan, amount: u.amount,
        channel: pick(['支付宝', '微信支付', '易支付', 'USDT']),
        status: pick(status),
        created_at: at.toISOString(),
        paid_at: at.toISOString(),
        note: '',
      });
    }
  });
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function seedTickets() {
  const data = [
    ['接口返回 429，怎么提升并发？', '我买的是月卡无限续杯，调用 claude 系列模型时频繁 429，请问并发上限是多少？', 'open', 'high'],
    ['发票怎么开？', '公司报销需要开电子发票，抬头是「杭州某某科技有限公司」，税号 91330100MA2***。', 'open', 'normal'],
    ['模型广场没有我要的模型', '希望能上架 gemini-3-pro-preview，我们团队主要用它做长文档处理。', 'open', 'normal'],
    ['续杯工具登录不上', '打开续杯客户端一直提示「设备验证失败」，重启电脑也不行。', 'pending', 'high'],
    ['退款申请', '昨天买的季卡，想申请退款，订单号 YT20260101。', 'closed', 'high'],
    ['API Key 泄露了怎么办', 'Key 不小心提交到 GitHub 公开仓库了，需要立即作废并重新签发。', 'pending', 'urgent'],
  ];
  return data.map((d, i) => ({
    id: 'T' + (2001 + i),
    subject: d[0], body: d[1], status: d[2], priority: d[3],
    user: seedUsersCache[i % seedUsersCache.length].username,
    from: 'a1/home',
    created_at: new Date(Date.now() - rnd(0, 30) * 864e5).toISOString(),
    messages: [{ role: 'user', at: new Date(Date.now() - rnd(0, 30) * 864e5).toISOString(), text: d[1] }],
  }));
}
let seedUsersCache = [];
function setSeedUsers(u) { seedUsersCache = u; }

function seedVisits() {
  const out = [];
  const pages = ['/', '/?page=models', '/?page=terms', '/?page=privacy', '/?page=refund', '/?page=ip'];
  for (let d = 29; d >= 0; d--) {
    const day = new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
    pages.forEach(p => {
      out.push({ day, page: p, pv: rnd(60, 900), uv: rnd(40, 500) });
    });
  }
  return out;
}

function seedUserCenter() {
  let videoStyles = [];
  try {
    const f = path.join(DATA_DIR, 'video-styles.json');
    if (fs.existsSync(f)) videoStyles = JSON.parse(fs.readFileSync(f, 'utf8')).styles || [];
  } catch (e) { /* ignore */ }
  const day = n => new Date(Date.now() - n * 864e5).toISOString();
  return {
    profile: {
      username: 'sham', nickname: 'sham', email: 'sham@example.com', phone: '',
      points: 0, balance: 0, plan: null, joined: day(0), avatar: '',
      note: '演示账号：数据来自线上抓取快照',
    },
    plans: [
      { id: 'unlimited-quarter', name: '无限额度-季订阅-【双并发】', price: 499, days: 90, concurrency: 2, unlimited: true, featured: true },
      { id: 'unlimited-week', name: '无限额度-周订阅-【双并发】', price: 78, days: 7, concurrency: 2, unlimited: true },
      { id: 'daily-3k-month', name: '每日3千次调用-月订阅-【3并发】', price: 128, days: 30, concurrency: 3, daily: 3000 },
      { id: 'daily-5k-quarter', name: '每日5000次调用-季度订阅-【三并发】', price: 388, days: 90, concurrency: 3, daily: 5000 },
      { id: 'unlimited-week-single', name: '无限额度-周订阅-【单并发】', price: 65, days: 7, concurrency: 1, unlimited: true },
    ],
    subscriptions: [],
    keys: [],
    billing: [],
    invite: { codes: [], invitees: [] },
    redeemCodes: [
      { code: 'YT-DEMO-2026', plan: '无限额度-周订阅-【双并发】', days: 7, concurrency: 2, used: false },
      { code: 'YT-TRIAL-30', plan: '每日3千次调用-月订阅-【3并发】', days: 30, concurrency: 3, daily: 3000, used: false },
    ],
    usage: [],
    media: [],
    tasks: [],
    clientSetup: [],
    videoStyles,
  };
}

function seedLeads() {
  const src = ['咨询价格', '代理合作', 'API 接入', '续杯工具', '发票/对公'];
  return src.map((s, i) => ({
    id: 'L' + (3001 + i),
    source: s,
    contact: pick(['微信 yt_' + rnd(1000, 9999), 'QQ ' + rnd(100000, 999999), 'telegram @yt' + rnd(10, 99)]),
    content: pick(['想了解企业采购报价', '我们是 MCN，想批量开号', '需要私有化部署方案', '想成为区域代理']),
    status: pick(['new', 'following', 'won', 'lost']),
    created_at: new Date(Date.now() - rnd(0, 40) * 864e5).toISOString(),
  }));
}

module.exports = { ROOT, DATA_DIR, DB_FILE, SEED_FILE, load, save, reload, hashPwd, verifyPwd, setPwd, audit, now, setSeedUsers };
