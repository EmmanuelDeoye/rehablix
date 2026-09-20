// js/router.js — small hash router for the rehablix SPA shell (index.html).
// Each route's HTML lives as a plain string in js/view-templates.js
// (window.RehablixTemplates), injected into #appRoot synchronously — no
// runtime fetch() of separate fragment files — then the matching
// window.RehablixViews[name].mount()/.unmount() (registered by that view's
// own script, loaded once up front like every other script) is called.
//
// Lixa and Workspace are the two primary bottom-nav tabs users flip between
// constantly, so they're kept alive: mounted once, then just shown/hidden on
// every later visit (scroll position, search text, in-progress chat, etc.
// all survive) instead of being torn down and rebuilt from scratch — that
// rebuild was also the source of the "Workspace lags for a moment on first
// open" complaint, since its Firebase reads + DOM build only ever happen
// once now instead of on every single visit. Every other route keeps the
// original destroy-and-rebuild behavior (some, like Motion, genuinely need
// to release camera/mic on navigating away).

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

  function navigate(routeName) {
    const name = routes[routeName] ? routeName : 'lixa';
    const route = routes[name];
    const { keepAliveHost, transientHost } = getHosts();
    const isKeepAlive = KEEP_ALIVE.has(name);
    const alreadyMounted = isKeepAlive && !!keepAliveWrappers[name];

    // Tear down whatever was previously active, unless it's a kept-alive
    // view being merely hidden (its unmount() never runs while switching
    // between Lixa/Workspace/elsewhere — only a real page unload ends it).
    if (currentView && currentView !== name) {
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

  window.RehablixRouter = {
    navigate: (name) => { window.location.hash = '#/' + name; },
    getCurrentRoute: () => currentView
  };

  window.addEventListener('hashchange', () => navigate(parseHash()));

  function boot() {
    navigate(parseHash() || 'lixa');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // Deferred script: by the time this runs, readyState is already past
    // "loading" (see js/lixa.js for the same gotcha) — safe to boot now.
    boot();
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();
