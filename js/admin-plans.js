// js/admin-plans.js — admin dashboard: Plans & Pricing (loaded after js/admin.js and js/plan-config.js).
//
// Data written (read live by the web app via js/plan-config.js and by the Android app via PlanConfig.kt):
//   appConfig/plans   = { limits: { <plan>: { tokens4h (-1 = unlimited), dailyCap } }, live: { <plan>: { day, month } }, updatedAt }
//   appConfig/pricing = { <COUNTRY|DEFAULT>: { currency, symbol, flag, name, gateways: [...], student|pro|max: { monthly|yearly: { original, current } } } }
//   appConfig/promo   = { active, title, message, percent, startsAt, endsAt, plans: { student, pro, max }, updatedAt }
// Empty boxes keep the apps' built-in values (shown as greyed placeholders).
document.addEventListener('DOMContentLoaded', () => {
  const db = firebase.database();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };
  const msg = (el, text, ok) => { if (!el) return; el.textContent = text; el.className = 'settings-msg ' + (ok ? 'success' : 'error'); };
  const PC = window.RehablixPlanConfig;

  const PLANS = [['free', 'Free'], ['student', 'Basic'], ['pro', 'Pro'], ['max', 'Max']];
  const PAID = PLANS.slice(1);
  // the apps' built-in values (js/plan-tiers.js, Android PlanTiers / LiveUsage)
  const BUILT_IN_TOKENS = { free: 15000, student: 200000, pro: 20000000, max: null };
  const BUILT_IN_LIVE = { student: { day: 10, month: 100 }, pro: { day: 30, month: 300 }, max: { day: 60, month: 600 } };
  const GATEWAY_NAMES = { paystack: 'Paystack', flutterwave: 'Flutterwave', gpay: 'Google Pay' };

  let pricingSaved = {};   // appConfig/pricing as saved
  let gwOrder = [];        // [{ id, on }] for the country being edited

  document.querySelectorAll('.sidebar-link').forEach((link) => {
    link.addEventListener('click', () => { if (link.dataset.view === 'plans') { $('viewPlans').style.display = 'block'; loadAll(); } });
  });

  const numOrNull = (v) => { const s = String(v == null ? '' : v).trim(); if (!s) return null; const n = Number(s); return isFinite(n) ? n : NaN; };
  const fmt = (n) => (n == null ? '' : (n % 1 !== 0 ? n.toFixed(2) : n.toLocaleString()));

  async function loadAll() {
    try {
      const [plans, pricing, promo, ai] = await Promise.all(['appConfig/plans', 'appConfig/pricing', 'appConfig/promo', 'appConfig/ai'].map(p => db.ref(p).once('value').then(s => s.val())));
      paintAi(ai || {});
      paintLimits((plans && plans.limits) || {}, (plans && plans.live) || {});
      $('ppLimitsUpdated').textContent = plans && plans.updatedAt ? 'Last saved ' + new Date(plans.updatedAt).toLocaleString() : 'Using the built-in limits';
      pricingSaved = pricing || {};
      paintCountryList();
      paintCountry();
      paintPromo(promo || {});
    } catch (e) { msg($('ppLimitsMsg'), 'Could not load the plan settings: ' + e.message + ' (sign in as the admin account first).', false); }
  }

  // ===================================================================== limits
  function paintLimits(limits, live) {
    $('ppLimits').innerHTML = '<tr><th>Plan</th><th>Tokens every 4 hours</th><th>Daily cap (tokens)</th></tr>' + PLANS.map(([id, label]) => {
      const l = limits[id] || {};
      const unl = l.tokens4h === -1 || (l.tokens4h == null && BUILT_IN_TOKENS[id] === null);
      const tok = l.tokens4h != null && l.tokens4h >= 0 ? l.tokens4h : '';
      return `<tr data-plan="${id}"><td><strong>${label}</strong></td>
        <td><input type="number" min="0" step="1000" data-k="tokens4h" value="${tok}" placeholder="${BUILT_IN_TOKENS[id] == null ? 'Unlimited' : BUILT_IN_TOKENS[id].toLocaleString()}" ${unl ? 'disabled' : ''}>
          <label class="pp-unl"><input type="checkbox" data-k="unlimited" ${unl ? 'checked' : ''}> Unlimited</label></td>
        <td><input type="number" min="0" step="1000" data-k="dailyCap" value="${l.dailyCap > 0 ? l.dailyCap : ''}" placeholder="No cap"></td></tr>`;
    }).join('');
    $('ppLimits').querySelectorAll('input[data-k="unlimited"]').forEach(cb => cb.addEventListener('change', () => {
      const box = cb.closest('td').querySelector('input[data-k="tokens4h"]');
      box.disabled = cb.checked; if (cb.checked) box.value = '';
    }));
    $('ppLive').innerHTML = '<tr><th>Plan</th><th>Minutes per day</th><th>Minutes per month</th></tr>' + PAID.map(([id, label]) => {
      const v = live[id] || {};
      return `<tr data-plan="${id}"><td><strong>${label}</strong></td>
        <td><input type="number" min="0" step="1" data-k="day" value="${v.day != null ? v.day : ''}" placeholder="${BUILT_IN_LIVE[id].day}"></td>
        <td><input type="number" min="0" step="1" data-k="month" value="${v.month != null ? v.month : ''}" placeholder="${BUILT_IN_LIVE[id].month}"></td></tr>`;
    }).join('');
  }

  $('ppSaveLimits') && $('ppSaveLimits').addEventListener('click', async () => {
    const limits = {}, live = {};
    for (const [id, label] of PLANS) {
      const row = $('ppLimits').querySelector(`tr[data-plan="${id}"]`);
      const unl = row.querySelector('input[data-k="unlimited"]').checked;
      const tok = numOrNull(row.querySelector('input[data-k="tokens4h"]').value);
      const cap = numOrNull(row.querySelector('input[data-k="dailyCap"]').value);
      if (Number.isNaN(tok) || (tok != null && tok < 0) || Number.isNaN(cap) || (cap != null && cap < 0)) { msg($('ppLimitsMsg'), `${label}: the numbers must be 0 or more.`, false); return; }
      const entry = {};
      // (Max is unlimited by default: unticking it needs a number)
      if (unl) { if (BUILT_IN_TOKENS[id] !== null) entry.tokens4h = -1; }
      else if (tok != null) entry.tokens4h = Math.floor(tok);
      else if (BUILT_IN_TOKENS[id] === null) { msg($('ppLimitsMsg'), `${label}: type the tokens every 4 hours, or tick Unlimited.`, false); return; }
      if (cap) entry.dailyCap = Math.floor(cap);
      if (entry.tokens4h != null && entry.dailyCap && entry.tokens4h >= 0 && entry.dailyCap < entry.tokens4h) {
        if (!window.confirm(`${label}: the daily cap (${entry.dailyCap.toLocaleString()}) is lower than one 4-hour window (${entry.tokens4h.toLocaleString()}). Save anyway?`)) return;
      }
      if (Object.keys(entry).length) limits[id] = entry;
    }
    for (const [id, label] of PAID) {
      const row = $('ppLive').querySelector(`tr[data-plan="${id}"]`);
      const day = numOrNull(row.querySelector('input[data-k="day"]').value), month = numOrNull(row.querySelector('input[data-k="month"]').value);
      if (Number.isNaN(day) || Number.isNaN(month) || (day != null && day < 0) || (month != null && month < 0)) { msg($('ppLimitsMsg'), `${label} Live: the minutes must be 0 or more.`, false); return; }
      const e = {};
      if (day != null) e.day = Math.floor(day);
      if (month != null) e.month = Math.floor(month);
      if (Object.keys(e).length) live[id] = e;
    }
    if (!window.confirm('Save these limits? They apply to every user straight away.')) return;
    try {
      const cfg = { limits, live, updatedAt: Date.now() };
      await db.ref('appConfig/plans').set(cfg);
      msg($('ppLimitsMsg'), 'Saved. The apps use these limits now.', true);
      $('ppLimitsUpdated').textContent = 'Last saved ' + new Date(cfg.updatedAt).toLocaleString();
    } catch (e) { msg($('ppLimitsMsg'), 'Could not save: ' + e.message, false); }
  });

  // ===================================================================== AI limits & costs
  // appConfig/ai, read by the server (rehablix-android/backend/functions/ai-config.js: its DEFAULTS are the built-in
  // values below, keep in step) and by both apps to show what is left. -1 = unlimited, 0 = none.
  const AI_PLAN_COLS = [
    ['blixDaily', 'Blix 360 / day'], ['usdDaily', 'OpenAI $ / day'], ['visionDaily', 'Images / day'],
    ['searchDaily', 'Web searches / day'], ['motionMonthly', 'Motion AI / month'], ['audioMinutesMonthly', 'Audio min / month']
  ];
  const AI_MODELS = [
    ['blix', 'Blix 360 (Pro, and Max with Deep off)', 'gpt-5-mini'], ['blixDeep', 'Blix 360 Deep (Max)', 'gpt-5'],
    ['blixFallback', 'Blix stand-in (when Blix fails)', 'gpt-4.1'],
    ['vision', 'Lixa images & video — paid plans', 'gpt-4.1-mini'], ['visionFree', 'Lixa images & video — Free', 'gpt-4.1-mini'],
    ['motion', 'Motion / Gait AI interpretation', 'gpt-4.1-mini'],
    ['openaiText', 'Tools\' long OpenAI text — paid plans', 'gpt-4.1'], ['openaiTextFree', 'Tools\' long OpenAI text — Free', 'gpt-4.1-mini'],
    ['light', 'Short jobs: titles, suggestions, labels', 'gpt-4.1-nano'],
    ['fallback', 'DeepSeek stand-in (paid plans)', 'gpt-4.1-mini'], ['search', 'Web search', 'gpt-5-search-api'],
    ['transcribe', 'Audio tool transcription — paid plans', 'gpt-4o-mini-transcribe'], ['transcribeFree', 'Audio tool transcription — Free trial', 'whisper-1'],
    ['agentTranscribe', 'Lixa agent voice', 'gpt-4o-mini-transcribe']
  ];
  // Models never used (costly or retired); the server ignores them too (ai-config.js BLOCKED). The gpt-4o transcribers are fine.
  const BLOCKED_MODEL = /^(o1|o3)(-|$)|^gpt-5\.4|^gpt-4o(?!-(mini-)?transcribe$)/i;
  const AI_CAPS = [
    ['basal', 'Basal 100', 5000], ['deepseek', 'Corpus 101', 9000], ['reasoner', 'Medulla 200 (thinking + answer)', 32768],
    ['blix', 'Blix 360 (thinking + answer); GPT-4.1 on plans with Blix', 32768], ['blixMin', 'Blix 360: least room for thinking + answer', 16000],
    ['openai', 'GPT-4.1 — paid plans without Blix', 16384],
    ['openaiFree', 'GPT-4.1 mini — Free', 4000], ['fallback', 'DeepSeek stand-in', 3000], ['search', 'Web search', 8000], ['motion', 'Motion AI interpretation', 1500],
    ['light', 'Short jobs (a request asking for this many or fewer is one)', 400]
  ];
  const AI_PRICES = {
    'gpt-5': { in: 1.25, cached: 0.125, out: 10 }, 'gpt-5-mini': { in: 0.25, cached: 0.025, out: 2 }, 'gpt-5-nano': { in: 0.05, cached: 0.005, out: 0.4 },
    'gpt-4.1': { in: 2, cached: 0.5, out: 8 }, 'gpt-4.1-mini': { in: 0.4, cached: 0.1, out: 1.6 }, 'gpt-4.1-nano': { in: 0.1, cached: 0.025, out: 0.4 },
    'gpt-5-search-api': { in: 1.25, cached: 0.125, out: 10, perCall: 0.01 },
    'deepseek-v4-flash': { in: 0.27, cached: 0.07, out: 1.1 }, 'deepseek-reasoner': { in: 0.55, cached: 0.14, out: 2.19 },
    'whisper-1': { perMinute: 0.006 }, 'gpt-4o-transcribe': { perMinute: 0.006, audioIn: 6, in: 2.5, out: 10 },
    'gpt-4o-mini-transcribe': { perMinute: 0.003, audioIn: 3, in: 1.25, out: 5 }, 'gpt-image-1': { perCall: 0.011 }
  };
  const PRICE_COLS = [['in', 'Input / 1M'], ['cached', 'Cached / 1M'], ['out', 'Output / 1M'], ['audioIn', 'Audio in / 1M'], ['perCall', 'Per call'], ['perMinute', 'Per minute']];
  const AI_OTHER = { timezone: 'Africa/Lagos', verifyEmailFrom: '2026-10-28T00:00:00Z', audioTokensPerMinute: 1000 };
  const dbKey = (model) => model.replace(/\./g, '_');           // (database keys cannot hold '.')
  const fromDbKey = (key) => key.replace(/_/g, '.');

  function paintAi(ai) {
    const D = PC.AI_DEFAULTS.plans;
    const plansSet = ai.plans || {};
    $('ppAiPlans').innerHTML = '<tr><th>Plan</th>' + AI_PLAN_COLS.map(c => `<th>${c[1]}</th>`).join('') + '</tr>' + PLANS.map(([id, label]) => {
      const set = plansSet[id] || {};
      return `<tr data-plan="${id}"><td><strong>${label}</strong></td>` + AI_PLAN_COLS.map(([k]) => {
        const d = D[id][k];
        return `<td><input type="number" min="-1" step="${k === 'usdDaily' ? '0.01' : '1'}" data-k="${k}" value="${set[k] != null ? set[k] : ''}" placeholder="${d === -1 ? 'Unlimited' : d}"></td>`;
      }).join('') + '</tr>';
    }).join('');
    const models = ai.models || {};
    $('ppAiModels').innerHTML = '<tr><th>Job</th><th>Model</th></tr>' + AI_MODELS.map(([k, label, d]) =>
      `<tr><td>${esc(label)}</td><td><input type="text" data-k="${k}" value="${esc(models[k] || '')}" placeholder="${esc(d)}" spellcheck="false" autocomplete="off"></td></tr>`).join('');
    const caps = ai.caps || {};
    $('ppAiCaps').innerHTML = '<tr><th>Model</th><th>Most tokens per answer</th></tr>' + AI_CAPS.map(([k, label, d]) =>
      `<tr><td>${esc(label)}</td><td><input type="number" min="1" step="100" data-k="${k}" value="${caps[k] != null ? caps[k] : ''}" placeholder="${d.toLocaleString()}"></td></tr>`).join('');
    const prices = ai.prices || {};
    const priceModels = Object.keys(AI_PRICES).concat(Object.keys(prices).map(fromDbKey).filter(m => !AI_PRICES[m]))
      .concat(AI_MODELS.map(m => (models[m[0]] || '').trim()).filter(m => m && !AI_PRICES[m]));
    const uniq = priceModels.filter((m, i) => priceModels.indexOf(m) === i);
    $('ppAiPrices').innerHTML = '<tr><th>Model</th>' + PRICE_COLS.map(c => `<th>${c[1]}</th>`).join('') + '</tr>' + uniq.map(m => {
      const set = prices[dbKey(m)] || {}, d = AI_PRICES[m] || {};
      return `<tr data-model="${esc(m)}"><td><code>${esc(m)}</code></td>` + PRICE_COLS.map(([k]) =>
        `<td><input type="number" min="0" step="0.001" data-k="${k}" value="${set[k] != null ? set[k] : ''}" placeholder="${d[k] != null ? d[k] : '—'}"></td>`).join('') + '</tr>';
    }).join('');
    $('ppAiOther').innerHTML =
      `<tr><td>Server clock (days and months reset at midnight here)</td><td><input type="text" id="ppAiTz" value="${esc(ai.timezone || '')}" placeholder="${AI_OTHER.timezone}" spellcheck="false"></td></tr>` +
      `<tr><td>Email accounts made from this date must verify their email</td><td><input type="datetime-local" id="ppAiVerifyFrom" value="${ai.verifyEmailFrom ? toLocalInput(Date.parse(ai.verifyEmailFrom)) : ''}"><div class="settings-hint">Empty: ${new Date(AI_OTHER.verifyEmailFrom).toLocaleString()}</div></td></tr>` +
      `<tr><td>Tokens counted per transcribed audio minute</td><td><input type="number" min="1" step="100" id="ppAiAudioTokens" value="${ai.audioTokensPerMinute != null ? ai.audioTokensPerMinute : ''}" placeholder="${AI_OTHER.audioTokensPerMinute}"></td></tr>` +
      `<tr><td>Lowest plan with Blix 360 Deep</td><td><select id="ppAiDeepPlan">${PLANS.map(([id, label]) => `<option value="${id}"${((ai.minPlan && ai.minPlan.blixDeep) || 'max') === id ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select><div class="settings-hint">Deep runs Blix on the Deep model above; everyone else's Blix uses the Blix 360 model.</div></td></tr>`;
    $('ppAiUpdated').textContent = ai.updatedAt ? 'Last saved ' + new Date(ai.updatedAt).toLocaleString() : 'Using the built-in AI limits';
  }

  $('ppSaveAi') && $('ppSaveAi').addEventListener('click', async () => {
    const cfg = { plans: {}, models: {}, caps: {}, prices: {} };
    for (const [id, label] of PLANS) {
      const row = $('ppAiPlans').querySelector(`tr[data-plan="${id}"]`);
      const entry = {};
      for (const [k, colLabel] of AI_PLAN_COLS) {
        const v = numOrNull(row.querySelector(`input[data-k="${k}"]`).value);
        if (v == null) continue;
        if (Number.isNaN(v) || (v < 0 && v !== -1)) { msg($('ppAiMsg'), `${label} — ${colLabel}: use -1 (unlimited), 0 (none) or a number above 0.`, false); return; }
        entry[k] = k === 'usdDaily' ? Math.round(v * 100) / 100 : Math.floor(v);
      }
      if (Object.keys(entry).length) cfg.plans[id] = entry;
    }
    for (const [k, label] of AI_MODELS) {
      const v = $('ppAiModels').querySelector(`input[data-k="${k}"]`).value.trim();
      if (!v) continue;
      if (!/^[a-z0-9][a-z0-9.\-]*$/i.test(v)) { msg($('ppAiMsg'), `${label}: "${v}" is not a model name.`, false); return; }
      if (BLOCKED_MODEL.test(v)) { msg($('ppAiMsg'), `${label}: "${v}" is not used by Rehablix (too costly or retired). Pick a cheaper model.`, false); return; }
      cfg.models[k] = v;
    }
    for (const [k, label] of AI_CAPS) {
      const v = numOrNull($('ppAiCaps').querySelector(`input[data-k="${k}"]`).value);
      if (v == null) continue;
      if (Number.isNaN(v) || v < 1) { msg($('ppAiMsg'), `${label}: the ceiling must be 1 or more.`, false); return; }
      cfg.caps[k] = Math.floor(v);
    }
    let bad = null;
    $('ppAiPrices').querySelectorAll('tr[data-model]').forEach(row => {
      const e = {};
      row.querySelectorAll('input[data-k]').forEach(inp => {
        const v = numOrNull(inp.value);
        if (v == null) return;
        if (Number.isNaN(v) || v < 0) { bad = `${row.dataset.model}: prices must be 0 or more.`; return; }
        e[inp.dataset.k] = v;
      });
      if (Object.keys(e).length) cfg.prices[dbKey(row.dataset.model)] = e;
    });
    if (bad) { msg($('ppAiMsg'), bad, false); return; }
    const tz = $('ppAiTz').value.trim();
    if (tz) {
      try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); } catch (e) { msg($('ppAiMsg'), `"${tz}" is not a time zone (for example Africa/Lagos).`, false); return; }
      cfg.timezone = tz;
    }
    const from = fromLocalInput($('ppAiVerifyFrom').value);
    if (from) cfg.verifyEmailFrom = new Date(from).toISOString();
    const at = numOrNull($('ppAiAudioTokens').value);
    if (at != null) { if (Number.isNaN(at) || at < 1) { msg($('ppAiMsg'), 'Tokens per audio minute must be 1 or more.', false); return; } cfg.audioTokensPerMinute = Math.floor(at); }
    const deepPlan = $('ppAiDeepPlan') && $('ppAiDeepPlan').value;
    if (deepPlan && deepPlan !== 'max') cfg.minPlan = { blixDeep: deepPlan };
    ['plans', 'models', 'caps', 'prices'].forEach(k => { if (!Object.keys(cfg[k]).length) delete cfg[k]; });
    // the most consequential change gets its own warning
    const free = (cfg.plans && cfg.plans.free) || {};
    if (free.usdDaily === -1 || free.blixDaily === -1 || free.visionDaily === -1) {
      if (!window.confirm('Free accounts would get UNLIMITED OpenAI use with these settings. Are you sure?')) return;
    }
    if (!window.confirm('Save these AI limits? The server applies them to every user within a minute.')) return;
    try {
      cfg.updatedAt = Date.now();
      await db.ref('appConfig/ai').set(cfg);
      msg($('ppAiMsg'), 'Saved. The server uses these limits within a minute.', true);
      paintAi(cfg);
    } catch (e) { msg($('ppAiMsg'), 'Could not save: ' + e.message, false); }
  });

  // ===================================================================== promo
  const toLocalInput = (ms) => { if (!ms || !isFinite(ms)) return ''; const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const fromLocalInput = (s) => (s ? new Date(s).getTime() : null);

  function paintPromo(p) {
    $('ppPromoOn').checked = p.active === true;
    $('ppPromoTitle').value = p.title || '';
    $('ppPromoMessage').value = p.message || '';
    $('ppPromoPercent').value = p.percent || '';
    $('ppPromoStart').value = toLocalInput(p.startsAt || Date.now());
    $('ppPromoEnd').value = toLocalInput(p.endsAt || (Date.now() + 7 * 86400000));
    const plans = p.plans || { student: true, pro: true, max: true };
    $('ppPromoStudent').checked = plans.student === true; $('ppPromoPro').checked = plans.pro === true; $('ppPromoMax').checked = plans.max === true;
    $('ppPromoUpdated').textContent = p.updatedAt ? 'Last saved ' + new Date(p.updatedAt).toLocaleString() : 'No promo saved yet';
    paintPromoState();
  }

  function paintPromoState() {
    const on = $('ppPromoOn').checked;
    const start = fromLocalInput($('ppPromoStart').value), end = fromLocalInput($('ppPromoEnd').value), now = Date.now();
    const state = !on ? 'Off — no promo' : (start && now < start) ? 'Scheduled — starts ' + new Date(start).toLocaleString() : (end && now >= end) ? 'Ended' : 'ON — running now';
    $('ppPromoState').textContent = state;
    $('ppPromoState').style.color = on && state.startsWith('ON') ? '#b45309' : '';
    // what users in Nigeria and elsewhere will see
    const pct = Number($('ppPromoPercent').value);
    const prev = $('ppPromoPreview');
    if (!(pct > 0 && pct < 100)) { prev.textContent = 'Type a discount to see the promo prices.'; return; }
    const lines = ['NG', 'US'].map(code => {
      const pr = PC.pricingFor(code);
      const parts = [['student', 'Basic'], ['pro', 'Pro'], ['max', 'Max']].filter(([id]) => $({ student: 'ppPromoStudent', pro: 'ppPromoPro', max: 'ppPromoMax' }[id]).checked)
        .map(([id, label]) => `${label} ${pr.symbol}${fmt(pr[id].monthly.current)} → <strong>${pr.symbol}${fmt(PC.promoPrice(pr[id].monthly.current, pct))}</strong>`);
      return `${pr.flag} ${esc(pr.name)} (monthly): ${parts.join(' · ') || 'no plan ticked'}`;
    });
    prev.innerHTML = lines.join('<br>');
  }
  ['ppPromoOn', 'ppPromoPercent', 'ppPromoStart', 'ppPromoEnd', 'ppPromoStudent', 'ppPromoPro', 'ppPromoMax'].forEach(id => $(id) && $(id).addEventListener('input', paintPromoState));
  ['ppPromoOn', 'ppPromoStudent', 'ppPromoPro', 'ppPromoMax'].forEach(id => $(id) && $(id).addEventListener('change', paintPromoState));

  $('ppSavePromo') && $('ppSavePromo').addEventListener('click', async () => {
    const active = $('ppPromoOn').checked;
    const percent = Number($('ppPromoPercent').value);
    const startsAt = fromLocalInput($('ppPromoStart').value), endsAt = fromLocalInput($('ppPromoEnd').value);
    const plans = { student: $('ppPromoStudent').checked, pro: $('ppPromoPro').checked, max: $('ppPromoMax').checked };
    const title = $('ppPromoTitle').value.trim();
    if (active) {
      if (!title) { msg($('ppPromoMsg'), 'Give the promo a name (it is shown to users).', false); return; }
      if (!(percent >= 1 && percent <= 90)) { msg($('ppPromoMsg'), 'The discount must be between 1% and 90%.', false); return; }
      if (!startsAt || !endsAt || endsAt <= startsAt) { msg($('ppPromoMsg'), 'Set when it starts and ends (the end after the start).', false); return; }
      if (endsAt <= Date.now()) { msg($('ppPromoMsg'), 'The end time has already passed.', false); return; }
      if (!plans.student && !plans.pro && !plans.max) { msg($('ppPromoMsg'), 'Tick at least one plan.', false); return; }
      if (!window.confirm(`Turn on "${title}" (${percent}% off) from ${new Date(startsAt).toLocaleString()} to ${new Date(endsAt).toLocaleString()}? Users are charged the promo price while it runs.`)) return;
    }
    const cfg = { active, title, message: $('ppPromoMessage').value.trim(), percent: percent || 0, startsAt: startsAt || 0, endsAt: endsAt || 0, plans, updatedAt: Date.now() };
    try {
      await db.ref('appConfig/promo').set(cfg);
      msg($('ppPromoMsg'), active ? 'Saved. The subscription page shows it now (at the start time, if later).' : 'Saved. No promo is shown.', true);
      $('ppPromoUpdated').textContent = 'Last saved ' + new Date(cfg.updatedAt).toLocaleString();
      paintPromoState();
    } catch (e) { msg($('ppPromoMsg'), 'Could not save: ' + e.message, false); }
  });

  // ===================================================================== prices by country
  function codes() {
    const built = Object.keys(PC.defaultCountryPricing());
    const added = Object.keys(pricingSaved).filter(c => c !== 'DEFAULT' && built.indexOf(c) < 0);
    return built.concat(added.sort(), ['DEFAULT']);
  }
  function labelOf(code) {
    if (code === 'DEFAULT') return '🌍 International (every other country)';
    const p = PC.pricingFor(code), saved = pricingSaved[code];
    return `${(saved && saved.flag) || p.flag} ${(saved && saved.name) || p.name} (${code})`;
  }
  function paintCountryList() {
    const sel = $('ppCountry'), keep = sel.value;
    sel.innerHTML = codes().map(c => `<option value="${c}">${esc(labelOf(c))}${pricingSaved[c] ? ' — changed' : ''}</option>`).join('') + '<option value="__new">+ Add a country…</option>';
    sel.value = keep && (codes().indexOf(keep) >= 0 || keep === '__new') ? keep : 'NG';
  }
  /** The built-in prices for a code (DEFAULT, or the International ones for a new country). */
  function builtIn(code) {
    const all = PC.defaultCountryPricing();
    const b = all[code] || PC.defaultPricing();
    if (!b.max) b.max = PC.triple(b.pro);
    return b;
  }
  function paintCountry() {
    const code = $('ppCountry').value;
    const isNew = code === '__new';
    $('ppNewCodeWrap').style.display = isNew ? '' : 'none';
    const base = builtIn(isNew ? 'DEFAULT' : code);
    const saved = isNew ? {} : (pricingSaved[code] || {});
    $('ppCurrency').value = saved.currency || (isNew ? '' : base.currency);
    $('ppSymbol').value = saved.symbol || (isNew ? '' : base.symbol);
    $('ppName').value = saved.name || (isNew ? '' : base.name);
    $('ppFlag').value = saved.flag || (isNew ? '' : base.flag);
    const cell = (plan, billing, kind) => {
      const v = saved[plan] && saved[plan][billing] && saved[plan][billing][kind];
      const ph = base[plan][billing][kind];
      return `<td><input type="number" min="0" step="0.01" data-p="${plan}" data-b="${billing}" data-k="${kind}" value="${v != null ? v : ''}" placeholder="${plan === 'max' && !(saved.max) ? '3 × Pro' : fmt(ph)}"></td>`;
    };
    $('ppPrices').innerHTML = '<tr><th>Plan</th><th>Monthly slashed</th><th>Monthly final</th><th>Yearly slashed</th><th>Yearly final</th></tr>' +
      [['student', 'Basic'], ['pro', 'Pro'], ['max', 'Max']].map(([p, label]) => `<tr><td><strong>${label}</strong></td>${cell(p, 'monthly', 'original')}${cell(p, 'monthly', 'current')}${cell(p, 'yearly', 'original')}${cell(p, 'yearly', 'current')}</tr>`).join('');
    const gws = Array.isArray(saved.gateways) ? saved.gateways : (saved.gateways ? Object.values(saved.gateways) : null);
    const on = gws && gws.length ? gws : base.gateways;
    gwOrder = on.filter(g => GATEWAY_NAMES[g]).map(id => ({ id, on: true })).concat(Object.keys(GATEWAY_NAMES).filter(g => on.indexOf(g) < 0).map(id => ({ id, on: false })));
    paintGateways();
    $('ppCountryState').textContent = isNew ? 'A new country: fill in its currency, prices and payment methods.' : pricingSaved[code] ? 'Changed from the built-in prices' : 'Built-in prices (empty boxes keep them)';
    $('ppResetCountry').disabled = isNew || !pricingSaved[code];
    msg($('ppCountryMsg'), '', true);
  }
  function paintGateways() {
    $('ppGateways').innerHTML = gwOrder.map((g, i) => `<div class="pp-gw" data-i="${i}">
      <input type="checkbox" data-act="on" ${g.on ? 'checked' : ''}> <b>${GATEWAY_NAMES[g.id]}</b>
      <button type="button" data-act="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up">▲</button>
      <button type="button" data-act="down" ${i === gwOrder.length - 1 ? 'disabled' : ''} aria-label="Move down">▼</button></div>`).join('');
  }
  $('ppGateways') && $('ppGateways').addEventListener('click', (e) => {
    const row = e.target.closest('.pp-gw'); if (!row) return;
    const i = Number(row.dataset.i), act = e.target.dataset.act;
    if (act === 'on') { gwOrder[i].on = e.target.checked; return; }
    const j = act === 'up' ? i - 1 : act === 'down' ? i + 1 : -1;
    if (j < 0 || j >= gwOrder.length) return;
    const t = gwOrder[i]; gwOrder[i] = gwOrder[j]; gwOrder[j] = t;
    paintGateways();
  });
  $('ppCountry') && $('ppCountry').addEventListener('change', paintCountry);

  $('ppSaveCountry') && $('ppSaveCountry').addEventListener('click', async () => {
    let code = $('ppCountry').value;
    const isNew = code === '__new';
    if (isNew) {
      code = $('ppNewCode').value.trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) { msg($('ppCountryMsg'), 'Type the two-letter country code (for example EG for Egypt).', false); return; }
      if (codes().indexOf(code) >= 0) { msg($('ppCountryMsg'), code + ' is already in the list: choose it there.', false); return; }
    }
    const entry = {};
    const text = (id, key, re) => { const v = $(id).value.trim(); if (v) entry[key] = v; return !v || !re || re.test(v); };
    if (!text('ppCurrency', 'currency', /^[A-Za-z]{3}$/)) { msg($('ppCountryMsg'), 'The currency code is three letters (NGN, USD, …).', false); return; }
    if (entry.currency) entry.currency = entry.currency.toUpperCase();
    text('ppSymbol', 'symbol'); text('ppName', 'name'); text('ppFlag', 'flag');
    if (isNew && (!entry.currency || !entry.symbol || !entry.name)) { msg($('ppCountryMsg'), 'A new country needs its currency code, symbol and name.', false); return; }
    let bad = null;
    $('ppPrices').querySelectorAll('input[data-p]').forEach(inp => {
      const v = numOrNull(inp.value);
      if (v == null) return;
      if (Number.isNaN(v) || v <= 0) { bad = 'Prices must be more than 0.'; return; }
      const p = inp.dataset.p, b = inp.dataset.b, k = inp.dataset.k;
      entry[p] = entry[p] || {}; entry[p][b] = entry[p][b] || {};
      entry[p][b][k] = Math.round(v * 100) / 100;
    });
    if (bad) { msg($('ppCountryMsg'), bad, false); return; }
    // the final price is never above the slashed one (each with the value it will really have)
    const base = builtIn(isNew ? 'DEFAULT' : code);
    for (const p of ['student', 'pro', 'max']) for (const b of ['monthly', 'yearly']) {
      const e = entry[p] && entry[p][b];
      if (!e) continue;
      const cur = e.current != null ? e.current : base[p][b].current, orig = e.original != null ? e.original : base[p][b].original;
      if (cur > orig) { msg($('ppCountryMsg'), `${p === 'student' ? 'Basic' : p === 'pro' ? 'Pro' : 'Max'} ${b}: the final price is higher than the slashed price.`, false); return; }
    }
    if (isNew && !['student', 'pro'].every(p => entry[p] && ['monthly', 'yearly'].every(b => entry[p][b] && entry[p][b].current))) {
      msg($('ppCountryMsg'), 'A new country needs at least the final Basic and Pro prices, monthly and yearly.', false); return;
    }
    const gateways = gwOrder.filter(g => g.on).map(g => g.id);
    if (!gateways.length) { msg($('ppCountryMsg'), 'Leave at least one payment method ticked.', false); return; }
    entry.gateways = gateways;
    if (!window.confirm(`Save the prices for ${code === 'DEFAULT' ? 'International' : code}? Users there see (and pay) them straight away.`)) return;
    try {
      await db.ref('appConfig/pricing/' + code).set(entry);
      pricingSaved[code] = entry;
      paintCountryList();
      $('ppCountry').value = code;
      paintCountry();
      msg($('ppCountryMsg'), 'Saved. The subscription page shows these prices now.', true);
    } catch (e) { msg($('ppCountryMsg'), 'Could not save: ' + e.message, false); }
  });

  $('ppResetCountry') && $('ppResetCountry').addEventListener('click', async () => {
    const code = $('ppCountry').value;
    if (!pricingSaved[code]) return;
    if (!window.confirm(`Remove your prices for ${code} and go back to the built-in ones${PC.defaultCountryPricing()[code] || code === 'DEFAULT' ? '' : ' (this country then uses the International prices)'}?`)) return;
    try {
      await db.ref('appConfig/pricing/' + code).remove();
      delete pricingSaved[code];
      paintCountryList(); paintCountry();
      msg($('ppCountryMsg'), 'Back to the built-in prices.', true);
    } catch (e) { msg($('ppCountryMsg'), 'Could not reset: ' + e.message, false); }
  });
});
