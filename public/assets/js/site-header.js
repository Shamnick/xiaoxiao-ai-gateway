/* 官网顶栏「注册 / 登录」：先弹窗让用户选「无限续杯」还是「API 直连」（结构见 includes/site-header.php）。
   脚本没加载或浏览器不支持 <dialog> 时，按钮仍是普通链接，直接去用户中心。 */
(function () {
  'use strict';
  var dlg = document.getElementById('ytEntry');
  if (!dlg || typeof dlg.showModal !== 'function') return;

  function close() {
    if (dlg.open) dlg.close();
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;

    if (t.closest('[data-entry-open]')) {
      e.preventDefault();
      var hd = document.getElementById('hd');
      if (hd) hd.classList.remove('open');
      if (!dlg.open) dlg.showModal();
      return;
    }
    if (!dlg.contains(t)) return;

    // 点在面板外的遮罩上时，事件目标是 dialog 本身
    if (t === dlg) {
      close();
      return;
    }
    if (t.closest('[data-entry-go]')) {
      close();
      return;
    }
    var shut = t.closest('[data-entry-close]');
    if (!shut) return;
    e.preventDefault();
    close();
    var sel = shut.getAttribute('data-entry-scroll');
    var target = sel ? document.querySelector(sel) : null;
    if (target) {
      var hdEl = document.getElementById('hd');
      var offset = (hdEl ? hdEl.getBoundingClientRect().height : 0) + 16;
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
    }
  });
})();
