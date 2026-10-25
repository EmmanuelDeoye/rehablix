// js/views/whiteboard-view.js — the Whiteboard page (#/whiteboard): the learner asks for anything, in their own words
// and at the length they want, and Lixa teaches it as a hand-drawn whiteboard lesson, drawing and talking at once.
// Not an editor: Lixa does all the drawing; the learner watches, pauses, skips, asks questions and exports.
// The lesson itself is js/whiteboard/whiteboard-engine.js; AI, voice, pictures and saving are
// js/whiteboard/whiteboard-service.js. The same lesson opens from a Lixa chat card (?board=<id>&play=1) and from
// Lixa Agent. Android: whiteboard/WhiteboardScreen.kt, the same.
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const S = () => window.RehablixWhiteboardService, WB = () => window.RehablixWhiteboard;
  const LENGTH_HELP = { auto: 'Lixa decides', short: '1-2 min', moderate: '3-5 min', long: '8-12 min' };

  window.RehablixTemplates = window.RehablixTemplates || {};
  window.RehablixTemplates.whiteboard =
    '<main class="wbp-main" id="wbpRoot" data-stage="home"><div class="wbp-container">' +
    '<section class="wbp-home">' +
    '<header class="wbp-hero"><h1>White<span class="hero-accent">board</span></h1><p>Ask for anything. Lixa teaches it as a hand-drawn lesson, drawing and explaining at the same time, the way you want it.</p></header>' +
    '<div class="wbp-card">' +
    '<label class="wbp-label" for="wbpTopic">What should Lixa explain, and how?</label>' +
    '<textarea id="wbpTopic" class="wbp-input" rows="3" maxlength="2000" placeholder="e.g. How an ACL tear happens and how rehab gets you back on the pitch. Use football examples and keep it simple."></textarea>' +
    '<div class="wbp-ideas" id="wbpIdeas"></div>' +
    '<span class="wbp-label">Length</span><div class="wbp-chips" id="wbpLength" role="radiogroup" aria-label="Length">' +
    ['auto', 'short', 'moderate', 'long'].map((k, i) => '<button type="button" role="radio" class="wbp-chipbtn' + (i ? '' : ' on') + '" aria-checked="' + (i ? 'false' : 'true') + '" data-len="' + k + '"><b>' + { auto: 'Auto', short: 'Short', moderate: 'Moderate', long: 'Long' }[k] + '</b><span>' + LENGTH_HELP[k] + '</span></button>').join('') + '</div>' +
    '<div class="wbp-row"><label class="wbp-mini">For <select id="wbpLevel" class="wbp-select"><option value="">Anyone</option><option value="Rehab and health students">Students</option><option value="Experienced clinicians">Clinicians</option><option value="A patient or caregiver, in plain words">Patients & caregivers</option><option value="A curious child, very simply">A child</option></select></label></div>' +
    '<div class="wbp-pic" id="wbpPic" hidden></div>' +
    '<div class="wbp-actions"><button type="button" class="wbp-btn wbp-primary wbp-go" id="wbpDraw"><i class="fas fa-play"></i> Teach me</button></div>' +
    '<p class="wbp-error" id="wbpError" hidden></p>' +
    '</div>' +
    '<h2 class="wbp-sub">Your lessons</h2><div class="wbp-list" id="wbpList"><p class="wbp-note">Loading…</p></div>' +
    '</section>' +
    '<section class="wbp-paid"><header class="wbp-hero"><h1>White<span class="hero-accent">board</span></h1></header><div class="wbp-card"><p class="wbp-paidtext" id="wbpPaidText"></p>' +
    '<div class="wbp-actions"><a class="wbp-btn wbp-primary" href="index.html#/subscription">See plans</a></div></div></section>' +
    '<section class="wbp-loading" aria-live="polite"><div class="wbp-spinner"></div><p id="wbpStatus">Lixa is planning your lesson…</p></section>' +
    '<section class="wbp-board">' +
    '<div class="wbp-top">' +
    '<button type="button" class="wbp-icon" id="wbpBack" aria-label="All lessons"><i class="fas fa-arrow-left"></i></button>' +
    '<div class="wbp-titlebox"><h2 class="wbp-title" id="wbpTitle"></h2><span class="wbp-saved" id="wbpSaved"></span></div>' +
    '<div class="wbp-tools"><button type="button" class="wbp-btn" id="wbpPng" title="Save this scene as a picture"><i class="fas fa-image"></i> PNG</button><button type="button" class="wbp-btn" id="wbpPdf" title="Save the lesson as a PDF"><i class="fas fa-file-pdf"></i> PDF</button></div>' +
    '</div>' +
    '<div id="wbpPlayer"></div>' +
    '</section>' +
    '</div></main>';

  const IDEAS = ['The gait cycle, simply', 'Why we feel pain', 'How a stroke affects movement', 'Spinal cord injury levels', 'How muscles get stronger', 'Explain the brachial plexus for my exam'];
  let player = null, id = null, saveTimer = null, unsaved = null, busy = false, cleanup = [], length = 'auto';

  function $(x) { return document.getElementById(x); }
  function stage(s) { const r = $('wbpRoot'); if (r) r.dataset.stage = s; }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type || 'info', 4500); return; }
    const host = document.getElementById('toastContainer') || document.body;
    const t = document.createElement('div'); t.className = 'toast ' + (type || 'info'); t.textContent = msg;
    host.appendChild(t); setTimeout(() => t.remove(), 4500);
  }
  function showError(msg) { const e = $('wbpError'); if (e) { e.textContent = msg || ''; e.hidden = !msg; } }
  function showPaid() { closePlayer(); if ($('wbpPaidText')) $('wbpPaidText').textContent = S().PAID_TEXT; stage('paid'); }

  async function renderList() {
    const box = $('wbpList'); if (!box) return;
    if (!firebase.auth().currentUser) { box.innerHTML = '<p class="wbp-note">Log in to keep and rewatch your lessons.</p>'; return; }
    const items = await S().list(30).catch(() => []);
    box.innerHTML = items.length ? items.map(b =>
      '<div class="wbp-item"><button type="button" class="wbp-open" data-open="' + esc(b.id) + '"><strong>' + esc(b.title) + '</strong><span>' + (b.subject ? esc(b.subject) + ' · ' : '') + b.sceneCount + ' scenes · ' + new Date(b.updatedAt).toLocaleDateString() + '</span></button>' +
      '<button type="button" class="wbp-icon" data-del="' + esc(b.id) + '" aria-label="Delete ' + esc(b.title) + '"><i class="fas fa-trash"></i></button></div>').join('')
      : '<p class="wbp-note">No lessons yet. Ask Lixa to teach you something above.</p>';
  }

  async function pictureBar() {
    const bar = $('wbpPic'); if (!bar) return;
    const st = await S().pictureStatus().catch(() => ({ allowed: false }));
    if (!st.allowed) { bar.hidden = true; return; }
    bar.hidden = false;
    bar.innerHTML = '<label class="wbp-switch"><input type="checkbox" id="wbpPicOn"' + (st.on ? ' checked' : '') + '><span></span> AI pictures</label><span class="wbp-note">' +
      (st.on ? 'Lixa may add a real-looking picture where it helps · ' + Math.max(0, st.limit - st.used) + ' of ' + st.limit + ' left today · ' + Math.round(S().PICTURE_TOKENS / 1000) + 'k tokens each' : 'Off: drawings only') + '</span>';
    $('wbpPicOn').addEventListener('change', e => { S().setPictureOn(e.target.checked); pictureBar(); });
  }

  function scheduleSave(lesson) {
    unsaved = lesson;
    clearTimeout(saveTimer);
    if (!firebase.auth().currentUser) { if ($('wbpSaved')) $('wbpSaved').textContent = 'Log in to keep it'; return; }
    saveTimer = setTimeout(async () => {
      const l = unsaved; if (!l) return;
      try { id = await S().save(l, id); unsaved = null; if ($('wbpSaved')) $('wbpSaved').textContent = 'Saved'; }
      catch (e) { if ($('wbpSaved')) $('wbpSaved').textContent = 'Not saved'; }
    }, 900);
  }

  function closePlayer() { if (player) { player.destroy(); player = null; } }

  /** Shows [lesson] in the player; [autoplay] starts it at once (from a tap, so her voice may play). */
  function openLesson(lesson, lessonId, autoplay) {
    closePlayer();
    id = lessonId || null;
    stage('board');
    $('wbpTitle').textContent = lesson.title;
    $('wbpSaved').textContent = id ? 'Saved' : '';
    const host = S().host({
      save: l => { $('wbpTitle').textContent = l.title; S().setCurrent(id, l); scheduleSave(l); },
      toast,
      onScene: () => {},
    });
    player = WB().mount($('wbpPlayer'), lesson, host);
    S().setCurrent(id, player.lesson());
    if (autoplay) player.play(0);
  }

  async function openSaved(lessonId, autoplay) {
    stage('loading'); $('wbpStatus').textContent = 'Opening the lesson…';
    const r = await S().load(lessonId).catch(() => null);
    if (!r) { stage('home'); showError('That lesson could not be found.'); renderList(); return; }
    openLesson(r.lesson, r.id, autoplay);
  }

  /** "Teach me": Lixa plans the lesson, then teaches it scene by scene. */
  async function teach() {
    if (busy) return;
    const paid = S().isPaid();
    if (paid === false) { showPaid(); return; }
    if (paid === null) { showError('Checking your plan… try again in a moment.'); return; }
    const request = $('wbpTopic').value.trim();
    if (request.length < 3) { showError('Tell Lixa what to explain.'); return; }
    showError(''); busy = true;
    const v = S().voice(); if (v) v.unlock();                  // (in the tap: the browser allows her voice now)
    stage('loading');
    const steps = ['Lixa is planning your lesson…', 'Picking the best way to show it…', 'Getting the first scene ready…'];
    let n = 0; $('wbpStatus').textContent = steps[0];
    const t = setInterval(() => { n = Math.min(steps.length - 1, n + 1); $('wbpStatus').textContent = steps[n]; }, 2600);
    try {
      const lesson = await S().planLesson({ request, length, level: $('wbpLevel').value });
      const newId = firebase.auth().currentUser ? await S().save(lesson).catch(() => null) : null;
      openLesson(lesson, newId, true);
    } catch (e) {
      stage('home'); showError((e && e.message) || 'The lesson could not be planned.');
    } finally { clearInterval(t); busy = false; }
  }

  function on(el, ev, fn) { if (!el) return; el.addEventListener(ev, fn); cleanup.push(() => el.removeEventListener(ev, fn)); }

  function mount() {
    length = 'auto';
    $('wbpIdeas').innerHTML = IDEAS.map(i => '<button type="button" class="wbp-idea">' + esc(i) + '</button>').join('');
    on($('wbpIdeas'), 'click', e => { const b = e.target.closest('.wbp-idea'); if (b) { $('wbpTopic').value = b.textContent; $('wbpTopic').focus(); } });
    on($('wbpLength'), 'click', e => {
      const b = e.target.closest('[data-len]'); if (!b) return;
      length = b.dataset.len;
      $('wbpLength').querySelectorAll('[data-len]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); });
    });
    on($('wbpDraw'), 'click', teach);
    on($('wbpTopic'), 'keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) teach(); });
    on($('wbpBack'), 'click', () => { closePlayer(); stage('home'); renderList(); pictureBar(); });
    on($('wbpList'), 'click', async e => {
      const o = e.target.closest('[data-open]'); if (o) { const v = S().voice(); if (v) v.unlock(); openSaved(o.dataset.open, true); return; }
      const d = e.target.closest('[data-del]');
      if (d && confirm('Delete this lesson? This cannot be undone.')) { await S().remove(d.dataset.del).catch(() => {}); renderList(); }
    });
    on($('wbpPng'), 'click', () => player && S().exportPNG(player.lesson(), player.scene()).catch(e => toast(e.message, 'error')));
    on($('wbpPdf'), 'click', async () => { if (!player) return; toast('Making the PDF…'); try { await S().exportPDF(player.lesson()); } catch (e) { toast(e.message || 'The PDF could not be made.', 'error'); } });
    // Lixa (chat or agent) made, changed or opened a lesson while this page is showing
    const onBoard = e => {
      if (!e.detail || e.detail.source !== 'agent') return;
      const cur = S().current;
      if (cur.lesson) openLesson(cur.lesson, e.detail.id, false);
    };
    document.addEventListener('rehablix:whiteboard', onBoard);
    cleanup.push(() => document.removeEventListener('rehablix:whiteboard', onBoard));

    const params = new URLSearchParams(window.location.search);
    const want = params.get('board'), autoPlay = params.get('play') === '1';
    const start = () => {
      if (want && window.RehablixRouter && window.RehablixRouter.clearQuery) window.RehablixRouter.clearQuery();
      if (S().isPaid() === false) { showPaid(); return; }
      if (want === 'local') {
        // a lesson made in the Lixa chat without an account: not saved, it lives for this visit only
        if (S().current.lesson) openLesson(S().current.lesson, S().current.id, autoPlay);
        else { renderList(); showError('That lesson was not saved. Log in to keep your lessons.'); }
      } else if (want) openSaved(want, autoPlay);
      else { renderList(); pictureBar(); }
    };
    // (the signed-in user may not be known yet on a fresh load)
    let started = false;
    const unsub = firebase.auth().onAuthStateChanged(() => { if (!started) { started = true; start(); } else if ($('wbpRoot') && $('wbpRoot').dataset.stage === 'home') { renderList(); pictureBar(); } });
    cleanup.push(unsub);
    // the plan arrives a moment after the account: a free plan sees the plans card
    const onPlan = () => {
      const p = S().isPaid();
      if (p === false && $('wbpRoot') && $('wbpRoot').dataset.stage !== 'paid') showPaid();
      else if (p === true && $('wbpRoot') && $('wbpRoot').dataset.stage === 'paid') { stage('home'); renderList(); pictureBar(); }
    };
    document.addEventListener('planUpdated', onPlan);
    cleanup.push(() => document.removeEventListener('planUpdated', onPlan));
  }

  function unmount() {
    clearTimeout(saveTimer);
    // (a change still waiting to be saved is saved now)
    if (unsaved && firebase.auth().currentUser) S().save(unsaved, id).catch(() => {});
    closePlayer();
    cleanup.forEach(f => { try { f(); } catch (e) { /* best-effort */ } });
    cleanup = []; id = null; busy = false; unsaved = null;
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.whiteboard = { mount, unmount };
  // (Lixa Agent works with the lesson on screen: js/lixa-agent/agent-brain.js)
  window.RehablixWhiteboardView = { player: () => player, lessonId: () => id };
})();
