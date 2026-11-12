/* 用量统计 */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(n) { return Number(n || 0).toLocaleString('zh-CN'); }
  function money(n) { return Number(n || 0).toFixed(4); }

  fetch('/api/user/me').then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) { location.href = '/?page=login'; return; }
    $('#pfUser').textContent = d.user.username + ' · ' + d.user.balance + ' 积分';
  });

  fetch('/api/user/usage?days=14').then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) return;
    $('#kCalls').textContent = num(d.calls);
    $('#kTokens').textContent = num(d.tokens);
    $('#kCost').textContent = money(d.cost);
    $('#kErr').textContent = num(d.errors);

    var days = d.by_day.slice().reverse();
    $('#tblDay').innerHTML = days.length
      ? '<table class="pf-table"><thead><tr><th>日期</th><th class="num">调用</th><th class="num">tokens</th><th class="num">花费</th></tr></thead><tbody>' +
        days.map(function (x) {
          return '<tr><td>' + esc(x.day) + '</td><td class="num">' + num(x.calls) + '</td><td class="num">' + num(x.tokens) + '</td><td class="num">' + money(x.cost) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="pf-empty">暂无调用记录</div>';

    $('#tblModel').innerHTML = d.by_model.length
      ? '<table class="pf-table"><thead><tr><th>模型</th><th class="num">调用</th><th class="num">tokens</th><th class="num">花费</th></tr></thead><tbody>' +
        d.by_model.map(function (x) {
          return '<tr><td>' + esc(x.model) + '</td><td class="num">' + num(x.calls) + '</td><td class="num">' + num(x.tokens) + '</td><td class="num">' + money(x.cost) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="pf-empty">暂无调用记录</div>';
  });
})();
