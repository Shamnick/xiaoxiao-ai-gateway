'use strict';
/** 用户中心 10 页字节级一致性校验：本地渲染 vs 线上抓取快照 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const userSite = require('../server/user-site');
const store = require('../server/store');

const ROOT = path.resolve(__dirname, '..');
const MAP = {
  dashboard: 'dashboard.html', subscription: 'subscription.html', keys: 'keys.html',
  billing: 'billing.html', recharge: 'recharge.html', invite: 'invite.html',
  settings: 'settings.html', docs: 'docs.html', image: 'image.html', video: 'video.html',
};
const db = store.load();
let bad = 0;
for (const [page, file] of Object.entries(MAP)) {
  const orig = fs.readFileSync(path.join(ROOT, 'src-user/pages', file), 'utf8');
  const out = userSite.renderPage(page, db);
  const a = crypto.createHash('sha256').update(orig).digest('hex');
  const b = crypto.createHash('sha256').update(out).digest('hex');
  const ok = a === b;
  console.log((ok ? 'OK   ' : 'DIFF ') + page.padEnd(14) +
    ' bytes=' + Buffer.byteLength(orig) + ' sha=' + a.slice(0, 12) + (ok ? '' : ' vs ' + b.slice(0, 12)));
  if (!ok) {
    bad++;
    let i = 0;
    while (i < Math.min(orig.length, out.length) && orig[i] === out[i]) i++;
    console.log('  diff@' + i + '\n  orig : ' + JSON.stringify(orig.slice(Math.max(0, i - 60), i + 100)) +
      '\n  built: ' + JSON.stringify(out.slice(Math.max(0, i - 60), i + 100)));
  }
}
process.exit(bad ? 1 : 0);
