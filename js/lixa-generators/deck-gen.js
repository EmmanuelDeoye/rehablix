// js/lixa-generators/deck-gen.js — Lixa's "Deck Studio" tool: "make me a
// PowerPoint on …" straight from chat.
//
// The content is written by the SAME model the user picked in Lixa's
// composer and counted against the SAME token budget as a chat turn
// (LixaCore.checkToolQuota / resolveToolModelConfig / reportToolTokenUsage).
// The slides themselves are designed locally by js/deck/deck-engine.js, so
// downloading the .pptx costs nothing.
(function () {
  function adapter() {
    const core = window.LixaCore;
    return {
      resolve: () => core.resolveToolModelConfig(),
      check: () => core.checkToolQuota(),
      report: (text, weight) => core.reportToolTokenUsage(text, weight),
    };
  }

  function themeName(id) {
    const t = window.RehablixDeck && window.RehablixDeck.THEMES[id];
    return (t && t.name) || 'Auto';
  }

  function detectStyle(text) {
    const Deck = window.RehablixDeck;
    const lower = (text || '').toLowerCase();
    return Object.keys(Deck.THEMES).find((id) => new RegExp('\\b' + id + '\\b(?:\\s+(?:style|theme))?').test(lower) && /\b(style|theme|look)\b/.test(lower)) || '';
  }

  function detectCount(text) {
    const m = (text || '').match(/\b(\d{1,2})\s*[- ]?\s*(?:slides?|pages?)\b/i);
    return m ? Math.max(6, Math.min(20, parseInt(m[1], 10))) : 0;
  }

  function cardFor(spec, theme, id, updated) {
    return {
      icon: '🎞️',
      title: spec.title,
      meta: spec.slides.length + ' slides · ' + themeName(theme) + (updated ? ' · Updated' : ''),
      snippet: spec.subtitle || spec.slides.slice(1, 4).map((s) => s.title).filter(Boolean).join(' · '),
      toolId: 'deck',
      recordId: id,
      deckTheme: theme,
      actions: [
        { type: 'button', id: 'download-pptx', label: 'Download PPTX', primary: true, icon: 'fa-download' },
        ...(id ? [{ type: 'link', href: 'index.html?deck=' + id + '#/deck', label: 'Preview & restyle', icon: 'fa-images' }] : []),
      ],
    };
  }

  async function generate(data) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Please log in to create a presentation.' };
    const Deck = window.RehablixDeck, Service = window.RehablixDeckService;
    if (!Deck || !Service) return { ok: false, error: 'The presentation designer is not available right now.' };

    const spec = await Service.generateSpec({
      topic: data.content,
      content: data.source || '',
      audience: data.audience || '',
      slideCount: data.slideCount || detectCount(data.content) || 10,
      style: data.style || detectStyle(data.content),
      instructions: data.additionalInstructions || '',
    }, adapter());
    const theme = Deck.chooseTheme(spec, data.style || detectStyle(data.content));
    spec.style = theme;
    const id = await Service.save(spec, theme).catch(() => null);
    return {
      ok: true,
      summary: `Here's your presentation, **${spec.title}**: ${spec.slides.length} designed slides in the ${themeName(theme)} style. Download it as PowerPoint, or open it to preview and change the style.`,
      fileCard: cardFor(spec, theme, id, false),
    };
  }

  // Edit-in-place: "add a slide about outcome measures", "make it shorter"…
  async function edit(recordId, instruction) {
    const Service = window.RehablixDeckService, Deck = window.RehablixDeck;
    const rec = await Service.load(recordId);
    if (!rec) return { ok: false, error: 'The original deck could not be found.' };
    const wanted = detectStyle(instruction);
    const next = await Service.reviseSpec(rec.spec, instruction, adapter());
    const theme = wanted || (Deck.THEMES[rec.theme] ? rec.theme : Deck.chooseTheme(next));
    next.style = theme;
    await Service.save(next, theme, recordId);
    return { ok: true, summary: `Updated **${next.title}**:`, fileCard: cardFor(next, theme, recordId, true) };
  }

  async function handleAction(actionId, card) {
    if (actionId !== 'download-pptx') return;
    const core = window.LixaCore, Service = window.RehablixDeckService;
    try {
      const rec = card.recordId ? await Service.load(card.recordId) : null;
      if (!rec) { core.showToast('That deck could not be found. Ask me to create it again.', 'error'); return; }
      core.showToast('Building your PowerPoint…', 'info');
      await Service.download(rec.spec, rec.theme || card.deckTheme);
      core.showToast('Your PowerPoint is in your downloads.', 'success');
    } catch (err) {
      core.showToast((err && err.message) || 'Could not build the PowerPoint file.', 'error');
    }
  }

  window.RehablixGenerators = window.RehablixGenerators || {};
  window.RehablixGenerators.deck = {
    meta: {
      id: 'deck',
      name: 'Deck Studio',
      icon: '🎞️',
      description: 'A designed, presentation-ready PowerPoint from a topic or your notes',
      keywords: ['powerpoint', 'power point', 'pptx', 'slide deck', 'slides', 'slideshow', 'deck'],
      pattern: /\b(make|create|generate|build|design|prepare|produce|draft|need|want)\b[\s\S]{0,60}\b(power\s*point|pptx?|slide\s*deck|slides?|slideshow|deck)\b/i,
    },
    requiredFields: [
      { key: 'content', prompt: 'What should the presentation be about? Give me a topic, or paste your notes.' },
    ],
    extractFromText(text) {
      const collected = {};
      // Only the tool name with nothing else ("make a powerpoint") isn't a topic yet.
      const rest = (text || '').replace(/\b(please|can you|could you|make|create|generate|build|design|prepare|produce|draft|me|a|an|the|i|need|want|some|for|of|on|about|power\s*point|pptx?|slide\s*deck|slides?|slideshow|deck|presentation)\b/gi, ' ').replace(/[^\w]+/g, ' ').trim();
      if (rest.length >= 3) collected.content = text.trim();
      const n = detectCount(text); if (n) collected.slideCount = n;
      const st = detectStyle(text); if (st) collected.style = st;
      return collected;
    },
    statusStages: ['Planning the story…', 'Writing each slide…', 'Choosing layouts and visuals…', 'Designing your deck…'],
    editStatusStages: ['Reading the current deck…', 'Applying your changes…', 'Redesigning the slides…'],
    generate,
    edit,
    handleAction,
  };
})();
