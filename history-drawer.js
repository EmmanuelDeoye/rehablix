// js/history-drawer.js — the ONE history drawer for the whole SPA shell.
//
// #historyDrawer / #historyNavBtn live in index.html (the persistent shell),
// not inside any view. It has two modes, switched automatically on every
// route change:
//
//   Lixa route  → data-mode="lixa": the normal Chats / Files toggle, file
//                 filter dropdown and conversation history. Those parts are
//                 still driven by js/ask.js (chats) and js/lixa.js (files) —
//                 this module only opens/closes the drawer and toggles the
//                 mode, it never touches their state.
//   Tool route  → data-mode="tool": the Chats/Files toggle and the general
//                 filter dropdown are hidden, and the list shows ONLY the
//                 current tool's history. A tool view supplies its data by
//                 registering a "provider" on mount() and unregistering on
//                 unmount() — no tool has its own drawer any more.
//
// Provider shape (all optional except label + load + open):
//   {
//     label:  'Assessment Formats',        // drawer title in tool mode
//     icon:   '📋',                         // shown before every row title
//     searchPlaceholder, emptyText, emptyHint,
//     load():   Promise<Item[]>,           // Item = { id, title, meta?, time?, searchText?, active?, icon?, raw? }
//     open(item),                          // row clicked (drawer closes first)
//     remove(item): Promise<boolean>,      // trash icon; resolve true if deleted
//     clearAll(): Promise<boolean>         // "Clear all" footer button
//   }
// Data paths / scoping / delete rules stay inside each tool (unchanged
// Firebase structures) — the drawer only renders what load() returns.

(function () {
  const providers = {};      // route -> provider
  const cache = {};          // route -> last loaded Item[] (instant re-open)
  let currentRoute = null;
  let currentUser = null;
  let loadToken = 0;         // guards against out-of-order async loads

  const $ = (id) => document.getElementById(id);
  const drawer = () => $('historyDrawer');
  const navBtn = () => $('historyNavBtn');

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // "3:45 PM" within the last 24h, "Sep 14" beyond that — same as Lixa's rows.
  function formatRelative(time) {
    if (time == null || time === '') return '';
    const ts = typeof time === 'number' ? time : new Date(time).getTime();
    if (!ts || isNaN(ts)) return '';
    const date = new Date(ts);
    return Date.now() - ts < 24 * 60 * 60 * 1000
      ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function isOpen() {
    const d = drawer();
    return !!(d && d.classList.contains('active'));
  }

  function toast(message, type) {
    if (window.LixaCore && window.LixaCore.showToast) { window.LixaCore.showToast(message, type || 'info'); return; }
    const container = $('toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast toast-${type || 'info'}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // --------------------------------------------------------------------
  // Mode + button visibility
  // --------------------------------------------------------------------
  function applyMode() {
    const d = drawer();
    if (!d) return;
    const provider = providers[currentRoute];
    const toolMode = currentRoute !== 'lixa' && !!provider;
    d.dataset.mode = toolMode ? 'tool' : 'lixa';

    const title = $('drawerTitleText');
    if (title) title.textContent = toolMode ? (provider.label || 'History') : 'History';

    const search = $('toolHistorySearchInput');
    if (search && toolMode) search.placeholder = provider.searchPlaceholder || 'Search history...';

    const footer = $('toolHistoryFooter');
    if (footer) footer.hidden = !(toolMode && typeof provider.clearAll === 'function');

    updateNavButton();
  }

  // The history button shows on Lixa and on any tool that registered a
  // provider — and only for a logged-in user (same rule the per-tool buttons
  // and Lixa's own button always followed).
  function updateNavButton() {
    const btn = navBtn();
    if (!btn) return;
    const available = currentRoute === 'lixa' || !!providers[currentRoute];
    btn.style.display = (available && currentUser) ? '' : 'none';
    if (!available || !currentUser) close();
  }

  // --------------------------------------------------------------------
  // Open / close
  // --------------------------------------------------------------------
  function open() {
    const d = drawer();
    if (!d) return;
    if (!currentUser) {
      toast('Please log in to view history', 'error');
      const loginBtn = $('loginBtn');
      if (loginBtn) loginBtn.click();
      return;
    }
    applyMode();
    d.classList.add('active');
    if (d.dataset.mode === 'tool') loadTool();
    else if (window.LixaCore && window.LixaCore.onHistoryOpen) window.LixaCore.onHistoryOpen();
  }

  function close() {
    const d = drawer();
    if (d) d.classList.remove('active');
  }

  // --------------------------------------------------------------------
  // Tool-mode list
  // --------------------------------------------------------------------
  function listEl() { return $('toolHistoryList'); }

  function clearRows() {
    const list = listEl();
    if (list) list.querySelectorAll(':scope > *:not(#toolHistoryLoading)').forEach(el => el.remove());
  }

  function showMessage(iconClass, text, hint) {
    const list = listEl();
    if (!list) return;
    clearRows();
    list.insertAdjacentHTML('beforeend',
      `<div class="empty-state"><i class="bx ${iconClass}"></i><p>${escapeHtml(text)}</p>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</div>`);
  }

  function setLoading(on) {
    const el = $('toolHistoryLoading');
    if (el) el.hidden = !on;
  }

  async function loadTool() {
    const route = currentRoute;
    const provider = providers[route];
    if (!provider || typeof provider.load !== 'function') return;
    const token = ++loadToken;

    // Stale-while-revalidate: rows already loaded for this tool show
    // instantly on re-open; only a first-ever load shows the shimmer.
    if (cache[route]) {
      renderTool(cache[route]);
    } else {
      clearRows();
      setLoading(true);
    }

    try {
      const items = await provider.load();
      if (token !== loadToken || route !== currentRoute) return;
      cache[route] = Array.isArray(items) ? items : [];
      renderTool(cache[route]);
    } catch (err) {
      console.error('[history-drawer] failed to load history for', route, err);
      if (token !== loadToken || route !== currentRoute) return;
      showMessage('bx-error', 'Could not load history');
    } finally {
      if (token === loadToken) setLoading(false);
    }
  }

  function renderTool(items) {
    const provider = providers[currentRoute];
    const list = listEl();
    if (!provider || !list) return;
    setLoading(false);

    if (!items.length) {
      showMessage('bx-folder-open', provider.emptyText || 'No history yet', provider.emptyHint);
      return;
    }

    const term = (($('toolHistorySearchInput') || {}).value || '').toLowerCase().trim();
    const filtered = !term ? items : items.filter(item => {
      const hay = (item.searchText || `${item.title || ''} ${item.meta || ''}`).toLowerCase();
      return hay.includes(term);
    });
    if (!filtered.length) {
      showMessage('bx-search', 'No matching items');
      return;
    }

    clearRows();
    filtered.forEach(item => {
      const row = document.createElement('div');
      row.className = 'history-item' + (item.active ? ' active' : '');
      const icon = item.icon || provider.icon || '';
      const title = item.title || 'Untitled';
      row.innerHTML = `
        <span class="history-item-main">
          <span class="history-title" title="${escapeHtml(title)}">${icon ? escapeHtml(icon) + ' ' : ''}${escapeHtml(title)}</span>
          ${item.meta ? `<span class="history-item-sub" title="${escapeHtml(item.meta)}">${escapeHtml(item.meta)}</span>` : ''}
        </span>
        ${typeof provider.remove === 'function' ? '<button class="delete-btn" title="Delete" aria-label="Delete"><i class="fas fa-trash-alt"></i></button>' : ''}
        <span class="history-time">${escapeHtml(formatRelative(item.time))}</span>
      `;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.delete-btn')) return;
        close();
        try { provider.open(item); } catch (err) { console.error('[history-drawer] open failed', err); }
      });
      const del = row.querySelector('.delete-btn');
      if (del) {
        del.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const removed = await provider.remove(item);
            if (removed) {
              cache[currentRoute] = (cache[currentRoute] || []).filter(i => i.id !== item.id);
              renderTool(cache[currentRoute]);
            }
          } catch (err) {
            console.error('[history-drawer] delete failed', err);
            toast('Could not delete', 'error');
          }
        });
      }
      list.appendChild(row);
    });
  }

  // A tool calls this after it saves/changes something so the drawer never
  // shows a stale list next time it opens (and updates live if it's open).
  function refresh(route) {
    const target = route || currentRoute;
    delete cache[target];
    if (target === currentRoute && isOpen() && drawer().dataset.mode === 'tool') loadTool();
  }

  // --------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------
  function register(route, provider) {
    providers[route] = provider;
    delete cache[route];
    if (route === currentRoute) applyMode();
  }

  function unregister(route) {
    delete providers[route];
    delete cache[route];
    if (route === currentRoute) applyMode();
  }

  window.RehablixHistoryDrawer = { register, unregister, refresh, open, close, isOpen };

  // --------------------------------------------------------------------
  // Wiring (once — this module lives for the whole page, like the shell)
  // --------------------------------------------------------------------
  function init() {
    const btn = navBtn();
    const d = drawer();
    if (!btn || !d) return;

    btn.addEventListener('click', () => { if (isOpen()) close(); else open(); });

    const closeBtn = $('closeDrawerBtn');
    if (closeBtn) closeBtn.addEventListener('click', close);

    const search = $('toolHistorySearchInput');
    if (search) search.addEventListener('input', () => { if (cache[currentRoute]) renderTool(cache[currentRoute]); });

    const clearBtn = $('toolHistoryClearBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        const provider = providers[currentRoute];
        if (!provider || typeof provider.clearAll !== 'function') return;
        try {
          if (await provider.clearAll()) {
            cache[currentRoute] = [];
            renderTool([]);
          }
        } catch (err) {
          console.error('[history-drawer] clear all failed', err);
          toast('Could not clear history', 'error');
        }
      });
    }

    // Outside-click / Escape close the drawer for every route. The new-chat
    // button also closes it itself, so it's excluded from the outside test.
    document.addEventListener('click', (e) => {
      if (!isOpen()) return;
      if (d.contains(e.target)) return;
      if (btn.contains(e.target)) return;
      const newChat = $('newChatNavBtn');
      if (newChat && newChat.contains(e.target)) return;
      close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) close();
    });

    // Every navigation: drop the previous route's drawer state, switch mode.
    document.addEventListener('rehablix:routechange', (e) => {
      currentRoute = e.detail && e.detail.route;
      close();
      loadToken++; // discard any in-flight load for the previous route
      applyMode();
    });

    if (window.firebase && firebase.auth) {
      firebase.auth().onAuthStateChanged((user) => {
        currentUser = user;
        // Signing out drops every cached list (they belong to the old user).
        if (!user) Object.keys(cache).forEach(k => delete cache[k]);
        updateNavButton();
      });
    }

    applyMode();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
