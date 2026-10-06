// js/tool-switcher.js — the "all tools" button in the top bar.
// On every tool page (not on Lixa or Workspace, which are one tap away on the
// bottom bar) a tools icon sits just before the profile/login control. It
// drops the list of tools down under the icon — a frosted-glass card with
// rounded corners that is only as wide as its content, like the profile menu —
// so the user can jump straight from one tool to another without going back
// to Workspace first.
(function () {
  const TOOLS = [
    { route: 'lixa', label: 'Lixa', icon: 'fa-comment-dots' },
    { route: 'workspace', label: 'Workspace', icon: 'fa-th-large' },
    { divider: true },
    { route: 'emr', label: 'Smart EMR', icon: 'fa-notes-medical' },
    { route: 'motion', label: 'Motion & Gait', icon: 'fa-walking' },
    { route: 'audio', label: 'Audio Transcription', icon: 'fa-microphone' },
    { route: 'deck', label: 'Deck Studio', icon: 'fa-file-powerpoint' },
    { route: 'presentation', label: 'Presentation Maker', icon: 'fa-file-alt' },
    { route: 'format', label: 'Assessment Format', icon: 'fa-clipboard-list' },
    { route: 'standardized', label: 'Standardized Tools', icon: 'fa-balance-scale' },
    { route: 'assignment', label: 'Assignment Maker', icon: 'fa-pen-nib' },
    { route: 'project', label: 'Project Maker', icon: 'fa-book' },
    { route: 'study', label: 'Study Buddy', icon: 'fa-brain' },
    { route: 'exam', label: 'Exam Simulator', icon: 'fa-stopwatch' },
  ];
  const HIDDEN_ON = new Set(['lixa', 'workspace', '']);

  function init() {
    const navRight = document.getElementById('navRight');
    const anchor = document.getElementById('themeToggle');
    if (!navRight || !anchor || document.getElementById('toolSwitcher')) return;

    const wrap = document.createElement('div');
    wrap.className = 'tool-switcher';
    wrap.id = 'toolSwitcher';
    wrap.hidden = true;
    wrap.innerHTML = `
      <button type="button" class="icon-btn tool-switcher-btn" id="toolSwitcherBtn" aria-label="All tools" title="All tools" aria-haspopup="menu" aria-expanded="false">
        <!-- same thin outline style as the history / theme icons beside it -->
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
          <rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M17 2.6L21.4 7L17 11.4L12.6 7Z"/>
        </svg>
      </button>`;
    anchor.insertAdjacentElement('afterend', wrap);   // auth.js adds Login / profile after this

    // The menu lives on <body> and is placed under the icon when it opens: inside
    // the (blurred) top bar its own frosted-glass blur could not see the page.
    const panel = document.createElement('div');
    panel.className = 'tool-switcher-panel';
    panel.id = 'toolSwitcherPanel';
    panel.hidden = true;
    panel.innerHTML = '<div class="tool-switcher-menu" id="toolSwitcherMenu" role="menu" aria-label="All tools"></div>';
    document.body.appendChild(panel);

    const btn = wrap.querySelector('#toolSwitcherBtn');
    const menu = panel.querySelector('#toolSwitcherMenu');
    let closeTimer = null;
    const current = () => document.body.dataset.route || ((location.hash.match(/^#\/([a-z]+)/i) || [])[1] || '').toLowerCase();

    function paint() {
      const here = current();
      menu.innerHTML = TOOLS.map((t) => t.divider ? '<div class="tool-switcher-divider" role="separator"></div>'
        : `<button type="button" role="menuitem" class="tool-switcher-item${t.route === here ? ' active' : ''}" data-route="${t.route}"${t.route === here ? ' aria-current="page"' : ''}><i class="fas ${t.icon}" aria-hidden="true"></i><span>${t.label}</span></button>`).join('');
    }
    const isOpen = () => panel.classList.contains('open');
    // Right edge lined up with the icon, just below it, never off-screen.
    function place() {
      const r = btn.getBoundingClientRect();
      panel.style.top = Math.round(r.bottom + 10) + 'px';
      panel.style.right = Math.max(8, Math.round(window.innerWidth - r.right - 4)) + 'px';
      panel.style.maxHeight = Math.max(180, Math.round(window.innerHeight - r.bottom - 26)) + 'px';
    }
    function setOpen(open) {
      if (open === isOpen() && panel.hidden === !open) return;
      clearTimeout(closeTimer);
      btn.setAttribute('aria-expanded', String(open));
      btn.classList.toggle('active', open);
      if (open) {
        paint();
        panel.hidden = false;
        place();
        void panel.offsetWidth;                  // so the fade-in runs
        panel.classList.add('open');
        const first = menu.querySelector('.tool-switcher-item.active') || menu.querySelector('.tool-switcher-item');
        if (first) first.focus({ preventScroll: true });
      } else {
        panel.classList.remove('open');
        closeTimer = setTimeout(() => { panel.hidden = true; }, 180);
      }
    }
    function sync() { wrap.hidden = HIDDEN_ON.has(current()); if (wrap.hidden) setOpen(false); }

    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!isOpen()); });
    document.addEventListener('click', (e) => { if (isOpen() && !panel.contains(e.target) && !wrap.contains(e.target)) setOpen(false); });
    window.addEventListener('resize', () => { if (isOpen()) place(); });
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.tool-switcher-item'); if (!item) return;
      setOpen(false);
      const url = 'index.html#/' + item.dataset.route;
      if (window.RehablixRouter && window.RehablixRouter.go) window.RehablixRouter.go(url); else location.href = url;
    });
    menu.addEventListener('keydown', (e) => {
      const items = Array.from(menu.querySelectorAll('.tool-switcher-item'));
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
      else if (e.key === 'Escape') { setOpen(false); btn.focus(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) setOpen(false); });
    window.addEventListener('rehablix:routechange', sync);
    window.addEventListener('hashchange', sync);
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
