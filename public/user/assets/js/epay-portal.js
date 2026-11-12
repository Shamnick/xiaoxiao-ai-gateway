/* 门户付款框（2026-10-14 建；11-02 改成三通道）—— 官网用户端与代理门户各放一份「内容完全相同」的副本：
 *   yutiankejiai.com/user/assets/js/epay-portal.js
 *   yutiankejiai.com/a2/assets/js/epay-portal.js
 * 两个站点互不加载对方资源，改一处必须同步另一处（cmp 两个文件应一致）。二维码靠同目录 qrcode.min.js（window.QRCode）。
 *
 * 11-02 起除插件外不出收款码；11-08 起编号：1 寄售 jiyuan · 2 在线支付 epay（catfk 已停用，排最后叫 4，关着不显示）。
 *   · 寄售：点「生成支付宝付款码」→ 号池替客户在平台下单 → 本页画二维码（手机另给「打开支付宝付款」）→ 轮询到账；
 *   · 数合支付：点「使用支付宝付款」→ 电脑新标签 / 手机本页跳收银台 → 轮询 → 到账。
 * 页面放一个 [data-epay-box]（data-create / data-status = 数合支付，data-cs-create / data-cs-status = 寄售，data-csrf，
 * data-channels = { "<商品键>": ["jiyuan","epay"] } 每个商品此刻能用的通道），业务脚本选中商品后调：
 *   ytEpay.show(box, { key, payload, sum, desc, onDone(状态) })   // key 就是 data-channels 里的商品键
 *   ytEpay.channels(box, key) → 这个商品能用的通道（空数组 = 一个都不能用，业务脚本改走客服）
 * 从数合支付收银台跳回（地址带 ?epay=订单号）时调 ytEpay.resume(box, { onDone }) 接着查。
 * 付没付只认号池主动向平台查单，这里拿到的只是状态，页面上的一切都只是展示。
 * 样式在各站自己的样式表里（user.css / admin.css 末尾 .epay-* / .cs-*）：两站 CSP 不允许内联样式，脚本不能注入 <style>。
 * ⚠ 数合支付的新标签必须在点击的同一刻 window.open（先开空白页，建单回来再跳），异步回来再开会被浏览器拦。 */
(function () {
  "use strict";
  if (window.ytEpay) return;

  var isMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS|OpenHarmony/i.test(navigator.userAgent || "");
  var SS = "yt.epay.";
  var POLL_MAX_MS = 30 * 60 * 1000;
  // 编号顺序（号池 channel-numbers.ts）：1 jiyuan · 2 epay · 4 catfk（已停用）；默认选第一个能用的
  var CH_ORDER = ["jiyuan", "epay", "catfk"];
  // cur：{ box, opts, ch, order, payurl, qr, timer, startedAt, done }
  var cur = null;

  function q(box, sel) {
    return box ? box.querySelector(sel) : null;
  }
  function isCs(ch) {
    return ch === "catfk" || ch === "jiyuan";
  }
  function setMsg(text, kind) {
    var el = cur && q(cur.box, isCs(cur.ch) ? "[data-cs-msg]" : "[data-epay-msg]");
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || "";
    el.className = "epay-msg" + (kind ? " is-" + kind : "");
  }
  function save(key, v) {
    try {
      if (v) sessionStorage.setItem(SS + key, JSON.stringify(v));
      else sessionStorage.removeItem(SS + key);
    } catch (e) {
      /* 无痕模式等拿不到 sessionStorage：只是不能沿用旧订单 */
    }
  }
  function load(key) {
    try {
      var v = JSON.parse(sessionStorage.getItem(SS + key) || "null");
      return v && v.exp > Date.now() ? v : null;
    } catch (e) {
      return null;
    }
  }
  function stop() {
    if (cur && cur.timer) {
      clearTimeout(cur.timer);
      cur.timer = null;
    }
  }
  function showReopen(url) {
    var a = cur && q(cur.box, "[data-epay-reopen]");
    if (!a) return;
    a.hidden = !url;
    if (url) a.href = url;
  }
  function setBusy(on) {
    var b = cur && q(cur.box, isCs(cur.ch) ? "[data-cs-go]" : "[data-epay-go]");
    if (b) b.disabled = !!on;
  }

  /** 这个商品此刻能用哪些通道（按 CH_ORDER 排好） */
  function channels(box, key) {
    var map = {};
    try {
      map = JSON.parse((box && box.getAttribute("data-channels")) || "{}") || {};
    } catch (e) {
      map = {};
    }
    var list = Array.isArray(map[key]) ? map[key] : [];
    return CH_ORDER.filter(function (c) {
      return list.indexOf(c) >= 0;
    });
  }

  function clearQr(box) {
    var wrap = q(box, "[data-cs-qr]");
    if (wrap) {
      wrap.hidden = true;
      wrap.textContent = "";
    }
    var open = q(box, "[data-cs-open]");
    if (open) open.hidden = true;
  }
  function drawQr(box, text) {
    var wrap = q(box, "[data-cs-qr]");
    if (!wrap) return;
    wrap.textContent = "";
    var canvas = document.createElement("canvas");
    wrap.appendChild(canvas);
    wrap.hidden = false;
    if (window.QRCode && typeof window.QRCode.toCanvas === "function") {
      window.QRCode.toCanvas(canvas, text, { width: 200, margin: 1 }, function () {});
    }
    var open = q(box, "[data-cs-open]");
    if (open) {
      // 支付宝自己的码（qr.alipay.com）手机浏览器能直接拉起支付宝；易支付收银码要放进支付宝内置浏览器打开
      open.href = /^https:\/\/qr\.alipay\.com\//.test(text) ? text : "alipays://platformapi/startapp?appId=20000067&url=" + encodeURIComponent(text);
      open.hidden = !isMobile;
    }
  }

  function selectTab(box, ch) {
    box.querySelectorAll("[data-epay-tab]").forEach(function (t) {
      var on = t.getAttribute("data-epay-tab") === ch;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on ? "true" : "false");
    });
    var ep = q(box, "[data-epay-pane]");
    if (ep) ep.hidden = ch !== "epay";
    var cs = q(box, "[data-cs-pane]");
    if (cs) cs.hidden = !isCs(ch);
  }

  /** 切到某个通道：停掉上一个通道的轮询（上一单没付就作废掉页面状态，平台上的单会自己过期） */
  function useChannel(ch) {
    if (!cur) return;
    stop();
    var s = cur;
    s.ch = ch;
    s.order = null;
    s.payurl = "";
    s.qr = "";
    s.done = false;
    selectTab(s.box, ch);
    clearQr(s.box);
    showReopen("");
    setBusy(false);
    setMsg("", "");
    var sum = q(s.box, isCs(ch) ? "[data-cs-sum]" : "[data-epay-sum]");
    if (sum) sum.textContent = s.opts.sum || "";
    var desc = q(s.box, isCs(ch) ? "[data-cs-desc]" : "[data-epay-desc]");
    if (desc) desc.textContent = s.opts.desc || "";
    var prev = s.opts.key ? load(ch + ":" + s.opts.key) : null;
    if (prev && prev.order) {
      s.order = prev.order;
      s.payurl = prev.payurl || "";
      s.qr = prev.qr || "";
      s.startedAt = Date.now();
      if (isCs(ch) && s.qr) {
        drawQr(s.box, s.qr);
        setMsg("这是你刚才生成的付款码，付完会自动到账", "wait");
      } else {
        showReopen(s.payurl);
        setMsg("你刚才打开过这笔付款，付完会自动到账；还没付可以点上面的按钮继续付款", "wait");
      }
      schedule(1200);
    }
  }

  /** 用户选中一个商品：只显示它能用的通道页签，默认选编号最小的那个 */
  function show(box, opts) {
    if (!box) return;
    stop();
    cur = { box: box, opts: opts || {}, ch: "", order: null, payurl: "", qr: "", timer: null, startedAt: 0, done: false };
    var list = channels(box, cur.opts.key);
    box.querySelectorAll("[data-epay-tab]").forEach(function (t) {
      t.hidden = list.indexOf(t.getAttribute("data-epay-tab")) < 0;
    });
    var tabs = q(box, ".epay-tabs");
    if (tabs) tabs.hidden = list.length < 2;
    box.hidden = !list.length;
    if (list.length) useChannel(list[0]);
  }
  function hide(box) {
    if (cur && cur.box === box) {
      stop();
      cur = null;
    }
    if (box) box.hidden = true;
  }

  /** 电脑：点击当下先开一个空白标签页占位（之后再跳收银台），被拦返回 null。手机不开新标签。 */
  function openBlankTab() {
    if (isMobile) return null;
    var w = null;
    try {
      w = window.open("", "_blank");
    } catch (e) {
      w = null;
    }
    if (!w) return null;
    try {
      w.opener = null;
      w.document.title = "正在打开支付宝…";
      w.document.body.textContent = "正在打开支付宝付款页面，请稍候…";
    } catch (e) {
      /* 拿不到就算了，照样能跳 */
    }
    return w;
  }
  function jump(url, win) {
    if (!win) {
      setMsg("正在打开支付宝付款页面…", "wait");
      location.href = url; // 手机 / 新标签被拦：本页整页跳到平台收银台（付款跳转属于允许的整页导航）
      return;
    }
    try {
      win.location.href = url;
    } catch (e) {
      location.href = url;
      return;
    }
    showReopen(url);
    setMsg("已在新标签页打开支付宝付款页面，付款成功后会自动到账，不用填订单号", "wait");
    cur.startedAt = Date.now();
    schedule(3000);
  }

  function post(url, s, extra) {
    var body = new URLSearchParams();
    body.set("csrf", s.box.getAttribute("data-csrf") || "");
    body.set("ua", navigator.userAgent || "");
    var p = s.opts.payload || {};
    Object.keys(p).forEach(function (k) {
      body.set(k, String(p[k]));
    });
    Object.keys(extra || {}).forEach(function (k) {
      body.set(k, String(extra[k]));
    });
    return fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    }).then(function (r) {
      return r.json().catch(function () {
        return { ok: false, message: "服务器繁忙，请稍后再试" };
      });
    });
  }

  /** 数合支付：建单 → 跳收银台 */
  function createEpay() {
    var s = cur;
    var win = openBlankTab();
    if (s.order && s.payurl) {
      jump(s.payurl, win);
      return;
    }
    setBusy(true);
    setMsg("正在创建订单…", "wait");
    post(s.box.getAttribute("data-create") || "", s)
      .then(function (d) {
        if (cur !== s || s.ch !== "epay") {
          if (win) win.close();
          return;
        }
        setBusy(false);
        if (!d || !d.ok || !d.payurl) {
          if (win) win.close();
          setMsg((d && d.message) || "创建订单失败，请稍后再试或换其它支付通道", "err");
          return;
        }
        s.order = d.order_id;
        s.payurl = d.payurl;
        var exp = Number(d.expires_at) > Date.now() ? Number(d.expires_at) : Date.now() + 25 * 60 * 1000;
        if (s.opts.key) save("epay:" + s.opts.key, { order: d.order_id, payurl: d.payurl, exp: exp });
        jump(d.payurl, win);
      })
      .catch(function () {
        if (cur !== s) return;
        if (win) win.close();
        setBusy(false);
        setMsg("网络异常，没能创建订单，请稍后再试", "err");
      });
  }

  /** 云猫 / 纪元：建单 → 本页出付款码 */
  function createCs() {
    var s = cur;
    var ch = s.ch;
    if (s.order && s.qr) {
      drawQr(s.box, s.qr);
      return;
    }
    setBusy(true);
    clearQr(s.box);
    setMsg("正在生成付款码（约 5～10 秒）…", "wait");
    post(s.box.getAttribute("data-cs-create") || "", s, { platform: ch })
      .then(function (d) {
        if (cur !== s || s.ch !== ch) return;
        setBusy(false);
        if (!d || !d.ok || !d.qr) {
          setMsg((d && d.message) || "生成付款码失败，请稍后再试或换其它支付通道", "err");
          return;
        }
        s.order = d.order_id;
        s.qr = d.qr;
        s.startedAt = Date.now();
        var exp = Number(d.expires_at) > Date.now() ? Number(d.expires_at) : Date.now() + 5 * 60 * 1000;
        if (s.opts.key) save(ch + ":" + s.opts.key, { order: d.order_id, qr: d.qr, exp: exp + 30 * 60 * 1000 });
        drawQr(s.box, d.qr);
        setMsg(isMobile ? "点「打开支付宝付款」或用支付宝扫码付款，付完自动到账，不用填订单号" : "请用支付宝扫码付款，付完自动到账，不用填订单号", "wait");
        schedule(6000);
      })
      .catch(function () {
        if (cur !== s) return;
        setBusy(false);
        setMsg("网络异常，没能生成付款码，请稍后再试", "err");
      });
  }

  function schedule(ms) {
    stop();
    if (!cur || cur.done || !cur.order) return;
    if (cur.startedAt && Date.now() - cur.startedAt > POLL_MAX_MS) {
      setMsg("还没查到付款。如果已经付了，稍后刷新页面就能看到到账；还没付可以重新生成付款", "");
      return;
    }
    var s = cur;
    s.timer = setTimeout(function () {
      if (cur === s) poll();
    }, ms);
  }
  function poll() {
    var s = cur;
    if (!s || s.done || !s.order) return;
    if (!s.box.isConnected) {
      stop();
      cur = null;
      return;
    }
    var cs = isCs(s.ch);
    var url = s.box.getAttribute(cs ? "data-cs-status" : "data-status") || "";
    fetch(url + (url.indexOf("?") >= 0 ? "&" : "?") + "order=" + encodeURIComponent(s.order), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    })
      .then(function (r) {
        return r.json().catch(function () {
          return null;
        });
      })
      .then(function (d) {
        if (cur !== s || s.done) return;
        if (!d || !d.ok) {
          schedule(6000);
          return;
        }
        var st = d.status;
        var skey = s.opts.key ? s.ch + ":" + s.opts.key : "";
        if (st === "fulfilled") {
          s.done = true;
          stop();
          showReopen("");
          clearQr(s.box);
          if (skey) save(skey, null);
          setBusy(true);
          setMsg(d.message || "付款成功，已到账", "ok");
          if (typeof s.opts.onDone === "function") s.opts.onDone(d);
          return;
        }
        if (st === "pending") {
          if (!cs && d.payurl) {
            s.payurl = d.payurl;
            showReopen(d.payurl);
          }
          schedule(cs ? 6000 : Date.now() - s.startedAt > 3 * 60 * 1000 ? 6000 : 3000);
          return;
        }
        if (st === "paid") {
          setMsg(d.message || "已收到付款，正在到账…", "wait");
          showReopen("");
          schedule(2500);
          return;
        }
        showReopen("");
        if (st === "issue") {
          setMsg((d.message || "已收到付款，到账遇到问题") + "（订单号 " + s.order + "）", "err");
          schedule(10000);
          return;
        }
        if (skey) save(skey, null);
        s.order = null;
        s.payurl = "";
        s.qr = "";
        clearQr(s.box);
        // 从收银台跳回时不知道用户选的是哪件商品：不能再点，提示重新选
        var canRetry = !!s.opts.payload;
        setBusy(!canRetry);
        setMsg(
          (d.message || "订单已结束") + (st === "mismatch" ? "（订单号 " + d.order_id + "）" : "") + (canRetry ? "" : "。如需继续，请在下方重新选择后付款"),
          st === "expired" ? "" : "err"
        );
      })
      .catch(function () {
        if (cur === s) schedule(6000);
      });
  }

  /** 从数合支付收银台跳回：地址带 ?epay=订单号 时接着查这一单，查到结果前不再建新单。 */
  function resume(box, opts) {
    var id = "";
    try {
      id = new URLSearchParams(location.search).get("epay") || "";
    } catch (e) {
      id = "";
    }
    if (!box || !/^YT\d{20}$/.test(id)) return false;
    try {
      var u = new URL(location.href);
      u.searchParams.delete("epay");
      history.replaceState(history.state, "", u.pathname + u.search + u.hash);
    } catch (e) {
      /* 去不掉参数只影响地址栏美观 */
    }
    stop();
    cur = { box: box, opts: opts || {}, ch: "epay", order: id, payurl: "", qr: "", timer: null, startedAt: Date.now(), done: false };
    box.hidden = false;
    box.querySelectorAll("[data-epay-tab]").forEach(function (t) {
      t.hidden = t.getAttribute("data-epay-tab") !== "epay";
    });
    var tabs = q(box, ".epay-tabs");
    if (tabs) tabs.hidden = true;
    selectTab(box, "epay");
    var sum = q(box, "[data-epay-sum]");
    if (sum) sum.textContent = cur.opts.sum || "—";
    var desc = q(box, "[data-epay-desc]");
    if (desc) desc.textContent = cur.opts.desc || "";
    setBusy(true);
    setMsg("正在确认付款结果…", "wait");
    poll();
    return true;
  }

  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (!cur) return;
    var go = t.closest("[data-epay-go]");
    if (go && cur.box.contains(go)) {
      e.preventDefault();
      if (!cur.done && cur.ch === "epay") createEpay();
      return;
    }
    var csGo = t.closest("[data-cs-go]");
    if (csGo && cur.box.contains(csGo)) {
      e.preventDefault();
      if (!cur.done && isCs(cur.ch)) createCs();
      return;
    }
    var tab = t.closest("[data-epay-tab]");
    if (tab && cur.box.contains(tab)) {
      e.preventDefault();
      var ch = tab.getAttribute("data-epay-tab") || "";
      if (ch && ch !== cur.ch && !cur.done) useChannel(ch);
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && cur && cur.order && !cur.done) {
      stop();
      poll();
    }
  });

  window.ytEpay = { show: show, hide: hide, resume: resume, channels: channels };
})();
