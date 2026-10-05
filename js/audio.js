// js/audio.js — Audio Transcription: live recording (with Web Speech API
// live captions) or file upload (Whisper transcription), a careful
// non-hallucinating AI cleanup pass, and local-first persistence so a
// reload/crash/background-tab never loses a recording in progress.
// Registered as the "audio" SPA view.

(function () {
let cleanupFns = [];
let activeSessionStopper = null; // set while a live session is recording, cleared on finalize/reset

function mount() {
  const database = firebase.database();

  // =========================================================================
  // CONSTANTS
  // =========================================================================
  const DB_NAME = 'rehablix_audio_db';
  const DB_VERSION = 2; // v2: + live transcription segments
  const STORE_SESSIONS = 'sessions';
  const STORE_CHUNKS = 'chunks';
  const STORE_SEGMENTS = 'segments';
  // Live transcription: short self-contained clips cut from the SAME mic
  // stream the recording uses (no browser SpeechRecognition, so no second
  // capture session, no listening beeps and no restart loops on mobile).
  const LIVE_TARGET_MS = 6000;   // aim for ~6s clips…
  const LIVE_MAX_MS = 9000;      // …never longer than this
  const LIVE_MIN_MS = 2500;      // …and never shorter than this (except on stop/pause)
  const SILENCE_RMS = 0.012;     // below this the room is treated as quiet
  const SILENCE_HOLD_MS = 300;   // cut once it has been quiet this long
  const LIVE_MAX_RETRIES = 3;
  const LIVE_CONCURRENCY = 2;
  const CHUNK_INTERVAL_MS = 20000;
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  const CLEANUP_CHUNK_CHARS = 6000;

  const PROFESSIONAL_LABELS = {
    occupational_therapist: 'Occupational Therapist',
    physiotherapist: 'Physiotherapist',
    speech_language_therapist: 'Speech-Language Therapist',
    psychologist: 'Psychologist',
    psychiatrist: 'Psychiatrist',
    rehab_nurse: 'Rehabilitation Nurse',
    general_clinician: 'Clinician'
  };

  // =========================================================================
  // DOM REFS
  // =========================================================================
  const $ = (id) => document.getElementById(id);

  const resumeBanner = $('resumeBanner');
  const resumeBannerText = $('resumeBannerText');
  const resumeSessionBtn = $('resumeSessionBtn');
  const discardSessionBtn = $('discardSessionBtn');

  const stageSetup = $('stageSetup');
  const stageRecord = $('stageRecord');
  const stageProcessing = $('stageProcessing');
  const stageResult = $('stageResult');
  const progressSteps = document.querySelectorAll('.progress-step');

  const sessionTitleInput = $('sessionTitle');
  const sessionTypeSelect = $('sessionType');
  const professionalSelect = $('professionalType');
  const sourceModeTabs = $('sourceModeTabs');
  const liveSetupPanel = $('liveSetupPanel');
  const uploadSetupPanel = $('uploadSetupPanel');
  const startSetupBtn = $('startSetupBtn');

  const uploadDropzone = $('uploadDropzone');
  const audioFileInput = $('audioFileInput');
  const uploadFileInfo = $('uploadFileInfo');
  const transcribeUploadBtn = $('transcribeUploadBtn');

  const recIndicator = $('recIndicator');
  const recStatusText = $('recStatusText');
  const recTimer = $('recTimer');
  const waveformCanvas = $('waveformCanvas');
  const pauseResumeBtn = $('pauseResumeBtn');
  const stopRecordingBtn = $('stopRecordingBtn');
  const liveTranscriptText = $('liveTranscriptText');

  const processingTitle = $('processingTitle');
  const processingStatus = $('processingStatus');
  const processingProgressFill = $('processingProgressFill');

  const resultTitle = $('resultTitle');
  const resultMeta = $('resultMeta');
  const newSessionBtn = $('newSessionBtn');
  const viewCleanedBtn = $('viewCleanedBtn');
  const viewRawBtn = $('viewRawBtn');
  const transcriptTextarea = $('transcriptTextarea');
  const copyTranscriptBtn = $('copyTranscriptBtn');
  const downloadTranscriptBtn = $('downloadTranscriptBtn');
  const downloadAudioBtn = $('downloadAudioBtn');
  const saveTranscriptBtn = $('saveTranscriptBtn');

  // EMR UPGRADE (item 4): optional link to a Smart EMR patient.
  const audioPatientName = $('audioPatientName');
  const audioPatientList = $('audioPatientList');
  const audioPatientHint = $('audioPatientHint');
  const audioPrevSessionHint = $('audioPrevSessionHint');

  // AUDIO UPGRADE: microphone device picker + noise handling, upload
  // preview, and a way to cancel an in-progress transcription.
  const micDeviceSelect = $('micDeviceSelect');
  const uploadWaveformCanvas = $('uploadWaveformCanvas');
  const cancelProcessingBtn = $('cancelProcessingBtn');

  // Coach mode (setup + live panel)
  const audioModeTabs = $('audioModeTabs');
  const coachSetupPanel = $('coachSetupPanel');
  const coachConsentInput = $('coachConsent');
  const coachLivePanel = $('coachLivePanel');
  const coachSuggestionsList = $('coachSuggestionsList');
  const coachSpeakToggle = $('coachSpeakToggle');
  const coachSpeakHint = $('coachSpeakHint');

  // History lives in the shell's single global drawer (js/history-drawer.js) —
  // this view registers its data source as a provider (see the History section).

  // =========================================================================
  // STATE
  // =========================================================================
  let currentUser = null;
  let scopeUid = null;
  let emrPatientsForLink = []; // EMR UPGRADE (item 4)
  let matchedEmrPatient = null;
  // FIX: was 'openai/gpt-4.1' — not a valid OpenAI model id, so the narrative
  // pass always failed and silently fell back to the raw transcript.
  let aiConfig = { token: null, endpoint: null, model: 'gpt-4.1' };
  let idb = null;

  let sourceMode = 'live';
  let localSessionId = null;
  let sessionMeta = null;
  let mediaStream = null;
  let mediaRecorder = null;
  let chunkIndex = 0;
  let isPaused = false;
  let timerInterval = null;
  let pauseStartedAt = null;
  let wakeLockSentinel = null;
  let rawSegments = [];
  let cleanedTranscript = '';
  let audioContext = null, analyser = null, waveformRAF = null;
  let uploadedFile = null;
  let firebaseAudioId = null;
  let currentView = 'cleaned';
  let recordedMimeType = 'audio/webm';
  let interimEl = null;
  // Live transcription engine state (see "LIVE TRANSCRIPTION" below).
  let liveSegments = [];          // index -> { status, text, speaker, parts, tries }
  let segRecorder = null, segParts = [], segStartedAt = 0, segPeak = 0;
  let segStopResolve = null, liveMonitorTimer = null, quietSince = null;
  let liveInFlight = 0, liveQueue = [], liveQuotaBlocked = false, liveAbort = null;
  // Coach mode
  let audioMode = 'transcribe';   // 'transcribe' | 'coach'
  let coachSuggestions = [];      // { id, text, askedAt, afterIndex }
  let lastSuggestAt = 0, suggestTimer = null, suggestInFlight = false;
  let headphonesDetected = false, speakSuggestions = false;
  let currentPlan = 'free';
  let selectedDeviceId = localStorage.getItem('rehablix_audio_input_device') || '';
  let transcriptionAbortController = null;
  let recorderStoppedResolve = null;
  let prevSessionsForPatient = [];

  function showToast(message, type = 'success', duration = 3000) {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = 'background:var(--surface,#222);color:var(--text-primary,#fff);padding:0.7rem 1.1rem;border-radius:0.6rem;margin-top:0.5rem;box-shadow:0 6px 20px rgba(0,0,0,0.2);font-size:0.85rem;border-left:4px solid ' +
      (type === 'error' ? '#ef4444' : type === 'info' ? '#3b82f6' : '#22c55e');
    container.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
  }

  function openIDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => { idb = request.result; resolve(idb); };
      request.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_SESSIONS)) d.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(STORE_CHUNKS)) d.createObjectStore(STORE_CHUNKS, { keyPath: 'key' });
        if (!d.objectStoreNames.contains(STORE_SEGMENTS)) d.createObjectStore(STORE_SEGMENTS, { keyPath: 'key' });
      };
    });
  }

  // Live-transcription clips: { key, sessionId, index, blob, status, text, speaker }.
  async function idbPutSegment(sessionId, index, rec) {
    if (!idb) await openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction([STORE_SEGMENTS], 'readwrite');
      tx.objectStore(STORE_SEGMENTS).put(Object.assign({ key: `${sessionId}_${index}`, sessionId, index }, rec));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGetSegmentsForSession(sessionId) {
    if (!idb) await openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction([STORE_SEGMENTS], 'readonly');
      const req = tx.objectStore(STORE_SEGMENTS).getAll();
      req.onsuccess = () => resolve((req.result || []).filter(s => s.sessionId === sessionId).sort((a, b) => a.index - b.index));
      req.onerror = () => reject(req.error);
    });
  }
  async function idbDeleteSegmentsForSession(sessionId) {
    const segs = await idbGetSegmentsForSession(sessionId);
    return new Promise((resolve, reject) => {
      const tx = idb.transaction([STORE_SEGMENTS], 'readwrite');
      segs.forEach(s => tx.objectStore(STORE_SEGMENTS).delete(s.key));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbPutSession(session) {
    if (!idb) await openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction([STORE_SESSIONS], 'readwrite');
      tx.objectStore(STORE_SESSIONS).put(session);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGetAllSessions() {
    if (!idb) await openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction([STORE_SESSIONS], 'readonly');
      const req = tx.objectStore(STORE_SESSIONS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbDeleteSession(id) {
    if (!idb) await openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction([STORE_SESSIONS], 'readwrite');
      tx.objectStore(STORE_SESSIONS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbPutChunk(sessionId, index, blob) {
    if (!idb) await openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction([STORE_CHUNKS], 'readwrite');
      tx.objectStore(STORE_CHUNKS).put({ key: `${sessionId}_${index}`, sessionId, index, blob });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function idbGetChunksForSession(sessionId) {
    if (!idb) await openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction([STORE_CHUNKS], 'readonly');
      const req = tx.objectStore(STORE_CHUNKS).getAll();
      req.onsuccess = () => {
        const all = (req.result || []).filter(c => c.sessionId === sessionId);
        all.sort((a, b) => a.index - b.index);
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    });
  }
  async function idbDeleteChunksForSession(sessionId) {
    const chunks = await idbGetChunksForSession(sessionId);
    if (!idb) await openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction([STORE_CHUNKS], 'readwrite');
      const store = tx.objectStore(STORE_CHUNKS);
      chunks.forEach(c => store.delete(c.key));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function newSessionId() { return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9); }

  function setStage(n) {
    [stageSetup, stageRecord, stageProcessing, stageResult].forEach(s => s.classList.remove('active'));
    [stageSetup, stageRecord, stageProcessing, stageResult][n - 1].classList.add('active');
    // The page layout (css/audio.css) keys off this: 1 idle card, 2 recording
    // in the same card, 3 processing, 4 result.
    const main = document.querySelector('.audio-main');
    if (main) main.dataset.stage = String(n);
    const locked = n !== 1;
    sourceModeTabs.querySelectorAll('.au-source-tab').forEach(b => { b.disabled = locked || (b.dataset.source === 'upload' && audioMode === 'coach'); });
    const modeBtn = $('auModeToggleBtn');
    if (modeBtn) modeBtn.disabled = locked;
    progressSteps.forEach(step => {
      const stepNum = parseInt(step.dataset.step, 10);
      step.classList.toggle('active', stepNum === Math.min(n, 3));
      step.classList.toggle('completed', stepNum < n);
    });
  }

  // ---- Page chrome: source switch, Transcribe/Coach toggle, details modal ----
  const auModeToggleBtn = $('auModeToggleBtn');
  const auModeChip = $('auModeChip');
  const auCardTitle = $('auCardTitle');
  const auLiveFeed = $('auLiveFeed');
  const auDetailsModal = $('auDetailsModal');
  const auMicGroup = $('auMicGroup');

  function applySourceMode() {
    const live = sourceMode === 'live';
    liveSetupPanel.style.display = live ? 'block' : 'none';
    uploadSetupPanel.style.display = live ? 'none' : 'block';
    if (auLiveFeed) auLiveFeed.style.display = live ? '' : 'none';
    if (auModeToggleBtn) auModeToggleBtn.hidden = !live;
    if (auMicGroup) auMicGroup.style.display = live ? '' : 'none';
    if (auCardTitle) auCardTitle.textContent = live ? (audioMode === 'coach' ? 'Coach session' : 'Live transcription') : 'Upload audio';
    if (auModeChip) auModeChip.hidden = !(live && audioMode === 'coach');
  }

  sourceModeTabs.querySelectorAll('.au-source-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      sourceModeTabs.querySelectorAll('.au-source-tab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      sourceMode = btn.dataset.source;
      try { localStorage.setItem('rehablix_audio_source', sourceMode); } catch (e) {}
      applySourceMode();
    });
  });

  // Transcript is tucked away by default so the clinician isn't distracted
  // mid-session; the header rolls it down/up (the choice is remembered).
  const auFeedToggle = $('auFeedToggle');
  function setFeedOpen(open) {
    if (!auLiveFeed || !auFeedToggle) return;
    auLiveFeed.classList.toggle('collapsed', !open);
    auFeedToggle.setAttribute('aria-expanded', String(open));
    if (open && liveTranscriptText) liveTranscriptText.scrollTop = liveTranscriptText.scrollHeight;
  }
  if (auFeedToggle) {
    auFeedToggle.addEventListener('click', () => {
      const open = auLiveFeed.classList.contains('collapsed');
      setFeedOpen(open);
      try { localStorage.setItem('rehablix_audio_feed_open', open ? '1' : '0'); } catch (e) {}
    });
    let wantOpen = false;
    try { wantOpen = localStorage.getItem('rehablix_audio_feed_open') === '1'; } catch (e) {}
    setFeedOpen(wantOpen);
  }

  // Programmatic Transcribe/Coach switch (restoring the last mode, resuming a session).
  function setAudioMode(mode) {
    const b = audioModeTabs && audioModeTabs.querySelector('[data-mode="' + mode + '"]');
    if (b) b.click();
    if (auModeToggleBtn) { auModeToggleBtn.classList.toggle('active', audioMode === 'coach'); auModeToggleBtn.setAttribute('aria-pressed', String(audioMode === 'coach')); }
    applySourceMode();
  }

  if (auModeToggleBtn) auModeToggleBtn.addEventListener('click', () => {
    const next = audioMode === 'coach' ? 'transcribe' : 'coach';
    const b = audioModeTabs && audioModeTabs.querySelector(`[data-mode="${next}"]`);
    if (b) b.click();
    auModeToggleBtn.classList.toggle('active', audioMode === 'coach');
    auModeToggleBtn.setAttribute('aria-pressed', String(audioMode === 'coach'));
    applySourceMode();
    showToast(audioMode === 'coach' ? 'Coach mode: automatic speaker labels + a suggested question' : 'Transcribe mode', 'info', 2200);
  });

  function openDetails() { if (!auDetailsModal) return; auDetailsModal.hidden = false; setTimeout(() => sessionTitleInput && sessionTitleInput.focus(), 30); }
  function closeDetails() { if (!auDetailsModal) return; auDetailsModal.hidden = true; const b = $('auDetailsBtn'); if (b) b.focus(); }
  if ($('auDetailsBtn')) $('auDetailsBtn').addEventListener('click', openDetails);
  if ($('auDetailsClose')) $('auDetailsClose').addEventListener('click', closeDetails);
  if ($('auDetailsDone')) $('auDetailsDone').addEventListener('click', closeDetails);
  if (auDetailsModal) {
    auDetailsModal.addEventListener('click', (e) => { if (e.target === auDetailsModal) closeDetails(); });
    auDetailsModal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetails(); });
  }

  // Transcribe (default) / Coach
  if (audioModeTabs) {
    audioModeTabs.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        audioModeTabs.querySelectorAll('[data-mode]').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        audioMode = btn.dataset.mode;
        try { localStorage.setItem('rehablix_audio_mode', audioMode); } catch (e) {}
        if (coachSetupPanel) coachSetupPanel.style.display = audioMode === 'coach' ? 'block' : 'none';
        // Coach works on a live conversation; uploads stay plain transcription.
        const uploadTab = sourceModeTabs.querySelector('[data-source="upload"]');
        if (uploadTab) {
          uploadTab.disabled = audioMode === 'coach';
          if (audioMode === 'coach' && sourceMode === 'upload') sourceModeTabs.querySelector('[data-source="live"]').click();
        }
        if (audioMode === 'coach') detectHeadphones();
      });
    });
  }
  if (coachSuggestionsList) {
    coachSuggestionsList.addEventListener('click', (e) => {
      const b = e.target.closest('.coach-asked-btn');
      if (!b) return;
      const s = coachSuggestions.find(x => x.id === b.dataset.id);
      if (s) { s.askedAt = new Date().toISOString(); saveSuggestionState(); renderCoachPanel(); }
    });
  }
  if (coachSpeakToggle) coachSpeakToggle.addEventListener('change', () => { speakSuggestions = coachSpeakToggle.checked && headphonesDetected; });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    const onDevices = () => { if (audioMode === 'coach') detectHeadphones(); };
    navigator.mediaDevices.addEventListener('devicechange', onDevices);
    cleanupFns.push(() => navigator.mediaDevices.removeEventListener('devicechange', onDevices));
  }

  uploadDropzone.addEventListener('click', () => audioFileInput.click());
  uploadDropzone.addEventListener('dragover', (e) => { e.preventDefault(); uploadDropzone.classList.add('dragover'); });
  uploadDropzone.addEventListener('dragleave', () => uploadDropzone.classList.remove('dragover'));
  uploadDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadDropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFileSelected(e.dataTransfer.files[0]);
  });
  audioFileInput.addEventListener('change', () => {
    if (audioFileInput.files[0]) handleFileSelected(audioFileInput.files[0]);
  });

  function handleFileSelected(file) {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|webm|ogg|aac|flac)$/i.test(file.name)) {
      showToast('Please choose an audio file', 'error');
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      showToast('That file is over 25 MB, the most the transcription service accepts in one file. Please trim it or split it into shorter clips.', 'error', 6000);
      return;
    }
    uploadedFile = file;
    uploadFileInfo.style.display = 'flex';
    uploadFileInfo.innerHTML = `<i class="fas fa-file-audio"></i> ${escapeHtml(file.name)} (${(file.size / 1024 / 1024).toFixed(1)}MB)`;
    transcribeUploadBtn.disabled = false;
    drawUploadWaveform(file);
  }

  // AUDIO UPGRADE: a quick static waveform + duration preview for an
  // uploaded file, so the clinician can confirm it's the right recording
  // before spending a transcription on it — upload previously showed only
  // the file name/size.
  async function drawUploadWaveform(file) {
    if (!uploadWaveformCanvas) return;
    uploadWaveformCanvas.style.display = 'none';
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const raw = audioBuffer.getChannelData(0);
      const canvas = uploadWaveformCanvas;
      const w = canvas.width = canvas.clientWidth || 300;
      const h = canvas.height = 80;
      const barCount = Math.min(120, Math.floor(w / 3));
      const blockSize = Math.floor(raw.length / barCount);
      const peaks = [];
      for (let i = 0; i < barCount; i++) {
        let max = 0;
        const start = i * blockSize;
        for (let j = 0; j < blockSize; j++) max = Math.max(max, Math.abs(raw[start + j] || 0));
        peaks.push(max);
      }
      const drawCtx = canvas.getContext('2d');
      drawCtx.clearRect(0, 0, w, h);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--audio-accent').trim() || '#7c3aed';
      drawCtx.fillStyle = accent;
      const barWidth = w / barCount;
      peaks.forEach((p, i) => {
        const barHeight = Math.max(2, p * h);
        drawCtx.fillRect(i * barWidth, (h - barHeight) / 2, Math.max(1, barWidth - 1), barHeight);
      });
      uploadFileInfo.innerHTML += ` <span style="color:var(--text-secondary);">· ${formatTime(Math.round(audioBuffer.duration))}</span>`;
      uploadWaveformCanvas.style.display = 'block';
      ctx.close().catch(() => {});
    } catch (err) {
      console.warn('Could not render upload preview waveform:', err);
    }
  }

  transcribeUploadBtn.addEventListener('click', async () => {
    if (!uploadedFile || !currentUser) return;
    if (scopeUid === null) { showToast('Your access to Audio Transcription has been turned off by your center admin.', 'error', 6000); return; }
    try { await checkQuotaOrThrow(); } catch (err) { showToast(err.message, 'error', 6000); return; }

    localSessionId = newSessionId();
    if (resume) {
      // Same session, new stretch of audio. The time away is counted as a
      // pause, and the chunk where this stretch starts is remembered: each
      // stretch is its own audio container, so a whole-recording transcription
      // has to treat them separately.
      const activeMs = (sessionMeta.elapsedSeconds || 0) * 1000;
      const gap = Date.now() - new Date(sessionMeta.startedAt).getTime() - (sessionMeta.pausedAccumMs || 0) - activeMs;
      sessionMeta.pausedAccumMs = (sessionMeta.pausedAccumMs || 0) + Math.max(0, gap);
      sessionMeta.partStarts = (sessionMeta.partStarts || []).concat(chunkIndex);
      sessionMeta.status = 'recording';
      pauseStartedAt = null;
      await idbPutSession(sessionMeta);
      beginRecorder();
      renderLiveTranscript();
      renderCoachPanel();
      return;
    }

    sessionMeta = {
      id: localSessionId,
      title: sessionTitleInput.value.trim() || defaultTitle(),
      sessionType: sessionTypeSelect.value,
      professional: professionalSelect.value,
      sourceType: 'upload',
      status: 'transcribing',
      startedAt: new Date().toISOString(),
      elapsedSeconds: 0,
      rawSegments: [],
      cleanedTranscript: '',
      mimeType: uploadedFile.type || 'audio/mpeg'
    };
    await idbPutSession(sessionMeta);

    setStage(3);
    showProcessing('Transcribing your file…', 'This can take a moment for longer recordings.', 10);

    try {
      const text = await transcribeBlob(uploadedFile);
      recordQuotaUsage(text, 1);
      rawSegments = [text || ''];
      sessionMeta.rawSegments = rawSegments;
      await idbPutSession(sessionMeta);
      await finalizeSession();
    } catch (err) {
      if (err.name === 'AbortError') return; // cancelled — resetToSetup() already ran
      console.error(err);
      showToast('Transcription failed: ' + err.message, 'error', 5000);
      setStage(1);
    }
  });

  startSetupBtn.addEventListener('click', startNewRecording);

  // Cancel: stop everything and throw this recording away (nothing is
  // transcribed or saved). Asks first — it can't be undone.
  const cancelRecordingBtn = $('cancelRecordingBtn');
  if (cancelRecordingBtn) cancelRecordingBtn.addEventListener('click', async () => {
    if (!mediaRecorder) return;
    if (!confirm('Cancel this recording? Nothing will be transcribed or saved.')) return;
    const stopper = activeSessionStopper;
    activeSessionStopper = null;
    try { if (stopper) stopper(); } catch (e) {}
    mediaRecorder = null;
    isPaused = false;
    const id = localSessionId;
    resetToSetup();
    if (id) {
      await idbDeleteChunksForSession(id).catch(() => {});
      await idbDeleteSegmentsForSession(id).catch(() => {});
      await idbDeleteSession(id).catch(() => {});
    }
    showToast('Recording cancelled', 'info');
  });

  async function startNewRecording(resume) {
    if (!currentUser) { showToast('Please log in first', 'error'); return; }
    if (scopeUid === null) { showToast('Your access to Audio Transcription has been turned off by your center admin.', 'error', 6000); return; }

    if (!window.isSecureContext) {
      showToast('Microphone access needs a secure connection (https://). This page must be opened via your website URL, not a local file.', 'error', 7000);
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showToast('This browser doesn\'t support microphone recording. Please try an up-to-date Chrome, Safari, or Firefox.', 'error', 6000);
      return;
    }
    // AUDIO FIX (mobile): some mobile browsers/webviews expose getUserMedia
    // but not MediaRecorder at all — calling .isTypeSupported on it further
    // below used to throw an unhandled, uncaught ReferenceError that killed
    // recording AND the Whisper fallback with zero user-facing signal.
    if (!window.MediaRecorder) {
      showToast('This browser can\'t record audio (no MediaRecorder support). Please try an up-to-date Chrome or Safari.', 'error', 7000);
      return;
    }
    // Coach mode records the patient/caregiver and sends de-identified turns
    // to AI for question suggestions — explicit consent is required first.
    if (!resume && audioMode === 'coach' && !(coachConsentInput && coachConsentInput.checked)) {
      showToast('Coach mode needs consent: confirm the patient/caregiver agreed to recording and AI assistance.', 'error', 6000);
      if (coachConsentInput) coachConsentInput.focus();
      return;
    }
    try { await checkQuotaOrThrow(); } catch (err) { showToast(err.message, 'error', 6000); return; }

    if (!resume) {
      localSessionId = newSessionId();
      chunkIndex = 0;
      rawSegments = [];
      resetLiveState();
    }
    isPaused = false;
    interimEl = null;

    try {
      // AUDIO UPGRADE: browser-native noise suppression/echo cancellation/
      // auto gain — the bare `{ audio: true }` this used to send left all
      // three off. `deviceId` honors whatever mic the clinician picked in
      // the setup panel (js/audio.js's populateMicDevices()).
      const audioConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
      if (selectedDeviceId) audioConstraints.deviceId = { exact: selectedDeviceId };
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      } catch (deviceErr) {
        // The previously-picked mic may have been unplugged/disconnected —
        // fall back to the system default rather than failing outright.
        if (deviceErr.name === 'OverconstrainedError' && selectedDeviceId) {
          selectedDeviceId = '';
          localStorage.removeItem('rehablix_audio_input_device');
          if (micDeviceSelect) micDeviceSelect.value = '';
          showToast('Your selected microphone is no longer available — using the default instead.', 'info', 5000);
          delete audioConstraints.deviceId;
          mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
        } else {
          throw deviceErr;
        }
      }
      populateMicDevices(); // now that permission is granted, real device labels are available
    } catch (err) {
      console.error('getUserMedia failed:', err.name, err.message);
      const messages = {
        NotAllowedError: 'Microphone permission was denied for this site. Check your browser\'s site settings (not just the app-level OS permission) and allow microphone access for rehablix, then reload.',
        PermissionDeniedError: 'Microphone permission was denied for this site. Check your browser\'s site settings and allow microphone access for rehablix, then reload.',
        NotFoundError: 'No microphone was found on this device.',
        NotReadableError: 'Your microphone is being used by another app. Close other apps using it and try again.',
        OverconstrainedError: 'No microphone matches the requested settings.',
        SecurityError: 'Microphone access was blocked for security reasons on this page.'
      };
      showToast(messages[err.name] || `Couldn't access the microphone (${err.name || 'unknown error'}). Please check your browser's site permissions.`, 'error', 7000);
      return;
    }

    recordedMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
      : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
      : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4'
      : '';

    sessionMeta = {
      id: localSessionId,
      title: sessionTitleInput.value.trim() || defaultTitle(),
      sessionType: sessionTypeSelect.value,
      professional: professionalSelect.value,
      sourceType: 'live',
      status: 'recording',
      startedAt: new Date().toISOString(),
      elapsedSeconds: 0,
      rawSegments: [],
      cleanedTranscript: '',
      mimeType: recordedMimeType || 'audio/webm',
      mode: audioMode,
      consent: audioMode === 'coach' ? { recordingAndAI: true, at: new Date().toISOString() } : null,
      turns: [],
      suggestions: []
    };
    await idbPutSession(sessionMeta);

    beginRecorder();
  }

  function beginRecorder() {
    mediaRecorder = recordedMimeType
      ? new MediaRecorder(mediaStream, { mimeType: recordedMimeType })
      : new MediaRecorder(mediaStream);

    mediaRecorder.ondataavailable = async (e) => {
      if (!e.data || e.data.size === 0) return;
      const idx = chunkIndex++;
      await idbPutChunk(localSessionId, idx, e.data);
    };

    mediaRecorder.onstop = () => {
      if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
      releaseWakeLock();
      // AUDIO FIX: the final ondataavailable chunk fires before this event
      // per spec — resolving here (instead of a blind setTimeout after
      // .stop()) means whoever's waiting is guaranteed the last chunk is
      // already in IndexedDB before they read chunks back out.
      if (recorderStoppedResolve) { recorderStoppedResolve(); recorderStoppedResolve = null; }
    };

    mediaRecorder.start(CHUNK_INTERVAL_MS);
    requestWakeLock();
    setupWaveform();
    startTimer();
    // Live transcription runs off the same stream (and the same analyser the
    // waveform uses for silence detection).
    startLiveTranscription();

    recIndicator.classList.remove('paused');
    recStatusText.textContent = 'Recording';
    pauseResumeBtn.innerHTML = '<i class="fas fa-pause"></i>';
    pauseResumeBtn.setAttribute('aria-label', 'Pause recording');
    liveTranscriptText.innerHTML = '<span class="transcript-placeholder">Your words will appear here a few seconds after you speak…</span>';
    renderCoachPanel();

    setStage(2);
    showToast('Recording started — you can switch tabs, it keeps going.', 'info', 3500);

    // Registered so unmount() (navigating to another view mid-recording)
    // stops the mic/recorder instead of leaving it running in the background.
    activeSessionStopper = () => {
      try { stopTimer(); stopLiveMonitor(); stopWaveform(); releaseWakeLock(); } catch (e) {}
      try { if (segRecorder && segRecorder.state !== 'inactive') segRecorder.stop(); } catch (e) {}
      try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
      try { if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop(); } catch (e) {}
      try { if (mediaStream) mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
    };
  }

  pauseResumeBtn.addEventListener('click', async () => {
    if (!mediaRecorder) return;
    if (isPaused) {
      isPaused = false;
      recIndicator.classList.remove('paused');
      recStatusText.textContent = 'Recording';
      pauseResumeBtn.innerHTML = '<i class="fas fa-pause"></i>';
      pauseResumeBtn.setAttribute('aria-label', 'Pause recording');
      if (pauseStartedAt) {
        sessionMeta.pausedAccumMs = (sessionMeta.pausedAccumMs || 0) + (Date.now() - pauseStartedAt);
        pauseStartedAt = null;
      }
      startTimer();
      requestWakeLock();
      if (mediaRecorder.state === 'paused') mediaRecorder.resume();
      sessionMeta.status = 'recording';
      idbPutSession(sessionMeta);
      startLiveTranscription();
    } else {
      isPaused = true;
      pauseStartedAt = Date.now();
      recIndicator.classList.add('paused');
      recStatusText.textContent = 'Paused';
      pauseResumeBtn.innerHTML = '<i class="fas fa-play"></i>';
      pauseResumeBtn.setAttribute('aria-label', 'Resume recording');
      stopTimer();
      sessionMeta.status = 'paused';
      idbPutSession(sessionMeta);
      releaseWakeLock();
      if (mediaRecorder.state === 'recording') mediaRecorder.pause();
      // Flush what was said before the pause as its own clip (no new clip
      // starts until Resume), so nothing is lost or merged across the pause.
      stopLiveTranscription();
    }
  });

  stopRecordingBtn.addEventListener('click', async () => {
    if (!mediaRecorder) return;
    activeSessionStopper = null;
    stopTimer();
    // Flush the final clip BEFORE the analyser/stream go away.
    const finalClip = stopLiveTranscription();
    stopWaveform();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    sessionMeta.status = 'transcribing';
    await idbPutSession(sessionMeta);

    // AUDIO FIX: wait for the recorder's actual onstop event (which itself
    // only fires after the final ondataavailable chunk is flushed) instead
    // of guessing with a fixed setTimeout — a slow device or a large last
    // chunk used to be able to get silently dropped.
    const stopped = mediaRecorder.state === 'inactive'
      ? Promise.resolve()
      : new Promise((resolve) => { recorderStoppedResolve = resolve; mediaRecorder.stop(); });

    showProcessing('Finishing up transcription…', 'Transcribing the last few seconds.', 40);
    setStage(3);
    await Promise.all([stopped, finalClip]);
    // Every live clip must be done (or definitively failed) before the
    // transcript is assembled — in order.
    await drainLiveQueue((done, total) => updateProcessingProgress(40 + Math.round((done / Math.max(1, total)) * 25), `Transcribing segment ${done} of ${total}…`));
    await settleSpeakers();
    rebuildRawFromSegments();

    const failed = liveSegments.filter(s => s && s.status === 'failed').length;
    let hasText = rawSegments.some(s => s && s.trim());
    // Some clips never made it (network/quota): transcribe the full recording
    // instead so the final transcript is complete. Coach mode keeps its
    // labelled turns and only falls back when nothing was transcribed at all.
    if (failed && audioMode !== 'coach') hasText = false;

    if (!hasText) {
      try {
        updateProcessingProgress(55, 'Transcribing the recording…');
        const chunks = await idbGetChunksForSession(localSessionId);
        if (chunks.length) {
          await checkQuotaOrThrow();
          const text = await transcribeSavedChunks(chunks);
          recordQuotaUsage(text, 1);
          if (text) { rawSegments = [text]; sessionMeta.turns = []; appendLiveTranscript(text); }
        }
      } catch (err) {
        if (err.name === 'AbortError') { return; } // cancelled — resetToSetup() already ran
        console.error('Fallback transcription failed:', err);
        showToast(err.message || 'Transcription failed', 'error', 5000);
      }
    }

    sessionMeta.rawSegments = rawSegments;
    await idbPutSession(sessionMeta);
    await finalizeSession();
  });

  cancelProcessingBtn?.addEventListener('click', () => {
    if (transcriptionAbortController) transcriptionAbortController.abort();
    showToast('Cancelled', 'info');
    resetToSetup();
  });

  function startTimer() {
    stopTimer();
    const baseStartedAt = new Date(sessionMeta.startedAt).getTime();
    timerInterval = setInterval(() => {
      const pausedMs = sessionMeta.pausedAccumMs || 0;
      const elapsedMs = Date.now() - baseStartedAt - pausedMs;
      const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
      sessionMeta.elapsedSeconds = totalSeconds;
      recTimer.textContent = formatTime(totalSeconds);
    }, 500);
  }
  function stopTimer() { if (timerInterval) { clearInterval(timerInterval); timerInterval = null; } }

  function formatTime(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  // AUDIO UPGRADE: microphone device picker. Browsers can't "pair" a
  // Bluetooth/USB mic from a web page — that's an OS-level step — but once
  // paired, enumerateDevices() lists it, so the clinician can select it here
  // and it's used as this session's `deviceId` constraint. Device labels are
  // blank until mic permission has been granted at least once; this is
  // re-run right after a successful getUserMedia so the list fills in.
  async function populateMicDevices() {
    if (!micDeviceSelect || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter(d => d.kind === 'audioinput');
      const options = ['<option value="">Default microphone</option>']
        .concat(inputs.map((d, i) => `<option value="${escapeHtml(d.deviceId)}">${escapeHtml(d.label || `Microphone ${i + 1}`)}</option>`));
      micDeviceSelect.innerHTML = options.join('');
      // Keep the saved choice selected only if that device is still present.
      if (selectedDeviceId && inputs.some(d => d.deviceId === selectedDeviceId)) {
        micDeviceSelect.value = selectedDeviceId;
      } else if (selectedDeviceId) {
        selectedDeviceId = '';
        localStorage.removeItem('rehablix_audio_input_device');
      }
    } catch (err) {
      console.warn('Could not list microphones:', err);
    }
  }
  if (micDeviceSelect) {
    micDeviceSelect.addEventListener('change', () => {
      selectedDeviceId = micDeviceSelect.value;
      if (selectedDeviceId) localStorage.setItem('rehablix_audio_input_device', selectedDeviceId);
      else localStorage.removeItem('rehablix_audio_input_device');
    });
  }
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    const onDeviceChange = () => populateMicDevices();
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    cleanupFns.push(() => navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange));
  }
  populateMicDevices();

  function setupWaveform() {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(mediaStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      drawWaveform();
    } catch (err) {
      console.warn('Waveform visualizer unavailable:', err);
    }
  }

  function drawWaveform() {
    if (!analyser || document.hidden) { waveformRAF = requestAnimationFrame(drawWaveform); return; }
    const ctx = waveformCanvas.getContext('2d');
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const w = waveformCanvas.width = waveformCanvas.clientWidth;
    const h = waveformCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const barWidth = (w / bufferLength) * 2.5;
    let x = 0;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--audio-accent').trim() || '#7c3aed';
    ctx.fillStyle = accent;
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * h;
      ctx.fillRect(x, h - barHeight, barWidth, barHeight);
      x += barWidth + 1;
    }
    waveformRAF = requestAnimationFrame(drawWaveform);
  }

  function stopWaveform() {
    if (waveformRAF) cancelAnimationFrame(waveformRAF);
    waveformRAF = null;
    if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
    analyser = null;
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLockSentinel = await navigator.wakeLock.request('screen');
    } catch (err) {
      console.warn('Wake lock unavailable:', err);
    }
  }
  function releaseWakeLock() {
    if (wakeLockSentinel) { wakeLockSentinel.release().catch(() => {}); wakeLockSentinel = null; }
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible' && mediaRecorder && mediaRecorder.state === 'recording') requestWakeLock();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  cleanupFns.push(() => document.removeEventListener('visibilitychange', onVisibilityChange));

  // =========================================================================
  // LIVE TRANSCRIPTION — chunked Whisper over the recording's own stream.
  //
  // Replaces the browser Web Speech API, which on mobile opened a second mic
  // capture (starving the recorder), played start/stop beeps and looped
  // through restarts. A second MediaRecorder on the SAME MediaStream cuts
  // self-contained clips (~6s, at a quiet moment when possible); each clip is
  // persisted to IndexedDB, transcribed with retries, and rendered strictly
  // in recording order. Quota: each clip's text is charged exactly like the
  // old whole-file transcription (weight 1).
  // =========================================================================
  function resetLiveState() {
    liveSegments = []; segRecorder = null; segParts = []; segPeak = 0; quietSince = null;
    liveQueue = []; liveInFlight = 0; liveQuotaBlocked = false;
    if (liveAbort) { try { liveAbort.abort(); } catch (e) {} }
    liveAbort = new AbortController();
    coachSuggestions = []; lastSuggestAt = 0; clearTimeout(suggestTimer); suggestInFlight = false;
    lastCoachAt = 0; coachFailures = 0; coachDirty = false;
  }

  function currentRms() {
    if (!analyser) return null;
    const buf = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length);
  }

  function startSegment() {
    if (!mediaStream || isPaused) return;
    const opts = recordedMimeType ? { mimeType: recordedMimeType } : undefined;
    let rec;
    try { rec = opts ? new MediaRecorder(mediaStream, opts) : new MediaRecorder(mediaStream); } catch (e) { console.warn('[audio] segment recorder unavailable', e); return; }
    const parts = [];
    const index = liveSegments.length;
    liveSegments[index] = { status: 'recording', text: '', speaker: 'therapist', parts: null, tries: 0 };
    let peak = 0;
    rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(parts, { type: recordedMimeType || 'audio/webm' });
      onSegmentComplete(index, blob, peak);
      if (rec._resolve) rec._resolve();
    };
    rec._trackPeak = (v) => { if (v > peak) peak = v; };
    rec.start();
    segRecorder = rec;
    segStartedAt = Date.now();
    quietSince = null;
  }

  // Stops the current clip; resolves once its data has been handed off.
  function stopSegment() {
    const rec = segRecorder;
    segRecorder = null;
    if (!rec || rec.state === 'inactive') return Promise.resolve();
    return new Promise((resolve) => { rec._resolve = resolve; try { rec.stop(); } catch (e) { resolve(); } });
  }

  // Start the next clip first, then stop the previous one — no gap between clips.
  function rotateSegment() {
    const prev = segRecorder;
    segRecorder = null;
    startSegment();
    if (prev && prev.state !== 'inactive') { try { prev.stop(); } catch (e) {} }
  }

  function startLiveMonitor() {
    stopLiveMonitor();
    liveMonitorTimer = setInterval(() => {
      if (!segRecorder || isPaused) return;
      const now = Date.now();
      const age = now - segStartedAt;
      const rms = currentRms();
      if (rms != null && segRecorder._trackPeak) segRecorder._trackPeak(rms);
      if (rms != null && rms < SILENCE_RMS) { if (!quietSince) quietSince = now; } else quietSince = null;
      const quietLongEnough = quietSince && (now - quietSince >= SILENCE_HOLD_MS);
      // Silence-aware boundary: cut at the first quiet moment after ~6s; if the
      // speaker never pauses, cut anyway at the hard cap. Without an analyser,
      // fall back to fixed ~6s clips.
      if (age >= LIVE_MAX_MS || (age >= LIVE_TARGET_MS && (rms == null || quietLongEnough))) {
        if (age >= LIVE_MIN_MS) rotateSegment();
      }
    }, 100);
  }
  function stopLiveMonitor() { if (liveMonitorTimer) { clearInterval(liveMonitorTimer); liveMonitorTimer = null; } }

  function startLiveTranscription() {
    if (!liveAbort) liveAbort = new AbortController();
    startSegment();
    startLiveMonitor();
  }

  // Pause/Stop: flush the in-progress clip (no new clip until Resume).
  function stopLiveTranscription() {
    stopLiveMonitor();
    setInterimTranscript('');
    return stopSegment();
  }

  async function onSegmentComplete(index, blob, peak) {
    const seg = liveSegments[index];
    if (!seg) return;
    // Near-silent or tiny clips are skipped: Whisper tends to hallucinate
    // ("Thank you.") on silence, and they cost quota for nothing.
    if (blob.size < 1200 || (peak > 0 && peak < SILENCE_RMS * 1.4)) {
      seg.status = 'silent';
      renderLiveTranscript();
      return;
    }
    seg.status = 'pending';
    seg.blob = blob;
    renderLiveTranscript();
    // Queue immediately (so Stop's drain can never miss the last clip); the
    // IndexedDB copy is written in the background and awaited before the
    // 'done' record overwrites it.
    seg.persisted = localSessionId
      ? idbPutSegment(localSessionId, index, { blob, status: 'pending', text: '', speaker: seg.speaker }).catch(e => console.warn('[audio] could not persist clip', e))
      : Promise.resolve();
    liveQueue.push(index);
    pumpLiveQueue();
  }

  function pumpLiveQueue() {
    while (liveInFlight < LIVE_CONCURRENCY && liveQueue.length) {
      const index = liveQueue.shift();
      liveInFlight++;
      transcribeSegment(index).finally(() => { liveInFlight--; pumpLiveQueue(); });
    }
  }

  const HALLUCINATIONS = /^(thank you\.?|thanks for watching!?|you|bye\.?|\.+)$/i;

  async function transcribeSegment(index) {
    const seg = liveSegments[index];
    if (!seg || !seg.blob) return;
    if (liveQuotaBlocked) { seg.status = 'failed'; renderLiveTranscript(); return; }
    // Previous text as a Whisper prompt keeps names/terms consistent across clips.
    const prev = liveSegments.slice(0, index).filter(s => s && s.status === 'done' && s.text).map(s => s.text).join(' ').slice(-200);
    while (seg.tries < LIVE_MAX_RETRIES) {
      seg.tries++;
      try {
        if (window.RehabPlanTiers && currentUser) {
          const q = await window.RehabPlanTiers.hasQuota(currentUser.uid, currentPlan);
          if (!q.allowed) {
            liveQuotaBlocked = true;
            showToast('Token budget reached — live transcription paused. Your recording continues and is kept on this device.', 'error', 7000);
            seg.status = 'failed'; renderLiveTranscript(); return;
          }
        }
        let text = await transcribeBlob(seg.blob, { prompt: prev, signal: liveAbort ? liveAbort.signal : undefined });
        text = (text || '').trim();
        if (HALLUCINATIONS.test(text)) text = '';
        seg.text = text;
        seg.status = 'done';
        if (text) recordQuotaUsage(text, 1);
        if (seg.persisted) await seg.persisted;
        persistSegment(index);
        rebuildRawFromSegments();
        renderLiveTranscript();
        if (audioMode === 'coach' && text) scheduleSuggestions();
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') { seg.status = 'failed'; return; }
        console.warn('[audio] clip ' + index + ' attempt ' + seg.tries + ' failed:', err);
        if (seg.tries < LIVE_MAX_RETRIES) await new Promise(r => setTimeout(r, 1500 * seg.tries));
      }
    }
    seg.status = 'failed';
    renderLiveTranscript();
  }

  // Waits for every queued/in-flight clip, retrying failed ones once more.
  async function drainLiveQueue(onProgress) {
    const total = () => liveSegments.filter(s => s && s.status !== 'silent').length;
    const settled = () => liveSegments.filter(s => s && (s.status === 'done' || s.status === 'failed')).length;
    const deadline = Date.now() + 120000;
    const busy = () => liveQueue.length || liveInFlight || liveSegments.some(s => s && (s.status === 'pending' || s.status === 'recording'));
    while (busy() && Date.now() < deadline) {
      if (onProgress) onProgress(settled(), total());
      await new Promise(r => setTimeout(r, 300));
    }
    const failed = liveSegments.map((s, i) => (s && s.status === 'failed' && s.blob ? i : -1)).filter(i => i >= 0);
    if (failed.length && !liveQuotaBlocked) {
      failed.forEach(i => { liveSegments[i].tries = LIVE_MAX_RETRIES - 1; liveSegments[i].status = 'pending'; liveQueue.push(i); });
      pumpLiveQueue();
      while (busy() && Date.now() < deadline) await new Promise(r => setTimeout(r, 300));
    }
    if (onProgress) onProgress(settled(), total());
  }

  function speakerLabel(s) { return s === 'patient' ? 'Patient/Caregiver' : s === 'therapist' ? 'Therapist' : 'Speaker'; }

  function persistSegment(i) {
    const s = liveSegments[i];
    if (!localSessionId || !s || !s.blob) return;
    idbPutSegment(localSessionId, i, { blob: s.blob, status: s.status, text: s.text, speaker: s.speaker, parts: s.parts || null }).catch(() => {});
  }

  // Sentence-level pieces of a clip. A clip often holds a question AND its
  // answer, so speakers are assigned per sentence, not per clip.
  function splitSentences(text) {
    const ABBREV = /\b(Dr|Mr|Mrs|Ms|Prof|St|vs|No|e\.g|i\.e)\.$/i;   // not a sentence end
    return String(text || '').replace(/([.!?…]["')\]]?)\s+/g, '$1\u0001').split('\u0001').map(t => t.trim()).filter(Boolean)
      .reduce((out, t) => { if (out.length && ABBREV.test(out[out.length - 1])) out[out.length - 1] += ' ' + t; else out.push(t); return out; }, []);
  }

  // Every transcribed sentence in recording order: { seg, part, p: { text, speaker } }.
  // speaker is null until Coach has worked out who said it.
  function coachUnits() {
    const out = [];
    liveSegments.forEach((s, i) => {
      if (!s || s.status !== 'done' || !s.text) return;
      if (!s.parts) s.parts = splitSentences(s.text).map(t => ({ text: t, speaker: null }));
      s.parts.forEach((p, k) => out.push({ seg: i, part: k, p }));
    });
    return out;
  }

  function coachTurns() {
    const turns = [];
    coachUnits().forEach(u => {
      const last = turns[turns.length - 1];
      if (last && last.speaker === u.p.speaker) last.text += ' ' + u.p.text;
      else turns.push({ speaker: u.p.speaker, text: u.p.text });
    });
    return turns;
  }

  // Ordered transcript from the clips: plain text in Transcribe mode,
  // "Therapist:/Patient/Caregiver:" labelled turns in Coach mode.
  function rebuildRawFromSegments() {
    if (audioMode === 'coach') {
      const turns = coachTurns();
      if (sessionMeta) sessionMeta.turns = turns;
      rawSegments = turns.map(t => speakerLabel(t.speaker) + ': ' + t.text);
    } else {
      rawSegments = liveSegments.filter(s => s && s.status === 'done' && s.text).map(s => s.text);
    }
    if (sessionMeta) { sessionMeta.rawSegments = rawSegments; idbPutSession(sessionMeta).catch(() => {}); }
  }

  function renderLiveTranscript() {
    if (!liveTranscriptText) return;
    const html = [];
    const coach = audioMode === 'coach';
    let lastSpeaker;
    liveSegments.forEach((s, i) => {
      if (!s || s.status === 'silent') return;
      if (s.status === 'done' && !s.text) return;
      if (s.status === 'done' && coach) {
        if (!s.parts) s.parts = splitSentences(s.text).map(t => ({ text: t, speaker: null }));
        s.parts.forEach((p, k) => {
          if (p.speaker !== lastSpeaker) {
            html.push(p.speaker
              ? '<button type="button" class="speaker-chip speaker-' + p.speaker + '" data-seg="' + i + '" data-part="' + k + '" aria-label="Speaker: ' + speakerLabel(p.speaker) + '. Tap to correct">' + speakerLabel(p.speaker) + '</button>'
              : '<span class="speaker-chip speaker-pending" aria-label="Identifying the speaker">Identifying speaker…</span>');
            lastSpeaker = p.speaker;
          }
          html.push('<span class="transcript-segment" data-seg="' + i + '">' + escapeHtml(p.text) + ' </span>');
        });
      }
      else if (s.status === 'done') html.push('<span class="transcript-segment" data-seg="' + i + '">' + escapeHtml(s.text) + ' </span>');
      else if (s.status === 'failed') html.push('<span class="transcript-pending failed" data-seg="' + i + '">[segment will be transcribed at the end] </span>');
      else if (s.status === 'pending') html.push('<span class="transcript-pending" data-seg="' + i + '">… </span>');
    });
    liveTranscriptText.innerHTML = html.length ? html.join('') : '<span class="transcript-placeholder">Your words will appear here a few seconds after you speak…</span>';
    interimEl = null;
    liveTranscriptText.scrollTop = liveTranscriptText.scrollHeight;
  }

  // Coach labels speakers on its own; a chip can still be tapped to correct
  // a turn it got wrong (flips that turn only).
  liveTranscriptText.addEventListener('click', (e) => {
    const chip = e.target.closest('button.speaker-chip');
    if (!chip) return;
    const seg = parseInt(chip.dataset.seg, 10), part = parseInt(chip.dataset.part, 10);
    const units = coachUnits();
    let k = units.findIndex(u => u.seg === seg && u.part === part);
    if (k < 0) return;
    const from = units[k].p.speaker;
    const to = from === 'patient' ? 'therapist' : 'patient';
    const touched = new Set();
    for (; k < units.length && units[k].p.speaker === from; k++) { units[k].p.speaker = to; touched.add(units[k].seg); }
    touched.forEach(i => { liveSegments[i].speaker = liveSegments[i].parts[0].speaker || 'therapist'; persistSegment(i); });
    rebuildRawFromSegments();
    renderLiveTranscript();
  });

  // =========================================================================
  // COACH MODE — automatic speaker labels + one suggested next question
  // =========================================================================
  // Nobody switches "who is speaking" by hand. Each newly transcribed sentence
  // is attributed to the therapist or the patient/caregiver from what was said
  // and the turn-taking, in the same (quota-counted) AI call that proposes the
  // next question.
  let lastCoachAt = 0, coachFailures = 0, coachDirty = false;
  const COACH_MIN_GAP_MS = 6000;      // batch clips: at most one call per 6 s
  const COACH_QUESTION_GAP_MS = 15000;

  function renderCoachPanel() {
    if (!coachLivePanel) return;
    const coach = audioMode === 'coach';
    coachLivePanel.style.display = coach ? 'block' : 'none';
    if (!coach) return;
    const open = coachSuggestions.filter(s => !s.askedAt).slice(-1);
    coachSuggestionsList.innerHTML = open.length
      ? open.map(s => '<div class="coach-suggestion"><span>' + escapeHtml(s.text) + '</span><button type="button" class="btn-mini coach-asked-btn" data-id="' + s.id + '" aria-label="Mark as asked">Asked</button></div>').join('')
      : '<p class="coach-empty">' + (suggestInFlight ? 'Listening…' : 'A suggested question appears after the patient or caregiver speaks.') + '</p>';
    coachSpeakToggle.disabled = !headphonesDetected;
    coachSpeakHint.textContent = headphonesDetected ? '' : 'Connect headphones or earphones to hear the suggestion.';
    if (!headphonesDetected) { coachSpeakToggle.checked = false; speakSuggestions = false; }
  }

  function scheduleSuggestions(delay) {
    clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => runCoach(false), delay == null ? 1200 : delay);
  }

  // De-identified: the linked patient's name and any names/DOB/phone numbers
  // in the transcript are stripped locally before anything is sent.
  function deidentify(text) {
    const D = window.RehablixDeidentify;
    const ids = [];
    if (audioPatientName && audioPatientName.value.trim()) ids.push(...audioPatientName.value.trim().split(/\s+/), audioPatientName.value.trim());
    if (matchedEmrPatient && matchedEmrPatient.regNumber) ids.push(matchedEmrPatient.regNumber);
    return D ? D.scrubText(text, ids) : text;
  }

  // Offline / quota / AI-failure fallback: questions are the therapist's,
  // the line right after a therapist question is the patient's, otherwise
  // the speaker carries on.
  function guessSpeakers(units) {
    units.forEach((u, k) => {
      if (u.p.speaker) return;
      const prev = k > 0 ? units[k - 1].p : null;
      if (/\?\s*["')\]]?$/.test(u.p.text)) u.p.speaker = 'therapist';
      else if (prev && prev.speaker === 'therapist' && /\?\s*["')\]]?$/.test(prev.text)) u.p.speaker = 'patient';
      else u.p.speaker = (prev && prev.speaker) || 'therapist';
    });
  }

  function commitSpeakers(units) {
    const touched = new Set(units.map(u => u.seg));
    touched.forEach(i => { const s = liveSegments[i]; s.speaker = (s.parts[0] && s.parts[0].speaker) || 'therapist'; persistSegment(i); });
    rebuildRawFromSegments();
    renderLiveTranscript();
  }

  async function runCoach(final) {
    if (audioMode !== 'coach' || !sessionMeta) return;
    if (suggestInFlight) { coachDirty = true; return; }
    const units = coachUnits();
    const fresh = units.filter(u => !u.p.speaker);
    if (!fresh.length) return;
    const core = window.RehablixAIQuotaCore;
    if (!core) { guessSpeakers(units); commitSpeakers(fresh); return; }
    const wait = COACH_MIN_GAP_MS - (Date.now() - lastCoachAt);
    if (!final && wait > 0) { scheduleSuggestions(wait); return; }
    const wantQuestion = !final && !isPaused && Date.now() - lastSuggestAt >= COACH_QUESTION_GAP_MS;
    suggestInFlight = true; lastCoachAt = Date.now(); renderCoachPanel();
    try {
      const config = await core.resolveModelConfig('basal100');
      if (!config) throw new Error('AI not configured');
      await core.checkQuotaOrThrow(currentUser && currentUser.uid, currentPlan);
      const professional = PROFESSIONAL_LABELS[sessionMeta.professional] || 'clinician';
      const system = 'You label a live clinical conversation between a ' + professional + ' (T) and a patient or caregiver (P) during a ' + (sessionMeta.sessionType || 'therapy') + ' session. It was transcribed in short pieces with no speaker information. Decide who said each NEW line from its content and the turn-taking: the ' + professional + ' asks questions, gives instructions, explains and examines; the patient or caregiver answers and describes symptoms, history, daily life and concerns. Neighbouring lines often share a speaker.' +
        (wantQuestion ? ' Then, only if the last NEW line was said by the patient or caregiver, write ONE short, open, respectful follow-up question the ' + professional + ' could ask next (within scope; no diagnosis, no treatment advice, nothing already asked). Otherwise leave it empty.' : '') +
        ' Return ONLY JSON: {"labels":["T","P"]' + (wantQuestion ? ',"question":""' : '') + '} with exactly one label per NEW line, in order.';
      const known = units.filter(u => u.p.speaker).slice(-12).map(u => (u.p.speaker === 'patient' ? 'P: ' : 'T: ') + deidentify(u.p.text)).join('\n');
      const asked = coachSuggestions.filter(s => s.askedAt).slice(-6).map(s => '- ' + s.text).join('\n');
      const user = (known ? 'Earlier lines (already labelled):\n' + known + '\n\n' : '') +
        'NEW lines:\n' + fresh.map((u, k) => (k + 1) + '. ' + deidentify(u.p.text)).join('\n') +
        (wantQuestion && asked ? '\n\nAlready asked:\n' + asked : '');
      const res = await fetch(config.endpoint + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.token },
        body: JSON.stringify({ model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 80 + fresh.length * 6 + (wantQuestion ? 90 : 0), temperature: 0.2 }),
        signal: (!final && liveAbort) ? liveAbort.signal : undefined
      });
      if (!res.ok) throw new Error('Coach request failed');
      const data = await res.json();
      const content = (data.choices && data.choices[0] && data.choices[0].message.content) || '';
      core.reportTokenUsage(currentUser && currentUser.uid, currentPlan, system + user + content, config.weight);
      const m = content.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : content);
      const labels = Array.isArray(parsed.labels) ? parsed.labels : [];
      if (!labels.length) throw new Error('No labels returned');
      fresh.forEach((u, k) => {
        const l = String(labels[k] == null ? '' : labels[k]).trim().toUpperCase();
        if (l.startsWith('P')) u.p.speaker = 'patient'; else if (l.startsWith('T')) u.p.speaker = 'therapist';
      });
      if (labels.length < fresh.length) guessSpeakers(units);   // a short answer: finish the tail locally
      coachFailures = 0;
      commitSpeakers(fresh);
      const q = String(parsed.question || '').trim();
      const lastUnit = units[units.length - 1];
      if (wantQuestion && q && q.length < 240 && lastUnit && lastUnit.p.speaker === 'patient') {
        lastSuggestAt = Date.now();
        coachSuggestions.push({ id: 's' + Date.now() + Math.random().toString(36).slice(2, 6), text: q, askedAt: null, afterIndex: liveSegments.length - 1 });
        saveSuggestionState();
        if (speakSuggestions && headphonesDetected) speak(q);
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.warn('[audio] coach labelling failed:', err);
      coachFailures++;
      // Never leave the transcript unlabelled: after a second failure (or at
      // the end of the session) fall back to the local turn-taking rules.
      if (final || coachFailures >= 2) { guessSpeakers(units); commitSpeakers(fresh); }
      else coachDirty = true;
    } finally {
      suggestInFlight = false;
      renderCoachPanel();
      if (coachDirty && !final) { coachDirty = false; scheduleSuggestions(coachFailures ? 4000 : 1200); }
    }
  }

  // End of session: every sentence gets a speaker before the transcript is built.
  async function settleSpeakers() {
    if (audioMode !== 'coach') return;
    clearTimeout(suggestTimer);
    const deadline = Date.now() + 20000;
    while (suggestInFlight && Date.now() < deadline) await new Promise(r => setTimeout(r, 200));
    if (!suggestInFlight) await runCoach(true);
    const units = coachUnits();
    const left = units.filter(u => !u.p.speaker);
    if (left.length) { guessSpeakers(units); commitSpeakers(left); }
  }

  function speak(text) {
    if (!window.speechSynthesis || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    const lang = (navigator.language || 'en').toLowerCase();
    const voices = window.speechSynthesis.getVoices().filter(v => v.lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
    // Prefer the natural-sounding neural/online voices where the browser offers them.
    u.voice = voices.find(v => /natural|neural|online|premium|enhanced|google/i.test(v.name)) || voices[0] || null;
    u.rate = 1; u.pitch = 1; u.volume = 0.9;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  // Spoken suggestions only through headphones — never out of the speaker,
  // where the patient would hear them and the mic would re-record them.
  async function detectHeadphones() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      headphonesDetected = devices.some(d => (d.kind === 'audiooutput' || d.kind === 'audioinput') &&
        /head(phone|set)|ear(phone|bud|piece)|airpods|buds|bluetooth|wired/i.test(d.label || '') && !/default - speaker/i.test(d.label || ''));
    } catch (e) { headphonesDetected = false; }
    renderCoachPanel();
  }

  function saveSuggestionState() {
    if (!sessionMeta) return;
    sessionMeta.suggestions = coachSuggestions.map(s => ({ text: s.text, askedAt: s.askedAt, afterIndex: s.afterIndex }));
    idbPutSession(sessionMeta).catch(() => {});
  }

  function setInterimTranscript(text) {
    const placeholder = liveTranscriptText.querySelector('.transcript-placeholder');
    if (text && placeholder) placeholder.remove();
    if (!interimEl || !interimEl.isConnected) {
      interimEl = document.createElement('span');
      interimEl.className = 'transcript-interim';
      liveTranscriptText.appendChild(interimEl);
    }
    const needsSpace = liveTranscriptText.textContent && !liveTranscriptText.textContent.endsWith(' ') && text;
    interimEl.textContent = text ? (needsSpace ? ' ' : '') + text : '';
    liveTranscriptText.scrollTop = liveTranscriptText.scrollHeight;
  }

  function appendLiveTranscript(text) {
    if (!text) return;
    const placeholder = liveTranscriptText.querySelector('.transcript-placeholder');
    if (placeholder) placeholder.remove();
    const span = document.createElement('span');
    span.className = 'transcript-segment';
    const needsSpace = liveTranscriptText.textContent && !liveTranscriptText.textContent.endsWith(' ');
    span.textContent = (needsSpace ? ' ' : '') + text;
    if (interimEl && interimEl.isConnected) liveTranscriptText.insertBefore(span, interimEl);
    else liveTranscriptText.appendChild(span);
    liveTranscriptText.scrollTop = liveTranscriptText.scrollHeight;
  }

  // opts.prompt: preceding transcript text (keeps terms consistent across live
  // clips); opts.signal: a caller-owned abort signal. No language is forced —
  // Whisper detects it (the app has no language setting to honour).
  async function transcribeBlob(blob, opts) {
    opts = opts || {};
    if (!aiConfig.token) await loadAiConfig();
    if (!aiConfig.token) throw new Error('Transcription service is not configured right now.');

    const formData = new FormData();
    const filename = blob.name || `audio.${(blob.type || 'audio/webm').split('/')[1]?.split(';')[0] || 'webm'}`;
    formData.append('file', blob, filename);
    formData.append('model', 'whisper-1');
    if (opts.prompt) formData.append('prompt', opts.prompt);

    if (!transcriptionAbortController) transcriptionAbortController = new AbortController();
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${aiConfig.token}` },
      body: formData,
      signal: opts.signal || transcriptionAbortController.signal
    });

    if (!response.ok) {
      let msg = 'Transcription request failed';
      let errBody = '';
      try { const err = await response.json(); msg = err.error?.message || msg; errBody = JSON.stringify(err); } catch (e) {}
      if (window.reportApiError) window.reportApiError({ status: response.status, bodyText: errBody, tool: 'audio', context: 'transcribe audio' });
      throw new Error(msg);
    }
    const data = await response.json();
    return (data.text || '').trim();
  }

  async function loadAiConfig() {
    try {
      const tokens = await window.fetchTokens();
      if (tokens) { aiConfig.token = tokens.token; aiConfig.endpoint = tokens.endpoint; }
    } catch (err) {
      console.error('Could not load AI config:', err);
    }
  }

  // AUDIO UPGRADE: this page had no quota enforcement at all — every other
  // AI tool in the app (format.js, presentation.js, emr-view.js, etc.) gates
  // its AI calls the same way. Guards both the Whisper transcription and the
  // GPT narrative-cleanup pass, whichever path a session takes to reach them.
  async function checkQuotaOrThrow() {
    if (!currentUser || !window.RehabPlanTiers) return;
    const quota = window.RehablixQuotaModal
      ? await window.RehablixQuotaModal.checkAndWarn(currentUser.uid, currentPlan)
      : await window.RehabPlanTiers.hasQuota(currentUser.uid, currentPlan);
    if (!quota.allowed) {
      const resetMins = Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 60000));
      throw new Error(`You've used your token budget for this window. It resets in about ${resetMins} minute(s).`);
    }
  }
  function recordQuotaUsage(text, weight) {
    if (!currentUser || !window.RehabPlanTiers) return;
    window.RehabPlanTiers.consumeQuota(currentUser.uid, currentPlan, window.RehabPlanTiers.estimateTokens(text || ''), weight || 1).catch(() => {});
  }
  const onPlanUpdated = (e) => { currentPlan = (e.detail && e.detail.plan) || 'free'; };
  document.addEventListener('planUpdated', onPlanUpdated);
  cleanupFns.push(() => document.removeEventListener('planUpdated', onPlanUpdated));

  function buildNarrativeSystemPrompt(professionalLabel) {
    return `You are helping a ${professionalLabel} turn a raw speech-to-text transcript of a real session into a professional session narrative — the kind of note this ${professionalLabel} would write to document what took place, for the clinical record.

Your job:
1. Write a clear, well-organized narrative, in third person, describing what happened throughout the session — what was discussed, done, observed, or reported, in the order it makes sense as a summary (you do not need to follow the transcript's exact sentence order).
2. Use professional documentation language and terminology appropriate to a ${professionalLabel}, while staying faithful to what was actually said.
3. You may paraphrase, combine related points, and smooth out filler words, false starts, and speech-to-text artifacts — this is expected and different from a verbatim transcript.
4. If the transcript clearly reflects more than one speaker (e.g. the ${professionalLabel} and a patient/caregiver going back and forth), you may mark distinct speaker turns with a short bolded label such as **Clinician:** or **Patient:** — only when genuinely distinguishable from context (turn-taking, direct address, differing perspectives), never guessed or invented. A single-voice summary/monologue transcript should stay as plain narrative with no speaker labels at all.

You must NOT:
- Invent observations, assessments, measurements, scores, outcomes, diagnoses, or clinical judgments that are not present in the transcript.
- Add details, names, numbers, or events that were not mentioned.
- Fill in gaps with assumptions when the transcript is ambiguous, sparse, or unclear — in that case, just describe plainly what is known and leave it at that.
- Include a title, heading, signature block, or placeholder fields (e.g. "Patient Name: ___").
- Include meta-commentary, disclaimers, or notes about the transcript itself.

Output ONLY the narrative text, as flowing paragraphs.`;
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

  async function cleanupTranscript(rawText, professionalKey, onProgress) {
    if (!rawText || !rawText.trim()) return '';
    if (!aiConfig.token) await loadAiConfig();
    if (!aiConfig.token || !aiConfig.endpoint) return rawText;

    const professionalLabel = PROFESSIONAL_LABELS[professionalKey] || 'clinician';
    const systemPrompt = buildNarrativeSystemPrompt(professionalLabel);
    const pieces = splitForCleanup(rawText);
    const cleanedPieces = [];

    for (let i = 0; i < pieces.length; i++) {
      if (onProgress) onProgress(i, pieces.length);
      try {
        if (!transcriptionAbortController) transcriptionAbortController = new AbortController();
        const url = `${aiConfig.endpoint.replace(/\/$/, '')}/chat/completions`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiConfig.token}` },
          body: JSON.stringify({
            model: aiConfig.model,
            // Linked patient's name / DOB / phone numbers are stripped locally first.
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: deidentify(pieces[i]) }],
            max_tokens: 4000, temperature: 0.3
          }),
          signal: transcriptionAbortController.signal
        });
        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          if (window.reportApiError) window.reportApiError({ status: response.status, bodyText: errBody, tool: 'audio', context: 'narrative cleanup pass' });
          throw new Error('Narrative request failed');
        }
        const data = await response.json();
        cleanedPieces.push(data.choices?.[0]?.message?.content?.trim() || pieces[i]);
      } catch (err) {
        if (err.name === 'AbortError') throw err; // cancelled — propagate, don't silently keep raw text
        console.error('Narrative pass failed for a section, keeping raw text for it:', err);
        cleanedPieces.push(pieces[i]);
      }
    }
    return cleanedPieces.join('\n\n');
  }

  async function finalizeSession() {
    // Coach transcripts keep one labelled turn per line.
    const isCoach = sessionMeta && sessionMeta.mode === 'coach' && (sessionMeta.turns || []).length > 0;
    const rawText = isCoach
      ? rawSegments.filter(Boolean).map(s => s.replace(/\s+/g, ' ').trim()).join('\n')
      : rawSegments.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    const professionalKey = sessionMeta.professional || professionalSelect.value;
    const professionalLabel = PROFESSIONAL_LABELS[professionalKey] || 'Clinician';

    showProcessing('Writing the session narrative…', `Summarizing what happened, from a ${professionalLabel}'s documentation perspective.`, 70);
    try {
      await checkQuotaOrThrow();
      cleanedTranscript = await cleanupTranscript(rawText, professionalKey, (i, total) => {
        const pct = 70 + Math.round(((i + 1) / total) * 25);
        updateProcessingProgress(pct, `Writing section ${i + 1} of ${total}…`);
      });
      recordQuotaUsage(rawText + cleanedTranscript, 1);
    } catch (err) {
      if (err.name === 'AbortError') throw err; // cancelled — let the caller's catch handle it
      // Out of quota (or any other cleanup failure) — the raw transcript is
      // still a usable clinical record, so fall back to it rather than
      // losing the session.
      showToast(err.message || 'Could not write the polished narrative — showing the raw transcript instead.', 'error', 6000);
      cleanedTranscript = '';
    }

    sessionMeta.rawTranscript = rawText;
    sessionMeta.cleanedTranscript = cleanedTranscript;
    sessionMeta.status = 'done';
    await idbPutSession(sessionMeta);

    showProcessing('Saving…', 'Almost done.', 95);
    refreshAudioPatientMatch(); // EMR UPGRADE (item 4): make sure the match reflects whatever's currently typed
    try {
      const payload = {
        title: sessionMeta.title, sessionType: sessionMeta.sessionType, professional: professionalKey,
        sourceType: sessionMeta.sourceType, createdAt: sessionMeta.startedAt, updatedAt: new Date().toISOString(),
        durationSeconds: sessionMeta.elapsedSeconds || 0, rawTranscript: rawText, cleanedTranscript, isPublic: false,
        // EMR UPGRADE (item 4): optional patient link, read fresh at save
        // time so it reflects whatever's currently in the field.
        patientName: (audioPatientName && audioPatientName.value.trim()) || null,
        regNumber: (matchedEmrPatient && matchedEmrPatient.regNumber) || null,
        emrPatientId: (matchedEmrPatient && matchedEmrPatient.id) || null,
        // Coach mode: the mode, the (correctable) speaker-labelled turns, the
        // suggestions shown/asked, and the consent that was recorded.
        mode: sessionMeta.mode || 'transcribe'
      };
      if (sessionMeta.mode === 'coach') {
        payload.turns = (sessionMeta.turns || []).map(t => ({ speaker: t.speaker, text: t.text }));
        payload.suggestions = (coachSuggestions.length ? coachSuggestions : (sessionMeta.suggestions || [])).map(s => ({ text: s.text, askedAt: s.askedAt || null }));
        payload.consent = sessionMeta.consent || null;
      }
      const ref = await database.ref(`history/${scopeUid}/audio`).push(payload);
      firebaseAudioId = ref.key;
      if (localSessionId) idbDeleteSegmentsForSession(localSessionId).catch(() => {});
      if (window.RehablixCenter) window.RehablixCenter.logActivity('audio', 'Transcribed session', sessionMeta.title).catch(() => {});
    } catch (err) {
      console.error('Could not save transcript to history:', err);
      showToast('Transcript ready, but saving to history failed — your text is still safe below.', 'error', 5000);
    }

    updateProcessingProgress(100, 'Done!');
    setTimeout(() => showResult(), 300);
  }

  function showProcessing(title, status, progressPct) {
    processingTitle.textContent = title;
    processingStatus.textContent = status;
    processingProgressFill.style.width = progressPct + '%';
  }
  function updateProcessingProgress(pct, status) {
    processingProgressFill.style.width = pct + '%';
    if (status) processingStatus.textContent = status;
  }

  function showResult() {
    resultTitle.textContent = sessionMeta.title;
    const dateStr = new Date(sessionMeta.startedAt).toLocaleString();
    const professionalLabel = PROFESSIONAL_LABELS[sessionMeta.professional];
    const metaParts = [capitalize(sessionMeta.sessionType)];
    if (professionalLabel) metaParts.push(professionalLabel);
    metaParts.push(formatTime(sessionMeta.elapsedSeconds || 0), dateStr);
    resultMeta.textContent = metaParts.join(' · ');
    currentView = 'cleaned';
    viewCleanedBtn.classList.add('active');
    viewRawBtn.classList.remove('active');
    transcriptTextarea.value = sessionMeta.cleanedTranscript || sessionMeta.rawTranscript || '';
    downloadAudioBtn.style.display = (sessionMeta.sourceType === 'live' && localSessionId) ? 'inline-flex' : 'none';
    setStage(4);
  }

  viewCleanedBtn.addEventListener('click', () => {
    currentView = 'cleaned';
    viewCleanedBtn.classList.add('active');
    viewRawBtn.classList.remove('active');
    // Falls back to the raw transcript if the narrative pass didn't run
    // (e.g. quota-blocked) so this tab is never just an empty box.
    transcriptTextarea.value = sessionMeta.cleanedTranscript || sessionMeta.rawTranscript || '';
  });
  viewRawBtn.addEventListener('click', () => {
    currentView = 'raw';
    viewRawBtn.classList.add('active');
    viewCleanedBtn.classList.remove('active');
    transcriptTextarea.value = sessionMeta.rawTranscript || '';
  });
  transcriptTextarea.addEventListener('input', () => {
    if (currentView === 'cleaned') sessionMeta.cleanedTranscript = transcriptTextarea.value;
    else sessionMeta.rawTranscript = transcriptTextarea.value;
  });

  copyTranscriptBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(transcriptTextarea.value)
      .then(() => showToast('Copied to clipboard', 'success'))
      .catch(() => showToast('Could not copy', 'error'));
  });

  downloadTranscriptBtn.addEventListener('click', () => {
    const blob = new Blob([transcriptTextarea.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(sessionMeta.title || 'transcript').replace(/[^\w\- ]/g, '')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  downloadAudioBtn.addEventListener('click', async () => {
    try {
      const chunks = await idbGetChunksForSession(localSessionId);
      if (!chunks.length) { showToast('Audio is no longer available locally', 'error'); return; }
      const blob = new Blob(chunks.map(c => c.blob), { type: sessionMeta.mimeType || 'audio/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(sessionMeta.title || 'recording').replace(/[^\w\- ]/g, '')}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast('Could not prepare audio download', 'error');
    }
  });

  saveTranscriptBtn.addEventListener('click', async () => {
    if (!firebaseAudioId) { showToast('Nothing to save yet', 'error'); return; }
    try {
      await database.ref(`history/${scopeUid}/audio/${firebaseAudioId}`).update({
        cleanedTranscript: sessionMeta.cleanedTranscript, rawTranscript: sessionMeta.rawTranscript,
        title: sessionMeta.title, updatedAt: new Date().toISOString()
      });
      showToast('Saved', 'success');
      if (window.RehablixCenter) window.RehablixCenter.logActivity('audio', 'Edited transcript', sessionMeta.title).catch(() => {});
      if (localSessionId) { await idbDeleteChunksForSession(localSessionId); await idbDeleteSession(localSessionId); }
      loadHistory();
    } catch (err) {
      showToast('Save failed: ' + err.message, 'error');
    }
  });

  newSessionBtn.addEventListener('click', resetToSetup);

  function resetToSetup() {
    localSessionId = null; sessionMeta = null; rawSegments = []; cleanedTranscript = '';
    uploadedFile = null; firebaseAudioId = null; chunkIndex = 0;
    stopLiveTranscription();
    resetLiveState();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    transcriptionAbortController = null;
    uploadFileInfo.style.display = 'none';
    if (uploadWaveformCanvas) uploadWaveformCanvas.style.display = 'none';
    transcribeUploadBtn.disabled = true;
    audioFileInput.value = '';
    sessionTitleInput.value = '';
    if (audioPrevSessionHint) audioPrevSessionHint.innerHTML = '';
    lastPrevSessionLookupId = null;
    setStage(1);
  }

  // A session continued with "Keep recording" holds several separately
  // recorded stretches; each is transcribed on its own and the text joined.
  async function transcribeSavedChunks(chunks) {
    const starts = ((sessionMeta && sessionMeta.partStarts) || []).filter(n => n > 0);
    const groups = []; let cur = [];
    chunks.forEach(c => { if (starts.includes(c.index) && cur.length) { groups.push(cur); cur = []; } cur.push(c); });
    if (cur.length) groups.push(cur);
    const texts = [];
    for (const g of groups) texts.push(await transcribeBlob(new Blob(g.map(c => c.blob), { type: sessionMeta.mimeType || 'audio/webm' })));
    return texts.filter(Boolean).join(' ');
  }

  // Rebuilds the live clip list of a saved session (transcribing any clip
  // that was still pending when the page was closed).
  async function restoreLiveSegments() {
    const segs = await idbGetSegmentsForSession(localSessionId);
    resetLiveState();
    coachSuggestions = (sessionMeta.suggestions || []).map((s, i) => ({ id: 'r' + i, text: s.text, askedAt: s.askedAt || null, afterIndex: s.afterIndex }));
    segs.forEach(s => { liveSegments[s.index] = { status: s.status === 'done' ? 'done' : 'pending', text: s.text || '', speaker: s.speaker || 'therapist', parts: s.parts || ((s.text && s.speaker) ? [{ text: s.text, speaker: s.speaker }] : null), tries: 0, blob: s.blob }; });
    for (let i = 0; i < liveSegments.length; i++) if (!liveSegments[i]) liveSegments[i] = { status: 'silent', text: '', speaker: 'therapist', parts: null, tries: 0 };
    liveSegments.forEach((s, i) => { if (s && s.status === 'pending') liveQueue.push(i); });
    pumpLiveQueue();
    return segs.length;
  }

  const continueRecordingBtn = $('continueRecordingBtn');
  if (continueRecordingBtn) continueRecordingBtn.addEventListener('click', async () => {
    if (!sessionMeta) return;
    resumeBanner.style.display = 'none';
    try {
      if (sourceMode !== 'live') sourceModeTabs.querySelector('[data-source="live"]').click();
      setAudioMode(sessionMeta.mode || 'transcribe');
      if (sessionTitleInput) sessionTitleInput.value = sessionMeta.title || '';
      if (sessionTypeSelect && sessionMeta.sessionType) sessionTypeSelect.value = sessionMeta.sessionType;
      if (professionalSelect && sessionMeta.professional) professionalSelect.value = sessionMeta.professional;
      await restoreLiveSegments();
      rebuildRawFromSegments();
      const chunks = await idbGetChunksForSession(localSessionId);
      chunkIndex = chunks.length ? chunks[chunks.length - 1].index + 1 : 0;
      await startNewRecording(true);
    } catch (err) { console.error('[audio] could not continue the recording', err); }
    // Microphone refused / unavailable: the session is still there to finish or discard.
    if (!mediaRecorder || mediaRecorder.state === 'inactive') resumeBanner.style.display = 'flex';
  });

  async function checkForInterruptedSession() {
    const all = await idbGetAllSessions();
    const interrupted = all.find(s => s.status === 'recording' || s.status === 'paused' || s.status === 'transcribing');
    if (!interrupted) return;

    localSessionId = interrupted.id;
    sessionMeta = interrupted;
    rawSegments = interrupted.rawSegments || [];

    const when = new Date(interrupted.startedAt).toLocaleString();
    resumeBannerText.textContent = `You have an unfinished recording ("${interrupted.title}") from ${when}. Keep recording into it, or finish and transcribe what you have.`;
    resumeBanner.style.display = 'flex';
  }

  resumeSessionBtn.addEventListener('click', async () => {
    resumeBanner.style.display = 'none';
    showProcessing('Picking up where you left off…', 'Finishing transcription of what was already recorded.', 30);
    setStage(3);
    try {
      audioMode = sessionMeta.mode || 'transcribe';
      // Live clips saved before the interruption: transcribe any still pending.
      const segs = await idbGetSegmentsForSession(localSessionId);
      if (segs.length) {
        resetLiveState();
        // (same restore as "Keep recording", inlined here with progress reporting)
        coachSuggestions = (sessionMeta.suggestions || []).map((s, i) => ({ id: 'r' + i, text: s.text, askedAt: s.askedAt || null, afterIndex: s.afterIndex }));
        segs.forEach(s => { liveSegments[s.index] = { status: s.status === 'done' ? 'done' : 'pending', text: s.text || '', speaker: s.speaker || 'therapist', parts: s.parts || ((s.text && s.speaker) ? [{ text: s.text, speaker: s.speaker }] : null), tries: 0, blob: s.blob }; });
        liveSegments.forEach((s, i) => { if (s && s.status === 'pending') liveQueue.push(i); });
        pumpLiveQueue();
        await drainLiveQueue((done, total) => updateProcessingProgress(30 + Math.round((done / Math.max(1, total)) * 30), `Transcribing segment ${done} of ${total}…`));
        await settleSpeakers();
        rebuildRawFromSegments();
      }
      // Nothing transcribed live: transcribe the whole saved recording instead.
      if (!rawSegments.some(s => s && s.trim())) {
        const chunks = await idbGetChunksForSession(localSessionId);
        if (chunks.length) {
          updateProcessingProgress(55, 'Transcribing the recording…');
          await checkQuotaOrThrow();
          const text = await transcribeSavedChunks(chunks);
          recordQuotaUsage(text, 1);
          if (text) { rawSegments = [text]; sessionMeta.turns = []; sessionMeta.rawSegments = rawSegments; }
        }
      }
      await finalizeSession();
    } catch (err) { if (err.name !== 'AbortError') { console.error(err); showToast('Could not finish transcription: ' + err.message, 'error', 5000); } }
  });

  discardSessionBtn.addEventListener('click', async () => {
    if (sessionMeta) { await idbDeleteChunksForSession(sessionMeta.id); await idbDeleteSegmentsForSession(sessionMeta.id).catch(() => {}); await idbDeleteSession(sessionMeta.id); }
    resumeBanner.style.display = 'none';
    resetToSetup();
    showToast('Discarded', 'info');
  });

  const onBeforeUnload = (e) => {
    if (sessionMeta && (sessionMeta.status === 'recording' || sessionMeta.status === 'paused')) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  cleanupFns.push(() => window.removeEventListener('beforeunload', onBeforeUnload));

  // =========================================================================
  // HISTORY — rendered by the shell's one global drawer (js/history-drawer.js).
  // Same data (history/{scopeUid}/audio), same open/delete rules as before.
  // =========================================================================
  let historyCache = {}; // key -> saved record, for opening from the drawer / deep link

  async function fetchHistoryItems() {
    if (!scopeUid) return [];
    const snap = await database.ref(`history/${scopeUid}/audio`).limitToLast(50).once('value');
    historyCache = snap.val() || {};
    return Object.keys(historyCache).map(key => ({ key, ...historyCache[key] })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  // Refresh after a save/delete/login, and honour a ?openId= deep link.
  async function loadHistory() {
    if (!scopeUid) return;
    try {
      await fetchHistoryItems();
      if (window.RehablixHistoryDrawer) window.RehablixHistoryDrawer.refresh('audio');
      maybeOpenFromDeepLink(historyCache);
    } catch (err) {
      console.error('Could not load history:', err);
    }
  }

  function audioDrawerItem(id, item) {
    return {
      id,
      title: item.title || 'Untitled',
      meta: [capitalize(item.sessionType || ''), formatTime(item.durationSeconds || 0)].filter(Boolean).join(' · '),
      time: item.createdAt,
      raw: item
    };
  }

  if (window.RehablixHistoryDrawer) {
    window.RehablixHistoryDrawer.register('audio', {
      label: 'Audio Transcriptions',
      icon: '🎧',
      searchPlaceholder: 'Search transcripts...',
      emptyText: 'No history found',
      async load() {
        const items = await fetchHistoryItems();
        return items.map(item => audioDrawerItem(item.key, item));
      },
      // Paged by the drawer, 12 at a time (js/history-drawer.js). null = scope not known yet.
      pages: () => (scopeUid ? [{ path: `history/${scopeUid}/audio`, map: audioDrawerItem }] : null),
      open: (item) => openHistoryItem(item.id, historyCache[item.id] || item.raw),
      remove: (item) => deleteHistoryItem(item.id)
    });
    cleanupFns.push(() => window.RehablixHistoryDrawer.unregister('audio'));
  }

  // Deep-link support: Lixa's Files tab opens a specific saved transcript
  // via index.html?openId=<id>#/audio.
  function maybeOpenFromDeepLink(val) {
    const params = new URLSearchParams(window.location.search);
    const openId = params.get('openId');
    if (!openId || !val[openId]) return;
    openHistoryItem(openId, val[openId]);
    if (window.RehablixRouter) window.RehablixRouter.clearQuery();
  }

  // Resolves true if the transcript was deleted (the drawer then drops its row).
  async function deleteHistoryItem(key) {
    if (!scopeUid) return false;
    if (!confirm('Delete this transcription? This cannot be undone.')) return false;
    try {
      await database.ref(`history/${scopeUid}/audio/${key}`).remove();
      if (firebaseAudioId === key) firebaseAudioId = null;
      delete historyCache[key];
      showToast('Transcription deleted', 'success');
      return true;
    } catch (err) {
      console.error('Could not delete history item:', err);
      showToast('Failed to delete', 'error');
      return false;
    }
  }

  function openHistoryItem(key, data) {
    firebaseAudioId = key;
    localSessionId = null;
    sessionMeta = {
      title: data.title, sessionType: data.sessionType, professional: data.professional,
      sourceType: data.sourceType, startedAt: data.createdAt, elapsedSeconds: data.durationSeconds,
      rawTranscript: data.rawTranscript, cleanedTranscript: data.cleanedTranscript
    };
    downloadAudioBtn.style.display = 'none';
    showResult();
  }

  function defaultTitle() {
    const typeLabel = capitalize(sessionTypeSelect.value);
    return `${typeLabel} – ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  function capitalize(str) { if (!str) return ''; return str.charAt(0).toUpperCase() + str.slice(1); }
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  // EMR UPGRADE (item 4): loads Smart EMR patients for the optional
  // name/reg-number link on the setup screen — a separate scope lookup
  // from `scopeUid` above ('audio' vs 'doc'), same as Motion/Presentation.
  async function loadEmrPatientsForLink(user) {
    if (!user || !audioPatientList) return;
    try {
      let uid = user.uid;
      if (window.RehablixCenter && typeof window.RehablixCenter.getEffectiveScopeUid === 'function') {
        try { uid = (await window.RehablixCenter.getEffectiveScopeUid('doc')) || user.uid; } catch (e) { uid = user.uid; }
      }
      // Names/reg numbers only — the lightweight index, not full records.
        const allPatients = window.RehablixEmrStore ? await window.RehablixEmrStore.loadIndex(uid) : (await firebase.database().ref(`history/${uid}/patients`).once('value')).val();
      emrPatientsForLink = Object.entries(allPatients || {}).map(([id, p]) => ({ id, name: (p && p.name) || '', regNumber: (p && p.regNumber) || null })).filter(p => p.name);
      audioPatientList.innerHTML = emrPatientsForLink.map(p => `<option value="${escapeHtml(p.name)}" label="${escapeHtml(p.name)}${p.regNumber ? ' (' + escapeHtml(p.regNumber) + ')' : ''}"></option>`).join('');
    } catch (err) { console.warn('[audio] could not load Smart EMR patients', err); }
  }
  function refreshAudioPatientMatch() {
    if (!audioPatientName) return;
    const name = audioPatientName.value.trim().toLowerCase();
    matchedEmrPatient = name ? emrPatientsForLink.find(p => p.name.toLowerCase() === name) || null : null;
    if (audioPatientHint) {
      audioPatientHint.textContent = matchedEmrPatient
        ? `✓ Linked to Smart EMR${matchedEmrPatient.regNumber ? ' — ' + matchedEmrPatient.regNumber : ''}`
        : '';
    }
    checkPreviousSessions();
  }

  // AUDIO UPGRADE: previous-session quick-compare — once a patient is
  // linked, surface their most recent prior transcript inline, reusing the
  // same findByRegOrName search Presentation and Smart EMR's Linked Records
  // already use, instead of inventing another lookup mechanism.
  let lastPrevSessionLookupId = null;
  async function checkPreviousSessions() {
    if (!audioPrevSessionHint) return;
    if (!matchedEmrPatient) { audioPrevSessionHint.innerHTML = ''; prevSessionsForPatient = []; lastPrevSessionLookupId = null; return; }
    if (lastPrevSessionLookupId === matchedEmrPatient.id) return;
    lastPrevSessionLookupId = matchedEmrPatient.id;
    if (!window.RehablixPatientReg || !scopeUid) return;
    try {
      const query = matchedEmrPatient.regNumber || matchedEmrPatient.name;
      const sources = window.RehablixPatientReg.SEARCH_SOURCES.filter(s => s.path === 'audio');
      const results = await window.RehablixPatientReg.findByRegOrName(scopeUid, query, sources);
      prevSessionsForPatient = results.filter(r => r.id !== firebaseAudioId);
      if (prevSessionsForPatient.length > 0) {
        const latest = prevSessionsForPatient[0];
        audioPrevSessionHint.innerHTML = `<i class="fas fa-clock-rotate-left"></i> ${prevSessionsForPatient.length} previous transcript${prevSessionsForPatient.length > 1 ? 's' : ''} found — most recent: ${escapeHtml(latest.date)} <a href="#" id="viewPrevSessionLink">View</a>`;
        const link = document.getElementById('viewPrevSessionLink');
        if (link) link.addEventListener('click', (e) => { e.preventDefault(); openHistoryItem(latest.id, latest.raw); });
      } else {
        audioPrevSessionHint.innerHTML = '';
      }
    } catch (err) {
      console.warn('[audio] previous-session lookup failed:', err);
    }
  }
  if (audioPatientName) {
    audioPatientName.addEventListener('input', refreshAudioPatientMatch);
    audioPatientName.addEventListener('change', refreshAudioPatientMatch);
  }

  const unsubAuth = firebase.auth().onAuthStateChanged(async (user) => {
    currentUser = user;
    if (!user) return;

    if (window.RehablixCenter && typeof window.RehablixCenter.getEffectiveScopeUid === 'function') {
      try { scopeUid = await window.RehablixCenter.getEffectiveScopeUid('audio'); }
      catch (err) { scopeUid = user.uid; }
    } else {
      scopeUid = user.uid;
    }

    if (scopeUid === null) {
      showToast('Your access to Audio Transcription has been turned off by your center admin.', 'error', 6000);
    } else if (scopeUid !== user.uid) {
      showToast('Working on your center\'s shared transcripts', 'info', 3000);
    }

    if (window.rehabPlans) currentPlan = window.rehabPlans.getCurrentPlan() || 'free';
    await loadAiConfig();
    loadHistory();
    loadEmrPatientsForLink(user); // EMR UPGRADE (item 4)
    if (window.RehablixRegMigration && scopeUid) window.RehablixRegMigration.checkAndPrompt(scopeUid, 'audio'); // EMR UPGRADE (item 5)
  });
  cleanupFns.push(unsubAuth);

  // The page reopens the way it was last used (Record live / Upload, Transcribe / Coach).
  try {
    const lastMode = localStorage.getItem('rehablix_audio_mode');
    const lastSource = localStorage.getItem('rehablix_audio_source');
    if (lastMode === 'coach') setAudioMode('coach');
    else if (lastSource === 'upload') { const u = sourceModeTabs.querySelector('[data-source="upload"]'); if (u && !u.disabled) u.click(); }
  } catch (e) { /* storage unavailable */ }

  openIDB().then(checkForInterruptedSession).catch(err => console.warn('IndexedDB unavailable:', err));
}

function unmount() {
  // Leaving mid-recording shouldn't leave the mic open in the background.
  if (activeSessionStopper) { try { activeSessionStopper(); } catch (e) {} activeSessionStopper = null; }
  cleanupFns.forEach(fn => { try { fn(); } catch (e) { /* best-effort */ } });
  cleanupFns = [];
}

window.RehablixViews = window.RehablixViews || {};
window.RehablixViews.audio = { mount, unmount };
})();
