// js/lixa-generators/format-gen.js — Lixa's "Assessment Format" tool.
// Adapted from js/format.js's buildPrompt/callAIWithValidation/saveToHistory
// so the chat flow produces the same shape of record as the standalone
// Assessment Format Generator page (and shows up correctly in
// formatresult.html and the Files tab).

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
          { role: 'system', content: 'You are a senior rehabilitation therapist. You always return clean, printable HTML forms. Never use Markdown or code fences.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: attempt === 1 ? 4000 : 5500
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
      if (attempt < 2) return callAIWithValidation(prompt, token, attempt + 1);
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

    const token = await fetchOpenAiToken();
    const prompt = buildPrompt(formData);
    const html = await callAIWithValidation(prompt, token, 1);

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
          { type: 'link', href: `index.html?id=${ref.key}#/formatresult`, label: 'Open & Edit', primary: true, external: true, icon: 'fa-pen-to-square' }
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
    generate
  };
})();
