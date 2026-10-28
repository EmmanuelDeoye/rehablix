// js/plan-tiers.js — shared plan-tier + AI-model constants and the
// per-4-hour-window token quota, used by js/plan.js (feature gating),
// js/ask.js (model picker + quota enforcement) and the subscription view.

(function () {
  const PLAN_LEVEL = { free: 0, student: 1, pro: 2, max: 3 };
  const PLAN_LABELS = { free: 'Free', student: 'Basic', pro: 'Pro', max: 'Max' };
  // Order the tiers actually upgrade through, for "Upgrade to <next>" copy.
  const PLAN_ORDER = ['free', 'student', 'pro', 'max'];

  // Token budget per 4-hour window. null = unlimited (Max plan only).
  // EMR UPGRADE (item 9): free lowered 20000 -> 15000 per your request
  // ("tokens are fast spent") — student/pro/max left unchanged since no
  // specific numbers were given for those.
  const DEFAULT_TOKEN_BUDGET = {
    free: 15000,
    student: 200000,     // ~13x Free
    pro: 20000000,       // 100x Basic (per spec — effectively unlimited in practice)
    max: null
  };
  // What every page reads: the built-in budget, or the one set on the admin page
  // (admin.html > Plans & Pricing, via js/plan-config.js), looked up each time.
  const PLAN_TOKEN_BUDGET = {};
  Object.keys(DEFAULT_TOKEN_BUDGET).forEach(plan => Object.defineProperty(PLAN_TOKEN_BUDGET, plan, {
    enumerable: true,
    get: () => (window.RehablixPlanConfig ? window.RehablixPlanConfig.tokenBudget(plan, DEFAULT_TOKEN_BUDGET[plan]) : DEFAULT_TOKEN_BUDGET[plan])
  }));
  const dailyCap = plan => (window.RehablixPlanConfig ? window.RehablixPlanConfig.dailyCap(plan) : null);

  // ---- The day's cap (set on the admin page; none by default) ----
  // users/{uid}/dailyQuota = { day: 'YYYY-MM-DD' (the device's own calendar day), tokensUsed }; a new day starts from 0.
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function nextMidnight() { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); }
  async function dailyUsed(uid) {
    try {
      const v = (await firebase.database().ref(`users/${uid}/dailyQuota`).once('value')).val() || {};
      return v.day === today() ? (Number(v.tokensUsed) || 0) : 0;
    } catch (e) { return 0; }
  }

  const QUOTA_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

  // Models, ranked highest -> lowest capability/cost. `weight` scales how
  // fast a model drains the shared per-plan token budget relative to its
  // raw token usage (Blix 360 costs 4x its actual tokens against the
  // budget, Basal 100 costs half).
  //
  // `tagline` is the few-word label the model picker shows; strength/weakness
  // are the longer notes kept for anywhere that wants the detail.
  //
  // Each tier is deliberately distinct on four axes, not just a maxTokens
  // number: `apiModel`/`provider` (the actual underlying model — Basal and
  // Corpus used to both silently call the exact same DeepSeek model, which
  // made them identical in every way that mattered), `temperature`/`top_p`
  // (how exploratory vs. deterministic responses are), `responseStyle` (a
  // system-prompt instruction that genuinely changes reasoning depth —
  // Basal is told to answer briefly with no elaboration, Blix is told to
  // reason exhaustively), and `maxTokens` (the output ceiling, strictly
  // increasing Basal < Corpus < Medulla < Blix per the required hierarchy).
  const MODELS = [
    {
      id: 'blix360', label: 'Blix 360', rank: 1,
      // An OpenAI reasoning model: thinks before it answers and sees images (GPT-4.1 answers if it cannot be reached:
      // js/ai-transport.js). 'gpt-5' here only says "Blix": the server runs it on its Blix model (gpt-5-mini; Max's Deep
      // switch: gpt-5), both editable on the admin page.
      // Charged at 2x what each call really costs: thinking included, repeated (cached) prompt text at a tenth (ai-transport.js ACTUAL_BILLING).
      provider: 'openai', apiModel: 'gpt-5', endpoint: 'https://api.openai.com/v1',
      maxTokens: 20000, weight: 2, minPlan: 'pro',
      temperature: 0.75, top_p: 0.95,
      responseStyle: 'Think deeply before answering. Consider edge cases, differential possibilities, and clinical nuance; structure complex answers with headings and sub-points. Depth and completeness matter more than brevity — this is the mode for genuinely hard or multi-part cases.',
      tagline: 'Strongest · thinks · sees images',
      strength: 'The strongest model: it thinks before it answers, understands images, and handles the hardest multi-step cases and app work best, with the highest token ceiling for long, thorough answers.',
      weakness: 'Slowest and most expensive: its thinking counts too, so it drains your token budget fastest.'
    },
    {
      id: 'medulla200', label: 'Medulla 200', rank: 2,
      provider: 'deepseek', apiModel: 'deepseek-reasoner', endpoint: 'https://api.deepseek.com/v1',
      maxTokens: 14000, weight: 2, minPlan: 'student',
      temperature: 0.6, top_p: 0.9,
      responseStyle: 'Reason step by step before giving your final answer — briefly show the logical/clinical-reasoning chain that gets you there, then state a clear conclusion. Prioritize rigor for multi-part or differential-reasoning questions.',
      tagline: 'Step-by-step reasoning',
      strength: 'A dedicated chain-of-thought reasoning model — strong step-by-step logic for multi-part clinical questions, with a generous token ceiling for working through them.',
      weakness: 'Text-only — no image support — and slower than Corpus/Basal since it reasons before answering; its thinking counts against your token budget too.'
    },
    {
      id: 'corpus101', label: 'Corpus 101', rank: 3,
      provider: 'deepseek', apiModel: 'deepseek-v4-flash', endpoint: 'https://api.deepseek.com/v1',
      maxTokens: 9000, weight: 1, minPlan: 'free',
      temperature: 0.7, top_p: 0.9,
      responseStyle: 'Give clear, well-organized, moderately detailed answers — balance thoroughness with readability. This is the everyday, general-purpose mode: enough room to be complete without the deep multi-step reasoning of Medulla or Blix.',
      tagline: 'Everyday balance',
      strength: 'Balanced everyday chat with real room for detail — the default for most questions.',
      weakness: 'Less rigorous step-by-step reasoning than Medulla/Blix on long, complex tasks.'
    },
    {
      id: 'basal100', label: 'Basal 100', rank: 4,
      provider: 'deepseek', apiModel: 'deepseek-v4-flash', endpoint: 'https://api.deepseek.com/v1',
      maxTokens: 5000, weight: 0.5, minPlan: 'free',
      temperature: 0.4, top_p: 0.85,
      responseStyle: 'Be concise and direct. Answer in as few words as possible while staying accurate — skip elaboration, background, and extra examples unless explicitly asked for more.',
      tagline: 'Fast & brief',
      strength: 'Fastest and cheapest — short, direct answers for quick, simple questions.',
      weakness: 'Deliberately brief with the smallest token ceiling of the four — not built for long or multi-part reasoning.'
    }
  ];

  function getModel(id) {
    return MODELS.find(m => m.id === id) || MODELS[2]; // default: Corpus 101
  }

  function isModelUnlocked(modelId, plan) {
    const model = getModel(modelId);
    return (PLAN_LEVEL[plan] || 0) >= (PLAN_LEVEL[model.minPlan] || 0);
  }

  function nextPlan(plan) {
    const idx = PLAN_ORDER.indexOf(plan);
    if (idx === -1 || idx === PLAN_ORDER.length - 1) return null;
    return PLAN_ORDER[idx + 1];
  }

  // Rough client-side token estimate (~4 chars/token) — used instead of
  // relying on provider-reported `usage`, since not every configured
  // endpoint reliably returns it in streaming mode.
  function estimateTokens(text) {
    return Math.ceil((text || '').length / 4);
  }

  // ---- Server metering (window.REHABLIX_SERVER_AI): the server counts every AI call ----
  // at aiUsage/{uid} = { day: { key, usd, blix, vision, search, tokens }, month: { key, motion, audioSec },
  // window: { start, tokens } } (rehablix-android/backend/functions/ai-meter.js), on its own clock (appConfig/ai
  // timezone), and refuses what is over a limit. The app only reads it: to warn before sending, and to show what is
  // left. Nothing is written from here (consumeQuota does nothing), so usage can be neither lost nor faked.
  const serverMetered = () => !!window.REHABLIX_SERVER_AI;
  function tzParts(tz, ms) {
    const o = {};
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).forEach(x => { o[x.type] = x.value; });
    return o;
  }
  function serverClock() { return (window.RehablixPlanConfig && window.RehablixPlanConfig.aiSettings().timezone) || 'Africa/Lagos'; }
  function serverDay(ms) { const o = tzParts(serverClock(), ms); return `${o.year}-${o.month}-${o.day}`; }
  /** When the server's next day (or month, with month: true) starts. */
  function serverReset(ms, month) {
    const tz = serverClock(), o = tzParts(tz, ms);
    const local = month ? Date.UTC(+o.year, +o.month, 1) : Date.UTC(+o.year, +o.month - 1, +o.day + 1);
    const p = tzParts(tz, local);
    const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - local;
    return local - offset;
  }
  /** This account's usage as the server keeps it, rolled to today / this month / the current window. */
  async function aiUsage(uid) {
    const now = Date.now();
    let raw = {};
    try { raw = (await firebase.database().ref(`aiUsage/${uid}`).once('value')).val() || {}; } catch (e) { raw = {}; }
    const day = serverDay(now), month = day.slice(0, 7);
    const n = v => (typeof v === 'number' && isFinite(v) ? v : 0);
    const d = raw.day && raw.day.key === day ? raw.day : {};
    const m = raw.month && raw.month.key === month ? raw.month : {};
    const w = raw.window && typeof raw.window.start === 'number' && now - raw.window.start < QUOTA_WINDOW_MS ? raw.window : null;
    return {
      day: { usd: n(d.usd), blix: n(d.blix), vision: n(d.vision), search: n(d.search), tokens: n(d.tokens), resetAt: serverReset(now) },
      month: { motion: n(m.motion), audioSec: n(m.audioSec), resetAt: serverReset(now, true) },
      window: w ? { start: w.start, tokens: n(w.tokens), resetAt: w.start + QUOTA_WINDOW_MS } : { start: 0, tokens: 0, resetAt: now + QUOTA_WINDOW_MS }
    };
  }
  /** What is left today/this month for plan: { blix, vision, search, motion, audioMinutes } (null = unlimited). */
  async function aiAllowance(uid, plan) {
    const lim = window.RehablixPlanConfig ? window.RehablixPlanConfig.aiLimits(plan) : null;
    if (!lim || !uid) return null;
    const u = await aiUsage(uid);
    const left = (limit, used) => (limit === -1 ? null : Math.max(0, limit - used));
    return {
      limits: lim, usage: u,
      blix: left(lim.blixDaily, u.day.blix), vision: left(lim.visionDaily, u.day.vision), search: left(lim.searchDaily, u.day.search),
      motion: left(lim.motionMonthly, u.month.motion), audioMinutes: lim.audioMinutesMonthly === -1 ? null : Math.max(0, Math.floor(lim.audioMinutesMonthly - u.month.audioSec / 60)),
      spendReached: lim.usdDaily !== -1 && u.day.usd >= lim.usdDaily
    };
  }
  async function serverQuota(uid, plan) {
    const budget = PLAN_TOKEN_BUDGET[plan];
    const cap = dailyCap(plan);
    const u = await aiUsage(uid);
    if (cap && u.day.tokens >= cap) return { allowed: false, budget: budget == null ? cap : budget, used: budget == null ? u.day.tokens : u.window.tokens, resetAt: u.day.resetAt, daily: true };
    if (budget === null || budget === undefined) return { allowed: true, budget: cap, used: u.day.tokens, resetAt: u.day.resetAt };
    return { allowed: u.window.tokens < budget, budget, used: u.window.tokens, resetAt: u.window.resetAt };
  }

  // Pre-send check: is there room left in the current window? Does NOT
  // consume anything — call consumeQuota() after the response completes.
  async function hasQuota(uid, plan) {
    const budget = PLAN_TOKEN_BUDGET[plan];
    const cap = dailyCap(plan);
    if ((budget === null || budget === undefined) && !cap) return { allowed: true, unlimited: true };
    if (!uid) return { allowed: true, unlimited: true }; // logged-out users aren't tracked here
    if (serverMetered()) return serverQuota(uid, plan);
    // the day's cap stops use until midnight, whatever the 4-hour window says ({daily: true} then)
    const usedToday = cap ? await dailyUsed(uid) : 0;
    const dayOver = !!cap && usedToday >= cap;
    if (budget === null || budget === undefined) {
      return { allowed: !dayOver, budget: cap, used: usedToday, resetAt: nextMidnight(), daily: dayOver };
    }
    const ref = firebase.database().ref(`users/${uid}/quota`);
    const snap = await ref.once('value');
    const quota = snap.val();
    const now = Date.now();
    if (!quota || !quota.windowStart || now - quota.windowStart >= QUOTA_WINDOW_MS) {
      if (dayOver) return { allowed: false, budget, used: 0, resetAt: nextMidnight(), daily: true };
      return { allowed: true, budget, used: 0, resetAt: now + QUOTA_WINDOW_MS };
    }
    if (dayOver) return { allowed: false, budget, used: quota.tokensUsed || 0, resetAt: nextMidnight(), daily: true };
    return {
      allowed: quota.tokensUsed < budget,
      budget,
      used: quota.tokensUsed || 0,
      resetAt: quota.windowStart + QUOTA_WINDOW_MS
    };
  }

  // Post-response: record the (weighted) tokens this turn actually used,
  // resetting the window first if it has expired. A negative amount is what an
  // estimate overcharged (the thinking models: js/ai-transport.js topUp): it is
  // kept as a credit and taken off the next charges, because the database only
  // lets usage grow inside a window.
  const credit = {};
  async function consumeQuota(uid, plan, rawTokens, weight) {
    if (!uid || serverMetered()) return;   // (the server records what each call really used)
    let add = Math.ceil((rawTokens || 0) * (weight || 1));
    if (add < 0) { credit[uid] = (credit[uid] || 0) - add; return; }
    if (add > 0 && credit[uid]) { const use = Math.min(credit[uid], add); credit[uid] -= use; add -= use; }
    if (!add) return;
    // (counted only for plans with a daily cap)
    if (dailyCap(plan)) {
      try {
        await firebase.database().ref(`users/${uid}/dailyQuota`).transaction(cur => {
          const day = today();
          return { day, tokensUsed: Math.max(0, (cur && cur.day === day ? (Number(cur.tokensUsed) || 0) : 0) + add) };
        });
      } catch (e) { /* best effort, like the window */ }
    }
    const budget = PLAN_TOKEN_BUDGET[plan];
    if (budget === null || budget === undefined) return;
    const ref = firebase.database().ref(`users/${uid}/quota`);
    // Atomic: concurrent calls can't lose usage, and the only writes are
    // "add to this window" or "new window after expiry" (what the draft
    // database rules enforce, so usage can't be reset from DevTools).
    await ref.transaction(quota => {
      const now = Date.now();
      if (!quota || !quota.windowStart || now - quota.windowStart >= QUOTA_WINDOW_MS) {
        return { windowStart: now, tokensUsed: Math.max(0, add) };
      }
      return { windowStart: quota.windowStart, tokensUsed: Math.max(0, (quota.tokensUsed || 0) + add) };
    });
  }

  // ---- Upload size limits (MB) per plan and file type ----
  // Documents grow the most with the plan (large textbooks, theses, scans);
  // images and video are capped at 50 MB; audio stays at 25 MB on every plan
  // because that is the transcription provider's hard limit per file.
  const UPLOAD_LIMIT_MB = {
    document: { free: 25, student: 50, pro: 100, max: 200 },
    image:    { free: 25, student: 30, pro: 40,  max: 50 },
    video:    { free: 25, student: 30, pro: 40,  max: 50 },
    audio:    { free: 25, student: 25, pro: 25,  max: 25 }
  };
  function uploadKind(file) {
    const type = (file && file.type) || '';
    const name = ((file && file.name) || '').toLowerCase();
    if (type.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/.test(name)) return 'image';
    if (type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|oga|aac|flac|amr|opus|weba)$/.test(name)) return 'audio';
    if (type.startsWith('video/') || /\.(mp4|mov|mkv|webm|avi|3gp)$/.test(name)) return 'video';
    return 'document';
  }
  function uploadLimitMb(plan, kind) {
    const row = UPLOAD_LIMIT_MB[kind] || UPLOAD_LIMIT_MB.document;
    return row[plan] || row.free;
  }
  // { ok, kind, limitMb, message } — message explains the limit and, when a
  // higher plan would allow the file, says which one.
  function checkUpload(file, plan) {
    plan = PLAN_LEVEL[plan] === undefined ? 'free' : plan;
    const kind = uploadKind(file);
    const limitMb = uploadLimitMb(plan, kind);
    if (!file || file.size <= limitMb * 1024 * 1024) return { ok: true, kind, limitMb };
    const sizeMb = (file.size / 1024 / 1024).toFixed(1);
    const label = { document: 'documents', image: 'images', video: 'videos', audio: 'audio files' }[kind];
    const better = PLAN_ORDER.find(p => PLAN_LEVEL[p] > PLAN_LEVEL[plan] && file.size <= uploadLimitMb(p, kind) * 1024 * 1024);
    const message = '"' + file.name + '" is ' + sizeMb + ' MB. The limit for ' + label + ' on the ' + PLAN_LABELS[plan] + ' plan is ' + limitMb + ' MB.' +
      (better ? ' The ' + PLAN_LABELS[better] + ' plan allows up to ' + uploadLimitMb(better, kind) + ' MB.' : (kind === 'audio' ? ' Please trim it or split it into shorter clips.' : ''));
    return { ok: false, kind, limitMb, message };
  }

  window.RehabPlanTiers = {
    UPLOAD_LIMIT_MB, uploadKind, uploadLimitMb, checkUpload,
    PLAN_LEVEL, PLAN_LABELS, PLAN_ORDER, PLAN_TOKEN_BUDGET, DEFAULT_TOKEN_BUDGET, QUOTA_WINDOW_MS, dailyCap,
    MODELS, getModel, isModelUnlocked, nextPlan,
    estimateTokens, hasQuota, consumeQuota,
    aiUsage, aiAllowance, serverMetered
  };
})();
