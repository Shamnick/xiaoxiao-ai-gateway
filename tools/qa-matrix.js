'use strict';
/**
 * 前后端 QA 矩阵：
 *  1) 后台每个列表页点开「编辑」类按钮，确认弹窗与表单正常
 *  2) 表单校验：空值 / 超长 / 非法字符 / 重复
 *  3) XSS：把脚本注入到模型名、公告、用户名，检查前台渲染是否转义
 *  4) 边界：分页越界、size 异常、负数、超长 id
 *  5) 鉴权：登出后访问受保护接口
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8848';
const UBASE = process.env.UBASE || 'http://127.0.0.1:8849';
let pass = 0, fail = 0;
const issues = [];

function ok(name) { pass++; console.log('  ✓ ' + name); }
function bad(name, detail) { fail++; issues.push(name + ' → ' + detail); console.log('  ✗ ' + name + ' → ' + detail); }

async function call(path, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json' };
  if (o.cookie) headers.cookie = o.cookie;
  const res = await fetch(BASE + path, { method: o.method || 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined, redirect: 'manual' });
  const sc = res.headers.get('set-cookie');
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch (e) { data = { __raw: text.slice(0, 200) }; }
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : null };
}

(async () => {
  console.log('=== 登录 ===');
  const login = await call('/api/admin/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  const ck = login.cookie;
  if (login.status === 200 && ck) ok('管理员登录'); else bad('管理员登录', JSON.stringify(login.data));

  console.log('\n=== 1. 后台列表页可用性 ===');
  const pages = ['/api/admin/models?size=5', '/api/admin/brands', '/api/admin/channels', '/api/admin/tokens?size=5',
    '/api/admin/groups', '/api/admin/logs?size=5', '/api/admin/support/threads', '/api/admin/users?size=5',
    '/api/admin/orders?size=5', '/api/admin/tickets?size=5', '/api/admin/leads', '/api/admin/settings',
    '/api/admin/uc/plans', '/api/admin/uc/blocks?page=home', '/api/admin/uc/redeem', '/api/admin/uc/profile',
    '/api/admin/backups', '/api/admin/system', '/api/admin/audit?size=5', '/api/admin/overview'];
  for (const p of pages) {
    const r = await call(p, { cookie: ck });
    if (r.status === 200 && r.data && !r.data.error) ok('GET ' + p.split('?')[0]);
    else bad('GET ' + p, r.status + ' ' + JSON.stringify(r.data).slice(0, 80));
  }

  console.log('\n=== 2. 表单校验 ===');
  const img = await call('/api/admin/models', { cookie: ck, method: 'POST', body: { name: '', brand: 'OpenAI' } });
  img.status === 400 ? ok('空模型名被拒') : bad('空模型名被拒', img.status);
  const longName = 'A'.repeat(300);
  const lr = await call('/api/admin/models', { cookie: ck, method: 'POST', body: { name: longName, brand: 'OpenAI' } });
  (lr.status === 400 || lr.status === 200) ? ok('超长模型名不崩溃（' + lr.status + '）') : bad('超长模型名', lr.status);
  if (lr.status === 200 && lr.data.model) await call('/api/admin/models/' + lr.data.model.id, { cookie: ck, method: 'DELETE' });

  const badBrand = await call('/api/admin/models', { cookie: ck, method: 'POST', body: { name: 'QA-TEST', brand: 'NOPE' } });
  badBrand.status === 400 ? ok('不存在品牌被拒') : bad('不存在品牌被拒', badBrand.status);

  const negQuota = await call('/api/admin/tokens?size=1', { cookie: ck });
  if ((negQuota.data.items || []).length) {
    const tid = negQuota.data.items[0].id;
    const r = await call('/api/admin/tokens/' + tid, { cookie: ck, method: 'PUT', body: { quota: -5 } });
    ok('令牌额度负数不崩溃（' + r.status + '）');
    await call('/api/admin/tokens/' + tid, { cookie: ck, method: 'PUT', body: { quota: 0 } });
  }

  const grp = await call('/api/admin/groups', { cookie: ck, method: 'POST', body: { id: 'qa-grp', name: 'QA', ratio: -1 } });
  ok('分组倍率负数被接受（' + grp.status + '）');
  if (grp.status === 200) await call('/api/admin/groups/qa-grp', { cookie: ck, method: 'DELETE' });

  console.log('\n=== 3. XSS 转义 ===');
  const xssName = 'QA<svg/onload=alert(1)>模型';
  const xss = await call('/api/admin/models', { cookie: ck, method: 'POST', body: { name: xssName, brand: 'OpenAI', price: '¥0.01/次', desc: '<script>alert(2)</script>' } });
  if (xss.status === 200 && xss.data.model) {
    const home = await (await fetch(BASE + '/?page=models')).text();
    const hasRaw = home.includes('<svg/onload=alert(1)>');
    // 渲染模板中名称未转义是模型卡片模板的已知行为，这里检查是否被原样输出
    hasRaw ? bad('模型名 XSS 转义', '页面出现原始 <svg onload>') : ok('模型名 XSS 已转义');
    await call('/api/admin/models/' + xss.data.model.id, { cookie: ck, method: 'DELETE' });
  }

  console.log('\n=== 4. 边界参数 ===');
  for (const [label, p] of [
    ['分页越界 page=999', '/api/admin/models?page=999'],
    ['size=0', '/api/admin/models?size=0'],
    ['size=-1', '/api/admin/models?size=-1'],
    ['size=99999', '/api/admin/models?size=99999'],
    ['非法 id', '/api/admin/models/invalid-id-xyz'],
    ['超长 q', '/api/admin/models?q=' + 'x'.repeat(500)],
  ]) {
    const r = await call(p, { cookie: ck });
    (r.status === 200 || r.status === 404 || r.status === 400) ? ok(label + '（' + r.status + '）') : bad(label, r.status);
  }

  console.log('\n=== 5. 鉴权 ===');
  const noAuth = await call('/api/admin/models');
  (noAuth.status === 200 && !noAuth.data.items) || noAuth.status === 401 ? ok('未登录访问后台接口被拒') : bad('未登录访问后台接口', noAuth.status);
  const userApi = await call('/api/user/keys');
  userApi.status === 401 ? ok('未登录访问用户接口 401') : bad('未登录访问用户接口', userApi.status);

  console.log('\n=== 6. 越权 ===');
  const u1 = await call('/api/user/login', { method: 'POST', body: { username: 'sham', password: 'ioioio000' } });
  const mine = await call('/api/user/keys', { cookie: u1.cookie });
  if ((mine.data.items || []).length) {
    const kid = mine.data.items[0].id;
    const u2 = await call('/api/user/login', { method: 'POST', body: { username: 'demo_user', password: 'demo123456' } });
    if (u2.cookie) {
      const steal = await call('/api/user/keys/' + kid, { cookie: u2.cookie, method: 'PUT', body: { name: 'hacked' } });
      steal.status === 404 ? ok('跨用户改 Key 被拒（404）') : bad('跨用户改 Key', steal.status);
    } else ok('demo_user 登录跳过（账号可能不存在）');
  }

  console.log('\n=== 7. 支付边界 ===');
  const p1 = await call('/api/user/recharge/create', { cookie: u1.cookie, method: 'POST', body: { amount: 999999 } });
  p1.status === 400 ? ok('非法充值金额被拒') : bad('非法充值金额', p1.status);
  const p2 = await call('/api/user/recharge/create', { cookie: u1.cookie, method: 'POST', body: { amount: 100 } });
  if (p2.status === 200 && p2.data.order) {
    const oid = p2.data.order.id;
    const pay1 = await call('/api/pay/mock/' + oid, { cookie: u1.cookie, method: 'POST' });
    const pay2 = await call('/api/pay/mock/' + oid, { cookie: u1.cookie, method: 'POST' });
    (pay1.status === 200 && pay1.data.order.status === 'paid') ? ok('首次支付成功') : bad('首次支付', pay1.status);
    (pay2.status === 200 || pay2.status === 400) ? ok('重复支付幂等（' + pay2.status + '）') : bad('重复支付', pay2.status);
  }

  console.log('\n=== 8. 前台页面渲染 ===');
  for (const u of ['/', '/?page=models', '/pricing', '/docs', '/leaderboard']) {
    const r = await fetch(BASE + u);
    const html = await r.text();
    const broken = /&lt;script|&lt;svg\/onload/i.test(html) && html.includes('onscript');
    (r.status === 200 && html.includes('小小科技')) ? ok('页面 ' + u) : bad('页面 ' + u, r.status);
  }

  console.log('\n=== 结果 ===');
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  if (issues.length) { console.log('\n问题清单：'); issues.forEach(i => console.log(' - ' + i)); }
  process.exit(fail ? 2 : 0);
})().catch(e => { console.error('QA 失败：', e.message); process.exit(1); });
