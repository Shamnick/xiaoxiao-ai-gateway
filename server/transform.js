'use strict';
/**
 * 页面后处理：把"复刻母版"改造成可运营的站点
 *   1) 去掉全部「无限续杯 / 无限额度工具」入口与文案
 *   2) 站内链接本地化（不再跳原站）
 *   3) 用自建客服替换外链 kefu 组件
 * 母版保持原样，所有改动集中在这里，便于回滚与审阅。
 */

/** 需要整段删除的原站片段 */
const DROP_EXACT = [
  // 顶栏「全模型无限额度工具」
  '<a href="https://a10.yutiankejiai.com/client/" class="nav-video" target="_blank" rel="noopener noreferrer">全模型无限额度工具<span class="nav-neon">NEW</span></a>',
  // 首页 hero「无限续杯使用」按钮
  `<span class="refill-wrap">
          <a href="https://a10.yutiankejiai.com/client/" class="btn btn-refill" target="_blank" rel="noopener noreferrer">无限续杯使用</a>
          <span class="refill-tag" aria-hidden="true">NEW-FREE</span>
        </span>`,
  // 注册/登录弹窗里的「无限续杯」卡片
  `<div class="ye-card ye-card-refill">
        <h3 class="ye-name">无限续杯</h3>
        <p class="ye-desc">在有效期内无限使用全站模型（非中转站）。</p>
        <p class="ye-price">无限续杯套餐<b>最低 1.9 元起/天</b>，无限额度使用</p>
        <p class="ye-note">需要使用续杯工具</p>
                  <a class="ye-btn" href="https://a10.yutiankejiai.com/client/" target="_blank" rel="noopener noreferrer" data-entry-go>去使用无限续杯</a>
              </div>`,
  // 模型广场顶部「无限续杯」横条
  `<a class="refill-strip container" href="https://a10.yutiankejiai.com/client/" target="_blank" rel="noopener noreferrer">
      <span class="rs-text"><b>无限续杯</b>：有效期内全站模型无限用</span>
      <span class="rs-go">去看看<i aria-hidden="true">→</i></span>
    </a>`,
];

/** 文案改写（避免出现"续杯"字样，同时保持版式） */
const TEXT_REWRITE = [
  ['你需要使用无限续杯还是 API 直连？', '登录后即可调用全站模型'],
  ['<h3 class="ye-name">API 直连</h3>', '<h3 class="ye-name">注册 / 登录</h3>'],
  ['创建指定 API Key 进行模型调用。', '注册账号、创建 API Key，即可开始调用。'],
  ['去使用 API 直连', '进入控制台'],
  ['API 无限套餐<b>比无限续杯贵 20%</b>', '按次计费 · 充值即用 · 明细可查'],
  ['<b>SCROLL</b> 滚动驱动神经中枢旋转', '<b>SCROLL</b> 滚动驱动神经中枢旋转'],
];

function transform(html, opts) {
  const o = opts || {};
  const userBase = o.userBase || '';
  let out = String(html);

  // 1) 精确删除续杯区块
  DROP_EXACT.forEach(s => { out = out.split(s).join(''); });

  // 2) 模型卡片里的续杯链接 + 相应 class
  out = out.replace(/<a class="model-refill"[\s\S]*?<\/a>/g, '');
  out = out.split('class="model-foot has-refill"').join('class="model-foot"');

  // 3) 文案改写
  TEXT_REWRITE.forEach(([a, b]) => { out = out.split(a).join(b); });

  // 4) 链接本地化：原站用户中心 / 续杯工具 → 本地
  if (userBase) {
    out = out.split('https://user.yutiankejiai.com/').join(userBase + '/');
    out = out.split('https://a10.yutiankejiai.com/client/').join(userBase + '/?page=recharge');
  }

  // 4.5) 移除 Cloudflare Turnstile（本地登录走自建接口，不需要人机验证）
  out = out.replace(/<script[^>]*challenges\.cloudflare\.com[^>]*>\s*<\/script>\s*/g, '');
  out = out.replace(/<div class="cf-turnstile[\s\S]*?<\/div>\s*/g, '');
  out = out.replace(/<button([^>]*?)class="auth-btn is-cf-wait"([^>]*?)disabled>([\s\S]*?)<\/button>/g,
    '<button$1class="auth-btn"$2>登录</button>');
  out = out.replace(/\sdata-cf-guard(="[^"]*")?/g, '');
  out = out.replace(/\sis-cf-wait/g, '');

  // 5) 移除第三方客服组件，换成自建
  out = out.replace(/<link[^>]*kefu\.yutiankejiai\.com[^>]*>\s*/g, '');
  out = out.replace(/<script[^>]*kefu\.yutiankejiai\.com[^>]*>\s*<\/script>\s*/g, '');
  out = out.replace(/https:\/\/kefu\.yutiankejiai\.com\/chat\/[^"]*/g, '#support');
  // 客服按钮改为唤起自建浮窗
  out = out.replace(/(<a[^>]*class="cs-btn"[^>]*href=")#support("[^>]*>)/g,
    '$1javascript:void(0)$2'.replace('javascript:void(0)', 'javascript:void(0)'));

  // 6) 注入自建客服（样式 + 脚本），仅注入一次
  if (!out.includes('/assets/js/support.js')) {
    const inject = '<link rel="stylesheet" href="/assets/css/support.css">\n' +
      '<script src="/assets/js/support.js" defer></script>\n';
    out = out.replace('</body>', inject + '</body>');
  }
  return out;
}

module.exports = { transform, DROP_EXACT, TEXT_REWRITE };
