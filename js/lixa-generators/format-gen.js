// js/lixa-generators/format-gen.js — Lixa's "Assessment Format" tool.
// Adapted from js/format.js's buildPrompt/callAIWithValidation/saveToHistory
// so the chat flow produces the same shape of record as the standalone
// Assessment Format Generator page (and shows up correctly in the shared
// result.html editor — via RESULT_TYPES.format in js/result-types.js — and
// the Files tab).

(function () {
  function buildPrompt(data) {
    return `Generate a professional PRINTABLE medical assessment form.

CONTEXT:
- Patient: ${data.name} (${data.age || 'age not specified'}, ${data.gender})
- Diagnosis: ${data.diagnosis}
- Assessment Type: ${data.assessmentType}
- Department: ${data.department}
- Clinical Notes: ${data.notes || 'None'}

REQUIREMENTS:
1. Return ONLY pure HTML. No markdown, no code fences.
2. The form MUST be PRINT-FRIENDLY (A4 layout).
3. Do NOT use interactive elements like select or radio.
4. Textareas must have no visible labels above/inside them (the section heading is the label). Use: <textarea rows="7" style="width:100%; resize:vertical; min-height:150px;"></textarea>
5. Include: Presenting Complaint & Referral Reason, Clinical Observations, Assessment Findings, Treatment Plan & Recommendations, and a relevant History section.
6. Use tables only for structured/numerical data (ROM, strength grading, standardized scores).
7. Final section: list 5 REAL standardized assessment tools relevant to "${data.diagnosis}" with name, short purpose, and a space for score/result.
8. Clean black-and-white professional layout, print-safe margins, @media print styling.
9. Tailor the form to this specific clinical scenario rather than a rigid generic template.

Return ONLY the HTML.`;
  }

  function cleanHtml(html) {
    return (html || '').replace(/```html?/g, '').replace(/```/g, '').trim();
  }

  // Uses whichever of the 4 Lixa models the user has selected in the
  // composer — this tool is embedded in Lixa, not a separate AI product,
  // so it shares Lixa's model choice, token ceiling and quota instead of
  // always hardcoding the top-tier model regardless of plan/selection.
  async function callAIWithValidation(prompt, config, attempt) {
    const response = await fetch(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.token}` },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: 'You are a senior rehabilitation therapist. You always return clean, printable HTML forms. Never use Markdown or code fences.' },
          { role: 'user', content: prompt }
        ],
        temperature: config.temperature ?? 0.7,
        max_tokens: config.maxTokens
      })
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    const choice = data.choices && data.choices[0];
    const html = cleanHtml(choice && choice.message && choice.message.content);
    if (choice && choice.finish_reason === 'content_filter') {
      throw new Error('The AI declined to generate this content — try rephrasing the diagnosis/notes.');
    }
    if (html.length < 20) {
      if (attempt < 2) return callAIWithValidation(prompt, config, attempt + 1);
      throw new Error('The AI returned an empty response. Please try again.');
    }
    return html;
  }

  async function generate(data) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Please log in to generate an assessment format.' };

    const formData = {
      name: data.name || 'Patient',
      age: data.age || '',
      gender: data.gender || 'Not specified',
      diagnosis: data.diagnosis,
      assessmentType: data.assessmentType || 'Initial Assessment',
      department: data.department || 'General',
      category: data.category || 'General',
      notes: data.notes || ''
    };

    await window.LixaCore.checkToolQuota();
    const config = await window.LixaCore.resolveToolModelConfig();
    if (!config) throw new Error('AI service is not configured.');
    const prompt = buildPrompt(formData);
    const html = await callAIWithValidation(prompt, config, 1);
    window.LixaCore.reportToolTokenUsage(prompt + html, config.weight);

    const historyItem = {
      patientName: formData.name,
      patientAge: formData.age,
      patientGender: formData.gender,
      diagnosis: formData.diagnosis,
      assessmentType: formData.assessmentType,
      category: formData.category,
      department: formData.department,
      notes: formData.notes,
      generatedText: html,
      preview: html.replace(/<[^>]*>/g, ' ').substring(0, 150).replace(/\n/g, ' '),
      timestamp: new Date().toISOString(),
      userId: user.uid
    };
    const ref = firebase.database().ref(`history/${user.uid}/formats`).push();
    await ref.set(historyItem);

    return {
      ok: true,
      summary: `Here's your assessment format for **${formData.diagnosis}**:`,
      fileCard: {
        icon: '📋',
        title: `${formData.assessmentType} — ${formData.diagnosis}`,
        meta: 'Assessment Format',
        snippet: historyItem.preview,
        toolId: 'format',
        recordId: ref.key,
        actions: [
          { type: 'link', href: `index.html?id=${ref.key}#/formatview`, label: 'Open & Edit', primary: true, icon: 'fa-pen-to-square' }
        ]
      }
    };
  }

  // Edit-in-place (Lixa History + Intelligence Upgrade #2): revises the
  // SAME saved format record instead of generating a new one, and always
  // returns an updated file card. Reads the current HTML back from Firebase
  // rather than trusting anything held in memory, since a chat page reload
  // between generation and edit would otherwise lose it.
  async function edit(recordId, instruction) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Please log in to edit this format.' };
    const ref = firebase.database().ref(`history/${user.uid}/formats/${recordId}`);
    const record = (await ref.once('value')).val();
    if (!record) return { ok: false, error: 'The original file could not be found.' };

    await window.LixaCore.checkToolQuota();
    const config = await window.LixaCore.resolveToolModelConfig();
    if (!config) throw new Error('AI service is not configured.');
    const prompt = `Here is an existing printable HTML medical assessment form:\n\n${record.generatedText}\n\nApply this change requested by the clinician, preserving the rest of the form exactly as-is unless the change requires otherwise:\n"${instruction}"\n\nReturn ONLY the complete updated HTML document (no markdown, no code fences, no commentary).`;
    const html = await callAIWithValidation(prompt, config, 1);
    window.LixaCore.reportToolTokenUsage(prompt + html, config.weight);

    const preview = html.replace(/<[^>]*>/g, ' ').substring(0, 150).replace(/\n/g, ' ');
    await ref.update({ generatedText: html, preview, updatedAt: new Date().toISOString() });

    return {
      ok: true,
      summary: `Updated your assessment format for **${record.diagnosis}**:`,
      fileCard: {
        icon: '📋',
        title: `${record.assessmentType} — ${record.diagnosis}`,
        meta: 'Assessment Format · Updated',
        snippet: preview,
        toolId: 'format',
        recordId,
        actions: [
          { type: 'link', href: `index.html?id=${recordId}#/formatview`, label: 'Open & Edit', primary: true, icon: 'fa-pen-to-square' }
        ]
      }
    };
  }

  window.RehablixGenerators = window.RehablixGenerators || {};
  window.RehablixGenerators.format = {
    meta: {
      id: 'format',
      name: 'Assessment Format',
      icon: '📋',
      description: 'Structured clinical assessment form for a patient/diagnosis',
      keywords: ['assessment format', 'assessment form', 'clinical assessment', 'patient assessment', 'assessment for a patient', 'soap note']
    },
    requiredFields: [
      { key: 'diagnosis', prompt: 'What is the diagnosis or chief complaint for this assessment?' }
    ],
    extractFromText(text) {
      const collected = {};
      if (text && text.trim()) collected.diagnosis = text.trim();
      const ageMatch = text && text.match(/\b(\d{1,3})\s*(?:yo|years?[\s-]*old|y\/o)\b/i);
      if (ageMatch) collected.age = ageMatch[1];
      const genderMatch = text && text.match(/\b(male|female|man|woman)\b/i);
      if (genderMatch) collected.gender = /^m/i.test(genderMatch[1]) ? 'Male' : 'Female';
      return collected;
    },
    statusStages: [
      'Reviewing the clinical scenario…',
      'Structuring the assessment sections…',
      'Adding relevant standardized tools…',
      'Formatting for printing…'
    ],
    editStatusStages: ['Reading the current format…', 'Applying your changes…', 'Re-formatting for printing…'],
    generate,
    edit
  };
})();
