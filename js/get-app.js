// js/get-app.js — a small "Get the Android app" bar for people using the web app on an Android phone.
// Shown once in a while (closing it hides it for 14 days), never inside the Android app itself (its WebViews carry
// "; wv)" in the user agent), never on iPhone or computers. It links to /download (rehablix.com/download).
(function () {
  const KEY = 'rx-getapp-closed';
  const ua = navigator.userAgent || '';
  if (!/Android/i.test(ua) || /; wv\)/.test(ua)) return;
  try { const t = Number(localStorage.getItem(KEY) || 0); if (t && Date.now() - t < 14 * 86400000) return; } catch (e) { /* storage blocked: show it */ }

  function show() {
    if (document.getElementById('rxGetApp')) return;
    const bar = document.createElement('div');
    bar.id = 'rxGetApp';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Get the Android app');
    bar.innerHTML =
      '<img src="img/icon-192.png" alt="">' +
      '<div class="rx-ga-text"><b>Rehablix for Android</b><span>Faster, with voice, camera and recording</span></div>' +
      '<a class="rx-ga-btn" href="download.html">Get app</a>' +
      '<button type="button" class="rx-ga-x" aria-label="Close">&times;</button>';
    const css = document.createElement('style');
    css.textContent =
      '#rxGetApp{position:fixed;left:50%;transform:translateX(-50%);top:calc(10px + env(safe-area-inset-top));z-index:1000;' +
      'width:min(440px,calc(100% - 20px));display:flex;align-items:center;gap:10px;padding:8px 8px 8px 10px;border-radius:18px;' +
      'background:var(--card-bg,rgba(255,255,255,.72));-webkit-backdrop-filter:blur(18px) saturate(160%);backdrop-filter:blur(18px) saturate(160%);' +
      'border:1px solid var(--glass-border,rgba(255,255,255,.6));box-shadow:0 12px 32px rgba(15,23,42,.2);animation:rxGaIn .35s ease}' +
      '#rxGetApp img{width:34px;height:34px;border-radius:10px;background:#fff;flex:none}' +
      '#rxGetApp .rx-ga-text{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.25}' +
      '#rxGetApp .rx-ga-text b{font-size:.9rem;color:var(--text-primary,#1f2933)}' +
      '#rxGetApp .rx-ga-text span{font-size:.75rem;color:var(--text-secondary,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#rxGetApp .rx-ga-btn{flex:none;padding:8px 14px;border-radius:999px;background:var(--accent,#009688);color:#fff;font-weight:700;font-size:.85rem;text-decoration:none}' +
      '#rxGetApp .rx-ga-x{flex:none;width:30px;height:30px;border:0;border-radius:50%;background:transparent;color:var(--text-secondary,#6b7280);font-size:1.3rem;line-height:1;cursor:pointer}' +
      '@keyframes rxGaIn{from{opacity:0;transform:translate(-50%,-8px)}to{opacity:1;transform:translate(-50%,0)}}';
    document.head.appendChild(css);
    document.body.appendChild(bar);
    bar.querySelector('.rx-ga-x').addEventListener('click', () => {
      try { localStorage.setItem(KEY, String(Date.now())); } catch (e) { /* storage blocked */ }
      bar.remove();
    });
  }
  // a few seconds after the page is ready, so it never covers the first look at the page
  // (not the "load" event: the app keeps a live connection open, so "load" can arrive very late or not at all)
  const later = () => setTimeout(show, 4000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later); else later();
})();
