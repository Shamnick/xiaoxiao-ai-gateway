/* 充值页：注入真实下单 / 二维码 / 轮询到账 */
(function () {
  'use strict';
  if (location.search.indexOf('page=recharge') === -1) return;
  var main = document.querySelector('.shell-main');
  if (!main) return;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var sec = document.createElement('section');
  sec.className = 'ytk-panel';
  sec.id = 'ytkRecharge';
  sec.innerHTML = '<div class="ytk-panel-head"><h2>在线充值</h2><span class="sub">1 元 = 10 积分，充值赠送 10%</span>' +
    '<div class="right"><a class="ytk-btn" href="/usage">用量统计</a></div></div>' +
    '<div class="ytk-panel-body" style="padding:16px 18px"><div class="ytk-plans" style="display:flex;gap:10px;flex-wrap:wrap"></div>' +
    '<div id="ytkRechargeMsg" style="margin-top:12px;font-size:12.5px;color:#6b7c8f"></div></div>';
  var pageHead = main.querySelector('.page-head');
  main.insertBefore(sec, pageHead ? pageHead.nextSibling : main.firstChild);

  var box = $('#ytkRecharge .ytk-plans', sec);
  fetch('/api/user/recharge/plans').then(function (r) { return r.json(); }).then(function (d) {
    box.innerHTML = (d.plans || []).map(function (p) {
      return '<button class="ytk-btn" data-amount="' + p.yuan + '" style="min-width:132px;padding:14px 16px;text-align:left">' +
        '<div style="font-size:12px;color:#8a97a6">¥' + p.yuan + '</div>' +
        '<div style="font-size:18px;font-weight:700;color:#0e9f8a">' + p.points + ' 积分</div>' +
        '<div style="font-size:11.5px;color:#8a97a6">含赠送 ' + p.bonus + '</div></button>';
    }).join('');
  });

  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-amount]');
    if (!b) return;
    var amount = Number(b.getAttribute('data-amount'));
    var msg = $('#ytkRechargeMsg');
    msg.textContent = '正在创建订单…';
    fetch('/api/user/recharge/create', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ amount: amount })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { msg.textContent = d.error || '下单失败'; return; }
      var o = d.order;
      var mask = document.createElement('div');
      mask.className = 'ytk-modal';
      mask.innerHTML = '<div class="ytk-modal-box" style="width:340px"><header>扫码支付<button type="button" data-x>×</button></header>' +
        '<div class="ytk-modal-body" style="align-items:center;text-align:center">' +
        '<div style="font-size:13px;color:#6b7c8f">订单 ' + esc(o.id) + '</div>' +
        '<div style="font-size:26px;font-weight:700">¥' + o.amount + '</div>' +
        '<div style="font-size:13px;color:#0e9f8a">到账 ' + o.points + ' 积分</div>' +
        '<div id="ytkQr" style="width:180px;height:180px;margin:10px auto;background:#fff;border-radius:10px;display:flex;align-items:center;justify-content:center"></div>' +
        '<div style="font-size:12px;color:#8a97a6" id="ytkPayTip">等待支付…</div>' +
        '<a class="ytk-btn" id="ytkPayOpen" target="_blank" rel="noopener" href="' + d.pay_url + '">打开收银台</a>' +
        '</div></div>';
      document.body.appendChild(mask);
      // 用 qrcode 库画二维码（已随用户中心加载）
      var qr = $('#ytkQr', mask);
      function qrFallback() {
        qr.innerHTML = '<a href="' + d.pay_url + '" target="_blank" rel="noopener" style="font-size:12px;color:#0e9f8a">点此打开收银台</a>';
      }
      try {
        var target = location.origin + d.pay_url;
        if (window.QRCode && typeof window.QRCode.toCanvas === 'function') {
          var canvas = document.createElement('canvas');
          qr.innerHTML = '';
          qr.appendChild(canvas);
          window.QRCode.toCanvas(canvas, target, { width: 170, margin: 1 }, function (err) { if (err) qrFallback(); });
        } else if (typeof window.QRCode === 'function') {
          new window.QRCode(qr, { text: target, width: 170, height: 170, correctLevel: 0 });
        } else { qrFallback(); }
      } catch (err) { qrFallback(); }
      mask.addEventListener('click', function (ev) {
        if (ev.target === mask || ev.target.closest('[data-x]')) mask.remove();
      });
      var timer = setInterval(function () {
        fetch('/api/user/recharge/status?order=' + encodeURIComponent(o.id)).then(function (r) { return r.json(); }).then(function (sd) {
          if (sd.ok && sd.status === 'paid') {
            clearInterval(timer);
            var tip = $('#ytkPayTip', mask);
            if (tip) tip.textContent = '支付成功，余额已更新';
            msg.textContent = '充值成功，当前余额 ' + sd.balance + ' 积分';
            setTimeout(function () { location.reload(); }, 1200);
          }
        }).catch(function () {});
      }, 2500);
      mask._timer = timer;
    }).catch(function () { msg.textContent = '网络异常，请重试'; });
  });
})();
