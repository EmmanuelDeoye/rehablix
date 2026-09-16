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
  const MODELS = [
    {
      id: 'blix360', label: 'Blix 360', rank: 1,
      provider: 'openai', apiModel: 'gpt-4.1', endpoint: 'https://api.openai.com/v1',
      maxTokens: 4096, weight: 4, minPlan: 'pro',
      strength: 'Strongest reasoning and understands images — best for complex or multi-image clinical cases.',
      weakness: 'Slowest and most expensive; drains your token budget fastest.'
    },
    {
      id: 'medulla200', label: 'Medulla 200', rank: 2,
      provider: 'deepseek', apiModel: 'deepseek-reasoner', endpoint: 'https://api.deepseek.com/v1',
      maxTokens: 3000, weight: 2, minPlan: 'student',
      strength: 'Strong step-by-step reasoning for multi-part clinical questions.',
      weakness: 'Text-only — no image support.'
    },
    {
      id: 'corpus101', label: 'Corpus 101', rank: 3,
      provider: 'deepseek', apiModel: 'deepseek-v4-flash', endpoint: 'https://api.deepseek.com/v1',
      maxTokens: 2000, weight: 1, minPlan: 'free',
      strength: 'Balanced everyday chat — the default for most questions.',
      weakness: 'Less thorough than Medulla/Blix on long, complex reasoning.'
    },
    {
      id: 'basal100', label: 'Basal 100', rank: 4,
      provider: 'deepseek', apiModel: 'deepseek-v4-flash', endpoint: 'https://api.deepseek.com/v1',
      maxTokens: 1000, weight: 0.5, minPlan: 'free',
      strength: 'Fastest and cheapest — ideal for quick, simple questions.',
      weakness: 'Shorter responses; weaker on long or complex tasks.'
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
