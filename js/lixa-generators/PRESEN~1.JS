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

  // Uses whichever of the 4 Lixa models the user has selected, instead of
  // always hardcoding DeepSeek — this tool is embedded in Lixa, not a
  // separate AI product with its own model/gating.
  async function callAIWithValidation(messages, config, attempt) {
    const response = await fetch(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.token}` },
      body: JSON.stringify({ model: config.model, messages, max_tokens: config.maxTokens, temperature: config.temperature ?? 0.3, top_p: config.top_p ?? 0.9 })
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    const content = (data.choices?.[0]?.message?.content || '').trim();
    if (content.length < 20) {
      if (attempt < 2) return callAIWithValidation(messages, config, attempt + 1);
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

    await window.LixaCore.checkToolQuota();
    const config = await window.LixaCore.resolveToolModelConfig();
    if (!config) throw new Error('AI service is not configured.');
    const rawMarkdown = await callAIWithValidation(
      [{ role: 'system', content: systemPrompt }, { role: 'user', content: userContent }],
      config, 1
    );
    window.LixaCore.reportToolTokenUsage(systemPrompt + userContent + rawMarkdown, config.weight);
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
          { type: 'link', href: `index.html?type=case&id=${ref.key}#/result`, label: 'Open & Edit', primary: true, icon: 'fa-pen-to-square' },
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
    statusStages: [
      'Reviewing your notes…',
      'Organizing the outline…',
      'Writing each section…',
      'Polishing the formatting…'
    ],
    generate,
    handleAction(actionId, card) {
      if (actionId === 'export-pptx' && card.exportData) {
        localStorage.setItem('pptExportData', JSON.stringify(card.exportData));
        window.open('ppt-export.html', '_blank');
      }
    }
  };
})();
