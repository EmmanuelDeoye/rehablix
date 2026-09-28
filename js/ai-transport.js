// js/ai-transport.js — one reliability layer for every AI call on the site.
//
// WHY: DeepSeek's current models (deepseek-v4-flash behind basal100 /
// corpus101, deepseek-reasoner behind medulla200) run in THINKING mode by
// default, and the hidden reasoning shares the request's max_tokens budget
// with the visible answer. With the 2k–9k budgets our tools send, the
// reasoning regularly used the whole budget and the reply came back EMPTY
// (EMR treatment plans / next-session plans, Project Maker chapters, …).
// DeepSeek can also finish with `insufficient_system_resource` and no text.
// Only blix360 (OpenAI) was immune, because OpenAI's models don't do that.
//
// WHAT THIS DOES — for every POST to api.deepseek.com/…/chat/completions,
// from any page, without each of the ~20 call sites having to change:
//   1. Non-reasoning models get `thinking: { type: "disabled" }`, so the whole
//      budget goes to the answer. medulla200 (deepseek-reasoner) keeps its
//      step-by-step thinking but gets a budget big enough for thinking + answer.
//   2. If DeepSeek errors, times out, or returns an empty/aborted reply, the
//      SAME request is transparently re-sent to OpenAI (gpt-4.1) and the caller
//      receives OpenAI's response in the identical Chat Completions shape
//      (streaming or not). Callers never see the failure.
//   3. OpenAI work costs more of the user's shared token budget: whenever the
//      fallback answers, the difference between OpenAI's weight and the
//      baseline DeepSeek weight is charged on top of what the caller charges.
//
// It also exposes window.RehablixAI.needsWebSearch()/webSearchConfig(): tasks
// that need live web information are routed to OpenAI's web-search model
// (no DeepSeek model can browse), billed at the OpenAI weight.
(function () {
  if (window.__rehablixAITransport) return;
  window.__rehablixAITransport = true;

  const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
  const OPENAI_FALLBACK_MODEL = 'gpt-4.1';
  const OPENAI_MAX_OUTPUT = 32768;
  const WEB_SEARCH_MODEL = 'gpt-5-search-api';
  // blix360's weight in js/plan-tiers.js — the cost of an OpenAI-answered task.
  const OPENAI_WEIGHT = 4;
  // What the calling tool already charged for a DeepSeek call (weight ~1).
  const BASELINE_WEIGHT = 1;
  // Reasoning + answer share max_tokens on deepseek-reasoner.
  const REASONER_MIN_TOKENS = 32768;

  const nativeFetch = window.fetch.bind(window);
  let openaiKey = null;

  let keyMissUntil = 0;
  async function getOpenAIKey() {
    if (openaiKey) return openaiKey;
    if (Date.now() < keyMissUntil) return null;
    keyMissUntil = Date.now() + 60000; // cleared below on success
    try {
      if (!window.firebase || !firebase.database) return null;
      // Never let a stalled/offline database read hang the caller's request.
      const snap = await Promise.race([
        firebase.database().ref('tokens/open_ai').once('value'),
        new Promise(function (_, reject) { setTimeout(function () { reject(new Error('key lookup timed out')); }, 6000); })
      ]);
      const data = snap.val();
      openaiKey = data && data.api_key ? data.api_key : null;
      if (openaiKey) keyMissUntil = 0;
    } catch (e) {
      console.warn('[ai-transport] OpenAI key unavailable:', e);
    }
    return openaiKey;
  }

  function isDeepSeekChat(url, init) {
    return typeof url === 'string' && url.indexOf('api.deepseek.com') >= 0 && url.indexOf('/chat/completions') >= 0 &&
      init && String(init.method || 'GET').toUpperCase() === 'POST' && typeof init.body === 'string';
  }

  // Set if the API ever rejects the `thinking` switch, so we stop sending it
  // (instead of silently paying for an OpenAI fallback on every call).
  let thinkingParamRejected = false;
  function prepareDeepSeekBody(body) {
    if (body.model === 'deepseek-reasoner') {
      body.max_tokens = Math.max(body.max_tokens || 0, REASONER_MIN_TOKENS);
    } else if (!thinkingParamRejected) {
      body.thinking = { type: 'disabled' };
    }
    return body;
  }

  async function rejectedThinking(res, body) {
    if (res.status !== 400 || !body.thinking) return false;
    const text = await res.clone().text().catch(function () { return ''; });
    return /thinking/i.test(text);
  }

  function openAIBodyFrom(ds) {
    const out = {
      model: OPENAI_FALLBACK_MODEL,
      messages: (ds.messages || []).map(function (m) { return { role: m.role, content: m.content }; }),
      max_tokens: Math.min(Math.max(ds.max_tokens || 4096, 256), OPENAI_MAX_OUTPUT),
      temperature: Math.min(2, Math.max(0, typeof ds.temperature === 'number' ? ds.temperature : 0.7)),
      stream: !!ds.stream
    };
    if (typeof ds.top_p === 'number') out.top_p = Math.min(1, Math.max(0.01, ds.top_p));
    if (ds.response_format) out.response_format = ds.response_format;
    return out;
  }

  function currentUid() {
    try { return firebase.auth().currentUser ? firebase.auth().currentUser.uid : null; } catch (e) { return null; }
  }

  function chargeSurcharge(text) {
    const uid = currentUid();
    if (!uid || !window.RehabPlanTiers || !window.rehabPlans) return;
    const plan = window.rehabPlans.getCurrentPlan() || 'free';
    const raw = window.RehabPlanTiers.estimateTokens(text || '');
    window.RehabPlanTiers.consumeQuota(uid, plan, raw, OPENAI_WEIGHT - BASELINE_WEIGHT).catch(function () {});
  }

  function promptText(body) {
    return (body.messages || []).map(function (m) { return typeof m.content === 'string' ? m.content : ''; }).join(' ');
  }

  // Wraps a streaming OpenAI response so the full answer can be billed once it ends.
  function meteredStream(res, body) {
    if (!res.body || !res.body.getReader) return res;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '', buf = '';
    const stream = new ReadableStream({
      async pull(controller) {
        const r = await reader.read();
        if (r.done) { chargeSurcharge(promptText(body) + text); controller.close(); return; }
        buf += decoder.decode(r.value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() || '';
        lines.forEach(function (l) {
          const t = l.trim();
          if (!t.startsWith('data:')) return;
          try { const j = JSON.parse(t.slice(5).trim()); const d = j.choices && j.choices[0] && j.choices[0].delta; if (d && d.content) text += d.content; } catch (e) { /* partial */ }
        });
        controller.enqueue(r.value);
      },
      cancel(reason) { return reader.cancel(reason); }
    });
    return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers });
  }

  async function openAIFallback(dsBody, init, reason) {
    const key = await getOpenAIKey();
    if (!key) return null;
    console.warn('[ai-transport] DeepSeek ' + reason + ' — answering with OpenAI ' + OPENAI_FALLBACK_MODEL);
    const body = openAIBodyFrom(dsBody);
    const res = await nativeFetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(body),
      signal: init && init.signal
    });
    if (!res.ok) return res;
    if (body.stream) return meteredStream(res, body);
    res.clone().json().then(function (d) {
      const c = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
      chargeSurcharge(promptText(body) + (c || ''));
    }).catch(function () {});
    return res;
  }

  // Streams can come back as a 200 that never carries a single content token.
  // Hold the stream until the first real content delta arrives; if it ends
  // without one, switch to the OpenAI fallback before the caller has seen
  // anything (so there is no half-rendered reply to undo).
  const CONTENT_RE = /"content"\s*:\s*"(?:[^"\\]|\\.)+"/;
  async function streamWithFallback(res, body, init) {
    if (!res.body || !res.body.getReader) return res;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const held = [];
    let buf = '', sawContent = false, finishedBadly = false;
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      held.push(r.value);
      buf += decoder.decode(r.value, { stream: true });
      if (/"finish_reason"\s*:\s*"insufficient_system_resource"/.test(buf)) finishedBadly = true;
      if (CONTENT_RE.test(buf)) { sawContent = true; break; }
      if (buf.length > 200000) buf = buf.slice(-20000);
    }
    if (!sawContent || finishedBadly) {
      const fb = await openAIFallback(body, init, finishedBadly ? 'ran out of resources' : 'returned an empty stream').catch(function (e) { if (e && e.name === 'AbortError') throw e; return null; });
      if (fb && fb.ok) return fb;
      return new Response(new Blob(held), { status: res.status, statusText: res.statusText, headers: res.headers });
    }
    const stream = new ReadableStream({
      start(controller) { held.forEach(function (c) { controller.enqueue(c); }); },
      async pull(controller) {
        const r = await reader.read();
        if (r.done) controller.close(); else controller.enqueue(r.value);
      },
      cancel(reason) { return reader.cancel(reason); }
    });
    return new Response(stream, { status: res.status, statusText: res.statusText, headers: res.headers });
  }

  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (!isDeepSeekChat(url, init)) return nativeFetch(input, init);
    let body;
    try { body = JSON.parse(init.body); } catch (e) { return nativeFetch(input, init); }
    prepareDeepSeekBody(body);
    const dsInit = Object.assign({}, init, { body: JSON.stringify(body) });

    let res;
    try {
      res = await nativeFetch(url, dsInit);
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      const fb = await openAIFallback(body, init, 'network error').catch(function () { return null; });
      if (fb && fb.ok) return fb;
      throw err;
    }

    if (!res.ok && await rejectedThinking(res, body)) {
      thinkingParamRejected = true;
      delete body.thinking;
      // Keep the budget roomy enough for reasoning + answer instead.
      body.max_tokens = Math.max(body.max_tokens || 0, REASONER_MIN_TOKENS);
      try { res = await nativeFetch(url, Object.assign({}, init, { body: JSON.stringify(body) })); } catch (err) { if (err && err.name === 'AbortError') throw err; }
    }

    if (!res || !res.ok) {
      const fb = await openAIFallback(body, init, 'HTTP ' + (res ? res.status : 'error')).catch(function (e) { if (e && e.name === 'AbortError') throw e; return null; });
      if (fb && fb.ok) return fb;
      if (!res) throw new TypeError('Failed to fetch');
      return res;
    }

    if (body.stream) return streamWithFallback(res, body, init);

    const data = await res.clone().json().catch(function () { return null; });
    const choice = data && data.choices && data.choices[0];
    const content = choice && choice.message && choice.message.content;
    if (!content || !String(content).trim() || (choice && choice.finish_reason === 'insufficient_system_resource')) {
      const fb = await openAIFallback(body, init, 'returned an empty reply').catch(function (e) { if (e && e.name === 'AbortError') throw e; return null; });
      if (fb && fb.ok) return fb;
    }
    return res;
  };

  // ---------------------------------------------------------------------------
  // Web search routing (Lixa): only OpenAI's search model can browse.
  // ---------------------------------------------------------------------------
  const WEB_PATTERNS = [
    /\b(search|browse|check|look\s+(it\s+)?up|find)\b[^.?!]{0,40}\b(the\s+)?(web|internet|online|google)\b/i,
    /\b(google|browse)\s+(for|this|it|that)\b/i,
    // "latest"/"recent" only count when they qualify outside-world information —
    // "the patient's latest session" must NOT trigger a paid web search.
    /\b(latest|most\s+recent|newest|recent|current|new|updated|up[-\s]?to[-\s]?date)\s+(news|guidelines?|recommendations?|research|studies|study|evidence|updates?|trials?|statistics|figures|data|policy|policies|prices?|version|developments?|publications?|articles?|papers?)\b/i,
    /\b(news|headlines)\b/i,
    /\b(what'?s|what\s+is)\s+(happening|new)\b/i,
    /\bas\s+of\s+(20\d\d|now|today)\b/i,
    /\b(website|web\s*site|official\s+site|online\s+sources?|links?\s+to|urls?\s+for)\b/i
  ];

  function needsWebSearch(text) {
    const t = String(text || '');
    if (!t.trim()) return false;
    return WEB_PATTERNS.some(function (re) { return re.test(t); });
  }

  // Chat Completions config for the web-search model. The search model takes
  // max_completion_tokens and no sampling parameters (callers check .webSearch).
  async function webSearchConfig(responseStyle) {
    const key = await getOpenAIKey();
    if (!key) return null;
    return {
      token: key, endpoint: 'https://api.openai.com/v1', model: WEB_SEARCH_MODEL,
      maxTokens: 8000, weight: OPENAI_WEIGHT, webSearch: true, responseStyle: responseStyle
    };
  }

  function buildChatBody(config, messages, maxTokens, stream) {
    if (config.webSearch) {
      return { model: config.model, messages: messages, max_completion_tokens: maxTokens || config.maxTokens || 8000, web_search_options: {}, stream: !!stream };
    }
    return { model: config.model, messages: messages, max_tokens: maxTokens || config.maxTokens || 2000, temperature: config.temperature ?? 0.7, top_p: config.top_p ?? 0.9, stream: !!stream };
  }

  window.RehablixAI = {
    needsWebSearch: needsWebSearch,
    webSearchConfig: webSearchConfig,
    buildChatBody: buildChatBody,
    OPENAI_WEIGHT: OPENAI_WEIGHT
  };
})();
