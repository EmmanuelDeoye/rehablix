// js/update-notice.js — "Update available" button.
// The service worker (service-worker.js) takes over as soon as a new version is
// installed, but the open page still runs the old files until it is reloaded.
// When that happens (a new worker takes control of a page that already had one),
// a floating button appears; tapping it reloads the page so the update is live.
// The site also checks for a new version when it comes back to the screen and
// every 30 minutes. Nothing is shown on the very first visit.
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let shown = false, reloading = false;

  function show() {
    if (shown || reloading) return;
    shown = true;
    const css = document.createElement('style');
    css.textContent =
      '.rx-update{position:fixed;left:50%;top:calc(76px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:2147483000;' +
      'display:flex;align-items:center;gap:2px;padding:3px 3px 3px 12px;border-radius:999px;background:rgba(17,24,39,.9);color:#fff;' +
      '-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.14);' +
      'box-shadow:0 8px 22px rgba(0,0,0,.22);font:600 13px/1 Inter,system-ui,sans-serif;white-space:nowrap;animation:rxUpIn .25s ease-out}' +
      '@keyframes rxUpIn{from{opacity:0;transform:translate(-50%,-6px)}to{opacity:1;transform:translate(-50%,0)}}' +
      '.rx-update button{border:0;cursor:pointer;font:inherit;color:inherit;background:transparent}' +
      '.rx-update .rx-go{display:flex;align-items:center;gap:7px;padding:7px 6px}' +
      '.rx-update .rx-go i{font-size:12px;color:#5eead4}' +
      '.rx-update .rx-x{width:26px;height:26px;border-radius:50%;opacity:.75;font-size:12px}' +
      '.rx-update .rx-x:hover{background:rgba(255,255,255,.18);opacity:1}';
    document.head.appendChild(css);
    const box = document.createElement('div');
    box.className = 'rx-update';
    box.setAttribute('role', 'status');
    box.innerHTML = '<button type="button" class="rx-go" title="A new version of Rehablix is ready. Tap to refresh."><i class="fas fa-rotate-right" aria-hidden="true"></i><span>Update ready</span></button>' +
      '<button type="button" class="rx-x" aria-label="Later"><i class="fas fa-xmark" aria-hidden="true"></i></button>';
    box.querySelector('.rx-go').addEventListener('click', () => { reloading = true; location.reload(); });
    box.querySelector('.rx-x').addEventListener('click', () => box.remove());
    document.body.appendChild(box);
  }

  // a new version took over this page (the worker skips waiting and claims open pages)
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) show(); });

  navigator.serviceWorker.ready.then(reg => {
    const check = () => { try { reg.update().catch(() => {}); } catch (e) { /* offline */ } };
    setInterval(check, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  }).catch(() => {});
})();
