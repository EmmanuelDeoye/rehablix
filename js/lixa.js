// js/lixa.js — Lixa orchestration layer on top of js/ask.js's chat core.
//
// Adds: the "@tool" mention picker, automatic tool-intent detection from
// free text, a small slot-filling conversation for any required inputs a
// tool still needs, dispatch to the shared js/lixa-generators/*.js modules,
// inline file-result cards, and the History drawer's Chats/Files switch.
//
// Talks to js/ask.js only through window.LixaCore (exposed at the bottom
// of ask.js) so the chat message state stays owned by one file.

(function () {
  // Keyword sets are specific multi-word phrases (e.g. "standardized tool",
  // "berg balance"), not generic single words, so a single hit is already a
  // strong signal — requiring 2+ made natural one-line requests fall through
  // to plain chat far too often.
  const CONFIDENCE_THRESHOLD = 1; // min keyword score before auto-triggering a tool

  // A keyword/pattern hit only proves the message is ABOUT a tool's topic,
  // not that the user wants the tool run right now — "what's a good
  // assessment format for a stroke patient?" should get a normal answer,
  // not silently launch the Assessment Format generator. These two signals
  // let isGenuineToolRequest() (below) tell "talking/asking about it" apart
  // from "actually requesting it":
  //  - an action verb/phrase ("generate", "I need a...", "can you make...")
  //    always wins, even inside a question ("can you generate...?");
  //  - failing that, a message phrased as a question is treated as chat.
  const QUESTION_STARTERS = /^(what|why|how|when|where|who|which|whom|whose|is|are|was|were|does|do|did|can|could|should|would|will|explain|describe|define)\b/i;
  const ACTION_INTENT = /\b(generate|create|make|build|draft|prepare|write|produce|compose|put together|draw up|fill out|complete|start (?:a|an|my)|need (?:a|an|to)|want (?:a|an|to)|give me|help me (?:create|make|generate|write|build|draft|prepare)|let'?s (?:create|make|generate|build|do|start))\b/i;

  function looksLikeQuestion(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return false;
    return /\?\s*$/.test(trimmed) || QUESTION_STARTERS.test(trimmed);
  }

  function hasActionIntent(text) {
    return ACTION_INTENT.test(text || '');
  }

  // A bare mention of a tool's own keyword phrase (e.g. just typing
  // "assessment format") is exactly as ambiguous as a question about it —
  // Lixa shouldn't guess. The moment the message carries any real extra
  // content beyond that phrase (a diagnosis, a body part, a patient
  // detail...), it's treated as the deliberate one-liner request it almost
  // certainly is — that's the "legitimate short request" case the
  // CONFIDENCE_THRESHOLD comment above already protects.
  function isGenuineToolRequest(text, detected, attachedFiles) {
    // Attaching an audio file is itself an unambiguous action, regardless
    // of whatever (or however little) text comes with it.
    if (detected.toolId === 'audio' && attachedFiles && attachedFiles.some(a => a.type && a.type.startsWith('audio/'))) return true;
    if (hasActionIntent(text) || detected.patternMatched) return true;
    if (looksLikeQuestion(text)) return false;
    const wordCount = (text || '').trim().split(/\s+/).filter(Boolean).length;
    const longestKeywordWords = (detected.matchedKeywords || []).reduce((max, kw) => Math.max(max, kw.split(/\s+/).length), 0);
    return (wordCount - longestKeywordWords) >= 2;
  }

  // Native Firebase history paths each tool already writes to (used to
  // build the unified Files view without a separate data store). Each
  // record's own schema differs per tool (format saves diagnosis/
  // assessmentType, presentation saves fileName, others save title/
  // toolName/topic directly) — titleOf() bridges that so the Files list
  // never falls back to a bare "Untitled".
  const FILE_SOURCES = [
    { type: 'format', label: 'Formats', path: 'formats', icon: '📋', titleOf: (item) => (item.assessmentType && item.diagnosis) ? `${item.assessmentType} — ${item.diagnosis}` : (item.diagnosis || item.assessmentType) },
    { type: 'standardized', label: 'Standardized Tools', path: 'standardizedTools', icon: '⚖️', titleOf: (item) => item.toolName },
    { type: 'presentation', label: 'Presentations/Reports', path: 'caseHistory', icon: '📑', titleOf: (item) => item.fileName || item.documentType },
    { type: 'audio', label: 'Audio', path: 'audio', icon: '🎧', titleOf: (item) => item.title },
    { type: 'assignment', label: 'Assignments', path: 'assignments', icon: '📝', titleOf: (item) => item.topic },
    { type: 'study', label: 'Study Sets', path: 'study/sets', icon: '🧠', titleOf: (item) => item.title }
  ];

  // Registered as (the rest of) the "lixa" SPA view — js/router.js calls
  // mount()/unmount() around views/lixa.fragment.html. ask.js owns the
  // chat-core mount/unmount (exposed as window.RehablixAskView) and this
  // file's mount() calls it first so window.LixaCore exists before init()
  // wires up the @mention/intent-routing layer on top of it.
  let cleanupFns = [];

  function mount() {
    if (window.RehablixAskView) window.RehablixAskView.mount();
    try {
      init();
    } catch (err) {
      console.error('[lixa] init failed:', err);
    }
  }

  function unmount() {
    if (window.RehablixAskView) window.RehablixAskView.unmount();
    cleanupFns.forEach(fn => { try { fn(); } catch (e) { /* best-effort */ } });
    cleanupFns = [];
  }

  // Lixa is kept alive by js/router.js — mount() only runs on the first
  // visit; every later visit calls onShow() instead, which just re-attaches
  // the navbar controls ask.js relocated out of the fragment (the router
  // clears #navbarViewSlot on every navigation) without re-running init()
  // or touching any state.
  function onShow() {
    if (window.RehablixAskView && window.RehablixAskView.onShow) window.RehablixAskView.onShow();
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.lixa = { mount, unmount, onShow };

  function init() {
    if (!window.LixaCore) return; // ask.js's mount() didn't run — bail defensively
    const core = window.LixaCore;

    const messageInput = document.getElementById('messageInput');
    const mentionPopup = document.getElementById('mentionPopup');
    const toolBanner = document.getElementById('lixaToolBanner');
    const chatMessages = document.getElementById('chatMessages');
    const historyDrawer = document.getElementById('historyDrawer');
    const filesToggleBtn = document.getElementById('filesToggleBtn');
    const chatsSearchWrap = document.getElementById('chatsSearchWrap');
    const historyList = document.getElementById('historyList');
    const filesSearchWrap = document.getElementById('filesSearchWrap');
    const filesSearchInput = document.getElementById('filesSearchInput');
    const fileFilterSelect = document.getElementById('fileFilterSelect');
    const filesList = document.getElementById('filesList');
    const filesLoading = document.getElementById('filesLoading');

    if (!messageInput) return;

    // =====================================================================
    // Tool registry (pulled from each generator module's declared meta)
    // =====================================================================
    const gens = window.RehablixGenerators || {};
    const TOOLS = {};
    Object.keys(gens).forEach(id => {
      if (gens[id] && gens[id].meta) TOOLS[id] = gens[id];
    });

    let recorderState = null; // active inline audio recorder, if any
    let pending = null; // { toolId, collected:{}, missingQueue:[keys] }

    // =====================================================================
    // @mention popup — only triggers when the message is a leading "@partial"
    // =====================================================================
    function renderMentionPopup(filterText) {
      const term = (filterText || '').toLowerCase();
      const matches = Object.values(TOOLS).filter(t =>
        !term || t.meta.id.includes(term) || t.meta.name.toLowerCase().includes(term)
      );
      if (matches.length === 0) {
        mentionPopup.innerHTML = '<div class="mention-empty">No matching tool</div>';
      } else {
        mentionPopup.innerHTML = matches.map(t => `
          <button type="button" class="mention-item" data-tool-id="${t.meta.id}">
            <span class="mention-icon">${t.meta.icon}</span>
            <span class="mention-text">
              <span class="mention-name">@${t.meta.id} — ${core.escapeHtml(t.meta.name)}</span>
              <span class="mention-desc">${core.escapeHtml(t.meta.description)}</span>
            </span>
          </button>
        `).join('');
      }
      mentionPopup.hidden = false;
      mentionPopup.querySelectorAll('.mention-item').forEach(btn => {
        btn.addEventListener('click', () => {
          messageInput.value = '@' + btn.dataset.toolId + ' ';
          mentionPopup.hidden = true;
          messageInput.focus();
          messageInput.dispatchEvent(new Event('input'));
        });
      });
    }

    messageInput.addEventListener('input', () => {
      const m = messageInput.value.match(/^@(\w*)$/);
      if (m) renderMentionPopup(m[1]);
      else mentionPopup.hidden = true;
    });

    const onDocClickCloseMention = (e) => {
      if (!mentionPopup.hidden && !mentionPopup.contains(e.target) && e.target !== messageInput) {
        mentionPopup.hidden = true;
      }
    };
    const onDocKeydownCloseMention = (e) => {
      if (e.key === 'Escape' && !mentionPopup.hidden) mentionPopup.hidden = true;
    };
    document.addEventListener('click', onDocClickCloseMention);
    document.addEventListener('keydown', onDocKeydownCloseMention);
    cleanupFns.push(() => document.removeEventListener('click', onDocClickCloseMention));
    cleanupFns.push(() => document.removeEventListener('keydown', onDocKeydownCloseMention));

    // =====================================================================
    // Active-tool banner (shown while a tool flow is in progress)
    // =====================================================================
    function showBanner(toolId) {
      const tool = TOOLS[toolId];
      if (!tool || !toolBanner) return;
      toolBanner.innerHTML = `
        <span class="lixa-tool-banner-icon">${tool.meta.icon}</span>
        <span class="lixa-tool-banner-text">Creating: ${core.escapeHtml(tool.meta.name)}</span>
        <button type="button" class="lixa-tool-banner-cancel" id="lixaCancelToolBtn" aria-label="Cancel"><i class="fas fa-times"></i></button>
      `;
      toolBanner.hidden = false;
      const cancelBtn = document.getElementById('lixaCancelToolBtn');
      if (cancelBtn) cancelBtn.addEventListener('click', cancelPending);
    }

    function hideBanner() {
      if (toolBanner) { toolBanner.hidden = true; toolBanner.innerHTML = ''; }
      removeRecorder();
    }

    function cancelPending() {
      pending = null;
      hideBanner();
      pushAssistantText('No problem, cancelled. What else can I help with?');
    }

    // =====================================================================
    // Chat helpers
    // =====================================================================
    function pushUserText(text) {
      core.pushMessage({ role: 'user', content: text, displayContent: text, timestamp: Date.now() });
      core.render();
      if (core.getCurrentUser()) core.save();
    }

    function pushAssistantText(text, fileCard) {
      const msg = { role: 'assistant', content: text, timestamp: Date.now() };
      if (fileCard) msg.fileCard = fileCard;
      core.pushMessage(msg);
      core.render();
      if (core.getCurrentUser()) core.save();
      core.scrollToBottom();
    }

    let statusEl = null;
    let statusCycleInterval = null;

    // Shows a status bubble that, when given more than one stage, cycles
    // through them over time — a single static "Generating…" line for a
    // 10-20s AI call reads as frozen/broken; a progression reads as alive.
    function showStatus(stages) {
      hideStatus();
      const list = Array.isArray(stages) ? stages : [stages];
      let i = 0;
      statusEl = document.createElement('div');
      statusEl.className = 'message assistant';
      statusEl.innerHTML = `<div class="lixa-status-bubble"><span class="lixa-status-spinner"></span><span class="lixa-status-text">${core.escapeHtml(list[0])}</span></div>`;
      chatMessages.appendChild(statusEl);
      core.scrollToBottom();
      if (list.length > 1) {
        statusCycleInterval = setInterval(() => {
          i = Math.min(i + 1, list.length - 1);
          const textEl = statusEl && statusEl.querySelector('.lixa-status-text');
          if (textEl) {
            textEl.classList.remove('lixa-status-text-in');
            textEl.textContent = list[i];
            // restart the fade-in animation
            void textEl.offsetWidth;
            textEl.classList.add('lixa-status-text-in');
          }
          if (i >= list.length - 1) { clearInterval(statusCycleInterval); statusCycleInterval = null; }
        }, 2400);
      }
    }
    function hideStatus() {
      if (statusCycleInterval) { clearInterval(statusCycleInterval); statusCycleInterval = null; }
      if (statusEl) { statusEl.remove(); statusEl = null; }
    }

    // =====================================================================
    // Intent detection
    // =====================================================================
    function detectToolIntent(text, attachedFiles) {
      const lower = (text || '').toLowerCase();
      let best = null;
      Object.values(TOOLS).forEach(tool => {
        let score = 0;
        const matchedKeywords = [];
        (tool.meta.keywords || []).forEach(kw => {
          if (lower.includes(kw)) { score += 1; matchedKeywords.push(kw); }
        });
        // A regex pattern is a stronger, more general signal than any single
        // keyword phrase (catches e.g. "generate the Oswestry Disability
        // Index" without needing every possible scale name enumerated) —
        // the ones in use already bake an action verb into the regex itself,
        // so a pattern match doubles as a genuine-request signal too (see
        // isGenuineToolRequest above).
        let patternMatched = false;
        if (tool.meta.pattern && tool.meta.pattern.test(text || '')) { score += 2; patternMatched = true; }
        if (tool.meta.id === 'audio' && attachedFiles && attachedFiles.some(a => a.type && a.type.startsWith('audio/'))) {
          score += 5;
        }
        if (!best || score > best.score) best = { toolId: tool.meta.id, score, matchedKeywords, patternMatched };
      });
      return best;
    }

    // =====================================================================
    // Slot filling
    // =====================================================================
    function missingFieldsFor(tool, collected) {
      return (tool.requiredFields || []).filter(f => !collected[f.key] || String(collected[f.key]).trim() === '');
    }

    async function startTool(toolId, rawText, contentText, attachedFiles, opts) {
      const tool = TOOLS[toolId];
      if (!tool) return false;

      pushUserText(rawText);

      if (!opts.confirmed) {
        pushAssistantText(`Sounds like you want a **${tool.meta.name}** — let's do it. (Tip: start a message with "@${tool.meta.id}" any time to jump straight to this tool.)`);
      }

      if (toolId === 'audio') {
        const audioAttachment = (attachedFiles || []).find(a => a.type && a.type.startsWith('audio/'));
        if (audioAttachment) {
          await runGeneration(toolId, { blob: audioAttachment.file, fileName: audioAttachment.name });
          return true;
        }
        pending = { toolId, collected: {}, missingQueue: [] };
        showBanner(toolId);
        showRecorder();
        pushAssistantText('Tap the record button to capture the session, or attach an audio file with the **+** button.');
        return true;
      }

      const collected = (tool.extractFromText ? tool.extractFromText(contentText) : {}) || {};
      const missing = missingFieldsFor(tool, collected);

      if (missing.length === 0) {
        await runGeneration(toolId, collected);
        return true;
      }

      // 2+ still-missing fields is exactly the "compulsory need" case a
      // form beats several chat round-trips for — Lixa decides this on its
      // own, no manual trigger. A single missing field stays a quick
      // inline chat question instead (less friction than a whole modal).
      if (missing.length >= 2) {
        showBanner(toolId);
        pending = { toolId, collected, missingQueue: [] };
        pushAssistantText(`Just need a few details for your **${tool.meta.name}** — I've opened a quick form for it.`);
        showToolFormModal(tool, missing, collected, async (data) => {
          pending = null;
          hideBanner();
          await runGeneration(toolId, data);
        });
        return true;
      }

      pending = { toolId, collected, missingQueue: missing.map(f => f.key) };
      showBanner(toolId);
      const prompts = missing.map(f => `- ${f.prompt}`).join('\n');
      pushAssistantText(`A couple more details and I'll generate it:\n${prompts}`);
      return true;
    }

    async function continueSlotFilling(text) {
      pushUserText(text);
      const tool = TOOLS[pending.toolId];
      const nextKey = pending.missingQueue.shift();
      if (nextKey) pending.collected[nextKey] = text.trim();

      const missing = missingFieldsFor(tool, pending.collected).filter(f => pending.missingQueue.includes(f.key) || !(f.key in pending.collected));
      if (pending.missingQueue.length === 0 && missingFieldsFor(tool, pending.collected).length === 0) {
        const data = pending.collected;
        const toolId = pending.toolId;
        pending = null;
        hideBanner();
        await runGeneration(toolId, data);
        return true;
      }

      const nextFieldKey = pending.missingQueue[0];
      const nextField = (tool.requiredFields || []).find(f => f.key === nextFieldKey);
      if (nextField) {
        pushAssistantText(nextField.prompt);
      } else {
        // nothing left tracked but generate() will fall back to defaults for anything missing
        const data = pending.collected;
        const toolId = pending.toolId;
        pending = null;
        hideBanner();
        await runGeneration(toolId, data);
      }
      return true;
    }

    // =====================================================================
    // Auto-popup form modal — when a tool still needs 2+ pieces of info
    // Lixa couldn't pull from the message itself, a single form beats
    // several back-and-forth chat turns. Lixa decides this itself (no
    // manual trigger): one missing field stays a quick inline chat
    // question (continueSlotFilling), since a whole modal for one field is
    // more friction than it saves.
    let activeFormModal = null;

    function closeToolFormModal() {
      if (activeFormModal) { activeFormModal.remove(); activeFormModal = null; }
    }

    const onFormModalEscape = (e) => {
      if (e.key === 'Escape' && activeFormModal) {
        closeToolFormModal();
        pending = null;
        hideBanner();
      }
    };
    document.addEventListener('keydown', onFormModalEscape);
    cleanupFns.push(() => document.removeEventListener('keydown', onFormModalEscape));
    cleanupFns.push(() => closeToolFormModal());

    function showToolFormModal(tool, missingFields, collected, onSubmit) {
      closeToolFormModal();
      const modal = document.createElement('div');
      modal.className = 'lixa-form-modal';
      modal.innerHTML = `
        <div class="lixa-form-overlay"></div>
        <div class="lixa-form-card">
          <button type="button" class="lixa-form-close" aria-label="Cancel">&times;</button>
          <h3><span>${tool.meta.icon || '✨'}</span> ${core.escapeHtml(tool.meta.name)}</h3>
          <p class="lixa-form-sub">Just need a few details to generate this:</p>
          <form id="lixaToolForm">
            ${missingFields.map(f => `
              <div class="form-group">
                <label for="lixaField_${core.escapeHtml(f.key)}">${core.escapeHtml(f.prompt)}</label>
                <textarea id="lixaField_${core.escapeHtml(f.key)}" name="${core.escapeHtml(f.key)}" rows="2" required></textarea>
              </div>
            `).join('')}
            <button type="submit" class="btn-primary">Generate</button>
          </form>
        </div>
      `;
      // Appended inside Lixa's own (kept-alive) view container, not
      // document.body — Lixa is never unmounted when you navigate away
      // (js/router.js keeps it alive), so a modal parked on <body> would
      // otherwise keep floating over whatever page you navigate to next.
      // Nesting it here means it's hidden along with the rest of Lixa the
      // instant the view container gets display:none.
      const lixaContainer = chatMessages.closest('.kept-alive-view') || document.body;
      lixaContainer.appendChild(modal);
      activeFormModal = modal;
      requestAnimationFrame(() => modal.classList.add('open'));

      const firstInput = modal.querySelector('textarea');
      if (firstInput) firstInput.focus();

      modal.querySelector('.lixa-form-close').addEventListener('click', () => {
        closeToolFormModal();
        pending = null;
        hideBanner();
      });
      modal.querySelector('.lixa-form-overlay').addEventListener('click', () => {
        closeToolFormModal();
        pending = null;
        hideBanner();
      });
      modal.querySelector('#lixaToolForm').addEventListener('submit', (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const values = {};
        missingFields.forEach(f => { values[f.key] = (formData.get(f.key) || '').toString().trim(); });
        closeToolFormModal();
        onSubmit({ ...collected, ...values });
      });
    }

    const GENERIC_STAGES = ['Reading your request…', 'Working with the AI model…', 'Structuring the result…', 'Almost done…'];

    async function runGeneration(toolId, data) {
      const tool = TOOLS[toolId];
      hideBanner();
      const stages = (tool.meta.statusStages && tool.meta.statusStages.length) ? tool.meta.statusStages : GENERIC_STAGES;
      showStatus(stages);
      core.setWaiting(true);
      try {
        const result = await tool.generate(data);
        hideStatus();
        if (result && result.ok) {
          const summary = result.summary || `Here's your ${tool.meta.name.toLowerCase()}:`;
          pushAssistantText(summary, result.fileCard);
          // A tool flow's first assistant message is usually just "which
          // details do you still need?", not real content — title from
          // this genuine completion instead, once there is one, overriding
          // whatever that earlier premature save already locked in.
          if (core.refineTitleAndSave) {
            const allMessages = core.getMessages();
            const firstUserMsg = allMessages.find(m => m.role === 'user');
            if (firstUserMsg) {
              core.refineTitleAndSave(firstUserMsg.displayContent || firstUserMsg.content, summary);
            }
          }
        } else {
          pushAssistantText(`Sorry, I couldn't generate that: ${(result && result.error) || 'unknown error'}. Want to try again?`);
        }
      } catch (err) {
        hideStatus();
        console.error('[lixa] generation failed', err);
        pushAssistantText(`Sorry, something went wrong generating that (${err.message || err}). Want to try again?`);
      } finally {
        core.setWaiting(false);
        core.refreshHistoryList && core.refreshHistoryList();
      }
    }

    // =====================================================================
    // Inline audio recorder
    // =====================================================================
    function showRecorder() {
      removeRecorder();
      const el = document.createElement('div');
      el.className = 'lixa-audio-recorder';
      el.id = 'lixaAudioRecorder';
      el.innerHTML = `
        <button type="button" class="lixa-record-btn" id="lixaRecordBtn" aria-label="Record"><i class="fas fa-microphone"></i></button>
        <span class="lixa-record-timer" id="lixaRecordTimer">00:00</span>
        <span class="lixa-record-hint">Recording your session for transcription…</span>
      `;
      toolBanner.insertAdjacentElement('afterend', el);
      const btn = el.querySelector('#lixaRecordBtn');
      let mediaRecorder = null, chunks = [], startTs = 0, timerInt = null, stream = null;

      btn.addEventListener('click', async () => {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          } catch (err) {
            core.showToast('Microphone access denied', 'error');
            return;
          }
          chunks = [];
          mediaRecorder = new MediaRecorder(stream);
          mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
          mediaRecorder.onstop = async () => {
            clearInterval(timerInt);
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(chunks, { type: 'audio/webm' });
            removeRecorder();
            pending = null;
            await runGeneration('audio', { blob, fileName: 'recording.webm' });
          };
          mediaRecorder.start();
          startTs = Date.now();
          btn.classList.add('recording');
          btn.innerHTML = '<i class="fas fa-stop"></i>';
          timerInt = setInterval(() => {
            const secs = Math.floor((Date.now() - startTs) / 1000);
            const mm = String(Math.floor(secs / 60)).padStart(2, '0');
            const ss = String(secs % 60).padStart(2, '0');
            const timerEl = document.getElementById('lixaRecordTimer');
            if (timerEl) timerEl.textContent = `${mm}:${ss}`;
          }, 500);
        } else {
          mediaRecorder.stop();
        }
      });

      recorderState = { remove: () => { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); clearInterval(timerInt); el.remove(); } };
    }

    function removeRecorder() {
      const el = document.getElementById('lixaAudioRecorder');
      if (el) el.remove();
      recorderState = null;
    }

    // =====================================================================
    // Main entry point, called by ask.js's handleSend()
    // =====================================================================
    async function tryHandle(text, attachedFiles) {
      if (pending) {
        if (!text) return false;
        return await continueSlotFilling(text);
      }

      const atMatch = text.match(/^@(\w+)\b\s*([\s\S]*)$/);
      if (atMatch && TOOLS[atMatch[1].toLowerCase()]) {
        const toolId = atMatch[1].toLowerCase();
        const rest = atMatch[2].trim();
        return await startTool(toolId, text, rest, attachedFiles, { confirmed: true });
      }

      if (!text) return false;
      const detected = detectToolIntent(text, attachedFiles);
      if (detected && detected.score >= CONFIDENCE_THRESHOLD && isGenuineToolRequest(text, detected, attachedFiles)) {
        return await startTool(detected.toolId, text, text, attachedFiles, { confirmed: false });
      }

      return false;
    }

    function handleFileAction(actionId, card) {
      if (!card || !card.toolId) return;
      const tool = TOOLS[card.toolId];
      if (tool && typeof tool.handleAction === 'function') {
        tool.handleAction(actionId, card);
      }
    }

    window.LixaOrchestrator = { tryHandle, handleFileAction };

    // =====================================================================
    // History drawer: Chats / Files toggle (single icon button — the icon
    // shows what you'd switch TO) — files are every native per-tool record
    // (formats/standardizedTools/caseHistory/audio/assignments/study sets),
    // filterable by which tool it came from, not by uploaded-file type.
    // =====================================================================
    let currentView = 'chats';
    let allFiles = [];
    let selectedFileType = 'all';

    function setView(view) {
      currentView = view;
      const isChats = view === 'chats';
      if (chatsSearchWrap) chatsSearchWrap.hidden = !isChats;
      if (historyList) historyList.hidden = !isChats;
      if (filesSearchWrap) filesSearchWrap.hidden = isChats;
      if (fileFilterSelect) fileFilterSelect.hidden = isChats;
      if (filesList) filesList.hidden = isChats;
      if (filesToggleBtn) {
        filesToggleBtn.classList.toggle('active', !isChats);
        filesToggleBtn.setAttribute('aria-pressed', String(!isChats));
        filesToggleBtn.setAttribute('aria-label', isChats ? 'Show files' : 'Show chats');
        filesToggleBtn.title = isChats ? 'Files' : 'Chats';
        const icon = filesToggleBtn.querySelector('i');
        if (icon) icon.className = isChats ? 'fas fa-folder' : 'fas fa-comment-dots';
      }
      if (!isChats) loadFilesList();
    }

    if (filesToggleBtn) {
      filesToggleBtn.addEventListener('click', () => setView(currentView === 'chats' ? 'files' : 'chats'));
    }

    // Loading skeleton (#filesLoading) is a permanent sibling, not a child
    // we'd clobber — only the rendered rows/message get replaced here, the
    // same pattern renderHistoryList() uses for the Chats tab.
    function clearFilesRows() {
      filesList.querySelectorAll(':scope > *:not(#filesLoading)').forEach(el => el.remove());
    }

    function showFilesMessage(iconClass, text) {
      clearFilesRows();
      filesList.insertAdjacentHTML('beforeend', `<div class="empty-state"><i class="bx ${iconClass}"></i><p>${text}</p></div>`);
    }

    async function loadFilesList() {
      const user = core.getCurrentUser();
      if (!user) {
        showFilesMessage('bx-lock-alt', 'Log in to see your files');
        return;
      }
      const database = core.getDatabase();
      clearFilesRows();
      if (filesLoading) filesLoading.hidden = false;
      try {
        const results = await Promise.all(FILE_SOURCES.map(src =>
          database.ref(`history/${user.uid}/${src.path}`).once('value').then(snap => {
            const data = snap.val();
            if (!data) return [];
            return Object.entries(data).map(([id, item]) => ({
              id, type: src.type, label: src.label, icon: src.icon,
              title: (src.titleOf && src.titleOf(item)) || item.title || item.toolName || item.topic || item.subject || 'Untitled',
              createdAt: item.createdAt || item.updatedAt || item.timestamp || 0,
              raw: item
            }));
          }).catch(() => [])
        ));
        allFiles = results.flat().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        renderFileFilterOptions();
        renderFilesList();
      } catch (err) {
        console.error('[lixa] failed to load files', err);
        showFilesMessage('bx-error', 'Could not load files');
      } finally {
        if (filesLoading) filesLoading.hidden = true;
      }
    }

    function renderFileFilterOptions() {
      if (!fileFilterSelect) return;
      const typesPresent = new Set(allFiles.map(f => f.type));
      const sources = FILE_SOURCES.filter(s => typesPresent.has(s.type));
      const current = fileFilterSelect.value || 'all';
      fileFilterSelect.innerHTML = `<option value="all">All files</option>` +
        sources.map(s => `<option value="${s.type}">${core.escapeHtml(s.label)}</option>`).join('');
      fileFilterSelect.value = sources.some(s => s.type === current) || current === 'all' ? current : 'all';
      selectedFileType = fileFilterSelect.value;
    }

    if (fileFilterSelect) {
      fileFilterSelect.addEventListener('change', () => {
        selectedFileType = fileFilterSelect.value;
        renderFilesList();
      });
    }

    function renderFilesList() {
      const term = (filesSearchInput.value || '').toLowerCase().trim();
      const filtered = allFiles.filter(f =>
        (selectedFileType === 'all' || f.type === selectedFileType) &&
        (!term || f.title.toLowerCase().includes(term))
      );
      if (filtered.length === 0) {
        showFilesMessage('bx-file-blank', 'No files yet');
        return;
      }
      clearFilesRows();
      filesList.insertAdjacentHTML('beforeend', filtered.map(f => `
        <div class="history-file-item" data-id="${f.id}" data-type="${f.type}">
          <span class="file-icon">${f.icon}</span>
          <span class="file-info">
            <span class="file-name" title="${core.escapeHtml(f.title)}">${core.escapeHtml(f.title)}</span>
            <span class="file-tool-label">${core.escapeHtml(f.label)}</span>
          </span>
        </div>
      `).join(''));
      filesList.querySelectorAll('.history-file-item').forEach(el => {
        el.addEventListener('click', () => openFile(el.dataset.type, el.dataset.id));
      });
    }

    function openFile(type, id) {
      const item = allFiles.find(f => f.id === id && f.type === type);
      const gen = TOOLS[type];
      // Tools without a dedicated stable result page open a quick view
      // built straight from the saved record instead of navigating.
      if (gen && typeof gen.openFromRecord === 'function' && item) {
        gen.openFromRecord(item.raw, id);
        historyDrawer.classList.remove('active');
        return;
      }
      const links = {
        format: `index.html?type=format&id=${id}#/result`,
        standardized: `index.html?openId=${id}#/standardized`,
        presentation: `index.html?type=case&id=${id}#/result`,
        audio: `index.html?openId=${id}#/audio`,
        assignment: `index.html?type=answer&id=${id}#/result`,
        study: `index.html?subject=${id}#/study`
      };
      const href = links[type];
      if (href) window.open(href, '_blank');
      historyDrawer.classList.remove('active');
    }

    if (filesSearchInput) filesSearchInput.addEventListener('input', renderFilesList);

    // Deliberately no "reset to Chats on open" here — the drawer keeps
    // whichever of Chats/Files (and its search text) was last active, same
    // as everything else the app now preserves across being closed/reopened
    // rather than rebuilt from scratch every time.
  }
})();
