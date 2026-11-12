/**
 * 图片生成独立页（/image/）。价格一律来自 /?ajax=image_estimate，禁止前端自乘。
 */
(function () {
  "use strict";
  var shell = document.getElementById("ig-shell");
  if (!shell || shell.dataset.ytIgBound === "1") return;
  shell.dataset.ytIgBound = "1";

  var $ = function (id) { return document.getElementById(id); };
  var enabled = shell.dataset.enabled === "1";
  var loggedIn = shell.dataset.loggedIn !== "0";
  var maxPrompt = Number(shell.dataset.maxPrompt) || 2000;
  var maxPending = Math.max(1, Number(shell.dataset.maxPending) || 8);
  var models = [];
  try { models = JSON.parse(shell.dataset.models || "[]") || []; } catch (e) { models = []; }
  var styles = [];
  try { styles = JSON.parse(shell.dataset.styles || "[]") || []; } catch (e) { styles = []; }
  var inspirations = [];
  try { inspirations = JSON.parse(shell.dataset.inspirations || "[]") || []; } catch (e) { inspirations = []; }
  var maxStyleCombo = Number(shell.dataset.maxStyleCombo) || 3;

  var state = {
    modelId: "",
    mode: "t2i",
    count: 1,
    params: {},
    refs: [],
    cost: null,
    submitting: false,
    /* 当前预览对应的任务 id：成功图与生成中占位都用它高亮同一张作品卡 */
    activeId: "",
    /*
     * 已选风格 id，**顺序 = 优先级**（先选的是主风格，后端按此决定同维度矛盾词保留谁）。
     * ⚠ 别在前端拼 hint：合并规则（跨媒介互斥、同维度去重）只在后端实现一份，
     *   提交/优化时把 id 数组传过去即可（详见 image-models.ts 的 composeImageStyles）。
     */
    styleIds: [],
    /* 一键优化/灵感/反推之前的原文，「还原」用（视频同款 optBefore 模式） */
    optBefore: "",
    optimizing: false,
    describing: false,
    favs: null,
    /* 用户手动点选的作品 URL。非空时轮询不再抢占预览区（否则他刚点开旧图就被新图顶掉） */
    pickedUrl: "",
    /* 一键优化的中文译文缓存，键是英文原文 —— 同一段不重复翻译 */
    trans: {},
  };

  var rec = models.find(function (m) { return m.recommended && m.enabled; }) ||
    models.find(function (m) { return m.enabled; }) ||
    models[0];
  if (rec) state.modelId = rec.id;

  var activeCnt = document.querySelector("#ig-count .ig-seg-btn.is-active");
  if (activeCnt) state.count = Number(activeCnt.dataset.igCount) || 1;

  function currentModel() {
    return models.find(function (m) { return m.id === state.modelId; }) || null;
  }
  /**
   * 图生图能力：以后端 capabilities 为准。
   * Midjourney 没有对公官方 REST，旧数据若仍标 true 也一律当不支持。
   */
  function supportsI2i(m) {
    if (!m) return false;
    if (m.id === "midjourney-v8") return false;
    var max = m.capabilities ? Number(m.capabilities.max_reference_images || 0) : 0;
    return Boolean(m.capabilities && m.capabilities.image_to_image && max > 0);
  }
  function firstI2iModel() {
    return models.find(function (m) { return m.enabled && supportsI2i(m); }) ||
      models.find(function (m) { return supportsI2i(m); }) ||
      null;
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function csrf() {
    var el = document.querySelector("input[name=csrf]");
    return el ? el.value : "";
  }
  function toastErr(msg) {
    var el = $("ig-err");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
  }

  function optTip(msg, warn) {
    var el = $("ig-opt-tip");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.classList.toggle("is-warn", Boolean(warn));
  }

  /** 回填 textarea 并同步字数/清空按钮/提交态（走既有 input 监听，别重写一遍）。 */
  function setPromptText(text) {
    var ta = $("ig-prompt");
    if (!ta) return;
    ta.value = text;
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function styleById(id) {
    for (var i = 0; i < styles.length; i++) {
      if (styles[i].id === id) return styles[i];
    }
    return null;
  }

  /** 已选风格里第一个限定了媒介的（它决定其它风格能不能叠）。 */
  function baseMedium() {
    for (var i = 0; i < state.styleIds.length; i++) {
      var s = styleById(state.styleIds[i]);
      if (s && s.medium) return s.medium;
    }
    return null;
  }

  /**
   * 某个风格现在能不能选。
   *
   * 只判两件事（与后端 composeImageStyles 的前两条规则一致）：
   *   ① 媒介冲突：已有媒介基准且该风格是另一种媒介 → 不可叠（摄影 + 动漫 = 让模型二选一）
   *   ② 数量已满
   * ⚠ 这里**不做**片段级去重判断 —— 那是后端的事，前端算一遍必然漂移。
   */
  function styleBlockReason(s) {
    if (!s) return "";
    if (state.styleIds.indexOf(s.id) >= 0) return "";
    var base = baseMedium();
    if (s.medium && base && s.medium !== base) return "conflict";
    if (state.styleIds.length >= maxStyleCombo) return "full";
    return "";
  }

  /** 提交/优化用的提示词：只取用户文本，风格由后端按 id 拼接。 */
  function effectivePrompt() {
    var ta = $("ig-prompt");
    return (ta ? ta.value.trim() : "").slice(0, maxPrompt);
  }

  /**
   * 当前**真正生效**的参考图路径。
   *
   * ⚠ 估价与提交必须用同一个来源：切回文生图时 `state.refs` 不会被清空
   * （用户切回图生图还想用），若一边按 mode 过滤、另一边直接取 state.refs，
   * 就会出现「报价不含参考图加价、实扣含」——报价 ≠ 实扣是计费红线。
   */
  function activeRefs() {
    if (state.mode !== "i2i") return [];
    return state.refs.map(function (r) { return r && r.path; }).filter(Boolean);
  }

  /**
   * 重画风格 chips 的选中/置灰态。
   *
   * 置灰而不是隐藏：用户要能看到「动漫」还在那儿、只是与已选的「摄影」冲突，
   * 悬浮能读到原因。直接消失会让人以为功能坏了。
   */
  function renderStyles() {
    var box = $("ig-styles");
    if (!box) return;
    var chips = box.querySelectorAll(".ig-style-chip");
    for (var i = 0; i < chips.length; i++) {
      var b = chips[i];
      var s = styleById(b.dataset.igStyle);
      var on = state.styleIds.indexOf(b.dataset.igStyle) >= 0;
      var why = styleBlockReason(s);
      b.classList.toggle("is-active", on);
      b.classList.toggle("is-blocked", Boolean(why));
      /* 序号让「谁是主风格」可见 —— 顺序决定矛盾词保留谁，不显示用户无法理解结果差异 */
      var idxLabel = b.querySelector(".ig-style-ord");
      var ord = on ? state.styleIds.indexOf(b.dataset.igStyle) + 1 : 0;
      if (idxLabel) idxLabel.textContent = ord > 1 ? String(ord) : "";
      if (why === "conflict") {
        b.title = "与已选的画风不能叠加（先取消再选）";
      } else if (why === "full") {
        b.title = "最多叠加 " + maxStyleCombo + " 个风格";
      } else {
        b.title = (s && s.desc) || "";
      }
    }
    var tip = $("ig-style-tip");
    if (tip) {
      if (!state.styleIds.length) {
        tip.hidden = true;
      } else {
        var names = state.styleIds.map(function (id) {
          var s = styleById(id);
          return s ? s.label : id;
        });
        tip.textContent = names.length > 1
          ? "已叠加：" + names.join(" + ") + "（以「" + names[0] + "」为主）"
          : "已选：" + names[0];
        tip.hidden = false;
      }
    }
  }

  /** 忙态：按钮禁用 + 图标转 + 文案改「优化中…」（不改文案用户会以为没点上）。 */
  function setOptBusy(busy) {
    state.optimizing = busy;
    var btn = $("ig-prompt-opt");
    var txt = $("ig-prompt-opt-txt");
    if (btn) { btn.disabled = busy; btn.classList.toggle("is-busy", busy); }
    if (txt) txt.textContent = busy ? "优化中…" : "一键优化";
  }

  /**
   * 一键优化（对标 Ideogram Magic Prompt）。
   * 失败绝不挡创建：后端返 200+ok:false，这里只提示、原文不动。
   */
  function optimizePrompt() {
    if (state.optimizing) return;
    if (!loggedIn) { optTip("请先登录后再使用一键优化", true); return; }
    var ta = $("ig-prompt");
    var text = ta ? ta.value.trim() : "";
    if (!text) { optTip("请先填写画面描述", true); return; }
    var m = currentModel();
    setOptBusy(true);
    /* 分档给等待预期：长输入走「润色保细节」模式、输出更长也更慢，
       不说清楚用户会以为页面卡死（视频页踩过这个反馈）。 */
    optTip(
      text.length >= 160
        ? "正在按你写的细节重组并补齐构图 / 光线 / 质感，约 15~40 秒…"
        : "正在扩写成完整提示词（构图 / 光线 / 质感），约 8~25 秒…",
      false
    );
    var fd = new FormData();
    fd.set("csrf", csrf());
    fd.set("prompt", text);
    /* 顺序即优先级，逐个 append（不能 set 成逗号串，后端按数组读） */
    state.styleIds.forEach(function (id) { fd.append("styles[]", id); });
    fd.set("model_id", m ? m.id : "");
    fd.set("has_reference", state.mode === "i2i" && state.refs.length ? "1" : "0");
    fetch("/?ajax=image_optimize", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.prompt) {
          optTip((d && d.error) || "优化未成功，本次先用原文即可", true);
          return;
        }
        state.optBefore = text;
        setPromptText(d.prompt);
        var undo = $("ig-prompt-undo");
        if (undo) undo.hidden = false;
        /* 两种模式分开说：写了长描述的用户最怕"我的细节被删了"，
           笼统说一句「已优化」会让他不敢用第二次。 */
        var how = d.mode === "polish"
          ? " 字，保留了你写的细节并补齐构图 / 光线 / 质感。"
          : " 字，补齐了构图、光线、色彩与质感。";
        /* 有风格被丢弃时必须说清楚：用户选了三个却只生效两个，不解释就是「设置无效」 */
        var dropTip = "";
        if (d.styles_dropped && d.styles_dropped.length) {
          var names = d.styles_dropped.map(function (x) {
            var s = styleById(x.id);
            return (s ? s.label : x.id) + (x.reason === "medium_conflict" ? "（画风冲突）" : "");
          });
          dropTip = "未生效：" + names.join("、") + "。";
        }
        optTip(
          "已优化：" + text.length + " 字 → " + d.prompt.length + how + dropTip +
          "图中要渲染的文字保留原语言；不满意点「还原」。",
          false
        );
      })
      .catch(function () { optTip("网络波动，优化未成功，本次先用原文即可", true); })
      .finally(function () { setOptBusy(false); });
  }

  /**
   * 以图反推提示词（对标 Midjourney /describe）。
   *
   * 复用已上传的参考图，**多张会一起送去综合成一段**（不是逐张罗列）。
   * 与优化同口径：失败只提示、不动输入框；成功则存原文供「还原」。
   */
  function describeFromRef() {
    if (state.describing) return;
    if (!loggedIn) { optTip("请先登录后再使用以图反推", true); return; }
    var paths = state.refs.map(function (r) { return r && r.path; }).filter(Boolean);
    if (!paths.length) {
      optTip("请先在「参考图」里上传图片，再点以图反推", true);
      return;
    }
    state.describing = true;
    var btn = $("ig-prompt-desc");
    var txt = $("ig-prompt-desc-txt");
    if (btn) { btn.disabled = true; btn.classList.add("is-busy"); }
    if (txt) txt.textContent = "识图中…";
    /* 多图明显更慢（实测 4 张 17.6 秒 vs 单张 2 秒），预期要分开说 */
    optTip(
      paths.length > 1
        ? "正在综合 " + paths.length + " 张参考图反推提示词，约 10~40 秒…"
        : "正在读图并反推提示词，约 5~20 秒…",
      false
    );
    var fd = new FormData();
    fd.set("csrf", csrf());
    paths.forEach(function (p) { fd.append("refs[]", p); });
    fetch("/?ajax=image_describe", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok || !d.prompt) {
          optTip((d && d.error) || "反推未成功，可自己写一句描述", true);
          return;
        }
        var ta = $("ig-prompt");
        var cur = ta ? ta.value.trim() : "";
        if (cur) {
          state.optBefore = cur;
          var undo = $("ig-prompt-undo");
          if (undo) undo.hidden = false;
        }
        setPromptText(d.prompt);
        /* 「用了几张」只信后端下发的 used —— 超上限时它会截断，前端自己数会骗人 */
        var used = Number(d.used || 1);
        var skipped = Number(d.skipped || 0);
        optTip(
          (used > 1 ? "已综合 " + used + " 张参考图，" : "已读图，") +
          "反推出 " + d.prompt.length + " 字提示词（" +
          Math.max(1, Math.round((d.ms || 0) / 1000)) + " 秒）。" +
          (skipped > 0 ? "另有 " + skipped + " 张未参与（一次最多 " + used + " 张）。" : "") +
          "可直接改动，或点「一键优化」再加工。",
          false
        );
      })
      .catch(function () { optTip("网络波动，反推未成功", true); })
      .finally(function () {
        state.describing = false;
        if (btn) btn.classList.remove("is-busy");
        /* 文案与禁用态都交给 syncDescBtn（它按当前张数决定显示「以图反推」还是「反推 N 张」） */
        syncDescBtn();
      });
  }

  /**
   * 反推按钮：只在有参考图时可用，且文案随张数变化。
   * 不显示张数的话，用户不知道会不会把刚加的第二张也算进去。
   */
  function syncDescBtn() {
    var btn = $("ig-prompt-desc");
    var txt = $("ig-prompt-desc-txt");
    if (!btn) return;
    var n = state.refs.length;
    btn.disabled = state.describing || n === 0;
    if (txt && !state.describing) txt.textContent = n > 1 ? "反推 " + n + " 张" : "以图反推";
    btn.title = n === 0
      ? "先在下方「参考图」上传图片，再用它反推提示词"
      : n > 1
        ? "让 AI 读这 " + n + " 张参考图，综合成一段提示词"
        : "让 AI 读你的参考图，反推出可复现它的提示词";
  }

  // ── 提示词收藏夹 ────────────────────────────────────────────────

  function favDlg() { return $("ig-fav-dialog"); }

  function renderFavs() {
    var box = $("ig-fav-list");
    if (!box) return;
    if (state.favs === null) {
      box.innerHTML = '<p class="ig-fav-empty">正在加载…</p>';
      return;
    }
    if (!state.favs.length) {
      box.innerHTML = '<p class="ig-fav-empty">还没有收藏。写好一段提示词后点「收藏」，' +
        "以后一键取用。</p>";
      return;
    }
    box.innerHTML = state.favs.map(function (f) {
      var tags = (f.styles || []).map(function (id) {
        var s = styleById(id);
        return '<span class="ig-fav-tag">' + esc(s ? s.label : id) + "</span>";
      }).join("");
      return '<div class="ig-fav-item" data-fav-id="' + esc(f.id) + '">' +
        '<div class="ig-fav-main">' +
          '<div class="ig-fav-title">' + esc(f.title || "未命名") + tags + "</div>" +
          '<div class="ig-fav-text">' + esc(f.prompt) + "</div>" +
        "</div>" +
        '<div class="ig-fav-ops">' +
          '<button type="button" class="ig-fav-use" data-fav-use="' + esc(f.id) + '">填入</button>' +
          '<button type="button" class="ig-fav-ren" data-fav-ren="' + esc(f.id) + '">改名</button>' +
          '<button type="button" class="ig-fav-del" data-fav-del="' + esc(f.id) + '">删除</button>' +
        "</div>" +
      "</div>";
    }).join("");
  }

  function loadFavs(force) {
    if (state.favs !== null && !force) { renderFavs(); return; }
    renderFavs();
    fetch("/?ajax=image_favs", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        state.favs = (d && d.ok && Array.isArray(d.favorites)) ? d.favorites : [];
        renderFavs();
      })
      .catch(function () { state.favs = []; renderFavs(); });
  }

  function favOp(op, extra) {
    var fd = new FormData();
    fd.set("csrf", csrf());
    fd.set("op", op);
    Object.keys(extra || {}).forEach(function (k) {
      if (k === "styles") extra[k].forEach(function (v) { fd.append("styles[]", v); });
      else fd.set(k, extra[k]);
    });
    return fetch("/?ajax=image_favs", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); });
  }

  /** 收藏当前提示词（把已选风格一起存下来，取用时原样恢复）。 */
  function saveFavorite() {
    if (!loggedIn) { optTip("请先登录后再使用收藏", true); return; }
    var ta = $("ig-prompt");
    var text = ta ? ta.value.trim() : "";
    if (!text) { optTip("请先填写画面描述再收藏", true); return; }
    var m = currentModel();
    var title = window.prompt("给这条提示词起个名字（留空用开头几个字）", text.slice(0, 20));
    if (title === null) return;
    favOp("add", {
      prompt: text,
      title: title,
      styles: state.styleIds,
      model_id: m ? m.id : "",
    }).then(function (d) {
      if (!d || !d.ok) { optTip((d && d.error) || "收藏失败", true); return; }
      state.favs = null;
      optTip("已收藏。点「收藏夹」可随时取用。", false);
    }).catch(function () { optTip("网络波动，收藏失败", true); });
  }

  // ── 中文对照（悬停「译」按钮触发）──────────────────────────────

  /** 只有内容确实是英文时才提供翻译 —— 中文提示词翻了没意义。 */
  function looksEnglish(s) {
    var t = String(s || "");
    if (t.length < 20) return false;
    var zh = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    var en = (t.match(/[A-Za-z]/g) || []).length;
    return en > 40 && zh / Math.max(1, t.length) < 0.15;
  }

  /** 输入框内容变化时决定「译」按钮显隐。 */
  function syncTransBtn() {
    var btn = $("ig-prompt-trans");
    if (!btn) return;
    var ta = $("ig-prompt");
    var show = looksEnglish(ta ? ta.value : "");
    btn.hidden = !show;
    if (!show) {
      var box = $("ig-trans-box");
      if (box) box.hidden = true;
    }
  }

  var transTimer = null;
  var transSeq = 0;
  /**
   * 悬停即翻译。
   * 结果按原文缓存（state.trans）：同一段不重复请求，移开再移回是瞬时的。
   */
  function hoverTranslate() {
    var ta = $("ig-prompt");
    var text = ta ? ta.value.trim() : "";
    if (!looksEnglish(text)) return;
    var box = $("ig-trans-box");
    var body = $("ig-trans-body");
    var st = $("ig-trans-state");
    if (!box || !body) return;
    box.hidden = false;

    if (state.trans[text]) {
      body.textContent = state.trans[text];
      if (st) st.textContent = "";
      return;
    }
    if (!loggedIn) {
      body.textContent = "登录后可查看中文对照。";
      return;
    }
    body.textContent = "";
    if (st) st.textContent = "翻译中…";
    var seq = ++transSeq;
    var fd = new FormData();
    fd.set("csrf", csrf());
    fd.set("text", text);
    fetch("/?ajax=image_translate", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (seq !== transSeq) return; // 乱序返回丢弃
        if (st) st.textContent = "";
        if (d && d.ok && d.text) {
          state.trans[text] = d.text;
          body.textContent = d.text;
        } else {
          body.textContent = (d && d.error) || "翻译暂不可用，可直接提交英文提示词。";
        }
      })
      .catch(function () {
        if (seq !== transSeq) return;
        if (st) st.textContent = "";
        body.textContent = "网络波动，未能取到译文。";
      });
  }

  /** 灵感：随机填一条示例（覆盖前保留原文，可还原）。 */
  function fillInspiration() {
    if (!inspirations.length) return;
    var ta = $("ig-prompt");
    var cur = ta ? ta.value.trim() : "";
    var pick = inspirations[Math.floor(Math.random() * inspirations.length)];
    if (cur === pick && inspirations.length > 1) {
      pick = inspirations[(inspirations.indexOf(pick) + 1) % inspirations.length];
    }
    if (cur) {
      state.optBefore = cur;
      var undo = $("ig-prompt-undo");
      if (undo) undo.hidden = false;
    }
    setPromptText(pick);
    optTip("已填入示例，直接改动或点「一键优化」扩写成完整提示词。", false);
  }

  function renderModels() {
    var box = $("ig-models");
    if (!box) return;
    box.innerHTML = models.map(function (m) {
      var off = !m.enabled;
      var noI2i = state.mode === "i2i" && !supportsI2i(m);
      var rec = m.recommended ? '<span class="ig-model-badge">推荐</span>' : "";
      var badge = noI2i ? '<span class="ig-model-badge is-warn">暂不支持图生图</span>' : rec;
      var price = (m.price_per_image != null) ? m.price_per_image + " 积分起" : "";
      var cls = "ig-model" + (m.id === state.modelId ? " is-active" : "") +
        (off ? " is-off" : "") + (noI2i ? " is-no-i2i" : "");
      return '<button type="button" class="' + cls + '" data-ig-model="' + esc(m.id) + '"' +
        (noI2i ? ' aria-disabled="true"' : "") + ">" +
        '<span class="ig-model-name">' + esc(m.label) +
        '<span class="ig-model-vendor">' + esc(m.vendor || "") + "</span></span>" +
        '<span class="ig-model-tag">' + esc(m.tagline || "") + "</span>" +
        '<span class="ig-model-meta"><span class="ig-model-price">' + esc(price) + "</span>" + badge + "</span>" +
        "</button>";
    }).join("");
  }

  function defaultOf(ctl) {
    if (ctl.kind === "seed") return "";
    if (ctl.kind === "text") return ctl.default || "";
    return ctl.default;
  }

  /*
   * 「画面形状」类控件的 id：每家叫法不同（OpenAI/Seedream 用 size，
   * 其余多用 aspect_ratio）。命中的那一项挪到第二栏「画面比例」，
   * 因为它跟提示词、风格是同一个决策链，混在右侧技术参数里不好找。
   */
  var SHAPE_CTL_IDS = ["size", "aspect_ratio"];

  /**
   * 画面比例／尺寸是**必选项**：不给预选值，用户必须自己挑一个才能创建。
   * 理由是出图尺寸直接决定构图与价格，替他默认一个方图容易让人拿到不想要的画面。
   * 返回当前模型的形状控件 id（没有则 null）。
   */
  function shapeCtlId() {
    var m = currentModel();
    var list = (m && m.controls) || [];
    for (var i = 0; i < list.length; i++) {
      if (SHAPE_CTL_IDS.indexOf(list[i].id) >= 0) return list[i].id;
    }
    return null;
  }

  /** 形状控件是否已选（必选校验的唯一判据）。 */
  function shapeChosen() {
    var id = shapeCtlId();
    if (!id) return true; // 该模型没有这项，不构成阻塞
    return state.params[id] !== undefined && state.params[id] !== "";
  }

  /**
   * 单个控件的 HTML。
   * `wide` = 是否跨满两列（参数区是两列网格，选项多的控件挤在半列里会换行）。
   */
  function controlHtml(ctl) {
    var isShape = SHAPE_CTL_IDS.indexOf(ctl.id) >= 0;
    var val = state.params[ctl.id];
    /* 形状类是必选项：没选过就保持"无选中"，不落到 default 上 */
    if (val === undefined && !isShape) val = defaultOf(ctl);
    var opts = ctl.options || [];
    /*
     * 跨列判据：滑块单列够用（半列 ~135px），toggle 更是一行字；
     * select 要看**选项数**与**文案总长**两项 —— 只按选项数会漏掉
     * midjourney「默认（MJ 审美增强）／Raw（更贴提示词）」这种两项但很长的，
     * 它俩被压到 81px 而文字要 110px，`nowrap` 之下两个标签会叠在一起。
     */
    var labelLen = opts.reduce(function (n, o) { return n + String(o.label || "").length; }, 0);
    var wide = (ctl.kind === "select" && (opts.length >= 3 || labelLen >= 12)) ||
      ctl.kind === "text" || ctl.kind === "seed";
    var html = '<div class="ig-ctl' + (wide ? " is-wide" : "") + '" data-ctl="' + esc(ctl.id) + '">';
    /*
     * 标题行：名称 +（滑块的话）当前值右对齐。
     * 值原先单独占一行放在滑块下方，卡片就要多 20px 高 ——
     * 半列宽度下这 20px 足以把内容顶出卡片（实测「28」「3.5」显示在边框外）。
     */
    html += '<div class="ig-ctl-head"><span class="ig-ctl-lab">' + esc(ctl.label) + "</span>";
    if (ctl.kind === "slider") {
      html += '<span class="ig-range-val" data-ig-val="' + esc(ctl.id) + '">' + esc(val) + "</span>";
    }
    html += "</div>";
    /* hint 在半列宽度里限两行省略（CSS 侧 line-clamp），完整原文放 title 供悬停查看 */
    if (ctl.hint) {
      html += '<span class="ig-ctl-hint" title="' + esc(ctl.hint) + '">' + esc(ctl.hint) + "</span>";
    }
    if (ctl.kind === "select") {
      html += '<div class="ig-ctl-row">';
      opts.forEach(function (o) {
        var on = String(o.value) === String(val);
        html += '<button type="button" class="ig-chip' + (on ? " is-active" : "") +
          '" data-ig-ctl="' + esc(ctl.id) + '" data-val="' + esc(o.value) + '">' +
          esc(o.label) + "</button>";
      });
      html += "</div>";
    } else if (ctl.kind === "slider") {
      /* 当前值已渲染在标题行右侧，这里只出滑杆 */
      html += '<input type="range" class="ig-range" data-ig-ctl="' + esc(ctl.id) +
        '" min="' + ctl.min + '" max="' + ctl.max + '" step="' + ctl.step +
        '" value="' + esc(val) + '">';
    } else if (ctl.kind === "toggle") {
      html += '<label class="ig-toggle"><input type="checkbox" data-ig-ctl="' + esc(ctl.id) + '"' +
        (val ? " checked" : "") + "> " + esc(ctl.label) + "</label>";
    } else if (ctl.kind === "text") {
      html += '<input class="ig-textin" data-ig-ctl="' + esc(ctl.id) + '" maxlength="' +
        (ctl.max_length || 200) + '" placeholder="' + esc(ctl.placeholder || "") +
        '" value="' + esc(val || "") + '">';
    } else if (ctl.kind === "seed") {
      html += '<input class="ig-seed" data-ig-ctl="' + esc(ctl.id) +
        '" inputmode="numeric" placeholder="留空=随机" value="' + esc(val || "") + '">';
    }
    return html + "</div>";
  }

  function renderControls() {
    var m = currentModel();
    var box = $("ig-controls");
    var shapeBox = $("ig-controls-shape");
    var shapeField = $("ig-shape-field");
    if (!box || !m) {
      if (box) box.innerHTML = "";
      if (shapeBox) shapeBox.innerHTML = "";
      if (shapeField) shapeField.hidden = true;
      return;
    }
    var all = m.controls || [];
    var shape = all.filter(function (c) { return SHAPE_CTL_IDS.indexOf(c.id) >= 0; });
    var rest = all.filter(function (c) { return SHAPE_CTL_IDS.indexOf(c.id) < 0; });

    if (shapeBox) {
      shapeBox.innerHTML = shape.map(controlHtml).join("");
    }
    /* 该模型没有形状类参数时整块收起，不留空标题 */
    if (shapeField) shapeField.hidden = shape.length === 0;
    syncShapeRequired();
    box.innerHTML = rest.map(controlHtml).join("");
    syncRefsField();
    syncCtlScrollHint();
  }

  /** 未选尺寸时给出红色必选提示；选了就恢复常态。 */
  function syncShapeRequired() {
    var field = $("ig-shape-field");
    var tip = $("ig-shape-req");
    if (!field) return;
    var need = Boolean(shapeCtlId()) && !shapeChosen();
    field.classList.toggle("is-required", need);
    if (tip) tip.hidden = !need;
  }

  /*
   * 参数多的模型（midjourney 6 项、ideogram 5 项）内容装不进固定高度，
   * 参数区会内部滚动。细滚动条在深色底上不明显，加一道底部渐隐提示"下面还有"。
   * ⚠ 只在真的可滚时加类：不可滚时那道渐隐会白白遮住最后一张卡的底边。
   */
  function syncCtlScrollHint() {
    var box = $("ig-controls");
    var field = box && box.closest(".ig-field-params");
    if (!box || !field) return;
    /* innerHTML 之后布局未必已完成，等一帧再量 */
    requestAnimationFrame(function () {
      field.classList.toggle("is-scrollable", box.scrollHeight > box.clientHeight + 1);
    });
  }
  window.addEventListener("resize", syncCtlScrollHint);

  function collectParams() {
    var m = currentModel();
    var out = {};
    if (!m) return out;
    (m.controls || []).forEach(function (ctl) {
      if (SHAPE_CTL_IDS.indexOf(ctl.id) >= 0) {
        /* 形状必选：没选就不传，让后端 need_shape 拦住，禁止回落到 default */
        if (state.params[ctl.id] !== undefined && state.params[ctl.id] !== "") {
          out[ctl.id] = state.params[ctl.id];
        }
        return;
      }
      if (state.params[ctl.id] !== undefined) out[ctl.id] = state.params[ctl.id];
      else out[ctl.id] = defaultOf(ctl);
    });
    return out;
  }

  function initParamsFromModel() {
    var m = currentModel();
    state.params = {};
    if (!m) return;
    (m.controls || []).forEach(function (ctl) {
      if (SHAPE_CTL_IDS.indexOf(ctl.id) >= 0) return; // 必选，不预填
      state.params[ctl.id] = defaultOf(ctl);
    });
  }

  function syncRefsField() {
    var m = currentModel();
    var field = $("ig-refs-field");
    var i2i = document.querySelector('[data-ig-mode="i2i"]');
    var anyI2i = models.some(supportsI2i);
    if (i2i) i2i.disabled = !anyI2i;
    if (state.mode === "i2i" && !supportsI2i(m)) {
      var next = firstI2iModel();
      if (next) {
        state.modelId = next.id;
        initParamsFromModel();
        m = next;
      } else {
        state.mode = "t2i";
        document.querySelectorAll("#ig-modes .ig-mode").forEach(function (b) {
          b.classList.toggle("is-active", b.dataset.igMode === "t2i");
        });
      }
    }
    var max = m && m.capabilities ? Number(m.capabilities.max_reference_images || 0) : 0;
    var support = supportsI2i(m);
    renderModels();
    if (field) field.hidden = !(support && state.mode === "i2i");
    var hint = $("ig-refs-hint");
    if (hint && max) hint.textContent = "最多 " + max + " 张，JPG / PNG / WebP，单张 12MB";
    if (state.refs.length > max) state.refs = state.refs.slice(0, max);
    renderRefs();
  }

  function renderRefs() {
    var box = $("ig-refs");
    if (!box) return;
    var m = currentModel();
    var max = m && m.capabilities ? Number(m.capabilities.max_reference_images || 0) : 0;
    var html = state.refs.map(function (r, i) {
      return '<div class="ig-ref-slot"><img src="' + esc(r.url) + '" alt="">' +
        '<button type="button" class="ig-ref-del" data-ig-ref-del="' + i + '">×</button></div>';
    }).join("");
    if (state.refs.length < max) {
      html += '<button type="button" class="ig-ref-slot" id="ig-ref-add"><span class="ig-ref-add">+</span></button>';
    }
    box.innerHTML = html;
  }

  var estTimer = null;
  var estSeq = 0;
  function scheduleEstimate() {
    if (!loggedIn) return;
    clearTimeout(estTimer);
    // 400ms：滑块拖动会连发 input 事件，280ms 仍会打出一串请求
    estTimer = setTimeout(doEstimate, 400);
  }

  function doEstimate() {
    var m = currentModel();
    var btn = $("ig-cost");
    if (!m || !loggedIn) return;
    /* 没选尺寸就不要拿 default 去估价，否则按钮上的数字会骗人 */
    if (!shapeChosen()) {
      if (btn) btn.textContent = "";
      state.cost = null;
      renderCostDetail(null);
      syncSubmit();
      return;
    }
    var seq = ++estSeq;
    var fd = new FormData();
    fd.set("csrf", csrf());
    fd.set("model_id", m.id);
    fd.set("count", String(state.count));
    fd.set("params", JSON.stringify(collectParams()));
    /* 参考图张数参与算价（每张 +5%）：与提交同源 activeRefs()，杜绝报价≠实扣 */
    fd.set("ref_count", String(activeRefs().length));
    fetch("/?ajax=image_estimate", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        // 乱序返回的旧请求直接丢弃，否则按钮上会显示上一次参数的价格
        if (seq !== estSeq) return;
        if (d && d.image_points != null && $("ig-balance")) {
          $("ig-balance").textContent = String(d.image_points);
        }
        if (!d || !d.ok) {
          if (btn) btn.textContent = "";
          state.cost = null;
          renderCostDetail(null);
          if (d && d.error) toastErr(d.error);
          syncSubmit();
          return;
        }
        toastErr("");
        state.cost = d.cost;
        if (btn) btn.textContent = "（" + d.cost + " 积分）";
        renderCostDetail(d);
        syncSubmit();
      })
      .catch(function () { /* 网络抖动不刷红字 */ });
  }

  /**
   * 价格明细。
   *
   * 同一个模型现在会有好几个价（质量 / 尺寸 / 参考图张数都加价），不摊开的话
   * 用户看到数字变动只会觉得是乱收费。**夹顶更要说** —— 不提示的话用户会以为
   * 「我加了功能价格没变，是不是坏了」。
   */
  function renderCostDetail(d) {
    var box = $("ig-cost-detail");
    if (!box) return;
    var b = d && d.breakdown;
    if (!b || !d.ok) { box.hidden = true; box.innerHTML = ""; return; }
    var items = Array.isArray(b.items) ? b.items : [];
    if (!items.length && !b.capped) {
      /* 默认档无加价：说一句「已是基础价」比空着好，用户才知道没被加价 */
      box.innerHTML = '<span class="ig-cost-plain">基础价 ' + esc(b.base) + " 积分 / 张</span>";
      box.hidden = false;
      return;
    }
    var rows = items.map(function (it) {
      var pct = Math.round((Number(it.multiplier) - 1) * 100);
      var cls = pct > 0 ? "ig-cost-up" : "ig-cost-down";
      var sign = pct > 0 ? "+" : "";
      return '<span class="ig-cost-row"><i>' + esc(it.label) + "</i>" +
        '<b class="' + cls + '">' + sign + pct + "%</b></span>";
    }).join("");
    var head = '<span class="ig-cost-row"><i>基础价</i><b>' + esc(b.base) + "</b></span>";
    var tail = '<span class="ig-cost-row ig-cost-total"><i>每张</i><b>' + esc(d.unit_cost) + " 积分</b></span>";
    var cap = b.capped
      ? '<p class="ig-cost-capped">已达单张上限 ' + esc(b.cap) +
        " 积分，超出部分不再计费（原价 " + esc(b.uncapped) + "）。</p>"
      : "";
    box.innerHTML = head + rows + tail + cap;
    box.hidden = false;
  }

  function syncSubmit() {
    var btn = $("ig-submit");
    if (!btn) return;
    var prompt = ($("ig-prompt") && $("ig-prompt").value.trim()) || "";
    var m = currentModel();
    var avail = enabled && m && m.available;
    var needRef = state.mode === "i2i" && state.refs.length < 1;
    var needShape = !shapeChosen();
    var ok = loggedIn && prompt && avail && !state.submitting && !needRef && !needShape;
    btn.disabled = !ok;
    btn.title = !loggedIn ? "请先登录"
      : !prompt ? "请先填写画面描述"
      : !enabled ? "功能暂未开放"
      : !m ? "请选择模型"
      : !m.available ? "该模型正在接入中"
      : needRef ? "图生图请至少上传一张参考图"
      : needShape ? "请先选择画面比例 / 尺寸"
      : "创建图片";
    syncShapeRequired();
  }

  function submit() {
    if (state.submitting) return;
    var prompt = effectivePrompt();
    var m = currentModel();
    if (!prompt || !m) return;
    if (!shapeChosen()) {
      toastErr("请先选择画面比例 / 尺寸");
      syncSubmit();
      return;
    }
    state.submitting = true;
    syncSubmit();
    toastErr("");
    var fd = new FormData();
    fd.set("csrf", csrf());
    fd.set("prompt", prompt);
    fd.set("model_id", m.id);
    fd.set("count", String(state.count));
    fd.set("params", JSON.stringify(collectParams()));
    /* 与估价同源：activeRefs() 已按模式过滤，两边张数必然一致 */
    activeRefs().forEach(function (p) { fd.append("refs[]", p); });
    /* 风格只传 id，拼接由后端做（顺序即优先级，逐个 append） */
    state.styleIds.forEach(function (id) { fd.append("styles[]", id); });
    fetch("/?ajax=image_submit", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (x) {
        var d = x.d || {};
        if (d.image_points != null && $("ig-balance")) $("ig-balance").textContent = String(d.image_points);
        if (x.status === 402 || d.reason === "insufficient_real_balance") {
          toastErr(d.error || "可用积分不足");
          var dlg = $("ig-recharge-dialog");
          if (dlg && dlg.showModal) try { dlg.showModal(); } catch (e) {}
          return;
        }
        if (!d.ok) {
          toastErr(d.error || "提交失败");
          return;
        }
        if (typeof window.ytToast === "function") {
          var n = Number(state.count) || 1;
          window.ytToast(n > 1 ? ("已提交 " + n + " 张，正在生成") : "已提交，正在生成");
        }
        pollNow();
      })
      .catch(function () { toastErr("网络错误，请稍后重试"); })
      .finally(function () { state.submitting = false; syncSubmit(); });
  }

  function uploadRef(file) {
    if (!file) return;
    var fd = new FormData();
    fd.set("csrf", csrf());
    fd.set("ref", file);
    fetch("/?ajax=image_ref", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) { toastErr(d && d.error ? d.error : "上传失败"); return; }
        state.refs.push({ path: d.path, url: d.url });
        renderRefs();
        syncDescBtn();
        scheduleEstimate();
        syncSubmit();
      })
      .catch(function () { toastErr("上传失败"); });
  }

  /*
   * 轮询策略（刻意做得保守）：
   * 每一跳都要经 PHP 转发再打后端，而 php-fpm 只有二十来个进程 —— 固定 2.5 秒
   * 意味着 10 个人同时生成就占掉每秒 4 个进程。所以：
   *   · 退避：2.5s 起，每次 ×1.5 直到 12s 上限（有状态变化则复位到起点）
   *   · 标签页不可见时**完全停轮询**，切回来立刻补一次
   *   · 网络错误也走退避，不贴着重试
   */
  var POLL_MIN = 2500;
  var POLL_MAX = 12000;
  var pollTimer = null;
  var pollDelay = POLL_MIN;
  var lastSig = "";
  var loadedHomeLimit = 0;
  var worksTotal = 0;
  var libraryTotal = 0;

  function homeWorksLimit() {
    var box = $("ig-works");
    if (!box) return 7;
    var n = parseInt(getComputedStyle(box).getPropertyValue("--ig-work-cols"), 10);
    return Number.isFinite(n) && n > 0 ? n : 7;
  }

  function syncMoreWorks() {
    var btn = $("ig-more-works");
    if (!btn) return;
    btn.hidden = !loggedIn;
    btn.textContent = "查看库（" + libraryTotal + "张）";
  }

  function schedulePoll(delay) {
    clearTimeout(pollTimer);
    if (document.hidden) return; // 后台标签不轮询，靠 visibilitychange 唤回
    pollTimer = setTimeout(loadTasks, delay);
  }

  function loadTasks() {
    if (!loggedIn) return Promise.resolve();
    var limit = homeWorksLimit();
    loadedHomeLimit = limit;
    /* 首页只画一排，但轮询要覆盖全部在途任务，否则移动端两列时第 3~8 张完成不会提示 */
    var queryLimit = Math.max(limit, maxPending);
    return fetch("/?ajax=image_tasks&page=1&page_size=" + queryLimit, { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d || !d.ok) {
          pollDelay = Math.min(POLL_MAX, pollDelay * 1.5);
          schedulePoll(pollDelay);
          return;
        }
        var tasks = d.tasks || [];
        worksTotal = Math.max(tasks.length, Number(d.total) || 0);
        libraryTotal = Math.max(0, Number(d.library_total) || 0);
        syncMoreWorks();
        renderWorks(tasks);
        var q = d.queue || {};
        var hint = $("ig-queue-hint");
        if (hint) {
          hint.textContent = (q.pending || q.running)
            ? ("排队 " + (q.pending || 0) + " · 生成中 " + (q.running || 0))
            : "";
        }
        var busy = tasks.some(function (t) {
          return t.status === "pending" || t.status === "running";
        });
        clearTimeout(pollTimer);
        if (busy) schedulePoll(pollDelay);
      })
      .catch(function () {
        pollDelay = Math.min(POLL_MAX, pollDelay * 1.5);
        schedulePoll(pollDelay);
      });
  }

  /** 有新任务或用户主动操作后，把退避复位，保证首屏反馈仍然快。 */
  function pollNow() {
    pollDelay = POLL_MIN;
    clearTimeout(pollTimer);
    loadTasks();
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      clearTimeout(pollTimer);
      return;
    }
    // 切回来时用户最想知道的就是「好了没」，立刻补一次
    pollNow();
  });

  var worksResizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(worksResizeTimer);
    worksResizeTimer = setTimeout(function () {
      if (loggedIn && homeWorksLimit() !== loadedHomeLimit) pollNow();
    }, 180);
  });

  /* 首页仅缓存当前断点的一排作品；完整历史由弹窗按页读取 */
  var lastTasks = [];
  /* 上一轮任务状态：只认 busy → succeeded 为“刚完成”，首轮加载不误报历史作品 */
  var lastTaskStates = null;

  function workCardHtml(t, context) {
    var ok = t.status === "succeeded" && t.image_url;
    var busy = t.status === "pending" || t.status === "running";
    var bad = t.status === "failed" || t.status === "canceled" || t.status === "cancelled";
    var body;
    if (ok) {
      body = '<img class="ig-work-img" src="' + esc(t.image_url) + '" alt="" loading="lazy">';
    } else if (busy) {
      var p = Math.max(0, Math.min(100, Number(t.progress) || 0));
      body = '<div class="ig-work-holder is-gen" style="--p:' + p + '">' +
        esc(t.status_label || "生成中") + (p ? " " + p + "%" : "") + "</div>";
    } else {
      body = '<div class="ig-work-holder' + (bad ? " is-bad" : "") + '">' +
        esc(t.status_label || t.status) + "</div>";
    }

    var acts = "";
    if (context === "home" && t.status === "pending") {
      acts = '<button type="button" class="ig-work-dl" data-ig-cancel="' + esc(t.id) + '">取消</button>';
    }
    if (t.prompt) {
      acts += '<button type="button" class="ig-work-prompt" data-ig-prompt="' + esc(t.id) +
        '" title="查看提示词">词</button>';
    }
    if (ok) {
      acts += '<a class="ig-work-dl" href="' + esc(t.image_url) +
        '" download="' + esc(viewerDownloadName(t)) +
        '" target="_blank" rel="noopener" title="下载">下载</a>';
    }
    return '<div class="ig-work-box' + (busy ? " is-gen" : "") + '" data-id="' + esc(t.id) + '"' +
      (ok ? ' data-ig-pick="' + esc(t.image_url) + '"' : "") + ">" + body +
      '<div class="ig-work-bar">' +
        '<span class="ig-work-cost-tag">' + esc(t.points_spent || "") + "</span>" +
        '<span class="ig-work-acts">' + acts + "</span>" +
      "</div></div>";
  }

  function pulseWorkCard(id) {
    requestAnimationFrame(function () {
      document.querySelectorAll(".ig-work-box[data-id]").forEach(function (box) {
        if (String(box.dataset.id) !== String(id)) return;
        box.classList.remove("is-just-done");
        void box.offsetWidth;
        box.classList.add("is-just-done");
        setTimeout(function () { box.classList.remove("is-just-done"); }, 3100);
      });
    });
  }

  function renderWorks(tasks) {
    var box = $("ig-works");
    var preview = $("ig-preview");
    if (!box) return;
    var incoming = tasks || [];
    var newlyDone = [];
    if (lastTaskStates) {
      newlyDone = incoming.filter(function (t) {
        var before = lastTaskStates[t.id];
        return (before === "pending" || before === "running") &&
          t.status === "succeeded" && t.image_url;
      });
    }
    var nextStates = Object.create(null);
    incoming.forEach(function (t) { nextStates[t.id] = t.status; });
    lastTaskStates = nextStates;
    lastTasks = incoming;

    /*
     * 内容没变就不重建 DOM。整块 innerHTML 重写会让全部 <img> 重新创建、
     * 重新解码，轮询期间画面会持续闪一下 —— 而绝大多数轮询返回的是同一份数据。
     */
    var sig = lastTasks.map(function (t) {
      return t.id + ":" + t.status + ":" + (t.progress || 0) + ":" + (t.image_url || "");
    }).join("|");
    if (sig === lastSig) return;
    lastSig = sig;
    // 状态真变了，说明还在推进，把退避复位以便下一跳更快
    pollDelay = POLL_MIN;

    if (!lastTasks.length) {
      box.innerHTML = '<div class="ig-works-empty">还没有作品，填写描述后点创建</div>';
      syncStageNav();
      return;
    }

    box.innerHTML = lastTasks.slice(0, homeWorksLimit()).map(function (t) {
      return workCardHtml(t, "home");
    }).join("");

    /*
     * 新任务完成：自动切换并高亮新作品，但不滚屏。
     * 用户点过生成中卡片后，轮询只更新它的预览进度；普通翻页不改变当前预览。
     */
    var done = lastTasks.filter(function (t) { return t.status === "succeeded" && t.image_url; });
    var activeTask = state.activeId ? taskById(state.activeId) : null;
    if (newlyDone.length) {
      newlyDone.forEach(function (task) {
        if (typeof window.ytToast === "function") window.ytToast("图片已生成完成");
        pulseWorkCard(task.id);
      });
      showTaskInPreview(newlyDone[0]);
      pulsePreview(0);
    } else if (activeTask && activeTask.status !== "succeeded") {
      showTaskInPreview(activeTask);
    } else if (state.activeId) {
      markActiveWork(state.pickedUrl, state.activeId);
      syncStageNav();
    } else if (preview && done[0]) {
      showTaskInPreview(done[0]);
    } else {
      syncStageNav();
    }
  }

  var archiveTasks = [];
  var archivePage = 1;
  var archiveSeq = 0;
  var ARCHIVE_PAGE_SIZE = 25;
  var libraryGroups = [];
  var libraryGroupId = "";
  var librarySelected = new Set();
  var libraryFilteredTotal = 0;

  function groupName(id) {
    if (id == null || id === "") return "未分组";
    var g = libraryGroups.find(function (item) { return String(item.id) === String(id); });
    return g ? g.name : "未分组";
  }

  function renderLibraryGroups() {
    var box = $("ig-group-list");
    if (!box) return;
    var all = '<button type="button" class="ig-group-item' + (libraryGroupId === "" ? " is-active" : "") +
      '" data-library-group=""><span>全部</span><b>' + libraryTotal + "</b></button>";
    var ungrouped = '<button type="button" class="ig-group-item' +
      (libraryGroupId === "ungrouped" ? " is-active" : "") +
      '" data-library-group="ungrouped"><span>未分组</span><b>' +
      Math.max(0, libraryTotal - libraryGroups.reduce(function (n, g) { return n + (Number(g.count) || 0); }, 0)) +
      "</b></button>";
    var custom = libraryGroups.map(function (g) {
      return '<div class="ig-group-row"><button type="button" class="ig-group-item' +
        (String(libraryGroupId) === String(g.id) ? " is-active" : "") +
        '" data-library-group="' + esc(g.id) + '"><span>' + esc(g.name) + "</span><b>" +
        (Number(g.count) || 0) + '</b></button><button type="button" class="ig-group-edit" data-group-rename="' +
        esc(g.id) + '" title="重命名">✎</button><button type="button" class="ig-group-edit is-danger" data-group-delete="' +
        esc(g.id) + '" title="删除分组">×</button></div>';
    }).join("");
    box.innerHTML = all + ungrouped + custom;
  }

  function renderGroupSelects() {
    var options = '<option value="">未分组</option>' + libraryGroups.map(function (g) {
      return '<option value="' + esc(g.id) + '">' + esc(g.name) + "</option>";
    }).join("");
    var bulk = $("ig-library-bulk-group");
    if (bulk) bulk.innerHTML = options;
    var viewerGroup = $("ig-viewer-group");
    if (viewerGroup) {
      viewerGroup.innerHTML = options;
      if (viewer.task) viewerGroup.value = viewer.task.library_group_id || "";
    }
  }

  function libraryDate(task) {
    var raw = String(task.created_at || "");
    var date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(date).replace(/\//g, "-");
  }

  /** 卡片底部信息区（备注 + 笔按钮 + 分组·日期）。就地编辑时只重画这一块，不动缩略图。 */
  function libraryInfoHtml(task) {
    var note = String(task.user_note || "").trim();
    return '<div class="ig-library-note-row">' +
        '<strong title="' + esc(note || "未备注") + '">' + esc(note || "未备注") + "</strong>" +
        '<button type="button" class="ig-note-edit" data-library-note="' + esc(task.id) +
          '" title="编辑备注" aria-label="编辑备注">✎</button>' +
      "</div>" +
      "<span>" + esc(groupName(task.library_group_id)) + " · " + esc(libraryDate(task)) + "</span>";
  }

  function archiveCardHtml(task, index) {
    var checked = librarySelected.has(String(task.id));
    var thumb = task.thumbnail_url
      ? '<img class="ig-work-img" src="' + esc(task.thumbnail_url) +
        '" alt="" loading="lazy" decoding="async">'
      : '<div class="ig-work-holder">缩略图准备中</div>';
    return '<article class="ig-library-card' + (checked ? " is-selected" : "") +
      '" data-id="' + esc(task.id) + '" data-library-index="' + index + '">' +
      '<label class="ig-library-select"><input type="checkbox" data-library-select="' +
        esc(task.id) + '"' + (checked ? " checked" : "") + '><span>选择</span></label>' +
      '<button type="button" class="ig-library-thumb" data-library-open="' + esc(task.id) + '">' +
        thumb + "</button>" +
      '<div class="ig-library-card-info">' + libraryInfoHtml(task) + "</div></article>";
  }

  function cardInfoBox(id) {
    var card = document.querySelector('#ig-archive-grid .ig-library-card[data-id="' + id + '"]');
    return card ? card.querySelector(".ig-library-card-info") : null;
  }

  /**
   * 退出就地编辑，把信息区还原成只读态。
   * ⚠ 必须允许调用方传入最新的 task：`taskById` 会**先命中首页 lastTasks**，
   *   保存后若只按 id 反查，拿到的仍是首页那份旧备注，卡片看着像没保存成功。
   */
  function endNoteEdit(id, task) {
    var box = cardInfoBox(id);
    var data = task || taskById(id);
    if (box && data) box.innerHTML = libraryInfoHtml(data);
  }

  /**
   * 备注就地编辑：点笔直接在卡片上改，回车/失焦保存，Esc 放弃。
   * ⚠ 保存必须带上当前分组 —— 后端 PATCH 是 note + group_id 一起写，
   *   只传 note 会把这张图默默踢回未分组。
   */
  function beginNoteEdit(id) {
    var box = cardInfoBox(id);
    var task = taskById(id);
    if (!box || !task) return;
    box.innerHTML = '<input class="ig-note-input" data-note-for="' + esc(id) +
      '" maxlength="80" placeholder="最多 80 个字" value="' +
      esc(String(task.user_note || "")) + '">' +
      '<span class="ig-note-tip">回车保存 · Esc 取消</span>';
    var input = box.querySelector(".ig-note-input");
    if (input) {
      input.focus();
      input.select();
    }
  }

  function commitNoteEdit(input) {
    if (!input || input.disabled) return;
    var id = input.dataset.noteFor;
    var task = taskById(id);
    if (!task) return;
    var value = input.value.trim().slice(0, 80);
    if (value === String(task.user_note || "").trim()) {
      endNoteEdit(id);
      return;
    }
    input.disabled = true;
    libraryPost("image_library_meta", {
      id: id,
      note: value,
      /* 分组原样回传，避免就地改备注顺手清掉分组 */
      group_id: task.library_group_id || "",
    })
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || "备注保存失败");
        var fresh = d.task || Object.assign({}, task, { user_note: value });
        var idx = archiveTasks.findIndex(function (item) {
          return String(item.id) === String(id);
        });
        if (idx >= 0) archiveTasks[idx] = fresh;
        /* 首页那份也要同步：它是 taskById 的第一命中，留着旧备注会让下载文件名回到旧值 */
        var homeIdx = lastTasks.findIndex(function (item) {
          return String(item.id) === String(id);
        });
        if (homeIdx >= 0) lastTasks[homeIdx] = fresh;
        if (viewer.task && String(viewer.task.id) === String(id)) viewer.task = fresh;
        endNoteEdit(id, fresh);
      })
      .catch(function (err) {
        libraryError(err.message || "备注保存失败");
        endNoteEdit(id);
      });
  }

  function syncLibrarySelection() {
    var n = librarySelected.size;
    var text = $("ig-library-selected");
    if (text) text.textContent = "已选 " + n + " 张" + (n >= 100 ? "（已达上限）" : "");
    var apply = $("ig-library-bulk-apply");
    var exp = $("ig-library-export");
    if (apply) apply.disabled = n === 0;
    if (exp) exp.disabled = n === 0;
    var all = $("ig-library-checkall");
    if (all) {
      var pageIds = archiveTasks.map(function (t) { return String(t.id); });
      var selectedOnPage = pageIds.filter(function (id) { return librarySelected.has(id); }).length;
      all.checked = pageIds.length > 0 && selectedOnPage === pageIds.length;
      all.indeterminate = selectedOnPage > 0 && selectedOnPage < pageIds.length;
      all.disabled = !pageIds.length;
    }
  }

  function renderArchive(d) {
    var grid = $("ig-archive-grid");
    if (!grid) return;
    archiveTasks = d.tasks || [];
    libraryGroups = Array.isArray(d.groups) ? d.groups : [];
    libraryTotal = Math.max(0, Number(d.library_total) || 0);
    var filteredTotal = Math.max(0, Number(d.total) || archiveTasks.length);
    libraryFilteredTotal = filteredTotal;
    syncMoreWorks();
    renderLibraryGroups();
    renderGroupSelects();
    var count = $("ig-works-dialog-count");
    if (count) count.textContent = "（" + filteredTotal + "张）";
    grid.innerHTML = archiveTasks.length
      ? archiveTasks.map(archiveCardHtml).join("")
      : '<div class="ig-archive-empty">当前条件下暂无成功作品</div>';

    var pages = Math.max(1, Math.ceil(filteredTotal / ARCHIVE_PAGE_SIZE));
    archivePage = Math.min(pages, Math.max(1, Number(d.page) || archivePage));
    var pager = $("ig-archive-pager");
    if (pager) pager.hidden = filteredTotal <= ARCHIVE_PAGE_SIZE;
    var info = $("ig-archive-page");
    if (info) info.textContent = archivePage + " / " + pages;
    var prev = $("ig-archive-prev");
    var next = $("ig-archive-next");
    if (prev) prev.disabled = archivePage <= 1;
    if (next) next.disabled = archivePage >= pages;
    syncLibrarySelection();
  }

  function loadArchivePage(page) {
    if (!loggedIn) return;
    var grid = $("ig-archive-grid");
    var seq = ++archiveSeq;
    archivePage = Math.max(1, Number(page) || 1);
    if (grid) grid.innerHTML = '<div class="ig-archive-empty">正在加载图片库…</div>';
    var query = new URLSearchParams({
      ajax: "image_library",
      page: String(archivePage),
      page_size: String(ARCHIVE_PAGE_SIZE),
    });
    var from = $("ig-library-from");
    var to = $("ig-library-to");
    if (libraryGroupId) query.set("group_id", libraryGroupId);
    if (from && from.value) query.set("from", from.value);
    if (to && to.value) query.set("to", to.value);
    fetch("/?" + query.toString(), {
      credentials: "same-origin",
    })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (seq !== archiveSeq) return;
        if (!d || !d.ok) {
          var message = (d && d.error) || "作品加载失败，请稍后重试";
          if (grid) grid.innerHTML = '<div class="ig-archive-empty">' + esc(message) + "</div>";
          libraryError(message);
          return;
        }
        renderArchive(d);
      })
      .catch(function () {
        if (seq === archiveSeq && grid) {
          grid.innerHTML = '<div class="ig-archive-empty">作品加载失败，请稍后重试</div>';
        }
      });
  }

  function openWorksDialog() {
    var dlg = $("ig-works-dialog");
    if (!dlg || !dlg.showModal) return;
    if (!dlg.open) dlg.showModal();
    loadArchivePage(1);
  }

  function clearLibrarySelection() {
    librarySelected.clear();
    syncLibrarySelection();
  }

  function libraryPost(action, fields) {
    var fd = new FormData();
    fd.set("csrf", csrf());
    Object.keys(fields || {}).forEach(function (key) {
      var value = fields[key];
      if (Array.isArray(value)) value.forEach(function (item) { fd.append(key + "[]", item); });
      else fd.set(key, value == null ? "" : String(value));
    });
    return fetch("/?ajax=" + action, {
      method: "POST", body: fd, credentials: "same-origin",
    }).then(function (r) { return r.json(); });
  }

  function libraryError(message) {
    if (typeof window.ytToast === "function") window.ytToast(message || "操作失败", "error");
    else toastErr(message || "操作失败");
  }

  function groupOperation(op, id, currentName) {
    var name = "";
    if (op !== "delete") {
      name = window.prompt(op === "create" ? "新建分组名称" : "重命名分组", currentName || "");
      if (name === null || !name.trim()) return;
      name = name.trim();
    } else if (!window.confirm("删除这个分组？组内图片会变为未分组，不会删除图片。")) {
      return;
    }
    libraryPost("image_library_group", { op: op, id: id || "", name: name })
      .then(function (d) {
        if (!d || !d.ok) throw new Error((d && d.error) || "操作失败");
        if (op === "delete" && String(libraryGroupId) === String(id)) libraryGroupId = "";
        clearLibrarySelection();
        loadArchivePage(1);
      })
      .catch(function (err) { libraryError(err.message || "分组操作失败"); });
  }

  function saveViewerMeta() {
    if (!viewer.task) return;
    var note = $("ig-viewer-note");
    var group = $("ig-viewer-group");
    var status = $("ig-viewer-meta-status");
    var value = note ? note.value.trim().slice(0, 80) : "";
    if (status) status.textContent = "保存中…";
    libraryPost("image_library_meta", {
      id: viewer.task.id,
      note: value,
      group_id: group ? group.value : "",
    }).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || "保存失败");
      viewer.task = d.task || viewer.task;
      viewer.task.user_note = String(viewer.task.user_note || value);
      viewer.task.library_group_id = viewer.task.library_group_id || "";
      var idx = archiveTasks.findIndex(function (item) {
        return String(item.id) === String(viewer.task.id);
      });
      if (idx >= 0) archiveTasks[idx] = viewer.task;
      var card = document.querySelector('[data-library-index="' + idx + '"]');
      if (card) card.outerHTML = archiveCardHtml(viewer.task, idx);
      var download = $("ig-viewer-download");
      if (download) download.download = viewerDownloadName(viewer.task);
      if (status) status.textContent = "已保存";
      loadArchivePage(archivePage);
    }).catch(function (err) {
      if (status) status.textContent = err.message || "保存失败";
    });
  }

  function bulkLibraryGroup() {
    if (!librarySelected.size) return;
    var select = $("ig-library-bulk-group");
    libraryPost("image_library_bulk_group", {
      ids: Array.from(librarySelected),
      group_id: select ? select.value : "",
    }).then(function (d) {
      if (!d || !d.ok) throw new Error((d && d.error) || "批量操作失败");
      clearLibrarySelection();
      loadArchivePage(archivePage);
    }).catch(function (err) { libraryError(err.message || "批量操作失败"); });
  }

  function bulkLibraryExport() {
    if (!librarySelected.size) return;
    libraryPost("image_library_export", { ids: Array.from(librarySelected) })
      .then(function (d) {
        if (!d || !d.ok || !d.download_url) throw new Error((d && d.error) || "导出失败");
        var a = document.createElement("a");
        a.href = d.download_url;
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      })
      .catch(function (err) { libraryError(err.message || "导出失败"); });
  }

  /*
   * 提示词浮层：委托在 document 上，缩略图每次重建也不用重绑。
   * 用 `position: fixed` 跟随鼠标，避免被缩略图的 overflow 裁掉。
   */
  function taskById(id) {
    for (var i = 0; i < lastTasks.length; i++) {
      if (String(lastTasks[i].id) === String(id)) return lastTasks[i];
    }
    for (var j = 0; j < archiveTasks.length; j++) {
      if (String(archiveTasks[j].id) === String(id)) return archiveTasks[j];
    }
    return null;
  }

  function showTipPop(btn, task) {
    var pop = $("ig-tip-pop");
    if (!pop || !task) return;
    var head = $("ig-tip-pop-head");
    var body = $("ig-tip-pop-body");
    if (head) {
      /* 显示货架名而不是裸 id：`gpt-image-2` 对用户没有意义 */
      var mm = null;
      for (var i = 0; i < models.length; i++) {
        if (models[i].id === task.model_id) { mm = models[i]; break; }
      }
      head.textContent = (mm && mm.label) || task.model_id || "提示词";
    }
    if (body) body.textContent = task.prompt || "";
    pop.hidden = false;
    /* 先显示再量尺寸，否则 hidden 状态下拿到的是 0 */
    var r = btn.getBoundingClientRect();
    var pw = pop.offsetWidth;
    var ph = pop.offsetHeight;
    var left = Math.min(window.innerWidth - pw - 10, Math.max(10, r.left + r.width / 2 - pw / 2));
    /* 上方空间不够就翻到下方，别顶出视口 */
    var top = r.top - ph - 8;
    if (top < 8) top = r.bottom + 8;
    pop.style.left = left + "px";
    pop.style.top = top + "px";
  }

  function hideTipPop() {
    var pop = $("ig-tip-pop");
    if (pop) pop.hidden = true;
  }

  var viewer = { task: null, scale: 1, x: 0, y: 0, dragging: false, px: 0, py: 0 };

  function viewerTransform() {
    var img = $("ig-viewer-image");
    var scale = $("ig-viewer-scale");
    if (img) {
      img.style.transform = "translate3d(" + viewer.x + "px," + viewer.y + "px,0) scale(" +
        viewer.scale + ")";
    }
    if (scale) scale.textContent = Math.round(viewer.scale * 100) + "%";
  }

  function resetViewer() {
    viewer.scale = 1;
    viewer.x = 0;
    viewer.y = 0;
    viewerTransform();
  }

  function zoomViewer(next) {
    viewer.scale = Math.max(0.5, Math.min(5, Math.round(next * 10) / 10));
    if (viewer.scale <= 1) {
      viewer.x = 0;
      viewer.y = 0;
    }
    viewerTransform();
  }

  function viewerDownloadName(task) {
    var raw = String(task.image_url || "").split(/[?#]/)[0];
    var extMatch = raw.match(/\.([a-zA-Z0-9]{2,5})$/);
    var ext = extMatch ? "." + extMatch[1].toLowerCase() : ".png";
    var note = String(task.user_note || "").trim()
      .replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").slice(0, 48);
    var date = libraryDate(task).replace(/-/g, "") || "未知日期";
    var index = archiveTasks.findIndex(function (item) {
      return String(item.id) === String(task.id);
    });
    if (index < 0) {
      index = lastTasks.findIndex(function (item) {
        return String(item.id) === String(task.id);
      });
    }
    index = Math.max(0, index) + 1;
    return (note || "图片") + "-" + date + "-" + String(index).padStart(3, "0") + ext;
  }

  function openViewer(task, promptOnly) {
    if (!task) return;
    var dlg = $("ig-viewer-dialog");
    var img = $("ig-viewer-image");
    var canvas = $("ig-viewer-canvas");
    if (!dlg || !img || !canvas || !dlg.showModal) return;
    viewer.task = task;
    var model = models.find(function (m) { return m.id === task.model_id; });
    var title = $("ig-viewer-title");
    if (title) title.textContent = (model && model.label) || "作品大图";
    var prompt = $("ig-viewer-prompt");
    if (prompt) prompt.textContent = task.prompt || "这张作品没有提示词记录";
    var hasImage = task.status === "succeeded" && task.image_url;
    canvas.hidden = !hasImage;
    img.hidden = !hasImage;
    if (hasImage) img.src = task.image_url;
    var dl = $("ig-viewer-download");
    if (dl) {
      dl.hidden = !hasImage;
      dl.href = hasImage ? task.image_url : "#";
      dl.download = hasImage ? viewerDownloadName(task) : "";
    }
    var note = $("ig-viewer-note");
    var group = $("ig-viewer-group");
    var metaSave = $("ig-viewer-meta-save");
    var metaStatus = $("ig-viewer-meta-status");
    if (note) note.value = task.user_note || "";
    if (group) group.value = task.library_group_id || "";
    if (metaSave) metaSave.hidden = !hasImage;
    if (metaStatus) metaStatus.textContent = "";
    resetViewer();
    if (!dlg.open) dlg.showModal();
    if (promptOnly) {
      requestAnimationFrame(function () {
        var p = document.querySelector(".ig-viewer-prompt-wrap");
        if (p) p.scrollIntoView({ block: "nearest" });
      });
    }
  }

  /** 把成功图片放到预览区，并高亮对应的作品卡。 */
  function showInPreview(url, taskId) {
    var preview = $("ig-preview");
    if (!preview || !url) return;
    preview.classList.remove("is-gen");
    preview.innerHTML = '<img src="' + esc(url) + '" alt="作品预览">';
    if (taskId) state.activeId = String(taskId);
    markActiveWork(url, taskId);
    syncStageNav();
  }

  /** 成功图、生成中进度、失败结果共用同一个预览入口。 */
  function showTaskInPreview(task) {
    var preview = $("ig-preview");
    if (!preview || !task) return;
    state.activeId = String(task.id);
    if (task.status === "succeeded" && task.image_url) {
      state.pickedUrl = task.image_url;
      showInPreview(task.image_url, task.id);
      return;
    }

    state.pickedUrl = "";
    var busy = task.status === "pending" || task.status === "running";
    var bad = task.status === "failed" || task.status === "canceled" || task.status === "cancelled";
    var p = Math.max(0, Math.min(100, Number(task.progress) || 0));
    preview.classList.toggle("is-gen", busy);
    preview.innerHTML = '<div class="ig-work-holder ig-preview-holder' +
      (busy ? " is-gen" : (bad ? " is-bad" : "")) +
      '" style="--p:' + p + '">' +
      esc(task.status_label || (busy ? "生成中" : task.status)) +
      (busy && p ? " " + p + "%" : "") + "</div>";
    markActiveWork("", task.id);
    syncStageNav();
  }

  var previewPulseTimer = null;
  function pulsePreview(delay) {
    clearTimeout(previewPulseTimer);
    var run = function () {
      var preview = $("ig-preview");
      if (!preview) return;
      preview.classList.remove("is-flash");
      void preview.offsetWidth; // 重置动画，连续切图也能重新描边
      preview.classList.add("is-flash");
      previewPulseTimer = setTimeout(function () {
        preview.classList.remove("is-flash");
      }, 1200);
    };
    previewPulseTimer = setTimeout(run, Math.max(0, delay || 0));
  }

  /**
   * 用户点缩略图时，把「我的作品」板块滚到顶栏下面。
   * 只在「人手点」时调，轮询自动换图不要跟着跳 —— 否则看着作品墙会被拽走。
   * 预览已经完整可见时不滚，返回值是描边动画应等待的毫秒数。
   */
  function revealPreview() {
    var preview = $("ig-preview");
    var el = document.querySelector(".ig-works-card");
    if (!preview || !el || !el.scrollIntoView) return 0;
    var r = preview.getBoundingClientRect();
    var bar = document.querySelector(".ig-topbar");
    var top = bar ? bar.getBoundingClientRect().bottom : 0;
    if (r.top >= top && r.bottom <= window.innerHeight) return 0;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    return reduce ? 0 : 550;
  }

  function markActiveWork(url, taskId) {
    var id = taskId ? String(taskId) : String(state.activeId || "");
    document.querySelectorAll("#ig-works .ig-work-box").forEach(function (b) {
      b.classList.toggle("is-active",
        Boolean(id && String(b.dataset.id) === id) ||
        Boolean(!id && url && b.dataset.igPick === url));
    });
  }

  function succeededUrls() {
    return lastTasks.slice(0, homeWorksLimit())
      .filter(function (t) { return t.status === "succeeded" && t.image_url; })
      .map(function (t) { return t.image_url; });
  }

  function syncStageNav() {
    var prev = $("ig-stage-prev");
    var next = $("ig-stage-next");
    if (!prev || !next) return;
    var urls = succeededUrls();
    var show = urls.length > 0 && Boolean(state.pickedUrl || ($("ig-preview") && $("ig-preview").querySelector("img")));
    prev.hidden = !show;
    next.hidden = !show;
    if (!show) return;
    var cur = state.pickedUrl || urls[0];
    var i = urls.indexOf(cur);
    if (i < 0) i = 0;
    prev.disabled = i <= 0;
    next.disabled = i >= urls.length - 1;
  }

  function shiftPreview(delta) {
    var urls = succeededUrls();
    if (!urls.length) return;
    var cur = state.pickedUrl || urls[0];
    var i = urls.indexOf(cur);
    if (i < 0) i = 0;
    var next = i + delta;
    if (next < 0 || next >= urls.length) return;
    var target = lastTasks.find(function (t) { return t.image_url === urls[next]; });
    if (!target) return;
    showTaskInPreview(target);
    pulsePreview(0);
  }

  function cancelTask(id) {
    var fd = new FormData();
    fd.set("csrf", csrf());
    fd.set("id", id);
    fetch("/?ajax=image_cancel", { method: "POST", body: fd, credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.image_points != null && $("ig-balance")) $("ig-balance").textContent = String(d.image_points);
        pollNow();
      });
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var modelBtn = t.closest("[data-ig-model]");
    if (modelBtn) {
      var pick = models.find(function (m) { return m.id === modelBtn.dataset.igModel; });
      if (state.mode === "i2i" && !supportsI2i(pick)) {
        if (typeof window.ytToast === "function") window.ytToast("该模型暂不支持图生图", "error");
        return;
      }
      state.modelId = modelBtn.dataset.igModel;
      initParamsFromModel();
      renderControls();
      scheduleEstimate();
      syncSubmit();
      return;
    }
    var modeBtn = t.closest("[data-ig-mode]");
    if (modeBtn && !modeBtn.disabled) {
      state.mode = modeBtn.dataset.igMode;
      document.querySelectorAll("#ig-modes .ig-mode").forEach(function (b) {
        b.classList.toggle("is-active", b === modeBtn);
      });
      syncRefsField();
      renderControls();
      scheduleEstimate();
      syncSubmit();
      return;
    }
    var cnt = t.closest("[data-ig-count]");
    if (cnt) {
      state.count = Number(cnt.dataset.igCount) || 1;
      document.querySelectorAll("#ig-count .ig-seg-btn").forEach(function (b) {
        b.classList.toggle("is-active", b === cnt);
      });
      scheduleEstimate();
      return;
    }
    var chip = t.closest("[data-ig-ctl][data-val]");
    if (chip) {
      state.params[chip.dataset.igCtl] = chip.dataset.val;
      renderControls();
      scheduleEstimate();
      syncSubmit();
      return;
    }
    if (t.id === "ig-ref-add" || (t.closest && t.closest("#ig-ref-add"))) {
      var inp = $("ig-ref-input");
      if (inp) inp.click();
      return;
    }
    var del = t.closest("[data-ig-ref-del]");
    if (del) {
      state.refs.splice(Number(del.dataset.igRefDel), 1);
      renderRefs();
      syncDescBtn();
      scheduleEstimate();
      syncSubmit();
      return;
    }
    var cancel = t.closest("[data-ig-cancel]");
    if (cancel) { cancelTask(cancel.dataset.igCancel); return; }
    if (t.closest("#ig-more-works")) { openWorksDialog(); return; }
    if (t.closest("#ig-works-close")) {
      var worksDlg = $("ig-works-dialog");
      if (worksDlg) worksDlg.close();
      return;
    }
    if (t.closest("#ig-archive-prev")) { loadArchivePage(archivePage - 1); return; }
    if (t.closest("#ig-archive-next")) { loadArchivePage(archivePage + 1); return; }
    if (t.closest("#ig-group-create")) { groupOperation("create"); return; }
    var groupPick = t.closest("[data-library-group]");
    if (groupPick) {
      libraryGroupId = groupPick.dataset.libraryGroup || "";
      clearLibrarySelection();
      loadArchivePage(1);
      return;
    }
    var groupRename = t.closest("[data-group-rename]");
    if (groupRename) {
      var renameGroup = libraryGroups.find(function (g) {
        return String(g.id) === String(groupRename.dataset.groupRename);
      });
      groupOperation("rename", groupRename.dataset.groupRename, renameGroup && renameGroup.name);
      return;
    }
    var groupDelete = t.closest("[data-group-delete]");
    if (groupDelete) {
      groupOperation("delete", groupDelete.dataset.groupDelete);
      return;
    }
    if (t.closest("#ig-library-search")) {
      clearLibrarySelection();
      loadArchivePage(1);
      return;
    }
    if (t.closest("#ig-library-reset")) {
      var from = $("ig-library-from");
      var to = $("ig-library-to");
      if (from) from.value = "";
      if (to) to.value = "";
      libraryGroupId = "";
      clearLibrarySelection();
      loadArchivePage(1);
      return;
    }
    if (t.closest("#ig-library-bulk-apply")) { bulkLibraryGroup(); return; }
    if (t.closest("#ig-library-export")) { bulkLibraryExport(); return; }
    if (t.closest("#ig-viewer-meta-save")) { saveViewerMeta(); return; }
    var noteEdit = t.closest("[data-library-note]");
    if (noteEdit) { beginNoteEdit(noteEdit.dataset.libraryNote); return; }
    var libraryOpen = t.closest("[data-library-open]");
    if (libraryOpen) {
      var libraryTask = taskById(libraryOpen.dataset.libraryOpen);
      if (libraryTask) openViewer(libraryTask, false);
      return;
    }
    if (t.closest("#ig-viewer-close")) {
      var viewerDlg = $("ig-viewer-dialog");
      if (viewerDlg) viewerDlg.close();
      return;
    }
    if (t.closest("#ig-viewer-minus")) { zoomViewer(viewer.scale - 0.2); return; }
    if (t.closest("#ig-viewer-plus")) { zoomViewer(viewer.scale + 0.2); return; }
    if (t.closest("#ig-viewer-reset")) { resetViewer(); return; }
    if (t.closest("#ig-stage-prev")) { shiftPreview(-1); return; }
    if (t.closest("#ig-stage-next")) { shiftPreview(1); return; }
    /* 「词」：把这张图的提示词填回输入框，方便微调后重做 */
    var pbtn = t.closest("[data-ig-prompt]");
    if (pbtn) {
      var task = taskById(pbtn.dataset.igPrompt);
      if (pbtn.closest("#ig-archive-grid")) {
        if (task) openViewer(task, true);
        hideTipPop();
        return;
      }
      var ta = $("ig-prompt");
      if (task && task.prompt && ta) {
        ta.value = task.prompt;
        /* 派发 input 让既有委托统一处理字数、清空按钮、译按钮与提交态，别再抄一遍 */
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        optTip("已把这张图的提示词填回输入框。");
        hideTipPop();
        ta.focus();
      }
      return;
    }
    /* 成功图与生成中占位都能进预览；内部按钮仍由上面的分支处理 */
    var pick = t.closest(".ig-work-box[data-id], .ig-work-box[data-ig-pick]");
    if (pick && !t.closest("a") && !t.closest("button")) {
      var pickedTask = taskById(pick.dataset.id);
      if (pick.closest("#ig-archive-grid")) {
        if (pickedTask && pickedTask.status === "succeeded" && pickedTask.image_url) {
          openViewer(pickedTask, false);
        }
        return;
      }
      if (pickedTask) {
        showTaskInPreview(pickedTask);
      } else if (pick.dataset.igPick) {
        /* 兼容烟测或旧 DOM：只有 URL 时仍能预览 */
        state.activeId = "";
        state.pickedUrl = pick.dataset.igPick;
        showInPreview(state.pickedUrl);
      } else {
        return;
      }
      pulsePreview(revealPreview());
      return;
    }
    var previewImg = t.closest("#ig-preview img");
    if (previewImg) {
      var currentTask = taskById(state.activeId);
      if (currentTask) openViewer(currentTask, false);
      return;
    }
    var styleBtn = t.closest("[data-ig-style]");
    if (styleBtn) {
      var sid = styleBtn.dataset.igStyle;
      var at = state.styleIds.indexOf(sid);
      if (at >= 0) {
        state.styleIds.splice(at, 1); // 再点一下取消
      } else {
        var why = styleBlockReason(styleById(sid));
        if (why === "conflict") {
          optTip("这个画风与已选的不能叠加，先取消原来的再选。", true);
          return;
        }
        if (why === "full") {
          optTip("最多叠加 " + maxStyleCombo + " 个风格，再多会稀释主体描述。", true);
          return;
        }
        state.styleIds.push(sid); // 追加在末尾：顺序即优先级
      }
      renderStyles();
      return;
    }
    if (t.closest("#ig-prompt-opt")) { optimizePrompt(); return; }
    if (t.closest("#ig-prompt-desc")) { describeFromRef(); return; }
    if (t.id === "ig-prompt-insp") { fillInspiration(); return; }
    if (t.id === "ig-prompt-fav") { saveFavorite(); return; }
    if (t.id === "ig-prompt-favs") {
      var dlg = favDlg();
      loadFavs(true);
      if (dlg && dlg.showModal) { try { dlg.showModal(); } catch (err) { /* 已打开 */ } }
      return;
    }
    var favUse = t.closest("[data-fav-use]");
    if (favUse) {
      var f = (state.favs || []).find(function (x) { return x.id === favUse.dataset.favUse; });
      if (f) {
        var ta = $("ig-prompt");
        var cur = ta ? ta.value.trim() : "";
        if (cur) {
          state.optBefore = cur;
          var undo2 = $("ig-prompt-undo");
          if (undo2) undo2.hidden = false;
        }
        setPromptText(f.prompt);
        /* 连风格一起恢复：存的是已通过冲突校验的组合，直接用 */
        state.styleIds = (f.styles || []).slice(0, maxStyleCombo);
        renderStyles();
        var dlg2 = favDlg();
        if (dlg2 && dlg2.close) dlg2.close();
        optTip("已填入收藏的提示词" + (state.styleIds.length ? "与风格" : "") + "。", false);
      }
      return;
    }
    var favRen = t.closest("[data-fav-ren]");
    if (favRen) {
      var fr = (state.favs || []).find(function (x) { return x.id === favRen.dataset.favRen; });
      var nt = window.prompt("改个名字", fr ? fr.title : "");
      if (nt === null || !nt.trim()) return;
      favOp("rename", { id: favRen.dataset.favRen, title: nt.trim() }).then(function (d) {
        if (d && d.ok) loadFavs(true);
      });
      return;
    }
    var favDel = t.closest("[data-fav-del]");
    if (favDel) {
      if (!window.confirm("删除这条收藏？")) return;
      favOp("del", { id: favDel.dataset.favDel }).then(function (d) {
        if (d && d.ok) loadFavs(true);
      });
      return;
    }
    if (t.id === "ig-prompt-undo") {
      if (state.optBefore) setPromptText(state.optBefore);
      state.optBefore = "";
      t.hidden = true;
      optTip("", false);
      return;
    }
    if (t.id === "ig-submit" || t.closest("#ig-submit")) submit();
    if (t.id === "ig-prompt-clear") {
      setPromptText("");
      state.optBefore = "";
      var undoBtn = $("ig-prompt-undo");
      if (undoBtn) undoBtn.hidden = true;
      optTip("", false);
    }
  });

  /* 备注就地编辑：回车走 blur 统一收敛到 focusout 那条保存路径，避免保存两次 */
  document.addEventListener("keydown", function (e) {
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains("ig-note-input")) return;
    if (e.key === "Enter") {
      e.preventDefault();
      el.blur();
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      el.disabled = true; // commitNoteEdit 见 disabled 即跳过，移除节点时不会误存
      endNoteEdit(el.dataset.noteFor);
    }
  });

  document.addEventListener("focusout", function (e) {
    var el = e.target;
    if (el && el.classList && el.classList.contains("ig-note-input")) commitNoteEdit(el);
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    var tag = (e.target && e.target.tagName) || "";
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return;
    if (e.target && e.target.isContentEditable) return;
    e.preventDefault();
    shiftPreview(e.key === "ArrowLeft" ? -1 : 1);
  });

  document.addEventListener("input", function (e) {
    var el = e.target;
    if (!el) return;
    if (el.id === "ig-prompt") {
      var c = $("ig-prompt-count");
      if (c) c.textContent = String(el.value.length);
      var clr = $("ig-prompt-clear");
      if (clr) clr.hidden = !el.value;
      syncTransBtn();
      syncSubmit();
      return;
    }
    if (el.matches && el.matches("[data-ig-ctl]")) {
      var id = el.dataset.igCtl;
      if (el.type === "checkbox") state.params[id] = el.checked;
      else if (el.type === "range") {
        state.params[id] = Number(el.value);
        var lab = document.querySelector('[data-ig-val="' + id + '"]');
        if (lab) lab.textContent = el.value;
      } else if (el.classList.contains("ig-seed")) {
        state.params[id] = el.value === "" ? null : Number(el.value);
      } else state.params[id] = el.value;
      scheduleEstimate();
    }
  });

  document.addEventListener("change", function (e) {
    var el = e.target;
    if (!el) return;
    if (el.id === "ig-library-checkall") {
      if (el.checked) {
        var room = Math.max(0, 100 - librarySelected.size);
        archiveTasks.forEach(function (task) {
          var id = String(task.id);
          if (!librarySelected.has(id) && room > 0) {
            librarySelected.add(id);
            room -= 1;
          }
        });
      } else {
        archiveTasks.forEach(function (task) { librarySelected.delete(String(task.id)); });
      }
      renderArchive({
        tasks: archiveTasks,
        total: libraryFilteredTotal,
        page: archivePage,
        groups: libraryGroups,
        library_total: libraryTotal,
      });
      return;
    }
    if (el.matches && el.matches("[data-library-select]")) {
      var id = String(el.dataset.librarySelect);
      if (el.checked) {
        if (librarySelected.size >= 100 && !librarySelected.has(id)) {
          el.checked = false;
          toastErr("一次最多选择 100 张图片");
          return;
        }
        librarySelected.add(id);
      } else {
        librarySelected.delete(id);
      }
      var card = el.closest(".ig-library-card");
      if (card) card.classList.toggle("is-selected", el.checked);
      syncLibrarySelection();
    }
  });

  /*
   * 悬停「译」按钮就出中文对照。
   *
   * 用 document 级委托而不是给按钮直接绑：按钮本身是服务端渲染的固定元素，
   * 但走 PJAX 回到本页时 `.shell-main` 内的节点会被整份替换，直绑会失效
   * （PITFALLS 里「守卫不能挂在 .shell-main 上」同一类问题）。
   * 委托只注册一次，且不捕获任何 DOM 引用。
   *
   * 200ms 防抖：鼠标扫过按钮不该触发一次真实的上游翻译调用。
   * 移开不收起 —— 用户往往要边看译文边改提示词，一移开就消失反而难用。
   */
  document.addEventListener("mouseover", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    /* 缩略图「词」按钮：悬停出提示词浮层（纯本地数据，无请求） */
    var pbtn = t.closest("[data-ig-prompt]");
    if (pbtn) {
      showTipPop(pbtn, taskById(pbtn.dataset.igPrompt));
      return;
    }
    if (!t.closest("#ig-prompt-trans")) return;
    clearTimeout(transTimer);
    transTimer = setTimeout(hoverTranslate, 200);
  });
  document.addEventListener("mouseout", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest("[data-ig-prompt]")) { hideTipPop(); return; }
    if (!t.closest("#ig-prompt-trans")) return;
    /* 只取消「还没发出去」的那次，已在途的请求让它回来填缓存 */
    clearTimeout(transTimer);
  });
  /* 翻页/滚动后浮层坐标就失效了（fixed 定位不跟着内容走），直接收起 */
  window.addEventListener("scroll", hideTipPop, { passive: true });
  /* 触屏没有悬停：点一下同样出译文（按钮自身不做别的事） */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (t && t.closest && t.closest("#ig-prompt-trans")) hoverTranslate();
  });

  /* 两个作品弹窗都只能点明确的关闭按钮退出，Esc / cancel 不关闭。 */
  ["ig-works-dialog", "ig-viewer-dialog"].forEach(function (id) {
    var dlg = $(id);
    if (dlg) dlg.addEventListener("cancel", function (e) { e.preventDefault(); });
  });

  var viewerCanvas = $("ig-viewer-canvas");
  if (viewerCanvas) {
    viewerCanvas.addEventListener("wheel", function (e) {
      e.preventDefault();
      zoomViewer(viewer.scale + (e.deltaY < 0 ? 0.2 : -0.2));
    }, { passive: false });
    viewerCanvas.addEventListener("dblclick", resetViewer);
    viewerCanvas.addEventListener("pointerdown", function (e) {
      if (viewer.scale <= 1) return;
      viewer.dragging = true;
      viewer.px = e.clientX;
      viewer.py = e.clientY;
      viewerCanvas.classList.add("is-dragging");
      viewerCanvas.setPointerCapture(e.pointerId);
    });
    viewerCanvas.addEventListener("pointermove", function (e) {
      if (!viewer.dragging) return;
      viewer.x += e.clientX - viewer.px;
      viewer.y += e.clientY - viewer.py;
      viewer.px = e.clientX;
      viewer.py = e.clientY;
      viewerTransform();
    });
    var stopDrag = function () {
      viewer.dragging = false;
      viewerCanvas.classList.remove("is-dragging");
    };
    viewerCanvas.addEventListener("pointerup", stopDrag);
    viewerCanvas.addEventListener("pointercancel", stopDrag);
  }

  var refInput = $("ig-ref-input");
  if (refInput) {
    refInput.addEventListener("change", function () {
      var f = refInput.files && refInput.files[0];
      refInput.value = "";
      if (f) uploadRef(f);
    });
  }

  initParamsFromModel();
  renderModels();
  renderControls();
  renderStyles();
  syncDescBtn();
  /* 刷新后输入框可能已有英文（浏览器恢复表单值），按钮显隐要跟着对 */
  syncTransBtn();
  scheduleEstimate();
  syncSubmit();
  loadTasks();
})();
