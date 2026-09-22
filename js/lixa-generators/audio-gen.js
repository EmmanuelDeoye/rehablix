// js/lixa-generators/audio-gen.js — Lixa's "Audio Transcription" tool.
// Adapted from js/audio.js's transcribeBlob (Whisper) + cleanupTranscript
// (narrative pass) + history save. The inline recorder UI lives in
// js/lixa.js; this module only does the non-UI transcription work.

(function () {
  const PROFESSIONAL_LABEL = 'Clinician';
  const CLEANUP_CHUNK_CHARS = 6000;

  async function loadAiConfig() {
    const tokens = await window.fetchTokens();
    if (!tokens) throw new Error('Transcription service is not configured right now.');
    return tokens;
  }

  async function transcribeBlob(blob, fileName) {
    const tokens = await loadAiConfig();
    const formData = new FormData();
    const filename = fileName || blob.name || `audio.${(blob.type || 'audio/webm').split('/')[1]?.split(';')[0] || 'webm'}`;
    formData.append('file', blob, filename);
    formData.append('model', 'whisper-1');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${tokens.token}` },
      body: formData
    });
    if (!response.ok) {
      let msg = 'Transcription request failed';
      try { const err = await response.json(); msg = err.error?.message || msg; } catch (e) {}
      throw new Error(msg);
    }
    const data = await response.json();
    return (data.text || '').trim();
  }

  function splitForCleanup(text) {
    if (text.length <= CLEANUP_CHUNK_CHARS) return [text];
    const pieces = [];
    let remaining = text;
    while (remaining.length > CLEANUP_CHUNK_CHARS) {
      let splitAt = remaining.lastIndexOf('. ', CLEANUP_CHUNK_CHARS);
      if (splitAt < CLEANUP_CHUNK_CHARS * 0.5) splitAt = CLEANUP_CHUNK_CHARS;
      pieces.push(remaining.slice(0, splitAt + 1));
      remaining = remaining.slice(splitAt + 1);
    }
    if (remaining.trim()) pieces.push(remaining);
    return pieces;
  }

  // The transcription itself (transcribeBlob, above) always uses Whisper —
  // that's a fixed transcription service, not a "Lixa model" choice. This
  // narrative-writing pass, though, is a normal chat-completion call, so it
  // uses whichever of the 4 Lixa models the user has selected rather than
  // always hardcoding gpt-4.1.
  async function cleanupTranscript(rawText) {
    if (!rawText || !rawText.trim()) return '';
    const config = await window.LixaCore.resolveToolModelConfig().catch(() => null);
    if (!config) return rawText;
    const quotaOk = await window.LixaCore.checkToolQuota().then(() => true).catch(() => false);
    if (!quotaOk) return rawText;

    const systemPrompt = `You are helping a ${PROFESSIONAL_LABEL} turn a raw speech-to-text transcript of a real session into a professional session narrative. Write clear, well-organized third-person prose describing what happened. You may paraphrase and smooth out filler words, but you must NEVER invent observations, measurements, or outcomes not present in the transcript. Output ONLY the narrative text.`;
    const pieces = splitForCleanup(rawText);
    const cleanedPieces = [];
    for (const piece of pieces) {
      try {
        const response = await fetch(`${config.endpoint.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.token}` },
          body: JSON.stringify({
            model: config.model,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: piece }],
            max_tokens: config.maxTokens,
            temperature: Math.min(config.temperature ?? 0.3, 0.3)
          })
        });
        if (!response.ok) throw new Error('narrative request failed');
        const data = await response.json();
        const cleanedPiece = data.choices?.[0]?.message?.content?.trim() || piece;
        cleanedPieces.push(cleanedPiece);
        window.LixaCore.reportToolTokenUsage(systemPrompt + piece + cleanedPiece, config.weight);
      } catch (err) {
        cleanedPieces.push(piece);
      }
    }
    return cleanedPieces.join('\n\n');
  }

  async function generate(data) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Please log in to transcribe audio.' };
    if (!data.blob) return { ok: false, error: 'No audio to transcribe.' };

    const rawText = await transcribeBlob(data.blob, data.fileName);
    if (!rawText) return { ok: false, error: "I couldn't detect any speech in that audio." };
    const cleaned = await cleanupTranscript(rawText);

    const title = data.title || `Transcript – ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const payload = {
      title,
      sessionType: 'session',
      sourceType: data.fileName ? 'upload' : 'live',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      rawTranscript: rawText,
      cleanedTranscript: cleaned,
      isPublic: false
    };
    const ref = await firebase.database().ref(`history/${user.uid}/audio`).push(payload);

    return {
      ok: true,
      summary: `Here's the transcript:`,
      fileCard: {
        icon: '🎧',
        title,
        meta: 'Audio Transcript',
        snippet: (cleaned || rawText).slice(0, 150),
        toolId: 'audio',
        recordId: ref.key,
        actions: [
          // Opens in the dedicated Audio Transcript view (reuses the Motion
          // results interface — see js/views/audioview-view.js), same
          // tab/window as every other generated result.
          { type: 'link', href: `index.html?id=${ref.key}#/audioview`, label: 'Open & Edit', primary: true, icon: 'fa-pen-to-square' }
        ]
      }
    };
  }

  // Edit-in-place (Lixa History + Intelligence Upgrade #2): revises the
  // SAME saved transcript's narrative text instead of re-transcribing —
  // audio isn't re-recorded, only the written-up narrative changes.
  async function edit(recordId, instruction) {
    const user = firebase.auth().currentUser;
    if (!user) return { ok: false, error: 'Please log in to edit this transcript.' };
    const ref = firebase.database().ref(`history/${user.uid}/audio/${recordId}`);
    const record = (await ref.once('value')).val();
    if (!record) return { ok: false, error: 'The original file could not be found.' };

    const config = await window.LixaCore.resolveToolModelConfig().catch(() => null);
    if (!config) return { ok: false, error: 'AI service is not configured.' };
    await window.LixaCore.checkToolQuota();
    const systemPrompt = `You are revising an existing clinical session transcript/narrative. Never invent observations, measurements, or outcomes not present in the original. Output ONLY the complete revised narrative text.`;
    const userPrompt = `CURRENT NARRATIVE:\n${record.cleanedTranscript || record.rawTranscript}\n\nREQUESTED CHANGE:\n${instruction}`;
    const response = await fetch(`${config.endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.token}` },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        max_tokens: config.maxTokens,
        temperature: Math.min(config.temperature ?? 0.3, 0.3)
      })
    });
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    const data = await response.json();
    const revised = (data.choices?.[0]?.message?.content || '').trim() || (record.cleanedTranscript || record.rawTranscript);
    window.LixaCore.reportToolTokenUsage(systemPrompt + userPrompt + revised, config.weight);

    await ref.update({ cleanedTranscript: revised, updatedAt: new Date().toISOString() });

    return {
      ok: true,
      summary: `Updated the transcript:`,
      fileCard: {
        icon: '🎧',
        title: record.title,
        meta: 'Audio Transcript · Updated',
        snippet: revised.slice(0, 150),
        toolId: 'audio',
        recordId,
        actions: [
          { type: 'link', href: `index.html?id=${recordId}#/audioview`, label: 'Open & Edit', primary: true, icon: 'fa-pen-to-square' }
        ]
      }
    };
  }

  // Generic export (Lixa History + Intelligence Upgrade): normalizes this
  // tool's saved record into { title, html } — the transcript is plain
  // text, so it's wrapped as paragraphs rather than left as one long run.
  async function getExportContent(recordId) {
    const user = firebase.auth().currentUser;
    if (!user) return null;
    const record = (await firebase.database().ref(`history/${user.uid}/audio/${recordId}`).once('value')).val();
    if (!record) return null;
    const text = record.cleanedTranscript || record.rawTranscript || '';
    const html = text.split(/\n{2,}/).map(p => `<p>${p.replace(/</g, '&lt;')}</p>`).join('');
    return { title: record.title || 'Audio Transcript', html };
  }

  window.RehablixGenerators = window.RehablixGenerators || {};
  window.RehablixGenerators.audio = {
    meta: {
      id: 'audio',
      name: 'Audio Transcription',
      icon: '🎧',
      description: 'Transcribe a recorded session or an uploaded audio file',
      keywords: ['transcribe', 'transcript', 'transcription', 'record a session', 'audio recording']
    },
    requiredFields: [],
    statusStages: [
      'Uploading audio…',
      'Transcribing speech…',
      'Writing the session narrative…'
    ],
    editStatusStages: ['Reading the current transcript…', 'Applying your changes…'],
    generate,
    edit,
    getExportContent,
    // No handleAction anymore — the fileCard's action is a plain link into
    // #/audioview now, not a button that opens a custom popup window.
    openFromRecord(record, id) {
      if (id) window.RehablixRouter.go(`index.html?id=${id}#/audioview`);
    }
  };
})();
