// js/views/deck-view.js — "Deck Studio": the AI presentation designer.
// Registered as the "deck" SPA view (index.html#/deck).
//
//   topic / notes ──AI (1 call, token budget)──► deck JSON ──engine──► preview + .pptx
//
// The AI only writes the content. js/deck/deck-engine.js designs every slide
// locally, so restyling, previewing and exporting never cost tokens.
// Deep link: index.html?deck=<id>#/deck opens a saved deck.
(function () {
  let cleanupFns = [];

  function mount() {
    const $ = (id) => document.getElementById(id);
    const Deck = window.RehablixDeck, Service = window.RehablixDeckService;
    const root = $('deckRoot');
    if (!root || !Deck || !Service) return;

    const topicEl = $('deckTopic'), sourceEl = $('deckSource'), sourceWrap = $('deckSourceWrap');
    const audienceEl = $('deckAudience'), countEl = $('deckCount');
    const stylesEl = $('deckStyles'), restyleEl = $('deckRestyle');
    const generateBtn = $('deckGenerateBtn');
    const formEl = $('deckForm'), progressEl = $('deckProgress'), progressText = $('deckProgressText'), progressBar = $('deckProgressBar');
    const resultEl = $('deckResult'), titleEl = $('deckTitle'), metaEl = $('deckMeta'), slidesEl = $('deckSlides');
    const downloadBtn = $('deckDownloadBtn'), newBtn = $('deckNewBtn');
    const reviseInput = $('deckReviseInput'), reviseBtn = $('deckReviseBtn');
    const recentEl = $('deckRecent'), recentList = $('deckRecentList');
    const loadingEl = $('deckLoading'), loadingText = $('deckLoadingText');
    const lightbox = $('deckLightbox'), lightboxStage = $('deckLightboxStage'), lightboxCount = $('deckLightboxCount');

    let chosenStyle = '';        // '' = let the AI / engine choose
    let spec = null, deckId = null, activeTheme = '';
    let slideHtml = [], lightboxIndex = 0;
    let busy = false, abort = null, renderToken = 0;

    function on(el, ev, fn) { if (!el) return; el.addEventListener(ev, fn); cleanupFns.push(() => el.removeEventListener(ev, fn)); }
    function esc(s) { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }

    function showToast(message, type, duration) {
      type = type || 'success';
      let container = document.getElementById('toast-container');
      if (!container) { container = document.createElement('div'); container.id = 'toast-container'; document.body.appendChild(container); }
      const toast = document.createElement('div');
      toast.className = 'toast ' + type;
      const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle';
      toast.innerHTML = '<i class="fas fa-' + icon + '"></i><span>' + esc(message) + '</span>';
      container.appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity .3s'; setTimeout(() => toast.remove(), 300); }, duration || 3500);
    }

    // ---- style chips (form: with "Auto"; result: restyle instantly) ----
    function swatch(id) {
      const t = Deck.THEMES[id];
      const s = t.swatch || [t.bg[0], t.primary, t.accent];
      return 'background:linear-gradient(135deg,#' + s[0] + ' 0%,#' + s[0] + ' 45%,#' + s[1] + ' 46%,#' + s[1] + ' 78%,#' + s[2] + ' 79%);';
    }
    function label(id) { const t = Deck.THEMES[id]; return (t && t.name) || (id.charAt(0).toUpperCase() + id.slice(1)); }
    function chips(withAuto, selected) {
      const ids = Object.keys(Deck.THEMES);
      return (withAuto ? '<button type="button" class="deck-chip' + (!selected ? ' active' : '') + '" role="radio" aria-checked="' + (!selected) + '" data-style=""><span class="deck-swatch deck-swatch-auto"><i class="fas fa-magic"></i></span>Auto</button>' : '') +
        ids.map((id) => '<button type="button" class="deck-chip' + (selected === id ? ' active' : '') + '" role="radio" aria-checked="' + (selected === id) + '" data-style="' + id + '" title="' + esc(Deck.THEMES[id].mood || '') + '"><span class="deck-swatch" style="' + swatch(id) + '"></span>' + esc(label(id)) + '</button>').join('');
    }
    function paintChips() {
      stylesEl.innerHTML = chips(true, chosenStyle);
      restyleEl.innerHTML = chips(false, activeTheme);
      slidesEl.removeAttribute('aria-busy');
    }
    on(stylesEl, 'click', (e) => {
      const b = e.target.closest('.deck-chip'); if (!b) return;
      chosenStyle = b.dataset.style || '';
      paintChips();
    });
    on(restyleEl, 'click', (e) => {
      const b = e.target.closest('.deck-chip'); if (!b || !spec || busy) return;
      activeTheme = b.dataset.style;
      spec.style = activeTheme;
      paintChips();
      renderPreview();
      if (deckId) Service.save(spec, activeTheme, deckId).catch(() => {});
    });

    // ---- stages ----
    function setProgress(p, text) {
      if (progressText && text) progressText.textContent = text;
      if (progressBar) progressBar.style.width = Math.round(Math.max(0.04, Math.min(1, p)) * 100) + '%';
    }
    function show(stage) {
      formEl.hidden = stage !== 'form';
      progressEl.hidden = stage !== 'progress';
      if (loadingEl) loadingEl.hidden = stage !== 'loading';
      resultEl.hidden = stage !== 'result';
      recentEl.hidden = stage !== 'form' || !recentList.children.length;
      root.dataset.stage = stage;
    }

    async function renderPreview() {
      const token = ++renderToken;
      titleEl.textContent = spec.title;
      // Placeholder frames while the slides are being drawn.
      slidesEl.innerHTML = spec.slides.map(() => '<div class="deck-slide deck-slide-skeleton" aria-hidden="true"></div>').join('');
      slidesEl.setAttribute('aria-busy', 'true');
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const pv = await Deck.previewHtml(spec, { style: activeTheme });
      if (token !== renderToken) return;
      activeTheme = pv.theme;
      slideHtml = pv.slides;
      titleEl.textContent = spec.title;
      metaEl.textContent = spec.slides.length + ' slides · ' + label(activeTheme) + ' style';
      slidesEl.innerHTML = slideHtml.map((h, i) => '<button type="button" class="deck-slide" data-i="' + i + '" aria-label="Open slide ' + (i + 1) + '"><span class="deck-slide-frame">' + h + '</span><span class="deck-slide-no">' + (i + 1) + '</span></button>').join('');
      restyleEl.innerHTML = chips(false, activeTheme);
    }

    // Opening a saved deck (deep link, Recent list, Lixa's "Preview & restyle").
    async function openSaved(id) {
      if (loadingText) loadingText.textContent = 'Opening your deck…';
      show('loading');
      let d = null;
      try { d = await Service.load(id); } catch (e) { d = null; }
      if (d) { openDeck(d.spec, d.id, d.theme); return true; }
      showToast('That deck could not be opened.', 'error');
      show('form');
      return false;
    }

    function openDeck(nextSpec, id, theme) {
      spec = nextSpec; deckId = id || null; activeTheme = theme || '';
      show('result');
      renderPreview();
      // The SPA scrolls its view host, not the window.
      const scroller = root.closest('#transientHost') || document.scrollingElement;
      if (scroller) scroller.scrollTop = 0;
    }

    // ---- generate ----
    async function generate() {
      if (busy) return;
      const topic = topicEl.value.trim(), content = sourceEl.value.trim();
      if (!topic && !content) { showToast('Tell me what the presentation is about, or paste your notes.', 'error'); topicEl.focus(); return; }
      if (!firebase.auth().currentUser) { showToast('Please log in to create a presentation.', 'error'); return; }
      busy = true; generateBtn.disabled = true;
      abort = new AbortController();
      show('progress');
      const stages = ['Planning the story…', 'Writing each slide…', 'Choosing layouts and visuals…', 'Checking balance and readability…'];
      let k = 0; setProgress(0.08, stages[0]);
      const tick = setInterval(() => { k = Math.min(stages.length - 1, k + 1); setProgress(0.08 + k * 0.2, stages[k]); }, 4500);
      try {
        const next = await Service.generateSpec({ topic, content, audience: audienceEl.value.trim(), slideCount: countEl.value, style: chosenStyle }, null, abort.signal);
        setProgress(0.9, 'Designing your slides…');
        const theme = Deck.chooseTheme(next, chosenStyle);
        next.style = theme;
        const id = await Service.save(next, theme).catch(() => null);
        openDeck(next, id, theme);
        loadRecent();
        if (window.RehablixNotify) window.RehablixNotify.aiTaskDone('Your deck is ready', next.title, id ? 'index.html?deck=' + id + '#/deck' : 'index.html#/deck');
      } catch (err) {
        if (!err || err.name !== 'AbortError') showToast((err && err.message) || 'Could not create the presentation. Please try again.', 'error', 6000);
        show('form');
      } finally {
        clearInterval(tick);
        busy = false; generateBtn.disabled = false; abort = null;
      }
    }
    on(generateBtn, 'click', generate);
    on($('deckCancelBtn'), 'click', () => { if (abort) abort.abort(); });

    // ---- revise (one more AI call, same token budget) ----
    async function revise() {
      const instruction = reviseInput.value.trim();
      if (busy || !spec || !instruction) return;
      busy = true; reviseBtn.disabled = true;
      const original = reviseBtn.innerHTML;
      reviseBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      try {
        const next = await Service.reviseSpec(spec, instruction);
        next.style = Deck.THEMES[activeTheme] ? activeTheme : next.style;
        spec = next;
        reviseInput.value = '';
        await renderPreview();
        if (deckId) await Service.save(spec, activeTheme, deckId).catch(() => {});
        showToast('Deck updated');
      } catch (err) {
        showToast((err && err.message) || 'Could not apply that change.', 'error', 6000);
      } finally {
        busy = false; reviseBtn.disabled = false; reviseBtn.innerHTML = original;
      }
    }
    on(reviseBtn, 'click', revise);
    on(reviseInput, 'keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); revise(); } });

    // ---- export ----
    on(downloadBtn, 'click', async () => {
      if (!spec || busy) return;
      busy = true; downloadBtn.disabled = true;
      const original = downloadBtn.innerHTML;
      try {
        await Service.download(spec, activeTheme, (p, msg) => { downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + Math.round(p * 100) + '%'; });
        showToast('Your PowerPoint is in your downloads.');
      } catch (err) {
        showToast((err && err.message) || 'Could not build the PowerPoint file.', 'error', 6000);
      } finally {
        busy = false; downloadBtn.disabled = false; downloadBtn.innerHTML = original;
      }
    });

    on(newBtn, 'click', () => { spec = null; deckId = null; activeTheme = ''; show('form'); loadRecent(); topicEl.focus(); });

    // ---- lightbox ----
    function showSlide(i) {
      lightboxIndex = (i + slideHtml.length) % slideHtml.length;
      lightboxStage.innerHTML = slideHtml[lightboxIndex];
      lightboxCount.textContent = (lightboxIndex + 1) + ' / ' + slideHtml.length;
    }
    function closeLightbox() { lightbox.hidden = true; lightboxStage.innerHTML = ''; }
    on(slidesEl, 'click', (e) => { const b = e.target.closest('.deck-slide'); if (!b) return; lightbox.hidden = false; showSlide(parseInt(b.dataset.i, 10)); });
    on($('deckLightboxPrev'), 'click', () => showSlide(lightboxIndex - 1));
    on($('deckLightboxNext'), 'click', () => showSlide(lightboxIndex + 1));
    on($('deckLightboxClose'), 'click', closeLightbox);
    on(lightbox, 'click', (e) => { if (e.target === lightbox) closeLightbox(); });
    on(document, 'keydown', (e) => {
      if (lightbox.hidden) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowRight') showSlide(lightboxIndex + 1);
      else if (e.key === 'ArrowLeft') showSlide(lightboxIndex - 1);
    });

    // ---- recent decks ----
    async function loadRecent() {
      if (!recentList.children.length && root.dataset.stage === 'form') {
        recentList.innerHTML = '<div class="deck-recent-item deck-recent-skeleton"></div><div class="deck-recent-item deck-recent-skeleton"></div>';
        recentEl.hidden = false;
      }
      try {
        const items = await Service.list(8);
        recentList.innerHTML = items.map((d) => '<div class="deck-recent-item" data-id="' + d.id + '">' +
          '<button type="button" class="deck-recent-open"><span class="deck-swatch" style="' + (Deck.THEMES[d.theme] ? swatch(d.theme) : '') + '"></span><span class="deck-recent-text"><span class="deck-recent-title">' + esc(d.title) + '</span><span class="deck-recent-meta">' + d.slideCount + ' slides · ' + new Date(d.updatedAt).toLocaleDateString() + '</span></span></button>' +
          '<button type="button" class="deck-recent-del" aria-label="Delete ' + esc(d.title) + '" title="Delete"><i class="fas fa-trash"></i></button></div>').join('');
      } catch (e) { recentList.innerHTML = ''; }
      recentEl.hidden = root.dataset.stage !== 'form' || !recentList.children.length;
    }
    on(recentList, 'click', async (e) => {
      const row = e.target.closest('.deck-recent-item'); if (!row || busy) return;
      const id = row.dataset.id;
      if (e.target.closest('.deck-recent-del')) {
        const ok = window.RehablixModal && window.RehablixModal.confirm ? await window.RehablixModal.confirm('Delete this deck? This cannot be undone.') : window.confirm('Delete this deck? This cannot be undone.');
        if (!ok) return;
        await Service.remove(id).catch(() => {});
        loadRecent();
        return;
      }
      await openSaved(id);
    });

    // ---- start ----
    paintChips();
    show('form');
    const handoff = Service.takeHandoff();
    if (handoff) {
      if (handoff.title) topicEl.value = handoff.title;
      sourceEl.value = handoff.content || '';
      if (sourceWrap) sourceWrap.open = true;
    }
    const wantedId = new URLSearchParams(window.location.search).get('deck');
    let opened = false;
    if (wantedId) show('loading');   // until sign-in is restored and the deck is fetched
    const unsub = firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) { recentList.innerHTML = ''; recentEl.hidden = true; if (root.dataset.stage === 'loading') show('form'); return; }
      if (wantedId && !opened) {
        opened = true;
        await openSaved(wantedId);
      }
      loadRecent();
    });
    cleanupFns.push(unsub);
    cleanupFns.push(() => { if (abort) abort.abort(); renderToken++; });
  }

  function unmount() {
    cleanupFns.forEach((fn) => { try { fn(); } catch (e) { /* best-effort */ } });
    cleanupFns = [];
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.deck = { mount, unmount };
})();
