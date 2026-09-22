// js/router.js — small router for the rehablix SPA shell (index.html).
// Each route's HTML lives as a plain string in js/view-templates.js
// (window.RehablixTemplates), injected into #appRoot synchronously — no
// runtime fetch() of separate fragment files — then the matching
// window.RehablixViews[name].mount()/.unmount() (registered by that view's
// own script, loaded once up front like every other script) is called.
//
// Lixa and Workspace are the two primary bottom-nav tabs users flip between
// constantly, so they're kept alive: mounted once, then just shown/hidden on
// every later visit (scroll position, search text, in-progress chat, etc.
// all survive) instead of being torn down and rebuilt from scratch. Every
// other route keeps the destroy-and-rebuild behavior (some, like Motion,
// genuinely need to release camera/mic on navigating away).
//
// NAVIGATION MODEL
// Result-like routes carry their parameters in the query string that sits
// BEFORE the hash (index.html?id=abc#/formatview). Following such a link used
// to be a full page load, which threw away Lixa's live state, re-ran Firebase
// auth restoration on every open (a race for the view that needs the user),
// and left "Back" with nowhere sensible to go. Now every in-app link is
// intercepted and handled here with history.pushState + a direct route
// render — same URLs, same deep-link shape, but no reload:
//   RehablixRouter.go(url)          SPA navigation to a same-app URL
//   RehablixRouter.back(fallback)   return to the page the user came FROM
//                                   (falls back to `fallback` when this
//                                   entry is the first one of the session)
//   RehablixRouter.canGoBack()

(function () {
  const routes = {
    lixa: { template: 'lixa', title: 'rehablix | Lixa — AI Clinical Copilot' },
    workspace: { template: 'workspace', title: 'Workspace | rehablix' },
    format: { template: 'format', title: 'Assessment Format Generator | rehablix' },
    standardized: { template: 'standardized', title: 'Standardized Tools | rehablix' },
    audio: { template: 'audio', title: 'Audio Transcription | rehablix' },
    presentation: { template: 'presentation', title: 'Presentation & Report Studio | rehablix' },
    study: { template: 'study', title: 'Study Buddy | rehablix' },
    assignment: { template: 'assignment', title: 'Assignment Maker | rehablix' },
    exam: { template: 'exam', title: 'Exam Simulator | rehablix' },
    motion: { template: 'motion', title: 'Motion & Gait Analyzer | rehablix' },
    settings: { template: 'settings', title: 'rehablix · Account Settings' },
    subscription: { template: 'subscription', title: 'rehablix · Subscription Plans' },
    result: { template: 'result', title: 'rehablix · Result' },
    docresult: { template: 'docresult', title: 'rehablix · Documentation Result' },
    // Assessment Format has its own dedicated view/editor (reusing the
    // Motion results interface) instead of routing through "result" above
    // — see js/views/formatview-view.js.
    formatview: { template: 'formatview', title: 'rehablix · Assessment Format' },
    // Audio transcripts have the same treatment — see js/views/audioview-view.js.
    audioview: { template: 'audioview', title: 'rehablix · Audio Transcript' }
  };

  const KEEP_ALIVE = new Set(['lixa', 'workspace']);

  const keepAliveWrappers = {}; // routeName -> wrapper element, once mounted
  let currentView = null;
  let lastKey = null;        // location.search + location.hash of the view on screen
  let historyIndex = 0;      // position of the current entry among router-stamped entries
  let leavingPage = false;   // set when the browser is unloading (back landed on a real page load)

  function parseHash() {
    const m = (window.location.hash || '').match(/^#\/([a-z]+)/i);
    return m ? m[1].toLowerCase() : null;
  }

  // Shared navbar affordances that individual views opt into during their
  // own mount() (e.g. ask.js re-attaches #newChatNavBtn once logged in) —
  // reset them before every navigation so a leftover control from the
  // previous view never lingers into a view that doesn't use it. A
  // kept-alive view being re-shown re-attaches its own controls itself,
  // right after this. (The single global History button/drawer is NOT reset
  // here: js/history-drawer.js owns it and re-evaluates it on every
  // rehablix:routechange.)
  function resetSharedNavbar() {
    const newChatBtn = document.getElementById('newChatNavBtn');
    if (newChatBtn) newChatBtn.style.display = 'none';
    const switcher = document.getElementById('workspaceSwitcher');
    if (switcher) switcher.style.display = 'none';
    const slot = document.getElementById('navbarViewSlot');
    if (slot) slot.innerHTML = '';
  }

  // Some tools append their own overlays straight to <body> (preview cards,
  // "your file is ready" dialogs) instead of inside their view, so replacing
  // #appRoot's content never removes them — they used to sit on top of
  // whichever page came next. Clear them on every navigation.
  function clearBodyOverlays() {
    document.querySelectorAll('body > .preview-modal, body > .modal-overlay-floating').forEach(el => el.remove());
    document.body.style.overflow = '';
  }

  function getHosts() {
    const appRoot = document.getElementById('appRoot');
    let keepAliveHost = document.getElementById('keepAliveHost');
    let transientHost = document.getElementById('transientHost');
    if (!keepAliveHost) {
      keepAliveHost = document.createElement('div');
      keepAliveHost.id = 'keepAliveHost';
      appRoot.appendChild(keepAliveHost);
    }
    if (!transientHost) {
      transientHost = document.createElement('div');
      transientHost.id = 'transientHost';
      appRoot.appendChild(transientHost);
    }
    return { appRoot, keepAliveHost, transientHost };
  }

  // `force` re-renders a transient route even though it is already the
  // current one (same route, different ?id= — e.g. opening another saved
  // result from the history drawer while a result is showing).
  function navigate(routeName, force) {
    const name = routes[routeName] ? routeName : 'lixa';
    const route = routes[name];
    const { keepAliveHost, transientHost } = getHosts();
    const isKeepAlive = KEEP_ALIVE.has(name);
    const alreadyMounted = isKeepAlive && !!keepAliveWrappers[name];

    clearBodyOverlays();

    // Tear down whatever was previously active, unless it's a kept-alive
    // view being merely hidden (its unmount() never runs while switching
    // between Lixa/Workspace/elsewhere — only a real page unload ends it).
    if (currentView && (currentView !== name || (force && !isKeepAlive))) {
      const wasKeepAlive = KEEP_ALIVE.has(currentView);
      if (wasKeepAlive) {
        const prevWrapper = keepAliveWrappers[currentView];
        if (prevWrapper) prevWrapper.hidden = true;
      } else if (window.RehablixViews && window.RehablixViews[currentView] && typeof window.RehablixViews[currentView].unmount === 'function') {
        try { window.RehablixViews[currentView].unmount(); } catch (err) { console.error('[router] unmount error:', err); }
      }
    }

    if (alreadyMounted) {
      // Fast path: already-visited keep-alive route — just show it again,
      // no re-mount, no reset state.
      resetSharedNavbar();
      transientHost.hidden = true;
      transientHost.innerHTML = '';
      keepAliveHost.hidden = false;
      Object.keys(keepAliveWrappers).forEach(r => { keepAliveWrappers[r].hidden = r !== name; });
      document.body.dataset.route = name;
      if (route.title) document.title = route.title;
      currentView = name;
      const view = window.RehablixViews && window.RehablixViews[name];
      if (view && typeof view.onShow === 'function') {
        try { view.onShow(); } catch (err) { console.error('[router] onShow error:', err); }
      }
      document.dispatchEvent(new CustomEvent('rehablix:routechange', { detail: { route: name } }));
      return;
    }

    const html = window.RehablixTemplates && window.RehablixTemplates[route.template];
    if (!html) {
      console.error('[router] no template registered for route:', name, '— is js/view-templates.js loaded before js/router.js?');
      return;
    }

    resetSharedNavbar();

    if (isKeepAlive) {
      transientHost.hidden = true;
      transientHost.innerHTML = '';
      keepAliveHost.hidden = false;
      Object.values(keepAliveWrappers).forEach(w => { w.hidden = true; });
      const wrapper = document.createElement('div');
      wrapper.className = 'kept-alive-view';
      wrapper.dataset.route = name;
      wrapper.innerHTML = html;
      keepAliveHost.appendChild(wrapper);
      keepAliveWrappers[name] = wrapper;
    } else {
      keepAliveHost.hidden = true;
      transientHost.hidden = false;
      transientHost.innerHTML = html;
    }

    document.body.dataset.route = name;
    if (route.title) document.title = route.title;
    currentView = name;
    window.scrollTo(0, 0);

    if (window.RehablixViews && window.RehablixViews[name] && typeof window.RehablixViews[name].mount === 'function') {
      try { window.RehablixViews[name].mount(); } catch (err) { console.error('[router] mount error:', err); }
    }

    document.dispatchEvent(new CustomEvent('rehablix:routechange', { detail: { route: name } }));
  }

  // --------------------------------------------------------------------
  // Location sync
  // --------------------------------------------------------------------
  // Tag each history entry with its position so "can I go back inside the
  // app?" has a real answer (see back()).
  function stampEntry() {
    const st = window.history.state;
    if (st && typeof st.rx === 'number') {
      historyIndex = st.rx;
    } else {
      historyIndex = historyIndex + 1;
      try { window.history.replaceState(Object.assign({}, st || {}, { rx: historyIndex }), ''); } catch (e) { /* ignore */ }
    }
  }

  // Routes that actually read ?query parameters. Landing on any other route
  // with a leftover query string (e.g. the ?id=… of the result the user just
  // left, still in the URL after a plain `location.hash = …` change) would
  // only leak stale parameters into later navigations, so drop it.
  const QUERY_ROUTES = new Set(['lixa', 'result', 'docresult', 'formatview', 'audioview', 'audio', 'standardized', 'study', 'exam', 'motion']);

  // Render whatever the address bar currently says.
  function sync() {
    const name = parseHash() || 'lixa';
    if (!QUERY_ROUTES.has(name) && window.location.search) {
      try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash); } catch (e) { /* ignore */ }
    }
    const key = window.location.search + window.location.hash;
    const prevName = currentView;
    const sameKey = key === lastKey;
    lastKey = key;
    stampEntry();
    if (sameKey && prevName === name) return;
    // Same transient route but a different ?query (another record opened
    // in place) must re-mount, or the view would keep showing the old one.
    navigate(name, prevName === name);
  }

  const APP_PATHS = ['', '/', '/index.html'];
  function isAppPath(pathname) {
    return APP_PATHS.includes(pathname) || /\/index\.html$/.test(pathname) || pathname === window.location.pathname;
  }

  // Resolve a same-app target (relative or absolute) to path+search+hash, or
  // null if it points anywhere else. A bare "#/route" link means "just that
  // route" — the previous page's ?id=… must not leak into it.
  function resolveAppTarget(target) {
    let url;
    try { url = new URL(target, window.location.href); } catch (e) { return null; }
    if (url.origin !== window.location.origin) return null;
    if (!isAppPath(url.pathname)) return null;
    if (!/^#\/[a-z]/i.test(url.hash)) return null;
    const search = String(target).trim().startsWith('#') ? '' : url.search;
    return window.location.pathname + search + url.hash;
  }

  function go(target, opts) {
    const resolved = resolveAppTarget(target);
    if (!resolved) { window.location.href = target; return; }
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (resolved === current) return;
    try {
      if (opts && opts.replace) window.history.replaceState(null, '', resolved);
      else window.history.pushState(null, '', resolved);
    } catch (e) {
      window.location.href = target;
      return;
    }
    sync();
  }

  // A view that has consumed its deep-link parameters (?openId=…) calls this
  // so a refresh / later auth change doesn't re-trigger them. Same entry,
  // same route — only the query is dropped, nothing re-mounts.
  function clearQuery() {
    if (!window.location.search) return;
    try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.hash); } catch (e) { return; }
    lastKey = window.location.search + window.location.hash;
  }

  function canGoBack() { return historyIndex > 1; }

  // Return to the page the user actually came from. If this is the first
  // page of the session (deep link, new tab, reload of a fresh entry) there
  // is nothing to return to, so use the caller's fallback instead.
  function back(fallback) {
    const fb = fallback || '#/workspace';
    if (!canGoBack()) { go(fb); return; }
    const before = window.location.search + window.location.hash;
    leavingPage = false;
    window.history.back();
    setTimeout(() => {
      if (!leavingPage && window.location.search + window.location.hash === before) go(fb, { replace: true });
    }, 450);
  }

  window.RehablixRouter = {
    // Kept for existing callers: navigate to a bare route name.
    navigate: (name) => go('#/' + name),
    go,
    back,
    canGoBack,
    clearQuery,
    getCurrentRoute: () => currentView
  };

  // In-app links → SPA navigation (no reload). Anything external, new-tab,
  // download, or modified-click is left to the browser.
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    const targetAttr = a.getAttribute('target');
    if ((targetAttr && targetAttr !== '_self') || a.hasAttribute('download')) return;
    const resolved = resolveAppTarget(a.getAttribute('href'));
    if (!resolved) return;
    e.preventDefault();
    go(a.getAttribute('href'));
  });

  window.addEventListener('popstate', sync);
  window.addEventListener('hashchange', sync);
  window.addEventListener('pagehide', () => { leavingPage = true; });

  function boot() {
    if (!parseHash()) {
      // No route in the URL: land on Lixa without adding a history entry.
      try { window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search + '#/lixa'); } catch (e) { /* ignore */ }
    }
    sync();
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // Deferred script: by the time this runs, readyState is already past
    // "loading" (see js/lixa.js for the same gotcha) — safe to boot now.
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();
