// js/server-ai.js — keeps the AI keys on the server (READY, OFF until switched on).
//
// While window.REHABLIX_SERVER_AI is false (js/config.js, the default) this file does nothing at all and the
// site works exactly as before. Switch it on only AFTER the Cloud Functions aiChat, aiTranscribe, aiSpeak and
// liveToken (rehablix-android/backend/functions) are deployed; then lock `tokens` in the database rules and
// rotate the keys (see BACKEND-KEYS.md).
//
// When on, no page ever reads an AI key again, and none of the ~20 call sites has to change:
//   * reads of the key nodes (tokens/deepseek, tokens/open_ai, tokens/voice) answer at once, from here, with a
//     placeholder instead of the key (the database is not asked);
//   * calls to the providers are sent to the functions instead, with the user's sign-in (Firebase ID token):
//       api.deepseek.com / api.openai.com  …/chat/completions   -> aiChat   (streaming passes straight through)
//       api.openai.com                      …/audio/transcriptions -> aiTranscribe
//       texttospeech.googleapis.com         …/text:synthesize       -> aiSpeak
//   * Lixa Live asks liveToken for a short-lived, single-use Gemini token (js/lixa-agent/agent-live.js).
// Must load after js/config.js and BEFORE js/ai-transport.js (whose DeepSeek → OpenAI fallback then also
// goes through here).
(function () {
  const BASE = window.REHABLIX_AI_FUNCTIONS || 'https://us-central1-rehablix-ai.cloudfunctions.net';
  const PLACEHOLDER = 'server-held';
  const KEY_NODES = { 'tokens/deepseek': 1, 'tokens/open_ai': 1, 'tokens/voice': 1 };

  async function idToken() {
    try { const u = firebase.auth().currentUser; return u ? await u.getIdToken() : null; } catch (e) { return null; }
  }
  async function authHeaders(extra) {
    const h = Object.assign({}, extra || {});
    const t = await idToken();
    if (t) h.Authorization = 'Bearer ' + t;
    return h;
  }
  const nativeFetch = window.fetch.bind(window);

  /** POST JSON to one of the functions, signed in as the current user. */
  async function post(fn, body, init) {
    return nativeFetch(BASE + '/' + fn, Object.assign({}, init || {}, {
      method: 'POST', headers: await authHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify(body || {})
    }));
  }

  window.RehablixServerAI = { on: !!window.REHABLIX_SERVER_AI, BASE, post, PLACEHOLDER };
  /** The server's refusal in a response ({ code, message, needs, suggest, ... }), or null. */
  window.RehablixServerAI.refusalOf = async function (res) {
    if (!res || res.ok || ![401, 403, 413, 429, 503].includes(res.status)) return null;
    const d = await res.clone().json().catch(() => null);
    return d && d.error && d.error.code ? Object.assign({ status: res.status }, d.error) : null;
  };
  if (!window.REHABLIX_SERVER_AI) return;

  // ---- key nodes answer here, with a placeholder (nothing is read from the database) ----
  try {
    const Ref = firebase.database.Reference;
    const once = Ref.prototype.once;
    const pathOf = ref => { try { return decodeURIComponent(ref.toString().replace(/^https?:\/\/[^/]+\/?/, '')).replace(/\/$/, ''); } catch (e) { return ''; } };
    Ref.prototype.once = function (event) {
      const p = pathOf(this);
      if ((event === 'value' || event === undefined) && KEY_NODES[p]) {
        const v = { api_key: PLACEHOLDER };
        return Promise.resolve({ val: () => v, exists: () => true, key: this.key, child: k => ({ val: () => v[k] == null ? null : v[k] }) });
      }
      return once.apply(this, arguments);
    };
  } catch (e) { console.warn('[server-ai] could not install the key placeholder', e); }

  // ---- provider calls go to the functions ----
  // Each request says which feature sent it (the page on screen: 'motion', 'audio', 'project', 'lixa', ...). The server
  // uses it only to pick a counter (Motion AI interpretations, the Audio trial); limits and costs come from the request
  // itself. Basal 100 is named too (its settings: js/plan-tiers.js), for its smaller ceiling and half-rate budget.
  const PROVIDER = [
    { re: /^https:\/\/api\.deepseek\.com\/v1\/chat\/completions/, provider: 'deepseek' },
    { re: /^https:\/\/api\.openai\.com\/v1\/chat\/completions/, provider: 'openai' }
  ];
  function feature() { return (document.body && document.body.dataset.route) || 'lixa'; }
  function tierOf(provider, request) {
    return provider === 'deepseek' && request.model === 'deepseek-v4-flash' && request.temperature === 0.4 && request.top_p === 0.85 ? 'basal100' : null;
  }
  // Blix 360's Deep switch (Max: js/model-choice.js). The server runs Blix on its Deep model only for plans that have it.
  function deepOf(provider, request) {
    const mc = window.RehablixModelChoice;
    return provider === 'openai' && request.model === 'gpt-5' && mc && mc.deep && mc.deep() ? { deep: true } : {};
  }
  function headerOf(init, name) {
    const h = init && init.headers;
    if (!h) return null;
    if (typeof h.get === 'function') return h.get(name);
    const k = Object.keys(h).find(x => x.toLowerCase() === name.toLowerCase());
    return k ? h[k] : null;
  }
  /** A refusal from the server ({ error: { code, ... } }), announced so js/ai-issues.js can explain it. */
  async function announceRefusal(res, source) {
    if (res.ok || ![401, 403, 413, 429, 503].includes(res.status)) return;
    const d = await res.clone().json().catch(() => null);
    const e = d && d.error;
    if (e && e.code) window.dispatchEvent(new CustomEvent('rehablix:ai-blocked', { detail: Object.assign({ status: res.status, source }, e) }));
  }
  const used = () => { try { window.dispatchEvent(new CustomEvent('rehablix:ai-used')); } catch (e) { /* old browsers */ } };
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = String((init && init.method) || 'GET').toUpperCase();
    if (method !== 'POST') return nativeFetch(input, init);
    const chat = PROVIDER.find(p => p.re.test(url));
    if (chat && init && typeof init.body === 'string') {
      let request;
      try { request = JSON.parse(init.body); } catch (e) { return nativeFetch(input, init); }
      used();
      // (refusals of chat requests are announced by js/ai-transport.js, which may still answer some of them itself)
      return nativeFetch(BASE + '/aiChat', {
        method: 'POST', signal: init.signal,
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(Object.assign({ provider: chat.provider, request, feature: feature(), tier: tierOf(chat.provider, request) }, deepOf(chat.provider, request)))
      });
    }
    if (/^https:\/\/api\.openai\.com\/v1\/audio\/transcriptions/.test(url)) {
      used();
      const extra = {};
      const f = headerOf(init, 'X-Rehablix-Feature');
      extra['X-Rehablix-Feature'] = f || feature();
      const res = await nativeFetch(BASE + '/aiTranscribe', { method: 'POST', signal: init && init.signal, headers: await authHeaders(extra), body: init && init.body });
      announceRefusal(res, 'transcribe');
      return res;
    }
    if (/^https:\/\/texttospeech\.googleapis\.com\/v1\/text:synthesize/.test(url)) {
      return nativeFetch(BASE + '/aiSpeak', { method: 'POST', signal: init && init.signal, headers: await authHeaders({ 'Content-Type': 'application/json' }), body: init && init.body });
    }
    return nativeFetch(input, init);
  };
})();
