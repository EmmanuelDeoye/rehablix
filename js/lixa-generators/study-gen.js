// js/lixa-generators/study-gen.js — Lixa's "Study Buddy" tool. Adapted
// from js/study.js's single-shot generation call + subject/study-set save,
// so sets created via Lixa show up correctly in study.html (same schema,
// same topic-mastery records that exam.js also reads).

(function () {
  // Uses whichever of the 4 Lixa models the user has selected, instead of
  // always hardcoding DeepSeek — this tool is embedded in Lixa, not a
  // separate AI product with its own model/gating.
  async function callAIOnce(systemPrompt, userPrompt, config) {
    const response = await fetch(`${config.endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.token}` },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        max_tokens: config.maxTokens,
        temperature: config.temperature ?? 0.5
      })
    });
    if (!response.ok) throw new Error(`AI service error (${response.status})`);
    const data = await response.json();
    return (data.choices?.[0]?.message?.content || '').trim();
  }

  // Empty completions happen intermittently with this provider (a 200 OK
  // with no visible content) — this used to go straight into JSON.parse('')
  // and surface as "Unexpected end of JSON input" with no retry, unlike the
  // main chat flow (js/ask.js) which already retries once on the same
  // failure mode.
  async function callAI(systemPrompt, userPrompt, config) {
    let content = await callAIOnce(systemPrompt, userPrompt, config);
    if (!content) content = await callAIOnce(systemPrompt, userPrompt, config);
    if (!content) throw new Error('The AI returned an empty response. Please try again.');
    return content;
  }

  function parseAIJson(text) {
    let cleaned = (text || '').trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1) cleaned = cleaned.slice(start, end + 1);
    if (!cleaned) throw new Error('The AI returned an empty response. Please try again.');
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      throw new Error('The AI response was not in the expected format. Please try again.');
    }
  }

  async function getOrCreateSubject(uid, name) {
    const database = firebase.database();
    const snap = await database.ref(`history/${uid}/subjects`).once('value');
    const subjects = snap.val() || {};
    const trimmed = name.trim();
    const existingId = Object.keys(subjects).find(id => (subjects[id].name || '').toLowerCase() === trimmed.toLowerCase());
    if (existingId) return existingId;
    const ref = database.ref(`history/${uid}/subjects`).push();
    await ref.set({ name: trimmed, topics: {}, createdAt: firebase.database.ServerValue.TIMESTAMP });
    return ref.key;
  }

  async function generate(data) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Please log in to create a study set.' };

    const subjectName = data.subject.trim();
    const notes = data.notes.trim();
    const flashcardCount = 15, quizCount = 8;

    const systemPrompt = `You are an expert study coach for rehabilitation/healthcare students. From the material given, produce a JSON object with EXACTLY these keys and nothing else (no markdown, no code fences, no commentary):
{
  "summary": "a well-structured markdown summary (headings, bullet points) of the key concepts, 200-400 words",
  "topics": ["3-6 short topic names that organize the material"],
  "flashcards": [{"front": "question or term", "back": "concise answer", "topic": "one of the topic names above"}],
  "quiz": [{"question": "...", "options": ["A","B","C","D"], "correctIndex": 0, "explanation": "why that's correct", "topic": "one of the topic names above"}]
}
Generate exactly ${flashcardCount} flashcards and exactly ${quizCount} quiz questions.`;
    const userPrompt = `Subject: ${subjectName}\n\nMaterial:\n${notes.slice(0, 12000)}`;

    await window.LixaCore.checkToolQuota();
    const config = await window.LixaCore.resolveToolModelConfig();
    if (!config) throw new Error('AI service is not configured.');
    // 15 flashcards + 8 quiz questions (each with 4 options + an
    // explanation) + a 200-400 word summary, all as one JSON blob, needs a
    // real token budget — this now rides on whichever Lixa model is
    // selected, same as everything else Lixa generates; a lower-tier
    // model's smaller ceiling can mean a shorter/truncated set, same
    // tradeoff a chat turn on that model would have.
    const response = await callAI(systemPrompt, userPrompt, config);
    window.LixaCore.reportToolTokenUsage(systemPrompt + userPrompt + response, config.weight);
    const parsed = parseAIJson(response);
    if (!parsed.flashcards || !parsed.quiz || !parsed.topics) throw new Error('The AI response was missing required fields.');

    const database = firebase.database();
    const subjectId = await getOrCreateSubject(user.uid, subjectName);
    for (const topicName of parsed.topics) {
      const topicId = topicName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40) || 'general';
      const topicRef = database.ref(`history/${user.uid}/subjects/${subjectId}/topics/${topicId}`);
      const existing = (await topicRef.once('value')).val();
      if (!existing) await topicRef.set({ name: topicName, masteryScore: 50, timesReviewed: 0, lastActivity: new Date().toISOString() });
    }

    const flashcards = parsed.flashcards.map((c, i) => ({
      id: 'c_' + Date.now() + '_' + i,
      front: c.front, back: c.back, topic: c.topic || parsed.topics[0],
      box: 1, nextReview: Date.now(), timesReviewed: 0
    }));

    const setRef = database.ref(`history/${user.uid}/study/sets`).push();
    const setRecord = {
      subjectId,
      title: `${subjectName} — ${new Date().toLocaleDateString()}`,
      summary: parsed.summary,
      topics: parsed.topics,
      flashcards,
      quiz: parsed.quiz,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    };
    await setRef.set(setRecord);

    return {
      ok: true,
      summary: `Here's your study set for **${subjectName}** — ${flashcards.length} flashcards and ${parsed.quiz.length} quiz questions:`,
      fileCard: {
        icon: '🧠',
        title: setRecord.title,
        meta: 'Study Set',
        snippet: parsed.summary.replace(/[#*`_>-]/g, '').slice(0, 150).trim(),
        toolId: 'study',
        recordId: setRef.key,
        actions: [
          { type: 'link', href: `index.html?subject=${subjectId}#/study`, label: 'Open Study Buddy', primary: true, icon: 'fa-book-open' }
        ]
      }
    };
  }

  // Edit-in-place (Lixa History + Intelligence Upgrade #2): revises the
  // SAME saved study set's written summary — the flashcards/quiz keep their
  // own spaced-repetition/mastery state in study.html, so an in-chat edit
  // deliberately only touches the summary text rather than silently
  // reshuffling cards a learner may already be partway through reviewing.
  async function edit(recordId, instruction) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Please log in to edit this study set.' };
    const ref = firebase.database().ref(`history/${user.uid}/study/sets/${recordId}`);
    const record = (await ref.once('value')).val();
    if (!record) return { ok: false, error: 'The original file could not be found.' };

    await window.LixaCore.checkToolQuota();
    const config = await window.LixaCore.resolveToolModelConfig();
    if (!config) throw new Error('AI service is not configured.');
    const systemPrompt = `You are revising the written summary of an existing study set for a rehabilitation/healthcare student. Return ONLY the complete revised markdown summary.`;
    const userPrompt = `CURRENT SUMMARY:\n${record.summary}\n\nREQUESTED CHANGE:\n${instruction}`;
    const summary = (await callAI(systemPrompt, userPrompt, config)) || record.summary;
    window.LixaCore.reportToolTokenUsage(systemPrompt + userPrompt + summary, config.weight);

    await ref.update({ summary });

    return {
      ok: true,
      summary: `Updated the summary for **${record.title}**:`,
      fileCard: {
        icon: '🧠',
        title: record.title,
        meta: 'Study Set · Updated',
        snippet: summary.replace(/[#*`_>-]/g, '').slice(0, 150).trim(),
        toolId: 'study',
        recordId,
        actions: [
          { type: 'link', href: `index.html?subject=${record.subjectId}#/study`, label: 'Open Study Buddy', primary: true, icon: 'fa-book-open' }
        ]
      }
    };
  }

  // Generic export (Lixa History + Intelligence Upgrade): normalizes this
  // tool's saved record into { title, html } — includes the summary plus a
  // simple flashcards/quiz listing so exporting the set doesn't lose them.
  async function getExportContent(recordId) {
    const user = firebase.auth().currentUser;
    if (!user) return null;
    const record = (await firebase.database().ref(`history/${user.uid}/study/sets/${recordId}`).once('value')).val();
    if (!record) return null;
    const summaryHtml = typeof marked !== 'undefined' ? marked.parse(record.summary || '') : `<p>${record.summary || ''}</p>`;
    const flashcardsHtml = (record.flashcards || []).length
      ? `<h2>Flashcards</h2><ol>${record.flashcards.map(c => `<li><strong>${(c.front || '').replace(/</g, '&lt;')}</strong> — ${(c.back || '').replace(/</g, '&lt;')}</li>`).join('')}</ol>`
      : '';
    const quizHtml = (record.quiz || []).length
      ? `<h2>Quiz</h2><ol>${record.quiz.map(q => `<li>${(q.question || '').replace(/</g, '&lt;')}<ul>${(q.options || []).map((o, i) => `<li${i === q.correctIndex ? ' style="font-weight:bold"' : ''}>${String(o).replace(/</g, '&lt;')}</li>`).join('')}</ul></li>`).join('')}</ol>`
      : '';
    return { title: record.title || 'Study Set', html: summaryHtml + flashcardsHtml + quizHtml };
  }

  window.RehablixGenerators = window.RehablixGenerators || {};
  window.RehablixGenerators.study = {
    meta: {
      id: 'study',
      name: 'Study Buddy',
      icon: '🧠',
      description: 'Flashcards, summary, and a quiz from your notes',
      keywords: ['study buddy', 'flashcards', 'quiz me', 'study set', 'summarize my notes', 'study notes']
    },
    requiredFields: [
      { key: 'subject', prompt: 'What subject/topic is this for?' },
      { key: 'notes', prompt: 'Paste your notes, or tell me the topic in more detail so I can generate from scratch.' }
    ],
    extractFromText(text) {
      const collected = {};
      if (text && text.trim()) {
        // A short phrase is treated as the subject name; a longer passage is treated as notes.
        if (text.trim().split(/\s+/).length <= 6) collected.subject = text.trim();
        else { collected.notes = text.trim(); }
      }
      return collected;
    },
    statusStages: [
      'Analyzing your material…',
      'Identifying key topics…',
      'Writing flashcards…',
      'Building the quiz…'
    ],
    editStatusStages: ['Reading the current study set…', 'Applying your changes…'],
    generate,
    edit,
    getExportContent,
    openFromRecord(record, id, item) {
      const subjectId = record && record.subjectId;
      if (subjectId) window.RehablixRouter.go(`index.html?subject=${subjectId}#/study`);
    }
  };
})();
