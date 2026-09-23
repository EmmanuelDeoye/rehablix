// js/quota-modal.js — one shared, reusable "low/exhausted AI token quota"
// modal (Smart EMR Round 2, item 9). A single global module so every AI
// call site across the app (Lixa, Smart EMR, Motion, Format, Standardized,
// Study, Assignment, Exam) shows the SAME warning instead of each page
// inventing its own — built on top of the existing js/plan-tiers.js
// hasQuota()/consumeQuota() machinery, not a new quota system.
(function () {
  const LOW_WATER_RATIO = 0.1; // warn once remaining budget drops below 10%
  let modalEl = null;
  let lastShownKey = null; // avoids re-showing the same state repeatedly mid-session

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.id = 'quotaWarningModal';
    modalEl.innerHTML = `
      <style>
        #quotaWarningModal { position:fixed; inset:0; z-index:99999; display:none; align-items:center; justify-content:center; background:rgba(15,23,42,0.55); backdrop-filter:blur(3px); }
        #quotaWarningModal.show { display:flex; }
        #quotaWarningModal .qw-card { background:var(--card-bg,#fff); color:var(--text-primary,#1f2933); border-radius:1.25rem; padding:1.8rem; max-width:380px; width:92%; box-shadow:0 25px 60px -12px rgba(0,0,0,0.35); text-align:center; animation: qwPop .22s ease; font-family:inherit; }
        @keyframes qwPop { from { transform:scale(.92); opacity:0; } to { transform:scale(1); opacity:1; } }
        #quotaWarningModal .qw-icon { font-size:2.4rem; margin-bottom:.5rem; }
        #quotaWarningModal h3 { margin:0 0 .5rem; font-size:1.15rem; }
        #quotaWarningModal p { margin:0 0 1rem; font-size:.9rem; color:var(--text-secondary,#666); line-height:1.5; }
        #quotaWarningModal .qw-bar-track { height:8px; border-radius:99px; background:rgba(0,0,0,0.08); overflow:hidden; margin-bottom:1.1rem; }
        #quotaWarningModal .qw-bar-fill { height:100%; border-radius:99px; transition:width .3s ease; }
        #quotaWarningModal .qw-actions { display:flex; gap:.6rem; justify-content:center; }
        #quotaWarningModal button { border:none; border-radius:.7rem; padding:.6rem 1.1rem; font-size:.85rem; font-weight:600; cursor:pointer; }
        #quotaWarningModal .qw-dismiss { background:rgba(0,0,0,0.06); color:inherit; }
        #quotaWarningModal .qw-upgrade { background:linear-gradient(135deg,#009688,#00796b); color:#fff; }
      </style>
      <div class="qw-card">
        <div class="qw-icon" id="qwIcon">⚡</div>
        <h3 id="qwTitle">Running low on AI tokens</h3>
        <p id="qwMessage"></p>
        <div class="qw-bar-track"><div class="qw-bar-fill" id="qwBarFill"></div></div>
        <div class="qw-actions">
          <button type="button" class="qw-dismiss" id="qwDismissBtn">Dismiss</button>
          <button type="button" class="qw-upgrade" id="qwUpgradeBtn">Upgrade Plan</button>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);
    modalEl.querySelector('#qwDismissBtn').addEventListener('click', hide);
    modalEl.querySelector('#qwUpgradeBtn').addEventListener('click', () => {
      hide();
      if (window.RehablixRouter) window.RehablixRouter.go('index.html#/subscription');
      else window.location.href = 'index.html#/subscription';
    });
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) hide(); });
    return modalEl;
  }

  function hide() {
    if (modalEl) modalEl.classList.remove('show');
  }

  function show({ exhausted, remainingRatio, resetAt }) {
    const el = ensureModal();
    const icon = el.querySelector('#qwIcon');
    const title = el.querySelector('#qwTitle');
    const msg = el.querySelector('#qwMessage');
    const bar = el.querySelector('#qwBarFill');
    const resetMins = resetAt ? Math.max(1, Math.ceil((resetAt - Date.now()) / 60000)) : null;
    if (exhausted) {
      icon.textContent = '🚫';
      title.textContent = 'Token budget exhausted';
      msg.textContent = resetMins
        ? `You've used your full token budget for this window. It resets in about ${resetMins} minute(s), or upgrade for more room right now.`
        : `You've used your full token budget for this window. Upgrade for more room right now.`;
      bar.style.width = '100%';
      bar.style.background = '#dc2626';
    } else {
      icon.textContent = '⚡';
      title.textContent = 'Running low on AI tokens';
      const pct = Math.round((1 - remainingRatio) * 100);
      msg.textContent = resetMins
        ? `You've used ${pct}% of your token budget for this window (resets in about ${resetMins} minute(s)). Consider upgrading for more room.`
        : `You've used ${pct}% of your token budget for this window.`;
      bar.style.width = pct + '%';
      bar.style.background = '#f59e0b';
    }
    el.classList.add('show');
  }

  // Drop-in wrapper around RehabPlanTiers.hasQuota(uid, plan) — same return
  // shape, but ALSO shows the shared modal once per state-change when the
  // result is exhausted or low (<10% remaining), so individual pages don't
  // need their own warning UI. Callers still get `result.allowed` to decide
  // whether to actually block the generation.
  async function checkAndWarn(uid, plan) {
    if (!window.RehabPlanTiers) return { allowed: true };
    const result = await window.RehabPlanTiers.hasQuota(uid, plan);
    if (result.unlimited) return result;
    const remainingRatio = result.budget ? Math.max(0, (result.budget - (result.used || 0)) / result.budget) : 1;
    const exhausted = !result.allowed;
    const low = !exhausted && remainingRatio < LOW_WATER_RATIO;
    if (exhausted || low) {
      const key = `${uid}:${exhausted ? 'exhausted' : 'low'}:${result.resetAt}`;
      if (key !== lastShownKey) {
        lastShownKey = key;
        show({ exhausted, remainingRatio, resetAt: result.resetAt });
      }
    }
    return result;
  }

  window.RehablixQuotaModal = { show, hide, checkAndWarn };
})();
