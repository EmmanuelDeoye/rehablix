// js/ai-issues.js — the app knowing when an SI feature did not work and why, on every page (Lixa chat, Lixa agent and
// every workspace tool), and saying what to do about it:
//
//  * the server refused a request (rehablix:ai-blocked, from js/server-ai.js and js/ai-transport.js): the plan, a
//    daily/monthly allowance, signing in, verifying the email... -> the shared modal (js/quota-modal.js showBlocked);
//    a web search answered without the web -> a small note.
//  * an answer came back cut short by the model's length limit, or empty (rehablix:ai-issue, js/ai-transport.js), or
//    a tool could not use what the model wrote (RehablixAIIssues.report from the tool) -> a note suggesting the next
//    model up: switch to it in one tap when the plan has it, or the plan that unlocks it.
//
// Android: ui/auth/ShellOverlays.kt (AiIssueCard), the same rules and words.
(function () {
  if (window.RehablixAIIssues) return;
  const ORDER = ['basal100', 'corpus101', 'medulla200', 'blix360'];
  const LABELS = { free: 'Free', student: 'Basic', pro: 'Pro', max: 'Max' };
  const tiers = () => window.RehabPlanTiers;
  const plan = () => (window.rehabPlans && window.rehabPlans.getCurrentPlan && window.rehabPlans.getCurrentPlan()) || 'free';
  const labelOf = id => { const t = tiers(); return t && id ? t.getModel(id).label : 'this model'; };

  /** The next model up from [id]: { id, unlocked, needs } (null at the top, or for a model outside the four). */
  function nextUp(id) {
    const t = tiers();
    const from = ORDER.indexOf(id);
    if (!t || from < 0 || from + 1 >= ORDER.length) return null;
    const up = ORDER[from + 1];
    return { id: up, unlocked: t.isModelUnlocked(up, plan()), needs: t.getModel(up).minPlan };
  }

  // ------------------------------------------------------------------ the note
  let card = null, cardTimer = null, lastKey = '', lastAt = 0;
  function ensureCard() {
    if (card) return card;
    const style = document.createElement('style');
    style.textContent = `
      /* at the top, just under the navbar: never over the message box or a tool's buttons */
      #rxAiIssue { position:fixed; left:50%; top:calc(78px + env(safe-area-inset-top, 0px)); transform:translateX(-50%) translateY(-16px); z-index:9990;
        width:min(440px, calc(100vw - 32px)); background:var(--card-bg,#fff); color:var(--text-primary,#1f2933); border:1px solid var(--border-light,#e3e6ea);
        border-radius:16px; box-shadow:0 18px 40px -12px rgba(0,0,0,.35); padding:14px 14px 12px 16px; display:flex; gap:12px; align-items:flex-start;
        opacity:0; pointer-events:none; transition:opacity .2s ease, transform .2s ease; font-size:.88rem; line-height:1.45; }
      #rxAiIssue.show { opacity:1; pointer-events:auto; transform:translateX(-50%) translateY(0); }
      #rxAiIssue .rx-ai-icon { font-size:1.25rem; line-height:1; margin-top:2px; }
      #rxAiIssue .rx-ai-body { flex:1; min-width:0; }
      #rxAiIssue .rx-ai-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
      #rxAiIssue button.rx-ai-act { border:none; border-radius:10px; padding:7px 12px; font:inherit; font-size:.8rem; font-weight:600; cursor:pointer;
        background:linear-gradient(135deg,#009688,#00796b); color:#fff; }
      #rxAiIssue button.rx-ai-act.alt { background:rgba(0,150,136,.12); color:#00796b; }
      #rxAiIssue .rx-ai-close { background:none; border:none; color:inherit; opacity:.55; font-size:1.1rem; cursor:pointer; padding:0 2px; line-height:1; }
      @media (prefers-color-scheme: dark) { #rxAiIssue button.rx-ai-act.alt { color:#4db6ac; } }`;
    document.head.appendChild(style);
    card = document.createElement('div');
    card.id = 'rxAiIssue';
    card.setAttribute('role', 'status');
    card.setAttribute('aria-live', 'polite');
    document.body.appendChild(card);
    return card;
  }
  function hideCard() { if (card) card.classList.remove('show'); clearTimeout(cardTimer); }
  /** A note with up to two buttons ({ label, alt, run }); it stays 12 s, or until closed. */
  function note(icon, text, actions, key) {
    key = key || text;
    if (key === lastKey && Date.now() - lastAt < 8000) return;
    lastKey = key; lastAt = Date.now();
    const c = ensureCard();
    c.innerHTML = '';
    const i = document.createElement('div'); i.className = 'rx-ai-icon'; i.textContent = icon; i.setAttribute('aria-hidden', 'true');
    const body = document.createElement('div'); body.className = 'rx-ai-body';
    const p = document.createElement('div'); p.textContent = text; body.appendChild(p);
    if (actions && actions.length) {
      const row = document.createElement('div'); row.className = 'rx-ai-actions';
      actions.forEach(a => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'rx-ai-act' + (a.alt ? ' alt' : ''); b.textContent = a.label;
        b.addEventListener('click', () => { hideCard(); a.run(); });
        row.appendChild(b);
      });
      body.appendChild(row);
    }
    const x = document.createElement('button'); x.type = 'button'; x.className = 'rx-ai-close'; x.setAttribute('aria-label', 'Close'); x.textContent = '×';
    x.addEventListener('click', hideCard);
    c.appendChild(i); c.appendChild(body); c.appendChild(x);
    requestAnimationFrame(() => c.classList.add('show'));
    clearTimeout(cardTimer);
    cardTimer = setTimeout(hideCard, 12000);
  }
  const upgrade = () => { if (window.RehablixRouter) window.RehablixRouter.go('index.html#/subscription'); else location.href = 'index.html#/subscription'; };
  function switchTo(id, retryHint) {
    if (window.RehablixModelChoice && window.RehablixModelChoice.set(id)) {
      note('✅', `Switched to ${labelOf(id)} on every page. ${retryHint || 'Run it again to use it.'}`, [], 'switched:' + id);
    }
  }
  /** The "try a stronger model" buttons for an answer made with [model]. */
  function strongerActions(model) {
    const n = nextUp(model);
    if (!n) return { text: '', actions: [] };
    if (n.unlocked) return { text: ` ${labelOf(n.id)} usually handles this better.`, actions: [{ label: `Use ${labelOf(n.id)}`, run: () => switchTo(n.id) }] };
    return { text: ` ${labelOf(n.id)} (${LABELS[n.needs]} plan) usually handles this better.`, actions: [{ label: `See ${LABELS[n.needs]}`, run: upgrade }] };
  }

  // ------------------------------------------------------------------ what happened
  window.addEventListener('rehablix:ai-blocked', e => {
    const d = e.detail || {};
    if (d.soft) {
      // a web search the plan could not make today: the answer came anyway, without the web
      const why = d.code === 'search_daily' ? 'today\'s web searches are used' : d.code === 'login_required' ? 'web search needs an account' : d.code === 'verify_email' ? 'web search needs a verified email' : 'today\'s OpenAI features are used up';
      const acts = d.code === 'login_required' ? [{ label: 'Sign in free', run: () => { const b = document.getElementById('loginBtn'); if (b) b.click(); } }]
        : d.code === 'verify_email' ? [{ label: 'Resend link', alt: true, run: () => window.RehablixQuotaModal && window.RehablixQuotaModal.resendVerification() }]
        : d.needs ? [{ label: `Upgrade to ${LABELS[d.needs]}`, run: upgrade }] : [];
      note('🌐', `Answered without searching the web: ${why}.`, acts, 'soft:' + d.code);
      return;
    }
    if (window.RehablixQuotaModal && window.RehablixQuotaModal.showBlocked) window.RehablixQuotaModal.showBlocked(d);
  });

  window.addEventListener('rehablix:ai-issue', e => {
    const d = e.detail || {};
    const model = d.model;
    const s = strongerActions(model);
    if (d.kind === 'cut_off') {
      note('✂️', `${model ? labelOf(model) : 'The SI'} reached its length limit, so this was cut short.${s.text || ' Try asking for less at once.'}`, s.actions, 'cut:' + model + ':' + d.route);
    } else if (d.kind === 'empty') {
      note('🤔', `No answer came back${model ? ` from ${labelOf(model)}` : ''}. Please try again.${s.text}`, s.actions, 'empty:' + model + ':' + d.route);
    }
  });

  /**
   * For tools: the model's answer could not be used (bad format after the retries, missing sections...).
   * report({ feature, kind: 'bad_output', model }) — model defaults to the chosen one.
   */
  function report(o) {
    o = o || {};
    const model = o.model || (window.RehablixModelChoice ? window.RehablixModelChoice.id() : 'corpus101');
    const s = strongerActions(model);
    if (o.kind === 'bad_output') {
      note('🧩', `${labelOf(model)} could not produce a usable result for this.${s.text || ' Please try again.'}`, s.actions, 'bad:' + model + ':' + (o.feature || ''));
    }
  }

  // ------------------------------------------------------------------ what is left (Free and other limited plans)
  // Said once a session, where it matters: opening Motion & Gait (AI interpretations), Audio (transcription minutes),
  // and attaching an image or video in Lixa (image analyses). Unlimited allowances say nothing.
  const hinted = {};
  async function hint(kind) {
    if (hinted[kind]) return;
    let uid = null;
    try { uid = firebase.auth().currentUser && firebase.auth().currentUser.uid; } catch (e) { uid = null; }
    const t = tiers();
    if (!uid || !t || !t.aiAllowance || !window.REHABLIX_SERVER_AI) return;
    const a = await t.aiAllowance(uid, plan()).catch(() => null);
    if (!a) return;
    const left = a[kind];
    if (left == null) return;
    hinted[kind] = true;
    const lim = a.limits;
    const text = {
      motion: `${left} of ${lim.motionMonthly} Motion AI interpretations left this month. Measurements are always free.`,
      audioMinutes: `${left} of ${lim.audioMinutesMonthly} free transcription minutes left this month.`,
      vision: `${left} of ${lim.visionDaily} image or video analyses left today.`
    }[kind];
    const acts = left <= 1 ? [{ label: 'Get more', run: upgrade }] : [];
    note(kind === 'motion' ? '🏃' : kind === 'audioMinutes' ? '🎙️' : '🖼️', text, acts, 'hint:' + kind);
  }
  function routeHint() {
    const r = (document.body && document.body.dataset.route) || '';
    if (r === 'motion') hint('motion');
    else if (r === 'audio') hint('audioMinutes');
  }
  window.addEventListener('hashchange', () => setTimeout(routeHint, 400));
  document.addEventListener('planUpdated', () => setTimeout(routeHint, 400));
  document.addEventListener('change', e => {
    const input = e.target;
    if (!input || input.type !== 'file' || !input.files || !input.files.length) return;
    if (((document.body && document.body.dataset.route) || 'lixa') !== 'lixa') return;
    if (Array.from(input.files).some(f => /^(image|video)\//.test(f.type || ''))) hint('vision');
  }, true);

  window.RehablixAIIssues = { report, note, nextUp, hint };
})();
