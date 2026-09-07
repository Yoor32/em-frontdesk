/* EM Passport — member check-in card
 * Loads on the bachatasensual.ca Passport > "Check in" tab.
 * Reads the logged-in Duda member, asks the EM Member Card API for that
 * member's card, and renders a wallet-style pass with a 10-minute QR.
 *
 * Repo: Yoor32/em-frontdesk  ·  served from GitHub Pages
 * Backend: https://yoor32.app.n8n.cloud/webhook/member-card
 */
(function () {
  "use strict";

  var API      = "https://yoor32.app.n8n.cloud/webhook/member-card";
  var QR_LIB   = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
  var MOUNT_ID = "em-checkin";
  var REFRESH_LEAD_MS = 60 * 1000;   // re-mint one minute before the token dies

  var timer = null;
  var card  = null;

  /* ---------- tiny helpers ---------- */
  function el(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function mount() {
    var m = el(MOUNT_ID);
    if (!m) {
      m = document.createElement("div");
      m.id = MOUNT_ID;
      document.body.appendChild(m);
    }
    return m;
  }

  /* ---------- identity ----------
   * Duda does not document the shape of getLoggedInMember(). Rather than
   * guess one, walk the response and take the first email and id we find.
   * The raw shape is logged once so it can be pinned down for good.
   */
  function deepFind(obj, keys, depth) {
    if (!obj || typeof obj !== "object" || depth > 4) return "";
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (typeof v === "string" && v) return v;
    }
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var child = obj[k];
      if (child && typeof child === "object") {
        var hit = deepFind(child, keys, depth + 1);
        if (hit) return hit;
      }
    }
    return "";
  }

  function readIdentity(res) {
    var email = deepFind(res, ["email", "emailAddress", "email_address"], 0);
    var id    = deepFind(res, ["memberId", "member_id", "id", "uuid"], 0);
    return {
      email: String(email || "").trim().toLowerCase(),
      memberId: /^[0-9a-f-]{20,}$/i.test(id) ? id : ""
    };
  }

  /* ---------- states ---------- */
  function shell(inner) { mount().innerHTML = '<div class="emw-wrap">' + inner + "</div>"; }

  function showLoading() {
    shell('<div class="emw-card emw-skeleton"><div class="emw-sk emw-sk-a"></div><div class="emw-sk emw-sk-b"></div><div class="emw-sk emw-sk-qr"></div><div class="emw-sk emw-sk-c"></div></div>');
  }

  function showMessage(title, body, cta) {
    shell(
      '<div class="emw-card emw-msg">' +
        '<div class="emw-brand"><span class="emw-mark">EM</span><span class="emw-brandtext">PASSPORT</span></div>' +
        '<div class="emw-msgtitle">' + esc(title) + "</div>" +
        '<div class="emw-msgbody">' + esc(body) + "</div>" +
        (cta ? '<a class="emw-cta" href="' + esc(cta.href) + '">' + esc(cta.label) + "</a>" : "") +
      "</div>"
    );
  }

  var REASONS = {
    not_a_member:      ["Not an active member", "This account is not on an EM Passport membership yet."],
    no_plan_group:     ["Membership not active", "Your account exists but has no active EM Passport plan. The front desk can sort this out in a minute."],
    inactive:          ["Membership paused", "Your EM Passport account is not active right now."],
    no_student_row:    ["We can't find your record", "Your membership is active but we have no student profile for this email. Please mention it at the front desk."],
    no_passport:       ["Passport number pending", "Your passport number has not been issued yet. The front desk can issue one on the spot."],
    duda_unavailable:  ["Not responding", "We could not reach the membership system. Please try again in a moment."],
    duda_empty:        ["Not responding", "We could not reach the membership system. Please try again in a moment."],
    no_identity:       ["Please sign in", "We could not tell who you are. Sign in and reload this page."]
  };

  /* ---------- the card ---------- */
  function render(c) {
    card = c;
    var pctSafe = Math.max(0, Math.min(100, Number(c.pct) || 0));
    var initials = String(c.name || "?").split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (w) { return w.charAt(0); }).join("").toUpperCase();

    shell(
      '<div class="emw-card">' +
        '<div class="emw-sheen"></div>' +
        '<div class="emw-brand">' +
          '<span class="emw-mark">EM</span><span class="emw-brandtext">PASSPORT</span>' +
          '<span class="emw-pill">' + (c.member ? "Member" : "Guest") + "</span>" +
        "</div>" +

        '<div class="emw-who">' +
          '<div class="emw-avatar">' + esc(initials) + "</div>" +
          "<div>" +
            '<div class="emw-name">' + esc(c.name) + "</div>" +
            '<div class="emw-pass">' + esc(c.passport) + "</div>" +
          "</div>" +
        "</div>" +

        '<div class="emw-qrpanel">' +
          '<div id="emw-qr" class="emw-qr"></div>' +
          '<div class="emw-scanhint">Show this at the entrance</div>' +
        "</div>" +

        '<div class="emw-ttl">' +
          '<div class="emw-ttlbar"><span id="emw-ttlfill"></span></div>' +
          '<div class="emw-ttltext">Refreshes in <b id="emw-ttlnum">--:--</b></div>' +
        "</div>" +

        '<div class="emw-divider"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>' +

        '<div class="emw-stamps">' +
          '<div class="emw-stamprow">' +
            "<span>" + esc(c.stamps) + " stamps</span>" +
            "<span>" + esc(c.remaining) + " to go</span>" +
          "</div>" +
          '<div class="emw-progress"><span style="width:' + pctSafe + '%"></span></div>' +
          '<div class="emw-next">Next: ' + esc(c.nextLabel) + " · " + esc(c.nextAt) + " stamps</div>" +
        "</div>" +
      "</div>"
    );

    drawQr(c.token);
    startCountdown(c.expiresAt);
  }

  /* ---------- QR ----------
   * Drawn in the browser on purpose. The old staff card sent the passport to
   * api.qrserver.com; sending a live check-in token to someone else's server
   * would hand them a working credential.
   */
  function drawQr(token) {
    var box = el("emw-qr");
    if (!box) return;
    withQrLib(function (ok) {
      if (!ok) { box.innerHTML = '<div class="emw-qrfail">Could not draw the code.<br>Show your name at the desk.</div>'; return; }
      box.innerHTML = "";
      new window.QRCode(box, {
        text: token,
        width: 190,
        height: 190,
        colorDark: "#0d0d0f",
        colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel.M
      });
    });
  }

  function withQrLib(cb) {
    if (window.QRCode) return cb(true);
    var s = document.createElement("script");
    s.src = QR_LIB;
    s.onload = function () { cb(!!window.QRCode); };
    s.onerror = function () { cb(false); };
    document.head.appendChild(s);
  }

  /* ---------- countdown + refresh ---------- */
  function startCountdown(expiresAt) {
    if (timer) clearInterval(timer);
    var end = new Date(expiresAt).getTime();
    if (!end || isNaN(end)) return;
    var total = Math.max(1, end - Date.now());

    function tick() {
      var left = end - Date.now();
      var num = el("emw-ttlnum");
      var fill = el("emw-ttlfill");
      if (!num) { clearInterval(timer); return; }
      if (left <= REFRESH_LEAD_MS) { clearInterval(timer); load(true); return; }
      var s = Math.max(0, Math.floor((left - REFRESH_LEAD_MS) / 1000));
      num.textContent = Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2);
      if (fill) fill.style.width = Math.max(0, Math.min(100, (left / total) * 100)) + "%";
    }
    tick();
    timer = setInterval(tick, 1000);
  }

  /* A phone that slept through the expiry gets a fresh code on wake, not a dead one. */
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" || !card) return;
    if (new Date(card.expiresAt).getTime() - Date.now() <= REFRESH_LEAD_MS) load(true);
  });

  /* ---------- load ---------- */
  function load(silent) {
    if (!silent) showLoading();

    if (!window.dmAPI || typeof window.dmAPI.getLoggedInMember !== "function") {
      showMessage("Please sign in", "Sign in to your EM Passport account to see your check-in code.");
      return;
    }

    window.dmAPI.getLoggedInMember().then(function (res) {
      try { console.log("[EM] getLoggedInMember =", JSON.stringify(res)); } catch (e) { console.log("[EM] getLoggedInMember =", res); }
      var who = readIdentity(res);
      if (!who.email && !who.memberId) {
        showMessage("Please sign in", "We could not read your account details. Sign in and reload this page.");
        return;
      }
      return fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: who.email, memberId: who.memberId })
      }).then(function (r) { return r.json(); }).then(function (d) {
        if (d && d.ok) { render(d); return; }
        var m = REASONS[(d && d.reason) || ""] || ["Something went wrong", "Please try again, or ask the front desk to check you in by name."];
        showMessage(m[0], m[1]);
      });
    }).catch(function () {
      showMessage("Please sign in", "Sign in to your EM Passport account to see your check-in code.");
    });
  }

  /* ---------- styles ---------- */
  function styles() {
    var css = [
      "#" + MOUNT_ID + " *{box-sizing:border-box}",
      ".emw-wrap{display:flex;justify-content:center;padding:18px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}",
      ".emw-card{position:relative;width:100%;max-width:340px;border-radius:22px;padding:20px 20px 22px;color:#f6f2e8;overflow:hidden;",
      "background:linear-gradient(158deg,#1c1c22 0%,#121216 46%,#0b0b0e 100%);",
      "box-shadow:0 1px 0 rgba(255,255,255,.07) inset,0 18px 40px -18px rgba(0,0,0,.85),0 2px 10px rgba(0,0,0,.35);",
      "border:1px solid rgba(212,175,55,.28)}",
      ".emw-sheen{position:absolute;inset:0;pointer-events:none;background:radial-gradient(120% 60% at 50% -20%,rgba(232,199,102,.16),transparent 60%)}",
      ".emw-brand{display:flex;align-items:center;gap:8px;margin-bottom:18px}",
      ".emw-mark{display:inline-grid;place-items:center;width:26px;height:26px;border-radius:7px;font-size:.66rem;font-weight:800;letter-spacing:.02em;color:#1a1a1f;background:linear-gradient(145deg,#f0d585,#c9a227)}",
      ".emw-brandtext{font-size:.68rem;font-weight:700;letter-spacing:.22em;color:#e8c766}",
      ".emw-pill{margin-left:auto;font-size:.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;padding:4px 9px;border-radius:999px;color:#e8c766;background:rgba(232,199,102,.12);border:1px solid rgba(232,199,102,.3)}",
      ".emw-who{display:flex;align-items:center;gap:12px;margin-bottom:16px}",
      ".emw-avatar{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;font-weight:700;font-size:.92rem;color:#1a1a1f;background:linear-gradient(145deg,#f0d585,#c9a227)}",
      ".emw-name{font-size:1.06rem;font-weight:650;line-height:1.2}",
      ".emw-pass{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem;letter-spacing:.16em;color:#e8c766;margin-top:3px}",
      ".emw-qrpanel{background:#fff;border-radius:16px;padding:14px 14px 10px;display:flex;flex-direction:column;align-items:center}",
      ".emw-qr{width:190px;height:190px;display:grid;place-items:center}",
      ".emw-qr img,.emw-qr canvas{display:block;width:190px !important;height:190px !important}",
      ".emw-qrfail{color:#8a8a8a;font-size:.78rem;text-align:center;padding:20px 6px;line-height:1.5}",
      ".emw-scanhint{margin-top:8px;font-size:.68rem;letter-spacing:.06em;text-transform:uppercase;color:#8d8d95;font-weight:600}",
      ".emw-ttl{margin-top:14px}",
      ".emw-ttlbar{height:3px;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden}",
      ".emw-ttlbar span{display:block;height:100%;background:linear-gradient(90deg,#c9a227,#f0d585);transition:width 1s linear}",
      ".emw-ttltext{margin-top:7px;font-size:.7rem;color:#9a9aa2;text-align:center}",
      ".emw-ttltext b{color:#e8c766;font-variant-numeric:tabular-nums}",
      ".emw-divider{display:flex;justify-content:space-between;margin:18px -20px 16px;padding:0 10px}",
      ".emw-divider i{width:7px;height:7px;border-radius:50%;background:rgba(0,0,0,.5);box-shadow:0 1px 0 rgba(255,255,255,.05)}",
      ".emw-stamprow{display:flex;justify-content:space-between;font-size:.78rem;color:#c9c9d1;margin-bottom:7px}",
      ".emw-progress{height:6px;border-radius:999px;background:rgba(255,255,255,.09);overflow:hidden}",
      ".emw-progress span{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#c9a227,#f0d585)}",
      ".emw-next{margin-top:8px;font-size:.72rem;color:#8d8d95}",
      ".emw-msg{text-align:center;padding:34px 24px 32px}",
      ".emw-msg .emw-brand{justify-content:center;margin-bottom:20px}",
      ".emw-msgtitle{font-size:1.02rem;font-weight:650;margin-bottom:8px}",
      ".emw-msgbody{font-size:.84rem;line-height:1.55;color:#a9a9b2}",
      ".emw-cta{display:inline-block;margin-top:16px;padding:9px 18px;border-radius:999px;font-size:.8rem;font-weight:600;text-decoration:none;color:#1a1a1f;background:linear-gradient(145deg,#f0d585,#c9a227)}",
      ".emw-skeleton{min-height:430px}",
      ".emw-sk{border-radius:10px;background:linear-gradient(90deg,rgba(255,255,255,.05),rgba(255,255,255,.11),rgba(255,255,255,.05));background-size:200% 100%;animation:emwsk 1.3s ease-in-out infinite}",
      ".emw-sk-a{height:16px;width:45%;margin-bottom:20px}",
      ".emw-sk-b{height:44px;width:70%;margin-bottom:18px}",
      ".emw-sk-qr{height:218px;border-radius:16px;margin-bottom:16px}",
      ".emw-sk-c{height:38px}",
      "@keyframes emwsk{0%{background-position:200% 0}100%{background-position:-200% 0}}",
      "@media (prefers-reduced-motion:reduce){.emw-sk{animation:none}}"
    ].join("");
    var tag = document.createElement("style");
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function boot() { styles(); load(false); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
