/* 文档页：把示例里的 host / 模型名替换成当前环境 */
(function () {
  'use strict';
  var origin = location.origin;
  ['dHost', 'dHost2', 'dHost3'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.textContent = origin;
  });
  fetch('/api/public/models').then(function (r) { return r.json(); }).then(function (d) {
    var first = (d.items || []).filter(function (m) { return m.brand === 'OpenAI'; })[0] || (d.items || [])[0];
    if (!first) return;
    ['dModel', 'dModel2', 'dModel3'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = first.id;
    });
  }).catch(function () {});
})();
