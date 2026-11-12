'use strict';
/** 品牌改名校验：渲染结果必须等于「母版 + 仅品牌名替换」，确保除了名字没有别的改动 */
const fs = require('fs');
const path = require('path');
const render = require('../server/render');
const renderUser = require('../server/render-user');
const { transform } = require('../server/transform');
const userSite = require('../server/user-site');
const store = require('../server/store');

const ROOT = path.resolve(__dirname, '..');
const db = store.load();
const st = db.settings || {};
const A = { home: 'site/home.html', models: 'site/models.html', terms: 'site/terms.html', privacy: 'site/privacy.html', refund: 'site/refund.html', ip: 'site/ip.html' };
const U = { dashboard: 'dashboard.html', subscription: 'subscription.html', keys: 'keys.html', billing: 'billing.html',
  recharge: 'recharge.html', invite: 'invite.html', settings: 'settings.html', docs: 'docs.html', image: 'image.html', video: 'video.html' };
let bad = 0;
for (const [page, f] of Object.entries(A)) {
  const orig = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const expect = transform(render.applyBrand(orig, st), { userBase: 'http://127.0.0.1:8849' });
  const got = render.pageHtml(page, db);
  const ok = got === expect;
  if (!ok) bad++;
  console.log((ok ? 'OK   ' : 'DIFF ') + 'a1/' + page.padEnd(10) + ' ' + Buffer.byteLength(got) + 'B');
  if (!ok) {
    let i = 0; while (i < Math.min(got.length, expect.length) && got[i] === expect[i]) i++;
    console.log('  @' + i + ' got=' + JSON.stringify(got.slice(i - 40, i + 80)) + '\n      exp=' + JSON.stringify(expect.slice(i - 40, i + 80)));
  }
}
for (const [page, f] of Object.entries(U)) {
  const orig = fs.readFileSync(path.join(ROOT, 'site-user/pages', f), 'utf8');
  const expect = transform(render.applyBrand(orig, st), { userBase: 'http://127.0.0.1:8849' });
  const got = userSite.renderPage(page, db);
  const ok = got === expect;
  if (!ok) bad++;
  console.log((ok ? 'OK   ' : 'DIFF ') + 'user/' + page.padEnd(12) + ' ' + Buffer.byteLength(got) + 'B');
}
console.log('品牌：' + (st.brand_name || '-') + ' / ' + (st.brand_en || '-') + '  差异：' + bad);
process.exit(bad ? 1 : 0);
