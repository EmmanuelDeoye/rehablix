// js/views/whiteboard-view.js — the Whiteboard page (#/whiteboard): Lixa explains a topic visually, step by step,
// on a board the user can then draw on, change, save, reopen and export. The board itself is
// js/whiteboard/whiteboard-engine.js; AI, saving and pictures are js/whiteboard/whiteboard-service.js.
// The same board opens from a Lixa chat card (?board=<id>) and from Lixa Agent.
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const S = () => window.RehablixWhiteboardService, WB = () => window.RehablixWhiteboard;

  window.RehablixTemplates = window.RehablixTemplates || {};
  window.RehablixTemplates.whiteboard =
    '<main class="wbp-main" id="wbpRoot" data-stage="home"><div class="wbp-container">' +
    '<section class="wbp-home">' +
    '<header class="wbp-hero"><h1>White<span class="hero-accent">board</span></h1><p>Lixa explains any rehab topic visually: diagrams, labels, arrows and notes, step by step. Then draw on it, change it and export it.</p></header>' +
    '<div class="wbp-card">' +
    '<label class="wbp-label" for="wbpTopic">What should Lixa explain?</label>' +
    '<textarea id="wbpTopic" class="wbp-input" rows="3" maxlength="1500" placeholder="e.g. How an ACL tear happens and the stages of rehab after reconstruction"></textarea>' +
    '<div class="wbp-row">' +
    '<label class="wbp-mini">For <select id="wbpLevel" class="wbp-select"><option value="">Students & clinicians</option><option value="Rehab students (first years)">Beginners</option><option value="Experienced clinicians">Experienced clinicians</option><option value="A patient or caregiver, in plain words">Patients & caregivers</option></select></label>' +
    '<label class="wbp-mini">Steps <select id="wbpSteps" class="wbp-select"><option value="0">Auto</option><option>3</option><option>4</option><option>5</option><option>6</option><option>8</option></select></label>' +
    '</div>' +
    '<div class="wbp-actions"><button type="button" class="wbp-btn wbp-primary" id="wbpDraw">Draw it</button><button type="button" class="wbp-btn" id="wbpBlank">Blank board</button></div>' +
    '<p class="wbp-error" id="wbpError" hidden></p>' +
    '</div>' +
    '<h2 class="wbp-sub">Your boards</h2><div class="wbp-list" id="wbpList"><p class="wbp-note">Loading…</p></div>' +
    '</section>' +
    '<section class="wbp-paid"><header class="wbp-hero"><h1>White<span class="hero-accent">board</span></h1></header><div class="wbp-card"><p class="wbp-paidtext" id="wbpPaidText"></p>' +
    '<div class="wbp-actions"><a class="wbp-btn wbp-primary" href="index.html#/subscription">See plans</a></div></div></section>' +
    '<section class="wbp-loading" aria-live="polite"><div class="wbp-spinner"></div><p id="wbpStatus">Lixa is planning the board…</p></section>' +
    '<section class="wbp-board">' +
    '<div class="wbp-top">' +
    '<button type="button" class="wbp-icon" id="wbpBack" aria-label="All boards"><i class="fas fa-arrow-left"></i></button>' +
    '<input id="wbpTitle" class="wbp-title" maxlength="100" aria-label="Board title">' +
    '<span class="wbp-saved" id="wbpSaved"></span>' +
    '<div class="wbp-tools"><button type="button" class="wbp-btn" id="wbpPng"><i class="fas fa-image"></i> PNG</button><button type="button" class="wbp-btn" id="wbpPdf"><i class="fas fa-file-pdf"></i> PDF</button></div>' +
    '</div>' +
    '<div class="wbp-ask"><input id="wbpAsk" class="wbp-input" maxlength="1000" placeholder="Ask Lixa to change it: “add a step on rehab phases”, “label the menisci”…"><button type="button" class="wbp-btn wbp-primary" id="wbpAskGo">Change</button></div>' +
    '<div class="wbp-pic" id="wbpPic" hidden></div>' +
    '<div id="wbpEditor"></div>' +
    '</section>' +
    '</div></main>';

  let editor = null, id = null, saveTimer = null, unsaved = false, busy = false, cleanup = [], liveAbort = null;

  /** The whiteboard is for paid plans (Basic, Pro, Max). */
  function showPaid() {
    if (editor) { editor.destroy(); editor = null; }
    if ($('wbpPaidText')) $('wbpPaidText').textContent = S().PAID_TEXT;
    stage('paid');
  }

  function $(x) { return document.getElementById(x); }
  function stage(s) { const r = $('wbpRoot'); if (r) r.dataset.stage = s; }
  function toast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg, type || 'info', 4500); return; }
    const host = document.getElementById('toastContainer') || document.body;
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    t.textContent = msg;
    host.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }
  function showError(msg) { const e = $('wbpError'); if (e) { e.textContent = msg || ''; e.hidden = !msg; } }

  async function renderList() {
    const box = $('wbpList'); if (!box) return;
    if (!firebase.auth().currentUser) { box.innerHTML = '<p class="wbp-note">Log in to save and reopen your boards.</p>'; return; }
    const items = await S().list(30).catch(() => []);
    box.innerHTML = items.length ? items.map(b =>
      '<div class="wbp-item" data-id="' + esc(b.id) + '"><button type="button" class="wbp-open" data-open="' + esc(b.id) + '"><strong>' + esc(b.title) + '</strong><span>' + (b.subject ? esc(b.subject) + ' · ' : '') + b.stepCount + ' steps · ' + new Date(b.updatedAt).toLocaleDateString() + '</span></button>' +
      '<button type="button" class="wbp-icon" data-del="' + esc(b.id) + '" aria-label="Delete ' + esc(b.title) + '"><i class="fas fa-trash"></i></button></div>').join('')
      : '<p class="wbp-note">No boards yet. Ask Lixa to explain something above.</p>';
  }

  async function pictureBar() {
    const bar = $('wbpPic'); if (!bar) return;
    const st = await S().pictureStatus().catch(() => ({ allowed: false }));
    bar.hidden = false;
    if (!st.allowed) { bar.innerHTML = '<span><i class="fas fa-magic"></i> AI pictures come with the Pro and Max plans.</span><a href="index.html#/subscription">See plans</a>'; return; }
    bar.innerHTML = '<label class="wbp-switch"><input type="checkbox" id="wbpPicOn"' + (st.on ? ' checked' : '') + '><span></span> AI pictures</label><span class="wbp-note">' +
      (st.on ? Math.max(0, st.limit - st.used) + ' of ' + st.limit + ' left today · each uses ' + Math.round(S().PICTURE_TOKENS / 1000) + 'k tokens' : 'Off: no picture tokens are used') + '</span>';
    $('wbpPicOn').addEventListener('change', e => { S().setPictureOn(e.target.checked); mountEditor(editor ? editor.board() : null, true); pictureBar(); });
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    if (!firebase.auth().currentUser) { $('wbpSaved').textContent = 'Log in to save'; return; }
    $('wbpSaved').textContent = 'Saving…';
    unsaved = true;
    saveTimer = setTimeout(async () => {
      if (!editor) return;
      try { id = await S().save(editor.board(), id); unsaved = false; if ($('wbpSaved')) $('wbpSaved').textContent = 'Saved'; }
      catch (e) { if ($('wbpSaved')) $('wbpSaved').textContent = 'Not saved'; }
    }, 1200);
  }

  function mountEditor(board, keepStep) {
    const host = $('wbpEditor'); if (!host || !board) return;
    const step = editor ? editor.step() : null;
    if (editor) editor.destroy();
    const paid = S().isPaid() === true;
    editor = WB().mount(host, board, {
      onChange: b => {
        if (!$('wbpTitle')) return;
        $('wbpTitle').value = b.title;
        if (b.steps.some(s => s.items.length)) scheduleSave();          // (a lesson that drew nothing is not saved)
      },
      onStep: () => { if ($('wbpTitle') && editor && !document.activeElement.isSameNode($('wbpTitle'))) $('wbpTitle').value = editor.board().title; },
      // Play: Lixa draws the board live and explains each step in her voice; a later step is drawn with the pen
      liveVoice: paid ? () => S().liveVoice() : null,
      liveDraw: paid,
      onLiveEnd: (finished, failed) => {
        if (!finished && liveAbort) liveAbort.abort();                   // (stopped: the AI stops writing too)
        if (failed) toast(failed, 'error');
      },
      aiPicture: S().pictureOn() ? async () => {
        const what = await askPicture(); if (!what) return null;
        try { const p = await S().makePicture(what); pictureBar(); toast('AI picture added.', 'success'); return p; }
        catch (e) { toast(e.message || 'The picture could not be made.', 'error'); return null; }
      } : null,
    });
    if (keepStep && step != null) editor.go(step);
    $('wbpTitle').value = editor.board().title;
    S().setCurrent(id, editor.board());
  }

  function askPicture() {
    return new Promise(resolve => {
      const bar = $('wbpPic');
      const row = document.createElement('div');
      row.className = 'wbp-ask wbp-picask';
      row.innerHTML = '<input class="wbp-input" maxlength="600" placeholder="What should the picture show? e.g. a patient doing a straight-leg raise"><button type="button" class="wbp-btn wbp-primary">Make it</button><button type="button" class="wbp-btn">Cancel</button>';
      bar.after(row);
      const input = row.querySelector('input'), [go, no] = row.querySelectorAll('button');
      const done = v => { row.remove(); resolve(v); };
      go.addEventListener('click', () => done(input.value.trim() || null));
      no.addEventListener('click', () => done(null));
      input.addEventListener('keydown', e => { if (e.key === 'Enter') done(input.value.trim() || null); if (e.key === 'Escape') done(null); });
      input.focus();
    });
  }

  function openBoard(board, boardId) {
    id = boardId || null;
    stage('board');
    mountEditor(board);
    $('wbpSaved').textContent = id ? 'Saved' : '';
    pictureBar();
  }

  async function openSaved(boardId) {
    stage('loading'); $('wbpStatus').textContent = 'Opening the board…';
    const r = await S().load(boardId).catch(() => null);
    if (!r) { stage('home'); showError('That board could not be found.'); renderList(); return; }
    openBoard(r.board, r.id);
  }

  /** The live lesson: the AI writes it and the board draws and explains each part as it arrives. */
  async function draw() {
    if (busy) return;
    const paid = S().isPaid();
    if (paid === false) { showPaid(); return; }
    if (paid === null) { showError('Checking your plan… try again in a moment.'); return; }
    const topic = $('wbpTopic').value.trim();
    if (topic.length < 3) { showError('Say what Lixa should explain.'); return; }
    showError(''); busy = true;
    const voice = S().liveVoice();                                      // (in the tap: the browser allows her voice now)
    openBoard({ title: topic.slice(0, 100), steps: [{ title: '…', items: [] }] }, null);
    const ctl = editor.live({ stream: true, voice });
    liveAbort = new AbortController();
    try {
      await S().liveGenerate({ topic, level: $('wbpLevel').value, steps: $('wbpSteps').value }, ctl, null, liveAbort.signal);
    } catch (e) {
      if (!(e && e.name === 'AbortError')) toast((e && e.message) || 'The lesson could not be written.', 'error');
    } finally { busy = false; liveAbort = null; }
  }

  async function change() {
    const input = $('wbpAsk'), what = input.value.trim();
    if (!what || busy || !editor) return;
    busy = true; $('wbpAskGo').disabled = true; $('wbpAskGo').textContent = 'Changing…';
    try {
      const next = await S().revise(editor.board(), what);
      input.value = '';
      mountEditor(next, true);
      scheduleSave();
      toast('Board updated.', 'success');
    } catch (e) { toast(e.message || 'The board could not be changed.', 'error'); }
    finally { busy = false; $('wbpAskGo').disabled = false; $('wbpAskGo').textContent = 'Change'; }
  }

  function on(el, ev, fn) { if (!el) return; el.addEventListener(ev, fn); cleanup.push(() => el.removeEventListener(ev, fn)); }

  function mount() {
    on($('wbpDraw'), 'click', draw);
    on($('wbpTopic'), 'keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) draw(); });
    on($('wbpBlank'), 'click', () => openBoard({ title: 'New board', steps: [{ title: 'Step 1', items: [] }] }, null));
    on($('wbpBack'), 'click', () => { if (editor) { editor.destroy(); editor = null; } stage('home'); renderList(); });
    on($('wbpList'), 'click', async e => {
      const o = e.target.closest('[data-open]'); if (o) { openSaved(o.dataset.open); return; }
      const d = e.target.closest('[data-del]');
      if (d && confirm('Delete this board? This cannot be undone.')) { await S().remove(d.dataset.del).catch(() => {}); renderList(); }
    });
    on($('wbpTitle'), 'change', () => { if (!editor) return; const b = editor.board(); b.title = $('wbpTitle').value.trim().slice(0, 100) || 'Whiteboard'; scheduleSave(); });
    on($('wbpAskGo'), 'click', change);
    on($('wbpAsk'), 'keydown', e => { if (e.key === 'Enter') change(); });
    on($('wbpPng'), 'click', () => editor && S().exportPNG(editor.board(), editor.step()).catch(e => toast(e.message, 'error')));
    on($('wbpPdf'), 'click', async () => { if (!editor) return; toast('Making the PDF…'); try { await S().exportPDF(editor.board()); } catch (e) { toast(e.message || 'The PDF could not be made.', 'error'); } });
    // the agent changed or opened the board while this page is showing
    const onBoard = e => {
      if (!e.detail || e.detail.source !== 'agent') return;
      const cur = S().current;
      if (!cur.board) return;
      if (editor && e.detail.id === id) { mountEditor(cur.board, true); return; }
      openBoard(cur.board, e.detail.id);
    };
    document.addEventListener('rehablix:whiteboard', onBoard);
    cleanup.push(() => document.removeEventListener('rehablix:whiteboard', onBoard));

    const params = new URLSearchParams(window.location.search);
    const want = params.get('board'), autoPlay = params.get('play') === '1';
    // (from the Lixa chat's card: the board plays at once, drawn and explained)
    const played = () => { if (autoPlay && editor && S().isPaid() === true) editor.play(); };
    const start = () => {
      if (want && window.RehablixRouter && window.RehablixRouter.clearQuery) window.RehablixRouter.clearQuery();
      if (S().isPaid() === false) { showPaid(); return; }
      if (want === 'local') {
        // a board made in the Lixa chat without an account: not saved, it lives for this visit only
        if (S().current.board) { openBoard(S().current.board, S().current.id); played(); }
        else { renderList(); showError('That board was not saved. Log in to keep your boards.'); }
      } else if (want) openSaved(want).then(played);
      else renderList();
    };
    // (the signed-in user may not be known yet on a fresh load)
    let started = false;
    const unsub = firebase.auth().onAuthStateChanged(() => { if (!started) { started = true; start(); } else if ($('wbpRoot') && $('wbpRoot').dataset.stage === 'home') renderList(); });
    cleanup.push(unsub);
    // the plan arrives a moment after the account: a free plan sees the plans card
    const onPlan = () => {
      const p = S().isPaid();
      if (p === false && $('wbpRoot') && $('wbpRoot').dataset.stage !== 'paid') showPaid();
      else if (p === true && $('wbpRoot') && $('wbpRoot').dataset.stage === 'paid') { stage('home'); renderList(); }
    };
    document.addEventListener('planUpdated', onPlan);
    cleanup.push(() => document.removeEventListener('planUpdated', onPlan));
  }

  function unmount() {
    clearTimeout(saveTimer);
    if (liveAbort) { liveAbort.abort(); liveAbort = null; }
    if (editor) {
      // (a change still waiting to be saved is saved now)
      if (unsaved && firebase.auth().currentUser) S().save(editor.board(), id).catch(() => {});
      editor.destroy(); editor = null;
    }
    cleanup.forEach(f => { try { f(); } catch (e) { /* best-effort */ } });
    cleanup = []; id = null; busy = false; unsaved = false;
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.whiteboard = { mount, unmount };
  // (Lixa Agent moves through the steps of the board on screen: js/lixa-agent/agent-brain.js)
  window.RehablixWhiteboardView = { editor: () => editor, boardId: () => id };
})();
