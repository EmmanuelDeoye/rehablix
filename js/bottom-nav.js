// js/bottom-nav.js
// Injects the persistent "Lixa | Workspace" bottom nav on any page that
// includes this script. On the SPA shell (index.html), the active tab
// tracks document.body.dataset.route (set by js/router.js) and updates
// live on every "rehablix:routechange" event without re-injecting the nav.
// On standalone pages (Smart EMR, Project Maker, pptx export, etc.) that
// attribute is never set, so the nav renders with neither tab active —
// both links still route back into the SPA shell.

(function () {
  function currentRoute() {
    return document.body.dataset.route || document.body.dataset.page || '';
  }

  function setActive(nav, route) {
    const lixaTab = nav.querySelector('[data-route-tab="lixa"]');
    const workspaceTab = nav.querySelector('[data-route-tab="workspace"]');
    if (lixaTab) lixaTab.classList.toggle('active', route === 'lixa');
    if (workspaceTab) workspaceTab.classList.toggle('active', route === 'workspace');
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
    document.body.classList.add('has-bottom-nav');

    document.addEventListener('rehablix:routechange', (e) => {
      setActive(nav, (e.detail && e.detail.route) || '');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
