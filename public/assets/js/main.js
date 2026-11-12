(function () {
  'use strict';

  /* 顶栏与首页同一条 #hd：滚动进度条、滚动后加 scrolled，窄屏汉堡展开 */
  var hd = document.getElementById('hd');
  var burger = document.getElementById('burger');
  var prog = document.getElementById('prog');
  if (hd) {
    var onNavScroll = function () {
      if (prog) {
        var doc = document.documentElement;
        var max = Math.max(1, doc.scrollHeight - window.innerHeight);
        prog.style.transform = 'scaleX(' + Math.min(1, Math.max(0, window.scrollY / max)).toFixed(4) + ')';
      }
      if (window.scrollY > 40) hd.classList.add('scrolled');
      else hd.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onNavScroll, { passive: true });
    onNavScroll();
  }
  if (hd && burger) {
    burger.addEventListener('click', function (e) {
      e.stopPropagation();
      hd.classList.toggle('open');
    });
    var navLinks = document.getElementById('navLinks');
    if (navLinks) {
      navLinks.addEventListener('click', function (e) {
        var a = e.target && e.target.closest ? e.target.closest('a') : null;
        if (a) hd.classList.remove('open');
      });
    }
  }

  document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
    anchor.addEventListener('click', function (e) {
      var id = anchor.getAttribute('href');
      if (!id || id === '#') return;
      var target = document.querySelector(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (hd) hd.classList.remove('open');
      }
    });
  });

  // 模型广场：复制完整模型名
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
    return Promise.resolve();
  }
  document.querySelectorAll('.model-copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var model = btn.getAttribute('data-model') || '';
      if (!model) return;
      var label = btn.getAttribute('data-label') || '复制';
      copyText(model).then(function () {
        btn.textContent = '已复制';
        btn.classList.add('is-copied');
        window.setTimeout(function () {
          btn.textContent = label;
          btn.classList.remove('is-copied');
        }, 1400);
      });
    });
  });

  // 模型广场：品牌 tab 过滤 + 分页（每页 25 = 5×5）
  (function () {
    var grid = document.getElementById('modelGrid');
    if (!grid) return;
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.model-card'));
    var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-brand-tab]'));
    var pager = document.getElementById('modelPager');
    var meta = pager ? pager.querySelector('.model-pager-meta') : null;
    var prevBtn = pager ? pager.querySelector('[data-page-prev]') : null;
    var nextBtn = pager ? pager.querySelector('[data-page-next]') : null;
    var empty = document.getElementById('modelEmpty');
    var PER = 25;
    var brand = 'all';
    var page = 1;

    function scrollTop() {
      var sec = document.querySelector('.models-section');
      if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function apply() {
      var filtered = cards.filter(function (c) {
        return brand === 'all' || c.getAttribute('data-brand') === brand;
      });
      var total = filtered.length;
      var pages = Math.max(1, Math.ceil(total / PER));
      if (page > pages) page = pages;
      if (page < 1) page = 1;
      cards.forEach(function (c) { c.style.display = 'none'; });
      var start = (page - 1) * PER;
      filtered.slice(start, start + PER).forEach(function (c) { c.style.display = ''; });
      if (empty) empty.hidden = total !== 0;
      if (pager) {
        if (pages <= 1) {
          pager.hidden = true;
        } else {
          pager.hidden = false;
          if (meta) meta.textContent = '第 ' + page + ' / ' + pages + ' 页 · 共 ' + total + ' 个';
          if (prevBtn) prevBtn.disabled = page <= 1;
          if (nextBtn) nextBtn.disabled = page >= pages;
        }
      }
    }
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        brand = t.getAttribute('data-brand-tab') || 'all';
        page = 1;
        tabs.forEach(function (x) { x.classList.toggle('is-active', x === t); });
        apply();
      });
    });
    if (prevBtn) prevBtn.addEventListener('click', function () { if (page > 1) { page--; apply(); scrollTop(); } });
    if (nextBtn) nextBtn.addEventListener('click', function () { page++; apply(); scrollTop(); });
    apply();
  })();

  // 模型广场：变体（-thinking 等）点击开弹窗展示。
  // 变体只存在于 data-variants，不进卡片 DOM，故不影响品牌筛选与分页。
  (function () {
    var dlg = null;
    var listEl = null;
    var titleEl = null;
    var subEl = null;

    function ensureModal() {
      if (dlg) return dlg;
      dlg = document.createElement('dialog');
      dlg.className = 'mv-modal';
      dlg.innerHTML =
        '<div class="mv-shell">' +
          '<div class="mv-head">' +
            '<div><h3 class="mv-title"></h3><p class="mv-sub"></p></div>' +
            '<button type="button" class="mv-close" aria-label="关闭">×</button>' +
          '</div>' +
          '<div class="mv-list"></div>' +
        '</div>';
      document.body.appendChild(dlg);
      titleEl = dlg.querySelector('.mv-title');
      subEl = dlg.querySelector('.mv-sub');
      listEl = dlg.querySelector('.mv-list');
      dlg.querySelector('.mv-close').addEventListener('click', function () { dlg.close(); });
      // 点遮罩关闭
      dlg.addEventListener('click', function (e) {
        if (e.target === dlg) dlg.close();
      });
      listEl.addEventListener('click', function (e) {
        var btn = e.target instanceof Element ? e.target.closest('.mv-copy') : null;
        if (!btn) return;
        var model = btn.getAttribute('data-model') || '';
        if (!model) return;
        copyText(model).then(function () {
          btn.textContent = '已复制';
          window.setTimeout(function () { btn.textContent = '复制'; }, 1400);
        });
      });
      return dlg;
    }

    function open(card) {
      var raw = card.getAttribute('data-variants') || '';
      var items;
      try { items = JSON.parse(raw); } catch (err) { return; }
      if (!items || !items.length) return;
      ensureModal();
      var nameEl = card.querySelector('.model-name');
      var base = nameEl ? nameEl.textContent.trim() : '模型';
      titleEl.textContent = base + ' · 变体模型';
      subEl.textContent = '共 ' + items.length + ' 个变体，点击右侧按钮复制完整模型名';
      listEl.innerHTML = '';
      items.forEach(function (v) {
        var div = document.createElement('div');
        div.className = 'mv-item' + (v.disabled ? ' is-disabled' : '');
        var row = document.createElement('div');
        row.className = 'mv-row';
        var nm = document.createElement('span');
        nm.className = 'mv-name';
        nm.textContent = v.name || '';
        var cp = document.createElement('button');
        cp.type = 'button';
        cp.className = 'mv-copy';
        cp.setAttribute('data-model', v.name || '');
        cp.textContent = '复制';
        row.appendChild(nm);
        row.appendChild(cp);
        div.appendChild(row);
        if (v.desc) {
          var p = document.createElement('p');
          p.className = 'mv-desc';
          p.textContent = v.desc;
          div.appendChild(p);
        }
        if (v.price || v.disabled) {
          var meta = document.createElement('div');
          meta.className = 'mv-meta';
          if (v.price) {
            var pr = document.createElement('span');
            pr.className = 'mv-price';
            pr.textContent = v.price;
            meta.appendChild(pr);
          }
          if (v.disabled) {
            var bd = document.createElement('span');
            bd.className = 'mv-badge';
            bd.textContent = '当前不可用';
            meta.appendChild(bd);
          }
          div.appendChild(meta);
        }
        listEl.appendChild(div);
      });
      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
    }

    document.addEventListener('click', function (e) {
      var t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest('.model-copy') || t.closest('.model-refill')) return; // 卡片上的复制按钮优先
      var card = t.closest('.model-card.has-variants');
      if (card) open(card);
    });
  })();

  // 模型广场：进入页面自动弹出使用说明公告
  var noticeModal = document.getElementById('modelNoticeModal');
  if (noticeModal && typeof noticeModal.showModal === 'function') {
    try { noticeModal.showModal(); } catch (e) { /* ignore */ }
    document.querySelectorAll('[data-notice-close]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        try { noticeModal.close(); } catch (e) { /* ignore */ }
      });
    });
    // 点击遮罩空白处关闭
    noticeModal.addEventListener('click', function (e) {
      if (e.target === noticeModal) {
        try { noticeModal.close(); } catch (err) { /* ignore */ }
      }
    });
  }

  // 首页按钮：已在首页（非模型广场）时平滑回到顶部，否则正常跳转首页
  var homeLink = document.querySelector('.nav-home');
  if (homeLink) {
    homeLink.addEventListener('click', function (e) {
      var onModels = /[?&]page=models/.test(window.location.search);
      if (!onModels && (window.location.pathname === '/' || window.location.pathname === '')) {
        e.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (links) links.classList.remove('open');
      }
    });
  }

})();
