'use strict';
/**
 * 渲染层：以原站字节快照（site/*.html）为母版，按数据做"最小替换"。
 * 设计目标：默认数据下输出必须与线上响应 100% 字节一致（tools/verify.js 校验）。
 */
const fs = require('fs');
const path = require('path');

const { transform } = require('./transform');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, 'site');

const PAGE_FILES = {
  home: 'home.html',
  models: 'models.html',
  terms: 'terms.html',
  privacy: 'privacy.html',
  refund: 'refund.html',
  ip: 'ip.html',
};

const DEFAULT_SETTINGS = {
  kefu_base: 'https://kefu.yutiankejiai.com',
  refill_url: 'https://a10.yutiankejiai.com/client/',
  user_center: 'https://user.yutiankejiai.com/',
  brand_name: '小小科技',
  brand_en: 'Xiaoxiao Technology',
};

/** 品牌名替换：长串优先，避免"宇天科技"被短串先拆开 */
function applyBrand(html, settings) {
  const st = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  const cn = st.brand_name || DEFAULT_SETTINGS.brand_name;
  const en = st.brand_en || DEFAULT_SETTINGS.brand_en;
  let out = String(html);
  out = out.split('宇天科技').join(cn);
  out = out.split('Yutian Technology').join(en);
  out = out.split('YUTIAN').join((en.split(/\s+/)[0] || en).toUpperCase());
  out = out.split('Yutian').join(en.split(/\s+/)[0] || en);
  out = out.split('宇天').join(cn.replace(/科技$/, ''));
  return out;
}

const cache = new Map();

function template(page) {
  if (!cache.has(page)) cache.set(page, fs.readFileSync(path.join(SITE, PAGE_FILES[page]), 'utf8'));
  return cache.get(page);
}

/** 只转义标签相关字符，保留 &nbsp; 等既有实体 */
function escT(v) {
  return String(v == null ? '' : v).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escA(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---------------- 模型卡片 ---------------- */
function renderCard(m, settings) {
  const st = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  const brand = m.brand;
  const cls = 'model-card' + (m.is_new ? ' is-new' : '') + (m.has_variants ? ' has-variants' : '');
  let out = '<article class="' + cls + '" data-brand="' + escA(brand) + '">';
  if (m.has_variants) {
    out += 'data-variants="' + escA(JSON.stringify(m.variants || [])) + '"';
  }
  if (m.is_new) out += '<span class="model-badge-new">上新</span>';
  out += '<div class="model-head"><span class="model-logo model-logo--' + escA(brand) + (m.logo ? ' has-img' : '') + '">';
  if (m.logo) {
    out += '<img src="' + (m.logo_src || ('assets/img/brands/' + brand + '.svg')) + '" alt="' + escA(brand) +
      '" width="22" height="22" loading="lazy" decoding="async">';
  }
  out += '</span><div class="model-head-main"><div class="model-name-row"><h3 class="model-name">' + escT(m.name) + '</h3>';
  out += '<button type="button" class="model-copy" data-model="' + escA(m.name) + '" data-label="复制" aria-label="复制模型名 ' +
    escA(m.name) + '">复制</button>';
  out += '</div></div></div><div class="model-tags">';
  (m.tags || []).forEach(t => {
    out += '<span class="model-tag' + (t.cls ? ' ' + t.cls : '') + '">' + escT(t.text) + '</span>';
  });
  out += '</div><p class="model-desc">' + escT(m.desc) + '</p>';
  out += '<div class="model-foot' + (m.has_refill ? ' has-refill' : '') + '">';
  out += '<span class="model-vendor">' + escT(m.vendor) + '</span>';
  out += '<span class="model-price"' + (m.price_attrs || '') + '>' + escT(m.price) + '</span>';
  if (m.refill_html != null) {
    const at = String(m.refill_attrs || '').split('https://a10.yutiankejiai.com/client/').join(st.refill_url);
    out += '<a class="model-refill"' + at + '>' + m.refill_html + '</a>';
  }
  out += '</div></article>';
  return out;
}

function renderGrid(sec, models, settings) {
  const list = (models || [])
    .filter(m => m.enabled !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map(m => renderCard(m, settings))
    .join('');
  return (sec.grid_prefix || '') + list + (sec.grid_suffix || '');
}

function renderTabs(sec, brands) {
  const list = (brands || [])
    .filter(b => b.enabled !== false)
    .sort((a, b) => (a.order || 0) - (b.order || 0))
    .map((b, i) => '<button type="button" class="model-tab' + (i === 0 ? ' is-active' : '') +
      '" data-brand-tab="' + escA(b.id) + '">' + (typeof escT === 'function' ? escT(b.label) : b.label) + '</button>')
    .join(sec.tabs_prefix || '\n                  ');
  return (sec.tabs_prefix || '') + list + (sec.tabs_suffix || '');
}

/* ---------------- 公告弹窗 ---------------- */
function renderNotice(origInner, notice) {
  if (!notice) return origInner;
  if (notice.enabled === false) return null;
  let inner = origInner;
  if (notice.title) {
    inner = inner.replace(/(<h2>)([\s\S]*?)(<\/h2>)/, (a, s, _old, e) => s + notice.title + e);
  }
  if (notice.badge) {
    inner = inner.replace(/(<span class="model-notice-badge">)([\s\S]*?)(<\/span>)/, (a, s, _old, e) => s + notice.badge + e);
  }
  if (Array.isArray(notice.items)) {
    const lis = notice.items.map(t => '<li>' + t + '</li>').join('\n          ');
    inner = inner.replace(/(<ul class="model-notice-list">)([\s\S]*?)(<\/ul>)/,
      (a, s, _old, e) => s + '\n          ' + lis + '\n        ' + e);
  }
  return inner;
}

/* ---------------- 全局链接替换 ---------------- */
function applySettings(html, settings) {
  const st = Object.assign({}, DEFAULT_SETTINGS, settings || {});
  let out = html;
  if (st.kefu_base && st.kefu_base !== DEFAULT_SETTINGS.kefu_base) {
    out = out.split(DEFAULT_SETTINGS.kefu_base).join(st.kefu_base);
  }
  if (st.refill_url && st.refill_url !== DEFAULT_SETTINGS.refill_url) {
    out = out.split(DEFAULT_SETTINGS.refill_url).join(st.refill_url);
  }
  if (st.user_center && st.user_center !== DEFAULT_SETTINGS.user_center) {
    out = out.split(DEFAULT_SETTINGS.user_center).join(st.user_center);
  }
  if (st.analytics) {
    out = out.replace('</body>', st.analytics + '\n</body>');
  }
  return out;
}

/* ---------------- 单页渲染 ---------------- */
function pageHtml(page, db, opts) {
  const blocks = db.blocks || {};
  const settings = db.settings || {};
  const pageBlocks = db.pages && db.pages[page] ? db.pages[page].blocks : [];
  let html = template(page);

  const replaceBlock = (key) => {
    const b = blocks[key];
    if (!b) return;
    const st = Object.assign({}, DEFAULT_SETTINGS, settings);
    let inner = b.html;
    if (b.tpl_outer) {
      const gridInner = renderGrid(b, db.models, st);
      const tabsInner = renderTabs(b, db.brands);
      const outer = b.tpl_outer
        .split('\u0000GRID\u0000').join(gridInner)
        .split('\u0000TABS\u0000').join(tabsInner);
      html = html.split(b.orig_outer).join(outer);
      return;
    }
    if (/id="modelNoticeModal"/.test(b.attrs || '')) {
      const ni = renderNotice(inner, db.notice);
      if (ni === null) { html = html.split(b.orig_outer).join(''); return; }
      inner = ni;
    }
    if (inner === b.html && /https?:\/\//.test(inner)) {
      // 让全局链接设置也能作用于未编辑的区块
    }
    const outer = (b.attrs || '') + inner + '</' + b.tag + '>';
    html = html.split(b.orig_outer).join(outer);
  };

  ['common:header', 'common:entry', 'common:footer'].forEach(replaceBlock);
  pageBlocks.forEach(replaceBlock);

  html = applySettings(html, settings);
  html = applyBrand(html, settings);
  html = transform(html, { userBase: (opts && opts.userBase) || '' });
  return html;
}

module.exports = { pageHtml, renderCard, renderGrid, renderTabs, renderNotice, applyBrand, PAGE_FILES, DEFAULT_SETTINGS };
