/*! 宇天在线客服浮标 · https://kefu.yutiankejiai.com/widget.js（2026-09-04）
 *
 * 接入（一行）：
 *   <script src="https://kefu.yutiankejiai.com/widget.js" data-type="aftersale" data-from="user/recharge" defer></script>
 *     data-type     预选类型 presale | aftersale | agent | github —— ★ 能力保留但全站禁用（2026-09-04 老板拍板一律进选择页），
 *                   任何站点不得填写，守卫 check-contact-leak 会拦
 *     data-from     来源标记，落到客服端会话资料「来源」（省略 = 当前 host+path，PJAX 站点按点击时的地址算）
 *     data-hint     售后验证框预填（账号 / Key 尾号 / 订单尾号），只预填不自动通过
 *     data-button   off = 不渲染右下角浮标，只提供 YTKefu.open() 与 [data-kefu] 委托
 *     data-position left | right（默认 right）    data-label 浮标文字（默认「在线客服」）
 *
 * 页面内任意链接：<a href="兜底URL" data-kefu="" data-kefu-msg="充值：xxx" data-kefu-hint="gfsgs2311">在线客服</a>（data-kefu 留空）
 *   点击不跳转，在侧滑面板里按这些参数打开；href 只在脚本没加载到时作为兜底。
 *
 * 程序化：window.YTKefu.open({ type, msg, hint, from }) / close() / toggle() / url(opts) / destroy()
 *
 * 环境退化：微信 / QQ 内置浏览器不弹面板，直接新开 kefu 页面（这类环境里 iframe 内上传常失败）。
 * 安全：只信任来自 kefu 域的 postMessage；iframe 跨站嵌入靠 kefu nginx 的 frame-ancestors 白名单放行。
 */
(function () {
  'use strict';
  if (window.YTKefu) return;

  var BASE = 'https://kefu.yutiankejiai.com';
  var TYPES = ['presale', 'aftersale', 'agent', 'github'];
  var script = document.currentScript || (function () { var s = document.getElementsByTagName('script'); return s[s.length - 1]; })();
  var ds = (script && script.dataset) || {};
  var cfg = {
    type: TYPES.indexOf(ds.type) >= 0 ? ds.type : '',
    from: ds.from || '',
    hint: ds.hint || '',
    position: ds.position === 'left' ? 'left' : 'right',
    label: ds.label || '在线客服',
    button: ds.button !== 'off',
  };
  var ua = navigator.userAgent || '';
  var inApp = /MicroMessenger/i.test(ua) || /\bQQ\/[\d.]+/.test(ua);

  var root = null, btn = null, badge = null, panel = null, frame = null, loading = null;
  var isOpen = false, unread = 0, currentUrl = '';

  function clamp(s, n) { return String(s == null ? '' : s).slice(0, n); }
  // 默认来源 = host + path；站点用 /?page=xxx 路由时（user / a2 / a1 都是）把 page 追加进去，否则全站只剩一个主机名
  function defaultFrom() {
    var base = (location.host + location.pathname).replace(/\/+$/, '');
    var page = '';
    try { page = new URLSearchParams(location.search).get('page') || ''; } catch (e) { page = ''; }
    if (page && /^[a-z0-9_-]{1,32}$/i.test(page)) base += '/' + page;
    return clamp(base, 64);
  }
  function buildUrl(o, embed) {
    o = o || {};
    var p = new URLSearchParams();
    var type = TYPES.indexOf(o.type) >= 0 ? o.type : cfg.type;
    var from = o.from || cfg.from || defaultFrom();
    var hint = o.hint != null ? o.hint : cfg.hint;
    if (type) p.set('type', type);
    if (from) p.set('from', clamp(from, 64));
    if (hint) p.set('hint', clamp(hint, 120));
    if (o.msg) p.set('msg', clamp(o.msg, 500));
    if (embed) p.set('embed', '1');
    var q = p.toString();
    return BASE + '/chat/' + (q ? '?' + q : '');
  }

  function ensureCss() {
    if (document.getElementById('ytkf-css')) return;
    var l = document.createElement('link');
    l.id = 'ytkf-css'; l.rel = 'stylesheet'; l.href = BASE + '/widget.css';
    document.head.appendChild(l);
  }

  function ensureRoot() {
    if (root) return;
    ensureCss();
    root = document.createElement('div');
    root.className = 'ytkf-root' + (cfg.position === 'left' ? ' ytkf-left' : '');
    root.setAttribute('data-ytkf', '1');
    if (cfg.button) {
      btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'ytkf-btn'; btn.setAttribute('aria-label', cfg.label);
      btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a8 8 0 0 1-8 8H8l-4 3v-5.5A8 8 0 0 1 3 12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></svg><span></span><i class="ytkf-badge" aria-hidden="true"></i>';
      btn.querySelector('span').textContent = cfg.label;
      badge = btn.querySelector('.ytkf-badge');
      btn.addEventListener('click', function () { toggle(); });
      root.appendChild(btn);
    }
    panel = document.createElement('div');
    panel.className = 'ytkf-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '在线客服');
    root.appendChild(panel);
    document.body.appendChild(root);
  }

  function ensureFrame(url) {
    if (frame && currentUrl === url) return;
    if (!frame) {
      loading = document.createElement('div');
      loading.className = 'ytkf-loading'; loading.textContent = '正在连接客服…';
      frame = document.createElement('iframe');
      frame.className = 'ytkf-frame'; frame.title = '在线客服';
      frame.setAttribute('allow', 'clipboard-write');
      frame.addEventListener('load', function () { setTimeout(function () { if (loading) loading.classList.add('ytkf-off'); }, 300); });
      // 先给地址再挂进页面：不带地址挂上去会先触发一次空白页的 load，「正在连接客服…」0.3 秒就收起了，根本等不到聊天页
      currentUrl = url;
      frame.src = url;
      panel.appendChild(frame); panel.appendChild(loading);
      return;
    } else if (loading) {
      loading.classList.remove('ytkf-off');
    }
    currentUrl = url;
    frame.src = url;
  }

  function setBadge(n) {
    unread = Math.max(0, n | 0);
    if (!badge) return;
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.classList.toggle('ytkf-on', unread > 0);
  }

  function open(opts) {
    opts = opts || {};
    if (inApp) {
      // 微信 / QQ 内置浏览器：不弹面板，直接开 kefu 页。
      // ⚠ 不能给 window.open 传 'noopener' 特性：带它时规范要求返回 null，下面的兜底会再导航一次，
      //   结果是「新窗口开了、当前页也跳走了」。改为拿到窗口引用后手动断开 opener。
      var target = buildUrl(opts, false), w = null;
      try { w = window.open(target, '_blank'); } catch (e) { w = null; }
      if (w) { try { w.opener = null; } catch (e) { /* 跨域时不可写，忽略 */ } }
      else location.href = target;   // 弹窗被拦截（微信内常见）→ 当前页直接跳过去
      return;
    }
    ensureRoot();
    // 浮标按钮重开（不带任何新参数）时沿用现有 iframe，不要 reload：否则用户收起再点开，正在打的字就没了
    if (frame && !(opts.msg || opts.hint || opts.type || opts.from)) { /* 保持当前会话视图 */ }
    else ensureFrame(buildUrl(opts, true));
    if (!isOpen) {
      isOpen = true;
      panel.classList.add('ytkf-open');
      root.classList.add('ytkf-opened');
      requestAnimationFrame(function () { requestAnimationFrame(function () { panel.classList.add('ytkf-in'); }); });
    }
    setBadge(0);
  }
  function close() {
    if (!isOpen || !panel) return;
    isOpen = false;
    panel.classList.remove('ytkf-in');
    root.classList.remove('ytkf-opened');
    setTimeout(function () { if (!isOpen) panel.classList.remove('ytkf-open'); }, 180);
    if (btn) btn.focus({ preventScroll: true });
  }
  function toggle(opts) { if (isOpen) close(); else open(opts); }

  function onMessage(e) {
    if (e.origin !== BASE || !e.data || e.data.source !== 'ytkefu') return;
    if (e.data.type === 'close') close();
    else if (e.data.type === 'entered' && loading) loading.classList.add('ytkf-off');
    else if (e.data.type === 'admin_message' && !isOpen) setBadge(unread + 1);
  }
  function onClick(e) {
    var a = e.target && e.target.closest ? e.target.closest('[data-kefu]') : null;
    if (!a || a.closest('[data-ytkf]')) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;   // 新标签打开的手势尊重浏览器默认
    e.preventDefault();
    // 链接在打开中的模态 <dialog> 里（如官网模型广场的公告弹窗）：showModal 会让弹窗外的一切 inert，
    // 面板开在弹窗后面点不动，所以先把弹窗关掉再开面板
    var dlg = a.closest('dialog[open]');
    if (dlg && typeof dlg.close === 'function') { try { dlg.close(); } catch (err) { /* 非模态或已关 */ } }
    var t = a.getAttribute('data-kefu');
    open({ type: TYPES.indexOf(t) >= 0 ? t : '', msg: a.getAttribute('data-kefu-msg') || '', hint: a.getAttribute('data-kefu-hint') || cfg.hint, from: a.getAttribute('data-kefu-from') || '' });
  }
  function onKey(e) { if (e.key === 'Escape' && isOpen) close(); }

  function boot() {
    if (cfg.button && !inApp) ensureRoot();
    window.addEventListener('message', onMessage);
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
  }
  function destroy() {
    window.removeEventListener('message', onMessage);
    document.removeEventListener('click', onClick);
    document.removeEventListener('keydown', onKey);
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = btn = badge = panel = frame = loading = null; isOpen = false; currentUrl = ''; unread = 0;
    try { delete window.YTKefu; } catch (e) { window.YTKefu = undefined; }
  }

  window.YTKefu = { open: open, close: close, toggle: toggle, url: function (o) { return buildUrl(o, false); }, destroy: destroy, config: cfg, inApp: inApp };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
