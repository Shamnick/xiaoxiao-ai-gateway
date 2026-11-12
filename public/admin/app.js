/* 小小科技站点管理后台 · 控制台脚本 */
(function () {
  'use strict';

  /* ---------------- 基础工具 ---------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }
  function money(n) {
    const v = Number(n) || 0;
    return '¥' + v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return String(iso);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function num(n) { return (Number(n) || 0).toLocaleString('zh-CN'); }

  const UBASE = location.protocol + '//' + location.hostname + ':' + (location.port === '8848' ? '8849' : location.port);

  const state = {
    admin: null,
    route: '',
    vs: {},           // 每个视图的查询状态
    cache: {},
  };

  function vs(id, def) {
    if (!state.vs[id]) state.vs[id] = Object.assign({ q: '', page: 1, size: 20 }, def || {});
    return state.vs[id];
  }

  /* ---------------- API ---------------- */
  async function api(path, opts) {
    const o = opts || {};
    const init = { method: o.method || 'GET', credentials: 'same-origin', headers: {} };
    if (o.body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(o.body);
    }
    let res;
    try {
      res = await fetch('/api/admin' + path, init);
    } catch (e) {
      throw new Error('网络错误：无法连接服务');
    }
    let data = {};
    try { data = await res.json(); } catch (e) { /* ignore */ }
    if (res.status === 401) {
      if (path !== '/me') {
        toast(data.error || '会话已过期，请重新登录', 'err');
        showLogin();
      }
      const err = new Error(data.error || '未登录');
      err.unauthorized = true;
      throw err;
    }
    if (!res.ok) throw new Error(data.error || ('请求失败（' + res.status + '）'));
    return data;
  }

  /* ---------------- 提示 / 模态 / 确认 ---------------- */
  function toast(msg, type) {
    const t = document.createElement('div');
    t.className = 'toast ' + (type === 'err' ? 'err' : 'ok');
    t.innerHTML = '<span class="ic">' + (type === 'err' ? '⚠' : '✓') + '</span><span>' + esc(msg) + '</span>';
    $('#toastWrap').appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .2s, transform .2s';
      t.style.opacity = '0';
      t.style.transform = 'translateX(12px)';
      setTimeout(() => t.remove(), 220);
    }, type === 'err' ? 4200 : 2400);
  }

  let modalCleanup = null;
  function openModal(cfg) {
    $('#modalTitle').textContent = cfg.title || '编辑';
    $('#modalBody').innerHTML = cfg.body || '';
    $('#modalFoot').innerHTML = cfg.footer || '';
    $('#modalMask').hidden = false;
    if (typeof cfg.onMount === 'function') cfg.onMount($('#modalBody'), $('#modalFoot'));
    modalCleanup = cfg.onClose || null;
  }
  function closeModal() {
    $('#modalMask').hidden = true;
    $('#modalBody').innerHTML = '';
    if (modalCleanup) { try { modalCleanup(); } catch (e) { /* ignore */ } modalCleanup = null; }
  }

  let confirmResolve = null;
  function askConfirm(text, title, okLabel) {
    $('#confirmText').textContent = text;
    $('#confirmTitle').textContent = title || '确认操作';
    $('#confirmOk').textContent = okLabel || '确认';
    $('#confirmMask').hidden = false;
    return new Promise(resolve => { confirmResolve = resolve; });
  }

  /* ---------------- 登录 / 外壳 ---------------- */
  function showLogin() {
    state.admin = null;
    $('#shellView').hidden = true;
    $('#loginView').hidden = false;
    const remembered = localStorage.getItem('ytk_admin_user');
    if (remembered) $('#loginUser').value = remembered;
    setTimeout(() => ($('#loginUser').value ? $('#loginPass') : $('#loginUser')).focus(), 60);
  }

  function showShell() {
    $('#loginView').hidden = true;
    $('#shellView').hidden = false;
    const a = state.admin || {};
    $('#uname').textContent = a.nickname || a.username || 'admin';
    $('#avatarText').textContent = String(a.username || 'A').slice(0, 1).toUpperCase();
  }

  const NAV = [
    { group: '概览', items: [{ id: 'dashboard', label: '控制台', icon: '▦' }] },
    {
      group: '内容', items: [
        { id: 'models', label: '模型管理', icon: '✦' },
        { id: 'brands', label: '品牌分类', icon: '◈' },
        { id: 'notice', label: '公告弹窗', icon: '!' },
        { id: 'pages', label: '页面区块', icon: '≣' },
      ]
    },
    {
      group: '用户中心', items: [
        { id: 'ucPlans', label: '订阅套餐', icon: '❖' },
        { id: 'ucPages', label: '控制台页面', icon: '❒' },
        { id: 'ucRedeem', label: '兑换码', icon: '⌘' },
        { id: 'ucProfile', label: '账户资料', icon: '☺' },
      ]
    },
    {
      group: '中转运营', items: [
        { id: 'channels', label: '上游渠道', icon: '⇄' },
        { id: 'logs', label: '调用日志', icon: '≡' },
        { id: 'support', label: '在线客服', icon: '✆' },
      ]
    },
    {
      group: '运营', items: [
        { id: 'users', label: '用户管理', icon: '☰' },
        { id: 'orders', label: '订单管理', icon: '¥' },
        { id: 'tickets', label: '客服工单', icon: '✉' },
        { id: 'leads', label: '商务线索', icon: '◎' },
      ]
    },
    {
      group: '系统', items: [
        { id: 'settings', label: '站点设置', icon: '⚙' },
        { id: 'security', label: '账号与安全', icon: '⚿' },
        { id: 'audit', label: '操作日志', icon: '⟲' },
      ]
    },
  ];

  function renderNav() {
    const cur = state.route;
    const counts = state.cache.counts || {};
    $('#sideNav').innerHTML = NAV.map(g =>
      '<div class="nav-group"><div class="nav-group-title">' + g.group + '</div>' +
      g.items.map(it => {
        const badge = counts[it.id] ? '<span class="badge info">' + counts[it.id] + '</span>' : '';
        return '<button class="nav-item' + (cur === it.id ? ' active' : '') + '" data-act="nav" data-id="' + it.id + '">' +
          '<span class="ico">' + it.icon + '</span><span>' + it.label + '</span>' + badge + '</button>';
      }).join('') + '</div>'
    ).join('');
  }

  /* ---------------- 路由 ---------------- */
  const VIEWS = {};

  function parseHash() {
    const h = (location.hash || '#/dashboard').replace(/^#\/?/, '');
    const id = h.split('?')[0] || 'dashboard';
    return VIEWS[id] ? id : 'dashboard';
  }

  async function route() {
    if (!state.admin) return;
    state.route = parseHash();
    renderNav();
    const v = VIEWS[state.route];
    $('#crumb').textContent = v.title;
    $('#content').innerHTML = '<div class="card"><div class="skeleton">' +
      '<i style="width:32%"></i><i style="width:64%"></i><i style="width:48%"></i><i style="width:72%"></i></div></div>';
    try {
      const html = await v.render();
      if (state.route !== v.id) return;
      $('#content').innerHTML = html;
      if (typeof v.mount === 'function') v.mount();
      renderNav();
    } catch (e) {
      if (e.unauthorized) return;
      $('#content').innerHTML = '<div class="card"><div class="empty"><b>加载失败</b>' + esc(e.message) + '</div></div>';
    }
  }

  function go(id) {
    if (state.route === id) { route(); return; }
    location.hash = '#/' + id;
  }

  /* ---------------- 通用片段 ---------------- */
  function pagerHTML(p) {
    return '<div class="pager">' +
      '<span>共 <b>' + num(p.total) + '</b> 条 · 第 ' + p.page + ' / ' + p.pages + ' 页</span>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-sm" data-act="page" data-p="' + (p.page - 1) + '"' + (p.page <= 1 ? ' disabled' : '') + '>上一页</button>' +
      '<button class="btn btn-sm" data-act="page" data-p="' + (p.page + 1) + '"' + (p.page >= p.pages ? ' disabled' : '') + '>下一页</button>' +
      '</div>';
  }

  function emptyHTML(title, sub) {
    return '<div class="empty"><b>' + esc(title || '暂无数据') + '</b>' + esc(sub || '换个筛选条件试试') + '</div>';
  }

  /* ---------------- 控制台 ---------------- */
  VIEWS.dashboard = {
    id: 'dashboard',
    title: '控制台',
    async render() {
      const d = await api('/overview');
      state.cache.overview = d;
      const trend = d.trend || [];
      const maxPv = Math.max(1, ...trend.map(t => t.pv));
      const brands = d.top_models || [];
      const maxB = Math.max(1, ...brands.map(b => b.count));
      return '' +
        '<div class="grid g4">' +
        statCard('accent', '模型总数', num(d.models), '已上架 ' + d.models_online + ' · 品牌 ' + d.brands) +
        statCard('ok', '今日访问', num(d.pv_today), '近 14 天趋势见右图') +
        statCard('pink', '用户总数', num(d.users), '活跃 ' + d.users_active + ' 人') +
        statCard('warn', '累计成交', money(d.revenue), '订单 ' + d.orders + ' · 今日 ' + d.orders_today) +
        '</div>' +
        '<div class="grid g32" style="margin-top:16px">' +
        '<div class="card"><div class="card-head"><h3>访问趋势</h3><span class="sub">PV / 近 14 天</span>' +
        '<div class="right"><span class="badge info">今日 ' + num(d.pv_today) + '</span></div></div>' +
        '<div class="card-pad"><div class="chart-box"><canvas class="chart" id="chartPv"></canvas></div>' +
        '<div class="help" style="margin-top:8px">数据来自前台真实访问打点 + 历史样本，页面切走会暂停渲染但不影响统计。</div></div></div>' +
        '<div class="card"><div class="card-head"><h3>品牌分布</h3><span class="sub">按模型数</span></div><div class="card-pad">' +
        '<div class="brandbars">' + brands.map(b =>
          '<div class="brandbar"><span class="ellipsis">' + esc(b.brand) + '</span>' +
          '<span class="bar"><i style="width:' + Math.round(b.count / maxB * 100) + '%"></i></span>' +
          '<span class="num" style="text-align:right">' + b.count + '</span></div>').join('') +
        '</div></div></div>' +
        '</div>' +
        '<div class="grid g2" style="margin-top:16px">' +
        '<div class="card"><div class="card-head"><h3>最近订单</h3><a class="right" href="#/orders">全部 →</a></div><div class="card-pad">' +
        '<div class="orders-mini">' + (d.recent_orders || []).map(o =>
          '<div class="row"><span class="mono">' + esc(o.id) + '</span><b class="grow ellipsis">' + esc(o.username) + '</b>' +
          '<span>' + esc(o.plan) + '</span><b>' + money(o.amount) + '</b>' + orderBadge(o.status) + '</div>').join('') +
        '</div></div></div>' +
        '<div class="card"><div class="card-head"><h3>最近操作</h3><a class="right" href="#/audit">全部 →</a></div><div class="card-pad">' +
        '<div class="orders-mini">' + (d.recent_audit || []).map(a =>
          '<div class="row"><span class="mono">' + fmtDate(a.at) + '</span><b class="grow ellipsis">' + esc(a.actor) + '</b>' +
          '<span class="ellipsis">' + esc(a.detail || a.action) + '</span></div>').join('') +
        '</div></div></div></div>';
    },
    mount() {
      drawLineChart($('#chartPv'), (state.cache.overview || {}).trend || []);
    },
  };

  function statCard(cls, lab, val, sub) {
    return '<div class="stat ' + cls + '"><div class="lab">' + lab + '</div><div class="val">' + val +
      '</div><div class="sub">' + esc(sub) + '</div></div>';
  }

  function drawLineChart(canvas, data) {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    if (!data.length) return;
    const pad = { l: 34, r: 10, t: 12, b: 22 };
    const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
    const max = Math.max(1, ...data.map(d => d.pv));
    const stepX = data.length > 1 ? iw / (data.length - 1) : 0;
    // 网格
    ctx.strokeStyle = 'rgba(90,140,200,.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + ih * i / 4;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + iw, y); ctx.stroke();
      ctx.fillStyle = '#6d829c'; ctx.font = '10px system-ui';
      ctx.fillText(String(Math.round(max * (1 - i / 4))), 4, y + 3);
    }
    const pts = data.map((d, i) => ({ x: pad.l + stepX * i, y: pad.t + ih * (1 - d.pv / max) }));
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + ih);
    grad.addColorStop(0, 'rgba(34,211,238,.34)');
    grad.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pad.t + ih);
    pts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(pts[pts.length - 1].x, pad.t + ih);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(34,211,238,.65)'; ctx.shadowBlur = 10;
    ctx.stroke(); ctx.shadowBlur = 0;
    pts.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = '#c9f7ff'; ctx.fill();
    });
    ctx.fillStyle = '#6d829c'; ctx.font = '10px system-ui';
    const labelIdx = [0, Math.floor((data.length - 1) / 2), data.length - 1];
    labelIdx.forEach(i => {
      const t = data[i].day.slice(5);
      const x = Math.min(Math.max(pts[i].x - 12, pad.l), pad.l + iw - 24);
      ctx.fillText(t, x, h - 6);
    });
  }

  function orderBadge(s) {
    const map = { paid: ['on', '已支付'], pending: ['warn', '待支付'], refunded: ['danger', '已退款'], closed: ['off', '已关闭'] };
    const m = map[s] || ['off', s || '—'];
    return '<span class="badge ' + m[0] + '">' + esc(m[1]) + '</span>';
  }
  function userBadge(s) {
    const map = { active: ['on', '正常'], expired: ['warn', '已过期'], banned: ['danger', '已封禁'] };
    const m = map[s] || ['off', s || '—'];
    return '<span class="badge ' + m[0] + '">' + esc(m[1]) + '</span>';
  }
  function ticketBadge(s) {
    const map = { open: ['warn', '待处理'], pending: ['info', '已回复'], closed: ['off', '已关闭'] };
    const m = map[s] || ['off', s || '—'];
    return '<span class="badge ' + m[0] + '">' + esc(m[1]) + '</span>';
  }

  /* ---------------- 模型管理 ---------------- */
  const TAG_PRESETS = ['1M 上下文', '推理', '视觉理解', '函数调用', '网页搜索', '文件搜索', '提示缓存', '结构化输出', 'MCP', '长文本'];

  VIEWS.models = {
    id: 'models',
    title: '模型管理',
    async render() {
      const s = vs('models');
      const q = new URLSearchParams({ page: s.page, size: s.size, q: s.q || '', brand: s.brand || '', status: s.status || '' });
      const data = await api('/models?' + q.toString());
      const brands = (state.cache.brands && state.cache.brands.items) || [];
      const bl = {};
      brands.forEach(b => { bl[b.id] = b.label; });
      const rows = data.items.map((m, i) => {
        const tags = (m.tags || []).slice(0, 3).map(t => '<span class="chip">' + esc(t.text) + '</span>').join('') +
          ((m.tags || []).length > 3 ? '<span class="chip">+' + (m.tags.length - 3) + '</span>' : '');
        return '<tr data-id="' + m.id + '">' +
          '<td><input type="checkbox" class="rowck" data-id="' + m.id + '"></td>' +
          '<td class="num">' + (i + 1 + (data.page - 1) * data.size) + '</td>' +
          '<td><div class="cell-main">' + esc(m.name) + (m.is_new ? ' <span class="badge pink">上新</span>' : '') + '</div>' +
          '<div class="cell-sub">' + esc((m.desc || '').slice(0, 46)) + '</div></td>' +
          '<td>' + esc(bl[m.brand] || m.brand) + '<div class="cell-sub">' + esc(m.vendor || '') + '</div></td>' +
          '<td>' + (tags || '<span class="cell-sub">—</span>') + '</td>' +
          '<td class="num">' + esc(m.price || '—') + '</td>' +
          '<td>' + (m.has_refill ? '<span class="badge info">续杯</span>' : '<span class="badge off">无</span>') + '</td>' +
          '<td>' + (m.enabled === false ? '<span class="badge off">已下架</span>' : '<span class="badge on">已上架</span>') + '</td>' +
          '<td><div class="acts">' +
          '<button class="link-btn" data-act="model-edit" data-id="' + m.id + '">编辑</button>' +
          '<button class="link-btn" data-act="model-toggle" data-id="' + m.id + '">' + (m.enabled === false ? '上架' : '下架') + '</button>' +
          '<button class="link-btn" data-act="model-up" data-id="' + m.id + '">↑</button>' +
          '<button class="link-btn" data-act="model-down" data-id="' + m.id + '">↓</button>' +
          '<button class="link-btn danger" data-act="model-del" data-id="' + m.id + '">删除</button>' +
          '</div></td></tr>';
      }).join('');

      return '' +
        '<div class="card"><div class="card-head"><h3>模型库</h3><span class="sub">共 ' + data.total + ' 个模型 · 前台模型广场实时同步</span>' +
        '<div class="right"><a class="btn btn-sm" href="/?page=models" target="_blank" rel="noopener">预览模型广场</a>' +
        '<button class="btn btn-sm btn-primary" data-act="model-new">+ 新建模型</button></div></div>' +
        '<div class="card-pad">' +
        '<div class="toolbar">' +
        '<input class="inp search-inp" id="modelQ" placeholder="搜索模型名 / 描述 / 标签" value="' + esc(s.q || '') + '">' +
        '<select class="sel" id="modelBrand"><option value="">全部品牌</option>' +
        brands.map(b => '<option value="' + esc(b.id) + '"' + (s.brand === b.id ? ' selected' : '') + '>' + esc(b.label) + '</option>').join('') +
        '</select>' +
        '<select class="sel" id="modelStatus">' +
        '<option value="">全部状态</option><option value="on"' + (s.status === 'on' ? ' selected' : '') + '>已上架</option>' +
        '<option value="off"' + (s.status === 'off' ? ' selected' : '') + '>已下架</option></select>' +
        '<button class="btn btn-sm" data-act="model-query">查询</button>' +
        '<button class="btn btn-sm btn-ghost" data-act="model-reset">重置</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-sm" data-act="bulk" data-id="on">批量上架</button>' +
        '<button class="btn btn-sm" data-act="bulk" data-id="off">批量下架</button>' +
        '<button class="btn btn-sm btn-danger" data-act="bulk" data-id="del">批量删除</button>' +
        '</div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th style="width:34px"><input type="checkbox" id="ckAll"></th><th class="num" style="width:52px">#</th>' +
        '<th>模型名称</th><th>品牌 / 厂商</th><th>标签</th><th class="num">单价</th><th>续杯</th><th>状态</th><th style="width:230px">操作</th>' +
        '</tr></thead><tbody>' + (rows || '<tr><td colspan="9">' + emptyHTML('没有符合条件的模型') + '</td></tr>') + '</tbody></table></div>' +
        pagerHTML(data) + '</div></div>';
    },
    mount() {
      const s = vs('models');
      const runQuery = () => {
        s.q = $('#modelQ').value.trim();
        s.brand = $('#modelBrand').value;
        s.status = $('#modelStatus').value;
        s.page = 1;
        route();
      };
      $('#modelQ').addEventListener('keydown', e => { if (e.key === 'Enter') runQuery(); });
      $('#ckAll').addEventListener('change', e => {
        $$('.rowck').forEach(c => { c.checked = e.target.checked; });
      });
    },
  };

  const REFILL_ATTR = ' href="https://a10.yutiankejiai.com/client/" target="_blank" rel="noopener noreferrer" data-tip="去使用无限额度" aria-label="去使用无限额度"';

  function openModelModal(m) {
    const isNew = !m;
    const model = m || { name: '', brand: '', tags: [], desc: '', price: '', is_new: false, has_refill: true, enabled: true, logo: true };
    api('/brands').then(bd => {
      const brands = bd.items || [];
      const tagText = (model.tags || []).map(t => t.text).join('\n');
      const firstIsCtx = (model.tags || [])[0] && (model.tags[0].cls || '').indexOf('is-ctx') >= 0;
      openModal({
        title: isNew ? '新建模型' : '编辑模型 · ' + model.name,
        body: '' +
          '<div class="field row2">' +
          '<div><label class="fl">模型名称 *</label><input class="inp" id="fName" style="width:100%" value="' + esc(model.name) + '" placeholder="例如 GPT-6-Astra-max"></div>' +
          '<div><label class="fl">品牌 *</label><select class="sel" id="fBrand" style="width:100%">' +
          '<option value="">选择品牌</option>' +
          brands.map(b => '<option value="' + esc(b.id) + '"' + (model.brand === b.id ? ' selected' : '') + '>' + esc(b.label) + '</option>').join('') +
          '</select></div></div>' +
          '<div class="field row2">' +
          '<div><label class="fl">单价文案</label><input class="inp" id="fPrice" style="width:100%" value="' + esc(model.price) + '" placeholder="¥0.267/次"></div>' +
          '<div><label class="fl">厂商（默认同品牌）</label><input class="inp" id="fVendor" style="width:100%" value="' + esc(model.vendor || '') + '"></div></div>' +
          '<div class="field"><label class="fl">模型描述</label><textarea class="inp" id="fDesc" style="width:100%;min-height:90px" placeholder="一句话说明模型能力、上下文与适用场景">' + esc(model.desc) + '</textarea></div>' +
          '<div class="field"><label class="fl">标签（每行一个）</label>' +
          '<textarea class="inp" id="fTags" style="width:100%;min-height:88px" placeholder="1M 上下文&#10;推理&#10;视觉理解">' + esc(tagText) + '</textarea>' +
          '<div class="tag-suggest">' + TAG_PRESETS.map(t => '<button type="button" data-tag="' + esc(t) + '">+ ' + esc(t) + '</button>').join('') + '</div>' +
          '<div class="hint">第一个标签可标记为「上下文」徽标，显示为高亮标签。</div></div>' +
          '<div class="field"><label class="switch"><input type="checkbox" id="fCtx"' + (firstIsCtx ? ' checked' : '') + '><i></i>首个标签使用上下文样式</label></div>' +
          '<div class="field row2">' +
          '<label class="switch"><input type="checkbox" id="fNew"' + (model.is_new ? ' checked' : '') + '><i></i>标记「上新」</label>' +
          '<label class="switch"><input type="checkbox" id="fRefill"' + (model.has_refill !== false ? ' checked' : '') + '><i></i>显示无限续杯</label>' +
          '</div><div class="field row2">' +
          '<label class="switch"><input type="checkbox" id="fLogo"' + (model.logo !== false ? ' checked' : '') + '><i></i>显示品牌图标</label>' +
          '<label class="switch"><input type="checkbox" id="fEnabled"' + (model.enabled !== false ? ' checked' : '') + '><i></i>前台可见（上架）</label>' +
          '</div>' +
          '<div class="field"><label class="fl">变体模型（JSON，可留空）</label>' +
          '<textarea class="inp" id="fVariants" style="width:100%;min-height:70px;font-family:var(--mono);font-size:12px" placeholder=\'[{"name":"xxx-thinking","desc":"变体说明","price":"¥0.3/次"}]\'>' +
          esc(model.has_variants ? JSON.stringify(model.variants || []) : '') + '</textarea>' +
          '<div class="hint">填写后前台点击卡片会弹出变体列表；留空则不弹。</div></div>',
        footer: '<button class="btn" data-act="modal-close">取消</button>' +
          '<button class="btn btn-primary" id="fSave">' + (isNew ? '创建模型' : '保存修改') + '</button>',
        onMount(body) {
          $$('[data-tag]', body).forEach(b => b.addEventListener('click', () => {
            const ta = $('#fTags');
            const cur = ta.value.split('\n').map(x => x.trim()).filter(Boolean);
            if (!cur.includes(b.dataset.tag)) cur.push(b.dataset.tag);
            ta.value = cur.join('\n');
          }));
          $('#fSave').addEventListener('click', async () => {
            const name = $('#fName').value.trim();
            const brand = $('#fBrand').value;
            if (!name) return toast('请填写模型名称', 'err');
            if (!brand) return toast('请选择品牌', 'err');
            const tagLines = $('#fTags').value.split('\n').map(x => x.trim()).filter(Boolean);
            const tags = tagLines.map((t, i) => ({ cls: (i === 0 && $('#fCtx').checked) ? 'is-ctx' : '', text: t }));
            let variants = [];
            const vraw = $('#fVariants').value.trim();
            if (vraw) {
              try {
                variants = JSON.parse(vraw);
                if (!Array.isArray(variants)) throw new Error('need array');
              } catch (e) {
                return toast('变体 JSON 格式不正确，应为数组', 'err');
              }
            }
            const price = $('#fPrice').value.trim();
            const payload = {
              name, brand, tags,
              desc: $('#fDesc').value,
              vendor: $('#fVendor').value.trim() || brand,
              price,
              price_attrs: price ? ' title="' + price.replace(/"/g, '&quot;') + '"' : '',
              is_new: $('#fNew').checked,
              has_refill: $('#fRefill').checked,
              logo: $('#fLogo').checked,
              enabled: $('#fEnabled').checked,
              has_variants: variants.length > 0,
              variants,
              refill_attrs: REFILL_ATTR,
              refill_html: '无限续杯时¥0.00/次<i>限时</i>',
            };
            try {
              if (isNew) await api('/models', { method: 'POST', body: payload });
              else await api('/models/' + model.id, { method: 'PUT', body: payload });
              closeModal();
              toast(isNew ? '模型已创建，前台已同步' : '已保存，前台已同步');
              route();
            } catch (e) { toast(e.message, 'err'); }
          });
        },
      });
    }).catch(e => toast(e.message, 'err'));
  }

  /* ---------------- 品牌分类 ---------------- */
  VIEWS.brands = {
    id: 'brands',
    title: '品牌分类',
    async render() {
      const d = await api('/brands');
      state.cache.brands = d;
      const items = d.items || [];
      const models = (state.cache.overview || {}).top_models || [];
      const counts = {};
      models.forEach(m => { counts[m.brand] = m.count; });
      return '<div class="card"><div class="card-head"><h3>品牌分类</h3><span class="sub">前台模型广场的筛选 Tab，按顺序展示</span>' +
        '<div class="right"><button class="btn btn-sm btn-primary" data-act="brand-new">+ 新增品牌</button></div></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr>' +
        '<th class="num" style="width:60px">排序</th><th>品牌标识</th><th>展示名称</th><th>LOGO</th><th>状态</th><th style="width:220px">操作</th></tr></thead><tbody>' +
        (items.map((b, i) => '<tr>' +
          '<td class="num">' + (i + 1) + '</td>' +
          '<td class="mono">' + esc(b.id) + '</td>' +
          '<td class="cell-main">' + esc(b.label) + '</td>' +
          '<td class="mono cell-sub">' + esc(b.logo || '—') + '</td>' +
          '<td>' + (b.enabled === false ? '<span class="badge off">已隐藏</span>' : '<span class="badge on">展示中</span>') + '</td>' +
          '<td><div class="acts">' +
          '<button class="link-btn" data-act="brand-edit" data-id="' + esc(b.id) + '">编辑</button>' +
          '<button class="link-btn" data-act="brand-toggle" data-id="' + esc(b.id) + '">' + (b.enabled === false ? '显示' : '隐藏') + '</button>' +
          '<button class="link-btn" data-act="brand-up" data-id="' + esc(b.id) + '">↑</button>' +
          '<button class="link-btn" data-act="brand-down" data-id="' + esc(b.id) + '">↓</button>' +
          '<button class="link-btn danger" data-act="brand-del" data-id="' + esc(b.id) + '">删除</button>' +
          '</div></td></tr>').join('') || '<tr><td colspan="6">' + emptyHTML('还没有品牌') + '</td></tr>') +
        '</tbody></table></div>' +
        '<div class="card-pad help">提示：品牌标识同时决定 LOGO 路径 <code>assets/img/brands/&lt;id&gt;.svg</code>；删除品牌前需先清空该品牌下的模型。</div></div>';
    },
  };

  /* ---------------- 公告弹窗 ---------------- */
  VIEWS.notice = {
    id: 'notice',
    title: '公告弹窗',
    async render() {
      const n = await api('/notice');
      state.cache.notice = n;
      const items = n.items || [];
      return '<div class="grid g32">' +
        '<div class="card"><div class="card-head"><h3>模型广场使用说明</h3><span class="sub">进入模型广场时自动弹出的公告</span></div>' +
        '<div class="card-pad">' +
        '<div class="field"><label class="switch"><input type="checkbox" id="nEnabled"' + (n.enabled !== false ? ' checked' : '') + '><i></i>启用公告弹窗</label></div>' +
        '<div class="field row2"><div><label class="fl">小标题（badge）</label><input class="inp" id="nBadge" style="width:100%" value="' + esc(n.badge || '') + '"></div>' +
        '<div><label class="fl">主标题</label><input class="inp" id="nTitle" style="width:100%" value="' + esc(n.title || '') + '"></div></div>' +
        '<div class="field"><label class="fl">公告条目</label><div id="nItems">' +
        items.map((t, i) => '<div style="display:flex;gap:8px;margin-bottom:8px"><input class="inp" style="flex:1" data-nitem value="' + esc(t) + '">' +
          '<button class="btn btn-sm btn-danger" data-act="notice-delitem" data-id="' + i + '">删除</button></div>').join('') +
        '</div><button class="btn btn-sm" data-act="notice-additem">+ 添加条目</button>' +
        '<div class="hint">支持 HTML 片段（如 &lt;strong&gt;加粗&lt;/strong&gt;），前台原样渲染。</div></div>' +
        '<div class="toolbar"><button class="btn btn-primary" data-act="notice-save">保存公告</button>' +
        '<a class="btn" href="/?page=models" target="_blank" rel="noopener">前台查看</a></div>' +
        '</div></div>' +
        '<div class="card"><div class="card-head"><h3>实时预览</h3></div><div class="card-pad">' +
        '<iframe class="preview-frame" style="height:520px" src="/admin/preview/models?t=' + Date.now() + '"></iframe>' +
        '<div class="help" style="margin-top:8px">预览为完整页面，公告自动弹出；保存后刷新预览即可看到最新内容。</div>' +
        '</div></div></div>';
    },
  };

  /* ---------------- 页面区块 ---------------- */
  const PAGE_LABELS = { home: '品牌首页', models: '模型广场', terms: '使用条款', privacy: '隐私政策', refund: '退款政策', ip: '知识产权', common: '全站公共' };

  VIEWS.pages = {
    id: 'pages',
    title: '页面区块',
    async render() {
      const s = vs('pages', { page: 'home', key: '' });
      const d = await api('/blocks' + (s.page ? '?page=' + encodeURIComponent(s.page) : ''));
      state.cache.blocks = d;
      let items = d.items || [];
      if (s.page === 'common') items = items.filter(b => b.page === 'common');
      const cur = items.find(b => b.key === s.key) || items[0] || null;
      if (cur) s.key = cur.key;
      const pages = ['home', 'models', 'terms', 'privacy', 'refund', 'ip', 'common'];
      return '<div class="split">' +
        '<div class="card"><div class="card-head"><h3>页面</h3></div><div class="list-nav">' +
        pages.map(p => '<button class="' + (s.page === p ? 'active' : '') + '" data-act="page-pick" data-id="' + p + '">' +
          PAGE_LABELS[p] + '<span class="cnt">' + ((d.items || []).filter(b => b.page === p).length || '') + '</span></button>').join('') +
        '</div><div class="card-pad help">每个区块对应页面上的一段真实 DOM，编辑后保存立即生效；默认内容与线上完全一致。</div></div>' +
        '<div class="card"><div class="card-head"><h3>' + (cur ? esc(cur.title || cur.key) : '选择区块') + '</h3>' +
        '<span class="sub mono">' + (cur ? esc(cur.key) : '') + '</span>' +
        '<div class="right">' + (cur && cur.tag === 'section' ? '<a class="btn btn-sm" href="/admin/preview/' + s.page + '?t=' + Date.now() + '" target="_blank" rel="noopener">打开页面预览</a>' : '') +
        '<button class="btn btn-sm btn-primary" data-act="block-save"' + (cur && !cur.driver ? '' : ' disabled') + '>保存区块</button></div></div>' +
        '<div class="card-pad">' +
        (cur ? '<div class="field"><label class="fl">区块标题（仅后台展示）</label><input class="inp" id="blockTitle" style="width:100%" value="' + esc(cur.title || '') + '"></div>' +
          '<div class="field"><label class="fl">区块 HTML</label>' +
          '<textarea class="editor" id="blockHtml">\n' + esc(cur.html || '') + '</textarea>' +
          '<div class="hint">共 ' + (cur.html || '').length + ' 字符 · 保存后前台即时生效</div></div>' : emptyHTML('该页面没有可编辑区块')) +
        '</div></div></div>';
    },
  };

  /* ---------------- 中转运营：上游渠道 ---------------- */
  VIEWS.channels = {
    id: 'channels',
    title: '上游渠道',
    async render() {
      const d = await api('/channels');
      state.cache.channels = d.items || [];
      const rows = (d.items || []).map(c =>
        '<tr><td><div class="cell-main">' + esc(c.name) + '</div><div class="cell-sub mono">' + esc(c.id) + '</div></td>' +
        '<td><span class="badge ' + (c.type === 'mock' ? 'info' : 'pink') + '">' + esc(c.type) + '</span></td>' +
        '<td class="mono cell-sub">' + esc(c.base_url || '（内置）') + '</td>' +
        '<td>' + ((c.models || []).slice(0, 3).map(m => '<span class="chip">' + esc(m) + '</span>').join('') || '—') + '</td>' +
        '<td class="num">' + esc(c.weight || 1) + '</td>' +
        '<td>' + (c.enabled === false ? '<span class="badge off">停用</span>' :
          (c.status === 'down' ? '<span class="badge danger">熔断中</span>' :
           c.status === 'warn' ? '<span class="badge warn">异常</span>' :
           '<span class="badge on">正常</span>')) +
          '<div class="cell-sub mono">' + (c.last_check ? fmtDate(c.last_check).slice(5) : '未检测') + (c.latency_ms ? ' · ' + c.latency_ms + 'ms' : '') + '</div></td>' +
        '<td><div class="acts"><button class="link-btn" data-act="ch-check" data-id="' + esc(c.id) + '">检测</button>' +
        '<button class="link-btn" data-act="ch-edit" data-id="' + esc(c.id) + '">编辑</button>' +
        '<button class="link-btn" data-act="ch-toggle" data-id="' + esc(c.id) + '">' + (c.enabled === false ? '启用' : '停用') + '</button>' +
        '<button class="link-btn danger" data-act="ch-del" data-id="' + esc(c.id) + '">删除</button></div></td></tr>').join('');
      return '<div class="card"><div class="card-head"><h3>上游渠道</h3><span class="sub">调用 /v1/chat/completions 时按模型匹配渠道转发；未匹配则走内置演示渠道</span>' +
        '<div class="right"><button class="btn btn-sm btn-primary" data-act="ch-new">+ 新增渠道</button></div></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>渠道</th><th>类型</th><th>上游地址</th><th>模型</th><th class="num">权重</th><th>状态</th><th style="width:180px">操作</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="7">' + emptyHTML('还没有渠道') + '</td></tr>') + '</tbody></table></div>' +
        '<div class="card-pad help">支持填 OpenAI 兼容上游（如 New API / one-api 的 /v1 地址），模型填 <code>*</code> 表示该渠道承接全部模型。</div></div>';
    },
  };

  /* ---------------- 中转运营：调用日志 ---------------- */
  VIEWS.logs = {
    id: 'logs',
    title: '调用日志',
    async render() {
      const s = vs('logs');
      const d = await api('/logs?' + new URLSearchParams({ page: s.page, size: s.size, q: s.q || '', status: s.status || '' }));
      const rows = (d.items || []).map(l =>
        '<tr><td class="mono cell-sub">' + fmtDate(l.at) + '</td>' +
        '<td class="mono">' + esc(l.username || l.user_id) + '</td>' +
        '<td class="cell-main">' + esc(l.model) + '</td>' +
        '<td class="num">' + (l.prompt_tokens || 0) + ' / ' + (l.completion_tokens || 0) + '</td>' +
        '<td class="num">' + (Number(l.cost) || 0).toFixed(3) + '</td>' +
        '<td class="num">' + (l.ms || 0) + 'ms</td>' +
        '<td>' + (l.status === 'success' ? '<span class="badge on">成功</span>' : '<span class="badge danger">失败</span>') + '</td>' +
        '<td class="cell-sub">' + esc((l.error || '') + (l.stream ? 'stream' : '')) + '</td></tr>').join('');
      return '<div class="card"><div class="card-head"><h3>调用日志</h3><span class="sub">共 ' + d.total + ' 条</span></div><div class="card-pad">' +
        '<div class="toolbar"><input class="inp search-inp" id="logQ" placeholder="搜索模型 / 用户 / 错误" value="' + esc(s.q || '') + '">' +
        '<select class="sel" id="logStatus"><option value="">全部状态</option>' +
        [['success', '成功'], ['error', '失败']].map(x => '<option value="' + x[0] + '"' + (s.status === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') +
        '</select><button class="btn btn-sm" data-act="log-query">查询</button></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>时间</th><th>用户</th><th>模型</th><th class="num">输入/输出 token</th><th class="num">扣费</th><th class="num">耗时</th><th>状态</th><th>备注</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="8">' + emptyHTML('还没有调用记录') + '</td></tr>') + '</tbody></table></div>' +
        pagerHTML(d) + '</div></div>';
    },
  };

  /* ---------------- 中转运营：在线客服 ---------------- */
  VIEWS.support = {
    id: 'support',
    title: '在线客服',
    async render() {
      const s = vs('support', { id: '' });
      const d = await api('/support/threads');
      const items = d.items || [];
      state.cache.support = items;
      const cur = items.find(t => t.id === s.id) || items[0] || null;
      if (cur) s.id = cur.id;
      const msgs = cur ? (cur.messages || []).map(m =>
        '<div class="msg' + (m.role === 'agent' ? ' admin' : '') + '"><div class="who">' +
        (m.role === 'agent' ? '客服 · ' + esc(m.by || 'admin') : esc(m.name || cur.name)) + ' · ' + fmtDate(m.at) + '</div>' + esc(m.text) + '</div>').join('') : '';
      return '<div class="split">' +
        '<div class="card"><div class="card-head"><h3>会话</h3>' + (d.unread ? '<span class="badge danger">' + d.unread + ' 条新消息</span>' : '') + '</div><div class="list-nav">' +
        (items.map(t => '<button class="' + (cur && cur.id === t.id ? 'active' : '') + '" data-act="sup-pick" data-id="' + t.id + '">' +
          esc(t.name) + '<span class="cnt">' + (t.messages || []).length + '</span></button>').join('') || '<div class="empty">还没有会话</div>') +
        '</div></div>' +
        '<div class="card"><div class="card-head"><h3>' + (cur ? esc(cur.name) : '选择会话') + '</h3>' +
        '<span class="sub">' + (cur ? esc(cur.source || '') : '') + '</span></div><div class="card-pad">' +
        (cur ? '<div class="msg-list" id="supMsgs">' + (msgs || '<div class="help">暂无消息</div>') + '</div>' +
          '<div class="divider"></div><label class="fl">回复</label>' +
          '<textarea class="inp" id="supReply" style="width:100%;min-height:80px" placeholder="输入回复内容，Ctrl+Enter 发送"></textarea>' +
          '<div class="toolbar" style="margin-top:10px"><button class="btn btn-primary" data-act="sup-send" data-id="' + cur.id + '">发送回复</button>' +
          '<button class="btn" data-act="sup-close" data-id="' + cur.id + '">标记已处理</button></div>'
          : emptyHTML('左侧选择会话')) +
        '</div></div></div>';
    },
    mount() {
      const ta = $('#supReply');
      if (ta) ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('[data-act="sup-send"]').click(); } });
    },
  };

  /* ---------------- 用户中心：订阅套餐 ---------------- */
  VIEWS.ucPlans = {
    id: 'ucPlans',
    title: '订阅套餐',
    async render() {
      const d = await api('/uc/plans');
      state.cache.ucPlans = d.items || [];
      const rows = (d.items || []).map((p, i) =>
        '<tr><td class="num">' + (i + 1) + '</td>' +
        '<td><div class="cell-main">' + esc(p.name) + '</div><div class="cell-sub mono">' + esc(p.id) + ' · ' + esc(p.category) + '</div></td>' +
        '<td class="cell-sub">' + esc(p.subtitle || '—') + '</td>' +
        '<td class="num"><b>¥' + esc(p.price) + '</b></td>' +
        '<td>' + esc(p.period || '') + '</td>' +
        '<td class="num">' + esc(p.daily) + '</td>' +
        '<td class="num">' + esc(p.concurrency) + '</td>' +
        '<td>' + (p.visible === false ? '<span class="badge off">已下架</span>' : '<span class="badge on">在售</span>') + '</td>' +
        '<td><div class="acts"><button class="link-btn" data-act="uc-plan-edit" data-id="' + esc(p.id) + '">编辑</button>' +
        '<button class="link-btn" data-act="uc-plan-toggle" data-id="' + esc(p.id) + '">' + (p.visible === false ? '上架' : '下架') + '</button></div></td></tr>').join('');
      return '<div class="card"><div class="card-head"><h3>无限额度订阅套餐</h3><span class="sub">共 ' + (d.items || []).length + ' 个 · 修改后前台订阅页即时生效</span>' +
        '<div class="right"><a class="btn btn-sm" href="' + UBASE + '/?page=subscription" target="_blank" rel="noopener">预览订阅页</a></div></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th class="num" style="width:52px">#</th><th>套餐</th><th>定位</th>' +
        '<th class="num">价格</th><th>周期</th><th class="num">每日额度</th><th class="num">并发</th><th>状态</th><th style="width:130px">操作</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="9">' + emptyHTML('还没有套餐') + '</td></tr>') + '</tbody></table></div>' +
        '<div class="card-pad help">套餐卡片对应前台「无限额度订阅」页的 5 张卡：改价格 / 名称 / 特性 / 额度后会同步替换前台 HTML，其余结构保持逐字节不变。</div></div>';
    },
  };

  /* ---------------- 用户中心：兑换码 ---------------- */
  VIEWS.ucRedeem = {
    id: 'ucRedeem',
    title: '兑换码',
    async render() {
      const d = await api('/uc/redeem');
      state.cache.ucRedeem = d.items || [];
      const plans = (state.cache.ucPlans || []);
      const rows = (d.items || []).map(c =>
        '<tr><td class="mono">' + esc(c.code) + '</td><td>' + esc(c.plan) + '</td>' +
        '<td class="num">' + esc(c.days) + ' 天</td><td class="num">' + esc(c.concurrency) + ' 路</td>' +
        '<td>' + (c.used ? '<span class="badge off">已使用</span>' : '<span class="badge on">可用</span>') + '</td>' +
        '<td class="mono cell-sub">' + fmtDate(c.created_at) + '</td>' +
        '<td><div class="acts"><button class="link-btn" data-act="uc-redeem-copy" data-id="' + esc(c.code) + '">复制</button>' +
        '<button class="link-btn" data-act="uc-redeem-reset" data-id="' + esc(c.code) + '">重置</button>' +
        '<button class="link-btn danger" data-act="uc-redeem-del" data-id="' + esc(c.code) + '">删除</button></div></td></tr>').join('');
      return '<div class="card"><div class="card-head"><h3>订阅兑换码</h3><span class="sub">用户在前台「兑换订阅」输入后立即生成专属 Key</span>' +
        '<div class="right"><button class="btn btn-sm btn-primary" data-act="uc-redeem-new">+ 生成兑换码</button></div></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>兑换码</th><th>套餐</th><th class="num">时长</th><th class="num">并发</th><th>状态</th><th>创建时间</th><th style="width:160px">操作</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="7">' + emptyHTML('还没有兑换码') + '</td></tr>') + '</tbody></table></div>' +
        '<div class="card-pad help">可用套餐：' + (plans.map(p => esc(p.name) + '（¥' + esc(p.price) + '）').join('、') || '—') + '</div></div>';
    },
  };

  /* ---------------- 用户中心：账户资料 ---------------- */
  VIEWS.ucProfile = {
    id: 'ucProfile',
    title: '账户资料',
    async render() {
      const p = await api('/uc/profile');
      state.cache.ucProfile = p;
      return '<div class="grid g2"><div class="card"><div class="card-head"><h3>用户中心账户</h3></div><div class="card-pad">' +
        '<div class="field row2"><div><label class="fl">登录名</label><input class="inp" id="ucUser" style="width:100%" value="' + esc(p.username || '') + '"></div>' +
        '<div><label class="fl">昵称</label><input class="inp" id="ucNick" style="width:100%" value="' + esc(p.nickname || '') + '"></div></div>' +
        '<div class="field row2"><div><label class="fl">邮箱</label><input class="inp" id="ucEmail" style="width:100%" value="' + esc(p.email || '') + '"></div>' +
        '<div><label class="fl">手机</label><input class="inp" id="ucPhone" style="width:100%" value="' + esc(p.phone || '') + '"></div></div>' +
        '<div class="field row2"><div><label class="fl">积分余额</label><input class="inp" id="ucPoints" type="number" step="1" style="width:100%" value="' + esc(p.points) + '"></div>' +
        '<div><label class="fl">钱包余额（元）</label><input class="inp" id="ucBalance" type="number" step="0.01" style="width:100%" value="' + esc(p.balance) + '"></div></div>' +
        '<div class="field"><label class="fl">当前套餐</label><input class="inp" id="ucPlan" style="width:100%" value="' + esc(p.plan || '') + '" placeholder="留空表示未订阅"></div>' +
        '<div class="field"><label class="fl">备注</label><textarea class="inp" id="ucNote" style="width:100%;min-height:70px">' + esc(p.note || '') + '</textarea></div>' +
        '<button class="btn btn-primary" data-act="uc-profile-save">保存资料</button>' +
        '</div></div>' +
        '<div class="card"><div class="card-head"><h3>数据概览</h3></div><div class="card-pad">' +
        '<dl class="kv"><dt>注册时间</dt><dd>' + fmtDate(p.joined) + '</dd>' +
        '<dt>订阅数</dt><dd>' + ((state.cache.ucSubs || []).length) + '</dd>' +
        '<dt>Key 数</dt><dd>' + ((state.cache.ucKeys || []).length) + '</dd>' +
        '<dt>演示账号</dt><dd>数据取自线上抓取快照，可在「控制台页面」逐块改文案</dd></dl>' +
        '<div class="help" style="margin-top:12px">积分与余额为账户数据，前台展示由页面区块控制；两者都在本后台可改。</div>' +
        '</div></div></div>';
    },
  };

  /* ---------------- 用户中心：页面区块 ---------------- */
  const UC_PAGES = [
    ['dashboard', '控制台首页'], ['subscription', '无限额度订阅'], ['keys', '我的 Key'],
    ['billing', '积分账单'], ['recharge', '充值积分'], ['invite', '邀请有奖'],
    ['settings', '个人设置'], ['docs', 'API 文档'], ['image', '图片生成'], ['video', '视频生成'],
  ];

  VIEWS.ucPages = {
    id: 'ucPages',
    title: '控制台页面',
    async render() {
      const s = vs('ucPages', { page: 'dashboard', key: '' });
      const d = await api('/uc/blocks?page=' + encodeURIComponent(s.page));
      state.cache.ucBlocks = d;
      const items = d.items || [];
      const cur = items.find(b => b.key === s.key) || items[0] || null;
      if (cur) s.key = cur.key;
      return '<div class="split">' +
        '<div class="card"><div class="card-head"><h3>用户中心页面</h3></div><div class="list-nav">' +
        UC_PAGES.map(p => '<button class="' + (s.page === p[0] ? 'active' : '') + '" data-act="uc-page-pick" data-id="' + p[0] + '">' +
          p[1] + '<span class="cnt">' + ((d.items || []).filter(b => b.page === p[0]).length) + '</span></button>').join('') +
        '</div><div class="card-pad help">与线上控制台同源；编辑区块保存后前台即时生效，默认内容与线上逐字节一致。</div></div>' +
        '<div class="card"><div class="card-head"><h3>' + (cur ? esc(cur.title || cur.key) : '选择区块') + '</h3>' +
        '<span class="sub mono">' + (cur ? esc(cur.key) : '') + '</span>' +
        '<div class="right"><a class="btn btn-sm" href="' + UBASE + '/?page=' + s.page + '&t=' + Date.now() + '" target="_blank" rel="noopener">打开页面</a>' +
        '<button class="btn btn-sm btn-primary" data-act="uc-block-save"' + (cur ? '' : ' disabled') + '>保存区块</button></div></div>' +
        '<div class="card-pad">' +
        (cur ? '<div class="field"><label class="fl">区块标题（仅后台展示）</label><input class="inp" id="ucBlockTitle" style="width:100%" value="' + esc(cur.title || '') + '"></div>' +
          '<div class="field"><label class="fl">区块 HTML</label>' +
          '<textarea class="editor" id="ucBlockHtml">\n' + esc(cur.html || '') + '</textarea>' +
          '<div class="hint">共 ' + (cur.html || '').length + ' 字符 · 保存后前台即时生效</div></div>' : emptyHTML('该页面没有可编辑区块')) +
        '</div></div></div>';
    },
  };

  /* ---------------- 用户 ---------------- */
  VIEWS.users = {
    id: 'users',
    title: '用户管理',
    async render() {
      const s = vs('users');
      const data = await api('/users?' + new URLSearchParams({ page: s.page, size: s.size, q: s.q || '', status: s.status || '' }));
      const rows = data.items.map(u =>
        '<tr><td class="mono cell-sub">' + esc(u.id) + '</td>' +
        '<td><div class="cell-main">' + esc(u.username) + '</div><div class="cell-sub">' + esc(u.email) + '</div></td>' +
        '<td class="mono cell-sub">' + esc(u.phone || '—') + '</td>' +
        '<td>' + esc(u.plan || '—') + (u.refill ? ' <span class="badge info">续杯</span>' : '') + '</td>' +
        '<td class="num">' + money(u.amount) + '</td>' +
        '<td class="num">' + money(u.balance) + '</td>' +
        '<td>' + userBadge(u.status) + '</td>' +
        '<td class="mono cell-sub">' + fmtDate(u.created_at) + '</td>' +
        '<td><div class="acts"><button class="link-btn" data-act="user-edit" data-id="' + u.id + '">编辑</button>' +
        '<button class="link-btn danger" data-act="user-del" data-id="' + u.id + '">删除</button></div></td></tr>').join('');
      return '<div class="card"><div class="card-head"><h3>用户列表</h3><span class="sub">共 ' + data.total + ' 位注册用户</span></div><div class="card-pad">' +
        '<div class="toolbar"><input class="inp search-inp" id="userQ" placeholder="搜索用户名 / 邮箱 / 手机" value="' + esc(s.q || '') + '">' +
        '<select class="sel" id="userStatus"><option value="">全部状态</option>' +
        ['active', 'expired', 'banned'].map(v => '<option value="' + v + '"' + (s.status === v ? ' selected' : '') + '>' + ({ active: '正常', expired: '已过期', banned: '已封禁' })[v] + '</option>').join('') +
        '</select><button class="btn btn-sm" data-act="user-query">查询</button></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>用户</th><th>手机</th><th>套餐</th>' +
        '<th class="num">实付</th><th class="num">余额</th><th>状态</th><th>注册时间</th><th style="width:120px">操作</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="9">' + emptyHTML('没有符合条件的用户') + '</td></tr>') + '</tbody></table></div>' +
        pagerHTML(data) + '</div></div>';
    },
    mount() {
      const s = vs('users');
      $('#userQ').addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        s.q = $('#userQ').value.trim(); s.status = $('#userStatus').value; s.page = 1; route();
      });
    },
  };

  /* ---------------- 订单 ---------------- */
  VIEWS.orders = {
    id: 'orders',
    title: '订单管理',
    async render() {
      const s = vs('orders');
      const data = await api('/orders?' + new URLSearchParams({ page: s.page, size: s.size, q: s.q || '', status: s.status || '' }));
      const rows = data.items.map(o =>
        '<tr><td class="mono">' + esc(o.id) + '</td>' +
        '<td><div class="cell-main">' + esc(o.username) + '</div><div class="cell-sub mono">' + esc(o.user_id) + '</div></td>' +
        '<td>' + esc(o.plan) + '</td><td class="num">' + money(o.amount) + '</td>' +
        '<td>' + esc(o.channel) + '</td><td>' + orderBadge(o.status) + '</td>' +
        '<td class="mono cell-sub">' + fmtDate(o.created_at) + '</td>' +
        '<td><select class="sel" style="padding:4px 8px;font-size:12px" data-order-status="' + esc(o.id) + '">' +
        ['paid', 'pending', 'refunded', 'closed'].map(v => '<option value="' + v + '"' + (o.status === v ? ' selected' : '') + '>' +
          ({ paid: '已支付', pending: '待支付', refunded: '已退款', closed: '已关闭' })[v] + '</option>').join('') +
        '</select></td></tr>').join('');
      return '<div class="card"><div class="card-head"><h3>订单流水</h3><span class="sub">共 ' + data.total + ' 笔</span></div><div class="card-pad">' +
        '<div class="toolbar"><input class="inp search-inp" id="orderQ" placeholder="搜索订单号 / 用户 / 套餐" value="' + esc(s.q || '') + '">' +
        '<select class="sel" id="orderStatus"><option value="">全部状态</option>' +
        ['paid', 'pending', 'refunded', 'closed'].map(v => '<option value="' + v + '"' + (s.status === v ? ' selected' : '') + '>' +
          ({ paid: '已支付', pending: '待支付', refunded: '已退款', closed: '已关闭' })[v] + '</option>').join('') +
        '</select><button class="btn btn-sm" data-act="order-query">查询</button></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>订单号</th><th>用户</th><th>套餐</th>' +
        '<th class="num">金额</th><th>渠道</th><th>状态</th><th>下单时间</th><th style="width:130px">修改状态</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="8">' + emptyHTML('没有符合条件的订单') + '</td></tr>') + '</tbody></table></div>' +
        pagerHTML(data) + '</div></div>';
    },
    mount() {
      const s = vs('orders');
      $('#orderQ').addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        s.q = $('#orderQ').value.trim(); s.status = $('#orderStatus').value; s.page = 1; route();
      });
      $$('[data-order-status]').forEach(sel => {
        sel.addEventListener('change', async () => {
          const id = sel.dataset.orderStatus;
          try {
            await api('/orders/' + id, { method: 'PUT', body: { status: sel.value } });
            toast('订单 ' + id + ' 状态已更新');
          } catch (e) { toast(e.message, 'err'); }
        });
      });
    },
  };

  /* ---------------- 工单 ---------------- */
  VIEWS.tickets = {
    id: 'tickets',
    title: '客服工单',
    async render() {
      const s = vs('tickets');
      const data = await api('/tickets?' + new URLSearchParams({ page: s.page, size: s.size, q: s.q || '', status: s.status || '' }));
      const rows = data.items.map(t =>
        '<tr><td class="mono cell-sub">' + esc(t.id) + '</td>' +
        '<td><div class="cell-main">' + esc(t.subject) + '</div><div class="cell-sub">' + esc((t.body || '').slice(0, 58)) + '</div></td>' +
        '<td>' + esc(t.user) + '</td>' +
        '<td>' + (t.priority === 'urgent' ? '<span class="badge danger">紧急</span>' : t.priority === 'high' ? '<span class="badge warn">高</span>' : '<span class="badge off">普通</span>') + '</td>' +
        '<td>' + ticketBadge(t.status) + '</td>' +
        '<td class="mono cell-sub">' + fmtDate(t.created_at) + '</td>' +
        '<td><button class="link-btn" data-act="ticket-open" data-id="' + esc(t.id) + '">处理</button></td></tr>').join('');
      return '<div class="card"><div class="card-head"><h3>客服工单</h3><span class="sub">共 ' + data.total + ' 条</span></div><div class="card-pad">' +
        '<div class="toolbar"><input class="inp search-inp" id="tkQ" placeholder="搜索工单标题 / 用户 / 内容" value="' + esc(s.q || '') + '">' +
        '<select class="sel" id="tkStatus"><option value="">全部状态</option>' +
        ['open', 'pending', 'closed'].map(v => '<option value="' + v + '"' + (s.status === v ? ' selected' : '') + '>' +
          ({ open: '待处理', pending: '已回复', closed: '已关闭' })[v] + '</option>').join('') +
        '</select><button class="btn btn-sm" data-act="ticket-query">查询</button></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>编号</th><th>主题</th><th>用户</th><th>优先级</th><th>状态</th><th>提交时间</th><th style="width:80px">操作</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="7">' + emptyHTML('没有符合条件的工单') + '</td></tr>') + '</tbody></table></div>' +
        pagerHTML(data) + '</div></div>';
    },
    mount() {
      const s = vs('tickets');
      $('#tkQ').addEventListener('keydown', e => {
        if (e.key !== 'Enter') return;
        s.q = $('#tkQ').value.trim(); s.status = $('#tkStatus').value; s.page = 1; route();
      });
    },
  };

  /* ---------------- 线索 ---------------- */
  VIEWS.leads = {
    id: 'leads',
    title: '商务线索',
    async render() {
      const d = await api('/leads');
      const map = { new: ['info', '新线索'], following: ['warn', '跟进中'], won: ['on', '已成交'], lost: ['off', '已放弃'] };
      const rows = (d.items || []).map(l =>
        '<tr><td class="mono cell-sub">' + esc(l.id) + '</td>' +
        '<td>' + esc(l.source) + '</td>' +
        '<td class="mono">' + esc(l.contact) + '</td>' +
        '<td>' + esc(l.content) + '</td>' +
        '<td><span class="badge ' + (map[l.status] || ['off', l.status])[0] + '">' + (map[l.status] || ['', l.status])[1] + '</span></td>' +
        '<td class="mono cell-sub">' + fmtDate(l.created_at) + '</td>' +
        '<td><select class="sel" style="padding:4px 8px;font-size:12px" data-lead-status="' + esc(l.id) + '">' +
        Object.keys(map).map(k => '<option value="' + k + '"' + (l.status === k ? ' selected' : '') + '>' + map[k][1] + '</option>').join('') +
        '</select></td></tr>').join('');
      return '<div class="card"><div class="card-head"><h3>商务线索</h3><span class="sub">来自客服与官网咨询</span></div><div class="card-pad">' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>编号</th><th>来源</th><th>联系方式</th><th>需求</th><th>状态</th><th>时间</th><th style="width:130px">更新</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="7">' + emptyHTML('还没有线索') + '</td></tr>') + '</tbody></table></div></div></div>';
    },
    mount() {
      $$('[data-lead-status]').forEach(sel => {
        sel.addEventListener('change', async () => {
          try {
            await api('/leads/' + sel.dataset.leadStatus, { method: 'PUT', body: { status: sel.value } });
            toast('线索状态已更新');
          } catch (e) { toast(e.message, 'err'); }
        });
      });
    },
  };

  /* ---------------- 站点设置 ---------------- */
  VIEWS.settings = {
    id: 'settings',
    title: '站点设置',
    async render() {
      const s = await api('/settings');
      state.cache.settings = s;
      return '<div class="grid g2">' +
        '<div class="card"><div class="card-head"><h3>基础信息</h3></div><div class="card-pad">' +
        '<div class="field row2"><div><label class="fl">品牌名称（中文）</label><input class="inp" id="sBrand" style="width:100%" value="' + esc(s.brand_name || '小小科技') + '"></div>' +
        '<div><label class="fl">品牌名称（英文）</label><input class="inp" id="sBrandEn" style="width:100%" value="' + esc(s.brand_en || 'Xiaoxiao Technology') + '"></div></div>' +
        '<div class="field"><label class="fl">站点名称</label><input class="inp" id="sSite" style="width:100%" value="' + esc(s.site_name || '') + '"></div>' +
        '<div class="field"><label class="fl">站点域名（展示用）</label><input class="inp" id="sDomain" style="width:100%" value="' + esc(s.domain || '') + '"></div>' +
        '<div class="field"><label class="fl">SEO 标题</label><input class="inp" id="sSeo" style="width:100%" value="' + esc(s.seo_title || '') + '"></div>' +
        '<div class="field"><label class="fl">统计代码（插入 &lt;/body&gt; 前）</label><textarea class="inp" id="sAnalytics" style="width:100%;min-height:80px;font-family:var(--mono);font-size:12px">' + esc(s.analytics || '') + '</textarea></div>' +
        '</div></div>' +
        '<div class="card"><div class="card-head"><h3>外链与开关</h3></div><div class="card-pad">' +
        '<div class="field"><label class="fl">在线客服地址</label><input class="inp" id="sKefu" style="width:100%" value="' + esc(s.kefu_base || '') + '"></div>' +
        '<div class="field"><label class="fl">无限续杯工具地址</label><input class="inp" id="sRefill" style="width:100%" value="' + esc(s.refill_url || '') + '"></div>' +
        '<div class="field"><label class="fl">用户中心地址</label><input class="inp" id="sUser" style="width:100%" value="' + esc(s.user_center || '') + '"></div>' +
        '<div class="field"><label class="switch"><input type="checkbox" id="sNotice"' + (s.notice_enabled !== false ? ' checked' : '') + '><i></i>前台展示公告弹窗</label></div>' +
        '<div class="field"><label class="switch"><input type="checkbox" id="sMaint"' + (s.maintenance ? ' checked' : '') + '><i></i>维护模式（子页面 503）</label></div>' +
        '<div class="warn-box">修改外链会全局替换前台页面中的旧地址（客服 / 续杯 / 用户中心）。</div>' +
        '<div class="toolbar" style="margin-top:14px"><button class="btn btn-primary" data-act="settings-save">保存设置</button>' +
        '<a class="btn" href="/" target="_blank" rel="noopener">打开前台</a></div>' +
        '</div></div></div>';
    },
  };

  /* ---------------- 账号与安全 ---------------- */
  VIEWS.security = {
    id: 'security',
    title: '账号与安全',
    async render() {
      const d = await api('/admins');
      const rows = (d.items || []).map(a =>
        '<tr><td class="mono cell-sub">' + esc(a.id) + '</td>' +
        '<td><div class="cell-main">' + esc(a.username) + '</div><div class="cell-sub">' + esc(a.nickname || '') + '</div></td>' +
        '<td>' + ({ owner: '所有者', admin: '管理员', operator: '运营' }[a.role] || a.role) + '</td>' +
        '<td>' + (a.enabled === false ? '<span class="badge off">已禁用</span>' : '<span class="badge on">正常</span>') + '</td>' +
        '<td class="mono cell-sub">' + fmtDate(a.last_login) + '</td>' +
        '<td><div class="acts"><button class="link-btn" data-act="admin-edit" data-id="' + a.id + '">编辑</button>' +
        '<button class="link-btn danger" data-act="admin-del" data-id="' + a.id + '">删除</button></div></td></tr>').join('');
      return '<div class="grid g2">' +
        '<div class="card"><div class="card-head"><h3>管理员账号</h3><div class="right"><button class="btn btn-sm btn-primary" data-act="admin-new">+ 新增管理员</button></div></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>ID</th><th>账号</th><th>角色</th><th>状态</th><th>最后登录</th><th style="width:110px">操作</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="6">' + emptyHTML('没有管理员') + '</td></tr>') + '</tbody></table></div></div>' +
        '<div class="card"><div class="card-head"><h3>修改我的密码</h3></div><div class="card-pad">' +
        '<div class="field"><label class="fl">当前密码</label><input class="inp" type="password" id="pOld" style="width:100%" autocomplete="current-password"></div>' +
        '<div class="field"><label class="fl">新密码（至少 6 位）</label><input class="inp" type="password" id="pNew" style="width:100%" autocomplete="new-password"></div>' +
        '<div class="field"><label class="fl">确认新密码</label><input class="inp" type="password" id="pNew2" style="width:100%" autocomplete="new-password"></div>' +
        '<button class="btn btn-primary" data-act="password-save">更新密码</button>' +
        '<div class="help" style="margin-top:12px">密码使用 scrypt 加盐哈希存储；会话 12 小时过期，Cookie 为 HttpOnly + SameSite=Strict。</div>' +
        '</div></div></div>';
    },
  };

  /* ---------------- 操作日志 ---------------- */
  VIEWS.audit = {
    id: 'audit',
    title: '操作日志',
    async render() {
      const s = vs('audit', { size: 30 });
      const d = await api('/audit?' + new URLSearchParams({ page: s.page, size: s.size }));
      const rows = (d.items || []).map(a =>
        '<tr><td class="mono cell-sub">' + fmtDate(a.at) + '</td>' +
        '<td>' + esc(a.actor) + '</td><td><span class="badge info">' + esc(a.action) + '</span></td>' +
        '<td class="mono cell-sub">' + esc(a.target) + '</td><td>' + esc(a.detail) + '</td></tr>').join('');
      return '<div class="card"><div class="card-head"><h3>操作日志</h3><span class="sub">最近 ' + d.total + ' 条后台操作</span></div>' +
        '<div class="table-wrap"><table class="tbl"><thead><tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>说明</th></tr></thead>' +
        '<tbody>' + (rows || '<tr><td colspan="5">' + emptyHTML('还没有日志') + '</td></tr>') + '</tbody></table></div>' +
        pagerHTML(d) + '</div>';
    },
  };

  /* ---------------- 全局事件 ---------------- */
  function bindGlobal() {
    // 登录
    $('#loginForm').addEventListener('submit', async e => {
      e.preventDefault();
      const btn = $('#loginBtn');
      const hint = $('#loginHint');
      hint.textContent = '';
      btn.disabled = true;
      btn.textContent = '登录中…';
      try {
        const d = await api('/login', { method: 'POST', body: { username: $('#loginUser').value.trim(), password: $('#loginPass').value } });
        state.admin = d.admin;
        if ($('#rememberMe').checked) localStorage.setItem('ytk_admin_user', d.admin.username);
        else localStorage.removeItem('ytk_admin_user');
        showShell();
        location.hash = '#/dashboard';
        route();
        toast('欢迎回来，' + (d.admin.nickname || d.admin.username));
      } catch (err) {
        hint.textContent = err.message;
        btn.disabled = false;
        btn.textContent = '登 录';
      }
    });

    // 侧栏
    $('#sideNav').addEventListener('click', e => {
      const b = e.target.closest('[data-act="nav"]');
      if (b) { go(b.dataset.id); $('.side').classList.remove('open'); }
    });
    $('#btnMenu').addEventListener('click', () => $('.side').classList.toggle('open'));

    // 用户菜单
    $('#userBtn').addEventListener('click', e => {
      e.stopPropagation();
      $('#userDrop').hidden = !$('#userDrop').hidden;
    });
    document.addEventListener('click', () => { $('#userDrop').hidden = true; });
    $('#userDrop').addEventListener('click', async e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'logout') {
        try { await api('/logout', { method: 'POST' }); } catch (err) { /* ignore */ }
        state.admin = null;
        showLogin();
      }
      if (b.dataset.act === 'profile') {
        openModal({
          title: '账号信息',
          body: '<dl class="kv"><dt>账号</dt><dd>' + esc(state.admin.username) + '</dd>' +
            '<dt>昵称</dt><dd>' + esc(state.admin.nickname || '—') + '</dd>' +
            '<dt>角色</dt><dd>' + esc(state.admin.role) + '</dd>' +
            '<dt>最后登录</dt><dd>' + fmtDate(state.admin.last_login) + '</dd></dl>',
          footer: '<button class="btn" data-act="modal-close">关闭</button>',
        });
      }
    });

    // 全局搜索
    $('#globalSearch').addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const q = e.target.value.trim();
      if (!q) return;
      state.vs.models = Object.assign(vs('models'), { q, page: 1 });
      go('models');
    });

    $('#btnRefresh').addEventListener('click', () => { toast('正在刷新…'); route(); });

    // 模态关闭
    $('#modalX').addEventListener('click', closeModal);
    $('#modalMask').addEventListener('click', e => { if (e.target.id === 'modalMask') closeModal(); });

    // 确认框
    $('#confirmCancel').addEventListener('click', () => {
      $('#confirmMask').hidden = true;
      if (confirmResolve) { confirmResolve(false); confirmResolve = null; }
    });
    $('#confirmOk').addEventListener('click', () => {
      $('#confirmMask').hidden = true;
      if (confirmResolve) { confirmResolve(true); confirmResolve = null; }
    });

    // 快捷键
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        $('#globalSearch').focus();
      }
      if (e.key === 'Escape') {
        if (!$('#modalMask').hidden) closeModal();
        else if (!$('#confirmMask').hidden) $('#confirmCancel').click();
      }
    });

    // 统一动作委托
    document.addEventListener('click', async e => {
      const el = e.target.closest('[data-act]');
      if (!el) return;
      const act = el.dataset.act;
      const id = el.dataset.id;

      if (act === 'modal-close') return closeModal();
      if (act === 'page') {
        const v = VIEWS[state.route];
        if (!v) return;
        const s = vs(state.route);
        s.page = Math.max(1, Number(el.dataset.p) || 1);
        route();
        return;
      }

      /* ----- 模型 ----- */
      if (act === 'model-query') {
        const s = vs('models');
        s.q = $('#modelQ').value.trim(); s.brand = $('#modelBrand').value; s.status = $('#modelStatus').value; s.page = 1;
        return route();
      }
      if (act === 'model-reset') {
        state.vs.models = { q: '', brand: '', status: '', page: 1, size: 20 };
        return route();
      }
      if (act === 'model-new') return openModelModal(null);
      if (act === 'model-edit') {
        try {
          const d = await api('/models?' + new URLSearchParams({ q: '', size: 200 }));
          const m = (d.items || []).find(x => x.id === id);
          if (!m) return toast('模型不存在', 'err');
          return openModelModal(m);
        } catch (err) { return toast(err.message, 'err'); }
      }
      if (act === 'model-toggle') {
        try {
          const d = await api('/models?' + new URLSearchParams({ size: 200 }));
          const m = (d.items || []).find(x => x.id === id);
          if (!m) return;
          await api('/models/' + id, { method: 'PUT', body: { enabled: m.enabled === false } });
          toast(m.enabled === false ? '已上架，前台可见' : '已下架');
          route();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
      if (act === 'model-del') {
        const ok = await askConfirm('删除后前台将立即不再展示该模型，确认删除？', '删除模型', '删除');
        if (!ok) return;
        try { await api('/models/' + id, { method: 'DELETE' }); toast('已删除'); route(); }
        catch (err) { toast(err.message, 'err'); }
        return;
      }
      if (act === 'model-up' || act === 'model-down') {
        try {
          const d = await api('/models?' + new URLSearchParams({ size: 200 }));
          const list = d.items || [];
          const i = list.findIndex(x => x.id === id);
          const j = act === 'model-up' ? i - 1 : i + 1;
          if (i < 0 || j < 0 || j >= list.length) return;
          const a = list[i], b = list[j];
          await api('/models/' + a.id, { method: 'PUT', body: { order: b.order } });
          await api('/models/' + b.id, { method: 'PUT', body: { order: a.order } });
          toast('排序已更新');
          route();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
      if (act === 'bulk') {
        const ids = $$('.rowck').filter(c => c.checked).map(c => c.dataset.id);
        if (!ids.length) return toast('请先勾选模型', 'err');
        if (id === 'del') {
          const ok = await askConfirm('将批量删除 ' + ids.length + ' 个模型，操作不可恢复。', '批量删除', '删除');
          if (!ok) return;
          try {
            for (const mid of ids) await api('/models/' + mid, { method: 'DELETE' });
            toast('已删除 ' + ids.length + ' 个模型');
            route();
          } catch (err) { toast(err.message, 'err'); }
        } else {
          try {
            for (const mid of ids) await api('/models/' + mid, { method: 'PUT', body: { enabled: id === 'on' } });
            toast((id === 'on' ? '已上架 ' : '已下架 ') + ids.length + ' 个模型');
            route();
          } catch (err) { toast(err.message, 'err'); }
        }
        return;
      }

      /* ----- 品牌 ----- */
      if (act === 'brand-new' || act === 'brand-edit') {
        const d = await api('/brands');
        const b = act === 'brand-edit' ? (d.items || []).find(x => x.id === id) : null;
        openModal({
          title: b ? '编辑品牌 · ' + b.label : '新增品牌',
          body: '<div class="field"><label class="fl">品牌标识 *（英文，决定 LOGO 文件名）</label>' +
            '<input class="inp" id="bId" style="width:100%" value="' + esc(b ? b.id : '') + '"' + (b ? ' disabled' : '') + ' placeholder="例如 OpenAI"></div>' +
            '<div class="field"><label class="fl">展示名称 *</label><input class="inp" id="bLabel" style="width:100%" value="' + esc(b ? b.label : '') + '" placeholder="例如 OpenAI · GPT"></div>' +
            '<div class="field"><label class="switch"><input type="checkbox" id="bEnabled"' + (!b || b.enabled !== false ? ' checked' : '') + '><i></i>在前台筛选 Tab 中展示</label></div>',
          footer: '<button class="btn" data-act="modal-close">取消</button><button class="btn btn-primary" id="bSave">保存</button>',
          onMount() {
            $('#bSave').addEventListener('click', async () => {
              const label = $('#bLabel').value.trim();
              if (!label) return toast('请填写展示名称', 'err');
              try {
                if (b) await api('/brands/' + encodeURIComponent(b.id), { method: 'PUT', body: { label, enabled: $('#bEnabled').checked } });
                else {
                  const nid = $('#bId').value.trim();
                  if (!nid) return toast('请填写品牌标识', 'err');
                  await api('/brands', { method: 'POST', body: { id: nid, label, enabled: $('#bEnabled').checked } });
                }
                closeModal(); toast('品牌已保存'); route();
              } catch (err) { toast(err.message, 'err'); }
            });
          },
        });
        return;
      }
      if (act === 'brand-toggle') {
        const d = await api('/brands');
        const b = (d.items || []).find(x => x.id === id);
        if (!b) return;
        try {
          await api('/brands/' + encodeURIComponent(id), { method: 'PUT', body: { enabled: b.enabled === false } });
          toast('已切换展示状态'); route();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
      if (act === 'brand-del') {
        const ok = await askConfirm('删除品牌前请确认该品牌下没有模型。', '删除品牌', '删除');
        if (!ok) return;
        try { await api('/brands/' + encodeURIComponent(id), { method: 'DELETE' }); toast('已删除'); route(); }
        catch (err) { toast(err.message, 'err'); }
        return;
      }
      if (act === 'brand-up' || act === 'brand-down') {
        const d = await api('/brands');
        const list = (d.items || []).slice();
        const i = list.findIndex(x => x.id === id);
        const j = act === 'brand-up' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= list.length) return;
        const t = list[i]; list[i] = list[j]; list[j] = t;
        try {
          await api('/brands/reorder', { method: 'POST', body: { ids: list.map(x => x.id) } });
          toast('排序已更新'); route();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }

      /* ----- 区块 ----- */
      if (act === 'page-pick') {
        const s = vs('pages', { page: 'home', key: '' });
        s.page = id; s.key = '';
        return route();
      }
      if (act === 'block-save') {
        const s = vs('pages', { page: 'home', key: '' });
        const html = $('#blockHtml').value;
        const title = $('#blockTitle').value;
        try {
          await api('/blocks/' + encodeURIComponent(s.key), { method: 'PUT', body: { html, title } });
          toast('区块已保存，前台已生效');
          route();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }

      /* ----- 公告 ----- */
      if (act === 'notice-additem') {
        const box = $('#nItems');
        const i = box.children.length;
        const div = document.createElement('div');
        div.style.cssText = 'display:flex;gap:8px;margin-bottom:8px';
        div.innerHTML = '<input class="inp" style="flex:1" data-nitem value=""><button class="btn btn-sm btn-danger" data-act="notice-delitem" data-id="' + i + '">删除</button>';
        box.appendChild(div);
        return;
      }
      if (act === 'notice-delitem') {
        el.parentElement.remove();
        return;
      }
      if (act === 'notice-save') {
        const items = $$('#nItems [data-nitem]').map(i => i.value).filter(v => v.trim());
        try {
          await api('/notice', {
            method: 'PUT', body: {
              enabled: $('#nEnabled').checked,
              badge: $('#nBadge').value, title: $('#nTitle').value, items,
            }
          });
          toast('公告已保存'); route();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }

      /* ----- 中转运营：渠道 ----- */
      if (act === 'ch-new' || act === 'ch-edit') {
        const d = await api('/channels');
        const c = act === 'ch-edit' ? (d.items || []).find(x => x.id === id) : null;
        openModal({
          title: c ? '编辑渠道 · ' + c.name : '新增上游渠道',
          body: '<div class="field"><label class="fl">渠道名称 *</label><input class="inp" id="chName" style="width:100%" value="' + esc(c ? c.name : '') + '"></div>' +
            '<div class="field row2"><div><label class="fl">类型</label><select class="sel" id="chType" style="width:100%">' +
            [['openai', 'OpenAI 兼容'], ['mock', '内置演示']].map(x => '<option value="' + x[0] + '"' + (c && c.type === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') +
            '</select></div><div><label class="fl">权重</label><input class="inp" id="chWeight" type="number" min="1" style="width:100%" value="' + esc(c ? c.weight : 1) + '"></div></div>' +
            '<div class="field"><label class="fl">上游地址（OpenAI 兼容，如 https://api.xxx.com）</label><input class="inp" id="chBase" style="width:100%" value="' + esc(c ? c.base_url : '') + '"></div>' +
            '<div class="field"><label class="fl">上游 API Key</label><input class="inp" id="chKey" style="width:100%" value="' + esc(c ? c.api_key : '') + '" placeholder="sk-..."></div>' +
            '<div class="field"><label class="fl">承接模型（逗号分隔，* 表示全部）</label><input class="inp" id="chModels" style="width:100%" value="' + esc(c ? (c.models || []).join(',') : '*') + '"></div>' +
            '<div class="field"><label class="switch"><input type="checkbox" id="chEnabled"' + (!c || c.enabled !== false ? ' checked' : '') + '><i></i>启用该渠道</label></div>',
          footer: '<button class="btn" data-act="modal-close">取消</button><button class="btn btn-primary" id="chSave">保存</button>',
          onMount() {
            $('#chSave').addEventListener('click', async () => {
              const payload = {
                name: $('#chName').value.trim(), type: $('#chType').value,
                base_url: $('#chBase').value.trim(), api_key: $('#chKey').value.trim(),
                models: $('#chModels').value.split(',').map(s2 => s2.trim()).filter(Boolean),
                weight: Number($('#chWeight').value) || 1, enabled: $('#chEnabled').checked,
              };
              if (!payload.name) return toast('请填写渠道名称', 'err');
              try {
                if (c) await api('/channels/' + c.id, { method: 'PUT', body: payload });
                else await api('/channels', { method: 'POST', body: payload });
                closeModal(); toast('已保存'); route();
              } catch (err) { toast(err.message, 'err'); }
            });
          },
        });
        return;
      }
      if (act === 'ch-check') {
        toast('检测中…');
        try {
          const d = await api('/channels/' + id + '/check', { method: 'POST' });
          toast(d.ok ? '渠道正常' + (d.result.latency ? '（' + d.result.latency + 'ms）' : '') : ('异常：' + (d.result.error || '')), d.ok ? '' : 'err');
          route();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
      if (act === 'ch-toggle') {
        const d = await api('/channels');
        const c = (d.items || []).find(x => x.id === id);
        if (!c) return;
        try { await api('/channels/' + id, { method: 'PUT', body: { enabled: c.enabled === false } }); toast('已切换'); route(); }
        catch (err) { toast(err.message, 'err'); }
        return;
      }
      if (act === 'ch-del') {
        const ok = await askConfirm('删除渠道后，走该渠道的模型会回落到内置演示渠道。', '删除渠道', '删除');
        if (!ok) return;
        try { await api('/channels/' + id, { method: 'DELETE' }); toast('已删除'); route(); }
        catch (err) { toast(err.message, 'err'); }
        return;
      }

      /* ----- 中转运营：日志 ----- */
      if (act === 'log-query') {
        const s = vs('logs');
        s.q = $('#logQ').value.trim(); s.status = $('#logStatus').value; s.page = 1;
        return route();
      }

      /* ----- 中转运营：客服 ----- */
      if (act === 'sup-pick') {
        const s = vs('support', { id: '' });
        s.id = id;
        return route();
      }
      if (act === 'sup-send') {
        const text = ($('#supReply').value || '').trim();
        if (!text) return toast('回复内容不能为空', 'err');
        try {
          await api('/support/' + id + '/reply', { method: 'POST', body: { text } });
          toast('已回复'); route();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
      if (act === 'sup-close') {
        try { await api('/support/' + id, { method: 'PUT', body: { status: 'closed', unread: 0 } }); toast('已标记处理'); route(); }
        catch (err) { toast(err.message, 'err'); }
        return;
      }

      /* ----- 用户中心：套餐 ----- */
      if (act === 'uc-plan-edit') {
        const d = await api('/uc/plans');
        const p = (d.items || []).find(x => x.id === id);
        if (!p) return toast('套餐不存在', 'err');
        openModal({
          title: '编辑套餐 · ' + p.name,
          body: '<div class="field row2"><div><label class="fl">套餐名称</label><input class="inp" id="pName" style="width:100%" value="' + esc(p.name) + '"></div>' +
            '<div><label class="fl">价格（元）</label><input class="inp" id="pPrice" style="width:100%" value="' + esc(p.price) + '"></div></div>' +
            '<div class="field row2"><div><label class="fl">定位副标题</label><input class="inp" id="pSub" style="width:100%" value="' + esc(p.subtitle || '') + '"></div>' +
            '<div><label class="fl">周期文案</label><input class="inp" id="pPeriod" style="width:100%" value="' + esc(p.period || '') + '"></div></div>' +
            '<div class="field row2"><div><label class="fl">每日额度文案</label><input class="inp" id="pDaily" style="width:100%" value="' + esc(p.daily) + '"></div>' +
            '<div><label class="fl">总次数文案</label><input class="inp" id="pTotal" style="width:100%" value="' + esc(p.total) + '"></div></div>' +
            '<div class="field row2"><div><label class="fl">并发文案</label><input class="inp" id="pConc" style="width:100%" value="' + esc(p.concurrency) + '"></div>' +
            '<div><label class="fl">可用模型数</label><input class="inp" id="pModels" type="number" style="width:100%" value="' + esc(p.models_count) + '"></div></div>' +
            '<div class="field"><label class="fl">卖点特性（每行一条）</label><textarea class="inp" id="pFeat" style="width:100%;min-height:110px">' + esc((p.features || []).join('\n')) + '</textarea></div>' +
            '<div class="field row2"><div><label class="fl">角标文案（如 最受欢迎）</label><input class="inp" id="pBadge" style="width:100%" value="' + esc(p.badge || '') + '"></div>' +
            '<div><label class="fl">所属分类 Tab</label><select class="sel" id="pCat" style="width:100%">' +
            [['plan1', '周套餐'], ['plan2', '月套餐'], ['plan3', '季套餐']].map(c => '<option value="' + c[0] + '"' + (p.category === c[0] ? ' selected' : '') + '>' + c[1] + '</option>').join('') +
            '</select></div></div>',
          footer: '<button class="btn" data-act="modal-close">取消</button><button class="btn btn-primary" id="pSave">保存并同步前台</button>',
          onMount() {
            $('#pSave').addEventListener('click', async () => {
              try {
                await api('/uc/plans/' + encodeURIComponent(p.id), {
                  method: 'PUT', body: {
                    name: $('#pName').value, price: $('#pPrice').value, subtitle: $('#pSub').value,
                    period: $('#pPeriod').value, daily: $('#pDaily').value, total: $('#pTotal').value,
                    concurrency: $('#pConc').value, models_count: Number($('#pModels').value),
                    features: $('#pFeat').value.split('\n').map(x => x.trim()).filter(Boolean),
                    badge: $('#pBadge').value, category: $('#pCat').value,
                  }
                });
                closeModal(); toast('套餐已保存，前台订阅页已同步'); route();
              } catch (err) { toast(err.message, 'err'); }
            });
          },
        });
        return;
      }
      if (act === 'uc-plan-toggle') {
        const d = await api('/uc/plans');
        const p = (d.items || []).find(x => x.id === id);
        if (!p) return;
        try {
          await api('/uc/plans/' + encodeURIComponent(id), { method: 'PUT', body: { visible: p.visible === false } });
          toast(p.visible === false ? '已上架' : '已下架'); route();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }

      /* ----- 用户中心：兑换码 ----- */
      if (act === 'uc-redeem-new') {
        const plans = (state.cache.ucPlans || []);
        openModal({
          title: '生成订阅兑换码',
          body: '<div class="field"><label class="fl">兑换码（留空自动生成）</label><input class="inp" id="rCode" style="width:100%" placeholder="例如 YT-2026-XXXX"></div>' +
            '<div class="field row2"><div><label class="fl">套餐名称</label><select class="sel" id="rPlan" style="width:100%">' +
            plans.map(p => '<option value="' + esc(p.name) + '">' + esc(p.name) + '</option>').join('') + '</select></div>' +
            '<div><label class="fl">有效天数</label><input class="inp" id="rDays" type="number" value="7" style="width:100%"></div></div>' +
            '<div class="field"><label class="fl">并发数</label><input class="inp" id="rConc" type="number" value="2" style="width:100%"></div>',
          footer: '<button class="btn" data-act="modal-close">取消</button><button class="btn btn-primary" id="rSave">生成</button>',
          onMount() {
            $('#rSave').addEventListener('click', async () => {
              const code = ($('#rCode').value.trim() || ('YT-' + Math.random().toString(36).slice(2, 8).toUpperCase()));
              try {
                await api('/uc/redeem', {
                  method: 'POST', body: {
                    code, plan: $('#rPlan').value, days: Number($('#rDays').value),
                    concurrency: Number($('#rConc').value),
                  }
                });
                closeModal(); toast('兑换码已生成：' + code); route();
              } catch (err) { toast(err.message, 'err'); }
            });
          },
        });
        return;
      }
      if (act === 'uc-redeem-copy') {
        try { await navigator.clipboard.writeText(id); toast('已复制：' + id); } catch (e) { toast('复制失败，请手动选择', 'err'); }
        return;
      }
      if (act === 'uc-redeem-reset') {
        try { await api('/uc/redeem/' + encodeURIComponent(id), { method: 'PUT', body: { used: false } }); toast('已重置为可用'); route(); }
        catch (err) { toast(err.message, 'err'); }
        return;
      }
      if (act === 'uc-redeem-del') {
        const ok = await askConfirm('删除兑换码 ' + id + '？', '删除兑换码', '删除');
        if (!ok) return;
        try { await api('/uc/redeem/' + encodeURIComponent(id), { method: 'DELETE' }); toast('已删除'); route(); }
        catch (err) { toast(err.message, 'err'); }
        return;
      }

      /* ----- 用户中心：资料 ----- */
      if (act === 'uc-profile-save') {
        try {
          await api('/uc/profile', {
            method: 'PUT', body: {
              username: $('#ucUser').value, nickname: $('#ucNick').value, email: $('#ucEmail').value,
              phone: $('#ucPhone').value, points: Number($('#ucPoints').value),
              balance: Number($('#ucBalance').value), plan: $('#ucPlan').value, note: $('#ucNote').value,
            }
          });
          toast('资料已保存');
        } catch (err) { toast(err.message, 'err'); }
        return;
      }

      /* ----- 用户中心：区块 ----- */
      if (act === 'uc-page-pick') {
        const s = vs('ucPages', { page: 'dashboard', key: '' });
        s.page = id; s.key = '';
        return route();
      }
      if (act === 'uc-block-save') {
        const s = vs('ucPages', { page: 'dashboard', key: '' });
        try {
          await api('/uc/blocks/' + encodeURIComponent(s.key), {
            method: 'PUT', body: { html: $('#ucBlockHtml').value, title: $('#ucBlockTitle').value }
          });
          toast('区块已保存，前台已生效'); route();
        } catch (err) { toast(err.message, 'err'); }
        return;
      }

      /* ----- 用户 ----- */
      if (act === 'user-query') {
        const s = vs('users');
        s.q = $('#userQ').value.trim(); s.status = $('#userStatus').value; s.page = 1;
        return route();
      }
      if (act === 'user-edit') {
        const d = await api('/users?' + new URLSearchParams({ size: 200 }));
        const u = (d.items || []).find(x => x.id === id);
        if (!u) return toast('用户不存在', 'err');
        openModal({
          title: '编辑用户 · ' + u.username,
          body: '<div class="field row2"><div><label class="fl">套餐</label><input class="inp" id="uPlan" style="width:100%" value="' + esc(u.plan || '') + '"></div>' +
            '<div><label class="fl">余额</label><input class="inp" id="uBalance" type="number" step="0.01" style="width:100%" value="' + esc(u.balance) + '"></div></div>' +
            '<div class="field"><label class="fl">状态</label><select class="sel" id="uStatus" style="width:100%">' +
            ['active', 'expired', 'banned'].map(v => '<option value="' + v + '"' + (u.status === v ? ' selected' : '') + '>' +
              ({ active: '正常', expired: '已过期', banned: '已封禁' })[v] + '</option>').join('') + '</select></div>' +
            '<div class="field"><label class="fl">备注</label><textarea class="inp" id="uNote" style="width:100%;min-height:70px">' + esc(u.note || '') + '</textarea></div>',
          footer: '<button class="btn" data-act="modal-close">取消</button><button class="btn btn-primary" id="uSave">保存</button>',
          onMount() {
            $('#uSave').addEventListener('click', async () => {
              try {
                await api('/users/' + u.id, {
                  method: 'PUT', body: {
                    plan: $('#uPlan').value, balance: Number($('#uBalance').value),
                    status: $('#uStatus').value, note: $('#uNote').value,
                  }
                });
                closeModal(); toast('用户已更新'); route();
              } catch (err) { toast(err.message, 'err'); }
            });
          },
        });
        return;
      }
      if (act === 'user-del') {
        const ok = await askConfirm('删除用户记录不可恢复，确认继续？', '删除用户', '删除');
        if (!ok) return;
        try { await api('/users/' + id, { method: 'DELETE' }); toast('已删除'); route(); }
        catch (err) { toast(err.message, 'err'); }
        return;
      }

      /* ----- 订单 ----- */
      if (act === 'order-query') {
        const s = vs('orders');
        s.q = $('#orderQ').value.trim(); s.status = $('#orderStatus').value; s.page = 1;
        return route();
      }

      /* ----- 工单 ----- */
      if (act === 'ticket-query') {
        const s = vs('tickets');
        s.q = $('#tkQ').value.trim(); s.status = $('#tkStatus').value; s.page = 1;
        return route();
      }
      if (act === 'ticket-open') {
        const d = await api('/tickets?' + new URLSearchParams({ size: 200 }));
        const t = (d.items || []).find(x => x.id === id);
        if (!t) return toast('工单不存在', 'err');
        const msgs = (t.messages || []).map(m =>
          '<div class="msg' + (m.role === 'admin' ? ' admin' : '') + '"><div class="who">' +
          (m.role === 'admin' ? ('客服 · ' + esc(m.by || 'admin')) : esc(t.user)) + ' · ' + fmtDate(m.at) + '</div>' +
          esc(m.text) + '</div>').join('');
        openModal({
          title: '工单 ' + t.id + ' · ' + t.subject,
          body: '<div class="toolbar"><span class="badge ' + (t.priority === 'urgent' ? 'danger' : t.priority === 'high' ? 'warn' : 'off') + '">' +
            ({ urgent: '紧急', high: '高', normal: '普通' }[t.priority] || t.priority) + '</span>' + ticketBadge(t.status) +
            '<span class="spacer"></span><span class="cell-sub">来自 ' + esc(t.from || 'a1') + '</span></div>' +
            '<div class="msg-list" id="msgList">' + msgs + '</div>' +
            '<div class="divider"></div>' +
            '<label class="fl">回复内容</label><textarea class="inp" id="tkReply" style="width:100%;min-height:90px" placeholder="输入回复，发送后工单转为「已回复」"></textarea>',
          footer: '<select class="sel" id="tkState" style="margin-right:auto">' +
            ['open', 'pending', 'closed'].map(v => '<option value="' + v + '"' + (t.status === v ? ' selected' : '') + '>' +
              ({ open: '待处理', pending: '已回复', closed: '已关闭' })[v] + '</option>').join('') + '</select>' +
            '<button class="btn" data-act="modal-close">关闭</button>' +
            '<button class="btn btn-primary" id="tkSend">发送回复</button>',
          onMount() {
            $('#tkState').addEventListener('change', async () => {
              try { await api('/tickets/' + t.id, { method: 'PUT', body: { status: $('#tkState').value } }); toast('状态已更新'); }
              catch (err) { toast(err.message, 'err'); }
            });
            $('#tkSend').addEventListener('click', async () => {
              const text = $('#tkReply').value.trim();
              if (!text) return toast('请输入回复内容', 'err');
              try {
                await api('/tickets/' + t.id + '/reply', { method: 'POST', body: { text } });
                closeModal(); toast('回复已发送'); route();
              } catch (err) { toast(err.message, 'err'); }
            });
          },
        });
        return;
      }

      /* ----- 设置 ----- */
      if (act === 'settings-save') {
        try {
          await api('/settings', {
            method: 'PUT', body: {
              brand_name: $('#sBrand').value || '小小科技', brand_en: $('#sBrandEn').value || 'Xiaoxiao Technology',
              site_name: $('#sSite').value, domain: $('#sDomain').value, seo_title: $('#sSeo').value,
              analytics: $('#sAnalytics').value, kefu_base: $('#sKefu').value,
              refill_url: $('#sRefill').value, user_center: $('#sUser').value,
              notice_enabled: $('#sNotice').checked, maintenance: $('#sMaint').checked,
            }
          });
          toast('设置已保存并生效');
        } catch (err) { toast(err.message, 'err'); }
        return;
      }

      /* ----- 管理员 ----- */
      if (act === 'admin-new' || act === 'admin-edit') {
        const d = await api('/admins');
        const a = act === 'admin-edit' ? (d.items || []).find(x => x.id === id) : null;
        openModal({
          title: a ? '编辑管理员 · ' + a.username : '新增管理员',
          body: (a ? '' : '<div class="field"><label class="fl">账号 *</label><input class="inp" id="aUser" style="width:100%" placeholder="3-24 位字母数字下划线"></div>') +
            '<div class="field row2"><div><label class="fl">昵称</label><input class="inp" id="aNick" style="width:100%" value="' + esc(a ? a.nickname || '' : '') + '"></div>' +
            '<div><label class="fl">角色</label><select class="sel" id="aRole" style="width:100%">' +
            [['owner', '所有者'], ['admin', '管理员'], ['operator', '运营']].map(r =>
              '<option value="' + r[0] + '"' + (a && a.role === r[0] ? ' selected' : '') + '>' + r[1] + '</option>').join('') +
            '</select></div></div>' +
            '<div class="field"><label class="fl">' + (a ? '重置密码（留空不改）' : '登录密码 *') + '</label><input class="inp" id="aPass" type="password" style="width:100%"></div>' +
            (a ? '<div class="field"><label class="switch"><input type="checkbox" id="aEnabled"' + (a.enabled !== false ? ' checked' : '') + '><i></i>账号可用</label></div>' : ''),
          footer: '<button class="btn" data-act="modal-close">取消</button><button class="btn btn-primary" id="aSave">保存</button>',
          onMount() {
            $('#aSave').addEventListener('click', async () => {
              try {
                if (a) {
                  const body = { nickname: $('#aNick').value, role: $('#aRole').value };
                  if ($('#aEnabled')) body.enabled = $('#aEnabled').checked;
                  if ($('#aPass').value) body.password = $('#aPass').value;
                  await api('/admins/' + a.id, { method: 'PUT', body });
                } else {
                  await api('/admins', {
                    method: 'POST', body: {
                      username: $('#aUser').value.trim(), nickname: $('#aNick').value,
                      role: $('#aRole').value, password: $('#aPass').value,
                    }
                  });
                }
                closeModal(); toast('管理员已保存'); route();
              } catch (err) { toast(err.message, 'err'); }
            });
          },
        });
        return;
      }
      if (act === 'admin-del') {
        const ok = await askConfirm('确认删除该管理员账号？', '删除管理员', '删除');
        if (!ok) return;
        try { await api('/admins/' + id, { method: 'DELETE' }); toast('已删除'); route(); }
        catch (err) { toast(err.message, 'err'); }
        return;
      }
      if (act === 'password-save') {
        const oldp = $('#pOld').value, np = $('#pNew').value, np2 = $('#pNew2').value;
        if (!oldp || !np) return toast('请填写完整', 'err');
        if (np.length < 6) return toast('新密码至少 6 位', 'err');
        if (np !== np2) return toast('两次输入的新密码不一致', 'err');
        try {
          await api('/password', { method: 'POST', body: { old_password: oldp, new_password: np } });
          $('#pOld').value = $('#pNew').value = $('#pNew2').value = '';
          toast('密码已更新');
        } catch (err) { toast(err.message, 'err'); }
        return;
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  async function init() {
    bindGlobal();
    try {
      const d = await api('/me');
      state.admin = d.admin;
      showShell();
      if (!location.hash) location.hash = '#/dashboard';
      await route();
    } catch (e) {
      showLogin();
    }
    window.addEventListener('hashchange', route);
  }

  init();
})();
