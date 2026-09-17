// js/plan-tiers.js — shared plan-tier + AI-model constants and the
// per-4-hour-window token quota, used by js/plan.js (feature gating),
// js/ask.js (model picker + quota enforcement) and the subscription view.

(function () {
  const PLAN_LEVEL = { free: 0, student: 1, pro: 2, max: 3 };
  const PLAN_LABELS = { free: 'Free', student: 'Basic', pro: 'Pro', max: 'Max' };
  // Order the tiers actually upgrade through, for "Upgrade to <next>" copy.
  const PLAN_ORDER = ['free', 'student', 'pro', 'max'];

  // Token budget per 4-hour window. null = unlimited (Max plan only).
  const PLAN_TOKEN_BUDGET = {
    free: 20000,
    student: 200000,     // 10x Free
    pro: 20000000,       // 100x Basic (per spec — effectively unlimited in practice)
    max: null
  };

  const QUOTA_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

  // Models, ranked highest -> lowest capability/cost. `weight` scales how
  // fast a model drains the shared per-plan token budget relative to its
  // raw token usage (Blix 360 costs 4x its actual tokens against the
  // budget, Basal 100 costs half).
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
      provider: 'openai', apiModel: 'gpt-4.1', endpoint: 'https://api.openai.com/v1',
      maxTokens: 20000, weight: 4, minPlan: 'pro',
      temperature: 0.75, top_p: 0.95,
      responseStyle: 'Think deeply before answering. Consider edge cases, differential possibilities, and clinical nuance; structure complex answers with headings and sub-points. Depth and completeness matter more than brevity — this is the mode for genuinely hard or multi-part cases.',
      strength: 'Deepest reasoning and the only model that understands images — best for complex or multi-image clinical cases, with the highest token ceiling for long, thorough answers.',
      weakness: 'Slowest and most expensive; drains your token budget fastest.'
    },
    {
      id: 'medulla200', label: 'Medulla 200', rank: 2,
      provider: 'deepseek', apiModel: 'deepseek-reasoner', endpoint: 'https://api.deepseek.com/v1',
      maxTokens: 14000, weight: 2, minPlan: 'student',
      temperature: 0.6, top_p: 0.9,
      responseStyle: 'Reason step by step before giving your final answer — briefly show the logical/clinical-reasoning chain that gets you there, then state a clear conclusion. Prioritize rigor for multi-part or differential-reasoning questions.',
      strength: 'A dedicated chain-of-thought reasoning model — strong step-by-step logic for multi-part clinical questions, with a generous token ceiling for working through them.',
      weakness: 'Text-only — no image support — and slower than Corpus/Basal since it reasons before answering.'
    },
    {
      id: 'corpus101', label: 'Corpus 101', rank: 3,
      provider: 'deepseek', apiModel: 'deepseek-v4-flash', endpoint: 'https://api.deepseek.com/v1',
      maxTokens: 9000, weight: 1, minPlan: 'free',
      temperature: 0.7, top_p: 0.9,
      responseStyle: 'Give clear, well-organized, moderately detailed answers — balance thoroughness with readability. This is the everyday, general-purpose mode: enough room to be complete without the deep multi-step reasoning of Medulla or Blix.',
      strength: 'Balanced everyday chat with real room for detail — the default for most questions.',
      weakness: 'Less rigorous step-by-step reasoning than Medulla/Blix on long, complex tasks.'
    },
    {
      id: 'basal100', label: 'Basal 100', rank: 4,
      provider: 'deepseek', apiModel: 'deepseek-v4-flash', endpoint: 'https://api.deepseek.com/v1',
      maxTokens: 5000, weight: 0.5, minPlan: 'free',
      temperature: 0.4, top_p: 0.85,
      responseStyle: 'Be concise and direct. Answer in as few words as possible while staying accurate — skip elaboration, background, and extra examples unless explicitly asked for more.',
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

  // Pre-send check: is there room left in the current window? Does NOT
  // consume anything — call consumeQuota() after the response completes.
  async function hasQuota(uid, plan) {
    const budget = PLAN_TOKEN_BUDGET[plan];
    if (budget === null || budget === undefined) return { allowed: true, unlimited: true };
    if (!uid) return { allowed: true, unlimited: true }; // logged-out users aren't tracked here
    const ref = firebase.database().ref(`users/${uid}/quota`);
    const snap = await ref.once('value');
    const quota = snap.val();
    const now = Date.now();
    if (!quota || !quota.windowStart || now - quota.windowStart >= QUOTA_WINDOW_MS) {
      return { allowed: true, budget, used: 0, resetAt: now + QUOTA_WINDOW_MS };
    }
    return {
      allowed: quota.tokensUsed < budget,
      budget,
      used: quota.tokensUsed || 0,
      resetAt: quota.windowStart + QUOTA_WINDOW_MS
    };
  }

  // Post-response: record the (weighted) tokens this turn actually used,
  // resetting the window first if it has expired.
  async function consumeQuota(uid, plan, rawTokens, weight) {
    const budget = PLAN_TOKEN_BUDGET[plan];
    if (budget === null || budget === undefined || !uid) return;
    const ref = firebase.database().ref(`users/${uid}/quota`);
    const snap = await ref.once('value');
    let quota = snap.val();
    const now = Date.now();
    if (!quota || !quota.windowStart || now - quota.windowStart >= QUOTA_WINDOW_MS) {
      quota = { windowStart: now, tokensUsed: 0 };
    }
    quota.tokensUsed = (quota.tokensUsed || 0) + Math.ceil((rawTokens || 0) * (weight || 1));
    await ref.set(quota);
  }

  window.RehabPlanTiers = {
    PLAN_LEVEL, PLAN_LABELS, PLAN_ORDER, PLAN_TOKEN_BUDGET, QUOTA_WINDOW_MS,
    MODELS, getModel, isModelUnlocked, nextPlan,
    estimateTokens, hasQuota, consumeQuota
  };
})();
