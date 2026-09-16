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

  // Native Firebase history paths each tool already writes to (used to
  // build the unified Files view without a separate data store).
  const FILE_SOURCES = [
    { type: 'format', label: 'Formats', path: 'formats', icon: '📋' },
    { type: 'standardized', label: 'Standardized Tools', path: 'standardizedTools', icon: '⚖️' },
    { type: 'presentation', label: 'Presentations/Reports', path: 'caseHistory', icon: '📑' },
    { type: 'audio', label: 'Audio', path: 'audio', icon: '🎧' },
    { type: 'assignment', label: 'Assignments', path: 'assignments', icon: '📝' },
    { type: 'study', label: 'Study Sets', path: 'study/sets', icon: '🧠' }
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

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.lixa = { mount, unmount };

  function init() {
    if (!window.LixaCore) return; // ask.js's mount() didn't run — bail defensively
    const core = window.LixaCore;

    const messageInput = document.getElementById('messageInput');
    const mentionPopup = document.getElementById('mentionPopup');
    const toolBanner = document.getElementById('lixaToolBanner');
    const chatMessages = document.getElementById('chatMessages');
    const historyDrawer = document.getElementById('historyDrawer');
    const drawerSwitch = document.getElementById('drawerSwitch');
    const chatsView = document.getElementById('chatsView');
    const chatsSearchWrap = document.getElementById('chatsSearchWrap');
    const historyList = document.getElementById('historyList');
    const filesSearchWrap = document.getElementById('filesSearchWrap');
    const filesSearchInput = document.getElementById('filesSearchInput');
    const fileFilterChips = document.getElementById('fileFilterChips');
    const filesList = document.getElementById('filesList');

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
        (tool.meta.keywords || []).forEach(kw => {
          if (lower.includes(kw)) score += 1;
        });
        // A regex pattern is a stronger, more general signal than any single
        // keyword phrase (catches e.g. "generate the Oswestry Disability
        // Index" without needing every possible scale name enumerated).
        if (tool.meta.pattern && tool.meta.pattern.test(text || '')) score += 2;
        if (tool.meta.id === 'audio' && attachedFiles && attachedFiles.some(a => a.type && a.type.startsWith('audio/'))) {
          score += 5;
        }
        if (!best || score > best.score) best = { toolId: tool.meta.id, score };
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
          pushAssistantText(result.summary || `Here's your ${tool.meta.name.toLowerCase()}:`, result.fileCard);
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
      if (detected && detected.score >= CONFIDENCE_THRESHOLD) {
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
    // History drawer: Chats / Files switch
    // =====================================================================
    let currentView = 'chats';
    let allFiles = [];
    let activeFileTypes = new Set(FILE_SOURCES.map(s => s.type));

    function setView(view) {
      currentView = view;
      drawerSwitch.querySelectorAll('.drawer-switch-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
      const isChats = view === 'chats';
      chatsView.style.display = isChats ? '' : 'none';
      chatsSearchWrap.style.display = isChats ? '' : 'none';
      historyList.style.display = isChats ? '' : 'none';
      filesSearchWrap.hidden = isChats;
      fileFilterChips.hidden = isChats;
      filesList.hidden = isChats;
      if (!isChats) loadFilesList();
    }

    if (drawerSwitch) {
      drawerSwitch.addEventListener('click', (e) => {
        const btn = e.target.closest('.drawer-switch-btn');
        if (btn) setView(btn.dataset.view);
      });
    }

    async function loadFilesList() {
      const user = core.getCurrentUser();
      if (!user) {
        filesList.innerHTML = '<div class="empty-state"><i class="bx bx-lock-alt"></i><p>Log in to see your files</p></div>';
        return;
      }
      const database = core.getDatabase();
      filesList.innerHTML = '<div class="empty-state"><i class="bx bx-loader-alt"></i><p>Loading…</p></div>';
      try {
        const results = await Promise.all(FILE_SOURCES.map(src =>
          database.ref(`history/${user.uid}/${src.path}`).once('value').then(snap => {
            const data = snap.val();
            if (!data) return [];
            return Object.entries(data).map(([id, item]) => ({
              id, type: src.type, label: src.label, icon: src.icon,
              title: item.title || item.toolName || item.topic || item.subject || 'Untitled',
              createdAt: item.createdAt || item.updatedAt || 0,
              raw: item
            }));
          }).catch(() => [])
        ));
        allFiles = results.flat().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        renderFilterChips();
        renderFilesList();
      } catch (err) {
        console.error('[lixa] failed to load files', err);
        filesList.innerHTML = '<div class="empty-state"><i class="bx bx-error"></i><p>Could not load files</p></div>';
      }
    }

    function renderFilterChips() {
      fileFilterChips.innerHTML = FILE_SOURCES.map(src => `
        <button type="button" class="file-filter-chip${activeFileTypes.has(src.type) ? ' active' : ''}" data-type="${src.type}">${src.icon} ${src.label}</button>
      `).join('');
      fileFilterChips.querySelectorAll('.file-filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const t = chip.dataset.type;
          if (activeFileTypes.has(t)) activeFileTypes.delete(t); else activeFileTypes.add(t);
          chip.classList.toggle('active');
          renderFilesList();
        });
      });
    }

    function renderFilesList() {
      const term = (filesSearchInput.value || '').toLowerCase().trim();
      const filtered = allFiles.filter(f => activeFileTypes.has(f.type) && (!term || f.title.toLowerCase().includes(term)));
      if (filtered.length === 0) {
        filesList.innerHTML = '<div class="empty-state"><i class="bx bx-file-blank"></i><p>No matching files</p></div>';
        return;
      }
      filesList.innerHTML = filtered.map(f => {
        const date = new Date(f.createdAt || Date.now());
        return `
          <div class="history-item file-item" data-id="${f.id}" data-type="${f.type}">
            <span class="history-title"><span class="file-type-badge">${f.label}</span> ${core.escapeHtml(f.title)}</span>
            <div class="history-meta">
              <span><i class="far fa-calendar-alt"></i> ${date.toLocaleDateString()}</span>
            </div>
          </div>
        `;
      }).join('');
      filesList.querySelectorAll('.file-item').forEach(el => {
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
        format: `index.html?id=${id}#/formatresult`,
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

    // Reset to Chats view whenever the drawer is (re)opened via the nav button
    const historyNavBtn = document.getElementById('historyNavBtn');
    if (historyNavBtn) {
      historyNavBtn.addEventListener('click', () => setView('chats'));
    }
  }
})();
