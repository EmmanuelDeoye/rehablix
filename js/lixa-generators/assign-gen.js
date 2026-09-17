// js/lixa-generators/assign-gen.js — Lixa's "Assignment Maker" tool.
// Adapted from js/assign.js's history schema (history/{uid}/assignments).
// Uses a single well-tuned generation pass rather than assign.js's full
// 3-pass draft→humanize→polish pipeline, to keep a chat turn responsive —
// still produces natural, properly structured academic writing.

(function () {
  function cleanAIResponse(raw) {
    let cleaned = (raw || '').replace(/```html?/gi, '').replace(/```/g, '').trim();
    if (typeof marked !== 'undefined' && !/^\s*</.test(cleaned)) cleaned = marked.parse(cleaned);
    return cleaned;
  }

  // Uses whichever of the 4 Lixa models the user has selected, instead of
  // always hardcoding DeepSeek — this tool is embedded in Lixa, not a
  // separate AI product with its own model/gating.
  async function callAI(systemPrompt, userPrompt, config) {
    const response = await fetch(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.token}` },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        max_tokens: config.maxTokens,
        temperature: config.temperature ?? 0.8,
        top_p: config.top_p ?? 0.95,
        frequency_penalty: 0.3,
        presence_penalty: 0.3
      })
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();
    if (content.length < 40) throw new Error('The AI returned an empty response. Please try again.');
    return content;
  }

  async function generate(data) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Please log in to generate an assignment.' };

    const topic = data.topic.trim();
    const course = data.course.trim();
    const tone = data.tone || 'professional';
    const volume = data.volume || '3 pages';

    const systemPrompt = `You are an expert academic writer helping a healthcare student complete an assignment. Write in a natural, human tone (${tone}) — vary sentence length and structure, avoid robotic phrasing and repetitive transitions, and avoid clichéd AI-writing patterns. Structure the piece with clear headings where appropriate. Target roughly ${volume} of content. Return well-formatted markdown.`;
    const userPrompt = `Course/Subject: ${course}\nAssignment topic: ${topic}\n\nWrite a complete, well-researched assignment on this topic, citing general/foundational knowledge appropriately (no fabricated specific citations).`;

    await window.LixaCore.checkToolQuota();
    const config = await window.LixaCore.resolveToolModelConfig();
    if (!config) throw new Error('AI service is not configured.');
    const markdown = await callAI(systemPrompt, userPrompt, config);
    window.LixaCore.reportToolTokenUsage(systemPrompt + userPrompt + markdown, config.weight);
    const html = cleanAIResponse(markdown);

    const historyItem = {
      topic,
      course,
      tone,
      volume,
      html,
      markdown,
      plainPreview: markdown.replace(/[#*`_>-]/g, ' ').replace(/\s+/g, ' ').slice(0, 150).trim(),
      timestamp: Date.now(),
      createdAt: firebase.database.ServerValue.TIMESTAMP
    };
    const ref = await firebase.database().ref(`history/${user.uid}/assignments`).push(historyItem);

    return {
      ok: true,
      summary: `Here's your assignment on **${topic}**:`,
      fileCard: {
        icon: '📝',
        title: topic,
        meta: `Assignment — ${course}`,
        snippet: historyItem.plainPreview,
        toolId: 'assignment',
        recordId: ref.key,
        actions: [
          { type: 'link', href: `index.html?type=answer&id=${ref.key}#/result`, label: 'Open & Edit', primary: true, external: true, icon: 'fa-pen-to-square' }
        ]
      }
    };
  }

  window.RehablixGenerators = window.RehablixGenerators || {};
  window.RehablixGenerators.assignment = {
    meta: {
      id: 'assignment',
      name: 'Assignment Maker',
      icon: '📝',
      description: 'Full academic assignment with a natural, human tone',
      keywords: ['assignment', 'essay', 'coursework', 'write my assignment', 'homework']
    },
    requiredFields: [
      { key: 'topic', prompt: 'What is the assignment topic?' },
      { key: 'course', prompt: 'Which course/subject is this for?' }
    ],
    extractFromText(text) {
      const collected = {};
      if (text && text.trim()) collected.topic = text.trim();
      return collected;
    },
    statusStages: [
      'Researching the topic…',
      'Drafting the assignment…',
      'Refining the writing style…',
      'Final polish…'
    ],
    generate
  };
})();
