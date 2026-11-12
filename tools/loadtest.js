'use strict';
/**
 * 并发压测：QPS / 延迟分位 / 限流生效 / 余额一致性
 * 用法: node tools/loadtest.js [并发=50] [总请求=200]
 */
const BASE = process.env.BASE || 'http://127.0.0.1:8848';
const CONC = Number(process.argv[2] || 50);
const TOTAL = Number(process.argv[3] || 200);

async function api(path, opts) {
  const o = opts || {};
  const headers = { 'content-type': 'application/json' };
  if (o.cookie) headers.cookie = o.cookie;
  const res = await fetch(BASE + path, { method: o.method || 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined });
  const sc = res.headers.get('set-cookie');
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  return { status: res.status, data, cookie: sc ? sc.split(';')[0] : null };
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const a = arr.slice().sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(a.length * p))];
}

(async () => {
  console.log('=== 压测开始 ===');
  console.log('并发 ' + CONC + ' / 总请求 ' + TOTAL);

  const login = await api('/api/user/login', { method: 'POST', body: { username: 'sham', password: 'ioioio000' } });
  if (!login.data || !login.data.ok) throw new Error('登录失败');
  const cookie = login.cookie;
  const before = await api('/api/user/me', { cookie });
  const bal0 = Number(before.data.user.balance);

  const keyRes = await api('/api/user/keys', { method: 'POST', cookie, body: { name: '压测-' + Date.now().toString(36), quota: 0 } });
  const key = keyRes.data.key.key;
  console.log('起始余额 ' + bal0 + ' 积分');

  const usage0 = await api('/api/user/usage?days=1', { cookie });
  const cost0 = Number((usage0.data && usage0.data.cost) || 0);

  const lat = [];
  const codes = {};
  let done = 0;
  const t0 = Date.now();

  async function worker() {
    while (done < TOTAL) {
      done++;
      const s = Date.now();
      try {
        const r = await fetch(BASE + '/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
          body: JSON.stringify({ model: 'GPT-6-Astra-max', messages: [{ role: 'user', content: '压测请求 ' + done }] }),
        });
        lat.push(Date.now() - s);
        codes[r.status] = (codes[r.status] || 0) + 1;
        await r.text();
      } catch (e) {
        lat.push(Date.now() - s);
        codes['ERR'] = (codes['ERR'] || 0) + 1;
      }
    }
  }

  await Promise.all(Array.from({ length: CONC }, worker));
  const wall = (Date.now() - t0) / 1000;
  const okN = codes[200] || 0;

  console.log('\n--- 结果 ---');
  console.log('总耗时 ' + wall.toFixed(2) + 's');
  console.log('QPS ' + (TOTAL / wall).toFixed(1));
  console.log('状态码分布 ' + JSON.stringify(codes));
  console.log('延迟 P50 ' + pct(lat, 0.5) + 'ms  P95 ' + pct(lat, 0.95) + 'ms  P99 ' + pct(lat, 0.99) + 'ms  max ' + Math.max.apply(null, lat) + 'ms');

  const after = await api('/api/user/me', { cookie });
  const bal1 = Number(after.data.user.balance);
  const spent = Number((bal0 - bal1).toFixed(6));
  const usage1 = await api('/api/user/usage?days=1', { cookie });
  const logged = Number(((usage1.data && usage1.data.cost) || 0) - cost0);
  console.log('\n--- 余额一致性 ---');
  console.log('余额变化 ' + spent + ' 积分');
  console.log('本次日志累计 ' + logged.toFixed(6) + ' 积分（' + ((usage1.data && usage1.data.calls) - (usage0.data && usage0.data.calls)) + ' 次）');
  console.log('成功请求 ' + okN + ' 次，平均每次 ' + (okN ? (spent / okN).toFixed(6) : 0));
  console.log('冻结残留 ' + (after.data.user.frozen || 0) + '（应为 0）');
  const consistent = Math.abs(spent - logged) < 0.01 && Number(after.data.user.frozen || 0) === 0;
  console.log(consistent ? '✅ 一致' : '❌ 不一致');

  // 限流验证
  const rlKey = await api('/api/user/keys', { method: 'POST', cookie, body: { name: '限流-' + Date.now().toString(36), quota: 0 } });
  const rk = rlKey.data.key.key;
  const put = await api('/api/user/keys/' + rlKey.data.key.id, { method: 'PUT', cookie, body: { limit_rpm: 5 } });
  let limited = 0;
  for (let i = 0; i < 10; i++) {
    const r = await fetch(BASE + '/v1/chat/completions', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + rk },
      body: JSON.stringify({ model: 'GPT-6-Astra-max', messages: [{ role: 'user', content: 'rl' }] }),
    });
    if (r.status === 429) limited++;
    await r.text();
  }
  console.log('\n--- 限流 ---');
  console.log('RPM=5 时 10 次连发，429 次数：' + limited + (limited >= 4 ? '  ✅ 限流生效' : '  ❌ 限流未生效'));

  // 清理
  await api('/api/user/keys/' + rlKey.data.key.id, { method: 'DELETE', cookie });
  await api('/api/user/keys/' + keyRes.data.key.id, { method: 'DELETE', cookie });

  const pass = consistent && limited >= 4 && (codes[200] || 0) === TOTAL;
  console.log('\n结论：' + (pass ? '通过' : '需要检查'));
  process.exit(pass ? 0 : 2);
})().catch(e => { console.error('压测失败：', e.message); process.exit(1); });
