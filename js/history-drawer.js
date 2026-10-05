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
//     clearAll(): Promise<boolean>,        // "Clear all" footer button
//     pages():  [{ path, map(id, record) }] | null
//   }
// pages() is what makes a list fast: instead of load() (which downloads the
// tool's whole history), the drawer reads each path 12 records at a time by
// KEY — newest first, then "Load more" — exactly like Lixa's Files list.
// map() turns a record into an Item (or null to leave it out). pages() returns
// null while the tool doesn't know yet whose history to show (the center scope
// is still resolving); the drawer keeps its shimmer and asks again, so it never
// flashes "No history" before the rows arrive.
//
// A loaded list is kept per route for the whole session: leaving a tool and
// coming back, or closing and re-opening the drawer, shows it instantly and
// does not load it again. It is refetched only when the tool calls refresh()
// (it saved or deleted something), when the scope changes, or on sign-out.
// Data paths / scoping / delete rules stay inside each tool (unchanged
// Firebase structures) — the drawer only renders what load() returns.

(function () {
  const providers = {};      // route -> provider
  const cache = {};          // route -> last loaded Item[] (instant re-open)
  const paging = {};         // route -> { key, cursors, hasMore, busy, stale } for providers with pages()
  const selected = {};       // route -> id of the row last opened (highlighted, like Lixa's open chat)
  const PAGE_SIZE = 12;
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

  const timeOf = (item) => {
    const t = item && item.time;
    if (t == null || t === '') return 0;
    const n = typeof t === 'number' ? t : new Date(t).getTime();
    return isNaN(n) ? 0 : n;
  };
  const byNewest = (rows) => rows.sort((x, y) => timeOf(y) - timeOf(x));

  // One page (12 records, by key) from one of a provider's paths.
  async function fetchPage(src, cur) {
    if (cur.done) return [];
    let q = firebase.database().ref(src.path).orderByKey();
    if (cur.oldestKey) q = q.endBefore(cur.oldestKey);
    const data = (await q.limitToLast(PAGE_SIZE).once('value')).val() || {};
    const keys = Object.keys(data).sort();
    if (keys.length < PAGE_SIZE) cur.done = true;
    if (keys.length) cur.oldestKey = keys[0];
    const rows = [];
    keys.forEach((id) => { try { const item = src.map(id, data[id] || {}); if (item) rows.push(item); } catch (e) { /* skip a malformed record */ } });
    return rows;
  }

  let retryTimer = null;

  // first = (re)start from the newest page; otherwise fetch the next older page.
  async function loadPaged(route, provider, first) {
    const token = loadToken;
    let sources = null;
    try { sources = provider.pages(); } catch (e) { sources = null; }
    if (!sources) {
      // The tool isn't ready (scope still resolving): keep the shimmer and ask again shortly.
      if (!cache[route]) { clearRows(); setLoading(true); }
      clearTimeout(retryTimer);
      const tries = (loadPaged.tries = (loadPaged.tries || 0) + 1);
      if (tries <= 24) retryTimer = setTimeout(() => { if (route === currentRoute && isOpen() && token === loadToken) loadPaged(route, provider, true); }, 500);
      else { loadPaged.tries = 0; setLoading(false); if (!cache[route]) renderTool([]); }
      return;
    }
    loadPaged.tries = 0;
    const key = sources.map(s => s.path).join('|');
    let st = paging[route];
    if (!st || st.key !== key) { st = paging[route] = { key, cursors: {}, hasMore: true, busy: false, stale: false }; delete cache[route]; first = true; }
    if (st.busy) return;
    st.busy = true;
    const silent = first && !!cache[route];      // refreshing a list that is already on screen
    if (first) st.cursors = {};
    if (!cache[route]) { clearRows(); setLoading(true); }
    else if (!silent) renderTool(cache[route]);  // shows "Loading…" on the button
    try {
      const fresh = [];
      await Promise.all(sources.map(async (src) => {
        const cur = st.cursors[src.path] || (st.cursors[src.path] = { oldestKey: null, done: false });
        let rows = [];
        try { rows = await fetchPage(src, cur); } catch (err) { cur.done = true; console.error('[history-drawer] page failed', src.path, err); }
        fresh.push(...rows);
        // Rows appear as soon as each source answers (first load only).
        if (!silent && rows.length && token === loadToken && route === currentRoute && first) { setLoading(false); cache[route] = byNewest((cache[route] || []).filter(i => !rows.some(r => r.id === i.id)).concat(rows)); st.busy = 'render'; renderTool(cache[route]); st.busy = true; }
      }));
      st.hasMore = sources.some(src => !(st.cursors[src.path] && st.cursors[src.path].done));
      st.stale = false;
      st.loadedAt = Date.now();
      if (first) cache[route] = byNewest(fresh);
      else { const seen = new Set((cache[route] || []).map(i => i.id)); cache[route] = byNewest((cache[route] || []).concat(fresh.filter(i => !seen.has(i.id)))); }
    } catch (err) {
      console.error('[history-drawer] failed to load history for', route, err);
      if (!cache[route] && token === loadToken && route === currentRoute) { st.busy = false; setLoading(false); showMessage('bx-error', 'Could not load history'); return; }
    }
    st.busy = false;
    if (token !== loadToken || route !== currentRoute) return;
    setLoading(false);
    renderTool(cache[route] || []);
  }

  async function loadTool() {
    const route = currentRoute;
    const provider = providers[route];
    if (!provider) return;
    if (typeof provider.pages === 'function') {
      const st = paging[route];
      // Already loaded and nothing changed: show it, don't fetch again.
      if (cache[route] && st && !st.stale) {
        let sources = null;
        try { sources = provider.pages(); } catch (e) { sources = null; }
        if (!sources || sources.map(s => s.path).join('|') === st.key) { renderTool(cache[route]); return; }
      }
      return loadPaged(route, provider, true);
    }
    if (typeof provider.load !== 'function') return;
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

  // "Load more" under a paged list (same control as Lixa's Files list).
  function appendLoadMore() {
    const route = currentRoute, provider = providers[route], st = paging[route], list = listEl();
    if (!list || !provider || typeof provider.pages !== 'function' || !st || !st.hasMore) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'files-load-more';
    btn.id = 'toolHistoryLoadMoreBtn';
    btn.textContent = st.busy === true ? 'Loading…' : 'Load more';
    btn.disabled = st.busy === true;
    btn.addEventListener('click', (e) => { e.stopPropagation(); loadPaged(route, provider, false); });
    list.appendChild(btn);
  }

  function renderTool(items) {
    const provider = providers[currentRoute];
    const list = listEl();
    if (!provider || !list) return;
    setLoading(false);

    const pg = typeof provider.pages === 'function' ? paging[currentRoute] : null;
    if (!items.length) {
      // Nothing in the pages read so far, but older ones remain: keep going rather than say "empty".
      if (pg && pg.hasMore) { clearRows(); if (pg.busy) setLoading(true); else loadPaged(currentRoute, provider, false); return; }
      showMessage('bx-folder-open', provider.emptyText || 'No history yet', provider.emptyHint);
      return;
    }

    const term = (($('toolHistorySearchInput') || {}).value || '').toLowerCase().trim();
    const filtered = !term ? items : items.filter(item => {
      const hay = (item.searchText || `${item.title || ''} ${item.meta || ''}`).toLowerCase();
      return hay.includes(term);
    });
    if (!filtered.length) {
      showMessage('bx-search', pg && pg.hasMore ? 'No match in what is loaded so far' : 'No matching items');
      appendLoadMore();
      return;
    }

    clearRows();
    filtered.forEach(item => {
      const row = document.createElement('div');
      row.className = 'history-item' + ((item.active || selected[currentRoute] === item.id) ? ' active' : '');
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
        selected[currentRoute] = item.id;      // stays highlighted next time the drawer opens
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
              if (selected[currentRoute] === item.id) delete selected[currentRoute];
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
    appendLoadMore();
  }

  // A tool calls this after it saves/changes something so the drawer never
  // shows a stale list next time it opens (and updates live if it's open).
  function refresh(route) {
    const target = route || currentRoute;
    const provider = providers[target];
    if (provider && typeof provider.pages === 'function') {
      // Paged list: keep the rows on screen and re-read the newest page behind them.
      if (paging[target]) paging[target].stale = true;
    } else {
      delete cache[target];
    }
    if (target === currentRoute && isOpen() && drawer().dataset.mode === 'tool') loadTool();
  }

  // --------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------
  function register(route, provider) {
    providers[route] = provider;
    // A paged list survives the tool being closed and re-opened (see the header note).
    if (typeof provider.pages !== 'function') delete cache[route];
    if (route === currentRoute) applyMode();
  }

  function unregister(route) {
    const paged = providers[route] && typeof providers[route].pages === 'function';
    delete providers[route];
    if (!paged) delete cache[route];
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
            delete selected[currentRoute];
            if (paging[currentRoute]) { paging[currentRoute].hasMore = false; Object.values(paging[currentRoute].cursors).forEach((c) => { c.done = true; }); }
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
        if (!user) [cache, paging, selected].forEach(o => Object.keys(o).forEach(k => delete o[k]));
        updateNavButton();
      });
    }

    applyMode();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
