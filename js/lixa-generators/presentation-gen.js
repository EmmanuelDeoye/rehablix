// js/lixa-generators/presentation-gen.js — Lixa's "Presentation Maker" tool
// (covers presentation/report/documentation modes). Adapted from
// js/presentation.js's generatePresentation()/saveToHistory(), and reuses
// the same pptExportData → localStorage → ppt-export.html handoff pattern
// as js/result.js for the "Export to PPTX" action.

(function () {
  const MODE_LABELS = { presentation: 'Case Presentation', report: 'Clinical Report', documentation: 'Documentation' };

  function detectMode(text) {
    const lower = (text || '').toLowerCase();
    if (/\b(slide|slides|deck|powerpoint|pptx|ward round)\b/.test(lower)) return 'presentation';
    if (/\b(document|note|soap note|admission note)\b/.test(lower)) return 'documentation';
    return 'report';
  }

  async function fetchDeepSeekToken() {
    const snap = await firebase.database().ref('tokens/deepseek').once('value');
    const data = snap.val();
    if (!data || !data.api_key) throw new Error('AI credentials are not configured.');
    return data.api_key;
  }

  async function callAIWithValidation(messages, token, maxTokens, attempt) {
    const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ model: 'deepseek-v4-flash', messages, max_tokens: maxTokens, temperature: 0.3, top_p: 0.9 })
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();
    if (content.length < 20) {
      if (attempt < 2) return callAIWithValidation(messages, token, maxTokens + 1000, attempt + 1);
      throw new Error('The AI returned an empty response. Please try again.');
    }
    return content;
  }

  async function generate(data) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Please log in to generate a presentation/report.' };

    const mode = data.mode || detectMode(data.content);
    const modeText = MODE_LABELS[mode] || 'Clinical Document';
    const patientName = data.patientName || 'Patient';
    const profession = data.profession || 'Healthcare Professional';
    const diagnosis = data.diagnosis || 'Not specified';

    const systemPrompt = `You are an expert clinical assistant helping a ${profession} prepare a **${modeText}**.

CRITICAL INSTRUCTIONS:
0. FIDELITY RULE: Do NOT invent or assume any clinical information not provided. If data is missing, state "not provided".
1. Follow a standard SOAP-style or clinically appropriate outline for a ${modeText.toLowerCase()}.
2. Be comprehensive: substantial content per section, specific clinical details, clear reasoning, actionable recommendations.
3. Format: Markdown headings (##), bullet points (-), **bold** for emphasis, tables where they aid clarity.
4. Tone: professional, objective, patient-centered.`;

    const userContent = `TASK: Create a ${modeText.toLowerCase()} for:

PATIENT: ${patientName}
DIAGNOSIS: ${diagnosis}
CLINICIAN: ${profession}

SOURCE NOTES / CONTENT:
${data.content}`;

    const token = await fetchDeepSeekToken();
    const rawMarkdown = await callAIWithValidation(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      token, 3500, 1
    );
    const htmlContent = marked.parse(rawMarkdown);

    const historyItem = {
      contentType: mode,
      fileName: `${modeText} - ${patientName}`,
      documentType: modeText,
      patientName,
      diagnosis,
      profession,
      results: rawMarkdown,
      resultsMarkdown: rawMarkdown,
      resultsHtml: htmlContent,
      mode,
      timestamp: Date.now()
    };
    const ref = await firebase.database().ref(`history/${user.uid}/caseHistory`).push(historyItem);

    return {
      ok: true,
      summary: `Here's your ${modeText.toLowerCase()} for **${patientName}**:`,
      fileCard: {
        icon: '📑',
        title: `${modeText} — ${patientName}`,
        meta: modeText,
        snippet: rawMarkdown.replace(/[#*`_>-]/g, '').slice(0, 150).trim(),
        toolId: 'presentation',
        recordId: ref.key,
        exportData: { content: htmlContent, patientName, profession, diagnosis, modeLabel: modeText, mode },
        actions: [
          { type: 'link', href: `result.html?type=case&id=${ref.key}`, label: 'Open & Edit', primary: true, external: true, icon: 'fa-pen-to-square' },
          { type: 'button', id: 'export-pptx', label: 'Export to PPTX', icon: 'fa-file-powerpoint' }
        ]
      }
    };
  }

  window.RehablixGenerators = window.RehablixGenerators || {};
  window.RehablixGenerators.presentation = {
    meta: {
      id: 'presentation',
      name: 'Presentation Maker',
      icon: '📑',
      description: 'Case presentation, clinical report, or documentation from your notes',
      keywords: ['presentation', 'slides', 'deck', 'clinical report', 'case presentation', 'ward round', 'write a report']
    },
    requiredFields: [
      { key: 'content', prompt: 'What should this be about? Paste your notes, or describe the case/topic.' }
    ],
    extractFromText(text) {
      const collected = {};
      if (text && text.trim()) collected.content = text.trim();
      collected.mode = detectMode(text);
      return collected;
    },
    generate,
    handleAction(actionId, card) {
      if (actionId === 'export-pptx' && card.exportData) {
        localStorage.setItem('pptExportData', JSON.stringify(card.exportData));
        window.open('ppt-export.html', '_blank');
      }
    }
  };
})();
