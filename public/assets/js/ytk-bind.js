/* 把用户中心的静态母版接上真实数据：用户名 / 余额 / 消耗 / 请求次数 / 我的 Key */
(function () {
  'use strict';

  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'content-type': 'application/json' } }, opts || {}))
      .then(function (r) { return r.json(); });
  }
  function toast(msg) {
    var d = document.createElement('div');
    d.className = 'ytk-toast';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 2200);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- 用户名替换（sham → 当前用户） ---------- */
  function replaceName(user) {
    if (!user) return;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeValue && n.nodeValue.indexOf('sham') !== -1) {
        n.nodeValue = n.nodeValue.split('sham').join(user.username);
      }
    }
    Array.prototype.forEach.call(document.querySelectorAll('[data-hint="sham"]'), function (el) {
      el.setAttribute('data-hint', user.username);
    });
  }

  /* ---------- 控制台数字 ---------- */
  function bindKpi(ov) {
    var bal = document.querySelector('[data-wallet-display]');
    if (bal) bal.innerHTML = String(ov.user.balance) + '<small>积分</small>';
    Array.prototype.forEach.call(document.querySelectorAll('.kpi-card'), function (card) {
      var lab = card.querySelector('.kpi-label');
      var val = card.querySelector('.kpi-value');
      if (!lab || !val) return;
      var t = lab.textContent.trim();
      if (t.indexOf('历史总消耗') === 0) val.innerHTML = String(ov.spent) + '<small class="kpi-unit">积分</small>';
      if (t.indexOf('历史总请求次数') === 0) val.innerHTML = String(ov.calls) + '<small class="kpi-unit">次</small>';
    });
  }

  /* ---------- 我的 Key 面板 ---------- */
  function keyPanel() {
    var main = document.querySelector('.shell-main') || document.querySelector('main');
    if (!main || document.getElementById('ytkKeyPanel')) return;
    var sec = document.createElement('section');
    sec.className = 'ytk-panel';
    sec.id = 'ytkKeyPanel';
    sec.innerHTML =
      '<div class="ytk-panel-head"><h2>我的 Key</h2><span class="sub">实时数据，签发后即可调用 /v1/chat/completions</span>' +
      '<div class="right"><a class="ytk-btn" href="/playground">Playground</a>' +
      '<a class="ytk-btn" href="/usage">用量统计</a>' +
      '<button class="ytk-btn" id="ytkKeyRefresh">刷新</button>' +
      '<button class="ytk-btn primary" id="ytkKeyNew">+ 签发新 Key</button></div></div>' +
      '<div id="ytkKeyBody"><div class="ytk-empty">加载中…</div></div>';
    var issue = main.querySelector('.panel-issue');
    var pageHead = main.querySelector('.page-head');
    main.insertBefore(sec, issue || (pageHead ? pageHead.nextSibling : main.firstChild));

    function render(items) {
      var box = document.getElementById('ytkKeyBody');
      if (!box) return;
      if (!items.length) { box.innerHTML = '<div class="ytk-empty">还没有 Key，点右上角「签发新 Key」创建一把</div>'; return; }
      box.innerHTML = '<table class="ytk-table"><thead><tr><th>名称</th><th>密钥</th><th>额度</th><th>已用</th><th>状态</th><th style="width:190px">操作</th></tr></thead><tbody>' +
        items.map(function (k) {
          return '<tr><td>' + esc(k.name) + '</td>' +
            '<td class="mono">' + esc(k.masked) + '</td>' +
            '<td>' + (k.quota > 0 ? k.quota : '按余额') + '</td>' +
            '<td>' + k.used + '</td>' +
            '<td>' + (k.enabled ? '<span class="ytk-badge on">启用</span>' : '<span class="ytk-badge off">停用</span>') + '</td>' +
            '<td><div style="display:flex;gap:6px">' +
            '<button class="ytk-btn" data-act="copy" data-id="' + k.id + '">复制</button>' +
            '<button class="ytk-btn" data-act="toggle" data-id="' + k.id + '">' + (k.enabled ? '停用' : '启用') + '</button>' +
            '<button class="ytk-btn danger" data-act="del" data-id="' + k.id + '">删除</button>' +
            '</div></td></tr>';
        }).join('') + '</tbody></table>';
    }

    function load() {
      api('/api/user/keys').then(function (d) {
        if (!d.ok) { toast(d.error || '加载失败'); return; }
        window.__ytkKeys = d.items || [];
        render(window.__ytkKeys);
      });
    }

    sec.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var id = b.getAttribute('data-id');
      var k = (window.__ytkKeys || []).find(function (x) { return x.id === id; });
      if (!k) return;
      if (b.getAttribute('data-act') === 'copy') {
        navigator.clipboard.writeText(k.key).then(function () { toast('已复制完整 Key'); },
          function () { toast('复制失败，请手动选择'); });
      }
      if (b.getAttribute('data-act') === 'toggle') {
        api('/api/user/keys/' + id, { method: 'PUT', body: JSON.stringify({ enabled: !k.enabled }) })
          .then(function (d) { if (d.ok) { toast('已更新'); load(); } else toast(d.error); });
      }
      if (b.getAttribute('data-act') === 'del') {
        if (!confirm('删除后该 Key 立即失效，确认删除？')) return;
        api('/api/user/keys/' + id, { method: 'DELETE' })
          .then(function (d) { if (d.ok) { toast('已删除'); load(); } else toast(d.error); });
      }
    });

    document.getElementById('ytkKeyRefresh').addEventListener('click', load);
    document.getElementById('ytkKeyNew').addEventListener('click', function () {
      var mask = document.createElement('div');
      mask.className = 'ytk-modal';
      mask.innerHTML =
        '<div class="ytk-modal-box"><header>签发新 Key<button type="button" data-x>×</button></header>' +
        '<div class="ytk-modal-body">' +
        '<label class="ytk-field">名称<input id="ytkNewName" maxlength="40" value="密钥 ' + (window.__ytkKeys || []).length + 1 + '"></label>' +
        '<label class="ytk-field">额度（0 = 按账户余额计费）<input id="ytkNewQuota" type="number" min="0" value="0"></label>' +
        '<label class="ytk-field">可用模型（留空 = 全部）<input id="ytkNewModels" placeholder="GPT-6-Astra-max,Claude-…"></label>' +
        '</div><div class="ytk-modal-foot"><button class="ytk-btn" data-x>取消</button><button class="ytk-btn primary" id="ytkNewOk">创建</button></div></div>';
      document.body.appendChild(mask);
      mask.addEventListener('click', function (e) {
        if (e.target === mask || e.target.closest('[data-x]')) mask.remove();
        if (e.target.id === 'ytkNewOk') {
          var models = (document.getElementById('ytkNewModels').value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
          api('/api/user/keys', {
            method: 'POST', body: JSON.stringify({
              name: document.getElementById('ytkNewName').value || '密钥',
              quota: Number(document.getElementById('ytkNewQuota').value) || 0,
              models: models.length ? models : ['*'],
            })
          }).then(function (d) {
            if (!d.ok) { toast(d.error || '创建失败'); return; }
            mask.remove();
            navigator.clipboard && navigator.clipboard.writeText(d.key.key).catch(function () {});
            toast('已创建并复制：' + d.key.masked);
            load();
          });
        }
      });
    });

    load();
  }

  /* ---------- 启动 ---------- */
  api('/api/user/me').then(function (d) {
    if (!d.ok) { location.href = '/?page=login'; return; }
    replaceName(d.user);
    if (/[?&]page=keys\b/.test(location.search)) keyPanel();
    api('/api/user/overview').then(function (ov) {
      if (ov && ov.ok) bindKpi(ov);
    }).catch(function () {});
  }).catch(function () { /* ignore */ });
})();
