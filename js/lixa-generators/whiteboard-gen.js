// js/lixa-generators/whiteboard-gen.js — Lixa's Whiteboard tool: "explain the gait cycle on a whiteboard",
// "draw how an ACL tear happens" straight from chat. The board opens on the Whiteboard page (#/whiteboard), the
// same board Lixa Agent works on. Written by the model chosen in Lixa's composer, on the same token budget as a chat
// turn (LixaCore.checkToolQuota / resolveToolModelConfig / reportToolTokenUsage). Android: whiteboard/WhiteboardTool.kt.
(function () {
  function adapter() {
    const core = window.LixaCore;
    return {
      resolve: () => core.resolveToolModelConfig(),
      check: () => core.checkToolQuota(),
      report: (text, weight) => core.reportToolTokenUsage(text, weight),
    };
  }

  function detectSteps(text) {
    const m = (text || '').match(/\b(\d{1,2})\s*[- ]?\s*steps?\b/i);
    return m ? Math.max(2, Math.min(12, parseInt(m[1], 10))) : 0;
  }

  function cardFor(board, id, updated) {
    return {
      icon: '🖍️',
      title: board.title,
      meta: board.steps.length + ' steps · Whiteboard' + (updated ? ' · Updated' : ''),
      snippet: board.steps.map(s => s.title).filter(Boolean).slice(0, 4).join(' → '),
      toolId: 'whiteboard',
      recordId: id,
      actions: [
        // (not saved, when logged out: the board open now, kept in memory for this visit)
        // (it opens playing: Lixa draws and explains it)
        { type: 'link', href: 'index.html?board=' + (id || 'local') + '&play=1#/whiteboard', label: 'Watch the lesson', icon: 'fa-chalkboard' },
        { type: 'button', id: 'download-png', label: 'Download PNG', icon: 'fa-image' },
      ],
    };
  }

  async function generate(data) {
    const Service = window.RehablixWhiteboardService;
    if (!Service || !window.RehablixWhiteboard) return { ok: false, error: 'The whiteboard is not available right now.' };
    if (!firebase.auth().currentUser) return { ok: false, error: 'Please log in to use the whiteboard. ' + Service.PAID_TEXT };
    if (Service.isPaid() === false) return { ok: false, error: Service.PAID_TEXT + ' You can upgrade under Plans.' };
    const board = await Service.generate({
      topic: data.content,
      content: data.source || '',
      level: data.audience || '',
      steps: data.steps || detectSteps(data.content),
      instructions: data.additionalInstructions || '',
    }, adapter());
    const id = firebase.auth().currentUser ? await Service.save(board).catch(() => null) : null;
    Service.setCurrent(id, board, 'agent');
    return {
      ok: true,
      summary: `Here's your whiteboard lesson, **${board.title}**: ${board.steps.length} steps. Tap **Watch the lesson** and I'll draw and explain it live, step by step. You can pause it, draw on it and change it.`,
      fileCard: cardFor(board, id, false),
    };
  }

  // Edit-in-place: "add a step about the swing phase", "label the patella", "make it simpler"…
  async function edit(recordId, instruction) {
    const Service = window.RehablixWhiteboardService;
    const rec = await Service.load(recordId);
    if (!rec) return { ok: false, error: 'The original whiteboard could not be found.' };
    const next = await Service.revise(rec.board, instruction, adapter());
    await Service.save(next, recordId);
    Service.setCurrent(recordId, next, 'agent');
    return { ok: true, summary: `Updated **${next.title}**:`, fileCard: cardFor(next, recordId, true) };
  }

  async function handleAction(actionId, card) {
    if (actionId !== 'download-png') return;
    const core = window.LixaCore, Service = window.RehablixWhiteboardService;
    try {
      const rec = card.recordId ? await Service.load(card.recordId) : (Service.current.board ? { board: Service.current.board } : null);
      if (!rec) { core.showToast('That whiteboard could not be found. Ask me to draw it again.', 'error'); return; }
      await Service.exportPNG(rec.board);
      core.showToast('The whiteboard picture is in your downloads.', 'success');
    } catch (err) {
      core.showToast((err && err.message) || 'Could not make the picture.', 'error');
    }
  }

  window.RehablixGenerators = window.RehablixGenerators || {};
  window.RehablixGenerators.whiteboard = {
    meta: {
      id: 'whiteboard',
      name: 'Whiteboard',
      icon: '🖍️',
      description: 'A visual, step-by-step explanation on a whiteboard: diagrams, labels, arrows and notes',
      keywords: ['whiteboard', 'white board', 'visual explanation', 'explain visually'],
      pattern: /\bwhite\s*board\b|\b(draw|sketch|illustrate)\s+(me\s+)?(a\s+|an\s+|the\s+)?(diagram|picture|visual|how|it|this)\b|\bexplain\b[\s\S]{0,80}\b(visually|on\s+(a|the)\s+(white\s*)?board|with\s+(a\s+)?diagrams?)\b|\bvisual(ly)?\s+explanation\b/i,
    },
    requiredFields: [
      { key: 'content', prompt: 'What should I explain on the whiteboard? Give me a topic (e.g. "the gait cycle" or "how a rotator cuff tear happens").' },
    ],
    extractFromText(text) {
      const collected = {};
      const rest = (text || '').replace(/\b(please|can you|could you|explain|draw|sketch|illustrate|show|teach|make|create|me|a|an|the|on|in|with|using|whiteboard|white board|board|diagrams?|visually|visual|explanation|step[- ]by[- ]step|how|it|this)\b/gi, ' ').replace(/[^\w]+/g, ' ').trim();
      if (rest.length >= 3) collected.content = text.trim();
      const n = detectSteps(text); if (n) collected.steps = n;
      return collected;
    },
    statusStages: ['Planning the board…', 'Choosing diagrams and labels…', 'Drawing it step by step…'],
    editStatusStages: ['Reading the board…', 'Applying your changes…', 'Redrawing…'],
    generate,
    edit,
    handleAction,
  };
})();
