/* ── 页面初始化注册表 ──
 * 直接绑定 DOM 元素的模块注册到 __ytInits：首次加载与每次 PJAX 局部刷新后统一重跑
 * （PJAX 替换 .shell-main 后旧元素连同监听一起被丢弃，重跑即绑到新 DOM，无重复绑定）。
 * 纯事件委托型模块（绑在 document 上）不注册，只执行一次。 */
/* ── 时间统一按北京时间（东八区）显示 ──
 * 后端返回的是 UTC ISO（带 Z），直接 slice 字面截取会显示成 UTC（比北京时间少 8 小时）。
 * 这里**固定 +08:00 换算**，不用 toLocaleString —— 后者跟随浏览器所在时区，
 * 海外/改过系统时区的用户会看到非北京时间，与账单口径（东八区）对不上。
 * 无时区标识的字符串视为后端已按东八区给出，原样截取，避免二次加 8 小时。 */
window.ytFmtCst = function (v) {
  var str = String(v == null ? "" : v);
  if (!str) return "";
  if (!/Z$|[+-]\d{2}:?\d{2}$/.test(str)) return str.replace("T", " ").slice(0, 19);
  var d = new Date(str);
  if (isNaN(d.getTime())) return str.replace("T", " ").slice(0, 19);
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 19);
};

/* ── 订单号输入框只许纯数字（2026-10-13）──
 * 标了 data-d6 的输入框：全角数字转半角、其余字符丢掉；粘贴整串交易号自动取后 6 位
 *（原 maxlength=6 会被浏览器截成前 6 位、必然查不到），手打最多 6 位。
 * 委托绑在 document 上：PJAX 换掉输入框照样生效；全局标记保证只绑一次。 */
(function () {
  if (window.__ytD6Bound) return;
  window.__ytD6Bound = true;
  document.addEventListener("input", function (e) {
    var el = e.target;
    if (!el || !el.hasAttribute || !el.hasAttribute("data-d6")) return;
    var s = String(el.value || ""), v = "";
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c >= 0xff10 && c <= 0xff19) c -= 0xfee0;
      if (c >= 48 && c <= 57) v += String.fromCharCode(c);
    }
    if (v.length > 6) v = e.inputType === "insertFromPaste" ? v.slice(-6) : v.slice(0, 6);
    if (el.value !== v) el.value = v;
  });
})();

window.__ytInits = window.__ytInits || [];
window.ytRunInits = function () {
  "use strict";
  (window.__ytInits || []).forEach(function (fn) {
    try {
      fn();
    } catch (e) {
      /* 单模块失败不拖全页，但**必须留痕** —— 这里原本是空 catch，
         结果 initVideoGen 抛 ReferenceError 时页面看着完全正常、
         整个视频模块却没初始化，白查了半小时（2026-08-22）。 */
      console.error("[ytInit] " + (fn.name || "匿名") + " 初始化失败:", e);
    }
  });
};

/* ── 表单错误提示（全站唯一入口）─────────────────────────────────────
 * 分工：**成功用 toast、失败留在原地**。toast 3.5 秒就消失，用户填错时往往没看见
 * 就以为保存成功了（续充/编辑都踩过）。所以校验与保存失败一律写进表单内的错误条。
 *
 * 用法：容器（一般是 <form>）里放一个 `<p class="dialog-err" data-form-err hidden></p>`，
 * 然后 `ytFormError("表单id", "文案")` / `ytFormErrorClear("表单id")`。
 * 没有错误条的表单自动退化成 toast，保证任何情况下用户都能收到反馈。
 *
 * 各模块**不要再自己写一套 showErr/clearErr** —— 以前 initForcedReset、keys 弹窗各写一份，
 * 样式与清除时机都不一致。
 */
(function () {
  "use strict";
  function boxOf(target) {
    var root = typeof target === "string" ? document.getElementById(target) : target;
    if (!root) return null;
    return root.querySelector("[data-form-err]");
  }
  window.ytFormError = function (target, msg) {
    var box = boxOf(target);
    if (!box) {
      if (window.ytToast) window.ytToast(msg, "error");
      return;
    }
    box.textContent = msg;
    box.hidden = false;
  };
  window.ytFormErrorClear = function (target) {
    var box = boxOf(target);
    if (box) box.hidden = true;
  };
  /* 用户一改内容就清掉旧错误：委托到 document，PJAX 换 DOM 后无需重绑。
     只对**含错误条**的容器生效，不影响其它表单。 */
  document.addEventListener("input", function (e) {
    var root = e.target && e.target.closest ? e.target.closest("form, [data-form-scope]") : null;
    if (root && root.querySelector("[data-form-err]")) window.ytFormErrorClear(root);
  });
  document.addEventListener("change", function (e) {
    var root = e.target && e.target.closest ? e.target.closest("form, [data-form-scope]") : null;
    if (root && root.querySelector("[data-form-err]")) window.ytFormErrorClear(root);
  });
})();

/* 两次密码一致性即时校验（注册页 + 改密码弹窗；表单本身是原生 POST，此处仅体验增强）。 */
window.__ytInits.push(function initConfirmCheck() {
  "use strict";
  var form = document.querySelector("form[data-check-confirm]");
  if (!form || form.dataset.ytBound) return;
  form.dataset.ytBound = "1";
  var pwd = form.querySelector('input[name="password"], input[name="new_password"]');
  var confirm = form.querySelector('input[name="password_confirm"], input[name="new_password_confirm"]');
  var hint = form.querySelector("[data-confirm-hint]");
  var btn = form.querySelector('button[type="submit"]');
  if (!pwd || !confirm) return;

  function check() {
    var mismatch = confirm.value.length > 0 && pwd.value !== confirm.value;
    if (hint) hint.hidden = !mismatch;
    if (btn && !btn.hasAttribute("disabled")) btn.dataset.blocked = mismatch ? "1" : "";
    return !mismatch;
  }
  pwd.addEventListener("input", check);
  confirm.addEventListener("input", check);
  form.addEventListener("submit", function (e) {
    if (!check()) {
      e.preventDefault();
      if (confirm) confirm.focus();
    }
  });
});

/* 复制：.copy-btn 文案按钮会短暂改「已复制」；.key-icon-btn 无边框图标只 toast。 */
(function () {
  "use strict";
  function copyText(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    } else {
      fallback();
    }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.className = "sr-copy-helper";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (_) { /* 忽略 */ }
      document.body.removeChild(ta);
    }
  }
  document.addEventListener("click", function (e) {
    var iconBtn = e.target.closest ? e.target.closest(".key-icon-btn[data-copy]") : null;
    if (iconBtn) {
      var t1 = iconBtn.getAttribute("data-copy") || "";
      if (!t1) return;
      copyText(t1, function () { if (window.ytToast) window.ytToast("已复制"); });
      return;
    }
    var btn = e.target.closest ? e.target.closest(".copy-btn") : null;
    if (!btn) return;
    var text = btn.getAttribute("data-copy") || "";
    if (!text) return;
    var done = function () {
      var old = btn.textContent;
      btn.textContent = "已复制";
      setTimeout(function () { btn.textContent = old; }, 1200);
    };
    copyText(text, done);
  });
})();

/* Key 列小眼睛：默认脱敏，点击切换全文/隐藏（SVG 在按钮内切换）。 */
(function () {
  "use strict";
  var EYE = '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg class="ico" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-key-reveal]") : null;
    if (!btn) return;
    var cell = btn.closest(".key-cell");
    if (!cell) return;
    var disp = cell.querySelector("[data-key-display]");
    var full = cell.getAttribute("data-key-full") || "";
    var masked = cell.getAttribute("data-key-masked") || "";
    if (!disp || !full) return;
    var show = btn.getAttribute("aria-pressed") === "true";
    if (show) {
      disp.textContent = masked;
      cell.classList.remove("is-revealed");
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("title", "显示完整 Key");
      btn.setAttribute("aria-label", "显示完整 Key");
      btn.innerHTML = EYE_OFF;
    } else {
      disp.textContent = full;
      cell.classList.add("is-revealed");
      btn.setAttribute("aria-pressed", "true");
      btn.setAttribute("title", "隐藏 Key");
      btn.setAttribute("aria-label", "隐藏 Key");
      btn.innerHTML = EYE;
    }
  });
})();

/* 弹窗开关：data-open-dialog / data-close-dialog 指向 <dialog> 的 id（个人设置改密码用）。 */
(function () {
  "use strict";
  document.addEventListener("click", function (e) {
    var opener = e.target.closest ? e.target.closest("[data-open-dialog]") : null;
    if (opener) {
      var dlg = document.getElementById(opener.getAttribute("data-open-dialog"));
      if (dlg && typeof dlg.showModal === "function") {
        /* 允许把 data-open-dialog 挂在 <a href> 上：href 是无 JS 时的降级路径，
           弹窗真的能打开就别再跳走（否则会「弹窗一闪然后整页跳转」）。 */
        e.preventDefault();
        dlg.showModal();
      }
      return;
    }
    var closer = e.target.closest ? e.target.closest("[data-close-dialog]") : null;
    if (closer) {
      var d = document.getElementById(closer.getAttribute("data-close-dialog"));
      if (d) d.close();
    }
  });
})();

/* 顶栏用户下拉菜单：点击开关、点外部/ESC 关闭。 */
(function () {
  "use strict";
  function closeAll() {
    document.querySelectorAll(".user-dropdown").forEach(function (d) { d.hidden = true; });
  }
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-toggle-menu]") : null;
    if (btn) {
      var menu = document.getElementById(btn.getAttribute("data-toggle-menu"));
      var dd = menu ? menu.querySelector(".user-dropdown") : null;
      if (dd) {
        var willOpen = dd.hidden;
        closeAll();
        dd.hidden = !willOpen;
      }
      return;
    }
    if (!e.target.closest || !e.target.closest(".user-menu")) closeAll();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAll();
  });
})();

/* 密码强度提示：input[data-strength] → 相邻 [data-pw-meter] 三格。
 * 先看是否符合硬规则（6-12 位且含字母+数字），不符直接红提示；符合后按长度/字符多样性分 弱/中/强。 */
window.__ytInits.push(function initPwMeter() {
  "use strict";
  document.querySelectorAll("input[data-strength]").forEach(function (input) {
    if (input.dataset.ytBound) return;
    input.dataset.ytBound = "1";
    var meter = input.parentElement ? input.parentElement.querySelector("[data-pw-meter]") : null;
    if (!meter) return;
    var label = meter.querySelector("em");
    function grade(v) {
      if (!/^(?=.*[A-Za-z])(?=.*\d)\S{6,12}$/.test(v)) return -1;
      var score = 0;
      if (v.length >= 9) score++;
      if (/[a-z]/.test(v) && /[A-Z]/.test(v)) score++;
      if (/[^A-Za-z0-9]/.test(v)) score++;
      return Math.min(score, 2); // 0 弱 / 1 中 / 2 强
    }
    input.addEventListener("input", function () {
      var v = input.value;
      if (v === "") { meter.hidden = true; return; }
      meter.hidden = false;
      var g = grade(v);
      meter.className = "pw-meter " + (g < 0 ? "pw-bad" : ["pw-weak", "pw-mid", "pw-strong"][g]);
      if (label) label.textContent = g < 0 ? "不符合要求（6-12 位，含字母和数字）" : ["弱", "中", "强"][g];
    });
  });
});

/* 改密码弹窗 fetch 提交：弹窗内报错不丢已填内容；成功提示后自动关闭。 */
window.__ytInits.push(function initChangePwd() {
  "use strict";
  var form = document.querySelector('form[data-ajax="change-password"]');
  if (!form || form.dataset.ytAjaxBound) return;
  form.dataset.ytAjaxBound = "1";
  var msg = form.querySelector("[data-dialog-msg]");
  var submitBtn = form.querySelector('button[type="submit"]');
  function show(text, ok) {
    if (!msg) return;
    msg.hidden = false;
    msg.textContent = text;
    msg.className = "dialog-msg " + (ok ? "is-ok" : "is-err");
  }
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (form.querySelector('button[type="submit"]').dataset.blocked === "1") return;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "提交中…"; }
    fetch(form.getAttribute("action") || "/?page=settings", {
      method: "POST",
      body: new FormData(form),
      headers: { "X-Requested-With": "fetch" },
      credentials: "same-origin",
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) {
          show(d.message || "密码已修改", true);
          setTimeout(function () {
            var dlg = form.closest("dialog");
            if (dlg) dlg.close();
            form.reset();
            if (msg) msg.hidden = true;
            var meter = form.querySelector("[data-pw-meter]");
            if (meter) meter.hidden = true;
            if (window.ytToast) window.ytToast("密码已修改，其它设备已自动退出");
          }, 1200);
        } else {
          show((d && d.error) || "修改失败，请稍后重试", false);
        }
      })
      .catch(function () { show("网络异常，请稍后重试", false); })
      .finally(function () {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "修改密码"; }
      });
  });
});

/* 全局 toast（右上角）。
 * **成功 3.5 秒自动消失；失败常驻，需用户点 × 关闭。**
 * 原先错误也 3.5 秒就没了 —— 像「删除 Key 失败」这种没有表单可回填的场景，
 * 用户一眼没看到就再也拿不回原因了。能就地修正的表单请优先用 ytFormError，
 * 把错误留在表单里；toast 只兜住那些没有输入可改的操作。 */
/* ── 在线客服（2026-09-04，kefu.yutiankejiai.com）──
 * 站内唯一人工入口。widget.js 已挂在骨架里：`[data-kefu]` 链接点击会在侧滑面板打开；
 * 脚本没加载到时 href 新标签兜底。这里只提供两个小工具给 toast / 状态行 / 空态复用。 */
window.YT_KEFU_URL = "https://kefu.yutiankejiai.com/chat/";
window.ytKefuUrl = function (o) {
  o = o || {};
  var p = new URLSearchParams();
  if (o.type) p.set("type", o.type);
  var pg = new URLSearchParams(location.search).get("page") || "";
  p.set("from", o.from || ((location.host + location.pathname).replace(/\/+$/, "") + (/^[a-z0-9_-]{1,32}$/i.test(pg) ? "/" + pg : "")).slice(0, 64));
  if (o.msg) p.set("msg", String(o.msg).slice(0, 500));
  if (o.hint) p.set("hint", String(o.hint).slice(0, 120));
  return window.YT_KEFU_URL + "?" + p.toString();
};
/** 返回一个 <a data-kefu> 元素（默认售后预选、把上下文文案带成首条消息）。 */
window.ytKefuAnchor = function (label, o) {
  o = o || {};
  var a = document.createElement("a");
  a.href = window.ytKefuUrl(o);
  a.target = "_blank"; a.rel = "noopener";
  a.setAttribute("data-kefu", o.type || "");
  if (o.msg) a.setAttribute("data-kefu-msg", String(o.msg).slice(0, 500));
  if (o.className) a.className = o.className;
  a.textContent = label || "联系在线客服";
  return a;
};
/** 状态行 / 提示里出现「联系客服」字样时，顺手补一个可点的入口（文案仍保持纯文本）。 */
window.ytKefuDecorate = function (el, text, o) {
  if (!el || !/联系(在线)?客服/.test(text || "")) return;
  el.appendChild(document.createTextNode(" "));
  el.appendChild(window.ytKefuAnchor("去联系客服", Object.assign({ msg: text }, o || {})));
};

window.ytToast = function (text, kind) {
  "use strict";
  var root = document.getElementById("toast-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "toast-root";
    document.body.appendChild(root);
  }
  var isErr = kind === "error" || kind === "err";
  var el = document.createElement("div");
  el.className = "toast " + (isErr ? "toast-err" : "toast-ok");
  var txt = document.createElement("span");
  txt.className = "toast-txt";
  txt.textContent = text;
  el.appendChild(txt);
  var dismiss = function () {
    el.classList.remove("is-in");
    setTimeout(function () { el.remove(); }, 350);
  };
  if (isErr) {
    var x = document.createElement("button");
    x.type = "button";
    x.className = "toast-x";
    x.setAttribute("aria-label", "关闭");
    x.textContent = "×";
    x.addEventListener("click", dismiss);
    el.appendChild(x);
  }
  /* 提示里让用户「联系客服」时，直接给一个能点的入口，别让他自己去找 */
  if (/联系(在线)?客服/.test(text || "") && window.ytKefuAnchor) {
    var go = window.ytKefuAnchor("去联系客服", { msg: text, className: "toast-act" });
    go.addEventListener("click", function () { setTimeout(dismiss, 100); });
    el.appendChild(go);
  }
  root.appendChild(el);
  setTimeout(function () { el.classList.add("is-in"); }, 20);
  if (!isErr) setTimeout(dismiss, 3500);
};

/* 模型价格弹窗：厂商分组 + 搜索 + sessionStorage 缓存（stale-while-revalidate）。
 * 缓存只用来「秒开」：命中先渲染旧数据，同时后台拉一次最新，价格有变就重渲染并覆盖缓存
 * —— 后台调价后不会因为缓存一直显示旧价（旧实现缓存 1 小时且命中即 return，看着像没联动）。
 * 渲染标志存 DOM dataset：PJAX 局部刷新重建弹窗后自动回到未渲染态。 */
(function () {
  "use strict";
  /* v2（2026-08-18）：价目新增 brand / brand_label / vision 字段。
     必须换键 —— 沿用 v1 会先拿旧缓存渲染出「无 logo + 一律文本模型」的错误内容，
     虽然随后会被最新数据覆盖，但那一瞬间的展示是错的。 */
  var CACHE_KEY = "yt_model_prices_v2";
  var CACHE_TTL = 3600000; // 1 小时：仅作「秒开」用的陈旧上限，超时则不拿它打底

  /* 厂商分组：**优先用后端下发的 brand_label**（来自官网用户端注册表，与后台配置一致）；
     后端没给（老缓存/旧接口）才回落到按模型名猜。猜的规则容易与后台配置不一致，只作兜底。 */
  function vendorOf(m) {
    var s = m.toLowerCase();
    if (/^(gpt|o[0-9]|chatgpt|dall|sora)/.test(s)) return "OpenAI";
    if (/claude/.test(s)) return "Anthropic";
    if (/gemini|gemma|imagen|veo/.test(s)) return "Google";
    if (/grok/.test(s)) return "xAI";
    if (/deepseek/.test(s)) return "DeepSeek";
    if (/kimi|moonshot/.test(s)) return "月之暗面";
    if (/glm|chatglm/.test(s)) return "智谱";
    if (/qwen|通义|wan/.test(s)) return "通义千问";
    if (/llama/.test(s)) return "Meta";
    if (/doubao|豆包/.test(s)) return "豆包";
    if (/minimax|abab/.test(s)) return "MiniMax";
    return "其他模型";
  }
  function groupOf(p) { return String(p.brand_label || vendorOf(String(p.model))); }

  /* 品牌 logo：后端给的 brand 就是文件名（与官网 a1 同一套素材，lobe-icons MIT）。
     缺 brand 或没这张图时不渲染 img（HTML 里不留空标签），行内只显示模型名。 */
  function logoHtml(p) {
    var b = String(p.brand || "").trim();
    if (!b) return "";
    return '<img class="price-logo" src="assets/img/brands/' + esc(b) + '.svg" alt="' + esc(b) +
      '" width="18" height="18" loading="lazy" decoding="async" onerror="this.remove()">';
  }

  /* 特性标签：识图 → 视觉模型；不识图 → 文本模型；未标注同样按文本模型呈现
     （宁可少宣称，也不能让客户以为能传图）。函数调用为全模型通用能力，恒显示。 */
  function featureHtml(p) {
    var visual = p.vision === true;
    return '<span class="price-feat' + (visual ? " is-visual" : "") + '">' +
      (visual ? "视觉模型" : "文本模型") + "</span>" +
      '<span class="price-feat">函数调用</span>';
  }

  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* 复制图标（与 Key 列表同款 feather copy，走全局 [data-copy] 点击委托） */
  var COPY_ICON =
    '<svg class="ico" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>' +
    '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  /* ── 网络延迟列（纯前端演示值，非真实探测）──
   * 可用模型：33~296ms 全区间随机跳动（绿点）；不可用：固定 2000ms（红点）。
   * SPIKE_MODELS 里的模型每跳动 3~7 次会「黄一下」：一次性冲到 300ms 以上（琥珀色），随后回落。
   * 仅刷新当前可见行，弹窗关闭 / 被 PJAX 换掉即停表。 */
  var LAT_MIN = 33, LAT_MAX = 296, LAT_OFF = 2000, LAT_TICK = 1500;
  var SPIKE_MIN = 302, SPIKE_MAX = 690;
  var SPIKE_EVERY_MIN = 3, SPIKE_EVERY_MAX = 7;
  /* 偶发抖动的模型（小写名匹配 data-model） */
  var SPIKE_MODELS = {};
  ["Claude-Opus-4.6", "Claude-Sonnet-4.6", "Claude-Sonnet-4.5", "Claude-Sonnet-3.7",
    "GPT-5.4", "GPT-5.1-Codex-Max", "Grok-4.3", "GLM-5", "Kimi-K2.6", "MiniMax-M2.5",
    "Llama-4-Maverick", "Llama-3.3-70B", "Hunyuan-T1", "Hunyuan-2.0-Instruct",
    "Hunyuan-3-Preview", "Hunyuan-Role-Latest",
  ].forEach(function (n) { SPIKE_MODELS[n.toLowerCase()] = 1; });

  var latTimer = null;
  var spikeLeft = {}; // 模型名(小写) → 距离下次「黄一下」还剩几拍

  function randInt(min, max) { return min + Math.floor(Math.random() * (max - min + 1)); }

  function stopLatency() {
    if (latTimer) { clearInterval(latTimer); latTimer = null; }
  }

  function startLatency(root) {
    stopLatency();
    function tick() {
      // 弹窗被 PJAX 换掉/关闭后自动收摊，避免后台空转
      if (!root.isConnected) { stopLatency(); return; }
      root.querySelectorAll(".price-row:not(.is-off)").forEach(function (tr) {
        if (tr.hidden) return; // 只刷新可见行
        var el = tr.querySelector("[data-lat]");
        if (!el) return;
        var key = tr.getAttribute("data-model");
        var spike = false;
        if (SPIKE_MODELS[key]) {
          if (spikeLeft[key] == null) spikeLeft[key] = randInt(SPIKE_EVERY_MIN, SPIKE_EVERY_MAX);
          spikeLeft[key] -= 1;
          if (spikeLeft[key] <= 0) {
            spike = true;
            spikeLeft[key] = randInt(SPIKE_EVERY_MIN, SPIKE_EVERY_MAX);
          }
        }
        el.textContent = (spike ? randInt(SPIKE_MIN, SPIKE_MAX) : randInt(LAT_MIN, LAT_MAX)) + " ms";
        el.classList.toggle("is-warn", spike);
      });
    }
    tick();
    latTimer = setInterval(tick, LAT_TICK);
  }

  /* 302 式布局：顶部搜索 + 左侧厂商列表（含数量）+ 右侧该厂商报价表。 */
  function render(prices) {
    var body = document.getElementById("price-body");
    if (!body) return;
    var groups = {};
    var order = [];
    prices.forEach(function (p) {
      var v = groupOf(p);
      if (!groups[v]) { groups[v] = []; order.push(v); }
      groups[v].push(p);
    });
    // 数量降序，「其他模型」永远放最后
    order.sort(function (a, b) {
      if (a === "其他模型") return 1;
      if (b === "其他模型") return -1;
      return groups[b].length - groups[a].length;
    });

    var vendorsHtml = '<button type="button" class="price-vendor" data-vendor="">全部模型<small data-count>' + prices.length + "</small></button>";
    order.forEach(function (v) {
      vendorsHtml += '<button type="button" class="price-vendor" data-vendor="' + esc(v) + '">' + esc(v) +
        "<small data-count>" + groups[v].length + "</small></button>";
    });

    var rowsHtml = "";
    order.forEach(function (v) {
      rowsHtml += '<tr class="price-group-row" data-group="' + esc(v) + '"><td colspan="5">' + esc(v) +
        ' <small>（' + groups[v].length + '）</small></td></tr>';
      groups[v].forEach(function (p) {
        // available 由后台「模型库」的可用开关决定；缺省视为可用（老缓存无该字段时不误标）
        var off = p.available === false;
        var key = String(p.model).toLowerCase();
        rowsHtml += '<tr class="price-row' + (off ? " is-off" : "") + '" data-model="' + esc(key) +
          '" data-group="' + esc(v) + '">' +
          // 品牌 logo + 模型名 + 复制按钮（复用全局 .key-icon-btn[data-copy] 委托）
          '<td><span class="price-model">' + logoHtml(p) + esc(p.model) +
          '<button type="button" class="key-icon-btn price-copy" data-copy="' + esc(p.model) +
          '" title="复制模型名" aria-label="复制模型名">' + COPY_ICON + "</button></span></td>" +
          // 不可用模型不报价，避免用户按价下单后发现调不通
          '<td class="price-num">' + (off ? "- 积分/次" : Number(p.price) + " 积分/次") + "</td>" +
          '<td class="price-feats">' + featureHtml(p) + "</td>" +
          '<td><span class="price-state' + (off ? " is-off" : "") + '">' + (off ? "不可用" : "可用") + "</span></td>" +
          '<td><span class="price-lat' + (off ? " is-off" : "") + '" data-lat>' +
          (off ? LAT_OFF + " ms" : "—") + "</span></td></tr>";
      });
    });

    body.innerHTML = '<input type="search" class="price-search" id="price-search" placeholder="搜索模型名称…">' +
      '<div class="price-layout">' +
      '<nav class="price-vendors" id="price-vendors">' + vendorsHtml + "</nav>" +
      '<div class="price-main price-scroll"><table class="key-table price-table">' +
      "<thead><tr><th>模型</th><th>用户单价</th><th>特性</th><th>状态</th><th>网络延迟</th></tr></thead><tbody>" +
      rowsHtml + "</tbody></table>" +
      '<p class="price-loading" id="price-empty" hidden>没有匹配的模型</p></div></div>';
    body.dataset.rendered = "1";

    var state = { vendor: order[0] || "", q: "" };
    var nav = document.getElementById("price-vendors");
    var emptyTip = document.getElementById("price-empty");

    function apply() {
      var shown = 0;
      var hitByVendor = {};
      body.querySelectorAll(".price-row").forEach(function (tr) {
        var g = tr.getAttribute("data-group");
        var hitQ = !state.q || tr.getAttribute("data-model").indexOf(state.q) !== -1;
        if (hitQ) hitByVendor[g] = (hitByVendor[g] || 0) + 1;
        var show = hitQ && (!state.vendor || g === state.vendor);
        tr.hidden = !show;
        if (show) shown++;
      });
      // 组头只在「全部模型」视图下显示（单厂商视图无需重复厂商名）
      body.querySelectorAll(".price-group-row").forEach(function (tr) {
        tr.hidden = !!state.vendor || !hitByVendor[tr.getAttribute("data-group")];
      });
      var totalHit = 0;
      order.forEach(function (v) { totalHit += hitByVendor[v] || 0; });
      nav.querySelectorAll(".price-vendor").forEach(function (btn) {
        var v = btn.getAttribute("data-vendor");
        var n = v ? (hitByVendor[v] || 0) : totalHit;
        btn.querySelector("[data-count]").textContent = n;
        btn.classList.toggle("is-active", v === state.vendor);
        btn.classList.toggle("is-dim", n === 0);
      });
      if (emptyTip) emptyTip.hidden = shown > 0;
    }

    nav.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest(".price-vendor") : null;
      if (!btn) return;
      state.vendor = btn.getAttribute("data-vendor");
      apply();
    });
    var search = document.getElementById("price-search");
    if (search) {
      search.addEventListener("input", function () {
        state.q = search.value.trim().toLowerCase();
        if (state.q) state.vendor = ""; // 搜索时切到全部，跨厂商命中
        apply();
      });
    }
    apply();

    // 延迟列开始跳动；弹窗关闭即停表（dialog 被 PJAX 重建时 dataset 复位，会重新绑定）
    startLatency(body);
    var dlg = document.getElementById("price-dialog");
    if (dlg && dlg.dataset.latBound !== "1") {
      dlg.dataset.latBound = "1";
      dlg.addEventListener("close", stopLatency);
    }
  }

  document.addEventListener("click", function (e) {
    var opener = e.target.closest ? e.target.closest('[data-open-dialog="price-dialog"]') : null;
    if (!opener) return;
    var bodyEl = document.getElementById("price-body");
    if (!bodyEl) return;
    /* data-price-key：按该 Key 的真实扣费单价展示（Key 倍率是签发时快照，可能与当前
       全局加价不同 —— 不区分就会出现「页面显示 A、实际扣 B」）。切换 Key 需重渲染，
       故此处按 scope 判断是否已渲染，而不是简单的 rendered 标记。 */
    var priceKeyId = opener.getAttribute("data-price-key") || "";
    var wantScope = priceKeyId ? "key:" + priceKeyId : "current";
    if (bodyEl.dataset.rendered === "1" && bodyEl.dataset.scope === wantScope) return;
    bodyEl.dataset.rendered = "";
    bodyEl.dataset.scope = wantScope;
    var noteEl = document.getElementById("price-scope-note");
    if (noteEl) {
      /* 只在「按某把 Key 查」时说明价格锁定；默认视图不再挂那段长提示
         （运营要求去掉：默认就是当前价，多一段字反而挡住表格）。 */
      noteEl.textContent = priceKeyId
        ? "以下为该 API Key 的实际扣费单价（按其签发时的价格锁定，不随后续调价变动）。"
        : "";
      noteEl.hidden = !priceKeyId;
    }
    var CK = priceKeyId ? CACHE_KEY + "_" + priceKeyId : CACHE_KEY;
    // 1) 有未过期缓存 → 先渲染，弹窗秒开（不 return，仍会去校验最新价）
    var stale = null;
    try {
      var cached = JSON.parse(sessionStorage.getItem(CK) || "null");
      if (cached && Date.now() - cached.at < CACHE_TTL && Array.isArray(cached.prices)) {
        stale = cached.prices;
        render(stale);
      }
    } catch (_) { /* 缓存损坏则忽略 */ }
    // 2) 后台拉最新：与缓存不一致才重渲染（管理端调价后自动跟上）
    fetch("/?ajax=model_prices" + (priceKeyId ? "&key_id=" + encodeURIComponent(priceKeyId) : ""),
      { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !Array.isArray(d.prices)) throw new Error("bad");
        try { sessionStorage.setItem(CK, JSON.stringify({ at: Date.now(), prices: d.prices })); } catch (_) { /* 空间不足忽略 */ }
        var same = stale && JSON.stringify(stale) === JSON.stringify(d.prices);
        if (!same) render(d.prices);
      })
      .catch(function () {
        if (stale) return; // 已有旧数据兜底，静默失败
        var body = document.getElementById("price-body");
        if (body) body.innerHTML = '<p class="price-loading">价格加载失败，请稍后重试。</p>';
      });
  });
})();

/* 使用明细弹窗：data-open-usage 触发；时间筛选 + 分页。
 * 三页数据源不同：API 调用读 Key 请求日志（/?ajax=usage_logs），
 * 图片与视频是网页端直接生成、不经 Key，读 /?ajax=media_logs。 */
(function () {
  "use strict";
  var dlg = null, state = { tab: "api", from: "", to: "", page: 1, totalPages: 1 };
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function pts(v) { return Math.round(Number(v || 0) * 10000) / 10000; } // 双保险去浮点尾差
  function secs(ms) {
    var n = Number(ms);
    return Number.isFinite(n) && n > 0 ? (n / 1000).toFixed(1) + " s" : "—";
  }
  /* 生成任务的状态比 API 调用多两个中间态：领走前是排队中，出图/出片前是生成中。 */
  var MEDIA_STATUS = {
    succeeded: ["成功", "badge-green"],
    failed: ["失败", "badge-red"],
    canceled: ["已取消", "badge-gray"],
    pending: ["排队中", "badge-gray"],
    running: ["生成中", "badge-blue"]
  };
  function apiTable(d) {
    /* 本页是「消耗」卡的全量明细，会混合名下所有 Key 的记录 → 必须显示 Key 列区分。
       （单 Key 日志弹窗是另一个，那里整表都属同一把 Key，不需要重复这一列。） */
    var rows = d.records.map(function (r) {
      var ok = r.status === "success";
      return "<tr><td class=\"td-time\">" + esc(window.ytFmtCst(r.at)) + "</td>" +
        '<td class="td-keyname" title="' + esc(r.key_name || "—") + '">' + esc(r.key_name || "—") + "</td>" +
        "<td>" + esc(r.model) + "</td>" +
        '<td><span class="badge ' + (ok ? "badge-green" : "badge-red") + '">' + (ok ? "成功" : "失败") + "</span></td>" +
        '<td><span class="badge badge-orange">-' + pts(r.points) + " 积分</span></td>" +
        '<td class="td-dim">' + secs(r.duration_ms) + "</td></tr>";
    }).join("");
    return '<div class="key-table-wrap usage-scroll"><table class="key-table"><thead><tr>' +
      "<th>时间</th><th>Key</th><th>模型</th><th>状态</th><th>扣费</th><th>耗时</th></tr></thead><tbody>" +
      rows + "</tbody></table></div>";
  }
  function mediaTable(d) {
    /* 扣费列在退款后改显示「已退 N 积分」而不是「-N 积分」：失败的任务钱是退回来的，
       仍按扣费展示会让用户以为白扣了一笔，跑来找客服。 */
    var rows = d.records.map(function (r) {
      var st = MEDIA_STATUS[r.status] || [r.status || "—", "badge-gray"];
      var fee = r.refunded
        ? '<span class="badge badge-green">已退 ' + pts(r.points) + " 积分</span>"
        : '<span class="badge badge-orange">-' + pts(r.points) + " 积分</span>";
      return "<tr><td class=\"td-time\">" + esc(window.ytFmtCst(r.at)) + "</td>" +
        "<td>" + esc(r.label || "—") + "</td>" +
        '<td><span class="badge ' + st[1] + '">' + esc(st[0]) + "</span></td>" +
        "<td>" + fee + "</td>" +
        '<td class="td-dim">' + secs(r.duration_ms) + "</td></tr>";
    }).join("");
    return '<div class="key-table-wrap usage-scroll"><table class="key-table"><thead><tr>' +
      "<th>时间</th><th>" + (d.type === "video" ? "规格" : "模型") +
      "</th><th>状态</th><th>扣费</th><th>耗时</th></tr></thead><tbody>" + rows + "</tbody></table></div>";
  }
  var EMPTY = {
    api: "该时间范围内暂无调用记录。",
    image: "该时间范围内暂无图片生成记录。",
    video: "该时间范围内暂无视频生成记录。"
  };
  function load() {
    var body = document.getElementById("usage-body");
    if (!body) return;
    var tab = state.tab;
    body.innerHTML = '<p class="price-loading">加载中…</p>';
    var url = tab === "api"
      ? "/?ajax=usage_logs&from=" + state.from + "&to=" + state.to + "&p=" + state.page
      : "/?ajax=media_logs&type=" + tab + "&from=" + state.from + "&to=" + state.to + "&p=" + state.page;
    fetch(url, { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) throw new Error("bad");
        if (state.tab !== tab) return; // 请求飞行途中用户切了页，丢弃这次结果
        state.totalPages = Math.max(1, Math.ceil(d.total / d.pageSize));
        var totalEl = document.getElementById("usage-total");
        if (totalEl) totalEl.textContent = "共 " + d.total + " 条";
        var pageEl = document.getElementById("usage-page");
        if (pageEl) pageEl.textContent = state.page + " / " + state.totalPages;
        if (!d.records.length) {
          body.innerHTML = '<p class="price-loading">' + EMPTY[tab] + "</p>";
          return;
        }
        body.innerHTML = tab === "api" ? apiTable(d) : mediaTable(d);
      })
      .catch(function () { body.innerHTML = '<p class="price-loading">加载失败，请稍后重试。</p>'; });
  }
  document.addEventListener("click", function (e) {
    var opener = e.target.closest ? e.target.closest("[data-open-usage]") : null;
    if (opener) {
      dlg = document.getElementById("usage-dialog");
      if (!dlg) return;
      state.from = opener.getAttribute("data-from") || "";
      state.to = opener.getAttribute("data-to") || "";
      state.page = 1;
      state.tab = "api"; // 每次打开都回到第一页，避免带着上次的页签与页码
      var tabs = dlg.querySelectorAll("[data-usage-tab]");
      for (var i = 0; i < tabs.length; i++) {
        tabs[i].classList.toggle("is-active", tabs[i].getAttribute("data-usage-tab") === "api");
      }
      var fi = document.getElementById("usage-from"), ti = document.getElementById("usage-to");
      if (fi) fi.value = state.from;
      if (ti) ti.value = state.to;
      dlg.showModal();
      load();
      return;
    }
    var tabBtn = e.target.closest ? e.target.closest("[data-usage-tab]") : null;
    if (tabBtn) {
      var next = tabBtn.getAttribute("data-usage-tab") || "api";
      if (next === state.tab) return;
      state.tab = next;
      state.page = 1;
      var sibs = tabBtn.parentNode ? tabBtn.parentNode.querySelectorAll("[data-usage-tab]") : [];
      for (var j = 0; j < sibs.length; j++) sibs[j].classList.toggle("is-active", sibs[j] === tabBtn);
      load();
      return;
    }
    if (e.target.id === "usage-query") {
      var fi2 = document.getElementById("usage-from"), ti2 = document.getElementById("usage-to");
      if (fi2 && fi2.value) state.from = fi2.value;
      if (ti2 && ti2.value) state.to = ti2.value;
      state.page = 1;
      load();
    }
    if (e.target.id === "usage-prev" && state.page > 1) { state.page--; load(); }
    if (e.target.id === "usage-next" && state.page < state.totalPages) { state.page++; load(); }
  });
})();

/* 单 Key 请求日志弹窗：外框高度固定；表头常驻；每页 20 条按需拉取（只换 tbody）。
 * 加载用遮罩，不清空表格，避免外框「往上缩」。打开/重置默认东八区近 7 天。 */
(function () {
  "use strict";
  var PAGE_SIZE = 20;
  var state = {
    keyId: "", keyName: "", keyMasked: "", from: "", to: "", rid: "",
    page: 1, totalPages: 1, total: 0, defFrom: "", defTo: "", loading: false, seq: 0
  };
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function fmtMs(ms) {
    var n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return "—";
    return n >= 1000 ? (n / 1000).toFixed(1) + "s" : Math.round(n) + "ms";
  }
  function shortId(id) {
    var s = String(id || "");
    if (!s) return "—";
    return s.length > 20 ? s.slice(0, 10) + "…" + s.slice(-4) : s;
  }
  /** 东八区今天起往前 6 天 → 近一周（与后端 parseRange days=7 口径一致）。 */
  function last7DaysCst() {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    var get = function (t) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return parts[i].value;
      return "";
    };
    var y = parseInt(get("year"), 10), m = parseInt(get("month"), 10), d = parseInt(get("day"), 10);
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };
    var to = y + "-" + pad(m) + "-" + pad(d);
    var fromUtc = new Date(Date.UTC(y, m - 1, d - 6));
    var from = fromUtc.getUTCFullYear() + "-" + pad(fromUtc.getUTCMonth() + 1) + "-" + pad(fromUtc.getUTCDate());
    return { from: from, to: to };
  }
  function applyDefaultWeek() {
    var r = last7DaysCst();
    state.defFrom = r.from;
    state.defTo = r.to;
    state.from = r.from;
    state.to = r.to;
  }
  function tbody() { return document.getElementById("key-log-tbody"); }
  function setTbodyHtml(html) {
    var tb = tbody();
    if (tb) tb.innerHTML = html;
  }
  function syncPager() {
    var totalEl = document.getElementById("key-log-total");
    if (totalEl) totalEl.textContent = "共 " + state.total + " 条 · 每页 " + PAGE_SIZE + " 条";
    var pageEl = document.getElementById("key-log-page");
    if (pageEl) pageEl.textContent = state.page + " / " + state.totalPages;
    var prev = document.getElementById("key-log-prev");
    var next = document.getElementById("key-log-next");
    if (prev) prev.disabled = state.loading || state.page <= 1;
    if (next) next.disabled = state.loading || state.page >= state.totalPages;
  }
  function setLoading(on) {
    state.loading = on;
    var tip = document.getElementById("key-log-loading");
    if (tip) tip.hidden = !on;
    ["key-log-query", "key-log-reset", "key-log-refresh"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.disabled = !!on;
    });
    syncPager();
  }
  function syncInputs() {
    var fi = document.getElementById("key-log-from");
    var ti = document.getElementById("key-log-to");
    var ri = document.getElementById("key-log-rid");
    if (fi) fi.value = state.from;
    if (ti) ti.value = state.to;
    if (ri) ri.value = state.rid;
    var title = document.getElementById("key-log-title");
    if (title) title.textContent = state.keyName ? ("请求日志 · " + state.keyName) : "请求日志";
  }
  function readFilter() {
    var fi = document.getElementById("key-log-from");
    var ti = document.getElementById("key-log-to");
    var ri = document.getElementById("key-log-rid");
    if (fi && fi.value) state.from = fi.value;
    if (ti && ti.value) state.to = ti.value;
    state.rid = ri ? String(ri.value || "").trim() : "";
  }
  function renderRows(records, keyLabel) {
    if (!records || !records.length) {
      setTbodyHtml(
        '<tr class="key-log-placeholder"><td colspan="8">' +
          '<div class="key-log-empty"><p>暂无数据</p><span>该时间范围内没有此 Key 的调用记录</span></div>' +
        "</td></tr>"
      );
      return;
    }
    setTbodyHtml(records.map(function (r) {
      var t = window.ytFmtCst(r.at);
      var ok = r.status === "success";
      var pts = Math.round(Number(r.points || 0) * 10000) / 10000;
      var rid = r.request_id ? String(r.request_id) : "—";
      var dur = fmtMs(r.duration_ms) + " / " + fmtMs(r.first_token_ms);
      var err = r.error ? (' title="' + esc(r.error) + '"') : "";
      return "<tr" + err + ">" +
        '<td class="td-time">' + esc(t) + "</td>" +
        '<td class="td-mono" title="' + esc(keyLabel) + '">' + esc(keyLabel) + "</td>" +
        '<td class="td-mono" title="' + esc(rid) + '">' + esc(shortId(rid)) + "</td>" +
        '<td><span class="badge ' + (ok ? "badge-green" : "badge-red") + '">' + (ok ? "成功" : "失败") + "</span></td>" +
        "<td>" + esc(r.model || "—") + "</td>" +
        '<td><span class="badge badge-orange">' + pts + "</span></td>" +
        '<td class="td-dim">' + esc(dur) + "</td>" +
        '<td class="td-dim">' + esc(r.ip || "—") + "</td>" +
        "</tr>";
    }).join(""));
  }
  function load() {
    if (!state.keyId) return;
    var seq = ++state.seq;
    setLoading(true); // 遮罩加载，不拆表格 → 外框高度不变
    var q = "/?ajax=usage_logs&key_id=" + encodeURIComponent(state.keyId) +
      "&from=" + encodeURIComponent(state.from) + "&to=" + encodeURIComponent(state.to) +
      "&p=" + state.page + "&page_size=" + PAGE_SIZE;
    if (state.rid) q += "&request_id=" + encodeURIComponent(state.rid);
    fetch(q, { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json().then(function (d) { return { d: d }; }); })
      .then(function (x) {
        if (seq !== state.seq) return; // 丢弃过期响应，防快速翻页错乱
        var d = x.d;
        if (!d || !d.ok) throw new Error((d && d.error) || "加载失败，请稍后重试。");
        if (!state.keyMasked && d.key_masked) state.keyMasked = d.key_masked;
        var keyLabel = state.keyMasked || state.keyName || state.keyId;
        var size = d.pageSize || PAGE_SIZE;
        state.total = d.total || 0;
        state.totalPages = Math.max(1, Math.ceil(state.total / size));
        if (state.page > state.totalPages) state.page = state.totalPages;
        renderRows(d.records || [], keyLabel);
        var sc = document.getElementById("key-log-scroll");
        if (sc) sc.scrollTop = 0;
      })
      .catch(function (e) {
        if (seq !== state.seq) return;
        setTbodyHtml(
          '<tr class="key-log-placeholder"><td colspan="8">' +
            '<div class="key-log-empty"><p>加载失败</p><span>' + esc((e && e.message) || "请稍后重试") + "</span></div>" +
          "</td></tr>"
        );
      })
      .then(function () {
        if (seq === state.seq) setLoading(false);
      });
  }
  document.addEventListener("click", function (e) {
    var opener = e.target.closest ? e.target.closest("[data-open-key-log]") : null;
    if (opener) {
      var dlg = document.getElementById("key-log-dialog");
      if (!dlg) return;
      state.keyId = opener.getAttribute("data-key-id") || "";
      state.keyName = opener.getAttribute("data-key-name") || "";
      state.keyMasked = opener.getAttribute("data-key-masked") || "";
      applyDefaultWeek();
      state.rid = "";
      state.page = 1;
      state.total = 0;
      state.totalPages = 1;
      syncInputs();
      syncPager();
      setTbodyHtml(
        '<tr class="key-log-placeholder"><td colspan="8">' +
          '<div class="key-log-empty"><p>加载中…</p><span>正在拉取近 7 天日志（每页 ' + PAGE_SIZE + " 条）</span></div>" +
        "</td></tr>"
      );
      dlg.showModal();
      load();
      return;
    }
    if (e.target.id === "key-log-query") {
      if (state.loading) return;
      readFilter();
      state.page = 1;
      load();
      return;
    }
    if (e.target.id === "key-log-reset") {
      if (state.loading) return;
      applyDefaultWeek();
      state.rid = "";
      state.page = 1;
      syncInputs();
      load();
      return;
    }
    if (e.target.id === "key-log-refresh") {
      if (state.loading) return;
      readFilter();
      load();
      return;
    }
    if (e.target.id === "key-log-prev" && !state.loading && state.page > 1) { state.page--; load(); }
    if (e.target.id === "key-log-next" && !state.loading && state.page < state.totalPages) { state.page++; load(); }
  });
})();

/* 302 式日期范围选择器（drp）：自绘双月日历 + 快捷下拉联动，无第三方依赖。
 * 结构由 PHP yt_range_toolbar 输出：[data-drp] 内含 hidden from/to、触发按钮、面板容器。
 * 选择起止 → 确定写回 hidden + 显示文本，并把下拉切到「自定义」；提交仍走表单 GET，服务端权威解析。
 * init 注册型（PJAX 后重绑新 DOM）；「点外关闭/ESC」为下方顶层一次性委托，不在此重复绑 document。 */
window.__ytInits.push(function initDrp() {
  "use strict";
  var box = document.querySelector("[data-drp]");
  if (!box || box.dataset.ytBound) return;
  box.dataset.ytBound = "1";
  var form = box.closest("form");
  var sel = form ? form.querySelector("#range-select") : null;
  var inFrom = box.querySelector('input[name="from"]');
  var inTo = box.querySelector('input[name="to"]');
  var label = box.querySelector("[data-drp-label]");
  var panel = box.querySelector("[data-drp-panel]");
  var maxD = box.getAttribute("data-max") || "";
  var view; // 右侧月份的 1 号（Date）
  var selS = "", selE = "", picking = false, hoverD = "";

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function ymLabel(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1); }

  function monthTable(base) {
    var y = base.getFullYear(), m = base.getMonth();
    var start = new Date(y, m, 1 - new Date(y, m, 1).getDay()); // 周日起
    var html = '<table class="drp-grid"><thead><tr>';
    "日一二三四五六".split("").forEach(function (w) { html += "<th>" + w + "</th>"; });
    html += "</tr></thead><tbody>";
    for (var r = 0; r < 6; r++) {
      html += "<tr>";
      for (var c = 0; c < 7; c++) {
        var cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + r * 7 + c);
        var d = ymd(cur);
        if (cur.getMonth() !== m) {
          html += '<td><span class="drp-day is-out">' + cur.getDate() + "</span></td>";
        } else {
          var dis = maxD && d > maxD;
          html += '<td><button type="button" class="drp-day" data-d="' + d + '"' + (dis ? " disabled" : "") + ">" + cur.getDate() + "</button></td>";
        }
      }
      html += "</tr>";
    }
    return html + "</tbody></table>";
  }

  function render() {
    var left = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    panel.innerHTML =
      '<div class="drp-months">' +
      '<div class="drp-month"><div class="drp-mhead">' +
      '<span><button type="button" class="drp-nav" data-nav="py" aria-label="上一年">«</button>' +
      '<button type="button" class="drp-nav" data-nav="pm" aria-label="上一月">‹</button></span>' +
      "<b>" + ymLabel(left) + "</b><span></span></div>" + monthTable(left) + "</div>" +
      '<div class="drp-month"><div class="drp-mhead"><span></span><b>' + ymLabel(view) + "</b>" +
      '<span><button type="button" class="drp-nav" data-nav="nm" aria-label="下一月">›</button>' +
      '<button type="button" class="drp-nav" data-nav="ny" aria-label="下一年">»</button></span></div>' +
      monthTable(view) + "</div></div>" +
      '<div class="drp-foot"><span class="drp-sel"><b data-s>—</b><i>—</i><b data-e>—</b></span>' +
      '<button type="button" class="btn-primary btn-sm" data-drp-ok>确定</button></div>';
    paint();
  }

  /* 只刷高亮类与底部起止文案，不重建 DOM（hover 预览高频调用）。 */
  function paint() {
    var s = selS, e = picking ? (hoverD || selS) : selE;
    if (s && e && e < s) { var t = s; s = e; e = t; }
    panel.querySelectorAll(".drp-day[data-d]").forEach(function (btn) {
      var d = btn.getAttribute("data-d");
      btn.classList.toggle("is-start", !!s && d === s);
      btn.classList.toggle("is-end", !!e && d === e);
      btn.classList.toggle("is-in", !!s && !!e && d > s && d < e);
      btn.classList.toggle("is-today", d === maxD);
    });
    var bs = panel.querySelector("[data-s]"), be = panel.querySelector("[data-e]");
    if (bs) bs.textContent = s || "—";
    if (be) be.textContent = e || "—";
  }

  function open() {
    selS = inFrom.value || "";
    selE = inTo.value || "";
    picking = false;
    hoverD = "";
    var baseStr = selE || selS || maxD || ymd(new Date());
    var base = new Date(baseStr + "T00:00:00");
    view = new Date(base.getFullYear(), base.getMonth(), 1);
    render();
    panel.hidden = false;
  }
  function close() { panel.hidden = true; }

  box.addEventListener("click", function (e) {
    if (e.target.closest("[data-drp-toggle]")) {
      if (panel.hidden) open(); else close();
      return;
    }
    var nav = e.target.closest(".drp-nav");
    if (nav) {
      var k = nav.getAttribute("data-nav");
      view = new Date(
        view.getFullYear() + (k === "py" ? -1 : k === "ny" ? 1 : 0),
        view.getMonth() + (k === "pm" ? -1 : k === "nm" ? 1 : 0),
        1
      );
      render();
      return;
    }
    var day = e.target.closest(".drp-day[data-d]");
    if (day && !day.disabled) {
      var d = day.getAttribute("data-d");
      if (!picking) {
        selS = d; selE = ""; picking = true; hoverD = d;
      } else {
        if (d < selS) { selE = selS; selS = d; } else { selE = d; }
        picking = false; hoverD = "";
      }
      paint();
      return;
    }
    if (e.target.closest("[data-drp-ok]")) {
      if (selS) {
        if (!selE) selE = selS;
        inFrom.value = selS;
        inTo.value = selE;
        if (label) label.textContent = selS + " ~ " + selE;
        if (sel && sel.querySelector('option[value="custom"]')) sel.value = "custom";
      }
      close();
    }
  });
  panel.addEventListener("mouseover", function (e) {
    if (!picking) return;
    var day = e.target.closest ? e.target.closest(".drp-day[data-d]") : null;
    if (day && !day.disabled) { hoverD = day.getAttribute("data-d"); paint(); }
  });

  /* 快捷下拉联动：选非自定义档位时即时换算区间写入 hidden + 显示（提交后服务端按 range 权威计算）。 */
  if (sel) {
    sel.addEventListener("change", function () {
      var v = sel.value;
      if (v === "custom") { open(); return; }
      close();
      var now = new Date();
      var t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var shift = function (n) { return ymd(new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() - n)); };
      var f = "", t = "";
      if (v === "today") { f = ymd(t0); t = f; }
      else if (v === "yesterday") { f = shift(1); t = f; }
      else if (v === "7d") { f = shift(6); t = ymd(t0); }
      else if (v === "30d") { f = shift(29); t = ymd(t0); }
      inFrom.value = f;
      inTo.value = t;
      if (label) label.textContent = v === "all" ? "全部时间" : (f + " ~ " + t);
    });
  }
});

/* drp / dtp 面板「点外部关闭 / ESC 关闭」：顶层一次性委托（PJAX 重跑 init 不会累积 document 监听）。 */
(function () {
  "use strict";
  function eventNode(e) {
    var t = e.target;
    if (t && t.nodeType === 3) t = t.parentElement;
    return t instanceof Node ? t : null;
  }
  document.addEventListener("click", function (e) {
    var node = eventNode(e);
    if (!node) return;
    document.querySelectorAll("[data-drp-panel]:not([hidden])").forEach(function (p) {
      var owner = p.closest("[data-drp]");
      if (owner && !owner.contains(node)) p.hidden = true;
    });
    /* 点在日期面板内（含年月箭头）绝不关 dtp */
    if (node.closest && node.closest("[data-dtp-panel]")) return;
    document.querySelectorAll("[data-dtp-panel]:not([hidden])").forEach(function (p) {
      var owner = p.closest("[data-dtp]");
      if (owner && !owner.contains(node)) p.hidden = true;
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    document.querySelectorAll("[data-drp-panel]:not([hidden])").forEach(function (p) { p.hidden = true; });
    document.querySelectorAll("[data-dtp-panel]:not([hidden])").forEach(function (p) { p.hidden = true; });
  });
})();

/* 签发 Key：过期时间单点日期时间选择器（dtp）+ 快捷 chip（永不过期/一个月/一天/一小时）。 */
window.__ytInits.push(function initExpireDtp() {
  "use strict";
  document.querySelectorAll("[data-dtp]").forEach(function (box) {
    if (box.dataset.ytBound) return;
    box.dataset.ytBound = "1";
    var input = box.querySelector("[data-dtp-value]");
    var label = box.querySelector("[data-dtp-label]");
    var panel = box.querySelector("[data-dtp-panel]");
    var chips = box.querySelectorAll("[data-expire-preset]");
    if (!input || !label || !panel) return;

    var FOREVER = "2099-12-31 00:00:00";
    var viewY, viewM, selY, selM, selD, selH, selMin, selS;

    function pad(n) { return n < 10 ? "0" + n : "" + n; }
    function fmt(y, m, d, h, mi, s) {
      return y + "-" + pad(m) + "-" + pad(d) + " " + pad(h) + ":" + pad(mi) + ":" + pad(s);
    }
    function parseVal(str) {
      var m = String(str || "").match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
      if (!m) return null;
      return { y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5], s: +m[6] };
    }
    function setValue(str, preset) {
      input.value = str;
      label.textContent = str;
      chips.forEach(function (c) {
        c.classList.toggle("is-active", !!preset && c.getAttribute("data-expire-preset") === preset);
      });
    }
    function applyPreset(kind) {
      var now = new Date();
      if (kind === "forever") { setValue(FOREVER, "forever"); return; }
      var t = new Date(now.getTime());
      if (kind === "hour") t.setHours(t.getHours() + 1);
      else if (kind === "day") t.setDate(t.getDate() + 1);
      else if (kind === "month") t.setMonth(t.getMonth() + 1);
      setValue(fmt(t.getFullYear(), t.getMonth() + 1, t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds()), kind);
    }
    function loadFromInput() {
      var p = parseVal(input.value) || parseVal(FOREVER);
      selY = p.y; selM = p.mo; selD = p.d; selH = p.h; selMin = p.mi; selS = p.s;
      viewY = selY; viewM = selM;
    }
    function monthTable() {
      var start = new Date(viewY, viewM - 1, 1);
      var firstDow = start.getDay();
      var html = '<table class="dtp-grid"><thead><tr>';
      "日一二三四五六".split("").forEach(function (w) { html += "<th>" + w + "</th>"; });
      html += "</tr></thead><tbody>";
      var cur = new Date(viewY, viewM - 1, 1 - firstDow);
      for (var r = 0; r < 6; r++) {
        html += "<tr>";
        for (var c = 0; c < 7; c++) {
          var y = cur.getFullYear(), m = cur.getMonth() + 1, d = cur.getDate();
          var inMonth = m === viewM && y === viewY;
          var today = new Date();
          var isToday = y === today.getFullYear() && m === today.getMonth() + 1 && d === today.getDate();
          var isSel = inMonth && y === selY && m === selM && d === selD;
          if (!inMonth) html += '<td><span class="dtp-day is-out">' + d + "</span></td>";
          else {
            html += '<td><button type="button" class="dtp-day' + (isSel ? " is-sel" : "") +
              (isToday ? " is-today" : "") + '" data-d="' + d + '">' + d + "</button></td>";
          }
          cur.setDate(cur.getDate() + 1);
        }
        html += "</tr>";
      }
      return html + "</tbody></table>";
    }
    function timeCol(kind, max, cur) {
      var html = '<div class="dtp-col" data-time="' + kind + '">';
      for (var i = 0; i <= max; i++) {
        html += '<button type="button" data-v="' + i + '"' + (i === cur ? ' class="is-sel"' : "") + ">" + pad(i) + "</button>";
      }
      return html + "</div>";
    }
    function shiftMonth(delta) {
      viewY = +viewY; viewM = +viewM;
      viewM += delta;
      while (viewM < 1) { viewM += 12; viewY -= 1; }
      while (viewM > 12) { viewM -= 12; viewY += 1; }
    }
    function wirePanel() {
      /* 每次 render 后直接绑按钮：避免委托被外层关闭逻辑/冒泡干扰导致「年月箭头无反应」 */
      panel.querySelectorAll(".dtp-nav").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          var k = btn.getAttribute("data-nav");
          if (k === "py") viewY = +viewY - 1;
          else if (k === "ny") viewY = +viewY + 1;
          else if (k === "pm") shiftMonth(-1);
          else if (k === "nm") shiftMonth(1);
          render(false);
        });
      });
      panel.querySelectorAll(".dtp-day[data-d]").forEach(function (day) {
        day.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          selY = +viewY; selM = +viewM; selD = +day.getAttribute("data-d");
          render(false);
        });
      });
      panel.querySelectorAll(".dtp-col button[data-v]").forEach(function (tv) {
        tv.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          var col = tv.closest(".dtp-col");
          var kind = col && col.getAttribute("data-time");
          var v = +tv.getAttribute("data-v");
          if (kind === "h") selH = v; else if (kind === "mi") selMin = v; else if (kind === "s") selS = v;
          render(false);
        });
      });
      var nowBtn = panel.querySelector("[data-dtp-now]");
      if (nowBtn) {
        nowBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          var n = new Date();
          selY = n.getFullYear(); selM = n.getMonth() + 1; selD = n.getDate();
          selH = n.getHours(); selMin = n.getMinutes(); selS = n.getSeconds();
          viewY = selY; viewM = selM;
          render(true);
        });
      }
      var okBtn = panel.querySelector("[data-dtp-ok]");
      if (okBtn) {
        okBtn.addEventListener("click", function (e) {
          e.preventDefault();
          e.stopPropagation();
          setValue(fmt(selY, selM, selD, selH, selMin, selS), null);
          close();
        });
      }
    }
    function render(scrollTime) {
      viewY = +viewY; viewM = +viewM;
      if (!viewY || viewM < 1 || viewM > 12) loadFromInput();
      panel.innerHTML =
        '<div class="dtp-body"><div class="dtp-cal"><div class="dtp-mhead">' +
        '<span><button type="button" class="dtp-nav" data-nav="py" aria-label="上一年">«</button>' +
        '<button type="button" class="dtp-nav" data-nav="pm" aria-label="上一月">‹</button></span>' +
        "<b>" + viewY + " - " + pad(viewM) + "</b>" +
        '<span><button type="button" class="dtp-nav" data-nav="nm" aria-label="下一月">›</button>' +
        '<button type="button" class="dtp-nav" data-nav="ny" aria-label="下一年">»</button></span>' +
        "</div>" + monthTable() + "</div>" +
        '<div class="dtp-time"><div class="dtp-time-title">选择时间</div><div class="dtp-time-cols">' +
        timeCol("h", 23, selH) + timeCol("mi", 59, selMin) + timeCol("s", 59, selS) +
        "</div></div></div>" +
        '<div class="dtp-foot"><button type="button" class="btn-line" data-dtp-now>此刻</button>' +
        '<button type="button" class="btn-primary" data-dtp-ok>确定</button></div>';
      wirePanel();
      if (scrollTime) {
        panel.querySelectorAll(".dtp-col").forEach(function (col) {
          var sel = col.querySelector("button.is-sel");
          if (sel) sel.scrollIntoView({ block: "center" });
        });
      }
    }
    function open() { loadFromInput(); render(true); panel.hidden = false; }
    function close() { panel.hidden = true; }
    function clickEl(e) {
      var t = e.target;
      if (t && t.nodeType === 3) t = t.parentElement;
      return t && t.closest ? t : null;
    }

    chips.forEach(function (chip) {
      chip.addEventListener("click", function () {
        applyPreset(chip.getAttribute("data-expire-preset") || "forever");
        close();
      });
    });
    /* 面板吞掉冒泡，避免 document「点外关闭」与 toggle 误触发 */
    panel.addEventListener("click", function (e) { e.stopPropagation(); });
    box.addEventListener("click", function (e) {
      var t = clickEl(e);
      if (!t) return;
      if (panel.contains(t)) return;
      if (t.closest("[data-dtp-toggle]")) {
        if (panel.hidden) open();
        else close();
      }
    });
    if (!parseVal(input.value)) setValue(FOREVER, "forever");
    else if (input.value === FOREVER) setValue(FOREVER, "forever");
  });
});

/* 标签页标题闪烁提醒（到账时用户不在本标签页也能察觉；回到页面自动停止并回调）。 */
window.ytTitleFlash = (function () {
  "use strict";
  var timer = null, orig = null, onBack = null;
  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    if (orig != null) { document.title = orig; orig = null; }
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && timer) {
      stop();
      var cb = onBack;
      onBack = null;
      if (cb) cb();
    }
  });
  return {
    start: function (text, backCb) {
      if (timer) return;
      orig = document.title;
      onBack = backCb || null;
      var on = false;
      timer = setInterval(function () {
        document.title = on ? orig : text;
        on = !on;
      }, 900);
    },
    stop: stop,
  };
})();

/* 充值面额格子（Inc7b 自助支付）：
 * 有码面额 → 在线支付面板（收款码 + 订单号后 6 位核验，自动到账后刷新余额）；
 * 无码面额 → 客服入账指引；「商务合作」卡 → 客户经理联系面板。
 * 到账确认三段式：快速重试（4 次 × 4 秒）→ 后台静默轮询（12 秒 × 15 分钟，可切走标签页）→
 * 到账时页面可见则 toast+刷新，不可见则标题闪烁提醒、回到页面自动刷新。 */
window.__ytInits.push(function initRecharge() {
  "use strict";
  var grid = document.querySelector(".amount-grid");
  if (!grid || grid.dataset.ytBound) return;
  grid.dataset.ytBound = "1";
  var uname = grid.getAttribute("data-username") || "";
  var payPanel = document.getElementById("pay-panel");
  var cta = document.getElementById("amount-cta");
  var bizPanel = document.getElementById("biz-panel");
  /* 付款框（11-02 起 1 云猫 · 2 纪元 · 3 数合支付）：选中面额后只出它此刻能用的通道；下面 pay-panel 的收款码 + 填单号领取流程已不再调用，仅留存量代码 */
  var epayBox = window.ytEpay ? document.getElementById("epay-box") : null;
  var statusEl = document.getElementById("pay-status");
  var claimBtn = document.getElementById("pay-claim");
  var orderInput = document.getElementById("pay-order");
  var retryTimer = null;

  /* 只停「下一次查询」的定时器。schedule() 每次排队前都会调它去重，
     所以**这里绝不能连读秒一起停** —— 否则读秒会在第一次排队时就被掐死，
     文案永远停在「已等待 0 秒」（2026-08-20 踩过）。彻底收工请用 stopAll()。 */
  function stopPolling() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  }
  /** 收工：轮询与读秒一起停（到账 / 超时 / 明确失败 / 页面已切走）。 */
  function stopAll() {
    stopPolling();
    stopTick();
  }
  function hideAll() {
    [payPanel, cta, bizPanel].forEach(function (el) { if (el) el.hidden = true; });
    if (epayBox) window.ytEpay.hide(epayBox);
    stopAll();
    setStatus("", "");
  }
  /** 到账：软刷新主区（余额卡在 .shell-main 内一起换新），视频页弹窗里就留在视频页 */
  function epayDone(st) {
    if (window.ytToast) window.ytToast(st.message || "付款成功，已到账");
    setTimeout(function () {
      if (typeof window.ytSoftNavigate === "function") window.ytSoftNavigate(location.pathname + location.search);
      else location.reload();
    }, 1500);
  }
  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.hidden = !text;
    statusEl.textContent = text;
    statusEl.className = "pay-status" + (kind ? " is-" + kind : "");
    if (kind === "err" && window.ytKefuDecorate) window.ytKefuDecorate(statusEl, text, { msg: "在线充值遇到问题：用户名 " + uname + "。" + text });
  }
  function showPay(amount, points) {
    if (!payPanel) return;
    payPanel.hidden = false;
    var qr = document.getElementById("pay-qr");
    if (qr) qr.src = "/?ajax=recharge_qr&amount=" + amount;
    var amtEl = document.getElementById("pay-amount");
    var amt2El = document.getElementById("pay-amount2");
    var ptsEl = document.getElementById("pay-points");
    if (amtEl) amtEl.textContent = String(amount);
    if (amt2El) amt2El.textContent = String(amount);
    if (ptsEl) {
      var bonusPct = amount > 0 && points > amount ? Math.round((points - amount) / amount * 100) : 0;
      ptsEl.textContent = bonusPct > 0 ? points + "（多赠 " + bonusPct + "%）" : String(points);
      ptsEl.classList.toggle("is-bonus", bonusPct > 0);
    }
    if (orderInput) orderInput.value = "";
    payPanel.setAttribute("data-amount", String(amount));
    payPanel.setAttribute("data-points", String(points));
    /* 「遇到问题？联系在线客服」：带上正在付的面额，客服不用再问 */
    var help = payPanel.querySelector(".pay-help-link");
    if (help && window.ytKefuUrl) {
      var hm = "在线充值遇到问题：用户名 " + uname + "，面额 ¥" + amount + "（到账 " + points + " 积分）";
      help.setAttribute("data-kefu-msg", hm);
      help.href = window.ytKefuUrl({ from: grid.getAttribute("data-kefu-from") || "", msg: hm });
    }
    /* 点的正是「邀请阶梯目标档」那张面额时，在到账说明后补一句额度赠送
       （门槛与要高亮的面额由 PHP 算好挂在 .amount-grid 的 data-* 上，这里只负责展示）。 */
    var gateNote = document.getElementById("pay-gate-note");
    if (gateNote) {
      var gateAmt = parseInt(grid.getAttribute("data-gate-amount") || "0", 10);
      var gateYuan = parseInt(grid.getAttribute("data-gate-yuan") || "0", 10);
      var hit = gateAmt > 0 && amount === gateAmt && gateYuan > 0;
      gateNote.hidden = !hit;
      if (hit) {
        gateNote.innerHTML =
          "首次达到累充 <b>" + gateYuan + " 元</b>，再赠 <b>300 等额邀请积分</b>（可分发给好友）。";
      }
    }
  }
  function showCta(amount, points) {
    if (!cta) return;
    cta.hidden = false;
    var val = document.getElementById("amount-val");
    if (val) val.textContent = String(amount);
    var ptsVal = document.getElementById("amount-pts-val");
    if (ptsVal) ptsVal.textContent = String(points);
    var text = "充值申请：用户名 " + uname + "，充值金额 ¥" + amount + "，到账 " + points + " 积分";
    var copyText = document.getElementById("amount-copy-text");
    if (copyText) copyText.textContent = text;
    /* 「联系在线客服入账」按钮：把这条充值信息作为首条消息带过去（面板内 data-kefu-msg，新标签 href msg=） */
    var kefuBtn = cta.querySelector(".amount-kefu-btn");
    if (kefuBtn && window.ytKefuUrl) {
      kefuBtn.setAttribute("data-kefu-msg", text);
      kefuBtn.href = window.ytKefuUrl({ from: grid.getAttribute("data-kefu-from") || "", msg: text });
    }
  }

  grid.addEventListener("click", function (e) {
    var cell = e.target.closest ? e.target.closest(".amount-cell") : null;
    if (!cell) return;
    grid.querySelectorAll(".amount-cell").forEach(function (c) { c.classList.remove("is-active"); });
    cell.classList.add("is-active");
    /* 一旦开始选面额，就撤掉阶梯档的橙框与气泡 —— 它的任务是"引导点进来"，
       进来之后继续挂着只会干扰付款，还会让选中态（青色）和引导态（橙色）打架。
       给 grid 打标记而不是逐个删元素：刷新/软导航回来时 PHP 会重新渲染，逻辑只有一处。 */
    grid.classList.add("gate-dismissed");
    hideAll();
    if (cell.hasAttribute("data-biz")) {
      if (bizPanel) bizPanel.hidden = false;
      return;
    }
    var amount = parseInt(cell.getAttribute("data-amount"), 10);
    if (!(amount > 0)) return;
    var points = parseInt(cell.getAttribute("data-points"), 10);
    if (!(points > 0)) points = amount;
    /* 11-02 起：1 云猫 · 2 纪元 · 3 数合支付，只出这个面额此刻能用的通道；一个都没有就走客服入账（收款码不再出） */
    if (!epayBox || !window.ytEpay.channels(epayBox, "recharge:" + amount).length) { showCta(amount, points); return; }
    window.ytEpay.show(epayBox, {
      key: "recharge:" + amount,
      payload: { biz: "recharge", amount: amount },
      sum: amount + " 元",
      desc: "，到账 " + points + " 积分",
      onDone: epayDone,
    });
  });
  /* 从支付宝收银台跳回（?epay=订单号）：接着确认这一单 */
  if (epayBox) window.ytEpay.resume(epayBox, { onDone: epayDone });

  /* URL 带 ?pick=<面额> 时自动点开那张卡（首充海报的「充值 300 元」按钮走这条），
     省掉用户自己在一排面额里找。找不到对应面额就什么都不做。 */
  (function autoPick() {
    var want = new URLSearchParams(location.search).get("pick");
    if (!want) return;
    var target = grid.querySelector('.amount-cell[data-amount="' + String(parseInt(want, 10)) + '"]');
    if (!target) return;
    target.click();
    // 展开的付款面板在下方，滚过去让用户直接看到二维码
    setTimeout(function () {
      var panel = document.getElementById("pay-panel");
      var box = panel && !panel.hidden ? panel : target;
      box.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
  })();

  /* 到账确认状态机。attempts：快速阶段计数；waitStartAt：本轮等待起点（读秒与超时都用它）。 */
  var attempts = 0;
  var waitStartAt = 0;
  var tickTimer = null;
  var FAST_MAX = 4;          // 前 4 次按 4 秒间隔查
  var BG_INTERVAL = 12000;   // 之后 12 秒一次（后端限频 12 次/分，留足余量）
  var WAIT_WINDOW = 3 * 60000; // 等待上限 3 分钟：超过就判定订单号填错并停止轮询

  /**
   * 等待期间**只用一句文案 + 读秒**（2026-08-20 改）。
   *
   * 原先会把内部过程暴露给用户：「暂未查到这笔付款，4 秒后自动重试(2/3)」「已转入后台确认…」——
   * 付款其实是好的、只是网关还没同步，用户却以为失败了，反复重填订单号甚至找客服。
   * 现在统一成「正在充值，请稍后…（已等待 N 秒…）」，把不确定性收进一个进度感里。
   */
  var BAD_ORDER_MSG = "该订单号有误，请确认为支付订单号后 6 位，请勿填写商家订单号后 6 位";
  function waitedSec() {
    return waitStartAt ? Math.max(0, Math.round((Date.now() - waitStartAt) / 1000)) : 0;
  }
  function showWaiting() {
    setStatus(
      "正在充值，请稍后.....（已等待 " + waitedSec() + " 秒，预计 1-3 分钟内完成，请勿离开页面！）",
      "wait",
    );
  }
  function startTick() {
    stopTick();
    showWaiting();
    tickTimer = setInterval(function () {
      /* PJAX 切走后旧 DOM 已脱离文档：连读秒一起停，别留个孤儿定时器 */
      if (!statusEl || !statusEl.isConnected) { stopAll(); return; }
      showWaiting();
    }, 1000);
  }
  function stopTick() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }

  function onReady(d) {
    stopAll();
    // 后端幂等：同一订单号只能入账一次；重提返回 already=true，勿再显示「到账成功」。
    if (d && d.already) {
      if (claimBtn) claimBtn.disabled = false;
      setStatus(
        "该订单已领取过（+" + d.points + " 积分），不会重复到账。当前余额 " + d.balance_points + " 积分。",
        "info",
      );
      if (window.ytToast) window.ytToast("该订单已领取，不会重复到账");
      return;
    }
    setStatus("到账成功：+" + d.points + " 积分，当前余额 " + d.balance_points + " 积分。正在刷新…", "ok");
    /**
     * 软刷新而非整页 reload（2026-08-20 改）。
     *
     * 为什么安全（改前逐条确认过）：
     *  · 余额卡由 `yt_balance_card()` 渲染在 **.shell-main 内**，软刷新会一起换新，余额能更新；
     *  · 旧轮询不会重复：`retryTimer` 先在 `stopPolling()` 里清掉（onReady 开头已调用），
     *    即使有在途 tick，`doClaim` 开头也会因 `#pay-status` 已不在文档中（isConnected=false）自行终止；
     *  · `initRecharge` 靠 `.amount-grid[data-ytBound]` 幂等，DOM 换新后重绑一次，
     *    且**不会自动开始轮询**（轮询只由用户点「我已支付」触发）。
     */
    var refresh = function () {
      stopAll();
      if (typeof window.ytSoftNavigate === "function") window.ytSoftNavigate("/?page=recharge");
      else location.reload();
    };
    if (document.hidden) {
      // 用户切走了标签页：标题闪烁提醒，回到页面时再刷新余额。
      window.ytTitleFlash.start("【✅ 充值已到账】", refresh);
    } else {
      if (window.ytToast) window.ytToast("充值成功，+" + d.points + " 积分");
      setTimeout(refresh, 1800);
    }
  }

  function schedule(delay) {
    stopPolling();
    retryTimer = setTimeout(function () { doClaim(true); }, delay);
  }

  function doClaim(isRetry) {
    if (!claimBtn || !orderInput) return;
    // PJAX 切走充值页后旧 DOM 已脱离文档：停止一切轮询。
    if (!statusEl || !statusEl.isConnected) { stopAll(); return; }
    var order = (orderInput.value || "").replace(/\D/g, "");
    if (order.length !== 6) {
      setStatus("请输入支付宝订单号后 6 位（纯数字）", "err");
      return;
    }
    if (!isRetry) { attempts = 0; waitStartAt = Date.now(); startTick(); }
    claimBtn.disabled = true;
    var fd = new FormData();
    fd.append("csrf", (document.getElementById("pay-csrf") || {}).value || "");
    fd.append("order_num", order);
    fetch("/?ajax=recharge_claim", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.status === "ready") { onReady(d); return; }
        if (d && d.status === "pending") {
          attempts++;
          /* 等满 3 分钟还查不到 —— 绝大多数是订单号填错（最常见是填了商家订单号）。
             如实说清怎么改，并停止轮询；用户改完手动再点即可。 */
          if (Date.now() - waitStartAt >= WAIT_WINDOW) {
            stopAll();
            claimBtn.disabled = false;
            setStatus(BAD_ORDER_MSG, "err");
            return;
          }
          /* 文案由读秒统一刷新，这里只决定下次查询的间隔。
             前 4 次密集查（按钮禁用防连点），之后放缓并把按钮交回用户 ——
             机制上仍支持切走标签页等待、到账后标题栏提醒（文案不提，避免用户真走开）。 */
          if (attempts >= FAST_MAX) claimBtn.disabled = false;
          schedule(attempts < FAST_MAX ? 4000 : BG_INTERVAL);
          return;
        }
        stopAll();
        claimBtn.disabled = false;
        if (d && d.status === "script_offline") {
          setStatus("自动到账服务暂不可用，请联系客服人工处理（付款凭证请截图保留）。", "err");
        } else if (d && d.status === "no_match") {
          setStatus("实付金额 ¥" + d.amount + " 未匹配任何充值面额，无法自动到账，请联系客服处理。", "err");
        } else {
          setStatus((d && d.error) || "查询失败，请稍后重试", "err");
        }
      })
      .catch(function () {
        // 网络抖动：还在等待窗口内就继续轮询（文案照旧读秒），超窗才报错。
        if (waitStartAt && Date.now() - waitStartAt < WAIT_WINDOW) { schedule(BG_INTERVAL); return; }
        stopAll();
        claimBtn.disabled = false;
        setStatus("网络异常，请稍后重试", "err");
      });
  }
  if (claimBtn) claimBtn.addEventListener("click", function () { doClaim(false); });
  if (orderInput) {
    orderInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); doClaim(false); }
    });
  }
});

/* 成功提示条：3 秒后自动淡出（错误提示常驻，需用户看清原因）。 */
window.__ytInits.push(function initFlash() {
  "use strict";
  document.querySelectorAll(".flash-success").forEach(function (el) {
    if (el.dataset.ytBound) return;
    el.dataset.ytBound = "1";
    setTimeout(function () {
      el.classList.add("is-fade");
      setTimeout(function () { el.remove(); }, 500);
    }, 3000);
  });
});

/* 签发表单：无限额度开关 + 扣费预览。
 * 总额度开「无限」= 填入钱包全部余额（仍 1:1 预签发）；窗口限额开「无限」= 不设上限。 */
window.__ytInits.push(function initQuotaLimits() {
  "use strict";
  var form = document.getElementById("create-key-form");
  var box = document.querySelector("[data-limit-rows]");
  if (!form || !box || box.dataset.ytBound) return;
  box.dataset.ytBound = "1";
  var preview = document.getElementById("cost-preview");
  var bold = preview ? preview.querySelector("b") : null;
  var quotaInput = document.getElementById("quota-input");
  var walletBal = parseInt(form.getAttribute("data-wallet-balance") || "0", 10);
  if (!(walletBal >= 0)) walletBal = 0;

  function syncRow(row) {
    var cb = row.querySelector("[data-limit-unlimited]");
    var input = row.querySelector("[data-limit-input]");
    if (!cb || !input) return;
    var isTotal = row.hasAttribute("data-limit-total");
    var unlim = cb.checked;

    if (isTotal) {
      // 总额度「无限」：填入全部余额并只读展示（提交仍带 quota；服务端以实时余额为准）
      if (unlim) {
        if (walletBal < 1) {
          cb.checked = false;
          if (window.ytToast) window.ytToast("余额不足，请先充值");
          input.readOnly = false;
          input.disabled = false;
          input.setAttribute("required", "required");
        } else {
          input.value = String(walletBal);
          input.readOnly = true;
          input.disabled = false;
          input.setAttribute("required", "required");
        }
      } else {
        input.readOnly = false;
        input.disabled = false;
        input.setAttribute("required", "required");
      }
    } else if (unlim) {
      input.disabled = true;
      input.readOnly = false;
      input.value = "";
      input.removeAttribute("required");
    } else {
      input.disabled = false;
      input.readOnly = false;
      input.setAttribute("required", "required");
    }
    row.classList.toggle("is-unlimited", cb.checked);
  }

  function updateCost() {
    if (!bold || !quotaInput) return;
    var v = parseInt(quotaInput.value, 10);
    bold.textContent = v >= 1 ? String(v) : "—";
  }

  box.querySelectorAll("[data-limit-row]").forEach(function (row) {
    var cb = row.querySelector("[data-limit-unlimited]");
    var input = row.querySelector("[data-limit-input]");
    if (cb) cb.addEventListener("change", function () { syncRow(row); updateCost(); });
    if (input) input.addEventListener("input", updateCost);
    syncRow(row);
  });
  updateCost();

  form.addEventListener("submit", function (e) {
    var totalRow = box.querySelector("[data-limit-total]");
    var totalCb = totalRow && totalRow.querySelector("[data-limit-unlimited]");
    if (totalCb && totalCb.checked) {
      if (walletBal < 1) {
        e.preventDefault();
        if (window.ytToast) window.ytToast("余额不足，请先充值");
        return;
      }
      if (quotaInput) quotaInput.value = String(walletBal);
    } else if (!quotaInput || !(parseInt(quotaInput.value, 10) >= 1)) {
      e.preventDefault();
      if (window.ytToast) window.ytToast("请填写总额度，或打开「无限额度」使用全部余额");
      return;
    }
    var ok = true;
    box.querySelectorAll("[data-limit-row]:not([data-limit-total])").forEach(function (row) {
      var cb = row.querySelector("[data-limit-unlimited]");
      var input = row.querySelector("[data-limit-input]");
      if (!cb || !input || cb.checked) return;
      var n = Number(input.value);
      if (!(n > 0)) ok = false;
    });
    if (!ok) {
      e.preventDefault();
      if (window.ytToast) window.ytToast("关闭无限后须填写对应窗口限额");
      return;
    }
    /* 校验通过：AJAX POST + 局部换主区，避免整页闪白 */
    e.preventDefault();
    if (typeof window.ytPostFormSoft === "function") {
      var btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      window.ytPostFormSoft(form, { url: "/?page=keys" })
        .catch(function () { if (window.ytToast) window.ytToast("签发失败，请稍后重试", "error"); })
        .then(function () { if (btn) btn.disabled = false; });
    }
  });
});

/* ── PJAX 局部刷新 ──
 * 拦截站内链接点击与 GET 表单提交：fetch 整页 HTML → 只替换 .shell-main 与侧边栏（active 态），
 * 顶栏/样式/脚本不重载，切页不再整页白刷。配合服务端 10 分钟数据缓存，切页接近秒开。
 * 另暴露 ytSoftNavigate / ytPostFormSoft：写操作后软刷新（几乎无闪、不滚顶）。 */
(function () {
  "use strict";
  if (!document.querySelector(".shell-main")) return;
  var bar = null;
  var barTimer = null;
  var navSeq = 0;
  /* 当前「页面」标识（**不含 hash**）：popstate 用它区分「真的换页」与「只是同页锚点」。 */
  var lastPagePath = location.pathname + location.search;
  function syncPagePath() {
    lastPagePath = location.pathname + location.search;
  }

  function barStart() {
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "pjax-bar";
      document.body.appendChild(bar);
    }
    clearTimeout(barTimer);
    bar.classList.remove("is-done");
    bar.classList.remove("is-on");
    void bar.offsetWidth; // 重启 CSS 过渡
    bar.classList.add("is-on");
  }
  function barDone() {
    if (!bar) return;
    bar.classList.add("is-done");
    barTimer = setTimeout(function () {
      if (bar) { bar.classList.remove("is-on"); bar.classList.remove("is-done"); }
    }, 450);
  }

  function applyHtml(html, opts) {
    opts = opts || {};
    var doc = new DOMParser().parseFromString(html, "text/html");
    var newMain = doc.querySelector(".shell-main");
    var curMain = document.querySelector(".shell-main");
    if (!newMain || !curMain) return false;
    curMain.innerHTML = newMain.innerHTML;
    curMain.classList.remove("is-loading");
    curMain.classList.remove("is-soft-loading");
    var newSide = doc.querySelector(".shell-sidebar");
    var curSide = document.querySelector(".shell-sidebar");
    if (newSide && curSide) curSide.innerHTML = newSide.innerHTML;
    /* 浏览器标签固定「品牌-用户中心」，不随 PJAX 切页改写 */
    var fixedTitle = (document.body && document.body.getAttribute("data-site-title")) || "宇天科技-用户中心";
    document.title = fixedTitle;
    if (opts.url) {
      if (opts.push) history.pushState({ pjax: 1 }, "", opts.url);
      else if (opts.replace) history.replaceState({ pjax: 1 }, "", opts.url);
    }
    /* 同步「当前页面」基准，否则下次 popstate 会把真实换页误判成同页锚点而不刷新 */
    syncPagePath();
    if (opts.scroll !== false) {
      /* 固定视口布局：滚右侧主内容区，勿滚 window（body 已 overflow:hidden） */
      var scrollMain = document.querySelector(".shell-main");
      if (scrollMain) scrollMain.scrollTop = 0;
      else window.scrollTo(0, 0);
    }
    window.ytRunInits();
    return true;
  }

  function navigate(url, push, opts) {
    opts = opts || {};
    var soft = !!opts.soft;
    var seq = ++navSeq;
    if (!soft) barStart();
    document.querySelectorAll(".user-dropdown").forEach(function (d) { d.hidden = true; });
    document.querySelectorAll("dialog[open]").forEach(function (d) {
      try { d.close(); } catch (_) { /* ignore */ }
    });
    var main = document.querySelector(".shell-main");
    if (main) main.classList.add(soft ? "is-soft-loading" : "is-loading");
    fetch(url, { credentials: "same-origin", headers: { "X-PJAX": "1" }, cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        if (r.redirected && r.url.indexOf("page=login") !== -1) { location.href = r.url; throw new Error("redirect"); }
        return r.text();
      })
      .then(function (html) {
        if (seq !== navSeq) return;
        if (!applyHtml(html, {
          url: url,
          push: push !== false && !opts.replace,
          replace: !!opts.replace,
          scroll: soft ? false : opts.scroll !== false,
        })) {
          location.href = url;
          return;
        }
        if (!soft) barDone();
      })
      .catch(function (e) {
        if (e && e.message === "redirect") return;
        location.href = url;
      });
  }

  /** 写操作后软刷新当前主区（不滚顶、几乎无闪）。 */
  window.ytSoftNavigate = function (url, opts) {
    opts = opts || {};
    navigate(url || (location.pathname + location.search), false, {
      soft: true,
      replace: opts.replace !== false,
      scroll: false,
    });
  };

  /** POST 表单/FormData 后跟随 redirect 拿到新 HTML，局部替换（签发/续充等）。 */
  window.ytPostFormSoft = function (form, opts) {
    opts = opts || {};
    var main = document.querySelector(".shell-main");
    if (main) main.classList.add("is-soft-loading");
    /* ★ 这里**不能**提前 close 弹窗（2026-08-20 去掉）：
       成功时 applyHtml 会重建 .shell-main 的内容，弹窗（定义在 </main> 之前）随之消失，
       本来就不需要手动关；而**失败时**若已经关掉弹窗，调用方想把错误显示在弹窗内就无处可显，
       用户只看到弹窗关了 + 一条转瞬即逝的 toast，会误以为保存成功。 */
    var isFd = typeof FormData !== "undefined" && form instanceof FormData;
    var action = opts.action
      || (!isFd && form && form.getAttribute ? form.getAttribute("action") : "")
      || opts.url
      || (location.pathname + location.search);
    var body = isFd ? form : new FormData(form);
    /* 与 navigate() 共用同一个序号：写操作的软刷新和普通切页可能同时在飞，
       谁后发起谁作数。少了这道保护，先发起的请求若后到达就会**覆盖**后发起的结果 ——
       例如保存后用户立刻点了侧边栏，最终可能被这次 POST 的旧页面顶回去。 */
    var seq = ++navSeq;
    return fetch(action, {
      method: "POST",
      body: body,
      credentials: "same-origin",
      headers: { "X-Requested-With": "fetch", "X-PJAX": "1" },
      redirect: "follow",
      cache: "no-store",
    }).then(function (r) {
      if (r.redirected && r.url.indexOf("page=login") !== -1) {
        location.href = r.url;
        throw new Error("redirect");
      }
      if (!r.ok) throw new Error("http " + r.status);
      return r.text().then(function (html) {
        /* 已有更新的导航接管 → 丢弃本次结果（但保留上面的 loading 清理逻辑） */
        if (seq !== navSeq) {
          if (main) {
            main.classList.remove("is-soft-loading");
            main.classList.remove("is-loading");
          }
          return;
        }
        var finalUrl = opts.url || "/?page=keys";
        try {
          /* 显式括号只为可读（`+` 本就优先于 `||`）。注意 `pathname` 至少是 "/"，
             所以这里的 `|| finalUrl` 实际兜不到 —— 真正要保证的是**后端 redirect
             目标带上 page 参数**，否则 URL 落到 "/" 就等于控制台。 */
          if (r.url) {
            var u = new URL(r.url);
            finalUrl = (u.pathname + u.search) || finalUrl;
          }
        } catch (_) { /* keep opts.url */ }
        if (!applyHtml(html, { url: finalUrl, replace: true, scroll: false })) {
          location.href = finalUrl;
        }
      });
    }).catch(function (e) {
      if (main) {
        main.classList.remove("is-soft-loading");
        main.classList.remove("is-loading");
      }
      if (e && e.message === "redirect") return;
      throw e;
    });
  };

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest("a[href]") : null;
    if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
    /* data-no-pjax：需要**整页跳转**的链接（如「视频生成」独立页 —— 它不在后台骨架内，
       被软导航接管会把整页 HTML 塞进 .shell-main，出现页面套页面）。 */
    if (a.hasAttribute("data-no-pjax")) return;
    var href = a.getAttribute("href") || "";
    if (href.charAt(0) === "#") return;
    var url;
    try { url = new URL(a.href, location.href); } catch (_) { return; }
    if (url.origin !== location.origin) return;
    e.preventDefault();
    navigate(url.pathname + url.search);
  });

  /* GET 表单（时间范围工具栏「查询」）走局部刷新。POST 表单由 ytPostFormSoft 接管。
   *
   * ★ 白名单制（2026-08-20 改）：**只接管显式标了 `data-pjax` 的 GET 表单**。
   *
   * 原先是「黑名单」——接管所有 GET 表单，靠 `e.defaultPrevented` 和 `data-no-pjax` 排除。
   * 但 `defaultPrevented` 那道判断其实是**假保护**：本监听器注册在 user.js 靠前的位置，
   * 而各页面自管提交的监听器都在后面注册，document 上同类监听器按注册顺序执行 ——
   * 轮到这里时业务代码还没跑，`defaultPrevented` 必然是 false，于是照样接管。
   * 实测后果（编辑 Key / 续充弹窗，2026-08-20）：
   *   ① 先软导航到 `/?key_id=…&name=…`（**没有 page 参数 ⇒ 渲染控制台**），
   *      业务 fetch 成功后再软刷回 `/?page=keys` —— 用户看到「闪一下控制台又切回来」；
   *   ② 表单里的 **csrf 隐藏字段被拼进 URL**，token 进浏览器历史与 access log；
   *   ③ 多一次无用的整页渲染请求；两条导航并发时还可能反序，把用户留在控制台。
   * 改成白名单后，新写的弹窗表单默认安全，不必依赖「记得加 data-no-pjax」。
   */
  document.addEventListener("submit", function (e) {
    var f = e.target;
    if (!(f instanceof HTMLFormElement)) return;
    if (e.defaultPrevented) return;
    if (!f.hasAttribute("data-pjax")) return;
    if (f.hasAttribute("data-no-pjax")) return;
    if ((f.getAttribute("method") || "get").toLowerCase() !== "get") return;
    e.preventDefault();
    var params = new URLSearchParams();
    new FormData(f).forEach(function (v, k) { params.append(k, String(v)); });
    var action = f.getAttribute("action") || "/";
    var base = action.indexOf("?") >= 0 ? action.split("?")[0] : action;
    navigate(base + "?" + params.toString(), true, { soft: true, scroll: false });
  });

  window.addEventListener("popstate", function () {
    var cur = location.pathname + location.search;
    /* Chrome 下点击 #锚点 属同文档导航，**也会触发 popstate**。若照常 navigate()
       就会重取整页、替换 .shell-main 并 scrollTop=0，把浏览器刚做完的锚点滚动抹掉
       —— 表现为「点文档目录没反应」（2026-08-10 修）。仅 hash 变化时交给浏览器原生滚动。 */
    if (cur === lastPagePath) return;
    lastPagePath = cur;
    navigate(cur, false);
  });
})();

/* 配置到客户端：WorkBuddy / CodeBuddy 一行命令 + Trae 手填清单。打开时现取一次性短码（10 分钟有效、只能用一次）。
   弹窗随 .shell-main 软导航重建，所有节点一律调用时现查，不缓存引用。 */
(function () {
  "use strict";
  var DLG = "client-setup-dialog";
  var st = { keyId: "", keyFull: "", keyMasked: "", data: null, os: "windows", tab: "workbuddy", timer: 0, busy: false };
  function dlg() { return document.getElementById(DLG); }
  function q(sel) { var d = dlg(); return d ? d.querySelector(sel) : null; }
  function qa(sel) { var d = dlg(); return d ? d.querySelectorAll(sel) : []; }
  function table() { return document.getElementById("issued-keys-table"); }
  /* 订阅页没有 Key 表格：令牌取弹窗自带的 data-csrf */
  function csrf() {
    var t = table(), d = dlg();
    return (t && t.getAttribute("data-csrf")) || (d && d.getAttribute("data-csrf")) || "";
  }
  /* 页签 → 命令里的 a= 参数；WorkBuddy / CodeBuddy 共用一条命令，Trae 只能手填 */
  function appOf(tab) {
    if (tab === "workbuddy" || tab === "codebuddy") return "wb";
    return tab === "trae" ? "" : tab;
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function isMac() {
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || "";
    return /mac/i.test(p);
  }
  function stopTimer() { if (st.timer) { clearInterval(st.timer); st.timer = 0; } }
  function showErr(msg) {
    var e = q("[data-cs-err]");
    if (!e) return;
    e.textContent = msg || "";
    e.hidden = !msg;
  }
  function currentRow() {
    var t = table();
    if (!t || !st.keyId) return null;
    var rows = t.querySelectorAll("[data-key-row]");
    for (var i = 0; i < rows.length; i++) if (rows[i].getAttribute("data-key-id") === st.keyId) return rows[i];
    return null;
  }
  /* 只在启动时读配置的客户端（WorkBuddy / Claude 桌面版 / DeepSeek Harness）第一步必须先完全退出；
     CodeBuddy 约 1 秒热加载，Claude Code / Codex 是新开终端就读新配置，不用先退出 */
  function renderSteps() {
    var ol = q("[data-cs-steps]");
    if (!ol) return;
    var mac = st.os === "mac";
    var openTerm = mac
      ? "按 <b>Cmd + 空格</b>，输入 <b>终端</b>（或 Terminal），按回车，打开终端窗口。"
      : "按键盘 <b>Win + R</b>，输入 <b>PowerShell</b>，按回车，打开终端窗口。";
    var paste = st.tab === "workbuddy" || st.tab === "codebuddy"
      ? "点上方「复制命令」，粘贴到终端窗口里，按回车。窗口会列出写入了哪些客户端、多少个模型。"
      : "点上方「复制命令」，粘贴到终端窗口里，按回车。窗口会列出改了哪些配置文件。";
    function quit(name, macKeys, tray) {
      return '<span class="cs-warn">先完全退出 ' + name + "：" + (mac ? macKeys : tray) + "（只关掉窗口不算退出）。</span>";
    }
    var steps;
    if (st.tab === "codebuddy") {
      steps = [openTerm, paste, "回到 CodeBuddy（IDE 或命令行），约 1 秒自动生效、不用重启，在模型下拉菜单里选择模型。"];
    } else if (st.tab === "claude") {
      steps = [openTerm, paste, "新开一个终端窗口，输入 <b>claude</b> 回车就能用（正在运行的 Claude Code 先退出再打开；VS Code / JetBrains 插件重新打开即可）。"];
    } else if (st.tab === "codex") {
      steps = [openTerm, paste, "新开一个终端窗口，输入 <b>codex</b> 回车就能用（Codex 桌面版、VS Code 插件重新打开即可）。"];
    } else if (st.tab === "claude-desktop") {
      steps = [
        quit("Claude 桌面版", "在 Claude 里按 Cmd + Q", "右键屏幕右下角托盘里的 Claude 图标，选「退出」"),
        openTerm,
        mac ? paste : "点上方「复制命令」，粘贴到终端窗口里，按回车。如果弹出「你要允许此应用对你的设备进行更改吗？」，点<b>「是」</b>（要写入 Windows 的 Claude 策略）。",
        "等命令装好对话组件（第一次约 120MB，看到「[完成] 对话组件 … 已装好」），再打开 Claude 桌面版：直接进入「第三方推理」模式，Chat 聊天、Code 写代码，在输入框下方的模型菜单里切换模型。",
      ];
    } else if (st.tab === "dsh") {
      steps = [
        quit("DeepSeek Harness", "桌面版按 Cmd + Q；网页版在运行它的终端里按 Ctrl + C", "桌面版右键托盘图标选「退出」；网页版在运行它的终端里按 Ctrl + C"),
        openTerm, paste,
        "重新打开 DeepSeek Harness（网页版重新运行 dsh web），默认模型已经切换好，直接开始对话。",
      ];
    } else {
      steps = [
        quit("WorkBuddy", "在 WorkBuddy 里按 Cmd + Q", "右键屏幕右下角托盘里的 WorkBuddy 图标，选「退出」"),
        openTerm, paste,
        "打开 WorkBuddy 对话窗口，在输入框下方的模型下拉菜单里选择模型（在「自定义模型」分组）。",
      ];
    }
    ol.innerHTML = steps.map(function (s) { return "<li>" + s + "</li>"; }).join("");
  }
  function renderCmd() {
    var d = st.data;
    var app = appOf(st.tab);
    var cmds = d ? ((d.apps && d.apps[app]) || d.commands) : null;
    var cmd = cmds ? (st.os === "mac" ? cmds.mac : cmds.windows) : "";
    var pre = q("[data-cs-cmd]"), copy = q("[data-cs-copy]");
    if (pre) pre.textContent = cmd;
    if (copy) copy.setAttribute("data-copy", cmd);
    qa("[data-cs-os]").forEach(function (b) {
      var on = b.getAttribute("data-cs-os") === st.os;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderSteps();
  }
  function tickExpire() {
    var el = q("[data-cs-expire]");
    if (!el || !st.data) return;
    var left = Math.max(0, Math.round((Date.parse(st.data.expires_at) - Date.now()) / 1000));
    if (left <= 0) {
      el.textContent = "命令已过期，请点「重新生成」";
      el.classList.add("is-expired");
      stopTimer();
      return;
    }
    el.classList.remove("is-expired");
    var m = Math.floor(left / 60), s = left % 60;
    el.textContent = "命令 " + m + ":" + (s < 10 ? "0" : "") + s + " 内有效，只能运行一次";
  }
  function setTab(name) {
    st.tab = name;
    qa("[data-cs-tab]").forEach(function (b) {
      var on = b.getAttribute("data-cs-tab") === name;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    qa("[data-cs-pane]").forEach(function (p) { p.hidden = p.getAttribute("data-cs-pane") !== name; });
    var blk = q("[data-cs-cmd-block]");
    if (blk) blk.hidden = name === "trae" || !st.data;
    renderCmd();
  }
  function renderDefaults() {
    var d = st.data;
    qa("[data-cs-default]").forEach(function (b) {
      var v = d && d.defaults ? d.defaults[b.getAttribute("data-cs-default")] : "";
      b.textContent = v || "—";
    });
  }
  function renderTrae(row) {
    var d = st.data;
    if (!d) return;
    var url = d.trae.request_url;
    var u = q("[data-cs-trae-url]"), uc = q("[data-cs-trae-url-copy]");
    if (u) u.textContent = url;
    if (uc) uc.setAttribute("data-copy", url);
    var k = q("[data-cs-trae-key]"), kc = q("[data-cs-trae-key-copy]");
    if (k) k.textContent = (row && row.getAttribute("data-key-masked")) || st.keyMasked || d.key_masked || "—";
    if (kc) kc.setAttribute("data-copy", (row && row.getAttribute("data-key-full")) || st.keyFull || "");
    var tb = q("[data-cs-trae-rows]");
    if (!tb) return;
    tb.innerHTML = d.trae.models.map(function (m) {
      return "<tr><td><code>" + esc(m.id) + "</code></td><td>" + esc(m.series) + "</td><td>"
        + (m.context_tokens ? esc(m.context_tokens) : "留空") + "</td><td>" + (m.images ? "开启" : "关闭") + "</td>"
        + '<td><button type="button" class="copy-btn copy-mini" data-copy="' + esc(m.id) + '">复制</button></td></tr>';
    }).join("");
  }
  function load() {
    if (st.busy || !st.keyId) return;
    st.busy = true;
    stopTimer();
    showErr("");
    var loading = q("[data-cs-loading]"), regen = q("[data-cs-regen]");
    if (loading) loading.hidden = false;
    if (regen) regen.disabled = true;
    fetch("/?ajax=client_setup&id=" + encodeURIComponent(st.keyId), {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "X-Requested-With": "fetch", "X-CSRF-Token": csrf() },
    })
      .then(function (r) { return r.json().catch(function () { return { ok: false }; }); })
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || "生成失败，请稍后重试");
        st.data = d;
        var c = q("[data-cs-count]");
        if (c) c.textContent = String(d.model_count);
        renderCmd();
        renderDefaults();
        renderTrae(currentRow());
        setTab(st.tab);
        tickExpire();
        st.timer = setInterval(tickExpire, 1000);
      })
      .catch(function (e) {
        st.data = null;
        setTab(st.tab);
        showErr(e && e.message ? e.message : "生成失败，请稍后重试");
      })
      .then(function () {
        st.busy = false;
        var l2 = q("[data-cs-loading]"), r2 = q("[data-cs-regen]");
        if (l2) l2.hidden = true;
        if (r2) r2.disabled = false;
      });
  }

  /* 「我的 Key」顶部的新模型提示：只认运行过命令的 Key，没有变化就隐藏 */
  function renderSync(items) {
    var box = document.querySelector("[data-cs-sync]");
    if (!box) return;
    if (!items || !items.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.innerHTML = items.map(function (it) {
      var shown = it.added || [];
      var names = shown.join("、") + (it.added_count > shown.length ? " 等" : "");
      var main = it.added_count > 0
        ? "Key「<b>" + esc(it.key_name) + "</b>」有 <b>" + esc(it.added_count) + "</b> 个新模型：" + esc(names) + "，重新运行一键配置即可同步"
        : "Key「<b>" + esc(it.key_name) + "</b>」配置过的模型里有 <b>" + esc(it.removed_count) + "</b> 个已下架，重新运行一键配置即可同步";
      var sub = it.added_count > 0 && it.removed_count > 0 ? "；另有 " + esc(it.removed_count) + " 个已下架" : "";
      return '<div class="cs-sync-row"><span class="cs-sync-text">' + main + sub + "</span>"
        + '<button type="button" class="btn-primary btn-sm" data-open-client-setup data-key-id="' + esc(it.key_id)
        + '" data-key-name="' + esc(it.key_name) + '">立即同步</button></div>';
    }).join("");
    box.hidden = false;
  }
  function loadSync() {
    if (!document.querySelector("[data-cs-sync]")) return;
    fetch("/?ajax=client_setup_status", { credentials: "same-origin", cache: "no-store", headers: { "X-Requested-With": "fetch" } })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.ok) renderSync(d.items); })
      .catch(function () { /* 提示条是锦上添花，拉不到就不显示 */ });
  }
  window.__ytInits.push(function initClientSetupSync() {
    var box = document.querySelector("[data-cs-sync]");
    if (!box || box.dataset.ytBound) return;
    box.dataset.ytBound = "1";
    loadSync();
  });

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var open = t.closest("[data-open-client-setup]");
    if (open) {
      var d = dlg();
      st.keyId = open.closest("[data-key-row]")
        ? open.closest("[data-key-row]").getAttribute("data-key-id") || ""
        : open.getAttribute("data-key-id") || "";
      var row = currentRow();
      if (!d || !st.keyId) return;
      st.data = null;
      /* 订阅页没有 Key 行：完整 Key 与打码 Key 由按钮自带 */
      st.keyFull = open.getAttribute("data-key-full") || "";
      st.keyMasked = open.getAttribute("data-key-masked") || "";
      st.os = isMac() ? "mac" : "windows";
      st.tab = "workbuddy";
      renderDefaults();
      var nm = q("[data-cs-key-name]");
      if (nm) nm.textContent = (row && row.getAttribute("data-key-name")) || open.getAttribute("data-key-name") || "未命名";
      var c = q("[data-cs-count]");
      if (c) c.textContent = "—";
      var exp = q("[data-cs-expire]");
      if (exp) exp.textContent = "";
      showErr("");
      setTab("workbuddy");
      renderCmd();
      if (!d.open) d.showModal();
      load();
      return;
    }
    var box = dlg();
    if (!box || !box.contains(t)) return;
    var tab = t.closest("[data-cs-tab]");
    if (tab) { setTab(tab.getAttribute("data-cs-tab") || "workbuddy"); return; }
    var os = t.closest("[data-cs-os]");
    if (os) { st.os = os.getAttribute("data-cs-os") === "mac" ? "mac" : "windows"; renderCmd(); return; }
    if (t.closest("[data-cs-regen]")) load();
  });
  /* close 不冒泡，用捕获阶段在 document 上接住（含软导航时 navigate() 关弹窗） */
  document.addEventListener("close", function (e) {
    if (e.target && e.target.id === DLG) {
      stopTimer();
      st.data = null;
      loadSync();
    }
  }, true);
})();

/* 已签发 Key：状态开关 / 续充弹窗 / 指南 / 编辑（模型多选） */
(function () {
  "use strict";
  var PAGE = "keys";
  function toast(msg, ok) {
    if (window.ytToast) window.ytToast(msg, ok === false ? "error" : "ok");
    else alert(msg);
  }
  /* 错误提示统一走全局 ytFormError（含「一改就清除」的委托），此处仅做本地别名 */
  var showFormErr = function (formId, msg) { window.ytFormError(formId, msg); };
  var clearFormErr = function (formId) { window.ytFormErrorClear(formId); };
  function rowOf(el) { return el && el.closest ? el.closest("[data-key-row]") : null; }
  function table() { return document.getElementById("issued-keys-table"); }
  function csrf() { var t = table(); return t ? (t.getAttribute("data-csrf") || "") : ""; }
  function walletBal() {
    var t = table();
    return t ? Math.max(0, parseInt(t.getAttribute("data-wallet-balance") || "0", 10) || 0) : 0;
  }
  function patchKey(id, body) {
    return fetch("/?ajax=patch_key&id=" + encodeURIComponent(id), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "fetch",
        "X-CSRF-Token": csrf(),
      },
      body: JSON.stringify(body),
      cache: "no-store",
    }).then(function (r) { return r.json(); });
  }
  function fmtPts(n) {
    if (n == null || !isFinite(Number(n))) return "0";
    var s = (Math.round(Number(n) * 10000) / 10000).toFixed(4);
    return s.replace(/\.?0+$/, "");
  }
  /** 即时改写顶部余额卡 + 签发表/续充余额，无需整页刷新。 */
  function applyWalletBalance(raw) {
    var n = Number(raw);
    if (!isFinite(n) || n < 0) n = 0;
    var text = fmtPts(n);
    var floor = Math.floor(n);
    document.querySelectorAll("[data-wallet-display]").forEach(function (el) {
      el.innerHTML = text + "<small>积分</small>";
    });
    var t = table();
    if (t) t.setAttribute("data-wallet-balance", String(floor));
    var issueForm = document.querySelector("form[data-wallet-balance]");
    if (issueForm) issueForm.setAttribute("data-wallet-balance", String(floor));
    var topup = document.getElementById("topup-wallet");
    if (topup) topup.textContent = String(floor);
  }
  function estimateDelete(id) {
    return fetch("/?ajax=delete_key_estimate&id=" + encodeURIComponent(id), {
      credentials: "same-origin",
      headers: { "X-Requested-With": "fetch" },
      cache: "no-store",
    }).then(function (r) { return r.json(); });
  }
  function deleteKey(id) {
    return fetch("/?ajax=delete_key&id=" + encodeURIComponent(id), {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "X-Requested-With": "fetch",
        "X-CSRF-Token": csrf(),
      },
      cache: "no-store",
    }).then(function (r) { return r.json(); });
  }

  /* ── 删除：先拉只读预估 → 二次确认（净已扣/剩余比例/预计退回）→ 删行并即时改余额 ── */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-key-delete]") : null;
    if (!btn) return;
    var id = btn.getAttribute("data-key-id") || "";
    var name = btn.getAttribute("data-key-name") || "未命名";
    if (!id) return;
    btn.disabled = true;
    estimateDelete(id)
      .then(function (est) {
        if (!est || !est.ok) throw new Error((est && est.error) || "预估失败");
        var quotaLine =
          est.remaining != null && est.max_total_requests != null
            ? fmtPts(est.remaining) + " / " + fmtPts(est.max_total_requests) + " 积分"
            : "—（无总额度上限）";
        var pct =
          est.remaining_pct != null ? fmtPts(est.remaining_pct) + "%" : "—";
        var msg1 =
          "删除 Key「" + name + "」？\n\n" +
          "临时不用请关左侧「状态」开关（关闭=停用，可再开启）。\n" +
          "删除将永久回收且不可恢复。\n\n" +
          "净已扣：" + fmtPts(est.charged) + " 积分\n" +
          "剩余额度 / 总额度：" + quotaLine + "\n" +
          "剩余比例：" + pct + "\n" +
          "预计退回：" + fmtPts(est.refund_estimate) + " 积分";
        if (!window.confirm(msg1)) {
          btn.disabled = false;
          return null;
        }
        if (!window.confirm(
          "再次确认删除？\n将退回 " + fmtPts(est.refund_estimate) + " 积分到钱包，删除后无法恢复。"
        )) {
          btn.disabled = false;
          return null;
        }
        return deleteKey(id);
      })
      .then(function (d) {
        if (d == null) return;
        if (!d || !d.ok) throw new Error((d && d.error) || "删除失败");
        var refund = d.refund != null ? d.refund : 0;
        if (d.balance_points != null) applyWalletBalance(d.balance_points);
        var row = rowOf(btn);
        if (row && row.parentNode) row.parentNode.removeChild(row);
        var countEl = document.querySelector("[data-keys-count]");
        if (countEl) {
          var left = document.querySelectorAll("[data-key-row]").length;
          countEl.textContent = String(left);
        }
        var tbody = document.querySelector("#issued-keys-table tbody");
        if (tbody && !tbody.querySelector("[data-key-row]")) {
          var wrap = document.querySelector(".key-table-wrap");
          if (wrap) {
            wrap.outerHTML = '<p class="empty-tip">还没有 Key，先在上方签发一把吧。</p>';
          }
        }
        toast("已删除，退回 " + fmtPts(refund) + " 积分到钱包", true);
      })
      .catch(function (err) {
        btn.disabled = false;
        toast((err && err.message) || "删除失败", false);
      });
  });

  /* ── 状态开关 ── */
  document.addEventListener("change", function (e) {
    var inp = e.target;
    if (!inp || !inp.matches || !inp.matches("[data-key-status-toggle]")) return;
    var row = rowOf(inp);
    if (!row) return;
    var id = row.getAttribute("data-key-id") || "";
    var on = !!inp.checked;
    var txt = inp.parentElement && inp.parentElement.querySelector(".status-switch-txt");
    inp.disabled = true;
    patchKey(id, { status: on ? "active" : "disabled" })
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || "切换失败");
        row.setAttribute("data-status", on ? "active" : "disabled");
        if (on) row.classList.remove("is-disabled");
        else row.classList.add("is-disabled");
        if (txt) txt.textContent = on ? "开启" : "关闭";
        var lab = inp.closest(".status-switch");
        if (lab) {
          lab.title = "开启/关闭此 Key（关闭=停用，可再开启；删除才会永久回收并退积分）";
        }
        var topupBtn = row.querySelector("[data-open-key-topup]");
        if (topupBtn) {
          var max = row.getAttribute("data-max-total");
          topupBtn.disabled = !(on && max !== "");
        }
        toast(on ? "已开启" : "已关闭（停用）", true);
      })
      .catch(function (err) {
        inp.checked = !on;
        toast((err && err.message) || "切换失败", false);
      })
      .then(function () { inp.disabled = false; });
  });

  /* ── 续充弹窗 ── */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-open-key-topup]") : null;
    if (!btn || btn.disabled) return;
    var row = rowOf(btn);
    if (!row) return;
    var dlg = document.getElementById("key-topup-dialog");
    if (!dlg) return;
    document.getElementById("topup-key-id").value = row.getAttribute("data-key-id") || "";
    document.getElementById("topup-key-name").textContent = row.getAttribute("data-key-name") || "—";
    clearFormErr("key-topup-form");
    var bal = walletBal();
    document.getElementById("topup-wallet").textContent = String(bal);
    var q = document.getElementById("topup-quota");
    var all = document.getElementById("topup-use-all");
    /* 余额不足 1 积分：勾了也提交不了，直接禁用并说明原因，别让用户白点一轮
       （续充按 1:1 从钱包扣，最小可充 1 积分）。 */
    var canUseAll = bal >= 1;
    if (all) {
      all.checked = canUseAll;
      all.disabled = !canUseAll;
      var wrap = all.closest(".limit-switch");
      if (wrap) {
        wrap.classList.toggle("is-disabled", !canUseAll);
        wrap.title = canUseAll ? "" : "钱包余额不足 1 积分，请先充值";
      }
    }
    var hint = document.getElementById("topup-lowbal-hint");
    if (hint) hint.hidden = canUseAll;
    if (q) {
      q.value = canUseAll ? String(bal) : "";
      q.readOnly = !!(all && all.checked);
      q.disabled = !canUseAll;
    }
    var submitBtn = document.querySelector("#key-topup-form button[type=submit]");
    if (submitBtn) submitBtn.disabled = !canUseAll;
    dlg.showModal();
  });
  document.addEventListener("change", function (e) {
    if (e.target && e.target.id === "topup-use-all") {
      var q = document.getElementById("topup-quota");
      if (!q) return;
      if (e.target.checked) {
        q.value = String(walletBal());
        q.readOnly = true;
      } else {
        q.readOnly = false;
      }
    }
  });
  document.addEventListener("submit", function (e) {
    if (!e.target || e.target.id !== "key-topup-form") return;
    e.preventDefault();
    var id = document.getElementById("topup-key-id").value;
    var qEl = document.getElementById("topup-quota");
    var add = qEl ? parseInt(qEl.value || "0", 10) : 0;
    /* 表单带 novalidate，空值/非法值都得自己拦并**留在弹窗里**提示 */
    if (!id) { showFormErr("key-topup-form", "未选中要续充的 Key，请关闭弹窗后重试"); return; }
    if (!(add >= 1)) { showFormErr("key-topup-form", "请填写 ≥1 的追加额度"); return; }
    var bal = walletBal();
    if (add > bal) {
      showFormErr("key-topup-form", "追加 " + add + " 积分超过钱包余额（" + bal + "），请调小或先充值");
      return;
    }
    clearFormErr("key-topup-form");
    var fd = new FormData();
    fd.append("csrf", csrf());
    fd.append("action", "topup_key");
    fd.append("key_id", id);
    fd.append("add_quota", String(add));
    if (typeof window.ytPostFormSoft === "function") {
      window.ytPostFormSoft(fd, { url: "/?page=keys", action: "/?page=keys" })
        .catch(function () { showFormErr("key-topup-form", "续充失败，请稍后重试"); });
    } else {
      showFormErr("key-topup-form", "续充失败，请刷新页面重试");
    }
  });

  /* ── 指南弹窗 ── */
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-open-key-guide]") : null;
    if (!btn) return;
    var row = rowOf(btn);
    /* 订阅页没有 Key 行：完整 Key 由按钮自带，接口地址用弹窗里 PHP 直出的默认值 */
    var full = (row && row.getAttribute("data-key-full")) || btn.getAttribute("data-key-full") || "";
    if (!full) return;
    var dlg = document.getElementById("key-guide-dialog");
    if (!dlg) return;
    var gk = document.getElementById("guide-api-key");
    var gb = document.getElementById("guide-api-base");
    var base = (table() && table().getAttribute("data-api-base")) || (gb && gb.textContent) || "";
    var gc = document.getElementById("guide-copy-key");
    var sample = document.getElementById("guide-auth-sample");
    if (gk) gk.textContent = full;
    if (gb) gb.textContent = base;
    if (gc) gc.setAttribute("data-copy", full);
    if (sample) sample.textContent = "Authorization: Bearer " + full;
    dlg.showModal();
  });

  /* ── 模型多选 ──
   * 列表缓存进 sessionStorage：**目的是让编辑弹窗能同步拿到列表**，从根上消掉
   * 「填充未完成就提交 → allowed_models 被清空」的异步窗口（见 cachedModels 的调用处）。
   * 选 sessionStorage 而非 localStorage：生命周期跟随标签页，模型上下架后用户重开即失效。
   * 另设 10 分钟软过期 —— 过期仍**先用旧值**（同步可用），同时后台静默刷新供下次使用
   *（stale-while-revalidate）；拿到新值**不回填正在编辑的弹窗**，否则会打断用户已勾选的状态。 */
  var MODELS_SS_KEY = "yt_model_list_v1";
  var MODELS_TTL = 10 * 60 * 1000;
  var modelCache = null;
  function readSS() {
    try {
      var raw = sessionStorage.getItem(MODELS_SS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !Array.isArray(o.list) || !o.list.length) return null;
      return { list: o.list, stale: !(o.at && Date.now() - o.at < MODELS_TTL) };
    } catch (_) { return null; }
  }
  function writeSS(list) {
    try {
      if (list && list.length) {
        sessionStorage.setItem(MODELS_SS_KEY, JSON.stringify({ at: Date.now(), list: list }));
      }
    } catch (_) { /* 隐私模式/超配额：缓存失败不影响功能 */ }
  }
  /** 同步取缓存列表（内存 → sessionStorage）；没有则 null。 */
  function cachedModels() {
    if (modelCache && modelCache.length) return modelCache;
    var hit = readSS();
    if (!hit) return null;
    modelCache = hit.list;
    if (hit.stale) fetchModels();   // 后台刷新，不等它
    return modelCache;
  }
  function fetchModels() {
    return fetch("/?ajax=model_prices", { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var list = (d && d.prices ? d.prices : []).map(function (p) { return p.model; }).filter(Boolean);
        modelCache = list;
        writeSS(list);
        return list;
      })
      .catch(function () { return modelCache || []; });
  }
  function loadModels() {
    var hit = cachedModels();
    if (hit) return Promise.resolve(hit);
    return fetchModels();
  }
  function selectedModels(root) {
    return Array.prototype.map.call(root.querySelectorAll("[data-msel-item]:checked"), function (c) {
      return c.value;
    });
  }
  function renderMselTags(root) {
    var tags = root.querySelector("[data-msel-tags]");
    if (!tags) return;
    var sel = selectedModels(root);
    if (!sel.length) {
      tags.innerHTML = '<span class="msel-placeholder">此密钥可使用的模型，为空则全部可用</span>';
      return;
    }
    var show = sel.slice(0, 5);
    var html = show.map(function (m) {
      return '<span class="msel-tag" title="' + m.replace(/"/g, "&quot;") + '">' + m.replace(/</g, "&lt;") +
        '<button type="button" class="msel-tag-x" data-msel-remove="' + m.replace(/"/g, "&quot;") + '" aria-label="移除">×</button></span>';
    }).join("");
    if (sel.length > 5) html += '<span class="msel-tag msel-more">+' + (sel.length - 5) + "</span>";
    tags.innerHTML = html;
  }
  function fillMselList(root, models, selected) {
    var list = root.querySelector("[data-msel-list]");
    if (!list) return;
    var set = {};
    (selected || []).forEach(function (m) { set[String(m).toLowerCase()] = true; });
    list.innerHTML = models.map(function (m) {
      var ck = set[String(m).toLowerCase()] ? " checked" : "";
      return '<label class="msel-item"><input type="checkbox" data-msel-item value="' +
        m.replace(/"/g, "&quot;") + '"' + ck + "><span>" + m.replace(/</g, "&lt;") + "</span></label>";
    }).join("") || '<p class="msel-empty">暂无模型列表</p>';
    renderMselTags(root);
  }
  document.addEventListener("click", function (e) {
    var root = e.target.closest ? e.target.closest("[data-msel]") : null;
    if (e.target.closest && e.target.closest("[data-msel-toggle]") && root) {
      var panel = root.querySelector("[data-msel-panel]");
      if (!panel) return;
      panel.hidden = !panel.hidden;
      return;
    }
    var rm = e.target.closest ? e.target.closest("[data-msel-remove]") : null;
    if (rm) {
      var r = rm.closest("[data-msel]");
      var v = rm.getAttribute("data-msel-remove");
      if (r && v) {
        var inp = r.querySelector('[data-msel-item][value="' + v.replace(/"/g, '\\"') + '"]');
        if (inp) inp.checked = false;
        renderMselTags(r);
      }
      return;
    }
    if (!e.target.closest || !e.target.closest("[data-msel]")) {
      document.querySelectorAll("[data-msel-panel]:not([hidden])").forEach(function (p) { p.hidden = true; });
    }
  });
  document.addEventListener("change", function (e) {
    if (e.target && e.target.matches && e.target.matches("[data-msel-item]")) {
      var r = e.target.closest("[data-msel]");
      if (r) renderMselTags(r);
    }
  });
  document.addEventListener("input", function (e) {
    if (!e.target || e.target.getAttribute("data-msel-search") == null) return;
    var root = e.target.closest("[data-msel]");
    var q = String(e.target.value || "").trim().toLowerCase();
    if (!root) return;
    root.querySelectorAll(".msel-item").forEach(function (lab) {
      var t = (lab.textContent || "").toLowerCase();
      lab.hidden = !!q && t.indexOf(q) < 0;
    });
  });

  /* ── 编辑弹窗 ── */
  function setEditLimit(unlimId, inputId, val) {
    var un = document.getElementById(unlimId);
    var inp = document.getElementById(inputId);
    var empty = val === "" || val == null;
    if (un) un.checked = empty;
    if (inp) {
      inp.disabled = empty;
      inp.value = empty ? "" : String(val);
    }
  }
  document.addEventListener("change", function (e) {
    var u = e.target;
    if (!u || !u.matches || !u.matches("[data-edit-unlim]")) return;
    var tid = u.getAttribute("data-edit-target");
    var inp = tid ? document.getElementById(tid) : null;
    if (inp) {
      inp.disabled = !!u.checked;
      if (u.checked) inp.value = "";
    }
  });
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-open-key-edit]") : null;
    if (!btn) return;
    var row = rowOf(btn);
    if (!row) return;
    var dlg = document.getElementById("key-edit-dialog");
    if (!dlg) return;
    clearFormErr("key-edit-form");
    /* ── 填充完成前禁止提交（data-ready）────────────────────────────
       同步字段（名称/额度/窗口限额）填完就好说，但**模型多选是异步拉取**的
       （loadModels → fillMselList）。在它回来之前提交，selectedModels() 会返回空数组，
       body.allowed_models 就变成 null —— **等于把这把 Key 原有的模型白名单悄悄清空**。
       所以 ready 必须等模型列表填好，期间保存按钮禁用。 */
    var editForm = document.getElementById("key-edit-form");
    var saveBtn = editForm ? editForm.querySelector('button[type="submit"]') : null;
    if (editForm) editForm.removeAttribute("data-ready");
    if (saveBtn) { saveBtn.disabled = true; saveBtn.setAttribute("data-filling", "1"); }
    document.getElementById("edit-key-id").value = row.getAttribute("data-key-id") || "";
    document.getElementById("edit-key-name").value = row.getAttribute("data-key-name") || "";
    document.getElementById("edit-key-masked").value = row.getAttribute("data-key-masked") || "";
    var wall = row.getAttribute("data-expires-wall") || "2099-12-31 00:00:00";
    var expInp = document.getElementById("edit-expires-at");
    var expLab = document.querySelector("#edit-dtp [data-dtp-label]");
    if (expInp) expInp.value = wall;
    if (expLab) expLab.textContent = wall;
    var totalRow = document.getElementById("edit-total-row");
    var totalInp = document.getElementById("edit-total");
    var totalHint = document.getElementById("edit-total-hint");
    var maxTotal = row.getAttribute("data-max-total") || "";
    var usedTotal = parseFloat(row.getAttribute("data-used-total") || "0") || 0;
    var minTotal = Math.max(1, Math.ceil(usedTotal));
    if (totalRow && totalInp) {
      if (maxTotal === "") {
        totalRow.hidden = true;
        totalInp.removeAttribute("data-edit-total-enabled");
        totalInp.value = "";
      } else {
        totalRow.hidden = false;
        totalInp.setAttribute("data-edit-total-enabled", "1");
        totalInp.min = String(minTotal);
        totalInp.value = String(parseInt(maxTotal, 10) || minTotal);
        if (totalHint) {
          totalHint.textContent = usedTotal > 0
            ? ("已用 " + fmtPts(usedTotal) + " 积分，总额度最低 " + minTotal + "；上调 1:1 扣钱包，下调退差额")
            : "上调 1:1 扣钱包；下调退差额；不得低于已用";
        }
      }
    }
    setEditLimit("edit-5h-unlim", "edit-5h", row.getAttribute("data-limit-5h"));
    setEditLimit("edit-daily-unlim", "edit-daily", row.getAttribute("data-limit-daily"));
    setEditLimit("edit-monthly-unlim", "edit-monthly", row.getAttribute("data-limit-monthly"));
    var models = [];
    try { models = JSON.parse(row.getAttribute("data-allowed-models") || "null") || []; } catch (_) { models = []; }
    var msel = document.getElementById("edit-model-sel");
    /* 无论成功失败都要放开按钮，否则拉模型列表失败就永远存不了盘。
       顺带清掉「正在载入…」那条提示 —— 载入完了它就过期了，留着会让用户以为还没好。
       此刻只可能存在这一条（ready 检查排在所有校验之前），清掉不会盖掉真实错误。 */
    var markReady = function () {
      if (editForm) editForm.setAttribute("data-ready", "1");
      if (saveBtn) { saveBtn.disabled = false; saveBtn.removeAttribute("data-filling"); }
      clearFormErr("key-edit-form");
    };
    /* 有缓存就**同步**填充并立即 ready：不留任何「按钮已可点但列表还没到」的窗口。
       首次打开（无缓存）才走异步，此时按钮保持禁用。 */
    var cached = cachedModels();
    if (cached) {
      if (msel) fillMselList(msel, cached, models);
      markReady();
    } else {
      loadModels()
        .then(function (all) { if (msel) fillMselList(msel, all, models); })
        .then(markReady, markReady);
    }
    dlg.showModal();
  });
  document.addEventListener("submit", function (e) {
    if (!e.target || e.target.id !== "key-edit-form") return;
    e.preventDefault();
    /* 填充（含异步的模型列表）没完成就不放行 —— 否则会把模型白名单清空，见弹窗打开处注释 */
    if (e.target.getAttribute("data-ready") !== "1") {
      showFormErr("key-edit-form", "正在载入当前配置，请稍候再保存");
      return;
    }
    var id = document.getElementById("edit-key-id").value;
    var name = (document.getElementById("edit-key-name").value || "").trim();
    var exp = document.getElementById("edit-expires-at").value || "";
    if (!id) { showFormErr("key-edit-form", "未选中要编辑的 Key，请关闭弹窗后重试"); return; }
    if (!name) { showFormErr("key-edit-form", "请填写 API 名称"); return; }
    function win(unlimId, inputId) {
      var un = document.getElementById(unlimId);
      if (un && un.checked) return null;
      var v = parseFloat((document.getElementById(inputId) || {}).value || "");
      if (!(v > 0)) throw new Error("窗口限额须为正数，或开启无限");
      return v;
    }
    var body;
    try {
      var msel = document.getElementById("edit-model-sel");
      var sel = msel ? selectedModels(msel) : [];
      body = {
        name: name,
        expires_at: exp,
        max_5h_requests: win("edit-5h-unlim", "edit-5h"),
        max_daily_requests: win("edit-daily-unlim", "edit-daily"),
        max_monthly_requests: win("edit-monthly-unlim", "edit-monthly"),
      };
      /* ★ 模型白名单：**列表没渲染出来时绝不传这个字段**。
         后端只在字段 `!== undefined` 时才更新（user-portal.ts），所以不传 = 保持原值；
         而传 null 是「显式清空」—— 列表未就绪时 selectedModels() 恒为空，
         照传就会把用户原有的白名单抹掉。这是 data-ready 之外的第二道保险：
         就算 ready 判断哪天失效，也不会丢数据。 */
      var mselReady = !!(msel && msel.querySelector("[data-msel-item]"));
      if (mselReady) body.allowed_models = sel.length ? sel : null;
      var totalInp = document.getElementById("edit-total");
      if (totalInp && totalInp.getAttribute("data-edit-total-enabled") === "1") {
        var minT = parseInt(totalInp.min || "1", 10) || 1;
        var tot = parseInt(totalInp.value || "0", 10);
        if (!(tot >= minT)) {
          throw new Error("总额度不能低于已用（最低 " + minT + " 积分）");
        }
        body.max_total_requests = tot;
      }
    } catch (err) {
      showFormErr("key-edit-form", err.message || "参数有误");
      return;
    }
    clearFormErr("key-edit-form");
    patchKey(id, body)
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || "保存失败");
        if (d.balance_points != null) applyWalletBalance(d.balance_points);
        toast("已保存", true);
        var dlg = document.getElementById("key-edit-dialog");
        if (dlg && dlg.open) try { dlg.close(); } catch (_) { /* ignore */ }
        if (typeof window.ytSoftNavigate === "function") {
          window.ytSoftNavigate("/?page=keys", { replace: true });
        }
      })
      /* 失败**不关弹窗**：错误留在弹窗内，用户能看清原因并就地改（后端报错也走这里） */
      .catch(function (err) { showFormErr("key-edit-form", (err && err.message) || "保存失败"); });
  });
})();

window.__ytInits.push(function initQuotaBars() {
  "use strict";
  document.querySelectorAll(".quota-bar[data-fill-pct], .quota-bar[data-used-pct], .quota-bar[data-pct]").forEach(function (bar) {
    var i = bar.querySelector("i");
    if (!i || i.dataset.ytBound) return;
    i.dataset.ytBound = "1";
    if (bar.classList.contains("quota-bar--max")) {
      i.style.width = "100%";
      return;
    }
    var fill = bar.getAttribute("data-fill-pct");
    var used = bar.getAttribute("data-used-pct");
    var pct = fill != null
      ? Math.max(0, Math.min(100, parseFloat(fill) || 0))
      : used != null
        ? Math.max(0, Math.min(100, parseFloat(used) || 0))
        : Math.max(0, Math.min(100, 100 - (parseFloat(bar.getAttribute("data-pct") || "0") || 0)));
    i.style.width = pct + "%";
    if (!bar.classList.contains("quota-bar--ok") &&
        !bar.classList.contains("quota-bar--warn") &&
        !bar.classList.contains("quota-bar--danger")) {
      /* data-fill-pct = 剩余比例：低危险；data-used-pct = 已用比例：高危险 */
      if (fill != null) {
        bar.classList.add(pct <= 20 ? "quota-bar--danger" : pct <= 50 ? "quota-bar--warn" : "quota-bar--ok");
      } else {
        bar.classList.add(pct >= 80 ? "quota-bar--danger" : pct >= 50 ? "quota-bar--warn" : "quota-bar--ok");
      }
    }
  });
});

/* Keys 列表：关键字/Key 筛选 + 剩余额度/创建时间排序（document 委托，不依赖 ytRunInits 时序） */
(function () {
  "use strict";
  var sortState = { key: "", dir: "" };

  function tableEl() { return document.getElementById("issued-keys-table"); }
  function tbodyEl() {
    var t = tableEl();
    return t ? t.querySelector("tbody") : null;
  }
  function rows() {
    var tb = tbodyEl();
    if (!tb) return [];
    return Array.prototype.slice.call(tb.querySelectorAll("[data-key-row]"));
  }

  function applyFilter() {
    var nameQ = ((document.getElementById("keys-filter-name") || {}).value || "").trim().toLowerCase();
    var keyQ = ((document.getElementById("keys-filter-key") || {}).value || "").trim().toLowerCase();
    var emptyTip = document.getElementById("keys-filter-empty");
    var shown = 0;
    var all = rows();
    all.forEach(function (tr) {
      var name = (tr.getAttribute("data-key-name") || "").toLowerCase();
      var full = (tr.getAttribute("data-key-full") || "").toLowerCase();
      var masked = (tr.getAttribute("data-key-masked") || "").toLowerCase();
      var okName = !nameQ || name.indexOf(nameQ) >= 0;
      var okKey = !keyQ || full.indexOf(keyQ) >= 0 || masked.indexOf(keyQ) >= 0;
      var show = okName && okKey;
      tr.hidden = !show;
      if (show) shown += 1;
    });
    if (emptyTip) emptyTip.hidden = !all.length || shown > 0;
    var countEl = document.querySelector("[data-keys-count]");
    if (countEl) countEl.textContent = String((nameQ || keyQ) ? shown : all.length);
  }

  function sortValue(tr, key) {
    if (key === "remaining") {
      var n = parseFloat(tr.getAttribute("data-sort-remaining") || "0");
      return isFinite(n) ? n : 0;
    }
    if (key === "created") {
      var t = parseInt(tr.getAttribute("data-created-ts") || "0", 10);
      return isFinite(t) ? t : 0;
    }
    return 0;
  }

  function applySort() {
    var tb = tbodyEl();
    if (!tb || !sortState.key || !sortState.dir) return;
    var list = rows();
    var dir = sortState.dir === "asc" ? 1 : -1;
    var key = sortState.key;
    list.sort(function (a, b) {
      var va = sortValue(a, key);
      var vb = sortValue(b, key);
      if (va === vb) return 0;
      return va > vb ? dir : -dir;
    });
    list.forEach(function (tr) { tb.appendChild(tr); });
  }

  function setSortUi() {
    var t = tableEl();
    if (!t) return;
    t.querySelectorAll("[data-keys-sort]").forEach(function (el) {
      var k = el.getAttribute("data-keys-sort");
      el.classList.remove("is-asc", "is-desc");
      el.setAttribute("aria-sort", "none");
      if (k === sortState.key && sortState.dir) {
        el.classList.add(sortState.dir === "asc" ? "is-asc" : "is-desc");
        el.setAttribute("aria-sort", sortState.dir === "asc" ? "ascending" : "descending");
      }
    });
  }

  function toggleSort(key) {
    if (!key || !tableEl()) return;
    if (sortState.key !== key) {
      sortState.key = key;
      sortState.dir = "desc";
    } else if (sortState.dir === "desc") {
      sortState.dir = "asc";
    } else if (sortState.dir === "asc") {
      sortState.key = "";
      sortState.dir = "";
    } else {
      sortState.dir = "desc";
    }
    setSortUi();
    if (sortState.key) applySort();
    applyFilter();
  }

  document.addEventListener("click", function (e) {
    var reset = e.target.closest ? e.target.closest("[data-keys-filter-reset]") : null;
    if (reset) {
      var n = document.getElementById("keys-filter-name");
      var k = document.getElementById("keys-filter-key");
      if (n) n.value = "";
      if (k) k.value = "";
      applyFilter();
      return;
    }
    var sortEl = e.target.closest ? e.target.closest("[data-keys-sort]") : null;
    if (!sortEl || !tableEl() || !tableEl().contains(sortEl)) return;
    e.preventDefault();
    e.stopPropagation();
    toggleSort(sortEl.getAttribute("data-keys-sort") || "");
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var sortEl = e.target && e.target.closest ? e.target.closest("th[data-keys-sort]") : null;
    if (!sortEl || !tableEl() || !tableEl().contains(sortEl)) return;
    e.preventDefault();
    toggleSort(sortEl.getAttribute("data-keys-sort") || "");
  });

  document.addEventListener("submit", function (e) {
    if (!e.target || e.target.id !== "keys-filter") return;
    e.preventDefault();
    e.stopPropagation();
    applyFilter();
  }, true);

  /* 软刷新后 DOM 重建，恢复表头高亮（排序状态仍在内存） */
  window.__ytInits.push(function restoreKeysSortUi() {
    setSortUi();
    if (sortState.key) applySort();
  });
})();

/* ══ API 文档 · 单页视图路由（2026-08-19 重构）════════════════════════════
   文档改成「每个目录项 = 一个独立视图」：一次只渲染/显示一个章节，
   点左侧目录才切换，页面内不会滚串到别的章节（对齐 b.ai 那种一节一页的读法）。

   为什么不用锚点 + 滚动：14 个章节 + 49 张模型卡同屏时 DOM 极大，滚动高亮要逐帧算章节位置；
   改成单视图后**同屏只有一节**，切换是纯 class 开关，零请求、零重排。

   路由（写在 hash 里，可分享、可后退）：
     #docs-<章节>              普通章节，如 #docs-intro
     #docs-client-<工具id>     客户端接入 → 具体工具面板
     #docs-model-<模型名>      模型列表 → 具体模型资料卡
   统一用 replaceState：切十几下不会在历史里堆一堆条目、按一次后退就能离开本页。 */
(function () {
  "use strict";
  var CLIENT_PREFIX = "#docs-client-";
  var MODEL_PREFIX = "#docs-model-";
  var selectedClient = "";

  function sections() { return document.querySelectorAll(".docs-sec[id]"); }
  function panels() { return document.querySelectorAll("[data-client-panel]"); }

  /**
   * 本页的滚动容器。宽屏是 `.docs-body`（目录列固定、正文列自己滚），
   * ≤900px 回退成整页滚，容器变回 `.shell-main`（CSS 里把 overflow 改成 visible 作为判据）。
   * ⚠ 站内其它页面一律是 `.shell-main`，只有文档页有这个分叉。
   */
  function scroller() {
    var body = document.querySelector(".docs-body");
    if (body && getComputedStyle(body).overflowY !== "visible") return body;
    return document.querySelector(".shell-main");
  }
  window.__ytDocsScroller = scroller;

  /**
   * 给静态章节补右侧「本页目录」（模型卡自己渲染，跳过它）。
   *
   * 不重组也不复制内容：把原有子节点整体搬进 `.docs-sec-main`，再追加一个 aside，
   * 章节就变成「正文 + 右栏」两列。只做一次（`data-ontp` 标记），复制按钮、
   * `<details>`、客户端面板的事件都是委托绑 document 的，搬动节点不受影响。
   * 小节少于 3 个不做目录 —— 只有一两条的目录没什么用，还白占 150px 正文宽度。
   */
  function buildOnThisPage() {
    sections().forEach(function (sec) {
      if (sec.id === "docs-modelview" || sec.getAttribute("data-ontp")) return;
      sec.setAttribute("data-ontp", "1");
      var h3s = [].slice.call(sec.children).filter(function (el) {
        return el.tagName === "H3";
      });
      if (h3s.length < 3) return;

      var main = document.createElement("div");
      main.className = "docs-sec-main";
      while (sec.firstChild) main.appendChild(sec.firstChild);
      sec.appendChild(main);

      var rows = h3s.map(function (h, i) {
        if (!h.id) h.id = sec.id + "-h" + i;
        return (
          '<button type="button" class="mcard-onthis-link' + (i === 0 ? " is-on" : "") +
          '" data-mc-jump="' + h.id + '">' + h.textContent + "</button>"
        );
      }).join("");
      var aside = document.createElement("aside");
      aside.className = "mcard-onthis docs-sec-ontp";
      aside.setAttribute("aria-label", "本页目录");
      aside.innerHTML = '<div class="mcard-onthis-title">本页目录</div>' + rows;
      sec.appendChild(aside);
      sec.classList.add("has-ontp");
    });
  }

  /** 只显示 id 对应的那一节，其余全部隐藏。 */
  function showSection(id) {
    var found = false;
    var body = document.querySelector(".docs-body");
    if (body) body.classList.add("is-routed");
    sections().forEach(function (sec) {
      var on = sec.id === id;
      sec.hidden = !on;
      if (on) found = true;
    });
    if (!found) return false;
    /* 一级目录项高亮：模型卡 / 具体工具由子项承担高亮，父级不重复亮。 */
    var subOwned =
      (id === "docs-clients" && selectedClient) ||
      (id === "docs-modelview" && window.__ytDocsModel);
    document
      .querySelectorAll(".docs-toc-link:not(.docs-toc-sub):not(.docs-toc-model)")
      .forEach(function (a) {
        a.classList.toggle("is-section-on", a.getAttribute("href") === "#" + id && !subOwned);
      });
    /* 换节后回到内容区顶部（宽屏滚 .docs-body，窄屏滚 .shell-main，见 scroller）。 */
    var sc = scroller();
    if (sc) sc.scrollTop = 0;
    /* 静态章节的「本页目录」高亮：换节后重新绑到当前这一节的 h3 上。
       模型卡那一节由它自己在 renderCard 里绑（小节是 .mcard-sec）。 */
    if (id !== "docs-modelview" && typeof window.__ytDocsBindOnThis === "function") {
      var cur = document.getElementById(id);
      if (cur && cur.classList.contains("has-ontp")) {
        window.__ytDocsBindOnThis(cur, "h3[id]");
      } else {
        window.__ytDocsBindOnThis(null);
      }
    }
    return true;
  }
  window.__ytDocsShowSection = showSection;

  /** 当前显示的章节 id（用于模型卡模块判断该不该给高亮）。 */
  function currentSection() {
    var cur = "";
    sections().forEach(function (sec) {
      if (!sec.hidden) cur = sec.id;
    });
    return cur;
  }
  window.__ytDocsSection = currentSection;

  function setHash(h) {
    /* 目录项本身是 <a href="#…">：原生 hash 变更在 handler 之后发生，
       直接写会被它覆盖，故延后一拍（客户端面板那次就是这么踩的）。 */
    setTimeout(function () {
      try { history.replaceState(history.state, "", h); } catch (_) { /* 忽略 */ }
    }, 0);
  }

  /** 选中某个客户端工具：显示客户端章节 + 只留它的面板。 */
  function selectClient(id, opts) {
    opts = opts || {};
    var tabs = document.querySelectorAll("[data-client-tab]");
    if (!tabs.length) return;
    var hit = null;
    tabs.forEach(function (t) {
      if (t.getAttribute("data-client-tab") === id) hit = t;
    });
    if (!hit) return;
    selectedClient = id;
    panels().forEach(function (p) {
      p.hidden = p.getAttribute("data-client-panel") !== id;
    });
    tabs.forEach(function (t) {
      t.classList.toggle("is-on", t.getAttribute("data-client-tab") === id);
    });
    var intro = document.querySelector(".docs-clients-intro");
    if (intro) intro.hidden = true;
    /* 目录默认收起，直达 #docs-client-<id> 时得展开，否则看不到高亮的那一项 */
    setFold("clients", true);
    if (opts.show !== false) showSection("docs-clients");
    if (opts.updateHash) setHash(CLIENT_PREFIX + id);
  }
  window.__ytDocsSelectClient = selectClient;

  /**
   * 展开 / 收起目录里的可折叠组（`models` 品牌树、`clients` 工具列表）。
   * 两组都默认收起：品牌 11 个 + 工具 11 个常驻，会把「计费与限额」以下的章节挤出目录。
   */
  function setFold(key, open) {
    var box = document.querySelector('[data-fold-group="' + key + '"]');
    var btn = document.querySelector('[data-toc-fold="' + key + '"]');
    if (!box || !btn) return;
    box.hidden = !open;
    btn.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  /** 模型卡模块用它在 hash 直达时展开品牌树。 */
  window.__ytDocsTree = function (open) { setFold("models", open); };

  /** 切到某个一级章节：清掉工具/模型子项选中，避免父级与子项同时亮。 */
  function goSection(id) {
    if (!document.getElementById(id)) return;
    selectedClient = "";
    document.querySelectorAll("[data-client-tab]").forEach(function (t) {
      t.classList.remove("is-on");
    });
    panels().forEach(function (p) { p.hidden = true; });
    window.__ytDocsModel = "";
    document.querySelectorAll("[data-model-doc]").forEach(function (a) {
      a.classList.remove("is-on");
    });
    var intro = document.querySelector(".docs-clients-intro");
    if (intro) intro.hidden = false;
    /* 点父级项顺手展开它的子列表：用户点这一项多半就是要往下挑 */
    if (id === "docs-models") setFold("models", true);
    if (id === "docs-clients") setFold("clients", true);
    if (showSection(id)) setHash("#" + id);
  }

  /* 委托绑 document：PJAX 换页免重绑 */
  document.addEventListener("click", function (e) {
    if (!e.target.closest) return;

    // ⓪a 目录里的折叠箭头：只开合子列表，不切章节
    var fold = e.target.closest("[data-toc-fold]");
    if (fold) {
      e.preventDefault();
      var key = fold.getAttribute("data-toc-fold");
      var box = document.querySelector('[data-fold-group="' + key + '"]');
      setFold(key, !!(box && box.hidden));
      return;
    }
    // ⓪b 正文里的返回入口（模型卡面包屑等）
    var navBtn = e.target.closest("[data-docs-nav]");
    if (navBtn) {
      e.preventDefault();
      goSection(navBtn.getAttribute("data-docs-nav"));
      return;
    }
    // ① 具体工具
    var tab = e.target.closest("[data-client-tab]");
    if (tab) {
      e.preventDefault(); // 单视图模式不需要原生锚点滚动
      selectClient(tab.getAttribute("data-client-tab"), { updateHash: true });
      return;
    }
    // ② 具体模型（渲染交给模型卡模块，这里只负责切到独立的资料卡页）
    var modelLink = e.target.closest("[data-model-doc]");
    if (modelLink) {
      e.preventDefault();
      showSection("docs-modelview");
      return; // 模型卡模块自己的委托会接着渲染并写 hash
    }
    // ③ 一级目录项 = 独立页：清掉子项选中，只显示这一节
    var link = e.target.closest(".docs-toc-link");
    if (!link) return;
    var href = link.getAttribute("href") || "";
    if (href.charAt(0) !== "#") return;
    var id = href.slice(1);
    if (!document.getElementById(id)) return;
    e.preventDefault();
    goSection(id);
  });

  window.__ytInits.push(function initDocsRouter() {
    if (!sections().length) return;

    /* 页脚挪进正文列：留在 .shell-main 里会常驻底部、白占一截高度，
       正文区被压得很矮。放进滚动列后要拉到最底才看到它。 */
    var foot = document.querySelector(".shell-foot");
    var body = document.querySelector(".docs-body");
    if (foot && body && foot.parentNode !== body) body.appendChild(foot);

    buildOnThisPage();

    var hash = location.hash || "";

    // 客户端工具直达
    if (hash.indexOf(CLIENT_PREFIX) === 0) {
      var cid = hash.slice(CLIENT_PREFIX.length);
      if (document.querySelector('[data-client-panel="' + cid.replace(/"/g, "") + '"]')) {
        selectClient(cid, {});
        return;
      }
    }
    // 模型直达：先切到资料卡页 + 展开品牌树，卡片由模型卡模块按 hash 渲染
    if (hash.indexOf(MODEL_PREFIX) === 0) {
      setFold("models", true);
      showSection("docs-modelview");
      return;
    }
    // 普通章节直达；否则落到第一节
    var id = hash.slice(1);
    if (id && document.getElementById(id)) {
      showSection(id);
      return;
    }
    showSection(sections()[0].id);
  });

  /* 手动改地址栏 hash / 点外部锚点链接时跟着切视图。
     我们自己切换用的是 replaceState（不触发 hashchange），不会和这里打架；
     没有这个监听的话，把 #docs-model-xxx 发给已经开着文档页的人，他粘贴回车没反应。 */
  window.addEventListener("hashchange", function () {
    if (!sections().length) return;
    var hash = location.hash || "";
    if (hash.indexOf(MODEL_PREFIX) === 0) {
      if (typeof window.__ytDocsSelectModelBySlug === "function") {
        window.__ytDocsSelectModelBySlug(hash.slice(MODEL_PREFIX.length));
      }
      return;
    }
    if (hash.indexOf(CLIENT_PREFIX) === 0) {
      selectClient(hash.slice(CLIENT_PREFIX.length), {});
      return;
    }
    var id = hash.slice(1);
    if (id && document.getElementById(id)) goSection(id);
  });
})();

/* ══ API 文档 · 模型资料卡（2026-08-19）══════════════════════════════════
   左侧目录「模型列表」下按厂商折叠出全部模型，点模型在正文渲染资料卡
   （版式参考 b.ai 文档：概述 / 核心特性 / 适用场景 / 能力与限制 / 积分消耗）。

   数据复用 `/?ajax=model_prices`（后端 model-prices）：只含面向用户的字段 ——
   名称、单价、可用状态、品牌、识图结论、描述、标签、上下文。
   **真实上游模型名与伪装配置不在其中**，卡片也绝不能显示这类信息。

   选中项写进 `#docs-model-<name>`（replaceState，不新增历史条目），便于把某个模型的介绍发给客户。 */
(function () {
  "use strict";
  var HASH_PREFIX = "#docs-model-";
  var cache = null;      // 拉取结果缓存（内存，切页不重复请求）
  var loading = null;    // 进行中的 Promise，避免并发重复拉
  /* 当前展示的模型名存在 window.__ytDocsModel：路由高亮据此点亮对应目录项。 */

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  /** hash 片段只保留安全字符：模型名含点号等，需可逆地放进 hash。 */
  function slug(name) {
    return String(name).replace(/[^A-Za-z0-9._-]/g, "-");
  }

  /* ── 模型数据缓存（前端静态 + 版本号）────────────────────────────────
     文档正文是 PHP 静态的，唯一会变的是模型清单。不必每次进页都拉：
       · DOCS_CACHE_VER：改了文档代码/卡片结构就 +1，旧缓存立刻作废
       · revision：后台保存注册表（上架/下架/调价）自增
       · 有缓存且版本对得上 → **零请求**立刻渲染
       · 距上次核对超过 10 分钟才静默回源；revision 没变则只更新 checkedAt
     CSS/JS 本身已由 yt_asset 按 filemtime 带 ?v=，改代码浏览器也会拿新文件。 */
  var DOCS_CACHE_VER = 2;
  var LS_KEY = "yt_docs_models_v2";
  var LS_TTL_MS = 7 * 24 * 3600 * 1000;
  var REVALIDATE_MS = 10 * 60 * 1000;

  function readCache() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !Array.isArray(o.prices) || !o.at) return null;
      if (o.ver !== DOCS_CACHE_VER) return null;
      if (Date.now() - o.at > LS_TTL_MS) return null;
      return o;
    } catch (_) {
      return null; // 隐私模式 / 脏数据：当没缓存
    }
  }
  function writeCache(prices, revision) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        ver: DOCS_CACHE_VER,
        prices: prices,
        revision: revision,
        at: Date.now(),
        checkedAt: Date.now(),
      }));
    } catch (_) { /* 配额满/隐私模式：忽略，只是下次还得拉一遍 */ }
  }
  function needsRevalidate(cached) {
    if (!cached) return true;
    return Date.now() - (Number(cached.checkedAt) || 0) > REVALIDATE_MS;
  }
  /** 只留可调用的：不可用模型放进目录只会让用户白填一遍（与价格表弹窗同口径）。 */
  function usable(list) {
    return list.filter(function (p) { return p && p.model && p.available !== false; });
  }

  /** 静默回源；revision 与缓存不同才回调（避免无意义重渲染）。 */
  function revalidate(cachedRevision, onFresh) {
    if (loading) return;
    loading = fetch("/?ajax=model_prices", {
      credentials: "same-origin",
      headers: { "X-Requested-With": "fetch" },
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !Array.isArray(d.prices)) return;
        var rev = Number(d.revision) || 0;
        writeCache(d.prices, rev);
        if (rev !== cachedRevision) {
          cache = usable(d.prices);
          if (typeof onFresh === "function") onFresh(cache);
        }
      })
      .catch(function () { /* 网络失败不影响已渲染的缓存内容 */ })
      .finally(function () { loading = null; });
  }

  /**
   * 「定价与用量」章节的模型单价表。用的是同一份 model-prices 缓存，
   * 所以进文档页零额外请求，后台调价/上下架下次回源自动同步。
   * 只渲染面向用户的字段（单价即用户实扣价），不涉及任何内部口径。
   */
  function renderPriceTable(list) {
    var box = document.querySelector("[data-price-table]");
    if (!box) return;
    if (!list.length) {
      box.innerHTML = '<p class="docs-hint">暂无可用模型，请稍后再试或 <a href="' + window.ytKefuUrl({}) + '" data-kefu="" target="_blank" rel="noopener">联系在线客服</a>。</p>';
      return;
    }
    var rows = list.map(function (m) {
      return (
        "<tr><td><code>" + esc(m.model) + "</code></td>" +
        "<td>" + esc(m.brand_label || m.brand || "其他") + "</td>" +
        "<td><b>" + esc(m.price) + "</b></td>" +
        "<td>" + (m.context ? esc(m.context) : "—") + "</td>" +
        "<td>" + (m.vision ? "支持" : "—") + "</td></tr>"
      );
    }).join("");
    box.innerHTML =
      '<div class="docs-price-wrap"><table class="docs-table docs-price-tbl">' +
      "<thead><tr><th>模型</th><th>厂商</th><th>单价（积分/次）</th><th>上下文</th><th>识图</th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div>" +
      '<p class="docs-hint">共 ' + list.length + " 个模型可调用。识图列为该模型<b>自身</b>的视觉能力，" +
      "平台不做识图兜底 —— 给不支持识图的模型发图，请求照样成功计费但图片不会送达模型。识图与纯文本<b>同价</b>。</p>";
  }

  /** 按品牌分组，保持后端给的「价格从高到低」顺序。 */
  function groupByBrand(list) {
    var order = [];
    var map = {};
    list.forEach(function (m) {
      var key = m.brand || "other";
      if (!map[key]) {
        map[key] = { key: key, label: m.brand_label || m.brand || "其他模型", items: [] };
        order.push(key);
      }
      map[key].items.push(m);
    });
    return order.map(function (k) { return map[k]; });
  }

  function renderTree(box, groups) {
    box.innerHTML = groups
      .map(function (g) {
        var rows = g.items
          .map(function (m) {
            return (
              '<a class="docs-toc-link docs-toc-model" href="#docs-modelview" data-model-doc="' +
              esc(m.model) + '" title="' + esc(m.model) + '">' + esc(m.model) +
              (m.is_new ? ' <span class="docs-toc-new">新</span>' : "") +
              "</a>"
            );
          })
          .join("");
        return (
          '<div class="docs-toc-brand" data-brand="' + esc(g.key) + '">' +
          '<button type="button" class="docs-toc-brand-btn" data-brand-toggle aria-expanded="false">' +
          '<span class="docs-toc-brand-name">' + esc(g.label) + "</span>" +
          '<span class="docs-toc-brand-n">' + g.items.length + "</span>" +
          '<span class="docs-toc-brand-arrow" aria-hidden="true">›</span>' +
          "</button>" +
          '<div class="docs-toc-brand-list" hidden>' + rows + "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  /**
   * 资料卡：一节一个 `<section class="mcard-sec">`，右侧「本页目录」由同一份 `secs`
   * 生成 —— 加减章节只改这个数组，两边不会不同步。
   */
  function renderCard(box, m) {
    var feats = (m.tags || []).map(function (t) {
      return "<li>" + esc(t) + "</li>";
    }).join("");
    /* 适用场景由「识图能力 + 协议能力」推导：我们没有逐模型的人工长文，
       与其编造，不如给出可核实的能力结论。 */
    var scenes = [
      m.vision
        ? "<li><b>多模态任务</b>：支持图片输入，可做截图问答、图表解读、UI 走查等视觉场景。</li>"
        : "<li><b>纯文本任务</b>：对话、写作、翻译、代码生成等文本场景。<b>不支持图片输入</b>，需要识图请改用视觉模型。</li>",
      "<li><b>工具调用 / Agent</b>：支持 <code>tools</code> 函数调用与流式输出，可接入各类 Agent 框架。</li>",
      "<li><b>客户端接入</b>：可在 Cursor、Claude Code、Cherry Studio 等工具里直接选用（见「客户端接入」）。</li>",
    ].join("");
    var curl = curlOf(m.model);

    var secs = [
      {
        id: "mc-overview",
        title: "概述",
        html: "<p>" + (m.description ? esc(m.description) : "暂无简介，可先按下方能力与单价试用。") + "</p>",
      },
      feats && {
        id: "mc-features",
        title: "核心特性",
        html: '<ul class="mcard-list">' + feats + "</ul>",
      },
      {
        id: "mc-scenes",
        title: "适用场景",
        html: '<ul class="mcard-list">' + scenes + "</ul>",
      },
      {
        id: "mc-caps",
        title: "能力与限制",
        html:
          '<table class="mcard-table">' +
          "<thead><tr><th>能力维度</th><th>说明</th></tr></thead><tbody>" +
          "<tr><th>上下文窗口</th><td>" + (m.context ? esc(m.context) + " token" : "以模型广场展示为准") + "</td></tr>" +
          "<tr><th>多模态能力</th><td>" + (m.vision ? "支持图片输入（<code>image_url</code>，含 base64 data URL）" : "仅文本输入，不支持图片") + "</td></tr>" +
          "<tr><th>工具调用</th><td>支持 <code>tools</code> / <code>tool_choice</code>，返回 <code>tool_calls</code></td></tr>" +
          "<tr><th>流式输出</th><td>支持 <code>stream: true</code>（SSE 增量返回）</td></tr>" +
          "<tr><th>协议兼容</th><td><code>/chat/completions</code>（OpenAI）与 <code>/messages</code>（Anthropic）通用</td></tr>" +
          "</tbody></table>",
      },
      {
        id: "mc-limits",
        title: "已知限制",
        html:
          '<ul class="mcard-list">' +
          "<li>按次计费<b>不区分</b>输入 / 输出 token，<code>usage</code> 字段仅供参考。</li>" +
          "<li>上游偶发不可用时会自动切备用线路；极端情况返回错误码（见「错误码」）。</li>" +
          (m.vision
            ? ""
            : "<li><b>不支持识图</b>：发带图请求虽会返回成功并计费，但图片<b>不会送达模型</b>" +
              "（平台不做识图兜底、不会替你换模型）。需要识图请改用标注「视觉模型」的模型。</li>") +
          "</ul>",
      },
      {
        id: "mc-price",
        title: "积分消耗",
        html:
          '<table class="mcard-table">' +
          "<thead><tr><th>计费方式</th><th>单价</th><th>说明</th></tr></thead><tbody>" +
          "<tr><td>按次计费</td><td><b>" + esc(m.price) + "</b> 积分 / 次</td>" +
          "<td>每次成功调用扣该模型单价，<b>与 token 数量无关</b></td></tr>" +
          "</tbody></table>" +
          '<p class="docs-note">上表为<b>当前新签 Key</b> 的单价；已签发的 Key 按签发时价格锁定，' +
          "真实单价请到「我的 Key」点对应密钥的「价格」查看。</p>",
      },
      {
        id: "mc-example",
        title: "调用示例",
        html:
          '<div class="docs-code"><div class="docs-code-head"><span class="docs-code-lang">cURL</span>' +
          '<button type="button" class="copy-btn copy-mini" data-copy="' + esc(curl) + '">复制</button></div>' +
          '<pre class="docs-pre">' + esc(curl) + "</pre></div>",
      },
    ].filter(Boolean);

    var body = secs
      .map(function (s) {
        return (
          '<section class="mcard-sec" id="' + s.id + '">' +
          "<h3>" + esc(s.title) + "</h3>" + s.html +
          "</section>"
        );
      })
      .join("");

    var onThis = secs
      .map(function (s, i) {
        return (
          '<button type="button" class="mcard-onthis-link' + (i === 0 ? " is-on" : "") +
          '" data-mc-jump="' + s.id + '">' + esc(s.title) + "</button>"
        );
      })
      .join("");

    var brand = m.brand_label || m.brand || "其他模型";

    box.innerHTML =
      '<article class="mcard">' +
      '<div class="mcard-main">' +
      /* 面包屑：第一段回「模型列表」接口文档，交给文档路由处理（不走原生锚点） */
      '<nav class="mcard-crumb" aria-label="位置">' +
      '<button type="button" class="mcard-crumb-link" data-docs-nav="docs-models">模型列表</button>' +
      '<span class="mcard-crumb-sep" aria-hidden="true">/</span>' +
      "<span>" + esc(brand) + "</span>" +
      '<span class="mcard-crumb-sep" aria-hidden="true">/</span>' +
      '<span class="mcard-crumb-cur">' + esc(m.model) + "</span>" +
      "</nav>" +

      '<header class="mcard-head">' +
      '<h2 class="mcard-title">' + esc(m.model) +
      (m.is_new ? ' <span class="mcard-new">上新</span>' : "") +
      "</h2>" +
      '<div class="mcard-meta">' +
      '<span class="mcard-tag mcard-tag-brand">' + esc(brand) + "</span>" +
      '<span class="mcard-tag">' + (m.vision ? "视觉模型" : "文本模型") + "</span>" +
      '<span class="mcard-tag">函数调用</span>' +
      (m.context ? '<span class="mcard-tag">' + esc(m.context) + " 上下文</span>" : "") +
      "</div>" +
      "</header>" +

      body +
      "</div>" +

      '<aside class="mcard-onthis" aria-label="本页目录">' +
      '<div class="mcard-onthis-title">本页目录</div>' +
      onThis +
      "</aside>" +
      "</article>";

    bindOnThis(box);
  }

  /* ── 右侧「本页目录」：点击滚动 + 当前小节高亮 ──────────────────────
     滚动容器由 `__ytDocsScroller()` 给（宽屏 `.docs-body`、窄屏 `.shell-main`），
     绑 `window` 收不到事件、`window.scrollY` 恒为 0（见 PITFALLS）。
     判定用「最后一个越过判定线的小节」，不是「第一个相交的」—— 后者在小节较短时
     会一直回落到上一节（点「积分消耗」却高亮「能力与限制」，实测踩过）。 */
  var mcSpy = null;

  /**
   * 绑定「本页目录」的滚动高亮。单例：换节 / 换模型时先解绑上一次。
   * `box` 传 null 只解绑（当前章节没有本页目录时）。
   * `sel` 是「小节」的选择器：模型卡是 `.mcard-sec`，静态章节是 `h3[id]`。
   */
  function bindOnThis(box, sel) {
    if (mcSpy) {
      mcSpy.sc.removeEventListener("scroll", mcSpy.handler);
      mcSpy = null;
    }
    if (!box) return;
    var sc = window.__ytDocsScroller && window.__ytDocsScroller();
    var secs = [].slice.call(box.querySelectorAll(sel || ".mcard-sec"));
    var links = [].slice.call(box.querySelectorAll("[data-mc-jump]"));
    if (!sc || !secs.length || !links.length) return;

    var ticking = false;
    function recalc() {
      ticking = false;
      /* 已经滚到底时判定线下移到半屏：末尾几节的顶部再也到不了 100px 处，
         用固定线的话点「积分消耗」会一直停在「能力与限制」（实测踩过）。 */
      var atBottom = sc.scrollTop >= sc.scrollHeight - sc.clientHeight - 2;
      var line = sc.getBoundingClientRect().top + (atBottom ? sc.clientHeight * 0.5 : 100);
      var active = secs[0].id;
      for (var i = 0; i < secs.length; i++) {
        if (secs[i].getBoundingClientRect().top <= line) active = secs[i].id;
      }
      links.forEach(function (a) {
        a.classList.toggle("is-on", a.getAttribute("data-mc-jump") === active);
      });
    }
    var handler = function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(recalc);
    };
    sc.addEventListener("scroll", handler, { passive: true });
    mcSpy = { sc: sc, handler: handler };
    /* 延后一拍再算：renderCard 跑在 showSection 之前，这会儿本节还是 hidden，
       量出来的 rect 全是 0，会把高亮错判到最后一节。 */
    setTimeout(recalc, 0);
  }
  window.__ytDocsBindOnThis = bindOnThis;

  function curlOf(model) {
    /* API Base 挂在模型卡容器上（docs.php 输出），不去全局找 [data-api-base] ——
       那个属性在「我的 Key」页也有，跨页取会拿到别的元素。 */
    var box = document.querySelector("[data-modelcard]");
    var api = (box && box.getAttribute("data-api-base")) || "";
    return (
      "curl " + api + "/chat/completions \\\n" +
      '  -H "Content-Type: application/json" \\\n' +
      '  -H "Authorization: Bearer sk-你的Key" \\\n' +
      "  -d '{\n" +
      '    "model": "' + model + '",\n' +
      '    "messages": [{"role": "user", "content": "你好"}]\n' +
      "  }'"
    );
  }

  /**
   * 渲染某个模型的资料卡。
   * `silent`：静默更新（缓存回源、首屏预选）时用，只渲染内容、不改 hash 也不给目录高亮 ——
   * 预选不等于选中，否则用户还在「概述」页，目录里却亮着一个模型（这个坑踩过）。
   */
  function select(name, opts) {
    opts = opts || {};
    var box = document.querySelector("[data-modelcard]");
    if (!box || !cache) return;
    var hit = null;
    for (var i = 0; i < cache.length; i++) {
      if (cache[i].model === name) { hit = cache[i]; break; }
    }
    if (!hit) return;
    renderCard(box, hit);
    if (opts.silent) {
      /* 静默：只更新卡片内容（回源刷新），不切页、不改 hash */
      return;
    }
    window.__ytDocsModel = name;
    if (typeof window.__ytDocsShowSection === "function") {
      window.__ytDocsShowSection("docs-modelview");
    }
    document.querySelectorAll("[data-model-doc]").forEach(function (a) {
      a.classList.toggle("is-on", a.getAttribute("data-model-doc") === name);
    });
    /* 一级「模型列表」项让位给具体模型，避免同时亮两行 */
    document.querySelectorAll('.docs-toc-link[href="#docs-models"]:not(.docs-toc-model)').forEach(function (a) {
      a.classList.remove("is-section-on");
    });
      setTimeout(function () {
      try { history.replaceState(history.state, "", HASH_PREFIX + slug(name)); } catch (_) { /* 忽略 */ }
      }, 0);
    }

  /** 按 hash 片段选模型（地址栏手动改 hash 时用）。命中返回 true。 */
  window.__ytDocsSelectModelBySlug = function (frag) {
    if (!cache) return false;
    for (var i = 0; i < cache.length; i++) {
      if (slug(cache[i].model) !== frag) continue;
      if (typeof window.__ytDocsTree === "function") window.__ytDocsTree(true);
      var link = document.querySelector('[data-model-doc="' + cache[i].model.replace(/"/g, "") + '"]');
      var brandWrap = link && link.closest(".docs-toc-brand");
      if (brandWrap) {
        var sub = brandWrap.querySelector(".docs-toc-brand-list");
        if (sub) sub.hidden = false;
        brandWrap.classList.add("is-open");
        var btn = brandWrap.querySelector("[data-brand-toggle]");
        if (btn) btn.setAttribute("aria-expanded", "true");
      }
      select(cache[i].model);
      return true;
    }
    return false;
  };

  /* 委托绑 document：PJAX 换页免重绑 */
  document.addEventListener("click", function (e) {
    /* 「本页目录」跳小节：手算 .shell-main 的 scrollTop，不用锚点（锚点会把
       可分享的 #docs-model-<名> 覆盖成 #mc-xxx，刷新后就找不到这个模型了）。 */
    var jump = e.target.closest ? e.target.closest("[data-mc-jump]") : null;
    if (jump) {
      var target = document.getElementById(jump.getAttribute("data-mc-jump"));
      var sc = window.__ytDocsScroller && window.__ytDocsScroller();
      if (target && sc) {
        var delta = target.getBoundingClientRect().top - sc.getBoundingClientRect().top;
        sc.scrollTo({ top: sc.scrollTop + delta - 12, behavior: "smooth" });
      }
      return;
    }
    var toggle = e.target.closest ? e.target.closest("[data-brand-toggle]") : null;
    if (toggle) {
      var wrap = toggle.parentNode;
      var list = wrap.querySelector(".docs-toc-brand-list");
      if (!list) return;
      var open = list.hidden;
      list.hidden = !open;
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      wrap.classList.toggle("is-open", open);
      return;
    }
    var link = e.target.closest ? e.target.closest("[data-model-doc]") : null;
    if (link) select(link.getAttribute("data-model-doc"));
  });

  /** 渲染目录树；只有 hash 直达或用户正在看某张卡时才填卡片，绝不预选第一项。 */
  function paint(tree, box, list) {
    renderPriceTable(list);
    if (!list.length) {
      tree.innerHTML = '<div class="docs-toc-tree-hint">暂无可用模型</div>';
      box.innerHTML = '<p class="docs-hint">暂无可用模型，请稍后再试或 <a href="' + window.ytKefuUrl({}) + '" data-kefu="" target="_blank" rel="noopener">联系在线客服</a>。</p>';
      return;
    }
    renderTree(tree, groupByBrand(list));

    var want = "";
    if (location.hash.indexOf(HASH_PREFIX) === 0) {
      var frag = location.hash.slice(HASH_PREFIX.length);
      for (var i = 0; i < list.length; i++) {
        if (slug(list[i].model) === frag) { want = list[i].model; break; }
      }
    }
    /* 已经在看某个模型（静默回源）就保持那张卡，别把用户正在读的换掉。 */
    var keep = window.__ytDocsModel;
    if (!want && keep) {
      for (var j = 0; j < list.length; j++) {
        if (list[j].model === keep) { want = keep; break; }
      }
    }
    if (!want) {
      /* 没选模型：目录画好即可。点「模型列表」看的是接口文档，不预塞一张卡。 */
      if (!keep) {
        box.innerHTML = '<p class="docs-hint">在左侧目录选择一个模型查看资料卡。</p>';
      }
      return;
    }

    var viewingCard =
      typeof window.__ytDocsSection === "function" &&
      window.__ytDocsSection() === "docs-modelview";
    var fromHash = location.hash.indexOf(HASH_PREFIX) === 0;
    select(want, { silent: !!keep && viewingCard });

    /* hash 直达某模型才强制展开外层树；静默回源时不动，免得把用户刚收起的目录又撑开 */
    if (fromHash && typeof window.__ytDocsTree === "function") window.__ytDocsTree(true);
    var link = document.querySelector('[data-model-doc="' + want.replace(/"/g, "") + '"]');
    var brandWrap = link && link.closest(".docs-toc-brand");
    if (brandWrap) {
      var sub = brandWrap.querySelector(".docs-toc-brand-list");
      if (sub) sub.hidden = false;
      brandWrap.classList.add("is-open");
      var btn = brandWrap.querySelector("[data-brand-toggle]");
      if (btn) btn.setAttribute("aria-expanded", "true");
    }
    if (viewingCard || fromHash) {
      document.querySelectorAll("[data-model-doc]").forEach(function (a) {
        a.classList.toggle("is-on", a.getAttribute("data-model-doc") === want);
      });
    }
  }

  window.__ytInits.push(function initDocsModels() {
    var tree = document.querySelector("[data-model-tree]");
    var box = document.querySelector("[data-modelcard]");
    if (!tree || !box) return;

    /* ① 有缓存就先画出来 —— 这一步是同步的，用户看不到「加载中」。 */
    var cached = readCache();
    var cachedRev = -1;
    if (cached) {
      cachedRev = Number(cached.revision) || 0;
      cache = usable(cached.prices);
      paint(tree, box, cache);
    }
    /* ② 没缓存、版本对不上、或距上次核对超过 10 分钟，才静默回源。
       后台上下架会自增 revision，对上了就只更新 checkedAt，页面零闪动。 */
    if (needsRevalidate(cached)) {
      revalidate(cachedRev, function (fresh) {
        paint(tree, box, fresh);
      });
    }
    /* ③ 没缓存时上面那次回源就是首屏数据源，给个占位别空着。 */
    if (!cached) {
      tree.innerHTML = '<div class="docs-toc-tree-hint">加载中…</div>';
    }
  });
})();

/* API 文档 · Cursor 面板「展开全部模型」：列出本 Key 可用的全部模型及其 Cursor 专属名。
   点开才请求（不点零开销），结果缓存在内存，按厂商分组。
   别名规则须与后端 model-guard 的 canon() 兼容 —— canon 会抹掉所有非字母数字字符，
   因此在厂商词/Opus 后插连字符、把点号换成连字符，归一后与原名完全一致。 */
(function () {
  "use strict";
  /* 厂商词：命中则在首字母后插连字符，使名字里不再有连续的 claude/gpt…，避开 Cursor 的厂商路由 */
  var VENDOR_RE = /^(claude|gpt|gemini|grok|kimi|glm|qwen|deepseek|llama|composer|moonshot|doubao|mistral|minimax|hunyuan|ernie|yi|step|baichuan)/i;
  var cache = null;

  function splitHead(word) {
    return word.charAt(0) + "-" + word.slice(1);
  }

  function cursorAlias(name) {
    var s = String(name || "");
    var hit = VENDOR_RE.test(s);
    s = s.replace(VENDOR_RE, splitHead);
    /* Opus 单独拆：实测 Cursor 对该词同样敏感 */
    s = s.replace(/Opus/gi, splitHead);
    /* o3 / o4-mini 这类没有厂商词的，同样会撞 Cursor 内置名 → 一律拆首字母兜底
       （canon 抹掉连字符，o-3 与 o3 等价，不影响识别） */
    if (!hit && s.length > 1) s = splitHead(s);
    return s.replace(/\./g, "-");
  }

  function vendorOf(name) {
    var m = String(name || "").match(VENDOR_RE);
    if (m) return m[1].toUpperCase();
    if (/^o\d/i.test(name)) return "O 系列";
    return "其他";
  }

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function render(box, models) {
    var groups = {};
    models.forEach(function (m) {
      var v = vendorOf(m);
      (groups[v] = groups[v] || []).push(m);
    });
    var names = Object.keys(groups).sort(function (a, b) {
      if (a === "其他") return 1;
      if (b === "其他") return -1;
      return groups[b].length - groups[a].length;
    });
    var html = "";
    names.forEach(function (v) {
      html += '<div class="docs-alias-group">' + esc(v) + " · " + groups[v].length + " 个</div>";
      html += '<table class="docs-table docs-alias-tbl"><tbody>';
      groups[v].forEach(function (m) {
        var a = cursorAlias(m);
        html +=
          "<tr><td><code>" + esc(m) + "</code></td>" +
          '<td><code class="docs-copyable">' + esc(a) + "</code></td>" +
          '<td><button type="button" class="copy-btn copy-mini" data-copy="' + esc(a) + '">复制</button></td></tr>';
      });
      html += "</tbody></table>";
    });
    box.innerHTML = html
      ? '<p class="docs-hint">以下为当前<b>可用</b>的 ' + models.length +
        " 个模型（不可用的已自动隐藏，无需填写）。</p>" + html
      : '<p class="docs-hint">暂无可用模型，请稍后再试或 <a href="' + window.ytKefuUrl({}) + '" data-kefu="" target="_blank" rel="noopener">联系在线客服</a>。</p>';
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-alias-expand]") : null;
    if (!btn) return;
    var wrap = btn.parentElement;
    var box = wrap ? wrap.querySelector("[data-alias-all]") : null;
    if (!box) return;

    if (!box.hidden) {
      box.hidden = true;
      btn.textContent = "展开全部模型 ▾";
      return;
    }
    if (cache) {
      render(box, cache);
      box.hidden = false;
      btn.textContent = "收起 ▴";
      return;
    }
    btn.disabled = true;
    btn.textContent = "加载中…";
    fetch("/?ajax=model_prices", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.prices) throw new Error("bad");
        /* 只列**当前可用**的模型：available===false 的调用会直接报 [E2003]，
           列出来只会让用户白填一遍。缺省无该字段时视为可用（与价格表弹窗同口径）。 */
        cache = d.prices
          .filter(function (p) { return p && p.model && p.available !== false; })
          .map(function (p) { return p.model; });
        render(box, cache);
        box.hidden = false;
        btn.textContent = "收起 ▴";
      })
      .catch(function () {
        box.innerHTML = '<p class="docs-hint">模型列表加载失败，请稍后重试。</p>';
        box.hidden = false;
        btn.textContent = "展开全部模型 ▾";
      })
      .finally(function () { btn.disabled = false; });
  });
})();


/* ══ 邀请有奖（2026-08-18）══════════════════════════════════════════
   页面：/?page=invite。这里管四件事：
     ① 码列表 / 已邀用户列表惰性加载（首屏概览由 PHP 直出，不等 ajax）
     ② 生成 / 作废邀请码（局部刷新，不整页跳转）
     ③ 海报弹窗自动弹一次 + 「今日不再提示」（localStorage 存日期戳）
     ④ 邀请码直登后强制设置账号密码（弹窗不可关，改完刷新）
   所有写操作走 index.php 的 action 分发，带 CSRF 隐藏字段。 */
window.__ytInits.push(function initInvitePage() {
  "use strict";
  /* 进度条宽度用 JS 设：CSP `style-src 'self'` 会拦掉内联 style 属性，
     但程序化改 CSSOM（el.style.width）不受该指令限制 —— 与站内 initQuotaBars 同一套做法。 */
  document.querySelectorAll(".invite-progress-bar[data-invite-pct]").forEach(function (bar) {
    var i = bar.querySelector("span");
    if (!i || i.dataset.ytBound) return;
    i.dataset.ytBound = "1";
    var pct = parseFloat(bar.getAttribute("data-invite-pct") || "0") || 0;
    i.style.width = Math.max(0, Math.min(100, pct)) + "%";
  });

  var codesTable = document.getElementById("inviteCodesTable");
  var inviteesTable = document.getElementById("inviteInviteesTable");
  var genForm = document.getElementById("inviteGenForm");
  if (!codesTable && !inviteesTable && !genForm) return; // 不在邀请页

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }
  function fmtNum(n) {
    var x = Number(n) || 0;
    return Math.round(x * 10000) / 10000;
  }
  var STATUS = {
    active: '<span class="badge badge-green">未使用</span>',
    used: '<span class="badge badge-purple">已使用</span>',
    revoked: '<span class="badge">已作废</span>',
  };

  /* ── ① 码列表 ── */
  function renderCodes(rows) {
    var tb = codesTable && codesTable.querySelector("tbody");
    var sub = document.getElementById("inviteCodesSub");
    if (!tb) return;
    if (!rows.length) {
      tb.innerHTML = '<tr><td colspan="6" class="table-empty">还没有邀请码，先在上方生成一个</td></tr>';
      if (sub) sub.textContent = "共 0 张";
      return;
    }
    var active = 0;
    tb.innerHTML = rows
      .map(function (r) {
        if (r.status === "active") active++;
        var used = r.used_by_username ? esc(r.used_by_username) : "—";
        var canRevoke = r.status === "active";
        return (
          "<tr>" +
          '<td><span class="mono code-cell">' + esc(r.code) + "</span>" +
          ' <button type="button" class="copy-btn" data-copy="' + esc(r.code) + '">复制</button></td>' +
          "<td>" + (Number(r.quota) > 0 ? fmtNum(r.quota) + " 积分" : "不送积分") + "</td>" +
          "<td>" + (STATUS[r.status] || esc(r.status)) + "</td>" +
          "<td>" + used + (r.used_at ? ' <span class="invite-dim">' + esc(window.ytFmtCst ? window.ytFmtCst(r.used_at) : r.used_at) + "</span>" : "") + "</td>" +
          "<td>" + esc(window.ytFmtCst ? window.ytFmtCst(r.created_at) : r.created_at) + "</td>" +
          "<td>" +
          (canRevoke
            ? '<button type="button" class="invite-revoke" data-revoke="' + esc(r.code) + '">作废</button>'
            : "—") +
          "</td></tr>"
        );
      })
      .join("");
    if (sub) sub.textContent = "共 " + rows.length + " 张 · 未使用 " + active + " 张";
  }

  function loadCodes() {
    if (!codesTable) return;
    fetch("/?ajax=invite_codes", { credentials: "same-origin", headers: { "X-Requested-With": "fetch" } })
      .then(function (r) { return r.json(); })
      .then(function (d) { renderCodes((d && d.codes) || []); })
      .catch(function () {
        var tb = codesTable.querySelector("tbody");
        if (tb) tb.innerHTML = '<tr><td colspan="6" class="table-empty">加载失败，请刷新重试</td></tr>';
      });
  }

  /* ── 已邀用户列表 ── */
  function loadInvitees() {
    if (!inviteesTable) return;
    fetch("/?ajax=invite_invitees", { credentials: "same-origin", headers: { "X-Requested-With": "fetch" } })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var rows = (d && d.invitees) || [];
        var tb = inviteesTable.querySelector("tbody");
        var sub = document.getElementById("inviteInviteesSub");
        if (!tb) return;
        if (!rows.length) {
          tb.innerHTML = '<tr><td colspan="5" class="table-empty">还没有好友通过你的邀请码加入</td></tr>';
          if (sub) sub.textContent = "共 0 人";
          return;
        }
        var paid = 0;
        tb.innerHTML = rows
          .map(function (r) {
            if (Number(r.recharge_count) > 0) paid++;
            return (
              "<tr><td>" + esc(r.username) + "</td>" +
              "<td>" + esc(window.ytFmtCst ? window.ytFmtCst(r.created_at) : r.created_at) + "</td>" +
              "<td>¥" + fmtNum(r.recharged_yuan) + "</td>" +
              "<td>" + (Number(r.recharge_count) || 0) + "</td>" +
              "<td>" + (Number(r.gift) > 0 ? fmtNum(r.gift) + " 积分" : "—") + "</td></tr>"
            );
          })
          .join("");
        if (sub) sub.textContent = "共 " + rows.length + " 人 · 已充值 " + paid + " 人";
      })
      .catch(function () {
        var tb = inviteesTable.querySelector("tbody");
        if (tb) tb.innerHTML = '<tr><td colspan="5" class="table-empty">加载失败，请刷新重试</td></tr>';
      });
  }

  loadCodes();
  loadInvitees();

  /* ── ② 生成邀请码 ── */
  if (genForm && !genForm.dataset.ytBound) {
    genForm.dataset.ytBound = "1";
    genForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = genForm.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = "生成中…"; }
      fetch("/", {
        method: "POST",
        body: new FormData(genForm),
        headers: { "X-Requested-With": "fetch" },
        credentials: "same-origin",
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok && d.code) {
            if (window.ytToast) window.ytToast("邀请码已生成：" + d.code.code);
            genForm.reset();
            loadCodes();
            // 额度池变了，概览需要重取 → 软刷新主区（不整页闪白）
            if (window.ytSoftNavigate) window.ytSoftNavigate("/?page=invite");
          } else if (window.ytToast) {
            window.ytToast((d && d.error) || "生成失败", "err");
          }
        })
        .catch(function () { if (window.ytToast) window.ytToast("网络异常，请稍后重试", "err"); })
        .finally(function () {
          if (btn) { btn.disabled = false; btn.textContent = "生成邀请码"; }
        });
    });
  }

  /* ── 作废邀请码（委托绑在表格上，重渲染后依然有效）── */
  if (codesTable && !codesTable.dataset.ytRevokeBound) {
    codesTable.dataset.ytRevokeBound = "1";
    codesTable.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-revoke]");
      if (!btn) return;
      var code = btn.getAttribute("data-revoke");
      if (!code) return;
      if (!window.confirm("作废邀请码 " + code + "？\n额度会退回你的可用邀请额度。")) return;
      var fd = new FormData();
      fd.append("csrf", codesTable.getAttribute("data-csrf") || "");
      fd.append("action", "invite_revoke_code");
      fd.append("code", code);
      btn.disabled = true;
      fetch("/", { method: "POST", body: fd, headers: { "X-Requested-With": "fetch" }, credentials: "same-origin" })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok) {
            if (window.ytToast) window.ytToast("已作废，额度已退回");
            loadCodes();
            if (window.ytSoftNavigate) window.ytSoftNavigate("/?page=invite");
          } else if (window.ytToast) {
            window.ytToast((d && d.error) || "作废失败", "err");
            btn.disabled = false;
          }
        })
        .catch(function () {
          if (window.ytToast) window.ytToast("网络异常，请稍后重试", "err");
          btn.disabled = false;
        });
    });
  }

  /* ── ③ 海报弹窗：每天最多自动弹一次 ── */
  var poster = document.getElementById("invitePosterDialog");
  if (poster && !poster.dataset.ytAutoBound) {
    poster.dataset.ytAutoBound = "1";
    /*
     * 必须按账号分键：同一浏览器会切换多个用户。旧实现用一个全局键，
     * 任一账号勾「今日不再提示」后，其他账号（尤其自然注册的新用户）当天也不弹。
     * 不迁移旧全局键 —— 无法判断它属于哪个账号，迁移反而会继续误伤。
     */
    var posterUser = poster.getAttribute("data-poster-user") || "anonymous";
    var MUTE_KEY = "yt_invite_poster_muted_on:" + posterUser; // 值存 YYYY-MM-DD
    function today() {
      var d = new Date();
      return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    }
    var muted = false;
    try { muted = localStorage.getItem(MUTE_KEY) === today(); } catch (_) { /* 隐私模式忽略 */ }
    // 强制改账密的弹窗优先级更高，此时不弹海报
    var mustReset = !!document.getElementById("inviteResetDialog");
    if (!muted && !mustReset && typeof poster.showModal === "function") {
      try { poster.showModal(); } catch (_) { /* 已打开则忽略 */ }
    }
    var mute = document.getElementById("invitePosterMute");
    if (mute) {
      mute.addEventListener("change", function () {
        try {
          if (mute.checked) localStorage.setItem(MUTE_KEY, today());
          else localStorage.removeItem(MUTE_KEY);
        } catch (_) { /* 忽略 */ }
      });
    }
  }

});


/* 登录页：账号密码 / 邀请码 两种方式切换（纯前端显隐，两个 form 各自带 Turnstile widget）。 */
window.__ytInits.push(function initAuthTabs() {
  "use strict";
  var tabs = document.querySelectorAll("[data-auth-tab]");
  if (!tabs.length) return;
  var panes = document.querySelectorAll("[data-auth-pane]");
  tabs.forEach(function (tab) {
    if (tab.dataset.ytBound) return;
    tab.dataset.ytBound = "1";
    tab.addEventListener("click", function () {
      var want = tab.getAttribute("data-auth-tab");
      tabs.forEach(function (t) { t.classList.toggle("is-active", t === tab); });
      panes.forEach(function (p) {
        var on = p.getAttribute("data-auth-pane") === want;
        p.hidden = !on;
        if (on) {
          var first = p.querySelector("input:not([type=hidden])");
          if (first) first.focus();
        }
      });
    });
  });
});


/* ══ Turnstile 提交闸门（2026-08-19）═════════════════════════════════
   人机验证没过之前禁用提交按钮 —— 否则用户在控件转圈时就点登录，只会白拿一句
   「请先完成人机验证」，以为是系统坏了。

   回调名写在 HTML 的 data-callback / data-expired-callback / data-error-callback 上，
   由 CF 脚本调用，所以必须挂在 window 上（隐式渲染只认全局函数名）。
   一个页面有多个 widget（密码登录 / 邀请码登录各一个），回调不带 widget 标识，
   因此靠「哪个表单的 cf-turnstile-response 有值」反查归属。

   ⚠ 兜底很重要：CF 脚本被墙/超时/域名白名单没配时回调永远不来，
   按钮若一直灰着 = 用户彻底登不进去。所以 8 秒没就绪就解禁按钮放行，
   让请求打到后端由它裁决（软启用会放行；强制模式会给出明确报错，
   总比一个点不动的灰按钮好）。 */
(function () {
  "use strict";
  var READY_TIMEOUT_MS = 8000;

  function guards() {
    return Array.prototype.slice.call(document.querySelectorAll("[data-cf-guard]"));
  }
  /** 找出令牌已就绪的那个表单（CF 会把 token 写进所在 form 的隐藏域）。 */
  function formWithToken() {
    var inputs = document.querySelectorAll('input[name="cf-turnstile-response"]');
    for (var i = 0; i < inputs.length; i++) {
      if (inputs[i].value) return inputs[i].closest("form");
    }
    return null;
  }
  function setGuard(btn, enabled, text) {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.textContent = text || btn.getAttribute("data-cf-label") || btn.textContent;
    btn.classList.toggle("is-cf-wait", !enabled);
  }
  function enableIn(form) {
    if (!form) return;
    var btn = form.querySelector("[data-cf-guard]");
    setGuard(btn, true, btn && btn.getAttribute("data-cf-label"));
  }

  window.ytCfDone = function () {
    // 通过的那一个解禁；拿不到归属时（极少数）索性全部解禁，宁松不锁死
    var form = formWithToken();
    if (form) enableIn(form);
    else guards().forEach(function (b) { setGuard(b, true, b.getAttribute("data-cf-label")); });
  };
  window.ytCfExpired = function () {
    // 令牌 5 分钟过期：重新禁用并提示，CF 会自己刷新控件
    guards().forEach(function (b) {
      var form = b.closest("form");
      var input = form && form.querySelector('input[name="cf-turnstile-response"]');
      if (!input || !input.value) setGuard(b, false, "验证已过期，请重新验证");
    });
  };
  window.ytCfError = function () {
    // 控件自身出错（网络/配置）：解禁并提示，别把用户堵死在登录页
    guards().forEach(function (b) { setGuard(b, true, b.getAttribute("data-cf-label")); });
    if (window.ytToast) window.ytToast("人机验证加载异常，如提交失败请刷新页面重试", "err");
  };

  // 兜底：CF 迟迟没回调就放行（脚本被拦、网络不通、sitekey 域名没配都会这样）
  if (guards().length) {
    setTimeout(function () {
      var pending = guards().filter(function (b) { return b.disabled; });
      if (!pending.length) return;
      pending.forEach(function (b) { setGuard(b, true, b.getAttribute("data-cf-label")); });
      console.warn("[auth] Turnstile 未在 " + READY_TIMEOUT_MS + "ms 内就绪，已放行提交按钮（由后端裁决）");
    }, READY_TIMEOUT_MS);
  }
})();


/* ══ 强制设置账号密码（邀请码直登，2026-08-19 改为全局）══════════════════
   弹窗挂在骨架里（views/_chrome.php），所以这段不能再依赖邀请页的元素 ——
   码直登的落地页已改成充值页，只在邀请页初始化就会整个漏掉。
   优先级最高：账密没设好之前不弹首充海报（见 initGiftPoster）。 */
window.__ytInits.push(function initForcedReset() {
  "use strict";

  var resetDlg = document.getElementById("inviteResetDialog");
  var resetForm = document.getElementById("inviteResetForm");
  if (resetDlg && resetForm && !resetForm.dataset.ytBound) {
    resetForm.dataset.ytBound = "1";
    if (typeof resetDlg.showModal === "function") {
      try { resetDlg.showModal(); } catch (_) { /* 忽略 */ }
    }
    // 不允许 ESC / 点遮罩关掉：必须设置完才能用
    resetDlg.addEventListener("cancel", function (e) { e.preventDefault(); });
    /* 错误常驻在弹窗里（不用 toast）：toast 3.5 秒就消失，用户看不见就以为设置成功了，
       结果下次进页面又被强制弹窗 —— 这正是"填完还一直弹"的真实原因（2026-08-19 修）。 */
    /* 统一走全局 ytFormError（错误条元素同时带 data-reset-err 与 data-form-err） */
    function showErr(msg) { window.ytFormError(resetForm, msg); }
    function clearErr() { window.ytFormErrorClear(resetForm); }
    /** 与后端同一套规则先在前端拦一遍，省掉一次白跑的往返。 */
    function localCheck(name, pw, pw2) {
      // 表单带 novalidate（原生校验会抢在 submit 之前拦截），空值也要自己提示
      if (!name) return "请输入新用户名";
      if (!pw || !pw2) return "请输入并确认新密码";
      if (!/^[a-z0-9_]{3,32}$/.test(name)) {
        return "用户名需 3-32 位，且只能包含小写字母、数字、下划线";
      }
      if (!/^(?=.*[A-Za-z])(?=.*\d)\S{6,12}$/.test(pw)) {
        return "密码需 6-12 位，且必须同时包含字母和数字";
      }
      if (pw !== pw2) return "两次输入的密码不一致";
      return "";
    }
    resetForm.addEventListener("input", clearErr);
    resetForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var btn = resetForm.querySelector('button[type="submit"]');
      var nameInput = resetForm.querySelector('[name="username"]');
      // 大写自动转小写：后端 normalizeUsername 也会转，先在界面上转掉，用户看到的就是最终账号
      nameInput.value = nameInput.value.trim().toLowerCase();
      var name = nameInput.value;
      var pw = resetForm.querySelector('[name="password"]').value;
      var pw2 = resetForm.querySelector('[name="password_confirm"]').value;
      var bad = localCheck(name, pw, pw2);
      if (bad) { showErr(bad); return; }
      clearErr();
      if (btn) { btn.disabled = true; btn.textContent = "保存中…"; }
      fetch("/", {
        method: "POST",
        body: new FormData(resetForm),
        headers: { "X-Requested-With": "fetch" },
        credentials: "same-origin",
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok) {
            if (window.ytToast) window.ytToast("账号已设置，请记好新的用户名和密码");
            setTimeout(function () { window.location.href = "/?page=recharge"; }, 900);
          } else {
            showErr((d && d.error) || "设置失败，请检查填写内容");
            if (btn) { btn.disabled = false; btn.textContent = "保存并开始使用"; }
          }
        })
        .catch(function () {
          showErr("网络异常，请稍后重试");
          if (btn) { btn.disabled = false; btn.textContent = "保存并开始使用"; }
        });
    });
  }
});

/* ══ 首充礼包海报（2026-08-19）══════════════════════════════════════════
   只对「被邀请进来 且 未首充 且 账密已设好」的用户弹（渲染条件在 _chrome.php）。
   频次：**每次登录弹一次** —— 用 sessionStorage 记，关掉标签页/重新登录会再弹，
   同一次会话内切页不重复弹（既满足"每次登录都提醒"，又不会在充值页反复打扰）。
   首充到账后 lifetime_recharged_yuan > 0，服务端就不再渲染这个弹窗了。 */
window.__ytInits.push(function initGiftPoster() {
  "use strict";
  var dlg = document.getElementById("giftPosterDialog");
  if (!dlg || dlg.dataset.ytBound) return;
  dlg.dataset.ytBound = "1";
  // 强制改账密优先：那个弹窗还在就先不弹海报，等它改完跳转后再弹
  if (document.getElementById("inviteResetDialog")) return;
  var KEY = "yt_gift_poster_shown";
  // ?gift=1（左下角礼包浮标带的参数）= 用户主动点了礼包，必须弹，忽略"本会话已弹过"
  var forced = new URLSearchParams(location.search).get("gift") === "1";
  var shown = false;
  try { shown = sessionStorage.getItem(KEY) === "1"; } catch (_) { /* 隐私模式忽略 */ }
  if (shown && !forced) return;
  try { sessionStorage.setItem(KEY, "1"); } catch (_) { /* 忽略 */ }
  if (typeof dlg.showModal === "function") {
    try { dlg.showModal(); } catch (_) { /* 已打开则忽略 */ }
  }
  // 「立即充值」：已经在充值页就只关弹窗，不做无意义的整页跳转
  var onRecharge = location.search.indexOf("page=recharge") >= 0;
  var go = dlg.querySelector("[data-gift-go]");
  if (go) {
    go.addEventListener("click", function (e) {
      if (onRecharge) {
        e.preventDefault();
        dlg.close();
      }
    });
  }
  // 「充值 300 元」：同页时关弹窗 + 直接点开 300 那张卡并滚到付款区
  var pick = dlg.querySelector("[data-gift-pick]");
  if (pick && onRecharge) {
    pick.addEventListener("click", function (e) {
      e.preventDefault();
      dlg.close();
      var amt = pick.getAttribute("data-gift-pick");
      var cell = document.querySelector('.amount-cell[data-amount="' + amt + '"]');
      if (!cell) return;
      cell.click();
      setTimeout(function () {
        var panel = document.getElementById("pay-panel");
        (panel && !panel.hidden ? panel : cell).scrollIntoView({ behavior: "smooth", block: "center" });
      }, 120);
    });
  }
});


/* ══ 订阅页（2026-08-20）════════════════════════════════════════════════
   订阅买的是「按次计量的专属 Key」：每次调用恒扣 1 次，与模型贵贱无关，
   也不动钱包积分（口径见后端 auth/user-subscription-plans.ts）。
   本模块负责：我的订阅列表 + 付款弹窗 + 开通轮询。
   付款轮询文案与充值页同一套口径：**只显示一句 + 读秒**，超时提示订单号有误。 */
/* 续费提醒条：控制台 + 订阅页共用。纯前端按 expires_at 算天数，≤3 天才显示。 */
window.__ytInits.push(function initRenewTipGlobal() {
  "use strict";
  var tip = document.getElementById("sub-renew-tip");
  var page = (document.body && document.body.getAttribute("data-page")) || "";
  /* 订阅页由 initSubscription 自己渲染（那边本来就要拉订阅列表，别重复请求） */
  if (!tip || page !== "console") return;
  if (tip.dataset.ytBound === "1") return;
  tip.dataset.ytBound = "1";
  fetch("/?ajax=subscriptions", { credentials: "same-origin", cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var list = (d && d.subscriptions) || [];
      var soonest = null;
      list.forEach(function (s) {
        if (s.status !== "active" || !s.expires_at) return;
        var ms = Date.parse(s.expires_at);
        if (!isFinite(ms) || ms <= Date.now()) return;
        if (!soonest || ms < soonest.ms) soonest = { ms: ms, name: s.plan_name };
      });
      if (!soonest) return;
      var days = Math.ceil((soonest.ms - Date.now()) / 86400000);
      if (days > 3) return;
      tip.hidden = false;
      tip.innerHTML =
        "订阅「<b>" + String(soonest.name).replace(/[&<>"']/g, "") + "</b>」" +
        (days <= 0 ? "<b>今天到期</b>" : "还有 <b>" + days + " 天</b>到期") +
        '，<a href="/?page=subscription">立即续费</a>后原密钥自动延期并累加次数。';
    })
    .catch(function () { /* 提醒条属增强，失败静默 */ });
});

window.__ytInits.push(function initSubscription() {
  "use strict";
  var grid = document.getElementById("sub-grid");
  var mine0 = document.getElementById("sub-mine");
  if (!grid && !mine0) return; // 不在订阅页

  /* ⚠ 守卫必须挂在**页面内**的元素上。
     `applyHtml` 只替换 `.shell-main` 的 innerHTML、元素本身跨 PJAX 存活 ——
     把标记挂在它上面会让第二次进本页时整个初始化被 return 掉
     （2026-08-21 实测：分类 tab 点不动、付款与兑换弹窗全哑、我的订阅不刷新）。
     挂在每次都会被重建的 #sub-grid / #sub-mine 上，PJAX 后自然重新初始化。 */
  var anchor = grid || mine0;
  if (anchor.dataset.ytSubBound === "1") return;
  anchor.dataset.ytSubBound = "1";

  /* document 级委托**全局只绑一次**：本函数每次进本页都会重跑（守卫挂在页面元素上），
     若每次都往 document 上加监听器，点一次会触发 N 次（发起 N 个开通请求）。
     故第二次之后 onDoc 变成空操作；已绑的那批监听器靠「实时查询 DOM」继续对新节点生效。 */
  var docBound = window.__ytSubDocBound === true;
  window.__ytSubDocBound = true;
  var onDoc = docBound
    ? function () { /* 已绑过，忽略 */ }
    : function (type, fn) { document.addEventListener(type, fn); };

  /* 下面这些 DOM 一律**实时查询**（不缓存引用）：document 级委托全局只绑一次，
     若捕获本次闭包里的元素，PJAX 换页后操作的就是已被丢弃的旧节点。 */
  var dlgEl = function () { return document.getElementById("sub-pay-dialog"); };
  var statusElOf = function () { return document.getElementById("sub-pay-status"); };
  var mineEl = function () { return document.getElementById("sub-mine"); };
  var retryTimer = null;
  var tickTimer = null;
  var waitStartAt = 0;
  var attempts = 0;
  var FAST_MAX = 4;
  var BG_INTERVAL = 12000;
  var WAIT_WINDOW = 3 * 60000;
  var BAD_ORDER_MSG = "该订单号有误，请确认为支付订单号后 6 位，请勿填写商家订单号后 6 位";

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  function fmtNum(n) {
    return n == null ? "不限" : Number(n).toLocaleString("zh-CN");
  }
  /* 与「我的 Key」同一种打码：前 6 + ****** + 后 6 */
  function maskKey(k) {
    k = String(k || "");
    return k.length <= 12 ? k.slice(0, 3) + "******" : k.slice(0, 6) + "******" + k.slice(-6);
  }
  function setStatus(text, kind) {
    var el = statusElOf();
    if (!el) return;
    el.hidden = !text;
    el.textContent = text;
    el.className = "pay-status" + (kind ? " is-" + kind : "");
    if (kind === "err" && window.ytKefuDecorate) window.ytKefuDecorate(el, text, { msg: "订阅付款遇到问题：" + text });
  }
  /* 只清轮询定时器（排队去重用）；读秒要单独停，否则文案会卡在「已等待 0 秒」 */
  function stopPolling() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  }
  function stopTick() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  }
  function stopAll() { stopPolling(); stopTick(); }
  function waitedSec() {
    return waitStartAt ? Math.max(0, Math.round((Date.now() - waitStartAt) / 1000)) : 0;
  }
  function showWaiting() {
    setStatus(
      "正在开通，请稍后.....（已等待 " + waitedSec() + " 秒，预计 1-3 分钟内完成，请勿离开页面！）",
      "wait",
    );
  }
  function startTick() {
    stopTick();
    showWaiting();
    tickTimer = setInterval(function () {
      /* 弹窗被 PJAX 换掉后自动收尾，别留一个永远跑的读秒 */
      var el = statusElOf();
      if (!el || !el.isConnected) { stopAll(); return; }
      showWaiting();
    }, 1000);
  }

  /* ── 我的订阅（表格） ── */
  function renderMine(list) {
    var mine = mineEl();
    var body = document.getElementById("sub-mine-body");
    var emptyTip = document.getElementById("sub-mine-empty");
    var tableWrap = document.getElementById("sub-mine-table");
    if (!mine || !body) return;
    /* 板块常驻可见：没订阅时显示空状态而不是整块藏起来（藏起来用户会以为板块丢了） */
    if (!list || !list.length) {
      mine.hidden = false;
      if (emptyTip) emptyTip.hidden = false;
      if (tableWrap) tableWrap.hidden = true;
      renderRenewTip(null);
      return;
    }
    mine.hidden = false;
    if (emptyTip) emptyTip.hidden = true;
    if (tableWrap) tableWrap.hidden = false;
    var html = "";
    var soonest = null; // 最近到期且仍生效的那条 → 用于续费提醒
    list.forEach(function (s) {
      var expMs = s.expires_at ? Date.parse(s.expires_at) : NaN;
      var expired = isFinite(expMs) && expMs <= Date.now();
      var off = s.status !== "active";
      var live = !off && !expired;
      if (live && isFinite(expMs) && (!soonest || expMs < soonest.ms)) {
        soonest = { ms: expMs, name: s.plan_name };
      }
      var state = off ? '<span class="sub-state is-off">已停用</span>'
        : expired ? '<span class="sub-state is-off">已到期</span>'
        : '<span class="sub-state is-on">生效中</span>';
      /* 按次计量 ⇒ 这些数字直接是「次数」，不做任何换算 */
      var usedTxt = fmtNum(s.used) + " / " + fmtNum(s.total);
      var pct = s.total ? Math.min(100, Math.round((Number(s.used) / Number(s.total)) * 100)) : 0;
      html +=
        "<tr>" +
          "<td><b>" + esc(s.plan_name) + "</b>" +
            (s.period_label ? '<span class="sub-cell-sub">' + esc(s.period_label) + "</span>" : "") + "</td>" +
          "<td>" + state + "</td>" +
          '<td><div class="sub-cell-quota"><span>' + usedTxt + "</span>" +
            /* ⚠ 不能在 innerHTML 里写 style="width:…"：CSP `style-src 'self'` 会拦掉内联样式，
               进度条会一直是 0 宽。与全站其它进度条一致，改用 data-used-pct + 渲染后 JS 赋值。 */
            (s.total ? '<div class="quota-bar" data-used-pct="' + pct + '"><i></i></div>' : "") +
          "</div></td>" +
          "<td>" + fmtNum(s.limit_day) + "</td>" +
          "<td>" + fmtNum(s.limit_5h) + "</td>" +
          "<td>" + fmtNum(s.limit_month) + "</td>" +
          "<td>" + (s.max_concurrency ? fmtNum(s.max_concurrency) + " 路" : "不限") + "</td>" +
          "<td>" + esc(String(window.ytFmtCst(s.expires_at) || "—").slice(0, 10)) + "</td>" +
          '<td><div class="sub-cell-key">' +
            '<code class="sub-key-text">' + esc(s.key) + "</code>" +
            '<button type="button" class="copy-btn" data-copy="' + esc(s.key) + '">复制</button>' +
          "</div></td>" +
          /* 与「我的 Key」共用指南 / 配置到客户端弹窗；停用或到期的密钥不能配置 */
          '<td><div class="sub-ops">' +
            '<button type="button" class="op-btn" data-open-key-guide data-key-full="' + esc(s.key) + '">指南</button>' +
            '<button type="button" class="op-btn" data-open-client-setup data-key-id="' + esc(s.key_id) + '"' +
              ' data-key-name="' + esc(s.plan_name) + '" data-key-full="' + esc(s.key) + '"' +
              ' data-key-masked="' + esc(maskKey(s.key)) + '"' + (live ? "" : " disabled") + ">配置到客户端</button>" +
          "</div></td>" +
        "</tr>";
    });
    body.innerHTML = html;
    /* 渲染后统一设置进度条宽度（CSP 不允许内联 style），并按已用比例上色 */
    body.querySelectorAll(".quota-bar[data-used-pct]").forEach(function (bar) {
      var i = bar.querySelector("i");
      if (!i) return;
      var pct = Math.max(0, Math.min(100, parseFloat(bar.getAttribute("data-used-pct")) || 0));
      i.style.width = pct + "%";
      /* 与全站进度条同一套修饰类（双连字符），别自造 is-warn */
      bar.classList.toggle("quota-bar--warn", pct >= 80 && pct < 95);
      bar.classList.toggle("quota-bar--danger", pct >= 95);
    });
    renderRenewTip(soonest);
  }

  /**
   * 续费提醒条：仅当**最近到期的生效订阅** ≤3 天时显示。
   * 纯前端按 expires_at 算天数，零后端成本（订阅数据本来就要拉一次）。
   */
  function renderRenewTip(soonest) {
    var tip = document.getElementById("sub-renew-tip");
    if (!tip) return;
    if (!soonest) { tip.hidden = true; return; }
    var days = Math.ceil((soonest.ms - Date.now()) / 86400000);
    if (days > 3) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.innerHTML =
      "订阅「<b>" + esc(soonest.name) + "</b>」" +
      (days <= 0 ? "<b>今天到期</b>" : "还有 <b>" + days + " 天</b>到期") +
      "，续费后原密钥自动延期并累加次数，代码里不用改。";
  }

  function loadMine() {
    return fetch("/?ajax=subscriptions", { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) { renderMine(d && d.subscriptions); })
      .catch(function () { /* 静默：货架仍可用 */ });
  }
  loadMine();

  /* ── 分类 tab 切换（卡片左右滑入） ── */
  var tabsBox = document.getElementById("sub-tabs");
  var gridBox = document.getElementById("sub-grid");
  if (tabsBox && gridBox) {
    var order = Array.prototype.map.call(tabsBox.querySelectorAll("[data-sub-tab]"), function (b) {
      return b.getAttribute("data-sub-tab");
    });
    tabsBox.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-sub-tab]") : null;
      if (!btn) return;
      var next = btn.getAttribute("data-sub-tab") || "";
      var cur = gridBox.getAttribute("data-active-cat") || "";
      if (next === cur) return;
      /* 方向：目标在右边就整体从右侧滑入，反之从左 —— 让切换有位置感 */
      var dir = order.indexOf(next) > order.indexOf(cur) ? 1 : -1;
      gridBox.setAttribute("data-active-cat", next);
      tabsBox.querySelectorAll("[data-sub-tab]").forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
      });
      document.querySelectorAll("[data-cat-desc]").forEach(function (p) {
        p.hidden = p.getAttribute("data-cat-desc") !== next;
      });
      /* 先切换可见性，再播放入场动画（用 class 触发，避免 JS 逐帧计算） */
      gridBox.querySelectorAll("[data-sub-plan]").forEach(function (card) {
        var show = (card.getAttribute("data-category") || "") === next;
        card.classList.toggle("is-hidden-cat", !show);
        if (show) {
          card.classList.remove("slide-in-l", "slide-in-r");
          void card.offsetWidth; // 重启动画
          card.classList.add(dir > 0 ? "slide-in-r" : "slide-in-l");
        }
      });
    });
  }

  /* ── 可用模型弹窗 ── */
  onDoc("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-sub-models]") : null;
    if (!btn) return;
    var card = btn.closest("[data-sub-plan]");
    var dlg2 = document.getElementById("sub-models-dialog");
    if (!card || !dlg2) return;
    var list = [];
    try { list = JSON.parse(card.getAttribute("data-models") || "[]") || []; } catch (_) { list = []; }
    var name = card.getAttribute("data-name") || "该套餐";
    document.getElementById("sub-models-title").textContent = name + " · 可用模型";
    var hint = document.getElementById("sub-models-hint");
    var box = document.getElementById("sub-models-list");
    if (!list.length) {
      /* 空 = 不限制：给一块醒目说明，别让用户以为「没模型可用」 */
      hint.innerHTML =
        '<div class="sub-models-all">该套餐<b>不限制模型</b>，平台已上架的全部模型都可以调用' +
        '（模型清单见左侧「模型广场」）。</div>';
      box.hidden = true;
      box.innerHTML = "";
    } else {
      hint.innerHTML =
        '<p class="sub-models-count">该套餐仅可调用以下 <b>' + list.length +
        '</b> 个模型，调用范围外的模型会返回无权限。</p>';
      box.hidden = false;
      box.innerHTML = list.map(function (m) { return "<span>" + esc(m) + "</span>"; }).join("");
    }
    dlg2.showModal();
  });

  /* ── 付款弹窗 ── */
  onDoc("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-sub-buy]") : null;
    var dlg = dlgEl();
    if (!btn || !dlg) return;
    var card = btn.closest("[data-sub-plan]");
    if (!card) return;
    var planId = card.getAttribute("data-sub-plan") || "";
    var price = card.getAttribute("data-price") || "";
    var name = card.getAttribute("data-name") || "";
    var epayBox = window.ytEpay ? document.getElementById("epay-box") : null;
    /* 11-02 起：1 云猫 · 2 纪元 · 3 数合支付，只出这个套餐此刻能用的通道（收款码不再出） */
    var epayOk = !!epayBox && window.ytEpay.channels(epayBox, "sub:" + planId).length > 0;
    if (!epayOk) {
      if (window.ytToast) window.ytToast("该套餐暂未开放在线支付，请联系客服开通", "error");
      return;
    }
    stopAll();
    window.ytFormErrorClear("sub-pay-form");
    setStatus("", "");
    document.getElementById("sub-pay-plan").value = planId;
    document.getElementById("sub-pay-name").textContent = name;
    document.getElementById("sub-pay-price").textContent = price;
    document.getElementById("sub-pay-price2").textContent = price;
    var order = document.getElementById("sub-pay-order");
    if (order) order.value = "";
    var form = document.getElementById("sub-pay-form");
    if (form) form.hidden = true;
    window.ytEpay.show(epayBox, {
      key: "sub:" + planId,
      payload: { biz: "subscription", plan_id: planId },
      sum: price + " 元",
      desc: "，开通「" + name + "」",
      onDone: subEpayDone,
    });
    dlg.showModal();
  });

  /* 寄售通道到账：刷新「我的订阅」，留 1.5 秒看结果再关弹窗滚过去（与收款码的 onOpened 一致） */
  function subEpayDone(st) {
    if (window.ytToast) window.ytToast(st.message || "付款成功，订阅已开通");
    loadMine().then(function () {
      setTimeout(function () {
        var dlg = dlgEl();
        var mine = mineEl();
        try { if (dlg && dlg.open) dlg.close(); } catch (_) { /* ignore */ }
        if (mine && !mine.hidden) mine.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 1500);
    });
  }
  /* 从支付宝收银台跳回（?epay=订单号）：打开弹窗接着确认这一单（每次进本页都要跑，不走 onDoc） */
  (function subEpayResume() {
    var box = window.ytEpay ? document.getElementById("epay-box") : null;
    var dlg = dlgEl();
    if (!box || !dlg || !window.ytEpay.resume(box, { onDone: subEpayDone })) return;
    var nm = document.getElementById("sub-pay-name");
    if (nm) nm.textContent = "· 付款结果";
    var f = document.getElementById("sub-pay-form");
    if (f) f.hidden = true;
    try { if (!dlg.open) dlg.showModal(); } catch (_) { /* ignore */ }
  })();

  function onOpened(d) {
    stopAll();
    var extended = d.mode === "extended";
    setStatus(
      (extended ? "续期成功！已延长有效期并累加次数。" : "开通成功！专属密钥已生成。") +
        "总次数 " + fmtNum(d.total) + "，到期 " + String(window.ytFmtCst(d.expires_at) || "").slice(0, 10),
      "ok",
    );
    if (window.ytToast) window.ytToast(extended ? "订阅已续期" : "订阅已开通");
    loadMine().then(function () {
      /* 关弹窗前留 1.5 秒让用户看到结果，然后滚到「我的订阅」去复制密钥 */
      setTimeout(function () {
        var dlg = dlgEl();
        var mine = mineEl();
        try { if (dlg && dlg.open) dlg.close(); } catch (_) { /* ignore */ }
        if (mine && !mine.hidden) mine.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 1500);
    });
  }

  function doClaim(isRetry) {
    var se = statusElOf();
    if (!se || !se.isConnected) { stopAll(); return; }
    var planId = (document.getElementById("sub-pay-plan") || {}).value || "";
    var order = ((document.getElementById("sub-pay-order") || {}).value || "").replace(/\D/g, "");
    if (order.length !== 6) {
      stopAll();
      window.ytFormError("sub-pay-form", "请输入支付订单号后 6 位（纯数字）");
      return;
    }
    if (!isRetry) { attempts = 0; waitStartAt = Date.now(); startTick(); }
    var fd = new FormData();
    fd.append("csrf", (document.querySelector("input[name=csrf]") || {}).value || "");
    fd.append("order_num", order);
    fd.append("plan_id", planId);
    fetch("/?ajax=subscription_claim", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.status === "ready") { onOpened(d); return; }
        if (d && d.status === "pending") {
          attempts++;
          if (Date.now() - waitStartAt >= WAIT_WINDOW) {
            stopAll();
            setStatus(BAD_ORDER_MSG, "err");
            return;
          }
          retryTimer = setTimeout(function () { doClaim(true); }, attempts < FAST_MAX ? 4000 : BG_INTERVAL);
          return;
        }
        stopAll();
        if (d && d.status === "amount_mismatch") {
          setStatus(
            "这笔付款金额是 ¥" + d.amount + "，与所选套餐（¥" + d.expected + "）不符。请按套餐金额付款，或联系客服处理。",
            "err",
          );
        } else if (d && d.status === "script_offline") {
          setStatus("自动开通服务暂不可用，请联系客服人工处理（付款凭证请截图保留）。", "err");
        } else {
          setStatus((d && d.error) || "开通失败，请稍后重试", "err");
        }
      })
      .catch(function () {
        if (waitStartAt && Date.now() - waitStartAt < WAIT_WINDOW) {
          retryTimer = setTimeout(function () { doClaim(true); }, BG_INTERVAL);
          return;
        }
        stopAll();
        setStatus("网络异常，请稍后重试", "err");
      });
  }

  onDoc("submit", function (e) {
    if (!e.target || e.target.id !== "sub-pay-form") return;
    e.preventDefault();
    doClaim(false);
  });
  /* 关闭弹窗即停轮询，别留后台定时器 */
  onDoc("click", function (e) {
    var x = e.target.closest ? e.target.closest('[data-close-dialog="sub-pay-dialog"]') : null;
    if (x) stopAll();
  });

  /* ── 兑换码换订阅 ──
     与付款开通的差别：**一次请求定结果**，没有 pending 轮询（后端同步签发完才返回），
     所以这里不碰上面那套 retryTimer / 读秒。成功后同样刷新「我的订阅」并滚过去。 */
  var redeemDlgEl = function () { return document.getElementById("sub-redeem-dialog"); };
  var redeeming = false;

  function setRedeemStatus(text, kind) {
    var el = document.getElementById("sub-redeem-status");
    if (!el) return;
    el.hidden = !text;
    el.textContent = text;
    el.className = "pay-status" + (kind ? " is-" + kind : "");
  }

  onDoc("click", function (e) {
    if (!e.target.closest) return;
    if (e.target.closest("#sub-redeem-open")) {
      var input = document.getElementById("sub-redeem-code");
      if (input) input.value = "";
      setRedeemStatus("");
      window.ytFormErrorClear("sub-redeem-form");
      var rd = redeemDlgEl();
      if (rd && !rd.open) {
        try { rd.showModal(); } catch (_) { rd.setAttribute("open", "open"); }
      }
      if (input) setTimeout(function () { input.focus(); }, 30);
    }
  });

  onDoc("submit", function (e) {
    if (!e.target || e.target.id !== "sub-redeem-form") return;
    e.preventDefault();
    if (redeeming) return; // 双击提交会把同一张码打两次，第二次必然报「已被使用」
    var input = document.getElementById("sub-redeem-code");
    var code = ((input || {}).value || "").trim().toUpperCase();
    if (!code) {
      window.ytFormError("sub-redeem-form", "请输入兑换码");
      return;
    }
    window.ytFormErrorClear("sub-redeem-form");
    redeeming = true;
    setRedeemStatus("正在兑换…", "wait");
    var fd = new FormData();
    fd.append("csrf", (document.querySelector("input[name=csrf]") || {}).value || "");
    fd.append("code", code);
    fetch("/?ajax=subscription_redeem", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        redeeming = false;
        if (!d || !d.ok) {
          /* 错误常驻在弹窗内（toast 3.5 秒就没了，用户会以为兑换成功了） */
          setRedeemStatus("");
          window.ytFormError("sub-redeem-form", (d && d.error) || "兑换失败，请稍后重试");
          return;
        }
        var extended = d.mode === "extended";
        setRedeemStatus(
          (extended ? "续期成功！已延长有效期。" : "兑换成功！专属密钥已生成。") +
            "套餐 " + String(d.plan_name || "") +
            (d.duration_label ? "（有效 " + d.duration_label + "）" : "") +
            "，总次数 " + fmtNum(d.total),
          "ok",
        );
        if (window.ytToast) window.ytToast(extended ? "订阅已续期" : "兑换成功");
        loadMine().then(function () {
          setTimeout(function () {
            var rd = redeemDlgEl();
            var mine = mineEl();
            try { if (rd && rd.open) rd.close(); } catch (_) { /* ignore */ }
            if (mine && !mine.hidden) mine.scrollIntoView({ behavior: "smooth", block: "center" });
          }, 1800);
        });
      })
      .catch(function () {
        redeeming = false;
        setRedeemStatus("");
        window.ytFormError("sub-redeem-form", "网络异常，请稍后重试");
      });
  });
});

/* ── 视频生成（2026-08-22）─────────────────────────────────────────
 * 布局对标秘塔：左参数栏实时算价 → 提交 → 右侧预览与缩略图轮询。
 *
 * ⚠ 价格数字**一律来自后端 estimate 接口**，不在前端做乘法 ——
 *   前端自己乘一遍，迟早和 computeVideoTaskCost 分叉，那就是展示价 ≠ 实扣价。
 * ⚠ 守卫挂 #vg-shell（每次 PJAX 重建），不能挂 .shell-main（跨 PJAX 存活，会让二次进页全哑）。
 */
window.__ytInits.push(function initVideoGen() {
  "use strict";
  var shell = document.getElementById("vg-shell");
  if (!shell) return; // 不在视频页
  if (shell.dataset.ytVgBound === "1") return;
  shell.dataset.ytVgBound = "1";

  /* document 级委托全局只绑一次（同订阅页那套：本函数每次进页都会重跑） */
  var docBound = window.__ytVgDocBound === true;
  window.__ytVgDocBound = true;
  var onDoc = docBound
    ? function () { /* 已绑过 */ }
    : function (type, fn) { document.addEventListener(type, fn); };

  /* 一律实时查询，不缓存引用（委托只绑一次，缓存的会是 PJAX 前的旧节点） */
  var $ = function (id) { return document.getElementById(id); };
  var enabled = shell.dataset.enabled === "1";
  var loggedIn = shell.dataset.loggedIn !== "0";

  var state = {
    res: "768p",
    aspect: "16:9",
    count: 1,
    seconds: 5,   /* 4 秒非法：H3 最短 124 帧 = 5.17 秒 */
    cost: null,
    submitting: false,
    activeId: "",
    /* 首尾帧：存服务端返回的**相对路径**（不是 URL）。任一非空即 +10% 计价 */
    firstFrame: "",
    lastFrame: "",
  };

  var activeRes = document.querySelector("#vg-res .vg-seg-btn.is-active");
  if (activeRes) state.res = activeRes.dataset.vgRes || "768p";
  var activeAsp = document.querySelector("#vg-aspect .vg-chip.is-active");
  if (activeAsp) state.aspect = activeAsp.dataset.vgAspect || "16:9";
  var activeCnt = document.querySelector("#vg-count .vg-seg-btn.is-active");
  if (activeCnt) state.count = Number(activeCnt.dataset.vgCount) || 1;

  var estTimer = null;
  var pollTimer = null;
  var tasks = [];

  function esc(t) {
    return String(t == null ? "" : t).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  /**
   * 视频页的错误条。
   * @param {string} msg
   * @param {boolean} [withRecharge] 追加「去充值」直达按钮 —— 积分不足时让用户
   *        就地开充值弹窗，不必离开创作现场去 /?page=recharge 再走回来。
   */
  function showErr(msg, withRecharge) {
    var el = $("vg-err");
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ""; return; }
    el.hidden = false;
    el.textContent = msg;
    if (withRecharge && document.getElementById("vg-recharge-dialog")) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vg-err-recharge";
      btn.setAttribute("data-open-dialog", "vg-recharge-dialog");
      btn.textContent = "去充值";
      el.appendChild(document.createTextNode(" "));
      el.appendChild(btn);
    }
  }

  // ── 参数选择 ──────────────────────────────────────────────
  function setActive(container, btn) {
    if (!container) return;
    var all = container.querySelectorAll("button");
    for (var i = 0; i < all.length; i += 1) all[i].classList.remove("is-active");
    if (btn) btn.classList.add("is-active");
  }

  /** 页面上实际渲染出来的时长档位（后端下发，不在前端硬编码）。 */
  function secOptions() {
    var box = $("vg-sec");
    if (!box) return [];
    var btns = box.querySelectorAll("[data-vg-sec]");
    var out = [];
    for (var i = 0; i < btns.length; i += 1) out.push(Number(btns[i].dataset.vgSec) || 0);
    return out.filter(function (n) { return n > 0; });
  }

  /**
   * 设置时长。**只能取后端给的离散档位** —— H3 的帧数必须落在 17k+5 网格上，
   * 传任意整数秒后端会向上吸附（选 6 秒实际出 6.58 秒），所以前端直接只放合法档，
   * 免得用户看到的时长和拿到的对不上。传进来的值会吸附到不超过它的最大档。
   */
  function setSec(sec) {
    var opts = secOptions();
    if (!opts.length) { state.seconds = Number(sec) || 5; scheduleEstimate(); return; }
    var want = Number(sec) || opts[0];
    var pick = opts[0];
    for (var i = 0; i < opts.length; i += 1) if (opts[i] <= want) pick = opts[i];
    state.seconds = pick;
    var box = $("vg-sec");
    if (box) {
      var btns = box.querySelectorAll("[data-vg-sec]");
      for (var j = 0; j < btns.length; j += 1) {
        btns[j].classList.toggle("is-active", Number(btns[j].dataset.vgSec) === pick);
      }
    }
    var val = $("vg-sec-val");
    if (val) val.textContent = pick + " 秒";
    scheduleEstimate();
  }

  /** 换分辨率后，超过该档 max_seconds 的时长按钮要置灰（各档上限可以不同）。 */
  function syncSecLimits(maxS) {
    var box = $("vg-sec");
    if (!box) return;
    var btns = box.querySelectorAll("[data-vg-sec]");
    for (var i = 0; i < btns.length; i += 1) {
      var v = Number(btns[i].dataset.vgSec) || 0;
      var over = v > maxS;
      btns[i].disabled = over;
      btns[i].classList.toggle("is-disabled", over);
    }
  }

  onDoc("click", function (e) {
    var res = e.target.closest ? e.target.closest("[data-vg-res]") : null;
    if (res && !res.disabled) {
      state.res = res.dataset.vgRes || "768p";
      setActive($("vg-res"), res);
      var maxS = Number(res.dataset.maxSeconds || 15);
      syncSecLimits(maxS);
      if (state.seconds > maxS) setSec(maxS);
      else scheduleEstimate();
      return;
    }
    if (e.target && (e.target.id === "vg-prompt-clear" || (e.target.closest && e.target.closest("#vg-prompt-clear")))) {
      var pEl = $("vg-prompt");
      if (pEl) {
        pEl.value = "";
        var pcEl = $("vg-prompt-count");
        if (pcEl) pcEl.textContent = "0";
        pEl.focus();
      }
      optBefore = "";        /* 清空了就没有「优化前」可还原 */
      syncPromptUi();
      return;
    }
    if (e.target.closest && e.target.closest("#vg-prompt-opt")) { optimizePrompt(); return; }
    if (e.target.closest && e.target.closest("#vg-prompt-undo")) { undoOptimize(); return; }
    if (e.target.closest && e.target.closest("#vg-prompt-wiz")) {
      if (!loggedIn) { showOptTip("风格向导需要登录后使用。", true); return; }
      wizOpenDialog();
      return;
    }
    var wizCard = e.target.closest ? e.target.closest("[data-wiz-style]") : null;
    if (wizCard) { wizStart(wizCard.getAttribute("data-wiz-style")); return; }
    if (e.target.closest && e.target.closest("#vg-wiz-send")) { wizSend(); return; }
    if (e.target.closest && e.target.closest("#vg-wiz-back")) { wizBackToStyles(); return; }
    if (e.target.closest && e.target.closest("#vg-wiz-finish")) { wizFinishNow(); return; }
    if (e.target.closest && e.target.closest("#vg-wiz-use")) { wizUsePrompt(); return; }
    var pick = e.target.closest ? e.target.closest("[data-frame-pick]") : null;
    if (pick) {
      if (!loggedIn) { showFrameTip("上传参考图需要先登录。"); return; }
      var inp = $("vg-frame-" + pick.getAttribute("data-frame-pick"));
      if (inp) inp.click();
      return;
    }
    var promptBtn = e.target.closest ? e.target.closest("[data-vg-prompt]") : null;
    if (promptBtn) { openPromptDialog(promptBtn.getAttribute("data-vg-prompt")); return; }
    var reuseHit = e.target.closest ? e.target.closest("[data-vg-reuse]") : null;
    if (reuseHit) { reusePrompt(reuseHit.getAttribute("data-vg-reuse")); return; }
    var del = e.target.closest ? e.target.closest("[data-frame-del]") : null;
    if (del) { clearFrame(del.getAttribute("data-frame-del")); return; }
    var filterBtn = e.target.closest ? e.target.closest("[data-work-filter]") : null;
    if (filterBtn) {
      workFilter = filterBtn.dataset.workFilter || "all";
      /* 切筛选要清掉不属于当前筛选的卡片，直接清空让 render 重建 */
      var gridEl = $("vg-works-grid");
      if (gridEl) gridEl.innerHTML = "";
      render();
      return;
    }
    var pagerBtn = e.target.closest ? e.target.closest("[data-strip-page]") : null;
    if (pagerBtn && !pagerBtn.disabled) {
      stripPage += pagerBtn.dataset.stripPage === "next" ? 1 : -1;
      if (stripPage < 0) stripPage = 0;
      var strip0 = $("vg-strip");
      if (strip0) strip0.dataset.sig = "";   /* 强制重建这一页 */
      syncStripMode();
      return;
    }
    var secBtn = e.target.closest ? e.target.closest("[data-vg-sec]") : null;
    if (secBtn && !secBtn.disabled) {
      setSec(Number(secBtn.dataset.vgSec));
      return;
    }
    var asp = e.target.closest ? e.target.closest("[data-vg-aspect]") : null;
    if (asp) {
      state.aspect = asp.dataset.vgAspect || "16:9";
      setActive($("vg-aspect"), asp);
      scheduleEstimate();
      return;
    }
    var cnt = e.target.closest ? e.target.closest("[data-vg-count]") : null;
    if (cnt) {
      state.count = Number(cnt.dataset.vgCount) || 1;
      setActive($("vg-count"), cnt);
      scheduleEstimate();
      return;
    }
    var mode = e.target.closest ? e.target.closest("[data-vg-mode]") : null;
    if (mode && !mode.disabled) { setActive($("vg-modes"), mode); return; }

    // 案例卡片「使用提示词」一键填入
    var usePromptBtn = e.target.closest ? e.target.closest("[data-use-prompt]") : null;
    if (usePromptBtn) {
      var promptText = usePromptBtn.dataset.usePrompt || "";
      var pEl = $("vg-prompt");
      if (pEl && promptText) {
        pEl.value = promptText;
        var cEl = $("vg-prompt-count");
        if (cEl) cEl.textContent = String(promptText.length);
        pEl.scrollIntoView({ behavior: "smooth", block: "center" });
        pEl.focus();
        /* 长提示词（带分镜时间轴的能上千字）填进去后光标要回到开头，
           否则 focus 会停在末尾、用户看到的是「负面约束」那段，以为填错了 */
        try { pEl.setSelectionRange(0, 0); pEl.scrollTop = 0; } catch (_) { /* ignore */ }
        if (window.ytToast) {
          window.ytToast("已填入完整提示词（" + promptText.length + " 字）");
        }
        /* 填了提示词就重算价：秒数/清晰度没变，但按钮上的积分要保持可见 */
        scheduleEstimate();
      }
      return;
    }

    /*
     * 取消排队中的任务。绑在 [data-vg-cancel] 本身而不是外层卡片上 ——
     * 2026-08-22 作品搬进独立板块后，卡片不再带 data-vg-thumb，
     * 原来「先找 thumb 再找 cancel」的写法会让取消按钮彻底点不动。
     */
    var cancelBtn = e.target.closest ? e.target.closest("[data-vg-cancel]") : null;
    if (cancelBtn) { cancelTask(cancelBtn.dataset.vgCancel); return; }

    // 演示缩略图点击：切主播放器到这一条（缩略图与主播放器同源，不会「图与视频不一致」）
    var demoThumb = e.target.closest ? e.target.closest("[data-demo-index]") : null;
    if (demoThumb) {
      playDemo(Number(demoThumb.dataset.demoIndex) || 0, true);
      return;
    }

    /*
     * ⚠ 必须用 closest，不能只比 e.target.id。
     * 创建按钮里有 <svg> 图标和两个 <span>（「创建」「(N 积分)」），
     * 点在文字或图标上时 e.target 是那个子元素、id 对不上 ——
     * 表现为「按钮有时候点了没反应」（点边缘才有效）。
     * 同页的播放/静音/全屏按钮早就用 closest 了，只有这里漏了。2026-08-22 修。
     */
    if (e.target && (e.target.id === "vg-submit" || (e.target.closest && e.target.closest("#vg-submit")))) {
      submit();
      return;
    }

    // 播放器控制条
    var seekBar = e.target.closest ? e.target.closest(".vg-player-seekbar") : null;
    if (seekBar) {
      seekToClientX(e.clientX, seekBar);
      return;
    }
    if (e.target && (e.target.id === "vg-play-toggle" || e.target.closest("#vg-play-toggle"))) {
      togglePlay();
      return;
    }
    if (e.target && (e.target.id === "vg-mute-toggle" || e.target.closest("#vg-mute-toggle"))) {
      var vMute = $("vg-video");
      if (vMute) {
        vMute.muted = !vMute.muted;
        /* 取消静音时若已被浏览器暂停（autoplay 策略），顺手续播 */
        if (!vMute.muted && vMute.paused && !userPaused) vMute.play().catch(function () {});
        syncMuteIcon();
      }
      return;
    }
    if (e.target && (e.target.id === "vg-fs-toggle" || e.target.closest("#vg-fs-toggle"))) {
      var pBox = $("vg-player");
      if (pBox) {
        if (!document.fullscreenElement) pBox.requestFullscreen().catch(function () {});
        else document.exitFullscreen().catch(function () {});
      }
      return;
    }
    /* 点画面本身也能播/暂停（控制条与遮罩之外的区域） */
    if (e.target && (e.target.id === "vg-video" || e.target.classList.contains("vg-player-canvas"))) {
      togglePlay();
      return;
    }
    /* 首次播放的大按钮 */
    if (e.target && (e.target.id === "vg-player-start" || e.target.closest("#vg-player-start"))) {
      startPlayback();
      return;
    }
  });

  onDoc("input", function (e) {
    if (e.target && e.target.id === "vg-prompt") {
      /* 字数、清空按钮、创建按钮三者联动，统一走一处 */
      syncPromptUi();
    }
  });

  onDoc("change", function (e) {
    var t = e.target;
    if (!t || !t.classList || !t.classList.contains("vg-frame-input")) return;
    var slot = t.id === "vg-frame-first" ? "first" : "last";
    uploadFrame(slot, t.files && t.files[0]);
  });

  /* 向导输入框：Enter 发送、Shift+Enter 换行（聊天框的通用预期） */
  onDoc("keydown", function (e) {
    if (!e.target || e.target.id !== "vg-wiz-input") return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      wizSend();
    }
  });

  /**
   * 创建按钮的可用性统一在这里判定。
   *
   * 四个条件缺一不可：灰度已开放、提示词非空、余额够、当前没在提交中。
   * 抽成一个函数是因为它有三个触发源（算价返回、提示词输入、提交前后），
   * 分散写必然漏掉某一条，出现「明明不能提交却是亮的」或反之。
   */
  /** 提示词相关的 UI 联动：字数、清空按钮显隐、创建按钮可用性。 */
  function syncPromptUi() {
    var pEl = $("vg-prompt");
    var len = pEl ? pEl.value.length : 0;
    var cEl = $("vg-prompt-count");
    if (cEl) cEl.textContent = String(len);
    var clr = $("vg-prompt-clear");
    if (clr) clr.hidden = len === 0;   /* 空的时候没什么可清，藏起来省得干扰 */
    var opt = $("vg-prompt-opt");
    if (opt) opt.disabled = len === 0 || optBusy;
    syncSubmitState();
  }

  /* ── 一键优化提示词（自建 H3-Context-IR 改写层）─────────────────────────
   *
   * H3 是三段式模型：Context-IR 改写 → Base 出片 → 2K 升清。官方只开源了中间那段，
   * 而它自己也说改写层「对成片质量至关重要」。所以这里用官方随 skill 发布的
   * 写作指南（15.7KB 全文，含镜头运动术语表与四个示例）当 system prompt，
   * 让我们号池里的便宜模型把用户那句话改写成 H3 期望的三字段结构。
   *
   * 两条约束：① 改写失败绝不挡住生成，用户照常拿原文提交；
   *          ② 原文留在 optBefore 里，随时能一键还原 —— 改写不合心意是常事。
   */
  var optBefore = "";   /* 上一次优化前的原文（空 = 没有可还原的） */
  var optBusy = false;

  function showOptTip(msg, warn) {
    var tip = $("vg-opt-tip");
    if (!tip) return;
    if (!msg) { tip.hidden = true; return; }
    tip.textContent = msg;
    tip.classList.toggle("is-warn", !!warn);
    tip.hidden = false;
  }

  function setOptBusy(busy) {
    optBusy = busy;
    var btn = $("vg-prompt-opt");
    var txt = $("vg-prompt-opt-txt");
    if (btn) { btn.disabled = busy; btn.classList.toggle("is-busy", busy); }
    if (txt) txt.textContent = busy ? "优化中…" : "一键优化";
  }

  function optimizePrompt() {
    if (optBusy) return;
    var pEl = $("vg-prompt");
    var raw = pEl ? pEl.value.trim() : "";
    if (!raw) { showOptTip("请先写一句你想要的画面，再点优化。", true); if (pEl) pEl.focus(); return; }
    /* 视频页允许匿名浏览，但改写要登录态。不先拦一下，用户会拿到一句
       不明所以的「服务暂时不可用」，而真实原因是没登录。 */
    if (!loggedIn) { showOptTip("一键优化需要登录后使用，登录即可享受。", true); return; }
    setOptBusy(true);
    /*
     * 按长度给不同的等待预期。实测耗时随输入长度上升：
     * 十几字约 8 秒、2000 字 12 秒、3000 字 24 秒、4500 字 31 秒，
     * 顶格 7000 字在 33~55 秒之间**波动**（看上游负载），偶尔会撞超时。
     * 长文本不预先说清，用户会以为页面卡死了。
     */
    if (raw.length >= 3000) {
      showOptTip(
        "内容较长（" + raw.length + " 字），改写需要 30~60 秒，请勿关闭页面。" +
        "偶尔会因上游超时失败，那时原描述会完整保留、可以再点一次。",
        false
      );
    } else if (raw.length >= 200) {
      showOptTip("正在重新组织你的描述并补上镜头运动与声音，约 10~30 秒…", false);
    } else {
      showOptTip("正在按官方结构改写（镜头 / 音景 / 配乐），约 5~15 秒…", false);
    }
    var fd = new FormData();
    fd.append("prompt", raw);
    fd.append("seconds", String(state.seconds));
    var csrfEl = document.querySelector('input[name="csrf"]');
    if (csrfEl) fd.append("csrf", csrfEl.value);
    fetch("/?ajax=video_optimize", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) {
        if (r.status === 401) return { ok: false, error: "登录已过期，请刷新页面后重试。" };
        return r.json();
      })
      .then(function (r) {
        if (r && r.ok && r.prompt) {
          optBefore = raw;                  /* 存原文，供还原 */
          pEl.value = r.prompt;
          var undo = $("vg-prompt-undo");
          if (undo) undo.hidden = false;
          syncPromptUi();
          /*
           * 两种模式给不同说法：原文很短时是「补细节」，原文已详细时是「换结构」。
           * 说成一样的会让写了长描述的用户以为我们把他的内容删了。
           */
          var howto = r.mode === "restructure"
            ? " 字，保留了你写的细节并补上镜头运动与声音。"
            : " 字，补齐了镜头运动、光线与声音描述。";
          showOptTip(
            "已优化：" + raw.length + " 字 → " + r.prompt.length + howto + "不满意可点「还原」。",
            false
          );
        } else if (r && r.reason === "already_structured") {
          /* 不是失败，只是没必要再跑一次 —— 用中性语气，别让用户以为出错了 */
          showOptTip(r.error || "这段描述已经是优化后的标准格式，无需再优化。", false);
        } else if (r && r.reason === "timeout" && raw.length >= 3000) {
          /* 长文本超时是已知的概率事件，直接告诉用户怎么办，别只说"失败了" */
          showOptTip(
            "内容较长，这次改写超时了（原描述已完整保留）。可以再点一次，" +
            "或把它拆成两段分别优化 —— 短一些的内容成功率明显更高。",
            true
          );
        } else {
          /* 改写没成也不是错误：原文照样能生成，只是质量少一层加成 */
          showOptTip((r && r.error) || "优化未成功，可直接用原描述生成。", true);
        }
      })
      .catch(function () { showOptTip("优化服务暂时不可用，可直接用原描述生成。", true); })
      .finally(function () { setOptBusy(false); syncPromptUi(); });
  }

  function undoOptimize() {
    if (!optBefore) return;
    var pEl = $("vg-prompt");
    if (pEl) { pEl.value = optBefore; pEl.focus(); }
    optBefore = "";
    var undo = $("vg-prompt-undo");
    if (undo) undo.hidden = true;
    syncPromptUi();
    showOptTip("已还原为优化前的描述。", false);
  }

  /* ── 风格向导（官方 8 个 skill 的多轮对话）───────────────────
   *
   * 与「一键优化」的分工：优化是「我知道要拍什么，帮我翻译成 H3 格式」，
   * 向导是「我只有个模糊想法，请问出细节」。两者最终产物同一种三字段格式。
   *
   * 会话历史存在这里的 wizMsgs 里、每轮整段回传（后端无状态）——
   * 换来的是进程重启/多实例都不会把聊到一半的对话弄丢。代价是刷新页面会丢。
   */
  var wizStyles = null;      /* 惰性拉取的风格列表，拉过就缓存 */
  var wizStyle = "";         /* 当前选中的 skill id */
  var wizMsgs = [];          /* [{role,content}]，与后端约定的顺序 */
  var wizPrompt = "";        /* 已产出的成品提示词 */
  var wizBusy = false;

  function wizDlg() { return $("vg-wizard-dialog"); }

  function wizAppend(cls, text) {
    var log = $("vg-wiz-log");
    if (!log) return null;
    var d = document.createElement("div");
    d.className = "vg-wiz-msg " + cls;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }

  function wizTyping(on) {
    var log = $("vg-wiz-log");
    if (!log) return;
    var old = log.querySelector(".vg-wiz-typing");
    if (old) old.remove();
    if (!on) return;
    var d = document.createElement("div");
    d.className = "vg-wiz-typing";
    d.innerHTML = "<i></i><i></i><i></i>";
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  function wizSetBusy(b) {
    wizBusy = b;
    var send = $("vg-wiz-send");
    if (send) send.disabled = b;
    wizTyping(b);
  }

  /** 拉风格列表并渲染卡片。只拉一次，之后复用。 */
  function wizLoadStyles() {
    var box = $("vg-wiz-styles");
    if (!box) return;
    if (wizStyles) { wizRenderStyles(wizStyles); return; }
    fetch("/?ajax=video_wizard_styles", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.styles || !d.styles.length) {
          box.innerHTML = '<div class="vg-wiz-loading">风格暂时加载不出来，可直接自己写描述。</div>';
          return;
        }
        wizStyles = d.styles;
        wizRenderStyles(wizStyles);
      })
      .catch(function () {
        box.innerHTML = '<div class="vg-wiz-loading">风格加载失败，可直接自己写描述。</div>';
      });
  }

  function wizRenderStyles(list) {
    var box = $("vg-wiz-styles");
    if (!box) return;
    box.innerHTML = "";
    list.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "vg-wiz-card";
      b.setAttribute("data-wiz-style", s.id);
      var top = document.createElement("div");
      top.className = "vg-wiz-card-top";
      var nm = document.createElement("span");
      nm.className = "vg-wiz-card-name";
      nm.textContent = s.name;
      top.appendChild(nm);
      if (s.tag) {
        var tg = document.createElement("span");
        tg.className = "vg-wiz-card-tag";
        tg.textContent = s.tag;
        top.appendChild(tg);
      }
      var sum = document.createElement("div");
      sum.className = "vg-wiz-card-sum";
      sum.textContent = s.summary || "";
      b.appendChild(top);
      b.appendChild(sum);
      box.appendChild(b);
    });
  }

  function wizOpenDialog() {
    var d = wizDlg();
    if (!d) return;
    /* 每次打开都回到选风格那一步：换个片子类型是最常见的二次使用场景 */
    wizBackToStyles();
    wizLoadStyles();
    if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "");
  }

  function wizBackToStyles() {
    wizStyle = "";
    wizMsgs = [];
    wizPrompt = "";
    var log = $("vg-wiz-log");
    if (log) log.innerHTML = "";
    var use = $("vg-wiz-use");
    if (use) use.hidden = true;
    var fin = $("vg-wiz-finish");
    if (fin) fin.hidden = true;
    var chat = $("vg-wiz-chat");
    if (chat) chat.hidden = true;
    var styles = $("vg-wiz-styles");
    if (styles) styles.hidden = false;
    var sub = $("vg-wiz-sub");
    if (sub) sub.textContent = "选一种片子类型，我来问你几个问题";
  }

  function wizStart(styleId) {
    var s = (wizStyles || []).filter(function (x) { return x.id === styleId; })[0];
    if (!s) return;
    wizStyle = styleId;
    wizMsgs = [];
    wizPrompt = "";
    var styles = $("vg-wiz-styles");
    if (styles) styles.hidden = true;
    var chat = $("vg-wiz-chat");
    if (chat) chat.hidden = false;
    var log = $("vg-wiz-log");
    if (log) log.innerHTML = "";
    var use = $("vg-wiz-use");
    if (use) use.hidden = true;
    var fin = $("vg-wiz-finish");
    if (fin) fin.hidden = true;
    var sub = $("vg-wiz-sub");
    if (sub) sub.textContent = s.name + " · 时长与画面比例已按你在页面上的选择，不会再问";
    wizAppend("is-tip", "已选择「" + s.name + "」，正在准备第一个问题…");
    wizTurn();
  }

  /** 走一轮：把完整历史发给后端，拿回下一句提问或成品提示词。 */
  function wizTurn() {
    if (!wizStyle || wizBusy) return;
    wizSetBusy(true);
    /*
     * 这个接口收 JSON（对话历史是数组，表单编码很别扭），所以 csrf 走
     * **X-CSRF-Token 请求头** —— `yt_verify_csrf()` 认这个头或 $_POST['csrf']，
     * 而 JSON body 里的 csrf 它读不到（PHP 不会把 php://input 填进 $_POST）。
     * 漏了这个头的表现是 HTTP 400「CSRF 校验失败」，且**请求压根到不了后端**。
     */
    var csrfEl = document.querySelector('input[name="csrf"]');
    var headers = { "Content-Type": "application/json" };
    if (csrfEl) headers["X-CSRF-Token"] = csrfEl.value;
    fetch("/?ajax=video_wizard", {
      method: "POST",
      credentials: "same-origin",
      headers: headers,
      body: JSON.stringify({ style: wizStyle, messages: wizMsgs, seconds: state.seconds }),
    })
      .then(function (r) { return r.status === 401 ? { ok: false, error: "登录已过期，请刷新页面" } : r.json(); })
      .then(function (d) {
        if (!d || !d.ok) {
          wizAppend("is-tip", (d && d.error) || "向导暂时不可用，可直接自己写描述生成。");
          return;
        }
        if (d.reply) {
          wizAppend("is-ai", d.reply);
          wizMsgs.push({ role: "assistant", content: d.reply });
        }
        if (d.done && d.prompt) {
          wizPrompt = d.prompt;
          wizAppend("is-prompt", d.prompt);
          var use = $("vg-wiz-use");
          if (use) use.hidden = false;
          var fin = $("vg-wiz-finish");
          if (fin) fin.hidden = true;      /* 已经出片了，不需要催收尾了 */
          var inp = $("vg-wiz-input");
          if (inp) inp.placeholder = "还想调整？继续说，或直接点右下角填入创作框";
        } else {
          /* 模型有时会一路追问不收尾 —— 聊过一轮就把「够了」露出来，让用户能自己收口 */
          var fin2 = $("vg-wiz-finish");
          if (fin2 && wizMsgs.length >= 2) fin2.hidden = false;
        }
      })
      .catch(function () { wizAppend("is-tip", "网络异常，请稍后重试。"); })
      .finally(function () { wizSetBusy(false); });
  }

  function wizSend() {
    var inp = $("vg-wiz-input");
    var t = inp ? inp.value.trim() : "";
    if (!t || wizBusy) return;
    wizAppend("is-me", t);
    wizMsgs.push({ role: "user", content: t });
    if (inp) inp.value = "";
    wizTurn();
  }

  /**
   * 用户主动收尾：不再回答问题，直接要提示词。
   *
   * 实现上就是替用户说一句「别问了，按现在的信息出提示词」—— 走同一条对话链路，
   * 元指令里已经写明「信息够了就立即收尾」，模型会照办。
   * 不另做一套「强制出稿」接口，是为了避免两条产出路径行为分叉。
   */
  function wizFinishNow() {
    if (wizBusy || !wizStyle) return;
    var msg = "不用再问了，就按现在聊到的信息，直接给我最终提示词。缺的细节你自己合理补全。";
    wizAppend("is-me", "够了，直接生成");
    wizMsgs.push({ role: "user", content: msg });
    var fin = $("vg-wiz-finish");
    if (fin) fin.hidden = true;
    wizTurn();
  }

  function wizUsePrompt() {
    if (!wizPrompt) return;
    var pEl = $("vg-prompt");
    if (pEl) {
      /* 与一键优化共用同一套「可还原」机制：向导填入前的内容也存得下 */
      optBefore = pEl.value.trim();
      pEl.value = wizPrompt;
      var undo = $("vg-prompt-undo");
      if (undo) undo.hidden = !optBefore;
      syncPromptUi();
    }
    var d = wizDlg();
    if (d && typeof d.close === "function") d.close();
    showOptTip("已填入向导生成的提示词（" + wizPrompt.length + " 字），可直接创建。", false);
  }

  /**
   * 「查看提示词」弹窗。
   *
   * 提示词从 `tasks` 内存里按 id 取，不塞进 DOM 属性 ——
   * 一条最长 7000 字，几十张卡片全塞进 data 属性就是几百 KB 的无用 DOM。
   */
  function openPromptDialog(taskId) {
    var t = null;
    for (var i = 0; i < tasks.length; i += 1) {
      if (tasks[i].id === taskId) { t = tasks[i]; break; }
    }
    if (!t || !t.prompt) return;
    var dlg = $("vg-prompt-dialog");
    var body = $("vg-prompt-dialog-text");
    var meta = $("vg-prompt-dialog-meta");
    var copyBtn = $("vg-prompt-dialog-copy");
    var reuseBtn = $("vg-prompt-dialog-reuse");
    if (!dlg || !body) return;
    body.textContent = t.prompt;                 /* textContent 而非 innerHTML：提示词是用户输入 */
    if (meta) {
      meta.textContent =
        String(t.resolution || "").toUpperCase() + " · " + t.seconds + " 秒 · " +
        t.points_spent + " 积分 · " + (t.prompt.length) + " 字";
    }
    /* 复制按钮复用全站那套 .copy-btn（点了会短暂变「已复制」），只需换 data-copy */
    if (copyBtn) copyBtn.setAttribute("data-copy", t.prompt);
    if (reuseBtn) reuseBtn.setAttribute("data-vg-reuse", t.id);
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
  }

  /** 「再用一次」：把这条提示词填回创作框，省得用户手工复制粘贴。 */
  function reusePrompt(taskId) {
    var t = null;
    for (var i = 0; i < tasks.length; i += 1) {
      if (tasks[i].id === taskId) { t = tasks[i]; break; }
    }
    if (!t || !t.prompt) return;
    var pEl = $("vg-prompt");
    if (pEl) {
      optBefore = pEl.value.trim();              /* 复用一键优化那套「可还原」机制 */
      pEl.value = t.prompt;
      var undo = $("vg-prompt-undo");
      if (undo) undo.hidden = !optBefore;
      syncPromptUi();
      pEl.focus();
    }
    var dlg = $("vg-prompt-dialog");
    if (dlg && typeof dlg.close === "function") dlg.close();
    if (window.ytToast) window.ytToast("已填入创作框");
    /* 滚回参数区，让用户看到填进去了 */
    var form = document.querySelector(".vg-form");
    if (form && form.scrollIntoView) form.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ── 首尾帧上传 ─────────────────────────────────────────────
   *
   * 同一个 H3-Base-FL2VA checkpoint 支持 0/1/2 张图（0=文生视频、1=首帧或末帧、
   * 2=首尾帧），所以两个槽位互相独立、都可留空。
   *
   * 选完图立刻上传（不等点「创建」）：图片几 MB，格式/大小的问题要当场告诉用户，
   * 而不是等积分预检都跑完了才报错。state 里只存服务端返回的**相对路径**，
   * 提交时把路径给后端 —— 前端从不拼 URL，后端也只接受自己发出的路径（防 SSRF）。
   */
  function showFrameTip(msg) {
    var el = $("vg-frame-tip");
    if (!el) return;
    if (!msg) { el.hidden = true; return; }
    el.textContent = msg;
    el.hidden = false;
  }

  function frameSlot(slot) {
    return document.querySelector('.vg-frame-slot[data-slot="' + slot + '"]');
  }

  function setFrameBusy(slot, busy) {
    var box = frameSlot(slot);
    if (!box) return;
    var b = box.querySelector(".vg-frame-busy");
    if (b) b.hidden = !busy;
  }

  function clearFrame(slot) {
    if (slot === "first") state.firstFrame = ""; else state.lastFrame = "";
    var box = frameSlot(slot);
    if (box) {
      var pv = box.querySelector(".vg-frame-preview");
      var img = box.querySelector(".vg-frame-preview img");
      if (pv) pv.hidden = true;
      /* 释放 objectURL，长时间停留页面反复换图不至于攒一堆 blob */
      if (img && img.src.indexOf("blob:") === 0) { URL.revokeObjectURL(img.src); img.removeAttribute("src"); }
      var inp = $("vg-frame-" + slot);
      if (inp) inp.value = "";   /* 清掉才能重选同一个文件 */
    }
    showFrameTip("");
    scheduleEstimate();          /* 去掉参考图 → 价格回落 10% */
  }

  function uploadFrame(slot, file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      showFrameTip("只支持 JPG / PNG / WebP 图片。");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      showFrameTip("图片过大（单张最多 12MB），请压缩后再试。");
      return;
    }
    showFrameTip("");
    setFrameBusy(slot, true);
    var fd = new FormData();
    fd.append("frame", file);
    var csrfEl = document.querySelector('input[name="csrf"]');
    if (csrfEl) fd.append("csrf", csrfEl.value);
    fetch("/?ajax=video_frame&slot=" + slot, { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.path) {
          showFrameTip((d && d.error) || "上传失败，请重试。");
          return;
        }
        if (slot === "first") state.firstFrame = d.path; else state.lastFrame = d.path;
        var box = frameSlot(slot);
        if (box) {
          var pv = box.querySelector(".vg-frame-preview");
          var img = box.querySelector(".vg-frame-preview img");
          /* 用本地 objectURL 做预览：比等 CDN 回源快，也不受强缓存影响 */
          if (img) img.src = URL.createObjectURL(file);
          if (pv) pv.hidden = false;
        }
        scheduleEstimate();      /* 加了参考图 → 价格 +10% */
      })
      .catch(function () { showFrameTip("上传失败，请检查网络后重试。"); })
      .finally(function () { setFrameBusy(slot, false); });
  }

  /** 作品列表是否已经拉回来过一次（决定能不能开始预热演示片，见 shouldPrefetch） */
  var tasksLoaded = false;
  /* workerOnline 缺省 true：首帧还没拿到后端状态时先别把按钮灰掉，
     等第一次算价回来再按真实状态收敛，避免刚进页面闪一下灰按钮 */
  var lastQuote = {
    open: true,
    sufficient: true,
    /* 首屏直接用 PHP 直出的真实状态，不用等第一次算价回来才收敛 */
    workerOnline: shell.dataset.workerOnline !== "0",
  };
  /**
   * 每档每时长的预估耗时（秒），键形如 `768p:10`，由 pricing 接口下发。
   * 进度条靠它本地插值 —— worker 心跳 30 秒一次，不插值就是"卡半分钟跳一下"。
   */
  var etaTable = (function () {
    try { return JSON.parse(shell.dataset.eta || "{}") || {}; } catch (e) { return {}; }
  })();
  /** 插值定时器：只在有任务在跑时开着 */
  var tickTimerVg = null;
  function syncSubmitState() {
    var btn = $("vg-submit");
    if (!btn) return;
    var promptEl = $("vg-prompt");
    var hasPrompt = !!(promptEl && promptEl.value.trim());
    btn.disabled =
      !lastQuote.open || !lastQuote.workerOnline || !hasPrompt ||
      !lastQuote.sufficient || state.submitting;
    /* 置灰时给出原因，避免用户盯着灰按钮不知所措（hover 可见） */
    btn.title = btn.disabled
      ? (!lastQuote.open ? "功能暂未开放"
        : !lastQuote.workerOnline ? "生成服务当前离线，稍后再来"
          : !hasPrompt ? "请先填写画面描述"
            : !lastQuote.sufficient ? "可用积分不足，请先充值（赠送积分不可用于视频）" : "提交中…")
      : "";
    syncOfflineBanner();
  }

  /**
   * 离线提示条。
   *
   * GPU 机是按需开关的，关机期间必须让用户一眼看到「不是你的问题、也不是坏了」，
   * 只靠置灰按钮 + hover title 太隐蔽（移动端根本没有 hover）。
   */
  function syncOfflineBanner() {
    var host = $("vg-offline-tip");
    if (!host) return;
    host.hidden = !(lastQuote.open && !lastQuote.workerOnline);
  }

  // ── 实时算价（防抖，走后端） ───────────────────────────────
  function scheduleEstimate() {
    if (estTimer) clearTimeout(estTimer);
    estTimer = setTimeout(estimate, 160);
  }

  function estimate() {
    /* 灰度关闭时**照样算价** —— 否则用户切「2 个/4 个」时按钮上的积分不动，
       看起来像坏了。能不能提交由后端返回的 available 决定。 */
    if (!loggedIn || !state.res) return;
    var fd = new FormData();
    fd.append("seconds", String(state.seconds));
    fd.append("resolution", state.res);
    fd.append("aspect", state.aspect);
    fd.append("count", String(state.count));
    /* 首尾帧 +10%：报价与实扣必须同口径，前端不许自己乘 */
    if (state.firstFrame || state.lastFrame) fd.append("has_keyframe", "1");
    var csrf = document.querySelector('input[name="csrf"]');
    if (csrf) fd.append("csrf", csrf.value);
    fetch("/?ajax=video_estimate", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var costEl = $("vg-cost");
        if (!d || !d.ok) {
          state.cost = null;
          if (costEl) costEl.textContent = "";
          lastQuote.open = false;
          syncSubmitState();
          showErr(d && d.error ? d.error : "");
          return;
        }
        showErr("");
        state.cost = d.cost;
        if (costEl) costEl.textContent = "(" + d.cost + " 积分)";
        /* 灰度未开时按钮保持禁用，但价格照常显示 */
        lastQuote.open = d.available !== false && enabled;
        lastQuote.sufficient = d.sufficient !== false;
        /* GPU 按需开关：后端每次算价都会带上执行器在线状态 */
        if (typeof d.worker_online === "boolean") lastQuote.workerOnline = d.worker_online;
        /* 顺带把顶栏「可用积分」刷新成最新值（实充部分，赠送不可用于视频） */
        var balQ = $("vg-balance");
        if (balQ && d.video_points != null) balQ.textContent = String(d.video_points);
        syncSubmitState();
        if (lastQuote.open && !d.sufficient) {
          /*
           * 带一个直达入口：就地开充值弹窗，不用离开创作现场去 /?page=recharge。
           * ★ 有赠送积分时必须说清它不能用于视频，否则用户看着总余额够却被拒，
           *   只会以为是 bug（而不是去充值）。
           */
          var tip = "可用积分不足，还差 " + d.short_points + " 积分";
          if (d.bonus_points > 0) {
            tip += "（您的 " + d.bonus_points + " 赠送积分不可用于视频生成）";
          }
          showErr(tip, true);
        }
      })
      .catch(function () {
        /*
         * 算价失败不能静默：按钮上若留着上一次（甚至首屏直出）的价格，
         * 用户会按一个看起来更便宜的数字下单，实扣却是另一个数。
         * 清空价格并置灰创建按钮，逼他重试而不是带着错价提交。
         */
        state.cost = null;
        var costEl2 = $("vg-cost");
        if (costEl2) costEl2.textContent = "";
        lastQuote.open = false;
        syncSubmitState();
      });
  }

  // ── 提交 ─────────────────────────────────────────────────
  function submit() {
    if (!enabled || !loggedIn || state.submitting) return;
    var promptEl = $("vg-prompt");
    var prompt = promptEl ? promptEl.value.trim() : "";
    if (!prompt) { showErr("请先填写画面描述"); if (promptEl) promptEl.focus(); return; }
    state.submitting = true;
    var btn = $("vg-submit");
    var txt = $("vg-submit-text");
    syncSubmitState();
    if (txt) txt.textContent = "提交中…";
    showErr("");

    var fd = new FormData();
    fd.append("prompt", prompt);
    fd.append("seconds", String(state.seconds));
    fd.append("resolution", state.res);
    fd.append("aspect", state.aspect);
    fd.append("count", String(state.count));
    if (state.firstFrame) fd.append("first_frame", state.firstFrame);
    if (state.lastFrame) fd.append("last_frame", state.lastFrame);
    var csrf = document.querySelector('input[name="csrf"]');
    if (csrf) fd.append("csrf", csrf.value);

    fetch("/?ajax=video_submit", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.submitting = false;
        if (txt) txt.textContent = "创建";
        /* 不直接 disabled=false：描述可能已被清空、余额可能已不足，交给统一判定 */
        syncSubmitState();
        if (!d || !d.ok) {
          if (d && d.reason === "worker_offline") {
            /*
             * 在线时不轮询，所以「服务挂了」这件事是在用户点提交这一刻才发现的。
             * 除了立刻置灰 + 横幅，还要**顺势开启恢复探测**（60 秒一次），
             * 否则他会一直对着灰按钮，不知道什么时候能再用。
             */
            lastQuote.workerOnline = false;
            syncSubmitState();
            startPoll(false);
          }
          showErr((d && d.error) || "提交失败，请稍后重试");
          return;
        }
        if (window.ytToast) {
          window.ytToast("已提交 " + d.created + " 条，扣 " + d.points_spent + " 积分");
        }
        /* 顶栏显示的是「可用于视频的积分」= 实充部分，不是总余额 */
        var bal = $("vg-balance");
        if (bal && d.video_points != null) bal.textContent = String(d.video_points);
        if (d.tasks && d.tasks.length) {
          tasks = d.tasks.concat(tasks);
          state.activeId = d.tasks[0].id;
          render();
        }
        /* 清空描述，直接可以接着写下一条；顺带让按钮回到置灰态，
           避免用户手快连点两次、把同一段提示词提交两遍 */
        if (promptEl) promptEl.value = "";
        syncPromptUi();
        startPoll(true);
        estimate();
      })
      .catch(function () {
        state.submitting = false;
        if (txt) txt.textContent = "创建";
        syncSubmitState();
        showErr("网络异常，请稍后重试");
      });
  }

  function cancelTask(id) {
    if (!id) return;
    var fd = new FormData();
    fd.append("id", id);
    var csrf = document.querySelector('input[name="csrf"]');
    if (csrf) fd.append("csrf", csrf.value);
    fetch("/?ajax=video_cancel", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) {
          if (window.ytToast) window.ytToast((d && d.error) || "取消失败", "error");
          return;
        }
        if (window.ytToast) window.ytToast("已取消，积分已退回");
        var bal = $("vg-balance");
        if (bal && d.video_points != null) bal.textContent = String(d.video_points);
        loadTasks();
      })
      .catch(function () {
        if (window.ytToast) window.ytToast("网络异常，请稍后重试", "error");
      });
  }

  // ── 任务列表与轮询 ────────────────────────────────────────
  function loadTasks() {
    if (!loggedIn) { tasksLoaded = true; return Promise.resolve(); }
    return fetch("/?ajax=video_tasks&limit=30", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        tasksLoaded = true;
        if (!d || !d.ok) return;
        /*
         * 顺带同步执行器在线状态。
         * 状态一变就要重排轮询：离线→在线要停掉那条 60 秒探测（回到零开销），
         * 在线→离线则要把它开起来。重排交给调用方末尾的 startPoll，这里只改状态。
         */
        if (typeof d.worker_online === "boolean" && d.worker_online !== lastQuote.workerOnline) {
          lastQuote.workerOnline = d.worker_online;
          syncSubmitState();
        }
        tasks = d.tasks || [];
        if (d.queue) {
          var q = $("vg-queue");
          if (q) q.textContent = "队列 " + d.queue.pending + " 排队 / " + d.queue.running + " 生成中";
        }
        if (!state.activeId && tasks.length) state.activeId = tasks[0].id;
        render();
      })
      .catch(function () { tasksLoaded = true; /* 轮询失败静默，下一轮再来 */ });
  }

  function startPoll(force) {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (!loggedIn) return;
    var pending = tasks.some(function (t) { return t.status === "pending" || t.status === "running"; });
    /*
     * 轮询节奏 —— 只在"确实需要等待某件事"时才跑：
     *
     *   有任务在跑        → 3 秒。用户盯着进度条，必须及时。
     *   服务离线          → 60 秒。等它恢复；不探测的话用户会一直对着灰按钮，
     *                       不知道什么时候能用（提交虽有 503 兜底，但那要用户先点一下）。
     *   在线且没任务      → **完全不轮询**。这是绝大多数时间的状态，一个请求都不该发。
     *
     * GPU 现在是包年常开，"在线"是常态，所以这条路径必须是零开销 ——
     * 早先为了"按需开机"做的 30 秒固定轮询在这种部署下纯属浪费
     * （每个停留页面的用户每分钟 2 个请求，人一多就是白烧的 QPS）。
     * 常开不等于不会故障（worker 崩溃 / OOM / 网络抖动都会掉线），
     * 所以感知能力保留，只是把"定期问"改成"出事了才问"。
     *
     * 页面不可见时不轮询，别在后台标签页里空耗。
     */
    /*
     * 有任务时 15 秒（原来是 3 秒）：进度条已经由 `displayPct` 每秒本地插值推进，
     * 轮询只负责"确认状态真的变了"（完成/失败/进度校准）。
     * 一条任务平均 352 秒：3 秒轮询要 117 个请求，而 worker 心跳 30 秒一次 ——
     * 其中 106 个拿到的是完全相同的数据。降到 15 秒后是 23 个，进度条反而更顺滑。
     */
    var delay = pending ? 15000 : (force ? 3000 : (lastQuote.workerOnline ? 0 : 60000));
    tickInterp(pending);
    if (!delay) return;
    pollTimer = setTimeout(function () {
      if (document.hidden) { startPoll(false); return; }
      loadTasks().then(function () { startPoll(false); });
    }, delay);
  }

  function stateClass(s) {
    if (s === "succeeded") return "is-ok";
    if (s === "failed" || s === "canceled") return "is-bad";
    return "is-wait";
  }

  /** 时间戳 → 「08-22 20:43」。作品列表按时间倒序，用户主要靠它认自己刚生成的那条。 */
  function shortTime(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var p = function (n) { return n < 10 ? "0" + n : String(n); };
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /**
   * 渲染「我的作品」板块（定价表上方那块）。
   *
   * ⚠ 刻意**不再往 #vg-strip 里塞任务**：那条是演示素材，
   * 之前用 innerHTML 覆盖它会把演示轮播抓的 DOM 节点冲掉，一有作品案例轮播就哑了；
   * 用户也分不清哪个是自己生成的。两者现在彻底分家。
   */
  /**
   * 一张作品卡片的「视觉签名」：只要它没变，这张卡的 DOM 就不用动。
   *
   * 不含 progress —— 进度条宽度是单独用 CSSOM 改的，不需要重建整张卡。
   */
  function workSig(t) {
    return [t.status, t.video_url || "", t.points_spent, t.resolution, t.seconds].join("|");
  }

  function workCardHtml(t) {
    var ok = t.status === "succeeded" && t.video_url;
    var media;
    if (ok) {
      /*
       * ⚠ 必须 preload="none"，绝不能用 "metadata"。
       * 实测（2026-08-22）：写 metadata 时 Chrome 把**整个文件**下完（readyState 直接到 4），
       * 四条作品一进页面就拉 19MB —— 用户看到的就是「一直在加载」，
       * 点播放还因为同时维持多个解码上下文而崩溃。详见 PITFALLS 同名条目。
       */
      media =
        '<video class="vg-work-video" src="' + esc(t.video_url) + '" preload="none" ' +
        (t.poster_url ? 'poster="' + esc(t.poster_url) + '" ' : "") +
        'playsinline controls></video>';
    } else if (t.video_pending) {
      /*
       * 已完成但拿不到播放地址（存储未配好 / 上传中断）。
       * 不能落到下面"生成中"那个分支 —— 那会显示转圈 + "已完成 100%"，
       * 又是完成又在转，用户完全看不懂。这里明说状态，别让人干等。
       */
      media = '<div class="vg-work-holder is-wait">' +
              "<span>已生成，地址准备中</span>" +
              '<span class="vg-work-refund">稍后刷新查看</span></div>';
    } else if (t.status === "failed" || t.status === "canceled") {
      media = '<div class="vg-work-holder is-bad">' + esc(t.status_label || "已结束") +
              (t.refunded ? '<span class="vg-work-refund">积分已退回</span>' : "") + "</div>";
    } else {
      media =
        '<div class="vg-work-holder is-wait">' +
        '<div class="vg-work-spin"></div>' +
        "<span>" + esc(t.status_label || "生成中") + ' <i class="vg-work-pct">' + displayPct(t) + "</i>%</span>" +
        '<div class="vg-work-bar" data-pct="' + displayPct(t) + '"><i></i></div>' +
        "</div>";
    }
    return (
      '<div class="vg-work-box">' + media +
      '<span class="vg-work-spec">' + esc(String(t.resolution || "").toUpperCase()) +
      " · " + esc(t.seconds) + "s</span>" +
      "</div>" +
      '<div class="vg-work-meta">' +
      '<span class="vg-work-time">' + esc(shortTime(t.created_at)) + "</span>" +
      '<span class="vg-work-cost">' + esc(t.points_spent) + " 积分</span>" +
      /*
       * 「提示词」按钮：浏览器原生 video 菜单（那三个点）是 Chrome 自带的，
       * 我们插不进去，所以单独给一个按钮，和「下载」并排。
       * 各状态都给 —— 失败的作品同样需要看回当初写了什么，好改了重来。
       * 只存 id 不把提示词塞进 data 属性：一条能到 7000 字，几十张卡就是几百 KB 的 DOM。
       */
      (t.prompt
        ? '<button type="button" class="vg-work-prompt" data-vg-prompt="' + esc(t.id) + '"' +
          ' aria-label="查看这条作品的提示词">提示词</button>'
        : "") +
      (ok
        ? '<a class="vg-work-dl" href="' + esc(t.video_url) + '" download target="_blank" rel="noopener"' +
          ' aria-label="下载 ' + esc(String(t.resolution || "").toUpperCase()) + " " + esc(t.seconds) + ' 秒作品">下载</a>'
        : t.status === "pending"
          ? '<button type="button" class="vg-work-cancel" data-vg-cancel="' + esc(t.id) + '"' +
            ' aria-label="取消排队中的任务">取消</button>'
          : "") +
      "</div>"
    );
  }

  /**
   * 这一条任务此刻该显示多少百分比。
   *
   * 取「后端真值」与「本地按时间插值」的**较大者**：
   *   · 后端 progress 是 worker 30 秒心跳写的，准但跳跃；
   *   · 本地插值每秒平滑推进，但可能不准。
   * 取大者既保证不倒退（用户最忌讳进度条往回跳），又能平滑。
   *
   * 插值**封顶 95%**：剩下 5% 留给"真的完成"，否则进度条到 100% 了片子还没出来，
   * 比慢一点更让人焦虑。预估本身也刻意取 P75 偏保守（见后端 `video-eta.ts`）。
   */
  function displayPct(t) {
    var real = Math.max(0, Math.min(100, Number(t.progress) || 0));
    if (t.status !== "running" || !t.started_at) return real;
    var eta = etaTable[t.resolution + ":" + t.seconds];
    if (!eta || eta <= 0) return real;
    var began = Date.parse(t.started_at);
    if (!began) return real;
    var elapsed = (Date.now() - began) / 1000;
    var guess = Math.min(95, Math.round((elapsed / eta) * 95));
    return Math.max(real, guess);
  }

  /**
   * 每秒把"生成中"的卡片重画一次进度（纯本地计算，不发请求）。
   * 只在确实有任务在跑时开着，跑完立刻停 —— 空转的定时器也是开销。
   */
  function tickInterp(on) {
    if (tickTimerVg) { clearInterval(tickTimerVg); tickTimerVg = null; }
    if (!on) return;
    tickTimerVg = setInterval(function () {
      if (document.hidden) return;      /* 后台标签页没人看，别白算 */
      var any = false;
      for (var i = 0; i < tasks.length; i += 1) {
        var t = tasks[i];
        if (t.status !== "running" && t.status !== "pending") continue;
        any = true;
        var card = document.querySelector('.vg-work[data-work-id="' + t.id + '"]');
        if (card) patchProgress(card, t);
      }
      if (!any) { clearInterval(tickTimerVg); tickTimerVg = null; }
    }, 1000);
  }

  /** 生成中的卡片只更新进度条与百分比数字，不动 DOM 结构。 */
  function patchProgress(card, t) {
    var bar = card.querySelector(".vg-work-bar");
    var pct = Math.max(0, Math.min(100, displayPct(t)));
    if (bar) {
      bar.setAttribute("data-pct", String(pct));
      var fill = bar.querySelector("i");
      /* 用 CSSOM 而不是内联 style：站点 CSP 是 style-src 'self' */
      if (fill) fill.style.width = pct + "%";
    }
    var num = card.querySelector(".vg-work-pct");
    if (num) num.textContent = String(pct);
  }

  /**
   * 渲染「我的作品」板块（定价表上方那块）。
   *
   * ★ 增量更新，**绝不能整块 innerHTML 重刷**（2026-08-22 用户报障后改）：
   *   轮询每 3 秒跑一次，整块重建会把已完成作品的 <video> 元素连根销毁重造 ——
   *   表现为「黑圈转一下像刷新了」、正在看的视频被打断、
   *   右下角三个点菜单刚打开就被关掉。
   *   现在只有「视觉签名」变了的卡片才重建，生成中的卡片只改进度条数字。
   *
   * ⚠ 刻意不再往 #vg-strip 里塞任务：那条是演示素材，覆盖它会把演示轮播抓的 DOM 冲掉。
   */
  /** 作品筛选：all / succeeded / failed（失败含取消，都是「没拿到东西」） */
  var workFilter = "all";
  function filteredTasks() {
    if (workFilter === "succeeded") {
      return tasks.filter(function (t) { return t.status === "succeeded"; });
    }
    if (workFilter === "failed") {
      return tasks.filter(function (t) { return t.status === "failed" || t.status === "canceled"; });
    }
    return tasks;
  }

  /** 筛选条上的计数，让用户一眼知道有没有失败的。 */
  function syncWorkFilterUi() {
    var bar = $("vg-works-filter");
    if (!bar) return;
    var okN = tasks.filter(function (t) { return t.status === "succeeded"; }).length;
    var badN = tasks.filter(function (t) { return t.status === "failed" || t.status === "canceled"; }).length;
    var counts = { all: tasks.length, succeeded: okN, failed: badN };
    var btns = bar.querySelectorAll("[data-work-filter]");
    for (var i = 0; i < btns.length; i += 1) {
      var k = btns[i].dataset.workFilter;
      btns[i].classList.toggle("is-active", k === workFilter);
      var num = btns[i].querySelector(".vg-filter-num");
      if (num) num.textContent = String(counts[k] != null ? counts[k] : 0);
      /* 没有失败的就把「失败」这一档藏起来，不占位置 */
      if (k === "failed") btns[i].hidden = badN === 0;
    }
  }

  function render() {
    var box = $("vg-works");
    var grid = $("vg-works-grid");
    if (!box || !grid) return;
    if (!tasks.length) { box.hidden = true; return; }
    box.hidden = false;
    syncWorkFilterUi();

    var list = filteredTasks();
    var seen = Object.create(null);
    for (var i = 0; i < list.length; i += 1) {
      var t = list[i];
      seen[t.id] = 1;
      var card = grid.querySelector('.vg-work[data-work-id="' + t.id + '"]');
      var sig = workSig(t);
      if (!card) {
        card = document.createElement("div");
        card.className = "vg-work";
        card.setAttribute("data-work-id", t.id);
        card.setAttribute("data-sig", sig);
        card.innerHTML = workCardHtml(t);
        bindWorkCard(card);
        /* 新任务排在最前（列表本身就是时间倒序） */
        if (grid.firstChild) grid.insertBefore(card, grid.firstChild);
        else grid.appendChild(card);
        patchProgress(card, t);
      } else if (card.getAttribute("data-sig") !== sig) {
        card.setAttribute("data-sig", sig);
        card.innerHTML = workCardHtml(t);
        bindWorkCard(card);
        patchProgress(card, t);
      } else {
        /* 结构没变：只刷进度，绝不碰 DOM 结构（否则视频会被打断） */
        patchProgress(card, t);
      }
    }
    /* 清掉已经不在列表里的（比如被清理或过期） */
    var all = grid.querySelectorAll(".vg-work[data-work-id]");
    for (var k = 0; k < all.length; k += 1) {
      if (!seen[all[k].getAttribute("data-work-id")]) all[k].remove();
    }
    /* 筛选后一条都没有时给个说明，别让用户对着空白发呆 */
    var emptyEl = $("vg-works-empty");
    if (emptyEl) emptyEl.hidden = list.length > 0;
    /* 有成片时把右侧预览区也换成用户作品（上面看、下面管） */
    syncStripMode();
  }

  /** 卡片内的 <video> 绑定：播放态标记 + 点画面即播放。 */
  function bindWorkCard(card) {
    var v = card.querySelector(".vg-work-video");
    if (!v) return;
    var vbox = card.querySelector(".vg-work-box");
    v.addEventListener("play", function () { if (vbox) vbox.classList.add("is-playing"); });
    v.addEventListener("pause", function () { if (vbox) vbox.classList.remove("is-playing"); });
    /*
     * 点画面中央就播放。原生 controls 只认底部那条控制栏，
     * 而我们在中间画了个播放图标（CSS ::after），用户自然会去点它 ——
     * 不接管的话点了毫无反应（2026-08-22 用户反馈）。
     */
    v.addEventListener("click", function (ev) {
      /* 底部控制栏区域交给浏览器自己处理，别抢 */
      var r = v.getBoundingClientRect();
      if (ev.clientY > r.bottom - 42) return;
      if (v.paused) v.play().catch(function () { /* 用户手势缺失等，忽略 */ });
      else v.pause();
    });
  }

  /*
   * 说明：原先这里有个 renderPlayer(t)，把「当前选中的任务」渲染进顶部大播放器。
   * 2026-08-22 作品搬进独立板块后，顶部播放器只负责演示素材、作品在自己卡片里内联播放，
   * 这个函数就没有调用方了，连同 selectTask 一起删掉，避免留下会误导人的死代码。
   */

  /* ── 预览区轮播（演示素材 / 用户作品二选一）────────────────
   *
   * 缩略图与主播放器**同一组素材**，所以点哪个缩略图放的就是那一条。
   *
   * ★ 2026-08-22 起这条缩略图带是「双模」的：
   *   · 用户还没有作品 ⇒ 放我们的演示素材（新用户要先看到效果才会下单）
   *   · 用户有作品     ⇒ 整条换成他自己的作品，可以像切演示片一样切着看
   *   下方那个「我的作品」板块不撤，它负责下载/状态/积分这些管理动作 ——
   *   上面看、下面管。页面最底部的案例展示区始终保留，不受影响。
   *
   * ⚠ 节点**不能缓存**：切换模式时 strip 的内容会被换掉，
   *   缓存下来的引用会指向已经不在文档里的旧节点（这类坑本页踩过两次）。
   *   一律用 clipNodes() 实时查询。
   */
  /** 缩略图带每页放几个（和 CSS 的四列布局对齐） */
  var STRIP_PAGE_SIZE = 4;
  var stripPage = 0;

  function clipNodes() {
    return [].slice.call(document.querySelectorAll("#vg-strip [data-clip-src]"));
  }

  /** 作品多于一页时，在缩略图带下方给一排页码。 */
  function renderStripPager(pages) {
    var footer = document.querySelector(".vg-strip-footer");
    if (!footer) return;
    var old = footer.querySelector(".vg-strip-pager");
    if (old) old.remove();
    if (pages <= 1) return;
    var html = '<div class="vg-strip-pager">' +
      '<button type="button" class="vg-pager-btn" data-strip-page="prev"' +
      (stripPage === 0 ? " disabled" : "") + ' aria-label="上一页">‹</button>' +
      '<span class="vg-pager-info">' + (stripPage + 1) + " / " + pages + "</span>" +
      '<button type="button" class="vg-pager-btn" data-strip-page="next"' +
      (stripPage >= pages - 1 ? " disabled" : "") + ' aria-label="下一页">›</button>' +
      "</div>";
    footer.insertAdjacentHTML("afterbegin", html);
  }

  /**
   * 作品缩略图悬停预览：停 250ms 才起播，避免鼠标划过整排全部开始下载。
   * 与案例区同一套做法 —— video 绝对定位叠在封面图上，**不隐藏 img**
   * （img 撑着高度，隐藏了整排会跳）。
   */
  function bindWorkThumbHover(strip) {
    var cards = strip.querySelectorAll("[data-work-clip]");
    for (var i = 0; i < cards.length; i += 1) {
      (function (card) {
        if (card.dataset.hoverBound === "1") return;
        card.dataset.hoverBound = "1";
        var src = card.dataset.clipSrc || "";
        var box = card.querySelector(".vg-thumb-box");
        if (!src || !box) return;
        var vid = null;
        var timer = null;
        card.addEventListener("mouseenter", function () {
          if (timer) clearTimeout(timer);
          timer = setTimeout(function () {
            timer = null;
            if (vid) { vid.play().catch(function () {}); return; }
            vid = document.createElement("video");
            vid.className = "vg-thumb-hovervid";
            vid.muted = true;
            vid.loop = true;
            vid.playsInline = true;
            vid.preload = "auto";
            vid.poster = card.dataset.clipPoster || "";
            vid.src = src;
            box.appendChild(vid);
            vid.play().catch(function () {});
          }, 250);
        });
        card.addEventListener("mouseleave", function () {
          if (timer) { clearTimeout(timer); timer = null; }
          if (!vid) return;
          vid.pause();
          vid.remove();
          vid = null;   /* 移除而不是留着：一排 4 个都留着等于常驻 4 个解码器 */
        });
      })(cards[i]);
    }
  }

  /**
   * 把缩略图带切换到「用户作品」或「演示素材」。
   *
   * 演示节点是 PHP 渲染的静态 DOM（带 data-demo-src/data-demo-poster），
   * 这里给它们补上统一的 data-clip-*，作品节点也用同一套属性 ——
   * 于是 playDemo/markThumb/warmUpNext 不用关心当前是哪种模式。
   */
  function syncStripMode() {
    var strip = $("vg-strip");
    if (!strip) return;
    var done = tasks.filter(function (t) { return t.status === "succeeded" && t.video_url; });
    var wantWork = done.length > 0;
    var isWork = strip.dataset.mode === "work";
    var sigNow = done.map(function (t) { return t.id; }).join(",");

    if (!wantWork) {
      if (strip.dataset.mode === "demo") return;   /* 已经是演示模式，别重建 */
      strip.dataset.mode = "demo";
      strip.dataset.sig = "";
      /* 作品节点移除，演示节点显示出来并补 clip 属性 */
      strip.querySelectorAll("[data-work-clip]").forEach(function (n) { n.remove(); });
      strip.querySelectorAll("[data-demo-index]").forEach(function (n) {
        n.hidden = false;
        n.setAttribute("data-clip-src", n.dataset.demoSrc || "");
        n.setAttribute("data-clip-poster", n.dataset.demoPoster || "");
      });
      demoIdx = 0;
      return;
    }

    var pageSig = sigNow + "#" + stripPage;
    if (isWork && strip.dataset.sig === pageSig) return;  /* 作品与页码都没变，别重建（会打断播放） */
    strip.dataset.mode = "work";
    strip.dataset.sig = pageSig;
    /* 演示节点先藏起来（不删，切回演示模式时还要用），并摘掉 clip 属性免得被选中 */
    strip.querySelectorAll("[data-demo-index]").forEach(function (n) {
      n.hidden = true;
      n.removeAttribute("data-clip-src");
      n.removeAttribute("data-clip-poster");
    });
    strip.querySelectorAll("[data-work-clip]").forEach(function (n) { n.remove(); });
    /* 一屏放 4 个，多了翻页 —— 缩略图带宽度固定，硬塞会挤成条 */
    var pages = Math.max(1, Math.ceil(done.length / STRIP_PAGE_SIZE));
    if (stripPage >= pages) stripPage = pages - 1;
    if (stripPage < 0) stripPage = 0;
    var slice = done.slice(stripPage * STRIP_PAGE_SIZE, (stripPage + 1) * STRIP_PAGE_SIZE);
    var html = "";
    for (var i = 0; i < slice.length; i += 1) {
      var t = slice[i];
      html +=
        '<div class="vg-thumb" data-work-clip="' + esc(t.id) + '" data-demo-index="' + i + '"' +
        ' data-clip-src="' + esc(t.video_url) + '"' +
        ' data-clip-poster="' + esc(t.poster_url || "") + '">' +
        '<div class="vg-thumb-box">' +
        (t.poster_url
          ? '<img class="vg-thumb-img" src="' + esc(t.poster_url) + '" alt="" loading="lazy" decoding="async">'
          : '<div class="vg-thumb-blank"></div>') +
        '<div class="vg-thumb-play"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor">' +
        '<polygon points="5 3 19 12 5 21 5 3"/></svg></div>' +
        '<span class="vg-thumb-duration">' + esc(t.seconds) + "</span>" +
        "</div></div>";
    }
    strip.insertAdjacentHTML("afterbegin", html);
    renderStripPager(pages);
    bindWorkThumbHover(strip);
    demoIdx = 0;
    markThumb(0);
    /*
     * 主播放器切到第一条作品：**只换封面，不给 src**。
     *
     * ⚠ 别在这里 setAttribute("src") + load()：即便 preload="none"，
     *   显式 load() 也会把整个文件拉完（实测 readyState 直接到 4，白下 6.2MB）。
     *   真正的 src 等用户点缩略图/播放键时由 playDemo 设置 —— 那时才是他想看。
     */
    var v = $("vg-video");
    if (v && done[0]) {
      if (done[0].poster_url) v.setAttribute("poster", done[0].poster_url);
      else v.removeAttribute("poster");
      if (v.getAttribute("src") !== done[0].video_url) {
        v.removeAttribute("src");
        try { v.load(); } catch (_) { /* 只为清掉上一条演示片，不会拉新数据 */ }
      }
    }
    var badge = $("vg-badge");
    if (badge && done[0]) badge.textContent = String(done[0].resolution || "").toUpperCase();
  }
  function clipSrcs() { return clipNodes().map(function (n) { return n.dataset.clipSrc || ""; }); }
  function clipPosters() { return clipNodes().map(function (n) { return n.dataset.clipPoster || ""; }); }
  var demoIdx = 0;
  /* 用户手动按了暂停就别再被轮播/滚动唤醒，否则「点了暂停又自己播起来」 */
  var userPaused = false;
  /* 是否已由用户启动过播放。默认 false ⇒ 停在 poster、不下载视频、
     轮播与「滚回视口自动续播」都不生效（否则等于变相自动播放）。 */
  var started = false;

  function markThumb(i) {
    var ns = clipNodes();
    for (var k = 0; k < ns.length; k += 1) {
      ns[k].classList.toggle("is-active", k === i);
    }
  }

  /** 播放缩略图带里的第 i 条（演示素材或用户作品，取决于当前模式）。 */
  function playDemo(i, fromClick) {
    var srcs = clipSrcs();
    var posters = clipPosters();
    if (!srcs.length) return;
    var v = $("vg-video");
    if (!v) return;
    demoIdx = ((i % srcs.length) + srcs.length) % srcs.length;
    markThumb(demoIdx);
    if (v.getAttribute("src") !== srcs[demoIdx]) {
      /* 换片时同步换 poster：新片下载完成前先显示它的首帧，
         否则跨境拉流期间画面会黑一下（源站在洛杉矶） */
      if (posters[demoIdx]) v.setAttribute("poster", posters[demoIdx]);
      else v.removeAttribute("poster");
      v.setAttribute("src", srcs[demoIdx]);
      v.load();
    }
    /* 点缩略图算一次 user gesture ⇒ 顺势启动播放并开声音（与大按钮同一入口） */
    if (fromClick) {
      userPaused = false;
      startPlayback();
      return;
    }
    /* 非点击（轮播切片）：只有已经开播过才继续，否则保持在 poster 状态 */
    if (started && !userPaused) v.play().catch(function () {});
    syncPlayIcon();
  }

  /**
   * 启动播放 —— **同时取消静音**。
   *
   * 页面默认不自动播（`autoplay` 已去掉）：浏览器不允许带声音的视频自动播放，
   * 自动播就只能静音、用户还得再点一次喇叭。而这里是由用户点击触发的，
   * 属于 user gesture，可以直接带声音播 —— 少一步操作，也更符合「视频产品」的预期。
   */
  function startPlayback() {
    var v = $("vg-video");
    if (!v) return;
    /* 作品模式下主播放器初始没有 src（避免首屏白下一整条），点播放时补上当前这条 */
    if (!v.getAttribute("src")) {
      var srcs0 = clipSrcs();
      if (srcs0.length) {
        var po = clipPosters();
        if (po[demoIdx]) v.setAttribute("poster", po[demoIdx]);
        v.setAttribute("src", srcs0[demoIdx] || srcs0[0]);
        try { v.load(); } catch (_) { /* ignore */ }
      }
    }
    started = true;
    userPaused = false;
    v.muted = false;
    var box = $("vg-player");
    if (box) box.classList.add("is-started");
    var startBtn = $("vg-player-start");
    if (startBtn) startBtn.hidden = true;
    v.play().catch(function () {
      /* 极少数环境仍拦有声播放：退回静音播，至少画面能动 */
      v.muted = true;
      v.play().catch(function () {});
    });
    syncPlayIcon();
  }

  function togglePlay() {
    var v = $("vg-video");
    if (!v) return;
    /* 还没开播过：走启动流程（顺带开声音），而不是单纯 play() */
    if (!started) { startPlayback(); return; }
    if (v.paused) {
      userPaused = false;
      v.play().catch(function () {});
    } else {
      userPaused = true;
      v.pause();
    }
    syncPlayIcon();
  }

  /* ── 播放进度与时间 ────────────────────────────────────────
   *
   * ⚠ 这套控制条（播放键/时间/进度条/音量）是我们自己画的，**不是原生 controls**
   *   （`#vg-video` 没有 controls 属性）。它此前只接了播放与静音两个按钮，
   *   时间是 PHP 直出的死文本「0:00 / 0:15」、进度条宽度写死在 CSS 里的 25% ——
   *   播到第 6 秒时进度条仍停在 25%、时间仍显示 0:00，纯装饰。
   *   下面这几个函数才让它真正反映播放状态。
   */

  /** 秒 → `m:ss`。视频最长 15 秒，不用考虑小时。 */
  function fmtClock(sec) {
    var n = Math.max(0, Math.floor(Number(sec) || 0));
    return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
  }

  /**
   * 把进度条与时间刷成当前播放状态。
   *
   * 用 CSSOM 设 width 而不是内联 style 属性：站点 CSP 是 `style-src 'self'`
   * （作品卡片的进度条早先踩过同样的坑）。
   */
  function syncPlayProgress() {
    var v = $("vg-video");
    if (!v) return;
    var dur = Number(v.duration);
    var cur = Number(v.currentTime) || 0;
    var fill = $("vg-seek-fill");
    if (fill) {
      var pct = dur > 0 && isFinite(dur) ? Math.min(100, (cur / dur) * 100) : 0;
      fill.style.width = pct.toFixed(2) + "%";
    }
    /*
     * 缓冲条：弱网时用户能看出「在缓冲」而不是「卡死了」。
     * 取**包含当前播放点的那段** buffered —— 跳转过的视频会有多段缓冲区，
     * 直接用 buffered.end(0) 会显示成第一段的进度，跟当前位置对不上。
     */
    var buf = $("vg-seek-buffer");
    if (buf) {
      var end = 0;
      try {
        for (var i = 0; i < v.buffered.length; i += 1) {
          if (v.buffered.start(i) <= cur && cur <= v.buffered.end(i)) {
            end = v.buffered.end(i);
            break;
          }
        }
      } catch (e) { /* 某些状态下访问 buffered 会抛，忽略即可 */ }
      buf.style.width =
        dur > 0 && isFinite(dur) ? Math.min(100, (end / dur) * 100).toFixed(2) + "%" : "0";
    }
    var t = $("vg-player-time");
    if (t) {
      /* 元数据没加载出来时 duration 是 NaN，别显示成 "0:00 / NaN:aN" */
      t.textContent = fmtClock(cur) + " / " + (dur > 0 && isFinite(dur) ? fmtClock(dur) : "--:--");
    }
  }

  /** 指针位置 → 0~1 的比例（拿不到时长或宽度时返回 null）。 */
  function ratioAtClientX(clientX, bar) {
    var v = $("vg-video");
    if (!v || !bar) return null;
    var dur = Number(v.duration);
    if (!(dur > 0) || !isFinite(dur)) return null;   /* 元数据还没到，跳了也没意义 */
    var box = bar.getBoundingClientRect();
    if (!box.width) return null;
    return Math.min(1, Math.max(0, (clientX - box.left) / box.width));
  }

  /**
   * 拖动过程中**只画 UI，不真的 seek**。
   *
   * ⚠ 每次 mousemove 都写 `currentTime` 会让浏览器反复做 seek，
   *   高频下直接把页面拖住（实测 Playwright 里第二次拖拽就 hang 了 2 分钟）。
   *   所以拖动时只更新进度条与时间文本，松手时才落一次真实跳转。
   */
  function paintSeekPreview(ratio) {
    var v = $("vg-video");
    if (!v || ratio == null) return;
    var dur = Number(v.duration);
    var fill = $("vg-seek-fill");
    if (fill) fill.style.width = (ratio * 100).toFixed(2) + "%";
    var t = $("vg-player-time");
    if (t && dur > 0 && isFinite(dur)) {
      t.textContent = fmtClock(ratio * dur) + " / " + fmtClock(dur);
    }
  }

  /** 真正跳转（点击、以及拖拽松手时各调一次）。 */
  function seekToClientX(clientX, bar) {
    var v = $("vg-video");
    var ratio = ratioAtClientX(clientX, bar);
    if (!v || ratio == null) return;
    v.currentTime = ratio * Number(v.duration);
    syncPlayProgress();
  }

  /**
   * 拖拽 seek。
   *
   * 只在 `mousedown` 时才挂 move/up 监听、松手就摘掉 —— 常驻全局 mousemove
   * 会让整页每次鼠标移动都进一次 JS。
   * 拖动中标记 `is-dragging`：此时不让 `timeupdate` 回写进度，否则播放位置
   * 会跟手指打架（拖到 8 秒、timeupdate 又把它拉回 3 秒）。
   */
  var seekDragging = false;
  function bindSeekDrag() {
    if (window.__ytVgSeekBound) return;
    window.__ytVgSeekBound = true;
    document.addEventListener("mousedown", function (e) {
      var bar = e.target.closest ? e.target.closest(".vg-player-seekbar") : null;
      if (!bar) return;
      seekDragging = true;
      bar.classList.add("is-dragging");
      /* 按下也只预览、不跳 —— 与拖动中保持一致，松手时统一落一次 seek。
         按下就跳的话，「按下→拖走→松手」会连着触发两次 seek，视频元素容易卡在 seeking。 */
      paintSeekPreview(ratioAtClientX(e.clientX, bar));
      var lastX = e.clientX;
      var onMove = function (ev) {
        ev.preventDefault();       /* 拖动时别选中页面文字 */
        lastX = ev.clientX;
        /* 只画不跳：真正的 seek 留到松手（见 paintSeekPreview 的注释） */
        paintSeekPreview(ratioAtClientX(ev.clientX, bar));
      };
      var onUp = function () {
        seekDragging = false;
        bar.classList.remove("is-dragging");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        seekToClientX(lastX, bar);   /* 落一次真实跳转 */
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  /** 播放键在「播放中」显示暂停图标，反之显示播放图标。 */
  function syncPlayIcon() {
    var v = $("vg-video");
    var btn = $("vg-play-toggle");
    if (v && btn) {
      btn.innerHTML = v.paused
        ? '<svg class="vg-ctrl-icon" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
        : '<svg class="vg-ctrl-icon" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    }
    syncMuteIcon();
  }

  /**
   * 音量图标要反映静音状态，否则用户不知道「现在是静音、点一下能开声音」。
   *
   * 注意：**默认必须静音**。浏览器（Chrome/Safari/Firefox 一致）不允许带声音的
   * 视频自动播放，`autoplay` 且非 muted 会被直接拦掉 —— 所以只能静音自动播，
   * 由用户点一下开启声音。这是平台硬限制，不是我们的实现选择。
   */
  function syncMuteIcon() {
    var v = $("vg-video");
    var btn = $("vg-mute-toggle");
    if (!v || !btn) return;
    btn.innerHTML = v.muted
      ? '<svg class="vg-ctrl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>' +
        '<line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
      : '<svg class="vg-ctrl-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>' +
        '<path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
    btn.title = v.muted ? "点击开启声音" : "静音";
    btn.classList.toggle("is-muted", v.muted);
  }

  /* 顶部大播放器元素。原先定义在 renderPlayer 里，那个函数删掉时把它一并带走了，
     导致 initVideoGen 整个抛 ReferenceError（而 ytRunInits 静默吞异常，页面看着正常
     实则整个视频模块没初始化）。2026-08-22 补回。 */
  var vidEl = $("vg-video");

  if (vidEl) {
    /* 一条播完自动下一条（演示模式；真实任务产物保持单条循环）。
       只在用户已启动播放后才轮播 —— 否则未开播时切片等于变相自动播放。 */
    vidEl.addEventListener("ended", function () {
      /* 顶部播放器现在只放演示素材（作品在下方板块内联播放），不必再为任务特判 */
      if (!started) return;
      playDemo(demoIdx + 1, false);
    });
    vidEl.addEventListener("play", syncPlayIcon);
    vidEl.addEventListener("pause", syncPlayIcon);
    /*
     * 进度与时间：这三个事件缺一不可 ——
     *   timeupdate      播放中持续刷新（浏览器约 4 次/秒）
     *   loadedmetadata  拿到 duration 才能算百分比、才能显示总时长
     *   seeked          拖动/点击跳转后立刻校正，不等下一次 timeupdate
     * 换片（playDemo / syncStripMode 改 src）后 loadedmetadata 会重新触发，无需额外重置。
     */
    vidEl.addEventListener("timeupdate", function () {
      /* 拖动中由指针位置说了算，别让播放位置把进度条拽回去 */
      if (!seekDragging) syncPlayProgress();
    });
    /* 缓冲进度：下载过程中持续变化 */
    vidEl.addEventListener("progress", syncPlayProgress);
    vidEl.addEventListener("loadedmetadata", syncPlayProgress);
    vidEl.addEventListener("seeked", syncPlayProgress);
    /* 换源时先把进度归零，否则新片的 0 秒会短暂显示上一片的百分比 */
    vidEl.addEventListener("emptied", syncPlayProgress);
    /* 开播后顺手预热下一条，切片时无缝衔接 */
    vidEl.addEventListener("playing", function () { warmUpNext(); });
  }

  /* ── 空闲预热 ─────────────────────────────────────────────
   * 用户从进页面到点「播放」通常有好几秒，这段时间足够把片子拉完，
   * 点下去就能秒开。但**不能直接写 preload="auto"** ——
   * 那会在首屏就和 CSS/JS/首帧图抢带宽（源站在洛杉矶，带宽本就紧），
   * 而且用户要是不点播放、直接滚下去看案例，这 1.6MB 就白下了。
   *
   * 所以：等页面空闲（requestIdleCallback）再预热，且只预热**当前这一条**。
   */

  /** 弱网或用户开了「省流量」就别预热 —— 替他省钱比快那一下更重要。 */
  function shouldPrefetch() {
    /*
     * ★ 必须等作品列表回来再决定，否则会「抢跑」：
     *   页面刚打开时 tasks 还是空的，看起来像新用户 ⇒ 预热演示片 ⇒ 6.2MB 已经下下去了，
     *   等 loadTasks 回来发现人家有作品、预览区切成作品模式，那 6.2MB 就是纯浪费
     *   （2026-08-22 实测抓到）。登录用户一律等 tasksLoaded。
     */
    if (loggedIn && !tasksLoaded) return false;
    /* 已经有作品的用户不预热演示片：他进来是看自己的东西的 */
    if (tasks && tasks.length) return false;
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return true;
    if (c.saveData) return false;
    return !/(^|-)2g$|^3g$/.test(String(c.effectiveType || ""));
  }

  /** 把 <video> 的 preload 提到 auto，让浏览器后台缓冲（不播放）。 */
  /**
   * 预热当前这条演示片 —— **只拉开头一段，不是整个文件**（2026-08-22 改）。
   *
   * 原来是 `preload="auto" + load()`，一条 6.2MB 全下，新用户进页面就背着这个包袱。
   * 现在改用 Range 请求拉前 1.5MB（≈ 前 3~4 秒画面，视码率而定）：
   *   · 点播放时开头能立刻起播，感知上没差别；
   *   · 剩下的由播放器自己按需续拉，用户不点就一分钱带宽不花；
   *   · 拉进的是 HTTP 缓存，播放器随后请求同一区间会直接命中。
   * ⚠ 用 fetch 而不是给 <video> 设 preload：后者只有「全下」和「不下」两档，
   *   没法只要开头（`load()` 还会无视 preload=none 拉完整个文件，见 PITFALLS）。
   */
  var WARM_BYTES = 1_500_000;
  function warmUp(el) {
    if (!el || !shouldPrefetch()) return;
    if (el.dataset.warmed === "1") return;
    /* 已经开播就别再动：此时播放器自己在拉流，插一脚只会重复下载 */
    if (started || !el.paused || el.currentTime > 0) return;
    var src = el.getAttribute("src");
    if (!src) return;
    el.dataset.warmed = "1";
    warmRange(src);
  }

  /** 用 Range 把某个文件的开头拉进 HTTP 缓存。失败静默 —— 预热本就是锦上添花。 */
  function warmRange(src) {
    try {
      fetch(src, {
        headers: { Range: "bytes=0-" + (WARM_BYTES - 1) },
        credentials: "same-origin",
        /* 明确要走缓存：这段字节稍后播放器还会要一次 */
        cache: "force-cache",
      }).then(function (r) {
        /* 必须把 body 读掉，否则连接挂着、也不一定进缓存 */
        return r.arrayBuffer();
      }).catch(function () { /* 预热失败不影响任何功能 */ });
    } catch (_) { /* ignore */ }
  }

  /** 预热轮播的下一条：同样只拉开头一段（见 warmUp 的说明）。 */
  var warmedSrcs = Object.create(null);
  function warmUpNext() {
    var srcs = clipSrcs();
    if (!srcs.length || !shouldPrefetch()) return;
    var nextSrc = srcs[(demoIdx + 1) % srcs.length];
    if (!nextSrc || warmedSrcs[nextSrc]) return;
    warmedSrcs[nextSrc] = 1;
    /* 同样只拉开头：游离 <video> + preload=auto 会把整条下完，白花几 MB */
    warmRange(nextSrc);
  }

  var idleWarmDone = false;
  function idleWarm() {
    if (idleWarmDone) return;
    idleWarmDone = true;
    warmUp($("vg-video"));
  }
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(idleWarm, { timeout: 3000 });
  } else {
    /* Safari 没有 requestIdleCallback：退回定时器，1.5s 足够让首屏资源先落地 */
    setTimeout(idleWarm, 1500);
  }

  /* 滚出视口就暂停、滚回来接着播 —— 省带宽也省解码，
     用 IntersectionObserver 而不是 scroll 监听（后者每帧回调，白烧 CPU）。
     ⚠ 只对「已启动播放」的情况生效：没点过播放的话滚回来不该自己播起来。 */
  var playerBox = $("vg-player");
  if (playerBox && typeof IntersectionObserver === "function") {
    new IntersectionObserver(
      function (entries) {
        var v = $("vg-video");
        if (!v || !started) return;
        for (var i = 0; i < entries.length; i += 1) {
          if (entries[i].isIntersecting) {
            if (!userPaused) v.play().catch(function () {});
          } else if (!v.paused) {
            v.pause();
          }
        }
        syncPlayIcon();
      },
      { threshold: 0.25 },
    ).observe(playerBox);
  }

  /* ── 案例瀑布流的播放策略 ──────────────────────────────────
   * 桌面（支持 hover）：悬停播放，但**延迟 250ms 判定** ——
   *   鼠标快速划过一排卡片时不该连续创建/销毁十几个 video。
   * 移动端（无 hover）：没有悬停这回事，改成
   *   「进视口自动播第一条 + 其余点按播放」，点第二次暂停。
   */
  var canHover = !(window.matchMedia && window.matchMedia("(hover: none)").matches);
  if (!canHover) document.body.classList.add("vg-no-hover");
  var HOVER_DELAY = 250;

  var caseCards = document.querySelectorAll("#vg-cases [data-case-video]");
  for (var ci = 0; ci < caseCards.length; ci += 1) {
    (function (card, index) {
      var src = card.dataset.caseSrc || "";
      if (!src) return;
      var box = card.querySelector(".vg-case-img-box");
      var img = card.querySelector("img.vg-case-img");
      if (!box || !img) return;
      var vid = null;
      var enterTimer = null;

      /** 创建并播放（幂等）。video 绝对定位叠在封面图上，不进文档流。 */
      function attach() {
        if (vid) { vid.play().catch(function () {}); return; }
        vid = document.createElement("video");
        vid.className = "vg-case-img";
        vid.muted = true;
        vid.loop = true;
        vid.playsInline = true;
        vid.preload = "auto";
        /* poster 用封面图：视频还在缓冲时不会闪黑 */
        vid.poster = img.getAttribute("src") || "";
        vid.src = src;
        /* 绝对定位叠在封面图之上（CSS 里 video.vg-case-img 已声明），
           所以**不要**去隐藏封面图 —— 它负责撑住瀑布流的高度，
           隐藏了会让整列跳动，而且 display:block 会让 hidden 失效。 */
        box.appendChild(vid);
        card.classList.add("is-playing");
        vid.play().catch(function () {});
      }

      function detach() {
        if (enterTimer) { clearTimeout(enterTimer); enterTimer = null; }
        if (!vid) return;
        vid.pause();
        /* 直接移除而不是留着：留一堆已解码的视频在 DOM 里会持续占内存 */
        try { vid.remove(); } catch (_) { /* ignore */ }
        vid = null;
        card.classList.remove("is-playing");
      }

      if (canHover) {
        card.addEventListener("mouseenter", function () {
          if (enterTimer) clearTimeout(enterTimer);
          /* 延迟判定：划过就走的话这个 timer 会在 mouseleave 里被清掉，
             连一次网络请求都不会发出去 */
          enterTimer = setTimeout(function () { enterTimer = null; attach(); }, HOVER_DELAY);
        });
        card.addEventListener("mouseleave", detach);
      } else {
        /* 移动端：点按切换播放/停止（避开「使用提示词」按钮） */
        card.addEventListener("click", function (e) {
          if (e.target.closest && e.target.closest("[data-use-prompt]")) return;
          if (vid) detach();
          else attach();
        });
        /* 首条进视口时自动播一次，作为「这里是动图」的暗示；其余等点按 */
        if (index === 0 && typeof IntersectionObserver === "function") {
          var once = new IntersectionObserver(function (es) {
            for (var k = 0; k < es.length; k += 1) {
              if (es[k].isIntersecting) { attach(); once.disconnect(); }
            }
          }, { threshold: 0.5 });
          once.observe(card);
        }
      }
    })(caseCards[ci], ci);
  }

  // 首次进入初始化
  var p0 = $("vg-prompt");
  var c0 = $("vg-prompt-count");
  if (p0 && c0) c0.textContent = String(p0.value.length);
  /* 初始时长取页面上已标 is-active 的那档（PHP 渲染时定的），拿不到就用第一档 */
  var secBox = $("vg-sec");
  var activeSec = secBox ? secBox.querySelector("[data-vg-sec].is-active") : null;
  var opts0 = secOptions();
  setSec(activeSec ? Number(activeSec.dataset.vgSec) : (opts0.length ? opts0[0] : 5));
  var res0 = $("vg-res") ? $("vg-res").querySelector("[data-vg-res].is-active") : null;
  if (res0) syncSecLimits(Number(res0.dataset.maxSeconds || 15));
  syncPlayIcon();
  bindSeekDrag();
  syncPromptUi();   /* 首屏：字数归零、清空按钮隐藏、创建按钮置灰 */
  /* 先按「无作品」把演示节点补上 data-clip-*，否则 playDemo 找不到片源；
     loadTasks 回来后若有成片，render() 里的 syncStripMode 会再切成作品模式 */
  syncStripMode();
  if (loggedIn) estimate();
  loadTasks().then(function () { startPoll(false); });
});

/* 全部模块注册完毕后再跑初始化（勿提前调用，否则排序/进度条等后注册模块不会执行）。 */
window.ytRunInits();
