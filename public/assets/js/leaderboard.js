(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Number(n || 0).toLocaleString('zh-CN'); }
  function render() {
    var days = $('#lbDays').value;
    fetch('/api/public/leaderboard?days=' + days).then(function (r) { return r.json(); }).then(function (d) {
      var items = d.items || [];
      $('#lbCount').textContent = '共 ' + items.length + ' 个模型有调用';
      if (!items.length) { $('#lbTable').innerHTML = '<div class="dk-card">这段时间还没有调用记录</div>'; return; }
      $('#lbTable').innerHTML = '<table class="dk-tbl"><thead><tr><th class="num" style="width:56px">#</th><th>模型</th><th class="num">调用次数</th><th class="num">tokens</th><th class="num">消耗积分</th></tr></thead><tbody>' +
        items.map(function (x, i) {
          return '<tr><td class="num">' + (i + 1) + '</td><td><b>' + esc(x.model) + '</b></td>' +
            '<td class="num">' + num(x.calls) + '</td><td class="num">' + num(x.tokens) + '</td>' +
            '<td class="num price">' + Number(x.cost).toFixed(4) + '</td></tr>';
        }).join('') + '</tbody></table>';
    });
  }
  $('#lbDays').addEventListener('change', render);
  render();
})();
