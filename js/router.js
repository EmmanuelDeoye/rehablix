// js/router.js — small hash router for the rehablix SPA shell (index.html).
// Each route fetches a static HTML fragment into #appRoot, then calls the
// matching window.RehablixViews[name].mount()/.unmount() (registered by
// that view's own script, loaded once up front like every other script).

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
    motion: { fragment: 'views/motion.fragment.html', title: 'Motion & Gait Analyzer | rehablix' }
  };

  const fragmentCache = {};
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
  // view never lingers into a view that doesn't use it.
  function resetSharedNavbar() {
    const historyBtn = document.getElementById('historyNavBtn');
    if (historyBtn) historyBtn.style.display = 'none';
    const switcher = document.getElementById('workspaceSwitcher');
    if (switcher) switcher.style.display = 'none';
    const slot = document.getElementById('navbarViewSlot');
    if (slot) slot.innerHTML = '';
  }

  async function navigate(routeName) {
    const name = routes[routeName] ? routeName : 'lixa';
    const route = routes[name];
    const myToken = ++navToken;

    let html;
    try {
      html = await fetchFragment(route.fragment);
    } catch (err) {
      console.error('[router] failed to load view:', err);
      return;
    }
    if (myToken !== navToken) return; // a newer navigation superseded this one

    if (currentView && window.RehablixViews && window.RehablixViews[currentView] && typeof window.RehablixViews[currentView].unmount === 'function') {
      try { window.RehablixViews[currentView].unmount(); } catch (err) { console.error('[router] unmount error:', err); }
    }

    resetSharedNavbar();
    const appRoot = document.getElementById('appRoot');
    appRoot.innerHTML = html;
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
