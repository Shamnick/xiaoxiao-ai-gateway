'use strict';
/**
 * 用户中心渲染层：以线上抓取快照为母版，按块数据做最小替换。
 * 默认数据下输出与线上响应逐字节一致（tools/verify-user.js 校验）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site-user');

const PAGE_FILES = {
  dashboard: 'pages/dashboard.html',
  subscription: 'pages/subscription.html',
  keys: 'pages/keys.html',
  billing: 'pages/billing.html',
  recharge: 'pages/recharge.html',
  invite: 'pages/invite.html',
  settings: 'pages/settings.html',
  docs: 'pages/docs.html',
  image: 'pages/image.html',
  login: 'pages/login.html',
  video: 'pages/video.html',
};

const cache = new Map();
function template(page) {
  if (!cache.has(page)) cache.set(page, fs.readFileSync(path.join(SITE, PAGE_FILES[page]), 'utf8'));
  return cache.get(page);
}

function pageHtml(page, site) {
  const pageDef = site && site.pages ? site.pages[page] : null;
  if (!pageDef) return template(page);
  let html = template(page);
  const blocks = site.blocks || {};
  pageDef.blocks.forEach(key => {
    const b = blocks[key];
    if (!b) return;
    const inner = b.html == null ? '' : b.html;
    const outer = (b.attrs || '') + inner + '</' + b.tag + '>';
    if (outer === b.orig_outer) return;
    if (!html.includes(b.orig_outer)) return;      // 已被更外层块覆盖
    html = html.split(b.orig_outer).join(outer);
  });
  return html;
}

module.exports = { pageHtml, PAGE_FILES };
