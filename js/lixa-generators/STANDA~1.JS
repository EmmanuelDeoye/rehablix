// js/lixa-generators/standardized-gen.js — Lixa's "Standardized Tools" tool.
// Adapted from js/standardized.js (buildPrompt/callAIWithValidation/history
// + the PDF-viewer blob-window pattern used for viewing a generated tool).

(function () {
  function buildPrompt(toolName, includeGuides) {
    const guides = includeGuides
      ? 'Include detailed administration instructions and interpretation guidelines in separate sections.'
      : 'Provide only the assessment items and scoring criteria.';
    return `You are an expert in standardized clinical assessments.

Generate the complete content for the **${toolName}** assessment tool as a **self-contained HTML document**.

Requirements:
- Use proper HTML structure with <h2>, <h3>, <p>, <ul>, <ol>.
- Present any tables as proper HTML <table> with borders and alternating row colors for readability.
- Include the full name of the tool and its purpose at the top.
- List all items/questions exactly as they appear in the original tool.
- Include scoring instructions and interpretation (if available). ${guides}
- If the tool has subscales, present them clearly.
- Use a clean, professional style suitable for printing.
- Do NOT include any extra commentary outside the tool content.
- Return ONLY the HTML (no markdown, no explanations).`;
  }

  // Uses whichever of the 4 Lixa models the user has selected, instead of
  // always hardcoding the top-tier model — this tool is embedded in Lixa,
  // not a separate AI product with its own gating.
  async function callAIWithValidation(prompt, config, attempt) {
    const response = await fetch(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.token}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: 'You output clean HTML with proper tables. No extra text.' },
          { role: 'user', content: prompt }
        ],
        temperature: Math.min(config.temperature ?? 0.3, 0.3),
        max_tokens: config.maxTokens
      })
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    const choice = data.choices && data.choices[0];
    const content = ((choice && choice.message && choice.message.content) || '').replace(/```html|```/g, '').trim();
    if (choice && choice.finish_reason === 'content_filter') {
      throw new Error('The AI declined to generate this content — try again with a different tool name.');
    }
    if (content.length < 20) {
      if (attempt < 2) return callAIWithValidation(prompt, config, attempt + 1);
      throw new Error('The AI returned an empty response. Please try again.');
    }
    return content;
  }

  function viewHtmlContent(toolName, html) {
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${toolName} - rehablix</title>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif; padding:40px 20px; background:#fff; color:#1f2933; line-height:1.6; }
        .container { max-width:1200px; margin:0 auto; }
        table { border-collapse:collapse; width:100%; margin:20px 0; }
        th { background:#009688; color:#fff; padding:12px; text-align:left; }
        td { border:1px solid #ddd; padding:10px; vertical-align:top; }
        tr:nth-child(even) { background:#f9f9f9; }
        h1 { color:#009688; margin-bottom:20px; }
        h2,h3 { margin-top:24px; margin-bottom:10px; }
        .print-btn { position:fixed; bottom:20px; right:20px; background:#009688; color:#fff; border:none; padding:12px 24px; border-radius:50px; font-size:16px; font-weight:600; cursor:pointer; box-shadow:0 4px 12px rgba(0,0,0,0.15); }
        @media print { .print-btn { display:none; } body { padding:0; } }
      </style></head><body>
      <div class="container"><h1>${toolName}</h1>${html}</div>
      <button class="print-btn" onclick="window.print()">🖨️ Print / Save as PDF</button>
      </body></html>`;
    const blob = new Blob([fullHtml], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function generate(data) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Please log in to generate a standardized tool.' };

    const toolName = data.toolName.trim();
    const includeGuides = data.includeGuides !== false;
    const database = firebase.database();

    // Token-saving: reuse an existing copy of this exact tool if we have one.
    const existingSnap = await database.ref(`history/${user.uid}/standardizedTools`).once('value');
    const existingData = existingSnap.val() || {};
    const existingEntry = Object.entries(existingData).find(([, item]) =>
      (item.toolName || '').trim().toLowerCase() === toolName.toLowerCase());

    let content, recordId;
    if (existingEntry) {
      recordId = existingEntry[0];
      content = existingEntry[1].generatedContent;
    } else {
      await window.LixaCore.checkToolQuota();
      const config = await window.LixaCore.resolveToolModelConfig();
      if (!config) throw new Error('AI service is not configured.');
      const prompt = buildPrompt(toolName, includeGuides);
      content = await callAIWithValidation(prompt, config, 1);
      window.LixaCore.reportToolTokenUsage(prompt + content, config.weight);
      const historyItem = {
        toolName,
        includeGuides,
        generatedContent: content,
        preview: content.replace(/<[^>]*>/g, '').substring(0, 150),
        timestamp: new Date().toISOString(),
        userId: user.uid
      };
      const ref = database.ref(`history/${user.uid}/standardizedTools`).push();
      await ref.set(historyItem);
      recordId = ref.key;
    }

    return {
      ok: true,
      summary: existingEntry
        ? `You already had **${toolName}** saved — here it is:`
        : `Here's **${toolName}**:`,
      fileCard: {
        icon: '⚖️',
        title: toolName,
        meta: 'Standardized Tool',
        snippet: content.replace(/<[^>]*>/g, ' ').substring(0, 150).replace(/\s+/g, ' ').trim(),
        toolId: 'standardized',
        recordId,
        html: content,
        actions: [
          { type: 'button', id: 'view-pdf', label: 'Open PDF Viewer', primary: true, icon: 'fa-file-pdf' }
        ]
      }
    };
  }

  window.RehablixGenerators = window.RehablixGenerators || {};
  window.RehablixGenerators.standardized = {
    meta: {
      id: 'standardized',
      name: 'Standardized Tool',
      icon: '⚖️',
      description: 'Full copy of a standardized assessment (MMSE, Berg Balance Scale, etc.)',
      // A short list can't enumerate every scale a user might name, so this
      // combines (a) generic phrases that always mean "standardized tool"
      // and (b) the most commonly requested named scales in rehab practice.
      // `pattern` below (generic "generate/give me the X scale/index/test"
      // phrasing) is what actually catches names not on this list.
      keywords: [
        'standardized tool', 'standardized assessment', 'standardized test', 'standardised tool', 'standardised assessment',
        'outcome measure', 'rating scale', 'scoring tool', 'screening tool',
        'mmse', 'mini mental', 'moca', 'montreal cognitive',
        'berg balance', 'tinetti', 'mini-bestest', 'mini bestest', 'timed up and go', 'tug test',
        'barthel index', 'katz index', 'lawton', 'fim scale', 'functional independence measure',
        'oswestry', 'dash score', 'dash questionnaire', 'roland morris',
        'glasgow coma', 'gcs score', 'nihss', 'fugl-meyer', 'fugl meyer',
        'modified ashworth', 'visual analog scale', 'vas pain', 'numeric pain rating',
        'six minute walk', '6-minute walk', '6 minute walk test', 'gait speed test',
        'beck depression', 'beck anxiety', 'geriatric depression', 'pittsburgh sleep',
        'quick dash', 'shoulder pain and disability', 'spadi', 'womac', 'harris hip score'
      ],
      // Catches named scales not in the keyword list above, e.g. "generate
      // the Modified Fatigue Impact Scale" or "give me the ABC scale".
      pattern: /\b(generate|give|create|provide|show|need|want|build|make)\b[^.?!]{0,40}\b(the\s+)?[a-z][a-z\s-]{2,40}\b(scale|index|inventory|questionnaire|score|assessment tool)\b/i
    },
    requiredFields: [
      { key: 'toolName', prompt: 'Which standardized tool do you need (e.g. Berg Balance Scale, MMSE)?' }
    ],
    extractFromText(text) {
      const collected = {};
      if (text && text.trim()) {
        // Strip generic leading request-phrasing so the AI prompt gets a
        // clean tool name instead of the whole sentence, e.g. "can you
        // generate the Berg Balance Scale for me" -> "Berg Balance Scale".
        let cleaned = text.trim()
          .replace(/^(can|could|would)\s+you\s+/i, '')
          .replace(/^(please\s+)?(generate|give|create|provide|show|build|make)\s+me\s+/i, '')
          .replace(/^(please\s+)?(generate|give|create|provide|show|build|make)\s+/i, '')
          .replace(/^i\s+(need|want)\s+/i, '')
          .replace(/^the\s+/i, '')
          .replace(/\s+for\s+(me|my\s+(patient|client|assessment)s?)\.?$/i, '')
          .replace(/\s+(please|now)\.?$/i, '')
          .replace(/[.?!]+$/, '')
          .trim();
        collected.toolName = cleaned || text.trim();
      }
      collected.includeGuides = true;
      return collected;
    },
    statusStages: [
      'Looking up the assessment structure…',
      'Laying out items and scoring…',
      'Formatting for printing…'
    ],
    generate,
    handleAction(actionId, card) {
      if (actionId === 'view-pdf' && card.html) viewHtmlContent(card.title, card.html);
    },
    openFromRecord(record) {
      if (record) viewHtmlContent(record.toolName, record.generatedContent);
    }
  };
})();
