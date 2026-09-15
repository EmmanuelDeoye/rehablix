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

  async function fetchOpenAiToken() {
    const snap = await firebase.database().ref('tokens/open_ai').once('value');
    const data = snap.val();
    if (!data || !data.api_key) throw new Error('AI credentials are not configured.');
    return data.api_key;
  }

  async function callAIWithValidation(prompt, token, attempt) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: [
          { role: 'system', content: 'You output clean HTML with proper tables. No extra text.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: attempt === 1 ? 4000 : 5500
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
      if (attempt < 2) return callAIWithValidation(prompt, token, attempt + 1);
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
      const token = await fetchOpenAiToken();
      const prompt = buildPrompt(toolName, includeGuides);
      content = await callAIWithValidation(prompt, token, 1);
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
      keywords: ['standardized tool', 'standardized assessment', 'mmse', 'berg balance', 'outcome measure', 'rating scale']
    },
    requiredFields: [
      { key: 'toolName', prompt: 'Which standardized tool do you need (e.g. Berg Balance Scale, MMSE)?' }
    ],
    extractFromText(text) {
      const collected = {};
      if (text && text.trim()) collected.toolName = text.trim();
      collected.includeGuides = true;
      return collected;
    },
    generate,
    handleAction(actionId, card) {
      if (actionId === 'view-pdf' && card.html) viewHtmlContent(card.title, card.html);
    },
    openFromRecord(record) {
      if (record) viewHtmlContent(record.toolName, record.generatedContent);
    }
  };
})();
