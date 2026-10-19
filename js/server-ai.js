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
  const PROVIDER = [
    { re: /^https:\/\/api\.deepseek\.com\/v1\/chat\/completions/, provider: 'deepseek' },
    { re: /^https:\/\/api\.openai\.com\/v1\/chat\/completions/, provider: 'openai' }
  ];
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = String((init && init.method) || 'GET').toUpperCase();
    if (method !== 'POST') return nativeFetch(input, init);
    const chat = PROVIDER.find(p => p.re.test(url));
    if (chat && init && typeof init.body === 'string') {
      let request;
      try { request = JSON.parse(init.body); } catch (e) { return nativeFetch(input, init); }
      return nativeFetch(BASE + '/aiChat', {
        method: 'POST', signal: init.signal,
        headers: await authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ provider: chat.provider, request })
      });
    }
    if (/^https:\/\/api\.openai\.com\/v1\/audio\/transcriptions/.test(url)) {
      return nativeFetch(BASE + '/aiTranscribe', { method: 'POST', signal: init && init.signal, headers: await authHeaders(), body: init && init.body });
    }
    if (/^https:\/\/texttospeech\.googleapis\.com\/v1\/text:synthesize/.test(url)) {
      return nativeFetch(BASE + '/aiSpeak', { method: 'POST', signal: init && init.signal, headers: await authHeaders({ 'Content-Type': 'application/json' }), body: init && init.body });
    }
    return nativeFetch(input, init);
  };
})();
