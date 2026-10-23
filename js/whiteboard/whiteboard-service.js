// js/whiteboard/whiteboard-service.js — everything around the whiteboard engine that needs the app: the AI calls
// (the model the user chose, on the same token budget as every other tool), saving boards, AI pictures, export, and
// "the board open now" that Lixa chat, Lixa Agent and the Whiteboard page share.
// Android: whiteboard/WhiteboardService.kt, the same.
//
// AI usage: one call writes a board (or changes one). Drawing, editing, steps and export are local and free.
// AI pictures (Pro and Max, switched on by the user, a few a day) are made by the server function aiImage and cost
// PICTURE_TOKENS from the token budget each.
(function () {
  const PICTURE_TOKENS = 25000;                          // what one AI picture takes from the token budget
  const PICTURE_DAILY = { pro: 5, max: 15 };              // (the server function enforces the same numbers)
  const PICTURE_PREF = 'rehab-wb-ai-picture';
  const LAST_KEY = 'rehab-wb-last';

  function user() { try { return firebase.auth().currentUser; } catch (e) { return null; } }
  function plan() { return (window.rehabPlans && window.rehabPlans.getCurrentPlan && window.rehabPlans.getCurrentPlan()) || 'free'; }
  function scrub(t) { const D = window.RehablixDeidentify; return D && D.scrubText ? D.scrubText(String(t || ''), []) : String(t || ''); }

  function standaloneAdapter() {
    const core = window.RehablixAIQuotaCore, u = user(), p = plan();
    return {
      resolve: () => (window.RehablixModelChoice ? window.RehablixModelChoice.resolve() : core.resolveModelConfig('corpus101')),
      check: () => core.checkQuotaOrThrow(u && u.uid, p),
      report: (text, weight) => core.reportTokenUsage(u && u.uid, p, text, weight),
    };
  }

  async function callModel(messages, config, maxTokens, signal) {
    const res = await fetch(config.endpoint + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
      body: JSON.stringify({ model: config.model, messages, max_tokens: Math.min(maxTokens, config.maxTokens || maxTokens), temperature: 0.5, response_format: { type: 'json_object' } }),
      signal,
    });
    if (!res.ok) throw new Error('The SI service returned an error (' + res.status + '). Please try again.');
    const data = await res.json();
    return ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
  }

  /** input: { topic, content, level, steps, instructions }. One AI call (a second only if the first reply is unusable). */
  async function generate(input, adapter, signal) {
    const WB = window.RehablixWhiteboard;
    const a = adapter || standaloneAdapter();
    await a.check();
    const config = await a.resolve();
    if (!config) throw new Error('SI service is not configured.');
    const p = WB.buildPrompt(Object.assign({}, input, { topic: scrub(input.topic), content: scrub(input.content), instructions: scrub(input.instructions) }));
    const messages = [{ role: 'system', content: p.system }, { role: 'user', content: p.user }];
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const raw = await callModel(messages, config, p.maxTokens, signal);
      a.report(p.system + p.user + raw, config.weight);
      try { return WB.parseBoard(raw); } catch (e) { lastErr = e; }
    }
    throw new Error((lastErr && lastErr.message) || 'The SI response could not be drawn. Please try again.');
  }

  /** A change to a board in plain words ("add a step on…", "label the ACL"). The user's own drawing is kept. */
  async function revise(board, instruction, adapter, signal) {
    const WB = window.RehablixWhiteboard;
    const a = adapter || standaloneAdapter();
    await a.check();
    const config = await a.resolve();
    if (!config) throw new Error('SI service is not configured.');
    const p = WB.buildRevisePrompt(board, scrub(instruction));
    const messages = [{ role: 'system', content: p.system }, { role: 'user', content: p.user }];
    const raw = await callModel(messages, config, p.maxTokens, signal);
    a.report(p.system + p.user + raw, config.weight);
    return WB.keepHandwork(board, WB.parseBoard(raw));
  }

  // Boards are private to the signed-in user: history/{uid}/whiteboards/{id} =
  // { title, subject, stepCount, board (JSON string), createdAt, updatedAt }
  function ref(uid, id) { return firebase.database().ref('history/' + uid + '/whiteboards' + (id ? '/' + id : '')); }

  async function save(board, id) {
    const u = user(); if (!u) return null;
    const b = window.RehablixWhiteboard.normalize(board);
    const rec = { title: b.title, subject: b.subject || '', stepCount: b.steps.length, board: JSON.stringify(b), updatedAt: Date.now() };
    let key = id;
    if (id) await ref(u.uid, id).update(rec);
    else { rec.createdAt = rec.updatedAt; key = (await ref(u.uid).push(rec)).key; }
    setCurrent(key, b);
    return key;
  }

  async function load(id) {
    const u = user(); if (!u || !id) return null;
    const rec = (await ref(u.uid, id).once('value')).val();
    if (!rec || !rec.board) return null;
    try { return { id, board: window.RehablixWhiteboard.normalize(JSON.parse(rec.board)), updatedAt: rec.updatedAt }; } catch (e) { return null; }
  }

  async function list(limit) {
    const u = user(); if (!u) return [];
    const snap = await ref(u.uid).orderByChild('updatedAt').limitToLast(limit || 20).once('value');
    const out = [];
    snap.forEach(c => { const v = c.val() || {}; out.push({ id: c.key, title: v.title || 'Whiteboard', subject: v.subject || '', stepCount: v.stepCount || 0, updatedAt: v.updatedAt || v.createdAt || 0 }); });
    return out.reverse();
  }

  async function remove(id) { const u = user(); if (u && id) await ref(u.uid, id).remove(); if (current.id === id) setCurrent(null, null); }

  // ---- the board open now (shared by the Whiteboard page, Lixa chat and Lixa Agent)
  const current = { id: null, board: null };
  try { current.id = localStorage.getItem(LAST_KEY) || null; } catch (e) { /* storage blocked */ }
  /** [source] "agent" when Lixa changed or opened it (the Whiteboard page then shows the new version). */
  function setCurrent(id, board, source) {
    current.id = id || null; current.board = board || null;
    try { if (id) localStorage.setItem(LAST_KEY, id); else localStorage.removeItem(LAST_KEY); } catch (e) { /* storage blocked */ }
    document.dispatchEvent(new CustomEvent('rehablix:whiteboard', { detail: { id: current.id, source: source || '' } }));
  }
  async function currentBoard() {
    if (current.board && current.id) return { id: current.id, board: current.board };
    if (!current.id) { const l = await list(1); if (!l.length) return null; current.id = l[0].id; }
    const r = await load(current.id);
    if (r) current.board = r.board;
    return r;
  }
  function open(id) {
    const href = 'index.html' + (id ? '?board=' + encodeURIComponent(id) : '') + '#/whiteboard';
    if (window.RehablixRouter && window.RehablixRouter.go) window.RehablixRouter.go(href); else window.location.href = href;
  }

  // ---- AI pictures (Pro and Max; the user switches them on; a few a day)
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function pictureLimit(p) { return PICTURE_DAILY[p || plan()] || 0; }
  function pictureOn() { try { return localStorage.getItem(PICTURE_PREF) === '1'; } catch (e) { return false; } }
  function setPictureOn(on) { try { localStorage.setItem(PICTURE_PREF, on ? '1' : '0'); } catch (e) { /* storage blocked */ } }
  async function picturesUsed() {
    const u = user(); if (!u) return 0;
    try { return Number((await firebase.database().ref('users/' + u.uid + '/whiteboardPictures/' + today()).once('value')).val()) || 0; } catch (e) { return 0; }
  }
  /** { allowed (plan has them), on (switched on), used, limit } */
  async function pictureStatus() {
    const limit = pictureLimit();
    return { allowed: limit > 0, on: limit > 0 && pictureOn(), used: limit > 0 ? await picturesUsed() : 0, limit };
  }

  /** One AI picture of [what] (a short description) → { src (data URL), w, h, text }. Throws with a message the user can read. */
  async function makePicture(what) {
    const u = user();
    if (!u) throw new Error('Log in to make AI pictures.');
    const st = await pictureStatus();
    if (!st.allowed) throw new Error('AI pictures come with the Pro and Max plans.');
    if (!st.on) throw new Error('Switch AI pictures on first.');
    if (st.used >= st.limit) throw new Error('You have made today\'s ' + st.limit + ' AI pictures. More tomorrow.');
    const desc = scrub(what).slice(0, 600);
    if (!desc.trim()) throw new Error('Say what the picture should show.');
    await window.RehablixAIQuotaCore.checkQuotaOrThrow(u.uid, plan());
    const prompt = 'A clear, accurate educational illustration for rehabilitation teaching, clean flat medical-illustration style on a plain white background, no text or letters: ' + desc;
    const S = window.RehablixServerAI;
    if (!S || !S.on) throw new Error('AI pictures are not available right now.');
    const res = await S.post('aiImage', { prompt });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j.error && j.error.message) || (res.status === 404 ? 'AI pictures are not switched on yet.' : 'The picture could not be made (' + res.status + ').'));
    if (!j.b64) throw new Error('The picture came back empty.');
    if (window.RehabPlanTiers) window.RehabPlanTiers.consumeQuota(u.uid, plan(), PICTURE_TOKENS, 1).catch(() => {});
    return { src: 'data:' + (j.mime || 'image/jpeg') + ';base64,' + j.b64, w: j.w || 1024, h: j.h || 1024, text: desc.slice(0, 200) };
  }

  // ---- export (local, free)
  function fileName(board, ext) { return String((board && board.title) || 'Whiteboard').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) + '.' + ext; }
  function saveUrl(url, name) {
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function exportPNG(board, upto) {
    saveUrl(await window.RehablixWhiteboard.toPNG(board, upto, 2), fileName(board, 'png'));
  }
  /** One page per step (each showing the board up to that step), with the step's title and explanation. */
  async function exportPDF(board) {
    const WB = window.RehablixWhiteboard;
    if (!window.html2pdf) throw new Error('The PDF maker is still loading. Try again in a moment.');
    const b = WB.normalize(board);
    const wrap = document.createElement('div');
    for (let i = 0; i < b.steps.length; i++) {
      const png = await WB.toPNG(b, i, 1.6);
      const page = document.createElement('div');
      page.className = 'wb-pdf-page';
      page.style.cssText = 'width:270mm;padding:4mm 0;font-family:Arial,sans-serif;color:#1f2937;' + (i ? 'page-break-before:always;' : '');
      page.innerHTML = '<div style="font-size:13pt;font-weight:700;color:#0f766e;margin-bottom:2mm"></div><img style="width:100%;border:1px solid #e5e7eb;border-radius:6px"><div style="font-size:10.5pt;margin-top:3mm;line-height:1.45"></div>';
      page.children[0].textContent = b.title + ' — Step ' + (i + 1) + ' of ' + b.steps.length + ': ' + b.steps[i].title;
      page.children[1].src = png;
      page.children[2].textContent = b.steps[i].say || '';
      wrap.appendChild(page);
    }
    await window.html2pdf().set({ margin: 8, filename: fileName(b, 'pdf'), image: { type: 'jpeg', quality: 0.92 }, html2canvas: { scale: 1.5 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }, pagebreak: { mode: 'css' } }).from(wrap).save();
  }

  window.RehablixWhiteboardService = {
    PICTURE_TOKENS, PICTURE_DAILY, generate, revise, save, load, list, remove, current, setCurrent, currentBoard, open,
    pictureStatus, pictureOn, setPictureOn, makePicture, exportPNG, exportPDF, standaloneAdapter,
  };
})();
