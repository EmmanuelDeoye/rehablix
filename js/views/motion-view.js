// js/views/motion-view.js — Motion page: full-screen camera scanner for ROM,
// Gait and Assistive Device assessment. Owns UI + the session state machine;
// the numbers come from js/views/motion-engine.js / motion-gait.js (pure
// measurement engine, fed by the live 3D pose tracker in motion-core.js), and
// the structured result/report from js/views/motion-report.js.
// Registered as the "motion" SPA view.
//
// SESSION STATE (single source of truth — renderControls() derives every
// button from it, so the buttons can never disagree with the session):
//   idle       Preferences button = Preferences · Record button = Record
//   capturing  Preferences button = X (cancel)   · Record button = Capture (ROM)
//                                                   or Stop (Gait / Assistive)
//   analyzing  both disabled (the capture is finished, analysis is running)
//   results    result overlay on top; controls behind it are idle-looking
(function () {
  let cleanupFns = [];
  let activeSessionStopper = null; // set while a session is running — stops camera/tracker on unmount

  function mount() {
    const core = window.MotionCore, ME = window.MotionEngine, MR = window.MotionReport;
    const $ = (id) => document.getElementById(id);

    // ---- DOM refs ----
    const typeSelect = $('motionTypeSelect');
    const video = $('motionVideo');
    const placeholder = $('motionPlaceholder');
    const scanOverlay = $('motionScanOverlay');
    const promptChip = $('motionPromptChip');
    const angleChip = $('motionAngleChip');
    const angleValue = $('motionAngleValue');
    const qualityChip = $('motionQualityChip');

    const prefsBtn = $('motionPrefsBtn');
    const recordBtn = $('motionRecordBtn');
    const recordLabel = $('motionRecordLabel');
    const cameraBtn = $('motionCameraSettingsBtn');

    const prefsModal = $('motionPrefsModal');
    const prefsClose = $('motionPrefsClose');
    const prefsSaveBtn = $('motionPrefsSaveBtn');
    const patientNameInput = $('motionPatientName');
    const patientList = $('motionPatientList');
    const patientHint = $('motionPatientHint');
    const romFieldsWrap = $('motionRomFields');
    const assessmentModeSelect = $('motionAssessmentMode');
    const movementFieldWrap = $('motionMovementField');
    const movementSelect = $('motionMovementSelect');
    const sideField = $('motionSideField');
    const sideSelect = $('motionSide');
    const gaitFieldsWrap = $('motionGaitFields');
    const gaitViewSelect = $('motionGaitView');
    const heightField = $('motionHeightField');
    const heightInput = $('motionHeightCm');
    const assistiveFields = $('motionAssistiveFields');
    const wbStatusSelect = $('motionWbStatus');
    const wbSideSelect = $('motionWbSide');
    const ueSelect = $('motionUeFunction');
    const protocolHint = $('motionProtocolHint');
    const gaitNotesWrap = $('motionGaitNotesField');
    const gaitNotesInput = $('motionGaitNotes');
    const autoGuidedCheckbox = $('motionAutoGuided');
    const autoGuidedGroup = autoGuidedCheckbox.closest('.form-group');

    const cameraModal = $('motionCameraModal');
    const cameraClose = $('motionCameraClose');
    const brightnessInput = $('motionBrightness');
    const contrastInput = $('motionContrast');
    const saturationInput = $('motionSaturation');
    const brightnessVal = $('motionBrightnessVal');
    const contrastVal = $('motionContrastVal');
    const saturationVal = $('motionSaturationVal');
    const cameraResetBtn = $('motionCameraResetBtn');

    const analyzingEl = $('motionAnalyzing');
    const analyzingText = $('motionAnalyzingText');
    const analyzingSub = $('motionAnalyzingSub');

    const resultsEl = $('motionResults');
    const resultsTitle = $('motionResultsTitle');
    const resultsBody = $('motionResultsBody');
    const resultsBackBtn = $('motionResultsBackBtn');
    const reviewBar = $('motionReviewBar');
    const reviewStatus = $('motionReviewStatus');
    const confirmBtn = $('motionConfirmBtn');
    const lixaBtn = $('motionLixaBtn');
    const editBtn = $('motionEditBtn');
    const shareBtn = $('motionShareBtn');
    const printBtn = $('motionPrintBtn');
    const downloadBtn = $('motionDownloadBtn');
    const retakeBtn = $('motionRetakeBtn');
    const newSessionBtn = $('motionNewSessionBtn');

    // ---- State ----
    let currentUser = null;
    let scopeUid = null;
    let emrScopeUid = null;
    let emrPatients = [];
    let analysisType = 'rom'; // 'rom' | 'gait' | 'assistive'
    let prefs = { patientName: '', emrPatientId: null, assessmentMode: 'isolate', movementKey: '', side: 'auto', gaitView: gaitViewSelect.options[0].value, gaitNotes: '', autoGuided: true, heightCm: null, wbStatus: 'unknown', wbSide: '', ueFunction: 'unknown' };
    let prefsOpenedFromRecordTap = false;

    let sessionState = 'idle'; // idle | capturing | analyzing | results
    let sessionToken = 0;      // bumped on every start/cancel; async work from a dead session checks it and bails
    let stream = null;
    let paused = false;
    let sampler = null;        // live 3D pose tracker for the running session
    let hudTimer = null;
    let lastResult = null;     // { html, historyKey, type, title, structured }
    let resultFromLink = false;
    let isEditingResults = false;
    let reviewSaveTimer = null;

    let allHistoryItems = []; // merged analysisHistory + gaitHistory + assistiveHistory, newest first

    // ROM session
    let movementQueue = [];
    let currentQueueIndex = 0;
    let currentMovement = null;
    let capturedFrames = [];    // keyframes of the CURRENT movement: [{ img, t }]
    let keyframesByMovement = {};
    let movementWindow = {};    // key -> { start, end } seconds on the sampler timeline
    let movementStartT = 0;
    let captureBusy = false;
    let liveCtx = null, liveBase = null, liveSide = null;
    let autoBuffer = [], autoCooldownUntil = 0, autoLastSpoken = null;

    // Gait / assistive session
    let snapshots = [];
    let recordStartedAt = 0;
    const MIN_RECORD_SEC = { gait: 5, assistive: 12 };

    const kindLabel = (k) => (MR.KIND_LABEL[k] || k);

    // ---- Toast (reuse the shared #toast-container) ----
    function showToast(message, type = 'success', duration = 3500) {
      let container = document.getElementById('toast-container');
      if (!container) { container = document.createElement('div'); container.id = 'toast-container'; document.body.appendChild(container); }
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      toast.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle'}"></i><span>${message}</span>`;
      container.appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(20px)'; toast.style.transition = 'all .3s'; setTimeout(() => toast.remove(), 300); }, duration);
    }
    const escapeHtml = (str) => { const d = document.createElement('div'); d.textContent = str == null ? '' : String(str); return d.innerHTML; };

    // =====================================================================
    // SESSION STATE → CONTROLS  (the only place button appearance is decided)
    // =====================================================================
    function setSessionState(next) { sessionState = next; renderControls(); }

    function recordMode() {
      if (sessionState === 'capturing') return analysisType === 'rom' ? 'capture' : 'stop';
      if (sessionState === 'analyzing') return 'disabled'; // capture finished, analysis running
      return 'record'; // idle, or the capture is complete and the result is on screen — Record is restored
    }

    function renderControls() {
      const capturing = sessionState === 'capturing';
      // Preferences ⇄ X (cancel)
      prefsBtn.classList.toggle('is-cancel', capturing);
      prefsBtn.innerHTML = capturing ? '<i class="fas fa-times"></i>' : '<i class="fas fa-sliders-h"></i>';
      prefsBtn.setAttribute('aria-label', capturing ? 'Cancel session' : 'Preferences');
      prefsBtn.title = capturing ? 'Cancel session (discard this capture)' : 'Preferences';
      prefsBtn.disabled = sessionState === 'analyzing';
      // Record ⇄ Capture ⇄ Stop
      const mode = recordMode();
      recordBtn.dataset.mode = mode;
      recordBtn.classList.toggle('recording', mode === 'stop');
      recordLabel.textContent = mode === 'capture' ? 'Capture' : mode === 'stop' ? 'Stop' : 'Record';
      recordBtn.setAttribute('aria-label', mode === 'capture' ? 'Capture' : mode === 'stop' ? 'Stop recording' : 'Record');
      recordBtn.disabled = mode === 'disabled' || (capturing && paused);
      // Pause/camera button
      cameraBtn.classList.toggle('is-pause', capturing);
      cameraBtn.innerHTML = capturing && paused ? '<i class="fas fa-play"></i>' : '<i class="fas fa-camera-retro"></i>';
      cameraBtn.disabled = sessionState === 'analyzing';
    }

    // =====================================================================
    // Preferences modal
    // =====================================================================
    function populateMovementSelect() {
      movementSelect.innerHTML = '';
      if (prefs.assessmentMode === 'isolate') {
        const groups = {
          Shoulder: ['shoulder_flexion', 'shoulder_extension', 'shoulder_abduction', 'shoulder_adduction', 'shoulder_internal_rotation', 'shoulder_external_rotation'],
          Elbow: ['elbow_flexion', 'elbow_extension'],
          Wrist: ['wrist_flexion', 'wrist_extension', 'wrist_radial_deviation', 'wrist_ulnar_deviation'],
          'Hand/Fingers': ['finger_flexion', 'finger_extension', 'thumb_abduction', 'thumb_opposition'],
          Hip: ['hip_flexion', 'hip_extension', 'hip_abduction', 'hip_adduction', 'hip_internal_rotation', 'hip_external_rotation'],
          Knee: ['knee_flexion', 'knee_extension'],
          Ankle: ['ankle_dorsiflexion', 'ankle_plantarflexion'],
          Cervical: ['cervical_flexion', 'cervical_extension', 'cervical_rotation', 'cervical_lateral_flexion'],
          Lumbar: ['lumbar_flexion', 'lumbar_extension', 'lumbar_lateral_flexion']
        };
        for (const [groupName, keys] of Object.entries(groups)) {
          const optgroup = document.createElement('optgroup');
          optgroup.label = groupName;
          keys.forEach(key => {
            const opt = document.createElement('option');
            opt.value = key;
            opt.textContent = core.movementPrompts[key].name;
            optgroup.appendChild(opt);
          });
          movementSelect.appendChild(optgroup);
        }
      } else {
        core.JOINT_GROUP_LABELS.forEach(g => {
          const opt = document.createElement('option');
          opt.value = g.value; opt.textContent = g.label;
          movementSelect.appendChild(opt);
        });
      }
    }

    const PROTOCOL_HINT = {
      rom: 'Camera level, whole body in frame. Film SIDE-ON for flexion/extension, FRONT-ON for abduction/adduction and rotation. Press Capture at the start position, then at each end-range position — the whole movement is tracked between presses. Movements the pose model cannot see (fingers, thumb) are flagged for manual goniometry.',
      gait: 'Camera level at hip height, 3–4 m away, whole body in frame. SIDE view gives step length, stance/swing, knee and hip motion; FRONT/BACK view gives step width, pelvic and trunk sway. Have the patient walk at least 6–8 steps at their normal pace. Press Stop when done (minimum 5 s).',
      assistive: 'One continuous recording of about 30 s: (1) patient stands still for ~10 s, (2) then walks at least 6–8 steps across the frame at their normal pace with their current support if any. Enter height, weight-bearing status and arm function below — the recommendation is far stronger with them. Press Stop when done (minimum 12 s).'
    };

    // ROM / Gait / Assistive field visibility (also used live when the Analysis Type select changes)
    function syncPrefsFieldVisibility() {
      const isRom = analysisType === 'rom', isAss = analysisType === 'assistive';
      romFieldsWrap.style.display = isRom ? '' : 'none';
      movementFieldWrap.style.display = isRom ? '' : 'none';
      sideField.hidden = !isRom;
      gaitFieldsWrap.hidden = isRom;
      gaitNotesWrap.hidden = isRom;
      heightField.hidden = isRom;
      assistiveFields.hidden = !isAss;
      autoGuidedGroup.hidden = !isRom;
      protocolHint.textContent = PROTOCOL_HINT[analysisType] || '';
      if (isRom) populateMovementSelect();
    }

    function syncPrefsModalFields() {
      typeSelect.value = analysisType;
      syncPrefsFieldVisibility();
      patientNameInput.value = prefs.patientName;
      assessmentModeSelect.value = prefs.assessmentMode;
      sideSelect.value = prefs.side;
      gaitViewSelect.value = prefs.gaitView;
      gaitNotesInput.value = prefs.gaitNotes;
      heightInput.value = prefs.heightCm || '';
      wbStatusSelect.value = prefs.wbStatus; wbSideSelect.value = prefs.wbSide; ueSelect.value = prefs.ueFunction;
      autoGuidedCheckbox.checked = prefs.autoGuided;
      if (analysisType === 'rom' && prefs.movementKey) movementSelect.value = prefs.movementKey;
      refreshPatientHint();
    }

    function openPrefsModal(fromRecordTap) {
      prefsOpenedFromRecordTap = !!fromRecordTap;
      syncPrefsModalFields();
      prefsModal.classList.add('open');
    }
    function closePrefsModal() { prefsModal.classList.remove('open'); }

    // Preferences button: opens the modal when idle; is the X (cancel) while a session runs.
    prefsBtn.addEventListener('click', () => {
      if (sessionState === 'capturing') { cancelSession(); return; }
      if (sessionState === 'idle') openPrefsModal(false);
    });
    prefsClose.addEventListener('click', closePrefsModal);
    prefsModal.querySelector('.motion-modal-overlay').addEventListener('click', closePrefsModal);

    assessmentModeSelect.addEventListener('change', () => { prefs.assessmentMode = assessmentModeSelect.value; populateMovementSelect(); });

    function isPrefsComplete() {
      if (analysisType === 'rom') return !!movementSelect.value;
      return true;
    }

    prefsSaveBtn.addEventListener('click', () => {
      prefs.patientName = patientNameInput.value.trim();
      prefs.assessmentMode = assessmentModeSelect.value;
      prefs.movementKey = movementSelect.value;
      prefs.side = sideSelect.value;
      prefs.gaitView = gaitViewSelect.value;
      prefs.gaitNotes = gaitNotesInput.value.trim();
      const h = parseFloat(heightInput.value);
      prefs.heightCm = h >= 50 && h <= 230 ? Math.round(h) : null;
      prefs.wbStatus = wbStatusSelect.value; prefs.wbSide = wbSideSelect.value; prefs.ueFunction = ueSelect.value;
      prefs.autoGuided = autoGuidedCheckbox.checked;
      const emr = emrPatients.find(p => p.name.toLowerCase() === prefs.patientName.toLowerCase());
      prefs.emrPatientId = emr ? emr.id : null;
      prefs.regNumber = emr ? emr.regNumber : null; // EMR UPGRADE (item 4)
      if (emr && !prefs.heightCm && emr.heightCm) prefs.heightCm = emr.heightCm;

      if (analysisType === 'rom' && !prefs.movementKey) { showToast('Please choose a movement or joint region', 'error'); return; }
      if (analysisType === 'assistive' && prefs.wbStatus !== 'unknown' && prefs.wbStatus !== 'full' && !prefs.wbSide) { showToast('Choose which lower limb is weight-bearing restricted', 'error'); return; }
      closePrefsModal();
      updatePromptChip();
      if (prefsOpenedFromRecordTap && sessionState === 'idle') startSession();
    });

    // Analysis Type select (inside the prefs modal)
    typeSelect.addEventListener('change', () => {
      if (sessionState === 'capturing') cancelSession(true); // switching mode mid-session discards it
      analysisType = typeSelect.value;
      prefs.movementKey = '';
      syncPrefsFieldVisibility();
      updatePromptChip();
      renderControls();
    });

    // Smart EMR patient picker: exact name match links the assessment to that patient
    function refreshPatientHint() {
      const name = patientNameInput.value.trim().toLowerCase();
      const emr = name && emrPatients.find(p => p.name.toLowerCase() === name);
      // EMR UPGRADE (item 4): surface the patient's reference number once linked.
      patientHint.textContent = emr
        ? `✓ Linked to Smart EMR${emr.regNumber ? ' — ' + emr.regNumber : ''} — confirmed results will be filed in this patient’s record.`
        : (emrPatients.length ? 'Choose a Smart EMR patient to file confirmed results in their record, or type a name.' : 'Type a name (Smart EMR patients appear here when available).');
      if (emr && !heightInput.value && emr.heightCm) heightInput.value = emr.heightCm;
    }
    patientNameInput.addEventListener('input', refreshPatientHint);
    patientNameInput.addEventListener('change', refreshPatientHint);

    async function loadEmrPatients(user) {
      try {
        let uid = user.uid;
        if (window.RehablixCenter && typeof window.RehablixCenter.getEffectiveScopeUid === 'function') {
          try { uid = (await window.RehablixCenter.getEffectiveScopeUid('doc')) || user.uid; } catch (e) { uid = user.uid; }
        }
        emrScopeUid = uid;
        const snap = await firebase.database().ref(`history/${uid}/patients`).once('value');
        emrPatients = Object.entries(snap.val() || {}).map(([id, p]) => ({ id, name: (p && p.name) || '', regNumber: (p && p.regNumber) || null, heightCm: p && (p.heightCm || p.height) ? Number(p.heightCm || p.height) || null : null })).filter(p => p.name);
        // EMR UPGRADE (item 4): `label` shows the reg number alongside the
        // name in the browser's autocomplete list; `value` stays just the
        // name so selecting an option still fills the input the same way.
        patientList.innerHTML = emrPatients.map(p => `<option value="${escapeHtml(p.name)}" label="${escapeHtml(p.name)}${p.regNumber ? ' (' + escapeHtml(p.regNumber) + ')' : ''}"></option>`).join('');
      } catch (err) { console.warn('[motion] could not load Smart EMR patients', err); }
    }

    // =====================================================================
    // Camera settings modal (idle) / Pause (while capturing)
    // =====================================================================
    function applyCameraFilter() {
      video.style.filter = `brightness(${brightnessInput.value}%) contrast(${contrastInput.value}%) saturate(${saturationInput.value}%)`;
      brightnessVal.textContent = brightnessInput.value + '%';
      contrastVal.textContent = contrastInput.value + '%';
      saturationVal.textContent = saturationInput.value + '%';
    }
    [brightnessInput, contrastInput, saturationInput].forEach(el => el.addEventListener('input', applyCameraFilter));
    cameraResetBtn.addEventListener('click', () => { brightnessInput.value = 100; contrastInput.value = 100; saturationInput.value = 100; applyCameraFilter(); });

    function togglePause() {
      paused = !paused;
      if (sampler) { if (paused) sampler.pause(); else sampler.resume(); }
      if (paused) autoBuffer = [];
      renderControls();
      showToast(paused ? 'Paused' : 'Resumed', 'info', 1500);
    }
    cameraBtn.addEventListener('click', () => {
      if (sessionState === 'capturing') { togglePause(); return; }
      if (sessionState === 'idle') cameraModal.classList.add('open');
    });
    cameraClose.addEventListener('click', () => cameraModal.classList.remove('open'));
    cameraModal.querySelector('.motion-modal-overlay').addEventListener('click', () => cameraModal.classList.remove('open'));

    // =====================================================================
    // Prompt / HUD helpers
    // =====================================================================
    function updatePromptChip(text) {
      if (text) { promptChip.textContent = text; promptChip.hidden = false; return; }
      if (sessionState === 'capturing') return;
      if (analysisType === 'rom' && prefs.movementKey) {
        const name = prefs.assessmentMode === 'isolate' ? core.movementPrompts[prefs.movementKey]?.name : core.JOINT_GROUP_LABELS.find(g => g.value === prefs.movementKey)?.label;
        promptChip.textContent = name ? `Ready: ${name}` : '';
        promptChip.hidden = !name;
      } else if (analysisType === 'gait') {
        promptChip.textContent = `Ready: Gait Analysis (${prefs.gaitView})`; promptChip.hidden = false;
      } else if (analysisType === 'assistive') {
        promptChip.textContent = 'Ready: Assistive Device Assessment'; promptChip.hidden = false;
      } else promptChip.hidden = true;
    }

    // =====================================================================
    // Record / Capture / Stop button
    // =====================================================================
    recordBtn.addEventListener('click', () => {
      const mode = recordMode();
      if (mode === 'record') {
        if (!isPrefsComplete()) { openPrefsModal(true); return; }
        startSession();
      } else if (mode === 'capture') {
        captureRomKeyframe(false); // every press captures the current position; cancelling is the X button's job
      } else if (mode === 'stop') {
        finishTrackedRecording();
      }
    });

    // =====================================================================
    // Session lifecycle
    // =====================================================================
    async function startSession() {
      if (sessionState !== 'idle') return;
      const token = ++sessionToken;
      let s;
      try { s = await core.startCameraStream(); }
      catch (err) { console.error('Camera error:', err); showToast('Camera access denied or not available', 'error'); return; }
      if (token !== sessionToken) { core.stopCameraStream(s); return; } // cancelled while the permission prompt was open
      stream = s;
      video.srcObject = stream; video.hidden = false;
      placeholder.style.display = 'none';
      scanOverlay.classList.add('active');
      paused = false;
      snapshots = [];
      activeSessionStopper = () => { try { cancelSession(true); } catch (e) {} };
      setSessionState('capturing'); // X + Capture/Stop appear immediately, even while the tracker loads

      qualityChip.hidden = false; qualityChip.className = 'motion-quality-chip'; qualityChip.textContent = 'Loading body tracker…';
      updatePromptChip('Loading body tracker…');
      sampler = core.createSampler(video, {});
      const ok = await sampler.start();
      if (token !== sessionToken) { if (sampler) sampler.stop(); return; }
      if (!ok) {
        showToast('The body-tracking model could not load. Check your connection and try again.', 'error', 6000);
        cancelSession(true);
        return;
      }

      if (analysisType === 'rom') startRomCapture();
      else startTrackedRecording();
      hudTimer = setInterval(hudTick, 120);
    }

    function stopHud() { if (hudTimer) { clearInterval(hudTimer); hudTimer = null; } if (snapTimerId) { clearInterval(snapTimerId); snapTimerId = null; } }
    let snapTimerId = null;

    function teardownCamera() {
      core.stopCameraStream(stream);
      stream = null;
      video.srcObject = null; video.hidden = true;
      placeholder.style.display = 'flex';
      scanOverlay.classList.remove('active');
      angleChip.classList.remove('visible', 'motion-angle-stable');
      qualityChip.hidden = true;
      paused = false;
    }

    function resetCaptureData() {
      capturedFrames = []; keyframesByMovement = {}; movementWindow = {}; snapshots = [];
      movementStartT = 0; captureBusy = false; liveCtx = null; liveBase = null; liveSide = null; autoBuffer = []; autoLastSpoken = null;
    }

    // X button: cancel NOW — stop tracking + camera, discard the unfinished capture, restore Preferences/Record.
    function cancelSession(silent) {
      sessionToken++;
      stopHud();
      if (sampler) { sampler.stop(); sampler = null; }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      teardownCamera();
      resetCaptureData();
      activeSessionStopper = null;
      setSessionState('idle');
      updatePromptChip();
      if (!silent) showToast('Session cancelled — capture discarded', 'info', 2000);
    }
    // legacy name used by the analysis-type change and history opening
    const stopSessionAbort = () => cancelSession(true);

    // Runs ~8×/s while capturing: tracker quality chip, ROM live angle / auto-capture, recording clock.
    function hudTick() {
      if (sessionState !== 'capturing' || !sampler) return;
      const latest = sampler.latest;
      if (paused) return;
      if (latest) {
        const q = ME.frameQuality(latest);
        qualityChip.className = 'motion-quality-chip q-' + q.label.toLowerCase().replace('no body', 'poor');
        const why = q.flags.includes('NO_BODY') ? ' — body not detected' : q.flags.includes('PARTIAL_BODY') ? ' — step back, body partly out of frame' : q.flags.includes('OCCLUSION') ? ' — limbs hidden/low visibility' : '';
        qualityChip.textContent = `Tracking: ${q.label}${why}`;
      }
      if (analysisType === 'rom') romTick(latest);
      else {
        const sec = Math.floor((performance.now() - recordStartedAt) / 1000);
        const min = MIN_RECORD_SEC[analysisType];
        updatePromptChip(`${analysisType === 'gait' ? 'Recording gait' : 'Recording assessment'} · ${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}${sec < min ? ` (min ${min}s)` : ''}`);
      }
    }

    // =====================================================================
    // ROM capture
    // =====================================================================
    function buildMovementQueue() {
      if (prefs.assessmentMode === 'isolate') return [prefs.movementKey];
      return core.jointGroups[prefs.movementKey] || [];
    }

    function startRomCapture() {
      movementQueue = buildMovementQueue();
      currentQueueIndex = 0;
      currentMovement = core.movementPrompts[movementQueue[0]];
      resetCaptureData();
      movementStartT = 0;
      updateRomPromptDisplay();
      autoCooldownUntil = Date.now() + 1500;
      core.speak(`Let's begin. ${currentMovement.prompts[0]}`);
      autoLastSpoken = currentMovement.prompts[0];
    }

    function updateRomPromptDisplay() {
      const stepLabel = movementQueue.length > 1
        ? `${currentMovement.name} (${currentQueueIndex + 1}/${movementQueue.length}) — ${capturedFrames.length}/${currentMovement.requiredFrames}: ${currentMovement.prompts[capturedFrames.length] || 'Hold'}`
        : `${currentMovement.name} — ${capturedFrames.length}/${currentMovement.requiredFrames}: ${currentMovement.prompts[capturedFrames.length] || 'Hold'}`;
      updatePromptChip(stepLabel);
    }

    // Live joint angle (anatomical, 3D) for the current movement + steady-hold detection for auto-capture.
    function romTick(latest) {
      const key = movementQueue[currentQueueIndex];
      const def = ME.MOVEMENTS[key];
      const trackable = def && def.measurable !== false;
      if (!trackable || !latest || !latest.world) { angleChip.classList.remove('visible', 'motion-angle-stable'); if (latest && !latest.world) autoBuffer = []; return; }
      if (!liveCtx) {
        const tracked = sampler.samples.filter(s => s.world).slice(0, 30);
        const hand = ME.resolveHandedness(tracked.length ? tracked : [latest]);
        liveCtx = { hand, ref: ME.bodyFrame(latest, hand) };
      }
      const sides = def.bilateral ? ['left'] : (prefs.side === 'left' || prefs.side === 'right') ? [prefs.side] : ['left', 'right'];
      const vals = {}; sides.forEach(s => { vals[s] = ME.liveSignal(latest, key, s, liveCtx); });
      if (sides.length === 2 && vals.left != null && vals.right != null) {
        if (!liveBase) liveBase = { left: vals.left, right: vals.right };
        // hysteresis: the label only flips to the other limb once it clearly out-moves the current one (no L/R flicker at rest)
        const dl = Math.abs(vals.left - liveBase.left), dr = Math.abs(vals.right - liveBase.right);
        if (!liveSide) liveSide = dl >= dr ? 'left' : 'right';
        else if (liveSide === 'left' && dr > dl + 6) liveSide = 'right';
        else if (liveSide === 'right' && dl > dr + 6) liveSide = 'left';
      } else liveSide = sides.length === 1 ? sides[0] : (vals.left != null ? 'left' : 'right');
      const angle = vals[liveSide];
      if (angle == null) { angleValue.textContent = '—'; angleChip.classList.add('visible'); angleChip.classList.remove('motion-angle-stable'); return; }
      angleChip.classList.add('visible');
      angleValue.textContent = Math.round(angle) + '°' + (def.bilateral ? '' : ' ' + liveSide[0].toUpperCase());

      // speak the next prompt (auto-guided voice)
      const promptNow = currentMovement.prompts[capturedFrames.length];
      if (prefs.autoGuided && promptNow && promptNow !== autoLastSpoken) { core.speak(promptNow); autoLastSpoken = promptNow; }

      autoBuffer.push({ a: angle, t: Date.now() });
      autoBuffer = autoBuffer.filter(s => Date.now() - s.t < 800);
      const recent = autoBuffer.map(s => s.a);
      const steady = recent.length >= 5 && (Math.max(...recent) - Math.min(...recent)) <= 3;
      angleChip.classList.toggle('motion-angle-stable', steady && !captureBusy);
      const icon = angleChip.querySelector('i'); if (icon) icon.className = steady && !captureBusy ? 'fas fa-check-circle' : 'fas fa-ruler';
      if (prefs.autoGuided && steady && recent.length >= 7 && Date.now() > autoCooldownUntil && !captureBusy) captureRomKeyframe(true);
    }

    // Capture button (and the auto-guided trigger) both come through here: the current position is
    // snapshotted; the continuous tracker has been recording the whole trajectory all along.
    async function captureRomKeyframe(auto) {
      if (sessionState !== 'capturing' || paused || captureBusy || analysisType !== 'rom') return;
      const token = sessionToken;
      captureBusy = true;
      try {
        const dataUrl = core.captureFrameFromVideo(video);
        if (!dataUrl) return;
        const compressed = await core.compressImage(dataUrl, 0.8);
        if (token !== sessionToken || sessionState !== 'capturing') return; // cancelled mid-capture
        const t = sampler && sampler.latest ? sampler.latest.t : 0;
        capturedFrames.push({ img: compressed, t });
        // haptic tick — only when the browser allows it (it refuses before the first tap and logs a warning)
        if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(auto ? 60 : 50);
        await onRomKeyframe(t, token);
      } finally {
        autoBuffer = []; autoCooldownUntil = Date.now() + 1500;
        captureBusy = false;
      }
    }

    async function onRomKeyframe(t, token) {
      if (capturedFrames.length >= currentMovement.requiredFrames) {
        const key = movementQueue[currentQueueIndex];
        keyframesByMovement[key] = capturedFrames.slice();
        movementWindow[key] = { start: movementStartT, end: t + 0.4 };
        if (currentQueueIndex < movementQueue.length - 1) {
          currentQueueIndex++;
          currentMovement = core.movementPrompts[movementQueue[currentQueueIndex]];
          capturedFrames = []; movementStartT = t; liveCtx = null; liveBase = null; liveSide = null; autoLastSpoken = null;
          updateRomPromptDisplay();
          showToast(`✓ Movement complete. Next: ${currentMovement.name}`, 'success');
          if (!prefs.autoGuided) core.speak(`Next. ${currentMovement.prompts[0]}`);
        } else {
          finishRomSession(token);
        }
      } else {
        updateRomPromptDisplay();
      }
    }

    async function finishRomSession(token) {
      stopHud();
      const samples = sampler ? sampler.samples.slice() : [];
      if (sampler) { sampler.stop(); }
      const model = sampler ? sampler.model : null;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      teardownCamera();
      const kf = keyframesByMovement, win = movementWindow, queue = movementQueue.slice();
      sampler = null; activeSessionStopper = null;
      setSessionState('analyzing');
      await runRomAnalysis(token, { samples, kf, win, queue, model });
    }

    // =====================================================================
    // Gait / Assistive: continuous tracked recording
    // =====================================================================
    function startTrackedRecording() {
      recordStartedAt = performance.now();
      snapshots = [];
      const grab = async () => {
        if (sessionState !== 'capturing' || paused) return;
        const d = core.captureFrameFromVideo(video); if (!d) return;
        const c = await core.compressImage(d, 0.5);
        snapshots.push({ img: c, t: sampler && sampler.latest ? sampler.latest.t : 0 });
        if (snapshots.length > 40) snapshots = snapshots.filter((_, i) => i % 2 === 0);
      };
      snapTimerId = setInterval(grab, 1500);
      if (analysisType === 'gait') core.speak('Recording started. Walk naturally in view of the camera.');
      else core.speak('Recording. First stand still for ten seconds, then walk naturally across the frame.');
    }

    async function finishTrackedRecording() {
      if (sessionState !== 'capturing' || !sampler) return;
      const elapsed = (performance.now() - recordStartedAt) / 1000;
      const need = MIN_RECORD_SEC[analysisType];
      if (elapsed < need) { showToast(`Keep recording — at least ${need} s is needed for reliable measures (${Math.ceil(need - elapsed)} s to go). Use X to cancel.`, 'info', 3000); return; }
      const token = sessionToken;
      stopHud();
      const samples = sampler.samples.slice();
      const model = sampler.model;
      sampler.stop();
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      teardownCamera();
      const snaps = snapshots.slice();
      sampler = null; activeSessionStopper = null;
      setSessionState('analyzing');
      if (analysisType === 'gait') await runGaitAnalysis(token, { samples, snaps, model });
      else await runAssistiveAnalysis(token, { samples, snaps, model });
    }

    // =====================================================================
    // Analysis pipelines: MEASURE (engine) → structure → AI interprets → save → show
    // =====================================================================
    let statusCycleInterval = null;
    function showAnalyzing(stages) {
      analyzingEl.classList.add('active');
      let i = 0;
      analyzingText.textContent = stages[0];
      analyzingSub.textContent = 'This usually takes a few seconds.';
      if (statusCycleInterval) clearInterval(statusCycleInterval);
      if (stages.length > 1) {
        statusCycleInterval = setInterval(() => {
          i = Math.min(i + 1, stages.length - 1);
          analyzingText.textContent = stages[i];
          if (i >= stages.length - 1) { clearInterval(statusCycleInterval); statusCycleInterval = null; }
        }, 2200);
      }
    }
    function hideAnalyzing() {
      if (statusCycleInterval) { clearInterval(statusCycleInterval); statusCycleInterval = null; }
      analyzingEl.classList.remove('active');
    }
    function renderMarkdown(text) { return (typeof marked !== 'undefined') ? marked.parse(text || '') : `<pre>${escapeHtml(text || '')}</pre>`; }

    async function sceneBrightness(imgs) {
      const list = imgs.slice(0, 3); if (!list.length) return null;
      const vals = []; for (const d of list) vals.push(await core.checkImageBrightness(d));
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    function evenlySpaced(arr, n) { if (arr.length <= n) return arr.slice(); return Array.from({ length: n }, (_, i) => arr[Math.round((i * (arr.length - 1)) / (n - 1))]); }

    // AI reads the measured data; if it is unavailable the measured report still ships.
    async function aiInterpretation(structured, frames) {
      try {
        // EMR UPGRADE (item 9): quota check — this call is already designed
        // to be non-fatal on any failure (the measured report ships either
        // way), so an exhausted budget just skips the AI interpretation
        // step rather than throwing.
        if (currentUser && window.RehabPlanTiers) {
          const plan = (window.rehabPlans && window.rehabPlans.getCurrentPlan()) || 'free';
          const quota = window.RehablixQuotaModal
            ? await window.RehablixQuotaModal.checkAndWarn(currentUser.uid, plan)
            : await window.RehabPlanTiers.hasQuota(currentUser.uid, plan);
          if (!quota.allowed) return null;
        }
        const cfg = await core.fetchOpenAiToken();
        const text = await core.interpretMotion({ aiConfig: cfg, structured, frames });
        if (text && currentUser && window.RehabPlanTiers) {
          const plan = (window.rehabPlans && window.rehabPlans.getCurrentPlan()) || 'free';
          window.RehabPlanTiers.consumeQuota(currentUser.uid, plan, window.RehabPlanTiers.estimateTokens(text), 1).catch(() => {});
        }
        return text;
      } catch (err) { console.warn('[motion] AI interpretation skipped:', err && err.message); return null; }
    }

    async function finalizeResult(token, structured, frames, type, title) {
      if (token !== sessionToken) return;
      setAnalyzingText('Interpreting the measured data…');
      const text = await aiInterpretation(structured, frames);
      if (token !== sessionToken) return;
      if (text) structured.interpretation = { source: 'ai', text, note: 'AI interpretation of the measured data and captured images. Not measured; may contain errors; clinician review required.' };
      else { structured.interpretation = null; structured.limitations.push('AI interpretation was unavailable for this assessment — the measured data above is complete.'); }
      const html = MR.renderHtml(structured, text ? renderMarkdown(text) : '');
      let historyKey = null;
      if (currentUser && scopeUid) {
        try { historyKey = await core.saveMotionRecord({ scopeUid, structured, resultsHtml: html, interpretationText: text }); }
        catch (err) { console.error('[motion] save failed', err); showToast('Result ready, but saving to history failed', 'error', 5000); }
      }
      if (token !== sessionToken) return;
      lastResult = { html, historyKey, type, title, structured };
      if (historyKey) refreshHistoryDrawer();
      showResults(lastResult);
    }
    const setAnalyzingText = (t) => { analyzingText.textContent = t; };

    function failAnalysis(token, message) {
      if (token !== sessionToken) return;
      showToast(message, 'error', 6000);
      hideAnalyzing(); setSessionState('idle'); updatePromptChip();
    }

    async function runRomAnalysis(token, { samples, kf, win, queue, model }) {
      showAnalyzing(['Reviewing the tracked movement…', 'Measuring 3D joint angles…', 'Screening for compensation…', 'Preparing the report…']);
      try {
        const allImgs = queue.flatMap(k => (kf[k] || []).map(f => f.img));
        const quality = ME.captureQuality(samples, { brightness: await sceneBrightness(allImgs) });
        if (!quality.trackedFrames) return failAnalysis(token, 'The body could not be tracked in this capture. Check lighting, distance and that the whole body is in frame, then try again.');
        const analyses = queue.map(key => {
          const w = win[key] || { start: 0, end: Infinity };
          const seg = samples.filter(s => s.t >= w.start && s.t <= w.end);
          return ME.analyzeROM(seg.length >= 8 ? seg : samples, key, { side: prefs.side, name: core.movementPrompts[key].name });
        });
        if (token !== sessionToken) return;
        const title = queue.length > 1 ? `Full ${core.JOINT_GROUP_LABELS.find(g => g.value === prefs.movementKey)?.label || ''} Assessment` : core.movementPrompts[queue[0]].name;
        const structured = MR.build({ kind: 'rom', title, patient: { name: prefs.patientName, emrPatientId: prefs.emrPatientId, regNumber: prefs.regNumber }, prefs: { assessmentMode: prefs.assessmentMode, side: prefs.side, notes: prefs.gaitNotes, autoGuided: prefs.autoGuided }, quality, analyses, poseModel: model ? `MediaPipe BlazePose ${model}` : undefined });
        await finalizeResult(token, structured, allImgs.slice(0, 6), 'rom', title);
      } catch (err) { console.error('ROM analysis error:', err); failAnalysis(token, 'Analysis failed: ' + err.message); }
    }

    async function runGaitAnalysis(token, { samples, snaps, model }) {
      showAnalyzing(['Reviewing the tracked walk…', 'Detecting heel strikes and toe-offs…', 'Computing timing, symmetry and joint motion…', 'Preparing the report…']);
      try {
        const imgs = evenlySpaced(snaps.map(s => s.img), 6);
        const quality = ME.captureQuality(samples, { brightness: await sceneBrightness(imgs) });
        if (!quality.trackedFrames) return failAnalysis(token, 'The body could not be tracked in this recording. Check lighting and that the whole body is visible while walking.');
        const gait = ME.analyzeGait(samples, { view: prefs.gaitView, heightCm: prefs.heightCm });
        if (token !== sessionToken) return;
        const title = `Gait Analysis${prefs.patientName ? ' — ' + prefs.patientName : ''}`;
        const structured = MR.build({ kind: 'gait', title, patient: { name: prefs.patientName, emrPatientId: prefs.emrPatientId, regNumber: prefs.regNumber, heightCm: prefs.heightCm }, prefs: { view: prefs.gaitView, notes: prefs.gaitNotes }, quality, gait, poseModel: model ? `MediaPipe BlazePose ${model}` : undefined });
        structured.capture.view = gait.view;
        await finalizeResult(token, structured, imgs, 'gait', title);
      } catch (err) { console.error('Gait analysis error:', err); failAnalysis(token, 'Analysis failed: ' + err.message); }
    }

    async function runAssistiveAnalysis(token, { samples, snaps, model }) {
      showAnalyzing(['Reviewing the recording…', 'Assessing posture and balance…', 'Analysing the walk…', 'Scoring mobility-aid options…']);
      try {
        const imgs = evenlySpaced(snaps.map(s => s.img), 6);
        const quality = ME.captureQuality(samples, { brightness: await sceneBrightness(imgs) });
        if (!quality.trackedFrames) return failAnalysis(token, 'The body could not be tracked in this recording. Check lighting and that the whole body is visible.');
        const clinicalInputs = { weightBearing: prefs.wbStatus, restrictedLimb: prefs.wbSide || null, upperLimbFunction: prefs.ueFunction, heightCm: prefs.heightCm };
        const assistive = ME.assessAssistive(samples, { view: prefs.gaitView, heightCm: prefs.heightCm, wbStatus: prefs.wbStatus, wbSide: prefs.wbSide, ueFunction: prefs.ueFunction });
        if (token !== sessionToken) return;
        const title = `Assistive Device Assessment${prefs.patientName ? ' — ' + prefs.patientName : ''}`;
        const structured = MR.build({ kind: 'assistive', title, patient: { name: prefs.patientName, emrPatientId: prefs.emrPatientId, regNumber: prefs.regNumber, heightCm: prefs.heightCm }, prefs: { view: prefs.gaitView, notes: prefs.gaitNotes }, clinicalInputs, quality, assistive, poseModel: model ? `MediaPipe BlazePose ${model}` : undefined });
        await finalizeResult(token, structured, imgs, 'assistive', title);
      } catch (err) { console.error('Assistive analysis error:', err); failAnalysis(token, 'Analysis failed: ' + err.message); }
    }

    // =====================================================================
    // Results overlay + review / confirm
    // =====================================================================
    function showResults(result) {
      hideAnalyzing();
      setSessionState('results');
      resultsTitle.textContent = result.title;
      resultsBody.innerHTML = result.html;
      setEditingResults(false);
      resultsEl.classList.add('active');
      syncReviewUI();
    }
    function hideResults() {
      if (isEditingResults) setEditingResults(false);
      resultsEl.classList.remove('active');
      resultFromLink = false;
      if (sessionState === 'results') setSessionState('idle');
    }

    function syncReviewUI() {
      const s = lastResult && lastResult.structured;
      reviewBar.hidden = !s;
      if (!s) return;
      const confirmed = s.status === 'confirmed';
      reviewBar.classList.toggle('confirmed', confirmed);
      if (confirmed) {
        reviewStatus.textContent = `✓ Confirmed by ${s.confirmedBy || 'clinician'} · ${new Date(s.confirmedAt).toLocaleDateString()}${s.linkedToEmr ? ' · filed in the patient’s Smart EMR record' : ''}`;
      } else if (!currentUser || !lastResult.historyKey) {
        reviewStatus.textContent = 'Draft — automated measurements, not yet reviewed. Log in to confirm and file this result.';
      } else {
        reviewStatus.textContent = 'Draft — automated measurements, not yet reviewed. Untick anything you don’t accept, then confirm.';
      }
      confirmBtn.hidden = confirmed;
      confirmBtn.disabled = !currentUser || !lastResult.historyKey;
      resultsBody.querySelectorAll('.mr-include').forEach(cb => {
        const m = (s.measurements || []).find(x => x.id === cb.dataset.mid);
        cb.checked = !!(m && m.include);
        cb.disabled = confirmed || !m || m.value == null;
      });
    }

    resultsBody.addEventListener('change', (e) => {
      const cb = e.target.closest && e.target.closest('.mr-include');
      if (!cb || !lastResult || !lastResult.structured) return;
      const s = lastResult.structured;
      const m = (s.measurements || []).find(x => x.id === cb.dataset.mid);
      if (!m) return;
      m.include = cb.checked;
      (s.findings || []).forEach(f => { if (f.measurementId === m.id) f.include = cb.checked; });
      if (reviewSaveTimer) clearTimeout(reviewSaveTimer);
      reviewSaveTimer = setTimeout(() => {
        if (lastResult && lastResult.historyKey && currentUser) core.updateMotionRecord(scopeUid, lastResult.type, lastResult.historyKey, { structured: s }).catch(() => {});
      }, 700);
    });

    confirmBtn.addEventListener('click', async () => {
      if (!lastResult || !lastResult.structured || !lastResult.historyKey || !currentUser) return;
      const s = lastResult.structured;
      const chosen = (s.measurements || []).filter(m => m.include && m.value != null).length;
      if (!chosen && !confirm('No measurements are ticked. Confirm this result with no measured values?')) return;
      confirmBtn.disabled = true;
      try {
        const res = await core.confirmMotionRecord({ scopeUid, emrScopeUid, id: lastResult.historyKey, structured: s, resultsHtml: resultsBody.innerHTML, user: currentUser });
        s.linkedToEmr = res.linkedToEmr;
        await core.updateMotionRecord(scopeUid, lastResult.type, lastResult.historyKey, { structured: s });
        const cached = allHistoryItems.find(h => h.id === lastResult.historyKey && h.type === lastResult.type);
        if (cached) { cached.status = 'confirmed'; cached.structured = s; }
        showToast(res.linkedToEmr ? 'Confirmed and filed in the patient’s record' : 'Findings confirmed', 'success', 4000);
        syncReviewUI(); refreshHistoryDrawer();
      } catch (err) {
        console.error('[motion] confirm failed', err);
        showToast('Could not confirm: ' + (err.message || 'unknown error'), 'error', 5000);
        confirmBtn.disabled = false;
      }
    });

    // Hand the structured result to Lixa as conversation context (consumed by js/ask.js).
    lixaBtn.addEventListener('click', () => {
      if (!lastResult || !lastResult.structured) return;
      try { sessionStorage.setItem('rehablix:lixaPrefill', MR.lixaContext(lastResult.structured)); } catch (e) { showToast('Could not pass the result to Lixa', 'error'); return; }
      window.RehablixRouter.go('#/lixa');
    });

    // Edit-in-place (narrative text); the structured record + checkboxes are unaffected.
    function setEditingResults(editing) {
      isEditingResults = editing;
      resultsBody.contentEditable = editing ? 'true' : 'false';
      resultsBody.classList.toggle('motion-results-editing', editing);
      const icon = editBtn.querySelector('i');
      if (icon) icon.className = editing ? 'fas fa-check' : 'fas fa-pen';
      editBtn.title = editing ? 'Save changes' : 'Edit';
    }

    async function saveResultEdits() {
      const updatedHtml = resultsBody.innerHTML;
      if (!lastResult) return;
      lastResult.html = updatedHtml;
      if (!lastResult.historyKey || !currentUser) { showToast('Log in to keep edits saved', 'info'); return; }
      try {
        await core.updateMotionRecord(scopeUid, lastResult.type, lastResult.historyKey, { resultsHtml: updatedHtml, lastEditedDate: new Date().toLocaleString() });
        const cached = allHistoryItems.find(h => h.id === lastResult.historyKey && h.type === lastResult.type);
        if (cached) cached.resultsHtml = updatedHtml;
        showToast('Changes saved', 'success');
      } catch (err) { console.error('[motion] save edits error:', err); showToast('Could not save changes', 'error'); }
    }

    editBtn.addEventListener('click', async () => {
      if (!lastResult) return;
      if (!isEditingResults) { setEditingResults(true); resultsBody.focus(); return; }
      setEditingResults(false);
      await saveResultEdits();
    });
    shareBtn.addEventListener('click', async () => {
      if (!lastResult) return;
      const shareText = (lastResult.structured ? MR.clinicalNote(lastResult.structured) : `${lastResult.title}\n\n${resultsBody.innerText}`).slice(0, 4000);
      if (navigator.share) { try { await navigator.share({ title: lastResult.title, text: shareText }); } catch (e) { /* cancelled */ } }
      else { try { await navigator.clipboard.writeText(shareText); showToast('Copied to clipboard', 'success'); } catch (e) { showToast('Could not copy', 'error'); } }
    });
    // Print through a hidden iframe: no popup window to be blocked.
    printBtn.addEventListener('click', () => {
      if (!lastResult) return;
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      document.body.appendChild(f);
      const d = f.contentWindow.document;
      d.open();
      d.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(lastResult.title)}</title>
        <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:1.5rem auto;padding:0 1rem;line-height:1.5;color:#1f2933;font-size:13px} h1,h2{color:#0f766e} h2{font-size:1.05rem;border-bottom:1px solid #ddd;padding-bottom:.2rem} table{border-collapse:collapse;width:100%;margin:.4rem 0} th,td{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top;font-size:11px} .mr-include{display:none} .mr-sub,.mr-note{color:#666;font-size:10px} .mr-conf{font-weight:700} .mr-spark{width:240px;height:56px;border:1px solid #ddd} .mr-spark-line{fill:none;stroke:#0f766e;stroke-width:2} .mr-tag{font-size:9px;text-transform:uppercase;border:1px solid #999;border-radius:4px;padding:0 4px;margin-left:6px}</style>
        </head><body><h1>${escapeHtml(lastResult.title)}</h1>${lastResult.structured ? `<p><strong>Status:</strong> ${lastResult.structured.status === 'confirmed' ? 'Confirmed by ' + escapeHtml(lastResult.structured.confirmedBy || 'clinician') : 'DRAFT — not clinician-confirmed'}</p>` : ''}${resultsBody.innerHTML}</body></html>`);
      d.close();
      setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) {} setTimeout(() => f.remove(), 2000); }, 300);
    });
    downloadBtn.addEventListener('click', () => {
      if (!lastResult) return;
      const text = lastResult.structured ? MR.clinicalNote(lastResult.structured) + (lastResult.structured.interpretation ? `\n\nAI INTERPRETATION (not measured; unverified):\n${lastResult.structured.interpretation.text}` : '') : `${lastResult.title}\n\n${resultsBody.innerText}`;
      const blob = new Blob([text], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${lastResult.title.replace(/[^\w\- ]/g, '')}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });

    retakeBtn.addEventListener('click', () => { hideResults(); resetCaptureData(); startSession(); });
    newSessionBtn.addEventListener('click', () => { hideResults(); resetCaptureData(); updatePromptChip(); });

    // Dismisses the result view and returns to the capture screen — or, if the
    // result was opened by a link from another page, to that page.
    if (resultsBackBtn) {
      resultsBackBtn.addEventListener('click', () => {
        if (resultFromLink && window.RehablixRouter.canGoBack()) { window.RehablixRouter.back('#/motion'); return; }
        hideResults(); resetCaptureData(); updatePromptChip();
      });
    }

    // =====================================================================
    // History — ROM, Gait and Assistive-device results, newest first.
    // Rendered by the shell's one global drawer (js/history-drawer.js).
    // =====================================================================
    const ICONS = { rom: '🦵', gait: '🚶', assistive: '🦯' };
    const TYPE_LABEL = { rom: 'ROM analysis', gait: 'Gait analysis', assistive: 'Assistive device' };
    function historyItemTitle(item) { return item.fileName || item.documentType || (TYPE_LABEL[item.type] || 'Motion result'); }

    async function loadMotionHistory() {
      if (!currentUser || !scopeUid) { allHistoryItems = []; return allHistoryItems; }
      const database = firebase.database();
      const kinds = ['rom', 'gait', 'assistive'];
      const snaps = await Promise.all(kinds.map(k => database.ref(`history/${scopeUid}/${core.KIND_PATH[k]}`).once('value')));
      allHistoryItems = kinds.flatMap((k, i) => snaps[i].val() ? Object.entries(snaps[i].val()).map(([id, item]) => ({ id, type: k, ...item })) : [])
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return allHistoryItems;
    }
    function refreshHistoryDrawer() { if (window.RehablixHistoryDrawer) window.RehablixHistoryDrawer.refresh('motion'); }

    function openHistoricalResult(item) {
      if (sessionState === 'capturing') stopSessionAbort();
      const html = item.resultsHtml || renderMarkdown(item.results);
      lastResult = { html, historyKey: item.id, type: item.type, title: historyItemTitle(item), structured: item.structured || null };
      showResults(lastResult);
    }

    async function deleteHistoricalResult(item) {
      const confirmedNote = item.status === 'confirmed' ? '\n\nThis result was CONFIRMED and may already be part of a patient’s record. Deleting removes the Motion copy and its published measurements; text already added to a Smart EMR assessment stays there.' : '';
      if (!confirm('Delete this result?' + confirmedNote)) return false;
      try {
        await firebase.database().ref(`history/${scopeUid}/${core.KIND_PATH[item.type]}/${item.id}`).remove();
        if (item.status === 'confirmed') await firebase.database().ref(`history/${scopeUid}/clinicalMeasurements/${item.type}_${item.id}`).remove().catch(() => {});
      } catch (err) { showToast('Could not delete', 'error'); return false; }
      allHistoryItems = allHistoryItems.filter(h => !(h.id === item.id && h.type === item.type));
      showToast('Deleted', 'success');
      if (lastResult && lastResult.historyKey === item.id && lastResult.type === item.type) { hideResults(); }
      return true;
    }

    if (window.RehablixHistoryDrawer) {
      window.RehablixHistoryDrawer.register('motion', {
        label: 'Motion & Gait Results',
        searchPlaceholder: 'Search results...',
        emptyText: 'No results yet',
        async load() {
          const items = await loadMotionHistory();
          return items.map(item => ({
            id: `${item.type}:${item.id}`,
            title: historyItemTitle(item),
            meta: [TYPE_LABEL[item.type], item.patientName, item.status === 'confirmed' ? 'Confirmed' : (item.structured ? 'Draft' : '')].filter(Boolean).join(' · '),
            time: item.timestamp,
            icon: ICONS[item.type],
            searchText: `${historyItemTitle(item)} ${item.patientName || ''}`,
            active: !!(lastResult && lastResult.historyKey === item.id && lastResult.type === item.type && resultsEl.classList.contains('active')),
            raw: item
          }));
        },
        open: (item) => openHistoricalResult(item.raw),
        remove: (item) => deleteHistoricalResult(item.raw)
      });
      cleanupFns.push(() => window.RehablixHistoryDrawer.unregister('motion'));
    }

    // Deep link: index.html?openId=<id>&kind=rom|gait|assistive#/motion (Lixa Files list, Smart EMR).
    async function openResultFromLink(user) {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('openId');
      if (!id) return;
      const k = params.get('kind');
      const kind = k === 'gait' || k === 'assistive' ? k : 'rom';
      const path = core.KIND_PATH[kind];
      window.RehablixRouter.clearQuery(); // consume the link so a login change/refresh can't re-open it
      try {
        let val = null;
        for (const uid of [...new Set([scopeUid, user.uid])]) {
          const snap = await firebase.database().ref(`history/${uid}/${path}/${id}`).once('value');
          if (snap.val()) { val = snap.val(); break; }
        }
        if (!val) { showToast('That result could not be found', 'error'); return; }
        openHistoricalResult(Object.assign({ id, type: kind }, val));
        resultFromLink = true;
      } catch (err) { console.error('[motion] could not open linked result', err); showToast('Could not open that result', 'error'); }
    }

    // =====================================================================
    // Auth
    // =====================================================================
    const unsubAuth = firebase.auth().onAuthStateChanged(async (user) => {
      currentUser = user;
      if (!user) { scopeUid = null; syncReviewUI(); return; }
      if (window.RehablixCenter && typeof window.RehablixCenter.getEffectiveScopeUid === 'function') {
        try { scopeUid = await window.RehablixCenter.getEffectiveScopeUid('rom'); }
        catch (err) { scopeUid = user.uid; }
      } else { scopeUid = user.uid; }
      if (scopeUid === null) showToast('Your access to the Motion Analyzer has been turned off by your center admin.', 'error', 6000);
      else if (scopeUid !== user.uid) showToast("Working on your center's shared records", 'info', 3000);
      if (scopeUid) {
        openResultFromLink(user);
        loadEmrPatients(user);
        if (window.RehablixRegMigration) window.RehablixRegMigration.checkAndPrompt(scopeUid, ['analysisHistory', 'gaitHistory', 'assistiveHistory']); // EMR UPGRADE (item 5)
      }
      syncReviewUI();
    });
    cleanupFns.push(unsubAuth);

    // ---- Init ----
    core.warmUpPoseModel(); // start downloading the tracker while the user sets up
    updatePromptChip();
    renderControls();
    // Test/automation hook (also lets other tools ask "is a session running?")
    window.RehablixMotionSession = { get state() { return sessionState; }, get mode() { return analysisType; }, cancel: () => cancelSession(true) };
    cleanupFns.push(() => { delete window.RehablixMotionSession; });
    cleanupFns.push(() => { if (reviewSaveTimer) clearTimeout(reviewSaveTimer); });
  }

  function unmount() {
    if (activeSessionStopper) { try { activeSessionStopper(); } catch (e) {} activeSessionStopper = null; }
    cleanupFns.forEach(fn => { try { fn(); } catch (e) { /* best-effort */ } });
    cleanupFns = [];
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.motion = { mount, unmount };
})();
