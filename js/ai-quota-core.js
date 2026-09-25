// js/ai-quota-core.js — DOM-free core of the tiered-AI model resolution +
// shared token-quota system (the same one js/ask.js's window.LixaCore
// exposes to Lixa-embedded generators, js/lixa-generators/*.js).
//
// Why this exists as its own module: window.LixaCore is assigned inside
// js/ask.js's mount() — it does not exist until the Lixa route has actually
// mounted at least once. Every existing LixaCore consumer is safe because
// those generators only ever run from inside Lixa's own chat (LixaCore is
// guaranteed present by construction). js/views/project-view.js is a
// standalone router view like Smart EMR — a direct deep link to #/project
// can mount before Lixa ever has, so it cannot depend on window.LixaCore
// directly without risking a crash on that cold-start path. This module
// reproduces the same resolve/check/report logic against a caller-supplied
// uid/plan instead of ask.js's own closure-scoped currentUser, so any view
// can use it standalone.
(function () {
  const aiConfig = { token: null, endpoint: 'https://api.deepseek.com/v1', model: 'deepseek-v4-flash' };
  // OpenAI-backed models (currently just blix360) need a separate token —
  // BUG FIX: resolveModelConfig() used to always return aiConfig.token (the
  // DeepSeek key) regardless of the resolved model's provider, which would
  // silently break any OpenAI-provider model. Mirrors js/ask.js's
  // fetchVisionTokens()/visionConfig pattern exactly.
  const visionConfig = { token: null, endpoint: 'https://api.openai.com/v1', model: 'gpt-4.1' };
  const database = firebase.database();

  async function fetchTokens() {
    if (aiConfig.token) return true;
    try {
      const snap = await database.ref('tokens/deepseek').once('value');
      const data = snap.val();
      if (data && data.api_key) { aiConfig.token = data.api_key; return true; }
      console.warn('[ai-quota-core] DeepSeek API key missing');
      return false;
    } catch (e) {
      console.error('[ai-quota-core] token fetch failed:', e);
      return false;
    }
  }

  async function fetchOpenAITokens() {
    if (visionConfig.token) return true;
    try {
      const snap = await database.ref('tokens/open_ai').once('value');
      const data = snap.val();
      if (data && data.api_key) { visionConfig.token = data.api_key; return true; }
      console.warn('[ai-quota-core] OpenAI API key missing');
      return false;
    } catch (e) {
      console.error('[ai-quota-core] OpenAI token fetch failed:', e);
      return false;
    }
  }

  // Resolves which model/token config to actually send a request with.
  // `modelId` (optional) pins to one of plan-tiers.js's MODELS entries
  // ('basal100' | 'corpus101' | 'medulla200' | 'blix360') via
  // RehabPlanTiers.getModel(); omit it for the plain default DeepSeek
  // client at weight 1.
  async function resolveModelConfig(modelId) {
    const tiers = window.RehabPlanTiers;
    const model = modelId && tiers && typeof tiers.getModel === 'function' ? tiers.getModel(modelId) : null;
    if (model && model.provider === 'openai') {
      const ok = await fetchOpenAITokens();
      if (!ok) return null;
      return {
        token: visionConfig.token, endpoint: model.endpoint, model: model.apiModel,
        maxTokens: model.maxTokens, weight: model.weight,
        temperature: model.temperature, top_p: model.top_p, responseStyle: model.responseStyle
      };
    }
    const ok = await fetchTokens();
    if (!ok) return null;
    return {
      token: aiConfig.token,
      endpoint: (model && model.endpoint) || aiConfig.endpoint,
      model: (model && model.apiModel) || aiConfig.model,
      maxTokens: (model && model.maxTokens) || 2000,
      weight: (model && model.weight) || 1,
      temperature: (model && model.temperature) ?? 0.6,
      top_p: (model && model.top_p) ?? 0.9,
      responseStyle: model && model.responseStyle
    };
  }

  // Quota is a soft, per-plan budget on a rolling window — checked before
  // sending (not per-message-exact, since real cost isn't known until the
  // response completes) so an exhausted budget blocks the next call rather
  // than the app trying to guess mid-flight.
  async function checkQuotaOrThrow(uid, plan) {
    if (uid && window.RehabPlanTiers && window.rehabPlans) {
      const hasWarnModal = !!window.RehablixQuotaModal;
      const quota = hasWarnModal
        ? await window.RehablixQuotaModal.checkAndWarn(uid, plan)
        : await window.RehabPlanTiers.hasQuota(uid, plan);
      if (!quota.allowed) {
        const resetMins = Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 60000));
        throw new Error(`You've used your token budget for this window. It resets in about ${resetMins} minute(s).`);
      }
    }
  }

  // Records actual usage against the same quota checkQuotaOrThrow() reads.
  function reportTokenUsage(uid, plan, text, weight) {
    if (uid && window.RehabPlanTiers) {
      const rawTokens = window.RehabPlanTiers.estimateTokens(text || '');
      window.RehabPlanTiers.consumeQuota(uid, plan, rawTokens, weight || 1).catch(() => {});
    }
  }

  window.RehablixAIQuotaCore = { resolveModelConfig, checkQuotaOrThrow, reportTokenUsage, fetchTokens, fetchOpenAITokens };
})();
