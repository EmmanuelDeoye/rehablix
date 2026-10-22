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
      const [plans, pricing, promo] = await Promise.all(['appConfig/plans', 'appConfig/pricing', 'appConfig/promo'].map(p => db.ref(p).once('value').then(s => s.val())));
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
