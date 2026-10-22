// js/token-usage.js — the token usage monitor (profile menu > Token usage; paid plans only). It replaced the
// "My Profile" modal, whose details are on the Settings page. It shows what this 4-hour window has used of the plan's
// budget and when it resets, today's use against the daily cap (when the admin has set one: js/plan-config.js),
// Lixa Live minutes, and how each model counts. Android: ui/auth/ShellOverlays.kt TokenUsageModal, the same.
(function () {
  // Lixa Live minutes per plan when the admin has set none (js/lixa-agent/agent-live.js LIMITS)
  const LIVE = { student: { day: 10, month: 100 }, pro: { day: 30, month: 300 }, max: { day: 60, month: 600 } };
  const LABELS = { free: 'Free', student: 'Basic', pro: 'Pro', max: 'Max' };
  const WINDOW_MS = 4 * 60 * 60 * 1000;

  function plan() { return (window.rehabPlans && window.rehabPlans.getCurrentPlan && window.rehabPlans.getCurrentPlan()) || 'free'; }
  function user() { try { return firebase.auth().currentUser; } catch (e) { return null; } }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = n => Number(n || 0).toLocaleString();
  function clock(ms) {
    const d = new Date(ms), now = new Date();
    const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === now.toDateString() ? t : t + ' tomorrow';
  }
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  /** The menu item: only for a signed-in paid plan. */
  function sync() {
    const item = document.getElementById('profileMenuItem');
    if (!item) return;
    item.innerHTML = '<span>📊</span> Token usage';
    item.style.display = user() && plan() !== 'free' ? '' : 'none';
  }

  function modal() {
    let m = document.getElementById('tokenUsageModal');
    if (m) return m;
    document.body.insertAdjacentHTML('beforeend',
      '<div id="tokenUsageModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="tuTitle">' +
      '<div class="modal-content glass tu-content">' +
      '<button class="modal-close" id="tuClose" aria-label="Close">&times;</button>' +
      '<div class="tu-head"><span class="tu-icon">📊</span><div><h2 id="tuTitle">Token usage</h2><p id="tuPlan"></p></div></div>' +
      '<div id="tuBody"></div>' +
      '<div class="tu-actions"><button class="tu-btn tu-outline" id="tuRefresh">Refresh</button><button class="tu-btn" id="tuMore">More tokens</button></div>' +
      '</div></div>');
    m = document.getElementById('tokenUsageModal');
    const close = () => { m.classList.remove('show'); document.body.style.overflow = ''; };
    document.getElementById('tuClose').addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.classList.contains('show')) close(); });
    document.getElementById('tuRefresh').addEventListener('click', () => render());
    document.getElementById('tuMore').addEventListener('click', () => { close(); window.location.hash = '#/subscription'; });
    return m;
  }

  function card(title, figures, note, ratio) {
    const colour = ratio == null ? '' : ratio >= 0.9 ? '#dc2626' : ratio >= 0.75 ? '#f59e0b' : '#0d9488';
    return '<div class="tu-card"><span class="tu-label">' + esc(title) + '</span><strong>' + esc(figures) + '</strong>' +
      (ratio == null ? '' : '<div class="tu-bar"><i style="width:' + Math.max(1, Math.round(ratio * 100)) + '%;background:' + colour + '"></i></div>') +
      '<span class="tu-note">' + esc(note) + '</span></div>';
  }

  async function render() {
    const u = user(); const p = plan();
    const body = document.getElementById('tuBody');
    if (!u || !body) return;
    body.innerHTML = '<p class="tu-note">Loading your usage…</p>';
    const db = firebase.database();
    const get = path => db.ref(path).once('value').then(s => s.val()).catch(() => null);
    const [quota, daily, live, sub] = await Promise.all([get('users/' + u.uid + '/quota'), get('users/' + u.uid + '/dailyQuota'), get('users/' + u.uid + '/liveUsage'), get('users/' + u.uid + '/subscription')]);
    document.getElementById('tuPlan').textContent = (LABELS[p] || p) + ' plan' + (sub && sub.ends ? ' · renews or ends ' + new Date(sub.ends).toLocaleDateString() : '');
    const T = window.RehabPlanTiers;
    const budget = T ? T.PLAN_TOKEN_BUDGET[p] : null;
    const cap = T && T.dailyCap ? T.dailyCap(p) : null;
    const usedToday = cap && daily && daily.day === today() ? Number(daily.tokensUsed) || 0 : 0;
    let html = '';
    if (budget == null) html += card('Every 4 hours', 'Unlimited', 'Your plan has no 4-hour token limit.', null);
    else {
      const fresh = !quota || !quota.windowStart || Date.now() - quota.windowStart >= WINDOW_MS;
      const used = fresh ? 0 : Number(quota.tokensUsed) || 0;
      const resets = fresh ? null : quota.windowStart + WINDOW_MS;
      const paused = cap && usedToday >= cap;
      html += card('This 4-hour window', num(used) + ' of ' + num(budget) + ' tokens',
        num(Math.max(0, budget - used)) + ' left · ' + (paused ? "paused by today's cap until midnight" : resets ? 'resets at ' + clock(resets) : 'a new window starts with your next request'),
        Math.min(1, used / budget));
    }
    if (cap) {
      const midnight = new Date(); midnight.setHours(24, 0, 0, 0);
      html += card('Today', num(usedToday) + ' of ' + num(cap) + ' tokens', num(Math.max(0, cap - usedToday)) + ' left · resets at ' + clock(midnight.getTime()), Math.min(1, usedToday / cap));
    }
    const lim = (window.RehablixPlanConfig && window.RehablixPlanConfig.liveLimits(p)) || LIVE[p];
    if (lim) {
      const day = today(), month = day.slice(0, 7);
      const dMin = live && live.day === day ? Math.floor((Number(live.daySec) || 0) / 60) : 0;
      const mMin = live && live.month === month ? Math.floor((Number(live.monthSec) || 0) / 60) : 0;
      const dayLim = Number(lim.day != null ? lim.day : (LIVE[p] || {}).day) || 0, monthLim = Number(lim.month != null ? lim.month : (LIVE[p] || {}).month) || 0;
      html += card('Lixa Live minutes', dMin + ' of ' + dayLim + ' min today', mMin + ' of ' + monthLim + ' this month · ' + Math.max(0, Math.min(dayLim - dMin, monthLim - mMin)) + ' min left', dayLim ? Math.min(1, dMin / dayLim) : null);
    }
    html += '<h3 class="tu-sub">How each model counts</h3><div class="tu-models">' +
      [['Basal 100', 'half of its words'], ['Corpus 101', 'its words'], ['Medulla 200', '2 × the tokens it really uses, its thinking included'], ['Blix 360', '2 × the tokens it really uses, its thinking included']]
        .map(r => '<div><b>' + r[0] + '</b><span>' + r[1] + '</span></div>').join('') + '</div>';
    body.innerHTML = html;
  }

  function open() {
    if (!user() || plan() === 'free') return;
    const m = modal();
    m.classList.add('show');
    document.body.style.overflow = 'hidden';
    render();
  }

  window.RehablixTokenUsage = { open, refresh: render };
  // (the profile menu item calls window.openProfileModal: js/auth.js)
  window.openProfileModal = open;
  document.addEventListener('planUpdated', sync);
  function boot() {
    sync();
    try { firebase.auth().onAuthStateChanged(() => setTimeout(sync, 0)); } catch (e) { /* no Firebase on this page */ }
    setTimeout(sync, 1500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
