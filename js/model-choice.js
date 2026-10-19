// js/model-choice.js — the one AI model choice (Basal 100 / Corpus 101 / Medulla 200 / Blix 360,
// js/plan-tiers.js) that every page works with: Lixa chat, Lixa agent (Standard), and the tool
// pages. Choosing a model on any page changes it everywhere (this tab, other tabs, every picker).
//
// It is the same choice the Lixa chat composer always saved ('rehab-lixa-model'), so nothing a
// user picked before is lost. A model the current plan does not unlock is never used: the page
// works with Corpus 101 instead, and the stored choice comes back if the plan unlocks it again.
//
// Pickers are placed by PLACEMENTS below (next to each page's main AI button) and re-placed
// whenever a page is shown; js/ask.js keeps its own composer picker in step through onChange().
(function () {
  const KEY = 'rehab-lixa-model';
  const FALLBACK = 'corpus101';
  const EVENT = 'rehablix:model';
  const tiers = () => window.RehabPlanTiers;
  const plan = () => (window.rehabPlans && window.rehabPlans.getCurrentPlan && window.rehabPlans.getCurrentPlan()) || 'free';

  function stored() {
    try { return localStorage.getItem(KEY) || FALLBACK; } catch (e) { return FALLBACK; }
  }
  function known(id) { const t = tiers(); return !!(t && t.MODELS.some(m => m.id === id)); }

  /** The model to work with now: the user's choice if their plan unlocks it, else Corpus 101. */
  function id() {
    const want = stored();
    const t = tiers();
    if (!t || !known(want)) return FALLBACK;
    return t.isModelUnlocked(want, plan()) ? want : FALLBACK;
  }
  function model() { const t = tiers(); return t ? t.getModel(id()) : null; }
  function label() { const m = model(); return m ? m.label : 'Corpus 101'; }

  /** Chooses a model for every page. Returns false (and says why) when the plan does not unlock it. */
  function set(newId, opts) {
    const t = tiers();
    if (!t || !known(newId)) return false;
    if (!t.isModelUnlocked(newId, plan())) {
      const m = t.getModel(newId);
      if (!(opts && opts.quiet)) toast(`${m.label} requires the ${t.PLAN_LABELS[m.minPlan]} plan or higher. Upgrade to unlock it.`, 'error');
      return false;
    }
    try { localStorage.setItem(KEY, newId); } catch (e) {
      toast('This browser is blocking saved settings, so the model choice could not be kept.', 'error');
      return false;
    }
    announce();
    return true;
  }

  const listeners = new Set();
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function announce() {
    const now = id();
    listeners.forEach(fn => { try { fn(now); } catch (e) { /* one listener failing never stops the rest */ } });
    try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { id: now } })); } catch (e) { /* old browsers */ }
    refreshChips();
  }
  // another tab chose a model
  window.addEventListener('storage', e => { if (e.key === KEY) announce(); });
  // the plan (and so what is unlocked) can change after the page loads
  document.addEventListener('planUpdated', () => announce());

  /**
   * The request settings for the chosen model: { token, endpoint, model, maxTokens, weight,
   * temperature, top_p, responseStyle } (js/ai-quota-core.js), or null when it is not configured.
   */
  function resolve() {
    const core = window.RehablixAIQuotaCore;
    return core ? core.resolveModelConfig(id()) : Promise.resolve(null);
  }

  function toast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type || 'info', 4500); return; }
    const host = document.getElementById('toastContainer') || document.body;
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ------------------------------------------------------------------ pickers
  // One shared popup (fixed position, so no page's overflow can clip it).
  let popup = null, openFor = null;
  function ensurePopup() {
    if (popup) return popup;
    popup = document.createElement('div');
    popup.className = 'model-picker-popup rx-model-popup';
    popup.setAttribute('role', 'listbox');
    popup.setAttribute('aria-label', 'SI model');
    popup.hidden = true;
    document.body.appendChild(popup);
    popup.addEventListener('click', e => {
      const opt = e.target.closest('.model-option');
      if (!opt) return;
      e.stopPropagation();
      if (set(opt.dataset.modelId)) close();
    });
    document.addEventListener('click', e => { if (!popup.hidden && !popup.contains(e.target) && !(openFor && openFor.contains(e.target))) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    window.addEventListener('resize', close);
    window.addEventListener('scroll', () => { if (!popup.hidden) position(); }, true);
    return popup;
  }
  function renderPopup() {
    const t = tiers();
    if (!t) return;
    const p = plan();
    const cur = id();
    popup.innerHTML = '<div class="rx-model-popup-head">SI model for every page</div>' + t.MODELS.map(m => {
      const locked = !t.isModelUnlocked(m.id, p);
      return `<button type="button" role="option" aria-selected="${m.id === cur}" class="model-option${locked ? ' locked' : ''}${m.id === cur ? ' selected' : ''}" data-model-id="${m.id}">
        <span class="model-option-rank">${m.rank}</span>
        <span class="model-option-text"><span class="model-option-name">${esc(m.label)}${locked ? ' <i class="fas fa-lock" aria-hidden="true"></i>' : ''}</span><span class="model-option-desc">${esc(m.tagline || m.strength)}</span></span>
        <span class="model-option-plan">${esc(t.PLAN_LABELS[m.minPlan])}+</span>
      </button>`;
    }).join('');
  }
  function position() {
    if (!openFor || !popup) return;
    const r = openFor.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 24);
    popup.style.width = w + 'px';
    const left = Math.max(12, Math.min(r.left, window.innerWidth - w - 12));
    popup.style.left = left + 'px';
    const h = popup.offsetHeight || 260;
    const below = r.bottom + 6;
    popup.style.top = (below + h > window.innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : below) + 'px';
  }
  function open(chip) {
    ensurePopup();
    if (openFor === chip && !popup.hidden) { close(); return; }
    openFor = chip;
    renderPopup();
    popup.hidden = false;
    chip.classList.add('active');
    chip.setAttribute('aria-expanded', 'true');
    position();
  }
  function close() {
    if (!popup || popup.hidden) return;
    popup.hidden = true;
    if (openFor) { openFor.classList.remove('active'); openFor.setAttribute('aria-expanded', 'false'); }
    openFor = null;
  }

  /** A picker chip ("Corpus 101 ▾"). `note` (optional) is shown in its tooltip. */
  function chip(opts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'model-picker-btn rx-model-chip';
    b.setAttribute('aria-haspopup', 'listbox');
    b.setAttribute('aria-expanded', 'false');
    b.dataset.rxModelChip = '1';
    if (opts && opts.className) b.classList.add(opts.className);
    b.innerHTML = '<i class="fas fa-microchip" aria-hidden="true"></i><span></span><i class="fas fa-chevron-down model-picker-caret" aria-hidden="true"></i>';
    b.title = 'SI model (applies to every page)' + (opts && opts.note ? ' — ' + opts.note : '');
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); open(b); });
    paint(b);
    return b;
  }
  function paint(b) {
    const s = b.querySelector('span');
    if (s) s.textContent = label();
    b.setAttribute('aria-label', 'SI model: ' + label() + '. Changes it on every page.');
  }
  function refreshChips() { document.querySelectorAll('[data-rx-model-chip]').forEach(paint); if (popup && !popup.hidden) renderPopup(); }

  // Where each page's picker goes: before its main AI button (the button that spends the model).
  // `wrap` puts the chip on its own line above the button; otherwise it sits beside it.
  const PLACEMENTS = [
    { route: 'format', before: '#generateBtn', wrap: true },
    { route: 'standardized', before: '#generateBtn', wrap: true },
    { route: 'audio', prepend: '#stageSetup', wrap: true, note: 'used to write the session narrative; transcription is always Whisper, and live coaching labels stay on the fast model so they keep up with speech' },
    { route: 'presentation', before: '#generateBtn', wrap: true },
    { route: 'study', before: '#generateSetBtn', wrap: true },
    { route: 'assignment', before: '#generateBtn', wrap: true },
    { route: 'exam', before: '#startExamBtn', wrap: true, note: 'used to write the exam questions' },
    { route: 'deck', before: '#deckGenerateBtn', wrap: true },
    { route: 'docresult', before: '#regenerateBtn' },
    { route: 'emr', before: '#dashNewIntakeBtn' },
    { route: 'emr', before: '#editPatientBtn', className: 'rx-model-chip-hero' },
    { route: 'project', before: '#genDropdownWrap' },
  ];
  function route() { return (document.body && document.body.dataset.route) || ''; }
  const isChip = el => !!el && (el.matches('[data-rx-model-chip]') || el.matches('.rx-model-row'));
  function place() {
    const r = route();
    PLACEMENTS.filter(p => p.route === r).forEach(p => {
      const target = document.querySelector(p.before || p.prepend);
      if (!target || (p.before && !target.parentNode)) return;
      if (p.before ? isChip(target.previousElementSibling) : isChip(target.firstElementChild)) return; // already there
      let el = chip({ note: p.note, className: p.className });
      if (p.wrap) {
        const row = document.createElement('div');
        row.className = 'rx-model-row';
        row.innerHTML = '<span class="rx-model-row-label">SI model</span>';
        row.appendChild(el);
        el = row;
      }
      if (p.before) target.parentNode.insertBefore(el, target);
      else target.insertBefore(el, target.firstChild);
    });
  }
  let placeTimer = null;
  function schedulePlace() { clearTimeout(placeTimer); placeTimer = setTimeout(place, 60); }
  function start() {
    schedulePlace();
    window.addEventListener('hashchange', schedulePlace);
    const root = document.getElementById('appRoot') || document.body;
    try { new MutationObserver(schedulePlace).observe(root, { childList: true, subtree: true }); } catch (e) { /* no observer: hashchange still places them */ }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();

  window.RehablixModelChoice = { KEY, FALLBACK, id, model, label, set, onChange, resolve, chip, refreshChips, PLACEMENTS };
})();
