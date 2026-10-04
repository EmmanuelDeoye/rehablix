// js/deck/deck-service.js — everything around the deck engine that needs the
// app: lazy-loading the PPTX library, the AI call (through the same model
// tiers + token budget as every other Rehablix tool), saving decks, and
// downloading. Used by the Deck Studio view (js/views/deck-view.js) and by
// Lixa's deck generator (js/lixa-generators/deck-gen.js).
//
// AI usage: ONE call per deck (the outline/content as JSON). Designing the
// slides, switching theme, previewing and exporting are all done locally by
// js/deck/deck-engine.js and cost no tokens.
(function () {
  const PPTX_SRC = 'https://cdn.jsdelivr.net/gh/gitbrent/PptxGenJS@3.12.0/dist/pptxgen.bundle.js';
  const PPTX_SRI = 'sha384-Cck14aA9cifjYolcnjebXRfWGkz5ltHMBiG4px/j8GS+xQcb7OhNQWZYyWjQ+UwQ';
  let libPromise = null;

  // PptxGenJS (bundled with JSZip) is ~1 MB: only fetched when a deck is
  // actually exported, never at app start.
  function ensureLibs() {
    if (window.PptxGenJS) return Promise.resolve();
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PPTX_SRC; s.integrity = PPTX_SRI; s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => { libPromise = null; reject(new Error('Could not load the presentation library. Check your connection and try again.')); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  function currentPlan() {
    return (window.rehabPlans && window.rehabPlans.getCurrentPlan && window.rehabPlans.getCurrentPlan()) || 'free';
  }

  // Standalone (Deck Studio) model + quota adapter. Lixa passes its own
  // adapter instead, so a deck made in chat uses the model picked there.
  function standaloneAdapter() {
    const core = window.RehablixAIQuotaCore;
    const user = firebase.auth().currentUser;
    const plan = currentPlan();
    return {
      resolve: () => core.resolveModelConfig('corpus101'),
      check: () => core.checkQuotaOrThrow(user && user.uid, plan),
      report: (text, weight) => core.reportTokenUsage(user && user.uid, plan, text, weight),
    };
  }

  function stripHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = String(html || '').replace(/<(br|\/p|\/h[1-6]|\/li|\/tr)>/gi, '$&\n');
    return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // Never send patient identifiers to the model (name / DOB / phone numbers).
  function scrub(text) {
    const D = window.RehablixDeidentify;
    return D && D.scrubText ? D.scrubText(String(text || ''), []) : String(text || '');
  }

  async function callModel(messages, config, maxTokens, signal) {
    const res = await fetch(config.endpoint + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
      body: JSON.stringify({ model: config.model, messages, max_tokens: maxTokens, temperature: 0.6, top_p: 0.9, response_format: { type: 'json_object' } }),
      signal,
    });
    if (!res.ok) throw new Error('The AI service returned an error (' + res.status + '). Please try again.');
    const data = await res.json();
    return ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
  }

  /**
   * input: { topic, content, audience, slideCount, style, instructions }
   * Returns a normalised, layout-planned deck spec. Checks the token budget
   * first and records what was used.
   */
  async function generateSpec(input, adapter, signal) {
    const Deck = window.RehablixDeck;
    if (!Deck) throw new Error('Deck engine not loaded');
    const a = adapter || standaloneAdapter();
    await a.check();
    const config = await a.resolve();
    if (!config) throw new Error('AI service is not configured.');
    const want = Math.max(6, Math.min(20, parseInt(input.slideCount, 10) || 10));
    const fits = Math.max(6, Math.floor(((config.maxTokens || 9000) - 900) / 420));
    const prompt = Deck.buildPrompt(Object.assign({}, input, { slideCount: Math.min(want, fits), topic: scrub(input.topic), content: scrub(input.content), instructions: scrub(input.instructions) }));
    const messages = [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }];
    const maxTokens = Math.max(prompt.maxTokens, Math.min(config.maxTokens || prompt.maxTokens, prompt.maxTokens + 600));
    let raw = '', spec = null, lastErr = null;
    for (let attempt = 0; attempt < 2 && !spec; attempt++) {
      raw = await callModel(messages, config, maxTokens, signal);
      a.report(prompt.system + prompt.user + raw, config.weight);
      try {
        const parsed = Deck.plan(Deck.parseSpec(raw));
        if (parsed.slides.length >= 3) spec = parsed; else lastErr = new Error('The AI returned too few slides.');
      } catch (e) { lastErr = e; }
    }
    if (!spec) throw new Error('The AI response could not be turned into slides. Please try again.');
    if (input.style && Deck.THEMES[input.style]) spec.style = input.style;
    return spec;
  }

  /** Revises an existing deck from a plain-language instruction (one AI call). */
  async function reviseSpec(spec, instruction, adapter, signal) {
    const Deck = window.RehablixDeck;
    const a = adapter || standaloneAdapter();
    await a.check();
    const config = await a.resolve();
    if (!config) throw new Error('AI service is not configured.');
    const base = Deck.buildPrompt({ slideCount: spec.slides.length });
    const lean = JSON.stringify({ title: spec.title, subtitle: spec.subtitle, style: spec.style, audience: spec.audience, slides: spec.slides.map(cleanSlide) });
    const messages = [
      { role: 'system', content: base.system + '\n\nYou are REVISING an existing deck. Keep everything the request does not touch. Return the complete updated deck JSON.' },
      { role: 'user', content: 'CURRENT DECK JSON:\n' + lean + '\n\nREQUESTED CHANGE:\n' + scrub(instruction) },
    ];
    const maxTokens = Math.min(900 + (spec.slides.length + 4) * 420, config.maxTokens || 9000);
    const raw = await callModel(messages, config, maxTokens, signal);
    a.report(messages[0].content + messages[1].content + raw, config.weight);
    const out = Deck.plan(Deck.parseSpec(raw));
    if (out.slides.length < 3) throw new Error('The AI response could not be turned into slides. Please try again.');
    if (!Deck.THEMES[out.style]) out.style = spec.style;
    return out;
  }

  // Drop empty fields and engine-internal keys before storing / re-sending.
  function cleanSlide(s) {
    const o = {};
    Object.keys(s).forEach((k) => {
      const v = s[k];
      if (k.charAt(0) === '_' || v == null || v === '' || (Array.isArray(v) && !v.length)) return;
      o[k] = v;
    });
    return o;
  }
  function cleanSpec(spec) {
    return { title: spec.title, subtitle: spec.subtitle || '', style: spec.style || '', audience: spec.audience || '', presenter: spec.presenter || '', slides: spec.slides.map(cleanSlide) };
  }

  // Decks are private to the signed-in user (never center-shared):
  // history/{uid}/decks/{id} = { title, theme, slideCount, spec (JSON string), createdAt, updatedAt }
  function ref(uid, id) { return firebase.database().ref('history/' + uid + '/decks' + (id ? '/' + id : '')); }

  async function save(spec, theme, id) {
    const user = firebase.auth().currentUser;
    if (!user) return null;
    const rec = { title: spec.title, theme: theme || spec.style || '', slideCount: spec.slides.length, spec: JSON.stringify(cleanSpec(spec)), updatedAt: Date.now() };
    if (id) { await ref(user.uid, id).update(rec); return id; }
    rec.createdAt = rec.updatedAt;
    const r = await ref(user.uid).push(rec);
    return r.key;
  }

  async function load(id) {
    const user = firebase.auth().currentUser;
    if (!user || !id) return null;
    const rec = (await ref(user.uid, id).once('value')).val();
    if (!rec || !rec.spec) return null;
    try { return { id, title: rec.title, theme: rec.theme, spec: window.RehablixDeck.plan(window.RehablixDeck.parseSpec(rec.spec)), updatedAt: rec.updatedAt }; } catch (e) { return null; }
  }

  async function list(limit) {
    const user = firebase.auth().currentUser;
    if (!user) return [];
    const snap = await ref(user.uid).orderByChild('updatedAt').limitToLast(limit || 12).once('value');
    const out = [];
    snap.forEach((c) => { const v = c.val() || {}; out.push({ id: c.key, title: v.title || 'Untitled deck', theme: v.theme || '', slideCount: v.slideCount || 0, updatedAt: v.updatedAt || v.createdAt || 0 }); });
    return out.reverse();
  }

  async function remove(id) {
    const user = firebase.auth().currentUser;
    if (user && id) await ref(user.uid, id).remove();
  }

  /** Builds the .pptx locally and hands it to the browser. No AI, no tokens. */
  async function download(spec, style, onProgress) {
    await ensureLibs();
    const res = await window.RehablixDeck.render(spec, { style, onProgress });
    const url = URL.createObjectURL(res.blob);
    const a = document.createElement('a');
    a.href = url; a.download = res.fileName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return res;
  }

  // Hand-off from other pages ("Export to PowerPoint" on a result, report,
  // or a Lixa answer): the Studio opens with the content ready as source.
  const HANDOFF_KEY = 'rehablixDeckSource';
  function openStudioWith(source) {
    try { sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ title: source.title || '', content: stripHtml(source.html || source.content || '').slice(0, 24000), at: Date.now() })); } catch (e) { /* too large / unavailable */ }
    if (window.RehablixRouter && window.RehablixRouter.go) window.RehablixRouter.go('index.html#/deck'); else window.location.href = 'index.html#/deck';
  }
  function takeHandoff() {
    try {
      const raw = sessionStorage.getItem(HANDOFF_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(HANDOFF_KEY);
      const v = JSON.parse(raw);
      return (v && Date.now() - (v.at || 0) < 10 * 60 * 1000) ? v : null;
    } catch (e) { return null; }
  }

  window.RehablixDeckService = { ensureLibs, generateSpec, reviseSpec, save, load, list, remove, download, openStudioWith, takeHandoff, stripHtml, cleanSpec };
})();
