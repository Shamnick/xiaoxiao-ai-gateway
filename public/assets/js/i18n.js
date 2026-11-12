/* 极简中英切换：按文本节点精确匹配词典，无需改动页面结构 */
(function () {
  'use strict';
  var DICT = {
    /* 公开页导航 */
    '首页': 'Home', '模型广场': 'Models', '价格': 'Pricing', 'API 文档': 'API Docs',
    'Playground': 'Playground', '用量排行': 'Leaderboard', '控制台 →': 'Console →', '控制台': 'Console',
    '关于': 'About', '联系': 'Contact', '在线客服': 'Support',
    /* 价格页 */
    '模型价格': 'Model Pricing',
    '按 token 计费，用多少扣多少。计价单位「积分」，1 积分 = 1 元；充值后即可调用，无月费、无最低消费。':
      'Pay per token. Currency unit is "points", 10 points = ¥1. No monthly fee, no minimum spend.',
    '搜索模型 / 品牌 / 标签': 'Search model / vendor / tag',
    '全部品牌': 'All vendors',
    '按输入价从低到高': 'Input price: low to high',
    '按输入价从高到低': 'Input price: high to low',
    '按上下文长度': 'Context length',
    '按名称': 'Name',
    '模型': 'Model', '品牌': 'Vendor', '上下文': 'Context',
    '输入（积分/1M）': 'Input (pts/1M)', '输出（积分/1M）': 'Output (pts/1M)',
    '请求费': 'Request fee', '能力': 'Capabilities',
    /* 文档页 */
    'API 文档': 'API Docs',
    'OpenAI 兼容接口，改一行 base_url 即可接入；支持流式输出、多上游自动路由与失败回退。':
      'OpenAI-compatible API. Change one line of base_url. Supports streaming, multi-upstream routing and automatic failover.',
    '快速开始': 'Quick Start', '认证': 'Authentication', '对话补全': 'Chat Completions',
    '流式输出': 'Streaming', '模型列表': 'Models', '错误码': 'Error Codes', '计费规则': 'Billing',
    '参数': 'Parameter', '类型': 'Type', '说明': 'Description',
    '含义': 'Meaning', '状态码': 'Status',
    '注册后到控制台「我的 Key」签发一把密钥，然后：': 'Sign in, issue a key under "My Keys", then:',
    '所有请求使用 Bearer Token：': 'All requests use a Bearer token:',
    '密钥仅在创建时完整显示一次，请妥善保存；泄露后可在控制台停用并重新签发。':
      'The key is shown in full only once. If leaked, disable and re-issue it in the console.',
    '流式输出说明': 'Streaming',
    '每次调用扣费 = 固定请求费 + 输入 token × 输入单价 + 输出 token × 输出单价，单价见':
      'Cost = request fee + input tokens × input rate + output tokens × output rate, see',
    /* 排行榜 */
    '模型用量排行': 'Model Usage Leaderboard',
    '平台近 30 天的真实调用聚合（按模型）。数据随调用实时变化。':
      'Aggregated real usage over the recent period, grouped by model.',
    '近 7 天': 'Last 7 days', '近 30 天': 'Last 30 days', '近 90 天': 'Last 90 days',
    '调用次数': 'Requests', 'tokens': 'tokens', '消耗积分': 'Points spent',
    /* 通用 */
    '加载中…': 'Loading…', '返回首页': 'Back to home',
    '这个页面不存在': 'Page not found', '链接可能已失效，或者地址输错了。': 'The link may be broken, or the address is wrong.',
    /* 后台 */
    '数据概览': 'Dashboard', '模型管理': 'Models', '品牌管理': 'Vendors', '公告管理': 'Announcements',
    '页面内容': 'Page Content', '用户中心': 'User Center', '用户管理': 'Users', '订单管理': 'Orders',
    '工单管理': 'Tickets', '线索管理': 'Leads', '上游渠道': 'Channels', '令牌管理': 'Tokens',
    '分组倍率': 'Groups', '调用日志': 'Logs', '在线客服': 'Support', '站点设置': 'Settings',
    '备份与恢复': 'Backup', '安全设置': 'Security', '操作审计': 'Audit',
    '中转运营': 'Gateway', '内容管理': 'Content', '用户运营': 'Operations', '系统': 'System',
    '退出登录': 'Sign out', '保存': 'Save', '取消': 'Cancel', '删除': 'Delete', '编辑': 'Edit',
    '新建': 'New', '查询': 'Search', '导出 CSV': 'Export CSV', '全部检测': 'Check all',
    '刷新': 'Refresh', '近 7 天': 'Last 7 days', '近 30 天': 'Last 30 days',
    '品牌分类': 'Vendors', '公告弹窗': 'Announcements', '页面区块': 'Page Blocks',
    '模型库': 'Model Library', '用户中心页面': 'UC Pages', '订阅套餐': 'Plans',
    '兑换码': 'Redeem Codes', '用户资料': 'UC Profile', '数据汇总': 'Dashboard',
    '最近调用': 'Recent Calls', '最近操作': 'Recent Actions', '系统状态': 'System Status',
    '模型数': 'Models', '用户数': 'Users', '今日调用': 'Calls Today', '今日消耗': 'Spend Today',
    /* 登录 */
    '管理员登录': 'Admin sign in', '用户名': 'Username', '密码': 'Password', '登录': 'Sign in',
    '服务开小差了': 'Something went wrong', '请求已记录，请稍后重试。如果持续出现，请联系客服。':
      'The error has been logged. Please retry later or contact support.'
  };

  function nodeText(el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); }

  function apply(lang) {
    var pairs = lang === 'en' ? DICT : invert(DICT);
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (n) {
      var raw = n.nodeValue;
      var key = raw.replace(/\s+/g, ' ').trim();
      if (!key) return;
      if (lang === 'en') {
        if (!pairs[key]) return;
        if (n.__zh == null) n.__zh = raw;
        n.nodeValue = raw.replace(key, pairs[key]);
      } else {
        if (n.__zh != null) { n.nodeValue = n.__zh; return; }
        if (pairs[key]) n.nodeValue = raw.replace(key, pairs[key]);
      }
    });
    ['placeholder', 'title', 'aria-label'].forEach(function (attr) {
      document.querySelectorAll('[' + attr + ']').forEach(function (el) {
        var v = el.getAttribute(attr);
        if (!v) return;
        var store = el.__zh || (el.__zh = {});
        if (lang === 'en') {
          if (!pairs[v.trim()]) return;
          if (store[attr] == null) store[attr] = v;
          el.setAttribute(attr, pairs[v.trim()]);
        } else if (store[attr] != null) {
          el.setAttribute(attr, store[attr]);
        }
      });
    });
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    document.querySelectorAll('[data-lang-btn]').forEach(function (b) {
      b.textContent = lang === 'en' ? '中文' : 'EN';
      b.setAttribute('title', lang === 'en' ? '切换到中文' : 'Switch to English');
    });
  }

  var INV = null;
  function invert(d) {
    if (INV) return INV;
    INV = {};
    Object.keys(d).forEach(function (zh) { INV[d[zh]] = zh; });
    return INV;
  }

  var CURRENT = 'zh';
  /** 切换语言：写入偏好后重新加载，保证每次都是「原始 HTML → 一次性翻译」，不会出现回切残留 */
  window.ytkSetLang = function (lang) {
    try { localStorage.setItem('ytk_lang', lang); } catch (e) {}
    var u = location.href.replace(/([?&])lang=(zh|en)(&|$)/, '$1').replace(/[?&]$/, '');
    location.href = u;
  };

  // SPA / 动态渲染：DOM 变化后自动重新翻译（节流）
  function watch() {
    if (!window.MutationObserver) return;
    var timer = null;
    new MutationObserver(function () {
      if (CURRENT !== 'en') return;
      if (timer) return;
      timer = setTimeout(function () { timer = null; apply('en'); }, 150);
    }).observe(document.body, { childList: true, subtree: true });
  }

  function mount() {
    var lang = 'zh';
    try { lang = localStorage.getItem('ytk_lang') || 'zh'; } catch (e) { lang = 'zh'; }
    var m = location.search.match(/[?&]lang=(zh|en)\b/);
    if (m) { lang = m[1]; try { localStorage.setItem('ytk_lang', lang); } catch (e) {} }
    CURRENT = lang;
    apply(lang);
    watch();
    // 切换按钮
    var btn = document.createElement('button');
    btn.setAttribute('data-lang-btn', '1');
    btn.className = 'ytk-lang-btn';
    btn.textContent = lang === 'en' ? '中文' : 'EN';
    btn.addEventListener('click', function () {
      var next = (document.documentElement.lang === 'en') ? 'zh' : 'en';
      window.ytkSetLang(next);
    });
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
