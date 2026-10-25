// js/lixa-generators/whiteboard-gen.js — Lixa's Whiteboard from chat: "explain the gait cycle on a whiteboard",
// "draw me how an ACL tear happens". Lixa plans the lesson here (one AI call, on the chat's model and token budget);
// "Watch the lesson" opens it on the Whiteboard page, where she writes and teaches each scene, drawing and talking.
// Paid plans only. Android: whiteboard/WhiteboardTool.kt.
(function () {
  function adapter() {
    const core = window.LixaCore;
    return { resolve: () => core.resolveToolModelConfig(), check: () => core.checkToolQuota(), report: (text, weight) => core.reportToolTokenUsage(text, weight) };
  }

  /** short | moderate | long | auto, from how the request is worded. */
  function detectLength(text) {
    const t = String(text || '').toLowerCase();
    if (/\b(short|brief|quick|quickly|in a nutshell|summary|summarise|summarize|1[- ]?min(ute)?)\b/.test(t)) return 'short';
    if (/\b(long|detailed|in[- ]depth|thorough|comprehensive|deep dive|everything about|full lesson|10[- ]?min(ute)?s?)\b/.test(t)) return 'long';
    if (/\b(moderate|medium|normal length|5[- ]?min(ute)?s?)\b/.test(t)) return 'moderate';
    return 'auto';
  }

  function cardFor(lesson, id, updated) {
    return {
      icon: '🖍️',
      title: lesson.title,
      meta: lesson.scenes.length + ' scenes · Whiteboard lesson' + (updated ? ' · Updated' : ''),
      snippet: lesson.scenes.map(s => s.title).filter(Boolean).slice(0, 5).join(' → '),
      toolId: 'whiteboard',
      recordId: id,
      actions: [
        // (it opens playing: Lixa draws and explains it)
        { type: 'link', href: window.RehablixWhiteboardService.link(id || 'local', true), label: 'Watch the lesson', icon: 'fa-chalkboard' },
      ],
    };
  }

  async function generate(data) {
    const Service = window.RehablixWhiteboardService;
    if (!Service || !window.RehablixWhiteboard) return { ok: false, error: 'The whiteboard is not available right now.' };
    if (!firebase.auth().currentUser) return { ok: false, error: 'Please log in to use the whiteboard. ' + Service.PAID_TEXT };
    if (Service.isPaid() === false) return { ok: false, error: Service.PAID_TEXT + ' You can upgrade under Plans.' };
    const request = [data.content, data.source ? 'Use this material:\n' + String(data.source).slice(0, 8000) : '', data.additionalInstructions || ''].filter(Boolean).join('\n\n');
    const lesson = await Service.planLesson({ request, length: data.length || detectLength(data.content), level: data.audience || '' }, adapter());
    const id = await Service.save(lesson).catch(() => null);
    Service.setCurrent(id, lesson, 'agent');
    return {
      ok: true,
      summary: `Your whiteboard lesson is ready: **${lesson.title}**, ${lesson.scenes.length} scenes. Tap **Watch the lesson** and I'll draw and explain it for you, step by step. You can pause, skip and ask me questions while it plays.`,
      fileCard: cardFor(lesson, id, false),
    };
  }

  // A change from chat ("make it longer", "use simpler words", "add a patient example"): the lesson is planned again
  // with the change, and taught afresh when it is opened.
  async function edit(recordId, instruction) {
    const Service = window.RehablixWhiteboardService;
    const rec = await Service.load(recordId);
    if (!rec) return { ok: false, error: 'The original lesson could not be found.' };
    const len = detectLength(instruction);
    const next = await Service.planLesson({ request: rec.lesson.request + '\n\nCHANGE ASKED FOR: ' + instruction, length: len !== 'auto' ? len : rec.lesson.length, level: rec.lesson.level }, adapter());
    await Service.save(next, recordId);
    Service.setCurrent(recordId, next, 'agent');
    return { ok: true, summary: `Updated **${next.title}**:`, fileCard: cardFor(next, recordId, true) };
  }

  window.RehablixGenerators = window.RehablixGenerators || {};
  window.RehablixGenerators.whiteboard = {
    meta: {
      id: 'whiteboard',
      name: 'Whiteboard',
      icon: '🖍️',
      description: 'A live, hand-drawn whiteboard lesson: Lixa draws and explains anything, the way you ask',
      keywords: ['whiteboard', 'white board', 'visual explanation', 'explain visually'],
      pattern: /\bwhite\s*board\b|\b(draw|sketch|illustrate)\s+(me\s+)?(a\s+|an\s+|the\s+)?(diagram|picture|visual|how|it|this)\b|\bexplain\b[\s\S]{0,80}\b(visually|on\s+(a|the)\s+(white\s*)?board|with\s+(a\s+)?diagrams?)\b|\bvisual(ly)?\s+explanation\b/i,
    },
    requiredFields: [
      { key: 'content', prompt: 'What should I teach on the whiteboard, and how? (e.g. "the gait cycle, simply, with everyday examples")' },
    ],
    extractFromText(text) {
      const collected = {};
      const rest = (text || '').replace(/\b(please|can you|could you|explain|draw|sketch|illustrate|show|teach|make|create|me|a|an|the|on|in|with|using|whiteboard|white board|board|diagrams?|visually|visual|explanation|step[- ]by[- ]step|how|it|this)\b/gi, ' ').replace(/[^\w]+/g, ' ').trim();
      if (rest.length >= 3) collected.content = text.trim();
      const len = detectLength(text); if (len !== 'auto') collected.length = len;
      return collected;
    },
    statusStages: ['Planning your lesson…', 'Picking the best way to show it…'],
    editStatusStages: ['Reading the lesson…', 'Planning it again…'],
    generate,
    edit,
  };
})();
