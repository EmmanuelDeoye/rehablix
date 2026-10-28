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
        #quotaWarningModal .qw-alt { background:rgba(0,150,136,0.12); color:#00796b; }
        #quotaWarningModal .qw-locked { margin:-.4rem 0 1rem; padding:.6rem .75rem; border-radius:.7rem; background:rgba(0,0,0,0.04); font-size:.8rem; line-height:1.45; text-align:left; color:var(--text-secondary,#555); }
        #quotaWarningModal .qw-locked b { color:var(--text-primary,#1f2933); }
        #quotaWarningModal .qw-actions { flex-wrap:wrap; }
      </style>
      <div class="qw-card" role="dialog" aria-modal="true" aria-labelledby="qwTitle">
        <div class="qw-icon" id="qwIcon">⚡</div>
        <h3 id="qwTitle">Running low on SI tokens</h3>
        <p id="qwMessage"></p>
        <div class="qw-locked" id="qwLocked" hidden></div>
        <div class="qw-bar-track" id="qwBarTrack"><div class="qw-bar-fill" id="qwBarFill"></div></div>
        <div class="qw-actions" id="qwActions"></div>
      </div>
    `;
    document.body.appendChild(modalEl);
    modalEl.addEventListener('click', (e) => { if (e.target === modalEl) hide(); });
    return modalEl;
  }

  function goUpgrade() {
    hide();
    if (window.RehablixRouter) window.RehablixRouter.go('index.html#/subscription');
    else window.location.href = 'index.html#/subscription';
  }
  /** The buttons: [{ label, kind: 'dismiss' | 'upgrade' | 'alt', run }]. */
  function setActions(el, list) {
    const box = el.querySelector('#qwActions');
    box.innerHTML = '';
    list.forEach(a => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = a.kind === 'upgrade' ? 'qw-upgrade' : a.kind === 'alt' ? 'qw-alt' : 'qw-dismiss';
      b.textContent = a.label;
      b.addEventListener('click', () => { try { (a.run || hide)(); } catch (e) { hide(); } });
      box.appendChild(b);
    });
  }

  function hide() {
    if (modalEl) modalEl.classList.remove('show');
  }

  function show({ exhausted, remainingRatio, resetAt, daily }) {
    const el = ensureModal();
    const icon = el.querySelector('#qwIcon');
    const title = el.querySelector('#qwTitle');
    const msg = el.querySelector('#qwMessage');
    const bar = el.querySelector('#qwBarFill');
    el.querySelector('#qwLocked').hidden = true;
    el.querySelector('#qwBarTrack').hidden = false;
    setActions(el, [{ label: 'Dismiss' }, { label: 'Upgrade Plan', kind: 'upgrade', run: goUpgrade }]);
    const resetMins = resetAt ? Math.max(1, Math.ceil((resetAt - Date.now()) / 60000)) : null;
    if (exhausted) {
      icon.textContent = '🚫';
      title.textContent = 'Token budget exhausted';
      // (the day's cap set on the admin page resets at midnight)
      msg.textContent = daily
        ? `You've used today's token allowance. It resets at midnight, or upgrade for more room right now.`
        : resetMins
          ? `You've used your full token budget for this window. It resets in about ${resetMins} minute(s), or upgrade for more room right now.`
          : `You've used your full token budget for this window. Upgrade for more room right now.`;
      bar.style.width = '100%';
      bar.style.background = '#dc2626';
    } else {
      icon.textContent = '⚡';
      title.textContent = 'Running low on SI tokens';
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
        show({ exhausted, remainingRatio, resetAt: result.resetAt, daily: !!result.daily });
      }
    }
    return result;
  }

  // ---- The server's refusals (rehablix-android/backend/functions/ai-policy.js codes) ----
  // Each says what is locked, why, what still works and when it comes back, with the one or two things to do about it.
  const LABELS = { free: 'Free', student: 'Basic', pro: 'Pro', max: 'Max' };
  const OPENAI_FEATURES = 'Blix 360, image and video analysis, web search and audio transcription';
  function when(resetAt, monthly) {
    if (!resetAt) return '';
    const d = new Date(resetAt);
    if (monthly) return 'Back on ' + d.toLocaleDateString(undefined, { day: 'numeric', month: 'long' }) + '.';
    const mins = Math.max(1, Math.ceil((resetAt - Date.now()) / 60000));
    return mins < 90 ? `Back in about ${mins} minute(s).` : 'Back at ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) + (d.getDate() !== new Date().getDate() ? ' tomorrow' : '') + '.';
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const BLOCKED = {
    login_required: { icon: '🔐', title: 'Sign in to keep going', locked: () => `<b>Needs an account:</b> ${OPENAI_FEATURES}, Medulla 200 and your history. <b>Free to join</b> — sign in takes a few seconds.` },
    verify_email: { icon: '✉️', title: 'Verify your email', locked: () => `<b>Waiting for your email check:</b> ${OPENAI_FEATURES}, Medulla 200 and Blix 360. <b>Still working:</b> Lixa chat on Corpus 101.` },
    plan_model: { icon: '🔒', title: e => `${(e.message.match(/^(\S+ \d+)/) || [])[1] || 'This model'} is locked on your plan`, locked: e => `<b>Your plan:</b> ${LABELS[e.plan] || 'Free'}.${e.needs ? ` <b>Unlocks with:</b> ${LABELS[e.needs]}.` : ''}` },
    blix_daily: { icon: '⚡', title: 'Today\'s Blix 360 answers are used', locked: e => `<b>Locked until tomorrow:</b> Blix 360 (${e.limit} a day on ${LABELS[e.plan] || 'your plan'}). <b>Still working:</b> Medulla 200, Corpus 101 and Basal 100.` },
    openai_spend: { icon: '🌙', title: 'Today\'s OpenAI features are used up', locked: () => `<b>Locked until tomorrow:</b> ${OPENAI_FEATURES}. <b>Still working:</b> Lixa and every tool on the DeepSeek models (Corpus 101, Medulla 200 on paid plans).` },
    vision_daily: { icon: '🖼️', title: 'Image analysis limit reached', locked: e => `<b>Locked until tomorrow:</b> image and video analysis (${e.limit} a day on ${LABELS[e.plan] || 'your plan'}). <b>Still working:</b> text questions, documents and every tool.` },
    search_daily: { icon: '🌐', title: 'Web searches used for today', locked: e => `<b>Locked until tomorrow:</b> web search (${e.limit} a day). Lixa still answers from what it knows.` },
    motion_monthly: { icon: '🏃', title: 'Motion AI interpretations used', locked: e => `<b>Locked until next month:</b> the written AI interpretation (${e.limit} a month on ${LABELS[e.plan] || 'Free'}). <b>Still free:</b> every Motion & Gait measurement, angle and report.` },
    audio_trial: { icon: '🎙️', title: 'Free transcription minutes used', locked: e => `<b>Locked until next month:</b> audio transcription (${e.limit} minutes a month on ${LABELS[e.plan] || 'Free'}). <b>Still working:</b> typing notes and every other tool.` },
    deepseek_busy: { icon: '⏳', title: 'Lixa is busy right now', locked: () => '' },
    too_large: { icon: '📁', title: 'That file is too large', locked: () => '' },
    banned: { icon: '⛔', title: 'SI is not available on this account', locked: () => '' }
  };
  function switchTo(id) {
    hide();
    if (window.RehablixModelChoice && window.RehablixModelChoice.set(id)) {
      const t = window.RehabPlanTiers && window.RehabPlanTiers.getModel(id);
      toast(`Switched to ${t ? t.label : id} on every page. Try again now.`);
    }
  }
  function toast(text) {
    if (typeof window.showToast === 'function') { window.showToast(text, 'success', 4500); return; }
    const host = document.getElementById('toast-container') || document.body;
    const t = document.createElement('div'); t.className = 'toast success'; t.textContent = text;
    host.appendChild(t); setTimeout(() => t.remove(), 4500);
  }
  async function resendVerification() {
    const u = firebase.auth().currentUser;
    if (!u) return;
    try { await u.sendEmailVerification(); toast('We sent a new link to ' + u.email + '.'); } catch (e) { toast('Could not send the link right now (' + (e.code || e.message) + '). Try again in a minute.'); }
  }
  /** After the user opened the link: refresh the sign-in so the server sees the verified email. */
  async function checkVerified() {
    const u = firebase.auth().currentUser;
    if (!u) return false;
    try { await u.reload(); } catch (e) { /* offline */ }
    const fresh = firebase.auth().currentUser;
    if (fresh && fresh.emailVerified) { try { await fresh.getIdToken(true); } catch (e) { /* next request refreshes it */ } hide(); toast('Email verified — everything is unlocked.'); document.dispatchEvent(new CustomEvent('rehablix:email-verified')); return true; }
    toast('Not verified yet. Open the link in the email we sent, then tap again.');
    return false;
  }

  let lastBlocked = { code: null, at: 0 };
  /** Explains a refusal from the server (detail = its error: { code, message, plan, needs, suggest, limit, used, resetAt }). */
  function showBlocked(e) {
    if (!e || !e.code) return;
    if (e.code === 'quota_window' || e.code === 'quota_daily') {
      const ratio = e.limit ? Math.max(0, (e.limit - (e.used || 0)) / e.limit) : 0;
      show({ exhausted: true, remainingRatio: ratio, resetAt: e.resetAt, daily: e.code === 'quota_daily' });
      return;
    }
    const spec = BLOCKED[e.code];
    if (!spec) return;
    // (one request can be refused twice in a row: the modal is shown once)
    if (lastBlocked.code === e.code && Date.now() - lastBlocked.at < 4000) return;
    lastBlocked = { code: e.code, at: Date.now() };
    const el = ensureModal();
    el.querySelector('#qwIcon').textContent = spec.icon;
    el.querySelector('#qwTitle').textContent = typeof spec.title === 'function' ? spec.title(e) : spec.title;
    const monthly = e.code === 'motion_monthly' || e.code === 'audio_trial';
    el.querySelector('#qwMessage').textContent = [e.message, when(e.resetAt, monthly)].filter(Boolean).join(' ');
    const locked = spec.locked(e);
    const lockedEl = el.querySelector('#qwLocked');
    lockedEl.hidden = !locked; lockedEl.innerHTML = locked;
    const track = el.querySelector('#qwBarTrack'), bar = el.querySelector('#qwBarFill');
    const hasBar = typeof e.limit === 'number' && e.limit > 0 && typeof e.used === 'number';
    track.hidden = !hasBar;
    if (hasBar) { bar.style.width = Math.min(100, Math.round(e.used / e.limit * 100)) + '%'; bar.style.background = '#dc2626'; }
    const actions = [];
    if (e.code === 'login_required') actions.push({ label: 'Not now' }, { label: 'Sign in free', kind: 'upgrade', run: () => { hide(); const b = document.getElementById('loginBtn'); if (b) b.click(); } });
    else if (e.code === 'verify_email') actions.push({ label: 'Resend link', kind: 'alt', run: resendVerification }, { label: 'I\'ve verified', kind: 'upgrade', run: checkVerified });
    else {
      actions.push({ label: e.suggest || e.needs ? 'Not now' : 'OK' });
      if (e.suggest && e.suggest.id) actions.push({ label: `Use ${e.suggest.label}`, kind: e.needs ? 'alt' : 'upgrade', run: () => switchTo(e.suggest.id) });
      if (e.needs) actions.push({ label: `Upgrade to ${LABELS[e.needs]}`, kind: 'upgrade', run: goUpgrade });
    }
    setActions(el, actions);
    el.classList.add('show');
  }

  window.RehablixQuotaModal = { show, hide, checkAndWarn, showBlocked, resendVerification, checkVerified };
})();
