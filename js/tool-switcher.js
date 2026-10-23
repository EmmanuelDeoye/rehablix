// js/tool-switcher.js — the "all tools" button in the top bar.
// On every tool page (not on Lixa or Workspace, which are one tap away on the
// bottom bar) a tools icon sits just before the profile/login control. It
// opens the tools as a sheet over the page: round coloured icons, three to a
// row (like WhatsApp's attach sheet), so the user can jump straight from one
// tool to another without going back to Workspace first.
(function () {
  // (2026-10-21: a modal grid of round coloured icons, three to a row, like WhatsApp's attach sheet; Android: Navbar.kt)
  const TOOLS = [
    { route: 'lixa', label: 'Lixa', icon: 'fa-comment-dots', color: '#0D9488' },
    { route: 'workspace', label: 'Workspace', icon: 'fa-th-large', color: '#6366F1' },
    { route: 'emr', label: 'Smart EMR', icon: 'fa-notes-medical', color: '#E11D48' },
    { route: 'motion', label: 'Motion & Gait', icon: 'fa-walking', color: '#F59E0B' },
    { route: 'audio', label: 'Audio Transcription', icon: 'fa-microphone', color: '#F97316' },
    { route: 'deck', label: 'Deck Studio', icon: 'fa-file-powerpoint', color: '#DB2777' },
    { route: 'whiteboard', label: 'Whiteboard', icon: 'fa-chalkboard', color: '#0EA5E9' },
    { route: 'presentation', label: 'Presentation Maker', icon: 'fa-file-alt', color: '#7C3AED' },
    { route: 'format', label: 'Assessment Format', icon: 'fa-clipboard-list', color: '#0284C7' },
    { route: 'standardized', label: 'Standardized Tools', icon: 'fa-balance-scale', color: '#059669' },
    { route: 'assignment', label: 'Assignment Maker', icon: 'fa-pen-nib', color: '#0891B2' },
    { route: 'project', label: 'Project Maker', icon: 'fa-book', color: '#2563EB' },
    { route: 'study', label: 'Study Buddy', icon: 'fa-brain', color: '#9333EA' },
    { route: 'exam', label: 'Exam Simulator', icon: 'fa-stopwatch', color: '#DC2626' },
  ];
  const COLS = 3;
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

    // The sheet lives on <body>, over a dimmed backdrop (a tap on the backdrop closes it).
    const panel = document.createElement('div');
    panel.className = 'tool-switcher-panel';
    panel.id = 'toolSwitcherPanel';
    panel.hidden = true;
    panel.innerHTML = '<div class="tool-switcher-sheet" role="dialog" aria-modal="true" aria-labelledby="toolSwitcherTitle">' +
      '<div class="tool-switcher-head"><span id="toolSwitcherTitle">All tools</span>' +
      '<button type="button" class="tool-switcher-close" aria-label="Close"><i class="fas fa-times" aria-hidden="true"></i></button></div>' +
      '<div class="tool-switcher-menu" id="toolSwitcherMenu" role="menu" aria-label="All tools"></div></div>';
    document.body.appendChild(panel);

    const btn = wrap.querySelector('#toolSwitcherBtn');
    const menu = panel.querySelector('#toolSwitcherMenu');
    let closeTimer = null;
    const current = () => document.body.dataset.route || ((location.hash.match(/^#\/([a-z]+)/i) || [])[1] || '').toLowerCase();

    function paint() {
      const here = current();
      menu.innerHTML = TOOLS.map((t) =>
        `<button type="button" role="menuitem" class="tool-switcher-item${t.route === here ? ' active' : ''}" data-route="${t.route}"${t.route === here ? ' aria-current="page"' : ''}>` +
        `<span class="tool-switcher-icon" style="background:${t.color}"><i class="fas ${t.icon}" aria-hidden="true"></i></span><span class="tool-switcher-label">${t.label}</span></button>`).join('');
    }
    const isOpen = () => panel.classList.contains('open');
    function setOpen(open) {
      if (open === isOpen() && panel.hidden === !open) return;
      clearTimeout(closeTimer);
      btn.setAttribute('aria-expanded', String(open));
      btn.classList.toggle('active', open);
      if (open) {
        paint();
        panel.hidden = false;
        void panel.offsetWidth;                  // so the slide-up runs
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
    // a tap on the backdrop (outside the sheet) or on the close button closes it
    panel.addEventListener('click', (e) => { if (!e.target.closest('.tool-switcher-sheet') || e.target.closest('.tool-switcher-close')) setOpen(false); });
    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.tool-switcher-item'); if (!item) return;
      setOpen(false);
      const url = 'index.html#/' + item.dataset.route;
      if (window.RehablixRouter && window.RehablixRouter.go) window.RehablixRouter.go(url); else location.href = url;
    });
    menu.addEventListener('keydown', (e) => {
      const items = Array.from(menu.querySelectorAll('.tool-switcher-item'));
      const i = items.indexOf(document.activeElement);
      // arrows move around the grid
      const go = (j) => { e.preventDefault(); (items[Math.max(0, Math.min(items.length - 1, j))] || items[0]).focus(); };
      if (e.key === 'ArrowRight') go(i + 1);
      else if (e.key === 'ArrowLeft') go(i - 1);
      else if (e.key === 'ArrowDown') go(i + COLS);
      else if (e.key === 'ArrowUp') go(i - COLS);
      else if (e.key === 'Escape') { setOpen(false); btn.focus(); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) setOpen(false); });
    window.addEventListener('rehablix:routechange', sync);
    window.addEventListener('hashchange', sync);
    sync();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
