/* 邀请页：注入真实邀请统计与返利明细 */
(function () {
  'use strict';
  if (location.search.indexOf('page=invite') === -1) return;
  var main = document.querySelector('.shell-main');
  if (!main) return;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var sec = document.createElement('section');
  sec.className = 'ytk-panel';
  sec.id = 'ytkInvite';
  sec.innerHTML = '<div class="ytk-panel-head"><h2>我的邀请</h2><span class="sub">邀请码、返利与明细</span>' +
    '<div class="right"><button class="ytk-btn" id="ytkInvCopy">复制邀请码</button>' +
    '<a class="ytk-btn" href="/usage">用量统计</a></div></div>' +
    '<div class="ytk-panel-body" id="ytkInvBody" style="padding:16px 18px"><div style="color:#8a97a6;font-size:13px">加载中…</div></div>';
  var head = main.querySelector('.page-head');
  main.insertBefore(sec, head ? head.nextSibling : main.firstChild);

  fetch('/api/user/invite').then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) return;
    var box = document.getElementById('ytkInvBody');
    var kpi = [
      ['邀请码', d.code || '—'],
      ['已邀请', d.count + ' 人'],
      ['累计返利', Number(d.total_reward).toFixed(2) + ' 积分'],
      ['好友充值', '¥' + Number(d.recharge_amount).toFixed(2)],
      ['返利比例', d.rate + '%'],
    ];
    var cards = '<div style="display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:14px">' +
      kpi.map(function (x) {
        return '<div style="border:1px solid #e6ebf2;border-radius:10px;padding:12px 14px;background:#fafbfd">' +
          '<div style="font-size:12px;color:#8a97a6">' + esc(x[0]) + '</div>' +
          '<div style="font-size:16px;font-weight:700;margin-top:4px;word-break:break-all">' + esc(x[1]) + '</div></div>';
      }).join('') + '</div>';

    var list = (d.invitees || []).length
      ? '<table class="ytk-table" style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>' +
        '<th style="text-align:left;padding:8px 10px;color:#8a97a6;font-weight:600;border-bottom:1px solid #eef2f7">好友</th>' +
        '<th style="text-align:right;padding:8px 10px;color:#8a97a6;font-weight:600;border-bottom:1px solid #eef2f7">累计充值</th>' +
        '<th style="text-align:right;padding:8px 10px;color:#8a97a6;font-weight:600;border-bottom:1px solid #eef2f7">加入时间</th></tr></thead><tbody>' +
        d.invitees.map(function (u) {
          return '<tr><td style="padding:8px 10px;border-bottom:1px solid #f4f7fb">' + esc(u.username) + '</td>' +
            '<td style="padding:8px 10px;text-align:right;border-bottom:1px solid #f4f7fb">¥' + Number(u.paid).toFixed(2) + '</td>' +
            '<td style="padding:8px 10px;text-align:right;border-bottom:1px solid #f4f7fb;color:#8a97a6">' + esc(String(u.at || '').slice(0, 10)) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div style="color:#8a97a6;font-size:13px">还没有邀请记录，把邀请码发给朋友即可开始累计返利。</div>';

    box.innerHTML = cards + list;
    var copy = document.getElementById('ytkInvCopy');
    copy.addEventListener('click', function () {
      var text = d.code || '';
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { copy.textContent = '已复制'; setTimeout(function () { copy.textContent = '复制邀请码'; }, 1500); });
    });
  }).catch(function () {
    var box = document.getElementById('ytkInvBody');
    if (box) box.textContent = '加载失败，请刷新重试';
  });
})();
