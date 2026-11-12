'use strict';
/** 后台 REST API 全量冒烟：鉴权、CRUD、校验、联动 */
const BASE = process.env.BASE || 'http://127.0.0.1:8848';
let cookie = '';
let pass = 0, fail = 0;
const log = [];

async function call(path, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await fetch(BASE + '/api/admin' + path, {
    method: o.method || 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined,
    redirect: 'manual',
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty */ }
  return { status: res.status, data };
}

function check(name, cond, extra) {
  if (cond) { pass++; log.push('  ✓ ' + name); }
  else { fail++; log.push('  ✗ ' + name + (extra ? '  → ' + JSON.stringify(extra).slice(0, 220) : '')); }
}

(async () => {
  let r = await call('/me');
  check('未登录访问 /me 返回空身份', r.status === 200 && r.data.admin === null, r);

  r = await call('/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } });
  check('错误密码被拒绝', r.status === 401, r);
  r = await call('/login', { method: 'POST', body: { username: 'admin', password: 'admin123' } });
  check('正确密码登录成功并下发 Cookie', r.status === 200 && !!cookie, r);

  r = await call('/me');
  check('/me 返回当前管理员', r.status === 200 && r.data.admin.username === 'admin', r);

  r = await call('/overview');
  check('概览含模型/用户/订单统计与趋势', r.status === 200 && r.data.models > 0 && Array.isArray(r.data.trend), r.data && Object.keys(r.data));

  // 模型
  r = await call('/models?page=1&size=5');
  check('模型分页返回 5 条 + 总数', r.status === 200 && r.data.items.length === 5 && r.data.total === 67, r.data && r.data.total);
  r = await call('/models?q=GPT-6-Astra');
  check('模型搜索命中', r.status === 200 && r.data.items.some(m => m.name === 'GPT-6-Astra-max'));
  r = await call('/models?brand=Anthropic');
  check('按品牌筛选', r.status === 200 && r.data.items.every(m => m.brand === 'Anthropic'));

  const payload = { name: 'API-TEST-MODEL', brand: 'OpenAI', tags: [{ cls: 'is-ctx', text: '1M 上下文' }], desc: 'api test', price: '¥0.01/次', enabled: true };
  r = await call('/models', { method: 'POST', body: payload });
  check('创建模型', r.status === 200 && r.data.model && r.data.model.id, r);
  const mid = r.data && r.data.model && r.data.model.id;
  r = await call('/models', { method: 'POST', body: payload });
  check('重名模型被拒绝', r.status === 400, r);
  r = await call('/models', { method: 'POST', body: { name: '', brand: 'OpenAI' } });
  check('空名称被拒绝', r.status === 400, r);
  r = await call('/models', { method: 'POST', body: { name: 'X', brand: 'NOT-EXIST' } });
  check('不存在的品牌被拒绝', r.status === 400, r);

  let home = await (await fetch(BASE + '/?page=models')).text();
  check('新模型出现在前台模型广场', home.includes('API-TEST-MODEL'));

  r = await call('/models/' + mid, { method: 'PUT', body: { enabled: false } });
  check('下架模型', r.status === 200 && r.data.model.enabled === false);
  home = await (await fetch(BASE + '/?page=models')).text();
  check('下架后前台不再展示', !home.includes('API-TEST-MODEL'));

  r = await call('/models/' + mid, { method: 'PUT', body: { enabled: true, price: '¥0.02/次' } });
  check('重新上架并改价', r.status === 200 && r.data.model.price === '¥0.02/次');
  r = await call('/models/reorder', { method: 'POST', body: { ids: [mid, 'm0'] } });
  check('调整排序', r.status === 200);
  r = await call('/models/' + mid, { method: 'DELETE' });
  check('删除模型', r.status === 200);
  home = await (await fetch(BASE + '/?page=models')).text();
  check('删除后前台已消失', !home.includes('API-TEST-MODEL'));

  // 品牌
  r = await call('/brands', { method: 'POST', body: { id: 'TestBrand', label: '测试品牌' } });
  check('新增品牌', r.status === 200);
  r = await call('/brands', { method: 'POST', body: { id: 'TestBrand', label: 'dup' } });
  check('重复品牌被拒绝', r.status === 400);
  r = await call('/brands/' + encodeURIComponent('TestBrand'), { method: 'PUT', body: { label: '测试品牌改' } });
  check('更新品牌', r.status === 200 && r.data.brand.label === '测试品牌改');
  r = await call('/brands', { method: 'POST', body: { id: 'TestBrand2', label: '测试品牌2' } });
  r = await call('/brands/' + encodeURIComponent('TestBrand2'), { method: 'DELETE' });
  check('删除空品牌', r.status === 200);
  r = await call('/brands/Anthropic', { method: 'DELETE' });
  check('有模型的品牌禁止删除', r.status === 400, r);
  r = await call('/brands/' + encodeURIComponent('TestBrand'), { method: 'DELETE' });
  check('清理测试品牌', r.status === 200);

  // 区块
  r = await call('/blocks?page=home');
  check('按页取区块', r.status === 200 && r.data.items.length > 0 && r.data.items.every(b => b.page === 'home'));
  const block = r.data.items[0];
  r = await call('/blocks/' + encodeURIComponent(block.key), { method: 'PUT', body: { html: block.html, title: block.title } });
  check('保存区块（内容不变，幂等）', r.status === 200);
  const homeHtml = await (await fetch(BASE + '/')).text();
  check('首页渲染正常且品牌名为小小科技', homeHtml.includes('小小科技') && homeHtml.includes('id="hd"'), homeHtml.length);

  // 公告
  r = await call('/notice');
  check('读取公告', r.status === 200 && Array.isArray(r.data.items));
  r = await call('/notice', { method: 'PUT', body: { enabled: true, title: r.data.title, badge: r.data.badge, items: r.data.items } });
  check('保存公告', r.status === 200);

  // 设置
  r = await call('/settings');
  check('读取设置', r.status === 200 && r.data.site_name);
  r = await call('/settings', { method: 'PUT', body: { site_name: r.data.site_name } });
  check('保存设置', r.status === 200);

  // 用户
  r = await call('/users?page=1&size=3');
  check('用户分页', r.status === 200 && r.data.items.length === 3);
  const uid = r.data.items[0].id;
  r = await call('/users/' + uid, { method: 'PUT', body: { status: 'expired', note: 'api test' } });
  check('更新用户状态', r.status === 200 && r.data.user.status === 'expired');
  r = await call('/users/' + uid, { method: 'PUT', body: { status: 'active' } });

  // 订单
  r = await call('/orders?page=1&size=3');
  check('订单分页', r.status === 200 && r.data.items.length === 3);
  const oid = r.data.items[0].id;
  r = await call('/orders/' + oid, { method: 'PUT', body: { status: 'closed' } });
  check('修改订单状态', r.status === 200 && r.data.order.status === 'closed');
  r = await call('/orders/' + oid, { method: 'PUT', body: { status: 'paid' } });

  // 工单
  r = await call('/tickets?page=1&size=2');
  check('工单分页', r.status === 200 && r.data.items.length === 2);
  const tid = r.data.items[0].id;
  r = await call('/tickets/' + tid + '/reply', { method: 'POST', body: { text: '' } });
  check('空回复被拒绝', r.status === 400);
  r = await call('/tickets/' + tid + '/reply', { method: 'POST', body: { text: 'API 冒烟回复' } });
  check('工单回复成功', r.status === 200 && r.data.ticket.messages.some(m => m.text === 'API 冒烟回复'));

  // 线索
  r = await call('/leads');
  check('线索列表', r.status === 200 && r.data.items.length > 0);
  r = await call('/leads/' + r.data.items[0].id, { method: 'PUT', body: { status: 'following' } });
  check('更新线索状态', r.status === 200);

  // 管理员
  r = await call('/admins', { method: 'POST', body: { username: 'apitest', password: 'abc123', role: 'operator' } });
  check('新增管理员', r.status === 200 && r.data.admin.username === 'apitest', r);
  const aid = r.data.admin.id;
  r = await call('/admins/' + aid, { method: 'PUT', body: { nickname: '冒烟测试', enabled: false } });
  check('禁用管理员', r.status === 200 && r.data.admin.enabled === false);
  r = await call('/admins/' + aid, { method: 'DELETE' });
  check('删除管理员', r.status === 200);
  r = await call('/admins/' + 'a1', { method: 'DELETE' });
  check('不能删除自己', r.status === 400, r);
  r = await call('/password', { method: 'POST', body: { old_password: 'bad', new_password: 'x' } });
  check('改密需校验原密码', r.status === 400);

  // 日志 & 预览
  r = await call('/audit?page=1&size=5');
  check('审计日志', r.status === 200 && r.data.items.length === 5);
  r = await call('/visits?days=7');
  check('流量趋势', r.status === 200 && r.data.items.length > 0);
  r = await call('/preview?page=models');
  check('预览接口返回完整页面', r.status === 200 && r.data.html.includes('model-grid'));
  const pv = await fetch(BASE + '/admin/preview/home', { headers: { cookie }, redirect: 'manual' });
  check('预览路由可用', pv.status === 200 && (await pv.text()).includes('小小科技'));

  // 登出
  r = await call('/logout', { method: 'POST' });
  check('登出', r.status === 200);
  cookie = '';
  r = await call('/me');
  check('登出后回到未授权', r.status === 200 && r.data.admin === null, r);

  console.log(log.join('\n'));
  console.log('\n通过 %d / 失败 %d', pass, fail);
  process.exit(fail ? 2 : 0);
})();
