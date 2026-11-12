/* 登录 / 注册：接管母版表单，走本地 /api/user/* */
(function () {
  'use strict';
  var mode = /register/.test(location.search) ? 'register' : 'login';
  var form = document.querySelector('form[data-auth-pane="pwd"]');
  if (!form) return;
  var submitBtn = form.querySelector('button[type="submit"]');
  var pwdPane = form;
  var hint = document.createElement('p');
  hint.style.cssText = 'margin:10px 0 0;font-size:12.5px;color:#e35d5d;min-height:18px';
  pwdPane.appendChild(hint);

  // 追加邀请码字段（注册用）
  var invite = document.createElement('label');
  invite.className = 'auth-label';
  invite.style.display = 'none';
  invite.innerHTML = '邀请码（选填）<input class="auth-input" type="text" name="invite_code" maxlength="32" autocomplete="off" placeholder="有邀请码可填，注册后双方各得 5 积分">';
  pwdPane.insertBefore(invite, submitBtn);

  // 切换登录/注册
  var switcher = document.createElement('div');
  switcher.style.cssText = 'display:flex;gap:14px;margin:2px 0 14px;font-size:13px';
  switcher.innerHTML = '<a href="javascript:void(0)" data-mode="login" style="color:#12836f;font-weight:600">登录</a>' +
    '<a href="javascript:void(0)" data-mode="register" style="color:#8a97a6">注册新账号</a>';
  pwdPane.insertBefore(switcher, pwdPane.firstChild);

  function apply() {
    var isReg = mode === 'register';
    invite.style.display = isReg ? '' : 'none';
    if (submitBtn) submitBtn.textContent = isReg ? '注册并登录' : '登 录';
    Array.prototype.forEach.call(switcher.querySelectorAll('[data-mode]'), function (a) {
      var on = a.getAttribute('data-mode') === mode;
      a.style.color = on ? '#12836f' : '#8a97a6';
      a.style.fontWeight = on ? '600' : '400';
    });
    var title = document.querySelector('.auth-sub');
    if (title) title.textContent = isReg ? '用户中心 · 注册' : '用户中心 · 登录';
    var t = document.querySelector('.auth-tabs');
    if (t) t.style.display = 'none';
    var cf = pwdPane.querySelector('.cf-turnstile, .auth-cf');
    if (cf) cf.style.display = 'none';
  }
  switcher.addEventListener('click', function (e) {
    var a = e.target.closest('[data-mode]');
    if (!a) return;
    mode = a.getAttribute('data-mode');
    hint.textContent = '';
    apply();
  });

  function post(url, data) {
    return fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify(data),
    }).then(function (r) { return r.json(); });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var u = (form.querySelector('input[name="username"]') || {}).value || '';
    var p = (form.querySelector('input[name="password"]') || {}).value || '';
    var inv = (form.querySelector('input[name="invite_code"]') || {}).value || '';
    if (!u.trim() || !p) { hint.textContent = '请填写账号和密码'; return; }
    if (mode === 'register' && p.length < 6) { hint.textContent = '密码至少 6 位'; return; }
    submitBtn.disabled = true;
    var old = submitBtn.textContent;
    submitBtn.textContent = mode === 'register' ? '注册中…' : '登录中…';
    post(mode === 'register' ? '/api/user/register' : '/api/user/login', { username: u.trim(), password: p, invite_code: inv.trim() })
      .then(function (d) {
        if (!d.ok) { hint.textContent = d.error || '操作失败'; submitBtn.disabled = false; submitBtn.textContent = old; return; }
        location.href = '/';
      })
      .catch(function () {
        hint.textContent = '网络异常，请稍后重试';
        submitBtn.disabled = false; submitBtn.textContent = old;
      });
  });

  // 显示演示账号
  var tip = document.createElement('p');
  tip.style.cssText = 'margin:14px 0 0;font-size:12px;color:#8a97a6;line-height:1.7';
  tip.innerHTML = '演示账号：<b>sham</b> / <b>ioioio000</b><br>也可直接注册新账号（注册即送 0 积分，可在后台充）';
  pwdPane.appendChild(tip);
  apply();
})();
