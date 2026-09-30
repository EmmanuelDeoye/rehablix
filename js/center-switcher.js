// js/center-switcher.js — personal ⇄ center workspace switcher in the navbar.
//
// Only the tools that are shared with a center show it: Smart EMR, Project
// Maker, Audio and Exam Simulator (RehablixCenter.SHARED_TOOLS). It is shown
// only to people who are an ACTIVE MEMBER of at least one center and who do
// not own a center themselves (an owner always works in their own data, so
// there is nothing to switch). Every other page is always private.
(function () {
  const SHARED_ROUTES = { emr: 'doc', project: 'project', audio: 'audio', exam: 'exam' };
  let wrap = null, btn = null, menu = null, dot = null;
  let renderSeq = 0;

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

  function build() {
    if (wrap) return;
    const navRight = document.getElementById('navRight');
    if (!navRight) return;
    wrap = document.createElement('div');
    wrap.className = 'center-switch';
    wrap.hidden = true;
    wrap.innerHTML =
      '<button type="button" class="icon-btn center-switch-btn" id="centerSwitchBtn" aria-haspopup="menu" aria-expanded="false" aria-label="Switch between personal and center workspace" title="Switch workspace">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' +
        '<span class="center-switch-dot" aria-hidden="true"></span>' +
      '</button>' +
      '<div class="center-switch-menu" role="menu"></div>';
    const slot = document.getElementById('navbarViewSlot');
    navRight.insertBefore(wrap, slot ? slot.nextSibling : navRight.firstChild);
    btn = wrap.querySelector('.center-switch-btn');
    menu = wrap.querySelector('.center-switch-menu');
    dot = wrap.querySelector('.center-switch-dot');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !menu.classList.contains('open');
      menu.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => { if (wrap && !wrap.contains(e.target)) { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.classList.contains('open')) { menu.classList.remove('open'); btn.focus(); } });
  }

  function currentRoute() {
    return document.body.dataset.route || (location.hash.replace(/^#\/?/, '').split(/[?/]/)[0]) || 'lixa';
  }

  async function render() {
    build();
    if (!wrap) return;
    const seq = ++renderSeq;
    const route = currentRoute();
    const user = window.firebase && firebase.auth && firebase.auth().currentUser;
    if (!SHARED_ROUTES[route] || !user || !window.RehablixCenter) { wrap.hidden = true; return; }
    let ctx;
    try { ctx = await window.RehablixCenter.getContext(); } catch (e) { wrap.hidden = true; return; }
    if (seq !== renderSeq) return;
    const eligible = ctx.loggedIn && !ctx.isCenterOwner && ctx.activeMemberships && ctx.activeMemberships.length > 0;
    if (!eligible) { wrap.hidden = true; return; }
    const options = (await window.RehablixCenter.getAvailableContexts()).filter(o => o.type !== 'owner');
    if (seq !== renderSeq) return;
    const active = ctx.activeContext;
    const inCenter = active !== 'individual';
    dot.hidden = !inCenter;
    btn.title = inCenter ? `Working in ${ctx.activeCenterName || 'your center'} — tap to switch` : 'Working in your personal account — tap to switch';
    menu.innerHTML =
      '<div class="center-switch-head">Work in</div>' +
      options.map(o => `
        <button type="button" role="menuitemradio" aria-checked="${o.id === active}" class="center-switch-option${o.id === active ? ' active' : ''}" data-context="${escapeHtml(o.id)}">
          <i class="bx ${o.type === 'individual' ? 'bx-user' : 'bx-buildings'}" aria-hidden="true"></i>
          <span>${escapeHtml(o.type === 'individual' ? 'Personal account' : o.label)}</span>
          ${o.id === active ? '<i class="bx bx-check" aria-hidden="true"></i>' : ''}
        </button>`).join('') +
      '<div class="center-switch-note">Shared with your center: Smart EMR, Project Maker, Audio and Exam Simulator. Everything else stays private.</div>';
    menu.querySelectorAll('.center-switch-option').forEach(b => b.addEventListener('click', async () => {
      const id = b.getAttribute('data-context');
      if (id === active) { menu.classList.remove('open'); return; }
      try {
        await window.RehablixCenter.switchActiveContext(id);
        window.location.reload(); // kept-alive views re-resolve their data scope
      } catch (err) { console.error('[center-switcher] switch failed', err); }
    }));
    wrap.hidden = false;
  }

  document.addEventListener('rehablix:routechange', render);
  document.addEventListener('DOMContentLoaded', () => {
    render();
    try { firebase.auth().onAuthStateChanged(() => render()); } catch (e) { /* firebase not ready */ }
  });
  window.RehablixCenterSwitcher = { refresh: render };
})();
