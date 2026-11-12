'use strict';
/** 字节级一致性校验：默认数据渲染结果 vs 原始线上快照 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pageHtml, PAGE_FILES } = require('../server/render');

const ROOT = path.resolve(__dirname, '..');
const db = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/seed.json'), 'utf8'));

let bad = 0;
for (const page of Object.keys(PAGE_FILES)) {
  const orig = fs.readFileSync(path.join(ROOT, 'site', PAGE_FILES[page]), 'utf8');
  const out = pageHtml(page, db);
  const a = crypto.createHash('sha256').update(orig).digest('hex');
  const b = crypto.createHash('sha256').update(out).digest('hex');
  const ok = a === b;
  console.log(
    (ok ? 'OK   ' : 'DIFF ') + page.padEnd(8) +
    ' orig=' + orig.length + 'B  built=' + out.length + 'B  sha=' + a.slice(0, 12) + (ok ? '' : ' vs ' + b.slice(0, 12))
  );
  if (!ok) {
    bad++;
    let i = 0;
    while (i < Math.min(orig.length, out.length) && orig[i] === out[i]) i++;
    console.log('  first diff at ' + i);
    console.log('  orig: ' + JSON.stringify(orig.slice(Math.max(0, i - 80), i + 120)));
    console.log('  built: ' + JSON.stringify(out.slice(Math.max(0, i - 80), i + 120)));
  }
}
process.exit(bad ? 1 : 0);
