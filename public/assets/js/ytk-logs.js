/* 账单页：注入「请求日志」面板，可展开查看请求体/响应体 */
(function () {
  'use strict';
  if (location.search.indexOf('page=billing') === -1) return;
  var main = document.querySelector('.shell-main');
  if (!main) return;
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(t) { return String(t || '').replace('T', ' ').slice(0, 19); }

  var sec = document.createElement('section');
  sec.className = 'ytk-panel';
  sec.id = 'ytkLogs';
  sec.innerHTML = '<div class="ytk-panel-head"><h2>请求日志</h2><span class="sub">最近 50 次调用，点开可看请求体与响应体</span>' +
    '<div class="right"><button class="ytk-btn" id="ytkLogRefresh">刷新</button>' +
    '<a class="ytk-btn" href="/usage">用量统计</a></div></div>' +
    '<div class="ytk-panel-body" id="ytkLogBody" style="padding:14px 18px"><div style="color:#8a97a6;font-size:13px">加载中…</div></div>';
  var head = main.querySelector('.page-head');
  main.insertBefore(sec, head ? head.nextSibling : main.firstChild);

  function pretty(t) {
    if (!t) return '<div style="color:#8a97a6;font-size:12px">未记录</div>';
    var out = t;
    try { out = JSON.stringify(JSON.parse(t), null, 2); } catch (e) {}
    return '<pre style="margin:0;padding:10px 12px;background:#0b1220;color:#cfe6ff;border-radius:8px;' +
      'font:11.5px/1.65 ui-monospace,Menlo,monospace;white-space:pre-wrap;word-break:break-word;max-height:280px;overflow:auto">' +
      esc(out) + '</pre>';
  }

  function load() {
    fetch('/api/user/logs?limit=50').then(function (r) { return r.json(); }).then(function (d) {
      var items = d.items || [];
      var box = document.getElementById('ytkLogBody');
      if (!items.length) { box.innerHTML = '<div style="color:#8a97a6;font-size:13px">还没有调用记录</div>'; return; }
      box.innerHTML = items.map(function (l, i) {
        var badge = l.status === 'success'
          ? '<span style="color:#0e9f8a;font-weight:600">成功</span>'
          : '<span style="color:#c0392b;font-weight:600">失败</span>';
        var head = '<summary style="cursor:pointer;list-style:none;display:flex;gap:12px;align-items:center;padding:9px 4px;border-bottom:1px solid #f0f4f9;font-size:13px">' +
          '<span style="color:#8a97a6;width:150px;flex:none">' + esc(fmt(l.at)) + '</span>' +
          '<b style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(l.model) + '</b>' +
          '<span style="width:90px;text-align:right;color:#6b7c8f">' + (l.prompt_tokens || 0) + '/' + (l.completion_tokens || 0) + '</span>' +
          '<span style="width:78px;text-align:right;color:#c9971a">' + Number(l.cost || 0).toFixed(4) + '</span>' +
          '<span style="width:64px;text-align:right;color:#8a97a6">' + (l.ms || 0) + 'ms</span>' +
          '<span style="width:52px;text-align:right">' + badge + '</span>' +
          '<span style="width:16px;color:#8a97a6">›</span></summary>';
        var body = '<div style="padding:10px 4px 14px 4px;border-bottom:1px solid #f0f4f9">' +
          (l.error ? '<div style="color:#c0392b;font-size:12.5px;margin-bottom:8px">错误：' + esc(l.error) + '</div>' : '') +
          '<div style="font-size:12px;color:#6b7c8f;margin:0 0 4px">请求体</div>' + pretty(l.request_body) +
          '<div style="font-size:12px;color:#6b7c8f;margin:10px 0 4px">响应体</div>' + pretty(l.response_body) +
          '</div>';
        return '<details' + (i === 0 ? '' : '') + ' style="border-bottom:1px solid #f4f7fb">' + head + body + '</details>';
      }).join('');
    }).catch(function () {
      var box = document.getElementById('ytkLogBody');
      if (box) box.textContent = '加载失败，请刷新重试';
    });
  }

  load();
  var btn = document.getElementById('ytkLogRefresh');
  if (btn) btn.addEventListener('click', load);
})();
