// js/bottom-nav.js
// Injects the persistent "Lixa | Workspace" bottom nav on any page that
// includes this script. On the SPA shell (index.html), the active tab
// tracks document.body.dataset.route (set by js/router.js) and updates
// live on every "rehablix:routechange" event without re-injecting the nav.
// On standalone pages (Smart EMR, Project Maker, pptx export, etc.) that
// attribute is never set, so the nav renders with neither tab active —
// both links still route back into the SPA shell.

(function () {
  // REDESIGN: a keep-alive view with its OWN internal screens (Smart EMR's
  // dashboard/intake/patient/patients, Project Maker's projects/dashboard/
  // setup/workspace/review/export/tools) registers a handler here instead
  // of growing its own dedicated back button. goBack() below tries this
  // FIRST — only once a view reports it has no more internal history left
  // does the existing route-level back (leaving the tool entirely) run, so
  // tapping back repeatedly steps through a tool's own screens before it
  // finally exits the tool.
  const internalHandlers = {}; // routeName -> () => boolean (true = consumed a step)
  function registerInternalBack(routeName, handler) { internalHandlers[routeName] = handler; }
  window.RehablixNav = { registerInternalBack };

  function currentRoute() {
    return document.body.dataset.route || document.body.dataset.page || '';
  }

  // Only Lixa and Workspace are "primary" tabs — every other route (SPA tool
  // views, Motion, and every standalone page like doc.html/project.html,
  // which never set data-route at all) hides the bottom nav in favor of a
  // back button injected into the shared navbar instead.
  function isPrimaryRoute(route) {
    return route === 'lixa' || route === 'workspace';
  }

  function setActive(nav, route) {
    const lixaTab = nav.querySelector('[data-route-tab="lixa"]');
    const workspaceTab = nav.querySelector('[data-route-tab="workspace"]');
    if (lixaTab) lixaTab.classList.toggle('active', route === 'lixa');
    if (workspaceTab) workspaceTab.classList.toggle('active', route === 'workspace');
  }

  function goBack() {
    // REDESIGN: try the current route's own internal screen-history first —
    // only once it reports nothing left to unwind does this fall through to
    // route-level back (which is what actually "exits" that tool/page).
    const route = currentRoute();
    const handler = route && internalHandlers[route];
    if (handler && handler()) return;

    // Inside the SPA shell the router knows whether there is an in-app page
    // to return to; standalone pages fall back to plain browser history.
    if (window.RehablixRouter) {
      window.RehablixRouter.back('#/workspace');
    } else if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = 'index.html#/workspace';
    }
  }

  function ensureBackButton() {
    let btn = document.getElementById('navBackBtn');
    if (btn) return btn;
    const navRight = document.querySelector('.nav-right');
    if (!navRight) return null;
    btn = document.createElement('button');
    btn.id = 'navBackBtn';
    btn.className = 'icon-btn back-btn';
    btn.setAttribute('aria-label', 'Back');
    btn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7"></path>
      </svg>
    `;
    btn.addEventListener('click', goBack);
    navRight.insertBefore(btn, navRight.firstChild);
    return btn;
  }

  function updateChrome(route) {
    const nav = document.querySelector('.app-bottom-nav');
    const primary = isPrimaryRoute(route);
    if (nav) {
      nav.hidden = !primary;
      document.body.classList.toggle('has-bottom-nav', primary);
    }
    const backBtn = document.getElementById('navBackBtn');
    if (primary) {
      if (backBtn) backBtn.hidden = true;
    } else {
      const btn = ensureBackButton();
      if (btn) btn.hidden = false;
    }
  }

  function init() {
    const route = currentRoute();

    const nav = document.createElement('nav');
    nav.className = 'app-bottom-nav';
    nav.setAttribute('aria-label', 'Primary');
    nav.innerHTML = `
      <div class="app-bottom-nav-inner">
        <a href="index.html#/lixa" data-route-tab="lixa" class="bottom-nav-tab${route === 'lixa' ? ' active' : ''}" aria-label="Lixa">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"></path>
          </svg>
          <span>Lixa</span>
        </a>
        <a href="index.html#/workspace" data-route-tab="workspace" class="bottom-nav-tab${route === 'workspace' ? ' active' : ''}" aria-label="Workspace">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
          </svg>
          <span>Workspace</span>
        </a>
      </div>
    `;
    document.body.appendChild(nav);
    updateChrome(route);

    document.addEventListener('rehablix:routechange', (e) => {
      const newRoute = (e.detail && e.detail.route) || '';
      setActive(nav, newRoute);
      updateChrome(newRoute);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
