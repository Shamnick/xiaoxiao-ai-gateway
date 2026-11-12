/* 自建在线客服：浮窗 + 会话（落库到后台「在线客服」） */
(function () {
  'use strict';
  if (window.__ytkSupportLoaded) return;
  window.__ytkSupportLoaded = true;

  var API = '/api/support';
  var LS = 'ytk_support_thread';
  var thread = null, name = '', polling = null, unread = 0, opened = false;

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var wrap = el('div', 'ytk-s-wrap');
  var btn = el('button', '', '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9.6 9.6 0 0 1-3.8-.8L3 21l1.9-4.6A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg><span>在线客服</span><span class="dot"></span><span class="ytk-s-badge">0</span>');
  btn.id = 'ytkSupportBtn';
  wrap.appendChild(btn);

  var panel = el('div', '', '');
  panel.id = 'ytkSupportPanel';
  panel.innerHTML =
    '<div class="ytk-s-head"><b>在线客服</b><span class="st"><i></i>在线</span><button class="ytk-s-x" aria-label="关闭">×</button></div>' +
    '<div class="ytk-s-body" id="ytkSBody"><div class="ytk-s-tip">您好，这里是小小科技技术支持。<br>请描述您遇到的问题，我们会尽快回复。</div></div>' +
    '<div class="ytk-s-foot">' +
    '<input class="ytk-s-name" id="ytkSName" placeholder="您的称呼 / 账号" maxlength="32">' +
    '<textarea class="ytk-s-input" id="ytkSInput" placeholder="输入消息，Enter 发送，Shift+Enter 换行" maxlength="1000"></textarea>' +
    '<div class="ytk-s-actions"><span class="ytk-s-hint" id="ytkSHint">通常几分钟内回复</span><button class="ytk-s-send" id="ytkSSend" disabled>发送</button></div>' +
    '</div>';
  wrap.appendChild(panel);
  document.body.appendChild(wrap);

  var body = panel.querySelector('#ytkSBody');
  var input = panel.querySelector('#ytkSInput');
  var nameInput = panel.querySelector('#ytkSName');
  var sendBtn = panel.querySelector('#ytkSSend');
  var hint = panel.querySelector('#ytkSHint');

  function addMsg(m) {
    var d = el('div', 'ytk-s-msg ' + (m.role === 'agent' ? 'agent' : 'user'),
      (m.role === 'agent' ? '<span class="who">客服</span>' : '') + esc(m.text));
    body.appendChild(d);
    body.scrollTop = body.scrollHeight;
  }

  function render(messages) {
    body.innerHTML = '';
    if (!messages || !messages.length) {
      body.appendChild(el('div', 'ytk-s-tip', '您好，这里是小小科技技术支持。<br>请描述您遇到的问题，我们会尽快回复。'));
      return;
    }
    messages.forEach(addMsg);
  }

  function boot() {
    try { thread = localStorage.getItem(LS) || null; } catch (e) { thread = null; }
    name = nameInput.value.trim();
    if (thread) {
      fetch(API + '/poll?thread_id=' + encodeURIComponent(thread), { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.ok && d.thread) { nameInput.value = d.thread.name || nameInput.value; render(d.thread.messages); } })
        .catch(function () {});
    }
  }

  function startPolling() {
    if (polling) return;
    polling = setInterval(function () {
      if (!thread) return;
      fetch(API + '/poll?thread_id=' + encodeURIComponent(thread) + '&after=' + (lastCount || 0), { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (!d || !d.ok || !d.thread) return;
          var n = d.thread.messages.length;
          if (n > (lastCount || 0)) {
            var fresh = d.thread.messages.slice(lastCount || 0);
            lastCount = n;
            fresh.forEach(function (m) {
              addMsg(m);
              if (m.role === 'agent' && !opened) { unread++; updateBadge(); }
            });
          }
        }).catch(function () {});
    }, 4000);
  }
  var lastCount = 0;

  function updateBadge() {
    var b = btn.querySelector('.ytk-s-badge');
    if (!b) return;
    b.textContent = unread > 99 ? '99+' : String(unread);
    b.style.display = unread > 0 ? 'block' : 'none';
  }

  function open() {
    panel.classList.add('open');
    opened = true; unread = 0; updateBadge();
    boot();
    startPolling();
    setTimeout(function () { input.focus(); }, 60);
  }
  function close() { panel.classList.remove('open'); opened = false; }

  btn.addEventListener('click', function () { panel.classList.contains('open') ? close() : open(); });
  panel.querySelector('.ytk-s-x').addEventListener('click', close);
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('a[href="#support"], [data-support]')) {
      if (t.closest('a[href="#support"]')) e.preventDefault();
      open();
    }
  });
  // 兼容原站 data-kefu 按钮
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[data-kefu]');
    if (a) { e.preventDefault(); open(); }
  });

  function refreshSend() {
    var ok = input.value.trim().length > 0 && nameInput.value.trim().length > 0;
    sendBtn.disabled = !ok;
  }
  input.addEventListener('input', refreshSend);
  nameInput.addEventListener('input', function () { name = nameInput.value.trim(); refreshSend(); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) send(); }
  });

  function send() {
    var text = input.value.trim();
    var who = nameInput.value.trim();
    if (!text || !who) return;
    sendBtn.disabled = true; hint.textContent = '发送中…';
    fetch(API + '/send', {
      method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ thread_id: thread, name: who, text: text, source: location.pathname + location.search }),
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { hint.textContent = d.error || '发送失败'; return; }
      thread = d.thread_id;
      try { localStorage.setItem(LS, thread); } catch (e) {}
      input.value = ''; hint.textContent = '已送达，客服会尽快回复';
      lastCount = d.thread.messages.length;
      render(d.thread.messages);
      startPolling();
    }).catch(function () { hint.textContent = '网络异常，请稍后重试'; })
      .then(function () { refreshSend(); });
  }
  sendBtn.addEventListener('click', send);
  refreshSend();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refreshSend);
})();
