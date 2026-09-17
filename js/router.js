// js/router.js — small hash router for the rehablix SPA shell (index.html).
// Each route fetches a static HTML fragment into #appRoot, then calls the
// matching window.RehablixViews[name].mount()/.unmount() (registered by
// that view's own script, loaded once up front like every other script).
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
    lixa: { fragment: 'views/lixa.fragment.html', title: 'rehablix | Lixa — AI Clinical Copilot' },
    workspace: { fragment: 'views/workspace.fragment.html', title: 'Workspace | rehablix' },
    format: { fragment: 'views/format.fragment.html', title: 'Assessment Format Generator | rehablix' },
    standardized: { fragment: 'views/standardized.fragment.html', title: 'Standardized Tools | rehablix' },
    audio: { fragment: 'views/audio.fragment.html', title: 'Audio Transcription | rehablix' },
    presentation: { fragment: 'views/presentation.fragment.html', title: 'Presentation & Report Studio | rehablix' },
    study: { fragment: 'views/study.fragment.html', title: 'Study Buddy | rehablix' },
    assignment: { fragment: 'views/assignment.fragment.html', title: 'Assignment Maker | rehablix' },
    exam: { fragment: 'views/exam.fragment.html', title: 'Exam Simulator | rehablix' },
    motion: { fragment: 'views/motion.fragment.html', title: 'Motion & Gait Analyzer | rehablix' },
    settings: { fragment: 'views/settings.fragment.html', title: 'rehablix · Account Settings' },
    subscription: { fragment: 'views/subscription.fragment.html', title: 'rehablix · Subscription Plans' },
    result: { fragment: 'views/result.fragment.html', title: 'rehablix · Result' },
    docresult: { fragment: 'views/docresult.fragment.html', title: 'rehablix · Documentation Result' },
    // Assessment Format has its own dedicated view/editor (reusing the
    // Motion results interface) instead of routing through "result" above
    // — see js/views/formatview-view.js.
    formatview: { fragment: 'views/formatview.fragment.html', title: 'rehablix · Assessment Format' }
  };

  const KEEP_ALIVE = new Set(['lixa', 'workspace']);

  const fragmentCache = {};
  const keepAliveWrappers = {}; // routeName -> wrapper element, once mounted
  let currentView = null;
  let navToken = 0; // guards against a slow fetch resolving after a newer navigation started

  function parseHash() {
    const m = (window.location.hash || '').match(/^#\/([a-z]+)/i);
    return m ? m[1].toLowerCase() : null;
  }

  async function fetchFragment(url) {
    if (fragmentCache[url]) return fragmentCache[url];
    const res = await fetch(url, { cache: 'no-cache' }); // always revalidate — fragments change during development and shouldn't serve a stale disk cache across full page loads
    if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
    const html = await res.text();
    fragmentCache[url] = html;
    return html;
  }

  // Shared navbar affordances that individual views opt into during their
  // own mount() (e.g. ask.js shows #historyNavBtn once logged in) — reset
  // them before every navigation so a leftover control from the previous
  // view never lingers into a view that doesn't use it. A kept-alive view
  // being re-shown re-attaches its own controls itself, right after this.
  function resetSharedNavbar() {
    const historyBtn = document.getElementById('historyNavBtn');
    if (historyBtn) historyBtn.style.display = 'none';
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

  // Shown as an overlay over #appRoot only while a route's fragment is
  // being fetched for the first time (repeat visits to a kept-alive route
  // are instant and skip this entirely) — without it, the gap between the
  // old view disappearing and the new fragment's HTML landing is a blank
  // page, which reads as a freeze rather than a page changing.
  function getRouteShimmer(appRoot) {
    let el = document.getElementById('routeLoadingSkeleton');
    if (!el) {
      el = document.createElement('div');
      el.id = 'routeLoadingSkeleton';
      el.hidden = true;
      el.innerHTML = `
        <div class="route-skeleton-bar route-skeleton-bar--title"></div>
        <div class="route-skeleton-bar"></div>
        <div class="route-skeleton-bar"></div>
        <div class="route-skeleton-bar route-skeleton-bar--short"></div>
      `;
      appRoot.appendChild(el);
    }
    return el;
  }

  async function navigate(routeName) {
    const name = routes[routeName] ? routeName : 'lixa';
    const route = routes[name];
    const myToken = ++navToken;
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
      // no re-fetch, no re-mount, no reset state.
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

    // Only the actual first-ever fetch of a fragment can take noticeable
    // time — a cached repeat visit resolves in a microtask, so skip the
    // shimmer there to avoid a pointless flash.
    const needsFetch = !fragmentCache[route.fragment];
    const shimmer = needsFetch ? getRouteShimmer(document.getElementById('appRoot')) : null;
    if (shimmer) shimmer.hidden = false;

    let html;
    try {
      html = await fetchFragment(route.fragment);
    } catch (err) {
      console.error('[router] failed to load view:', err);
      if (shimmer) shimmer.hidden = true;
      return;
    }
    if (myToken !== navToken) { if (shimmer) shimmer.hidden = true; return; } // a newer navigation superseded this one

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

    if (shimmer) shimmer.hidden = true;

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
