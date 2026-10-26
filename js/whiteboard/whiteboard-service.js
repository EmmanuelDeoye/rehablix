// js/whiteboard/whiteboard-service.js — what the whiteboard lesson (js/whiteboard/whiteboard-engine.js) needs from the
// app: the AI calls (the model the user chose, on the same token budget as every other tool), Lixa's voice, AI
// pictures, saving, export, and "the lesson open now" that the Whiteboard page, the Lixa chat and Lixa Agent share.
// Android: whiteboard/WhiteboardService.kt, the same.
//
// AI usage: one call plans a lesson; one call writes each scene (only when it is about to play); one call answers
// each question asked about it. AI pictures (Pro and Max, switched on by the user, a few a day) come from the server
// function aiImage and cost PICTURE_TOKENS from the token budget each.
(function () {
  const PICTURE_TOKENS = 25000;                          // what one AI picture takes from the token budget
  const PICTURE_DAILY = { pro: 5, max: 15 };              // (the server function enforces the same numbers)
  const PICTURE_PREF = 'rehab-wb-ai-picture';
  const LAST_KEY = 'rehab-wb-last';
  const PAID_TEXT = 'The whiteboard, where Lixa draws and explains anything you ask live, step by step, is for the Basic, Pro and Max plans.';

  function user() { try { return firebase.auth().currentUser; } catch (e) { return null; } }
  function plan() { return (window.rehabPlans && window.rehabPlans.getCurrentPlan && window.rehabPlans.getCurrentPlan()) || 'free'; }
  function scrub(t) { const D = window.RehablixDeidentify; return D && D.scrubText ? D.scrubText(String(t || ''), []) : String(t || ''); }

  /** Basic, Pro and Max. null while the plan is not known yet. */
  function isPaid() {
    const p = window.rehabPlans && window.rehabPlans.getCurrentPlan && window.rehabPlans.getCurrentPlan();
    if (!p) return user() ? null : false;
    const lv = (window.RehabPlanTiers && window.RehabPlanTiers.PLAN_LEVEL) || { free: 0, student: 1, pro: 2, max: 3 };
    return (lv[p] || 0) >= 1;
  }

  function standaloneAdapter() {
    const core = window.RehablixAIQuotaCore, u = user(), p = plan();
    return {
      resolve: () => (window.RehablixModelChoice ? window.RehablixModelChoice.resolve() : core.resolveModelConfig('corpus101')),
      check: () => core.checkQuotaOrThrow(u && u.uid, p),
      report: (text, weight) => core.reportTokenUsage(u && u.uid, p, text, weight),
    };
  }

  /**
   * One AI call for the lesson: req {system, user, maxTokens, json, stream}; [onText] gets each piece of a streamed
   * reply. Returns the whole reply. Patient identifiers are taken out first.
   */
  async function ai(req, onText, adapter) {
    const a = adapter || standaloneAdapter();
    await a.check();
    const config = await a.resolve();
    if (!config) throw new Error('SI service is not configured.');
    const system = scrub(req.system), userText = scrub(req.user);
    const body = { model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: userText }], max_tokens: Math.min(req.maxTokens || 3000, config.maxTokens || req.maxTokens || 3000), temperature: 0.75 };
    if (req.json && config.model !== 'deepseek-reasoner') body.response_format = { type: 'json_object' };
    if (req.stream) body.stream = true;
    let text = '';
    try {
      const res = await fetch(config.endpoint + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error('The SI service returned an error (' + res.status + '). Please try again.');
      if (!req.stream) {
        const d = await res.json();
        text = ((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '').trim();
        return text;
      }
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop() || '';
        lines.forEach(l => {
          const t = l.trim();
          if (!t.startsWith('data:')) return;
          const data = t.slice(5).trim();
          if (data === '[DONE]') return;
          try { const j = JSON.parse(data), dl = j.choices && j.choices[0] && j.choices[0].delta; if (dl && dl.content) { text += dl.content; if (onText) onText(dl.content); } } catch (e) { /* a partial line */ }
        });
      }
      return text;
    } finally {
      if (text) a.report(system + userText + text, config.weight);
    }
  }

  /** The engine's view of the app (see mount() in whiteboard-engine.js). */
  function host(extra) {
    return Object.assign({
      ai: (req, onText) => ai(req, onText),
      voice: voice(),
      picture: pictureStatusSync() ? (prompt => makePicture(prompt).catch(() => null)) : null,
    }, extra || {});
  }

  /** A new lesson, planned: opts { request, length, level }. */
  function planLesson(opts, adapter) {
    // (pitched for the learner's own field: js/specialty.js)
    const learner = (opts && opts.learner) || (window.RehablixSpecialty ? window.RehablixSpecialty.describe() : '');
    return window.RehablixWhiteboard.plan({ ai: (req, onText) => ai(req, onText, adapter) }, Object.assign({}, opts, learner ? { learner } : {}));
  }

  // ---- Lixa's voice, sentence by sentence (her own voice and accent, as chosen in Lixa Agent)
  let cloud = null, problem = null;
  function cloudVoice() {
    const V = window.LixaAgentVoice;
    if (!V) return null;
    if (!cloud) {
      cloud = new V({ prepare: t => scrub(t), onProblem: () => { if (problem) problem(); } });
      try {
        const accent = localStorage.getItem('rehab-agent-accent');
        if (V.ACCENTS.indexOf(accent) >= 0) cloud.accent = accent;
        const her = localStorage.getItem('rehab-agent-live-voice');
        if (her && /^[A-Z][a-z]+$/.test(her)) cloud.herVoice = her;
      } catch (e) { /* storage blocked: her default voice */ }
    }
    return cloud;
  }
  // With Lixa Agent on, the lesson talks through her: her mascot (the floating bubble) says it, and she stops
  // listening meanwhile (js/lixa-agent/agent-ui.js narrating / narrate). Android: whiteboard/WhiteboardVoice.kt.
  const agent = () => (window.LixaAgentMode && window.LixaAgentMode.isActive() && window.LixaAgentMode.narrating ? window.LixaAgentMode : null);
  let quietTimer = null, openSessions = 0;
  function narrating(on) {
    clearTimeout(quietTimer);
    const a = agent();
    if (on) { if (a) a.narrating(true); return; }
    // (she listens again only if no next scene starts talking within a moment, so her microphone is not opened and
    // closed between scenes)
    quietTimer = setTimeout(() => { const b = agent(); if (b && !openSessions) b.narrating(false); }, 2500);
  }

  function voice() {
    if (!window.LixaAgentVoice) return null;
    return {
      /** Call from a tap: browsers allow sound only after one. */
      unlock() { const v = cloudVoice(); if (v) v.unlock(); },
      open() {
        const v = cloudVoice();
        let onSentence = () => {}, last = -1;
        const sess = { failed: false };
        problem = () => { sess.failed = true; };        // (no voice key, or no connection for too long: the board goes on at reading pace)
        const job = v.speak(ev => {
          if (ev.speaking && ev.sentence !== last) { last = ev.sentence; onSentence(ev.sentence); }
          const a = agent(); if (a) a.narrate(ev);
        });
        openSessions++;
        let ended = false;
        const end = () => { if (ended) return; ended = true; openSessions--; narrating(false); };
        Promise.resolve(job.done).then(end);
        // (an answer Lixa Agent is saying herself is finished first: the two voices never talk at once)
        const waiting = [];
        let closeWanted = false, gate = null;
        const flush = () => {
          const a = agent();
          if (a && a.speaking()) { gate = setTimeout(flush, 150); return; }
          gate = null;
          narrating(true);
          while (waiting.length) job.add(waiting.shift());
          if (closeWanted) job.close();
        };
        sess.add = s => { waiting.push(s); if (!gate) flush(); };
        sess.close = () => { closeWanted = true; if (!gate) job.close(); };
        sess.onSentence = f => { onSentence = f; };
        sess.done = job.done;
        sess.stop = () => { clearTimeout(gate); gate = null; waiting.length = 0; v.stop(); end(); };
        sess.pause = () => { v.pause(); const a = agent(); if (a) { clearTimeout(quietTimer); a.narrating(false); } };
        sess.resume = () => { v.resume(); narrating(true); };
        return sess;
      },
    };
  }

  // Lessons are private to the signed-in user: history/{uid}/whiteboards/{id} =
  // { title, subject, sceneCount, board (the lesson, a JSON string), createdAt, updatedAt }
  function ref(uid, id) { return firebase.database().ref('history/' + uid + '/whiteboards' + (id ? '/' + id : '')); }

  async function save(lesson, id) {
    const u = user(); if (!u) return null;
    const l = window.RehablixWhiteboard.leanLesson(window.RehablixWhiteboard.normalizeLesson(lesson));
    const rec = { title: l.title, subject: l.subject || '', sceneCount: l.scenes.length, board: JSON.stringify(l), updatedAt: Date.now() };
    let key = id;
    if (id) await ref(u.uid, id).update(rec);
    else { rec.createdAt = rec.updatedAt; key = (await ref(u.uid).push(rec)).key; }
    setCurrent(key, l);
    return key;
  }

  async function load(id) {
    const u = user(); if (!u || !id) return null;
    const rec = (await ref(u.uid, id).once('value')).val();
    if (!rec || !rec.board) return null;
    try { return { id, lesson: window.RehablixWhiteboard.normalizeLesson(JSON.parse(rec.board)), updatedAt: rec.updatedAt }; } catch (e) { return null; }
  }

  async function list(limit) {
    const u = user(); if (!u) return [];
    const snap = await ref(u.uid).orderByChild('updatedAt').limitToLast(limit || 30).once('value');
    const out = [];
    snap.forEach(c => { const v = c.val() || {}; out.push({ id: c.key, title: v.title || 'Whiteboard lesson', subject: v.subject || '', sceneCount: v.sceneCount || v.stepCount || 0, updatedAt: v.updatedAt || v.createdAt || 0 }); });
    return out.reverse();
  }

  async function remove(id) { const u = user(); if (u && id) await ref(u.uid, id).remove(); if (current.id === id) setCurrent(null, null); }

  // ---- the lesson open now (shared by the Whiteboard page, the Lixa chat and Lixa Agent)
  const current = { id: null, lesson: null };
  try { current.id = localStorage.getItem(LAST_KEY) || null; } catch (e) { /* storage blocked */ }
  /** [source] "agent" when Lixa made, changed or opened it (the Whiteboard page then shows it). */
  function setCurrent(id, lesson, source) {
    current.id = id || null; current.lesson = lesson || null;
    try { if (id) localStorage.setItem(LAST_KEY, id); else localStorage.removeItem(LAST_KEY); } catch (e) { /* storage blocked */ }
    document.dispatchEvent(new CustomEvent('rehablix:whiteboard', { detail: { id: current.id, source: source || '' } }));
  }
  async function currentLesson() {
    if (current.lesson && current.id) return { id: current.id, lesson: current.lesson };
    if (!current.id) { const l = await list(1); if (!l.length) return null; current.id = l[0].id; }
    const r = await load(current.id);
    if (r) current.lesson = r.lesson;
    return r;
  }
  /** The Whiteboard page with lesson [id] ("local": the one in use, not saved); [play]: it starts playing. */
  function link(id, play) { return 'index.html?board=' + encodeURIComponent(id || 'local') + (play ? '&play=1' : '') + '#/whiteboard'; }
  function open(id, play) {
    const href = link(id, play);
    if (window.RehablixRouter && window.RehablixRouter.go) window.RehablixRouter.go(href); else window.location.href = href;
  }

  // ---- AI pictures (Pro and Max; the user switches them on; a few a day)
  function today() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function pictureLimit(p) { return PICTURE_DAILY[p || plan()] || 0; }
  function pictureOn() { try { return localStorage.getItem(PICTURE_PREF) === '1'; } catch (e) { return false; } }
  function setPictureOn(on) { try { localStorage.setItem(PICTURE_PREF, on ? '1' : '0'); } catch (e) { /* storage blocked */ } }
  /** AI pictures can be made now (the plan has them and they are switched on): the lesson may ask for them. */
  function pictureStatusSync() { return pictureLimit() > 0 && pictureOn(); }
  async function picturesUsed() {
    const u = user(); if (!u) return 0;
    try { return Number((await firebase.database().ref('users/' + u.uid + '/whiteboardPictures/' + today()).once('value')).val()) || 0; } catch (e) { return 0; }
  }
  /** { allowed (plan has them), on (switched on), used, limit } */
  async function pictureStatus() {
    const limit = pictureLimit();
    return { allowed: limit > 0, on: limit > 0 && pictureOn(), used: limit > 0 ? await picturesUsed() : 0, limit };
  }
  /** One AI picture of [what] -> { src (data URL), w, h, text }. Throws with a message the user can read. */
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
    const prompt = 'A clear, accurate educational illustration, clean flat style on a plain white background, no text or letters: ' + desc;
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
  function fileName(lesson, ext) { return String((lesson && lesson.title) || 'Whiteboard lesson').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) + '.' + ext; }
  function saveUrl(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  async function exportPNG(lesson, k) { saveUrl(await window.RehablixWhiteboard.toPNG(lesson, k, 2), fileName(lesson, 'png')); }
  /** One page per scene that has been written: the board as drawn, and what Lixa said. */
  async function exportPDF(lesson) {
    const WB = window.RehablixWhiteboard;
    if (!window.html2pdf) throw new Error('The PDF maker is still loading. Try again in a moment.');
    const l = WB.normalizeLesson(lesson);
    const ready = l.scenes.map((s, i) => ({ s, i })).filter(x => x.s.beats.length);
    if (!ready.length) throw new Error('No scene has been drawn yet. Play the lesson first.');
    const wrap = document.createElement('div');
    let first = true;
    for (let n = 0; n < ready.length; n++) {
      const { s, i } = ready[n];
      // (a scene that turned to a clean page has a picture for each board-full)
      const pages = WB.pageCount(l, i);
      for (let p = 0; p < pages; p++) {
        const png = await WB.toPNG(l, i, 1.6, p);
        const page = document.createElement('div');
        page.style.cssText = 'width:270mm;padding:4mm 0;font-family:Arial,sans-serif;color:#1f2937;' + (first ? '' : 'page-break-before:always;');
        first = false;
        page.innerHTML = '<div style="font-size:13pt;font-weight:700;color:#0f766e;margin-bottom:2mm"></div><img style="width:100%;border:1px solid #e5e7eb;border-radius:6px"><div style="font-size:10pt;margin-top:3mm;line-height:1.45"></div>';
        page.children[0].textContent = l.title + ' — ' + (i + 1) + '. ' + s.title + (pages > 1 ? ' (' + (p + 1) + ' of ' + pages + ')' : '');
        page.children[1].src = png;
        // (what was said is printed once, under the scene's last page)
        page.children[2].textContent = p === pages - 1 ? s.beats.map(b => b.say).join(' ') : '';
        wrap.appendChild(page);
      }
    }
    await window.html2pdf().set({ margin: 8, filename: fileName(l, 'pdf'), image: { type: 'jpeg', quality: 0.92 }, html2canvas: { scale: 1.5 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }, pagebreak: { mode: 'css' } }).from(wrap).save();
  }

  window.RehablixWhiteboardService = {
    PICTURE_TOKENS, PICTURE_DAILY, PAID_TEXT, isPaid, ai, host, planLesson, voice, save, load, list, remove, current, setCurrent, currentLesson, link, open,
    pictureStatus, pictureOn, setPictureOn, makePicture, exportPNG, exportPDF, standaloneAdapter,
  };
})();
