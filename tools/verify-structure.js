'use strict';
/** 结构完整性校验：改造为平台后不再追求与原站字节一致，
 *  改为检查每页是否完整（标签闭合、关键元素、品牌名、无残留续杯）。 */
const BASE_A1 = process.env.BASE || 'http://127.0.0.1:8848';
const BASE_U = process.env.UBASE || 'http://127.0.0.1:8849';
const A1 = ['/', '/?page=models', '/?page=terms', '/?page=privacy', '/?page=refund', '/?page=ip'];
const U = ['/?page=login'];

function count(s, re) { return (s.match(re) || []).length; }

async function check(label, url) {
  const res = await fetch(url, { redirect: 'manual' });
  const html = await res.text();
  const issues = [];
  if (!/<!DOCTYPE html>/i.test(html)) issues.push('缺少 DOCTYPE');
  if (!/<\/html>\s*$/i.test(html.trim())) issues.push('HTML 未闭合');
  const open = count(html, /<div\b/gi), close = count(html, /<\/div>/gi);
  if (open !== close) issues.push('div 开闭不平衡 ' + open + '/' + close);
  if (!html.includes('小小科技')) issues.push('缺少品牌名');
  if (/无限续杯|续杯/.test(html)) issues.push('残留续杯文案');
  if (!html.includes('/assets/js/support.js')) issues.push('客服组件未注入');
  const len = Buffer.byteLength(html);
  if (len < 3000) issues.push('页面过短 ' + len);
  console.log((issues.length ? 'FAIL ' : 'OK   ') + label.padEnd(22) + String(len).padStart(7) + 'B' + (issues.length ? '  → ' + issues.join('；') : ''));
  return issues.length;
}

(async () => {
  let bad = 0;
  for (const p of A1) bad += await check('a1 ' + p, BASE_A1 + p);
  for (const p of U) bad += await check('user ' + p, BASE_U + p);
  console.log('\n不合格页数：' + bad);
  process.exit(bad ? 1 : 0);
})();
