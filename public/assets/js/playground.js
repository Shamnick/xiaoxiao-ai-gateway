/* Playground：调用本平台 OpenAI 兼容接口 */
(function () {
  'use strict';
  var $ = function (s) { return document.querySelector(s); };
  var models = [], keys = [], abort = null;
  var out = $('#pfOut'), meta = $('#pfMeta');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(n) { return Number(n || 0).toFixed(5); }

  fetch('/api/user/me').then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) { location.href = '/?page=login'; return; }
    $('#pfUser').textContent = d.user.username + ' · ' + d.user.balance + ' 积分';
  });

  fetch('/api/v1/models').then(function (r) { return r.json(); }).then(function (d) {
    models = (d.data || []);
    $('#pfModel').innerHTML = models.map(function (m) {
      return '<option value="' + esc(m.id) + '">' + esc(m.id) + '（' + esc(m.provider_label || m.owned_by) + ' · ' + m.context_length + ' ctx）</option>';
    }).join('');
  });

  fetch('/api/user/keys').then(function (r) { return r.json(); }).then(function (d) {
    keys = (d.items || []).filter(function (k) { return k.enabled; });
    if (!keys.length) {
      out.textContent = '还没有可用的 API Key，请先到「我的 Key」签发一把。';
    }
  });

  function send() {
    var key = keys[0];
    if (!key) { out.textContent = '没有可用的 API Key'; return; }
    var model = $('#pfModel').value;
    var sys = $('#pfSystem').value.trim();
    var prompt = $('#pfPrompt').value.trim();
    if (!prompt) { out.textContent = '请输入内容'; return; }
    var msgs = [];
    if (sys) msgs.push({ role: 'system', content: sys });
    msgs.push({ role: 'user', content: prompt });
    var stream = $('#pfStream').checked;
    out.textContent = '';
    meta.textContent = '';
    $('#pfSend').disabled = true;
    $('#pfStop').disabled = false;
    abort = new AbortController();
    var t0 = Date.now();
    var acc = '';

    fetch('/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key.key },
      body: JSON.stringify({ model: model, messages: msgs, stream: stream }),
      signal: abort.signal,
    }).then(function (res) {
      if (!res.ok) {
        return res.json().then(function (e) {
          out.textContent = '错误：' + ((e.error && e.error.message) || res.status);
          throw new Error('stop');
        });
      }
      if (!stream) return res.json().then(function (d) {
        var txt = d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : '';
        out.textContent = txt;
        showMeta(d.usage, Date.now() - t0, model);
      });
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { showMeta(null, Date.now() - t0, model, acc); return; }
          buf += dec.decode(r.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          lines.forEach(function (line) {
            line = line.trim();
            if (!line.startsWith('data:')) return;
            var payload = line.slice(5).trim();
            if (payload === '[DONE]') return;
            try {
              var j = JSON.parse(payload);
              var delta = j.choices && j.choices[0] && j.choices[0].delta;
              if (delta && delta.content) { acc += delta.content; out.textContent = acc; }
            } catch (e) { /* ignore */ }
          });
          return pump();
        });
      }
      return pump();
    }).catch(function (e) {
      if (e.message !== 'stop') out.textContent = out.textContent || ('请求失败：' + e.message);
    }).then(function () {
      $('#pfSend').disabled = false;
      $('#pfStop').disabled = true;
      abort = null;
    });
  }

  function showMeta(usage, ms, model, text) {
    var pt = usage ? usage.prompt_tokens : Math.ceil(($('#pfPrompt').value.length) / 2);
    var ct = usage ? usage.completion_tokens : Math.ceil(((text || '').length) / 2);
    var m = models.find(function (x) { return x.id === model; }) || {};
    var pr = m.pricing || {};
    var cost = (Number(pr.request) || 0) + pt / 1000 * (Number(pr.prompt) || 0) + ct / 1000 * (Number(pr.completion) || 0);
    meta.innerHTML = '模型 <b>' + esc(model) + '</b> · 输入 <b>' + pt + '</b> tok · 输出 <b>' + ct +
      '</b> tok · 耗时 <b>' + ms + 'ms</b> · 本次约扣 <b>' + fmt(cost) + '</b> 积分';
  }

  $('#pfSend').addEventListener('click', send);
  $('#pfStop').addEventListener('click', function () { if (abort) abort.abort(); });
  $('#pfPrompt').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
  });
})();
