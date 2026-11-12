/* 公开价格页 */
(function () {
  'use strict';
  var data = [], brands = {};
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n) {
    n = Number(n) || 0;
    if (n >= 100) return n.toFixed(0);
    if (n >= 1) return n.toFixed(2);
    if (n >= 0.01) return n.toFixed(4);
    return n.toFixed(6);
  }

  function render() {
    var q = ($('#pQ').value || '').trim().toLowerCase();
    var brand = $('#pBrand').value;
    var sort = $('#pSort').value;
    var list = data.filter(function (m) {
      if (brand && m.brand !== brand) return false;
      if (!q) return true;
      return (m.id + ' ' + m.brand + ' ' + (m.tags || []).join(' ') + ' ' + m.desc).toLowerCase().indexOf(q) !== -1;
    });
    list.sort(function (a, b) {
      if (sort === 'price_asc') return a.pricing.prompt - b.pricing.prompt;
      if (sort === 'price_desc') return b.pricing.prompt - a.pricing.prompt;
      if (sort === 'ctx') return b.context_length - a.context_length;
      return a.id.localeCompare(b.id);
    });
    $('#pCount').textContent = '共 ' + list.length + ' 个模型';
    if (!list.length) { $('#pTable').innerHTML = '<div class="dk-card">没有匹配的模型</div>'; return; }
    $('#pTable').innerHTML = '<div class="dk-tbl-wrap"><table class="dk-tbl"><thead><tr>' +
      '<th>模型</th><th>品牌</th><th class="num">上下文</th><th class="num">输入（积分/1M）</th>' +
      '<th class="num">输出（积分/1M）</th><th class="num">请求费</th><th>能力</th></tr></thead><tbody>' +
      list.map(function (m) {
        return '<tr><td><b>' + esc(m.id) + '</b>' + (m.is_new ? ' <span class="dk-badge">NEW</span>' : '') +
          '<div class="dk-muted" style="max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(m.desc) + '</div></td>' +
          '<td>' + esc(m.brand_label || m.brand) + '</td>' +
          '<td class="num">' + (m.context_length >= 1000000 ? (m.context_length / 1000000) + 'M' : Math.round(m.context_length / 1000) + 'K') + '</td>' +
          '<td class="num price">' + fmt(m.pricing.prompt) + '</td>' +
          '<td class="num price">' + fmt(m.pricing.completion) + '</td>' +
          '<td class="num dk-muted">' + fmt(m.pricing.request) + '</td>' +
          '<td>' + (m.tags || []).slice(0, 2).map(function (t) { return '<span class="dk-chip">' + esc(t) + '</span>'; }).join('') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  fetch('/api/public/models').then(function (r) { return r.json(); }).then(function (d) {
    data = d.items || [];
    data.forEach(function (m) { brands[m.brand] = m.brand_label || m.brand; });
    $('#pBrand').innerHTML = '<option value="">全部品牌</option>' + Object.keys(brands).map(function (k) {
      return '<option value="' + esc(k) + '">' + esc(brands[k]) + '</option>';
    }).join('');
    render();
  }).catch(function () { $('#pTable').innerHTML = '<div class="dk-card">价格加载失败，请刷新重试</div>'; });

  ['#pQ', '#pBrand', '#pSort'].forEach(function (s) {
    $(s).addEventListener('input', render);
    $(s).addEventListener('change', render);
  });
})();
