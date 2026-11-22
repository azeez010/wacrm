// The browser script customers paste on their site. Plain ES5-ish JavaScript,
// no dependencies, ~4 KB, and it never loads anything until it is needed:
//   inline  : <div data-ogadesk-form="ID"></div>  -> responsive iframe
//   widget  : <script src=".../embed.js" data-widget="ID" async></script>
//             -> floating button, the iframe is created on first click
//
// It forwards the HOST page's URL params, referrer and a visitor id into the
// iframe (an iframe cannot see its parent's UTM) and fires
// `ogadesk:submitted` on the host window so the site's own pixels can react.
// NOTE: written without backticks / template literals so it embeds safely.

export const EMBED_SCRIPT = `(function () {
  'use strict';
  var cur = document.currentScript;
  var BASE = (function () { try { return new URL(cur.src).origin; } catch (e) { return ''; } })();
  if (!BASE) return;
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
  function frameSrc(id) {
    var p = new URLSearchParams(location.search);
    p.set('ogvid', vid());
    if (document.referrer) p.set('ogref', document.referrer.slice(0, 500));
    p.set('ogpage', location.href.slice(0, 800));
    return BASE + '/embed/f/' + encodeURIComponent(id) + '?' + p.toString();
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
    f.src = frameSrc(id); f.title = 'Form'; f.loading = 'lazy';
    f.style.cssText = 'display:block;width:100%;max-width:100%;border:0;height:420px;color-scheme:light';
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
  function isMobile() { return /mobi|android|iphone/i.test(navigator.userAgent) || window.innerWidth < 600; }
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
    fetch(BASE + '/api/public/forms/' + encodeURIComponent(id)).then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
      if (!cfg || !cfg.widget) return;
      var w = cfg.widget;
      if (w.devices === 'mobile' && !isMobile()) return;
      if (w.devices === 'desktop' && isMobile()) return;
      if (w.showOn === 'contains' && w.urlContains && location.href.indexOf(w.urlContains) === -1) return;

      var color = w.color || cfg.accent || '#16a34a';
      var left = w.corner === 'bottom-left';
      var btn = document.createElement('button');
      btn.type = 'button'; btn.setAttribute('aria-label', w.label || 'Chat');
      btn.innerHTML = (ICONS[w.icon] || ICONS.whatsapp) + (w.label ? '<span style="margin-left:8px;font:600 14px system-ui,sans-serif">' + w.label.replace(/</g, '&lt;') + '</span>' : '');
      btn.style.cssText = 'position:fixed;z-index:2147483000;display:flex;align-items:center;border:0;cursor:pointer;color:#fff;background:' + color +
        ';padding:' + (w.label ? '14px 18px' : '14px') + ';border-radius:999px;box-shadow:0 6px 24px rgba(0,0,0,.25);bottom:' + (w.offsetY || 20) + 'px;' + (left ? 'left:' : 'right:') + (w.offsetX || 20) + 'px';
      var panel = document.createElement('div');
      panel.style.cssText = 'position:fixed;z-index:2147483001;display:none;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);overflow:hidden;width:360px;max-width:calc(100vw - 16px);max-height:85vh;bottom:' + ((w.offsetY || 20) + 64) + 'px;' + (left ? 'left:' : 'right:') + (w.offsetX || 20) + 'px';
      var mobile = isMobile();
      if (mobile) panel.style.cssText += ';left:0;right:0;bottom:0;width:100%;max-width:100%;border-radius:16px 16px 0 0';
      var head = document.createElement('div');
      head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:' + color + ';color:#fff;font:600 14px system-ui,sans-serif';
      var title = document.createElement('span'); title.textContent = w.greeting || cfg.title || '';
      var x = document.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Close'); x.textContent = '\\u00d7';
      x.style.cssText = 'border:0;background:transparent;color:#fff;font-size:22px;line-height:1;cursor:pointer';
      head.appendChild(title); head.appendChild(x); panel.appendChild(head);
      if (w.hours && w.hours.enabled && !inHours(w.hours, cfg.timezone)) {
        var off = document.createElement('div');
        off.style.cssText = 'padding:8px 14px;background:#fef3c7;color:#78350f;font:13px system-ui,sans-serif';
        off.textContent = w.hours.offlineText || 'We are offline right now. Leave your number and we will reply.';
        panel.appendChild(off);
      }
      var frame = null;
      function open() {
        panel.style.display = 'block';
        if (!frame) {
          frame = document.createElement('iframe');
          frame.title = cfg.title || 'Chat'; frame.src = frameSrc(id);
          frame.style.cssText = 'display:block;width:100%;border:0;height:300px;color-scheme:light';
          panel.appendChild(frame);
          onMessage(id, frame, function (h) { frame.style.height = Math.min(h, Math.floor(window.innerHeight * 0.85) - 50) + 'px'; });
        }
      }
      function close() { panel.style.display = 'none'; }
      btn.addEventListener('click', function () { panel.style.display === 'block' ? close() : open(); });
      x.addEventListener('click', close);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
      document.body.appendChild(panel); document.body.appendChild(btn);
    }).catch(function () {});
  }

  function boot() {
    scan();
    var wid = cur.getAttribute('data-widget'); if (wid) widget(wid);
    if (window.MutationObserver) new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
`
