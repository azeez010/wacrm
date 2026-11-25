// The browser script customers paste on their site. Plain ES5-ish JavaScript,
// no dependencies, and it never loads anything until it is needed:
//   inline  : <div data-ogadesk-form="ID"></div>  -> responsive iframe
//   widget  : <script src=".../embed.js" data-widget="ID" async></script>
//             -> floating button (animation, teaser bubble, sound), the panel iframe is
//                created on first click
//   preview : data-preview="1" is used by the dashboard editor: it takes the draft config
//             by postMessage instead of fetching it, so every edit shows instantly.
//
// It forwards the HOST page's URL params, referrer and a visitor id into the iframe
// (an iframe cannot see its parent's UTM) and fires `ogadesk:submitted` on the host
// window so the site's own pixels can react.
// NOTE: kept free of backticks / template literals so it embeds safely.

export const EMBED_SCRIPT = `(function () {
  'use strict';
  var cur = document.currentScript;
  var BASE = (function () { try { return new URL(cur.src).origin; } catch (e) { return ''; } })();
  if (!BASE) return;
  var PREVIEW = cur.getAttribute('data-preview') === '1';
  var done = window.__ogadeskInit || (window.__ogadeskInit = {});

  function rand() {
    var a = new Uint8Array(12); crypto.getRandomValues(a);
    var s = ''; for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
    return s;
  }
  function vid() {
    try { var k = 'ogadesk:vid', v = localStorage.getItem(k); if (!v) { v = rand(); localStorage.setItem(k, v); } return v; }
    catch (e) { return rand(); }
  }
  function store(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) {} return null; }
  function frameSrc(id, chat) {
    var p = new URLSearchParams(location.search);
    p.set('ogvid', vid());
    if (document.referrer) p.set('ogref', document.referrer.slice(0, 500));
    p.set('ogpage', location.href.slice(0, 800));
    if (PREVIEW) p.set('preview', '1');
    // Live chat has its own page, except in the editor preview, which renders it from the draft config.
    return BASE + (chat && !PREVIEW ? '/embed/chat/' : '/embed/f/') + encodeURIComponent(id) + '?' + p.toString();
  }
  function emit(id, detail) {
    try { window.dispatchEvent(new CustomEvent('ogadesk:submitted', { detail: Object.assign({ formId: id }, detail || {}) })); } catch (e) {}
  }
  function onMessage(id, frame, onHeight) {
    window.addEventListener('message', function (e) {
      var d = e.data;
      if (!d || d.source !== 'ogadesk' || e.source !== frame.contentWindow) return;
      if (d.type === 'resize' && d.height) onHeight(d.height);
      if (d.type === 'submitted') {
        emit(id, { whatsappUrl: d.whatsappUrl || null, redirectUrl: d.redirectUrl || null });
        store('ogadesk:opened:' + id, '1');
        if (d.whatsappUrl) { try { window.open(d.whatsappUrl, '_blank', 'noopener'); } catch (err) {} }
        else if (d.redirectUrl) { location.href = d.redirectUrl; }
      }
    });
  }

  // ---------- inline ----------
  function inline(el) {
    if (el.__og) return; el.__og = true;
    var id = el.getAttribute('data-ogadesk-form'); if (!id) return;
    var f = document.createElement('iframe');
    f.src = frameSrc(id); f.setAttribute('aria-label', 'Form'); f.loading = 'lazy';
    f.style.cssText = 'display:block;width:100%;max-width:100%;border:0;height:420px;color-scheme:normal';
    el.appendChild(f);
    onMessage(id, f, function (h) { f.style.height = h + 'px'; });
  }
  function scan() {
    var els = document.querySelectorAll('[data-ogadesk-form]');
    for (var i = 0; i < els.length; i++) inline(els[i]);
  }

  // ---------- floating widget ----------
  var ICONS = {
    whatsapp: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm5.2 14.2c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.2-4.6-4-4.7-4.2-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.4.6c-.1.2-.3.3-.1.6.2.3.8 1.3 1.7 2.1 1.2 1 2.2 1.4 2.5 1.5.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.8-.1 1.4z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>',
    headset: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M12 2a9 9 0 0 0-9 9v7a3 3 0 0 0 3 3h2v-8H5v-2a7 7 0 0 1 14 0v2h-3v8h3a3 3 0 0 0 3-3v-7a9 9 0 0 0-9-9z"/></svg>'
  };
  var CSS = '@keyframes ogpulse{0%{box-shadow:0 0 0 0 var(--ogc)}70%{box-shadow:0 0 0 16px rgba(0,0,0,0)}100%{box-shadow:0 0 0 0 rgba(0,0,0,0)}}' +
    '@keyframes ogbounce{0%,20%,50%,80%,100%{transform:translateY(0)}40%{transform:translateY(-12px)}60%{transform:translateY(-6px)}}' +
    '@keyframes ogwiggle{0%,30%,100%{transform:rotate(0)}6%{transform:rotate(-10deg)}12%{transform:rotate(9deg)}18%{transform:rotate(-6deg)}24%{transform:rotate(4deg)}}' +
    '@keyframes ogring{0%,60%,100%{transform:scale(1)}10%{transform:scale(1.14)}20%{transform:scale(1)}30%{transform:scale(1.1)}40%{transform:scale(1)}}' +
    '@keyframes ogpop{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}' +
    '.og-pulse{animation:ogpulse 2.2s infinite}.og-bounce{animation:ogbounce 3s infinite}.og-wiggle{animation:ogwiggle 4s infinite}.og-ring{animation:ogring 3.5s infinite}' +
    '@media (prefers-reduced-motion:reduce){.og-pulse,.og-bounce,.og-wiggle,.og-ring{animation:none!important}}';
  function isMobile() { return /mobi|android|iphone/i.test(navigator.userAgent) || window.innerWidth < 600; }
  function isDark(theme) { return theme === 'dark' || (theme !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
  // Browsers (Chrome especially) keep audio locked until the visitor has clicked, tapped or pressed a key.
  // We prepare the audio context on those gestures, and a chime that was blocked plays as soon as it unlocks
  // (only if its bubble is still showing).
  var pending = null;
  function ctx() { var C = window.AudioContext || window.webkitAudioContext; if (!C) return null; return window.__ogA || (window.__ogA = new C()); }
  function play(a, kind) {
    var t = a.currentTime + 0.01;
    function tone(f, s, d, v, type) {
      var o = a.createOscillator(), g = a.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, t + s);
      g.gain.setValueAtTime(0.0001, t + s); g.gain.exponentialRampToValueAtTime(v, t + s + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + s + d);
      o.connect(g); g.connect(a.destination); o.start(t + s); o.stop(t + s + d + 0.05);
    }
    if (kind === 'pop') { tone(700, 0, 0.16, 0.7, 'triangle'); tone(1050, 0, 0.1, 0.35, 'sine'); }
    else { tone(988, 0, 0.35, 0.6, 'triangle'); tone(1318, 0.11, 0.55, 0.55, 'triangle'); tone(1976, 0.11, 0.35, 0.18, 'sine'); }
  }
  function unlock() {
    var a = ctx(); if (!a) return;
    var go = function () {
      if (a.state !== 'running') return;
      ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'click'].forEach(function (ev) { window.removeEventListener(ev, unlock, true); });
      try { var b = a.createBuffer(1, 1, 22050), src = a.createBufferSource(); src.buffer = b; src.connect(a.destination); src.start(0); } catch (e) {}
      var p = pending; pending = null;
      if (p && p.ok()) play(a, p.kind);
    };
    try { var r = a.resume(); if (r && r.then) r.then(go, function () {}); else go(); } catch (e) {}
  }
  ['pointerdown', 'mousedown', 'keydown', 'touchstart', 'click'].forEach(function (ev) { window.addEventListener(ev, unlock, true); });
  function beep(kind, stillWanted) {
    try {
      if (!kind || kind === 'none') return;
      var a = ctx(); if (!a) return;
      if (a.state === 'running') { play(a, kind); return; }
      pending = { kind: kind, ok: stillWanted || function () { return true; } };
      var r = a.resume(); if (r && r.then) r.then(function () { if (a.state === 'running' && pending) { var p = pending; pending = null; if (p.ok()) play(a, p.kind); } }, function () {});
    } catch (e) {}
  }
  function inHours(h, tz) {
    if (!h || !h.enabled) return true;
    try {
      var parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz || undefined, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
      var m = {}; for (var i = 0; i < parts.length; i++) m[parts[i].type] = parts[i].value;
      var day = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[m.weekday];
      var now = m.hour + ':' + m.minute;
      return h.days.indexOf(day) !== -1 && now >= h.from && now <= h.to;
    } catch (e) { return true; }
  }

  function widget(id) {
    if (done['w' + id]) return; done['w' + id] = true;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'og-btn';
    var panel = document.createElement('div');
    var head = document.createElement('div');
    var title = document.createElement('span');
    var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
    x.style.cssText = 'border:0;background:transparent;color:#fff;font-size:22px;line-height:1;cursor:pointer';
    head.appendChild(title); head.appendChild(x); panel.appendChild(head);
    if (PREVIEW) {
      title.contentEditable = 'plaintext-only'; title.style.cursor = 'text'; title.style.outline = 'none';
      var before = '';
      title.addEventListener('focus', function () { before = title.textContent; });
      title.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); title.blur(); }
        else if (ev.key === 'Escape') { title.textContent = before; title.blur(); }
      });
      title.addEventListener('blur', function () {
        var v = (title.textContent || '').replace(/\\s+/g, ' ').trim();
        if (v !== before) { try { window.parent.postMessage({ source: 'ogadesk-preview-edit', edit: { kind: 'greeting', value: v } }, BASE); } catch (x) {} }
      });
    }
    var offline = document.createElement('div');
    var teaser = document.createElement('div');
    var tx = document.createElement('button'); tx.type = 'button'; tx.setAttribute('aria-label', 'Dismiss'); tx.textContent = '×';
    var tt = document.createElement('span');
    teaser.appendChild(tt); teaser.appendChild(tx);
    var frame = null, cfg = null, teaserTimer = null, opened = false;

    function postConfig() {
      if (PREVIEW && frame && frame.contentWindow && cfg) { try { frame.contentWindow.postMessage({ source: 'ogadesk-preview', config: cfg }, BASE); } catch (e) {} }
    }
    function hideTeaser() { teaser.style.display = 'none'; }
    function showTeaser(withSound) {
      if (!cfg || !cfg.widget || !cfg.widget.preMessage || opened) return;
      teaser.style.display = 'flex'; teaser.style.animation = 'ogpop .35s ease both';
      if (withSound) beep(cfg.widget.sound, function () { return teaser.style.display === 'flex'; });
      if (!PREVIEW) store('ogadesk:teaser:' + id, '1');
    }
    function ensureFrame() {
      if (frame) return;
      frame = document.createElement('iframe'); frame.setAttribute('aria-label', (cfg && cfg.title) || 'Chat'); frame.src = frameSrc(id, !!(cfg && cfg.widget && cfg.widget.mode === 'live_chat'));
      frame.style.cssText = 'display:block;width:100%;border:0;height:300px;color-scheme:normal';
      frame.addEventListener('load', postConfig);
      panel.appendChild(frame);
      onMessage(id, frame, function (h) { frame.style.height = Math.min(h, Math.floor(window.innerHeight * 0.85) - 50) + 'px'; });
    }
    function send(t) { if (frame && frame.contentWindow) { try { frame.contentWindow.postMessage({ source: 'ogadesk-host', type: t }, BASE); } catch (e) {} } }
    function open() {
      opened = true; hideTeaser(); btn.className = 'og-btn'; store('ogadesk:opened:' + id, '1');
      panel.style.display = 'block';
      ensureFrame();
      send('open');
      postConfig();
    }
    function close() { panel.style.display = 'none'; opened = false; send('close'); }
    btn.addEventListener('click', function () { panel.style.display === 'block' ? close() : open(); });
    x.addEventListener('click', close);
    tx.addEventListener('click', function (e) { e.stopPropagation(); hideTeaser(); store('ogadesk:opened:' + id, '1'); });
    teaser.addEventListener('click', open);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    function apply(c) {
      cfg = c; var w = c.widget || {};
      // Live chat: warm the hidden iframe shortly after load so the first click opens instantly.
      if (!PREVIEW && w.mode === 'live_chat' && !frame) setTimeout(ensureFrame, 1500);
      var color = w.color || c.accent || '#16a34a', left = w.corner === 'bottom-left', dark = isDark(c.theme);
      var side = (left ? 'left:' : 'right:') + (w.offsetX || 20) + 'px;' + (left ? 'right:auto;' : 'left:auto;');
      btn.setAttribute('aria-label', w.label || 'Chat');
      btn.innerHTML = (ICONS[w.icon] || ICONS.whatsapp) + (w.label ? '<span style="margin-left:8px;font:600 14px system-ui,sans-serif">' + w.label.replace(/</g, '&lt;') + '</span>' : '');
      btn.style.cssText = 'position:fixed;z-index:2147483000;display:flex;align-items:center;border:0;cursor:pointer;color:#fff;background:' + color + ';--ogc:' + color + '66;padding:' + (w.label ? '14px 18px' : '14px') + ';border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.25);bottom:' + (w.offsetY || 20) + 'px;' + side;
      btn.className = 'og-btn' + (!opened && w.animation && w.animation !== 'none' ? ' og-' + w.animation : '');
      var mobile = isMobile();
      panel.style.cssText = 'position:fixed;z-index:2147483001;display:' + (panel.style.display === 'block' ? 'block' : 'none') + ';background:' + (dark ? '#111827' : '#fff') + ';border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);overflow:hidden;width:360px;max-width:calc(100vw - 16px);max-height:85vh;bottom:' + ((w.offsetY || 20) + 64) + 'px;' + side +
        (mobile ? ';left:0;right:0;bottom:0;width:100%;max-width:100%;border-radius:16px 16px 0 0' : '');
      var lc = w.mode === 'live_chat';
      head.style.cssText = (lc ? 'position:absolute;top:0;right:0;z-index:2;padding:8px 12px;' : 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:' + color + ';') + 'color:#fff;font:600 14px system-ui,sans-serif';
      title.textContent = lc ? '' : w.greeting || c.title || '';
      if (!lc && w.hours && w.hours.enabled && !inHours(w.hours, c.timezone)) {
        offline.style.cssText = 'padding:8px 14px;background:' + (dark ? '#422006' : '#fef3c7') + ';color:' + (dark ? '#fde68a' : '#78350f') + ';font:13px system-ui,sans-serif';
        offline.textContent = w.hours.offlineText || 'We are offline right now. Leave your number and we will reply.';
        if (!offline.parentNode) panel.insertBefore(offline, head.nextSibling);
      } else if (offline.parentNode) { offline.parentNode.removeChild(offline); }
      teaser.style.cssText = 'position:fixed;z-index:2147483000;display:' + (teaser.style.display === 'flex' ? 'flex' : 'none') + ';align-items:center;gap:8px;max-width:240px;cursor:pointer;padding:10px 12px;border-radius:14px;box-shadow:0 6px 24px rgba(0,0,0,.25);font:14px system-ui,sans-serif;background:' + (dark ? '#1f2937' : '#fff') + ';color:' + (dark ? '#f3f4f6' : '#111827') + ';bottom:' + ((w.offsetY || 20) + 64) + 'px;' + side;
      tx.style.cssText = 'border:0;background:transparent;color:inherit;opacity:.6;font-size:16px;line-height:1;cursor:pointer';
      tt.textContent = w.preMessage || '';
      if (!w.preMessage) hideTeaser();
      postConfig();
    }

    function mount(c) {
      var w = c.widget; if (!w) return;
      if (!PREVIEW) {
        if (w.devices === 'mobile' && !isMobile()) return;
        if (w.devices === 'desktop' && isMobile()) return;
        if (w.showOn === 'contains' && w.urlContains && location.href.indexOf(w.urlContains) === -1) return;
      }
      var first = !btn.parentNode;
      apply(c);
      if (first) {
        document.body.appendChild(panel); document.body.appendChild(teaser); document.body.appendChild(btn);
        if (!PREVIEW && w.preMessage && (w.preMessageRepeat === 'always' || (!store('ogadesk:teaser:' + id) && !store('ogadesk:opened:' + id)))) {
          teaserTimer = setTimeout(function () { showTeaser(true); }, Math.max(0, (w.preMessageDelay == null ? 4 : w.preMessageDelay)) * 1000);
        }
        if (PREVIEW && w.preMessage) setTimeout(function () { showTeaser(false); }, 500);
      } else if (PREVIEW && w.preMessage && teaser.style.display !== 'flex' && !opened) { showTeaser(false); }
    }

    if (PREVIEW) {
      window.addEventListener('message', function (e) {
        if (e.origin !== BASE) return;
        var d = e.data; if (!d) return;
        if (d.source === 'ogadesk-preview' && d.config) mount(d.config);
        else if (d.source === 'ogadesk-preview-play') { if (cfg && cfg.widget) beep(cfg.widget.sound === 'none' ? 'chime' : cfg.widget.sound); }
        else if (d.source === 'ogadesk-preview-ready' && e.source === (frame && frame.contentWindow)) postConfig();
        else if (d.source === 'ogadesk-preview-edit' && e.source === (frame && frame.contentWindow)) { try { window.parent.postMessage(d, BASE); } catch (x) {} }
      });
      try { window.parent.postMessage({ source: 'ogadesk-preview-host-ready' }, BASE); } catch (e) {}
    } else {
      fetch(BASE + '/api/public/forms/' + encodeURIComponent(id)).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) { if (c) mount(c); }).catch(function () {});
    }
  }

  function boot() {
    scan();
    var wid = cur.getAttribute('data-widget'); if (wid) widget(wid);
    if (window.MutationObserver) new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
`
