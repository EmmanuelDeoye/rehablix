// js/views/motion-view.js — the new full-screen camera-scanner UI for
// Motion & Gait Analyzer. Owns only UI/state-machine concerns; all camera/
// pose/AI/history mechanics come from window.MotionCore (js/views/motion-core.js).
// Registered as the "motion" SPA view.

(function () {
  let cleanupFns = [];
  let activeSessionStopper = null; // set while capturing/recording, cleared on finalize/reset — stops mic/camera on unmount

  function mount() {
    const core = window.MotionCore;
    const $ = (id) => document.getElementById(id);

    // ---- DOM refs ----
    // Analysis Type now lives inside the Preferences modal (moved out of
    // the navbar so that navbar space is free for other controls, e.g. a
    // future history icon) — same #motionTypeSelect id, so its own
    // change/value handling below is unchanged.
    const typeSelect = $('motionTypeSelect');

    // History lives in the shell's single global drawer (js/history-drawer.js);
    // this view registers its data source as a provider (see the History section).

    const video = $('motionVideo');
    const placeholder = $('motionPlaceholder');
    const scanOverlay = $('motionScanOverlay');
    const promptChip = $('motionPromptChip');
    const angleChip = $('motionAngleChip');
    const angleValue = $('motionAngleValue');

    const prefsBtn = $('motionPrefsBtn');
    const recordBtn = $('motionRecordBtn');
    const cameraBtn = $('motionCameraSettingsBtn');

    const prefsModal = $('motionPrefsModal');
    const prefsClose = $('motionPrefsClose');
    const prefsSaveBtn = $('motionPrefsSaveBtn');
    const patientNameInput = $('motionPatientName');
    const romFieldsWrap = $('motionRomFields');
    const assessmentModeSelect = $('motionAssessmentMode');
    const movementFieldWrap = $('motionMovementField');
    const movementSelect = $('motionMovementSelect');
    const gaitFieldsWrap = $('motionGaitFields');
    const gaitViewSelect = $('motionGaitView');
    const gaitNotesWrap = $('motionGaitNotesField');
    const gaitNotesInput = $('motionGaitNotes');
    const autoGuidedCheckbox = $('motionAutoGuided');

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
    const editBtn = $('motionEditBtn');
    const shareBtn = $('motionShareBtn');
    const printBtn = $('motionPrintBtn');
    const downloadBtn = $('motionDownloadBtn');
    const retakeBtn = $('motionRetakeBtn');
    const newSessionBtn = $('motionNewSessionBtn');

    // ---- State ----
    let currentUser = null;
    let scopeUid = null;
    let analysisType = 'rom'; // 'rom' | 'gait'
    let prefs = { patientName: '', assessmentMode: 'isolate', movementKey: '', gaitView: gaitViewSelect.options[0].value, gaitNotes: '', autoGuided: true };
    let prefsOpenedFromRecordTap = false;

    let sessionState = 'idle'; // idle | capturing | analyzing | results
    let stream = null;
    let paused = false;
    let lastResult = null; // { html, historyKey, type, title }
    // True when the result on screen was opened by a link from ANOTHER page
    // (Lixa's Files list, a Lixa file card…) rather than from within Motion
    // itself — Back then returns to that page, not to the scanner.
    let resultFromLink = false;
    let isEditingResults = false;

    // History drawer state
    let allHistoryItems = []; // merged analysisHistory + gaitHistory, newest first

    // ROM capture state
    let movementQueue = [];
    let currentQueueIndex = 0;
    let currentMovement = null;
    let capturedFrames = [];
    let allCapturedFrames = {};

    // Auto-guided scan state
    let autoScanRAF = null;
    let autoScanAngleBuffer = [];
    let autoScanBusy = false;
    let autoScanCooldownUntil = 0;
    let autoScanLastSpokenPrompt = null;

    // Gait capture state
    let mediaRecorder = null;
    let recordedChunks = [];

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
          opt.value = g.value;
          opt.textContent = g.label;
          movementSelect.appendChild(opt);
        });
      }
    }

    // Just the ROM-vs-Gait field visibility, split out from
    // syncPrefsModalFields() so the Analysis Type select (now living
    // inside this modal, not the navbar) can flip it live while the modal
    // is open without also clobbering whatever the user has already typed
    // into the other fields.
    function syncPrefsFieldVisibility() {
      const isRom = analysisType === 'rom';
      romFieldsWrap.style.display = isRom ? '' : 'none';
      movementFieldWrap.style.display = isRom ? '' : 'none';
      gaitFieldsWrap.hidden = isRom;
      gaitNotesWrap.hidden = isRom;
      if (isRom) populateMovementSelect();
    }

    function syncPrefsModalFields() {
      const isRom = analysisType === 'rom';
      typeSelect.value = analysisType;
      syncPrefsFieldVisibility();
      patientNameInput.value = prefs.patientName;
      assessmentModeSelect.value = prefs.assessmentMode;
      gaitViewSelect.value = prefs.gaitView;
      gaitNotesInput.value = prefs.gaitNotes;
      autoGuidedCheckbox.checked = prefs.autoGuided;
      if (isRom && prefs.movementKey) movementSelect.value = prefs.movementKey;
    }

    function openPrefsModal(fromRecordTap) {
      prefsOpenedFromRecordTap = !!fromRecordTap;
      syncPrefsModalFields();
      prefsModal.classList.add('open');
    }
    function closePrefsModal() { prefsModal.classList.remove('open'); }

    prefsBtn.addEventListener('click', () => openPrefsModal(false));
    prefsClose.addEventListener('click', closePrefsModal);
    prefsModal.querySelector('.motion-modal-overlay').addEventListener('click', closePrefsModal);

    assessmentModeSelect.addEventListener('change', () => {
      prefs.assessmentMode = assessmentModeSelect.value;
      populateMovementSelect();
    });

    function isPrefsComplete() {
      if (analysisType === 'rom') return !!movementSelect.value;
      return true; // gait has sensible defaults for everything
    }

    prefsSaveBtn.addEventListener('click', () => {
      prefs.patientName = patientNameInput.value.trim();
      prefs.assessmentMode = assessmentModeSelect.value;
      prefs.movementKey = movementSelect.value;
      prefs.gaitView = gaitViewSelect.value;
      prefs.gaitNotes = gaitNotesInput.value.trim();
      prefs.autoGuided = autoGuidedCheckbox.checked;

      if (analysisType === 'rom' && !prefs.movementKey) {
        showToast('Please choose a movement or joint region', 'error');
        return;
      }
      closePrefsModal();
      updatePromptChip();
      if (prefsOpenedFromRecordTap) startSession();
    });

    // =====================================================================
    // Navbar analysis-type dropdown
    // =====================================================================
    typeSelect.addEventListener('change', () => {
      if (sessionState === 'capturing') stopSessionAbort();
      analysisType = typeSelect.value;
      prefs.movementKey = '';
      syncPrefsFieldVisibility(); // this select now lives inside the prefs modal, so flip ROM/Gait fields live
      updatePromptChip();
    });

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
    cameraResetBtn.addEventListener('click', () => {
      brightnessInput.value = 100; contrastInput.value = 100; saturationInput.value = 100;
      applyCameraFilter();
    });

    function togglePause() {
      paused = !paused;
      cameraBtn.innerHTML = paused ? '<i class="fas fa-play"></i>' : '<i class="fas fa-camera-retro"></i>';
      if (analysisType === 'gait' && mediaRecorder) {
        if (paused && mediaRecorder.state === 'recording') mediaRecorder.pause();
        else if (!paused && mediaRecorder.state === 'paused') mediaRecorder.resume();
      } else if (analysisType === 'rom') {
        if (paused) stopAutoGuidedLoop();
        else if (prefs.autoGuided) startAutoGuidedLoop();
      }
      showToast(paused ? 'Paused' : 'Resumed', 'info', 1500);
    }

    cameraBtn.addEventListener('click', () => {
      if (sessionState === 'capturing') { togglePause(); return; }
      cameraModal.classList.add('open');
    });
    cameraClose.addEventListener('click', () => cameraModal.classList.remove('open'));
    cameraModal.querySelector('.motion-modal-overlay').addEventListener('click', () => cameraModal.classList.remove('open'));

    // =====================================================================
    // Prompt/HUD helpers
    // =====================================================================
    function updatePromptChip(text) {
      if (text) { promptChip.textContent = text; promptChip.hidden = false; return; }
      if (analysisType === 'rom' && prefs.movementKey) {
        const name = prefs.assessmentMode === 'isolate' ? core.movementPrompts[prefs.movementKey]?.name : core.JOINT_GROUP_LABELS.find(g => g.value === prefs.movementKey)?.label;
        promptChip.textContent = name ? `Ready: ${name}` : '';
        promptChip.hidden = !name;
      } else if (analysisType === 'gait') {
        promptChip.textContent = `Ready: Gait Analysis (${prefs.gaitView})`;
        promptChip.hidden = false;
      } else {
        promptChip.hidden = true;
      }
    }

    // =====================================================================
    // Record button — start/stop, routes to ROM or Gait flow
    // =====================================================================
    recordBtn.addEventListener('click', () => {
      if (sessionState === 'analyzing' || sessionState === 'results') return;
      if (sessionState === 'idle') {
        if (!isPrefsComplete()) { openPrefsModal(true); return; }
        startSession();
      } else if (sessionState === 'capturing') {
        if (analysisType === 'gait') stopGaitRecording();
        else if (prefs.autoGuided) stopSessionAbort(); // auto mode: tap = cancel
        else captureRomFrameManually();
      }
    });

    async function startSession() {
      try {
        stream = await core.startCameraStream();
      } catch (err) {
        console.error('Camera error:', err);
        showToast('Camera access denied or not available', 'error');
        return;
      }
      video.srcObject = stream;
      video.hidden = false;
      placeholder.style.display = 'none';
      scanOverlay.classList.add('active');
      sessionState = 'capturing';
      paused = false;
      recordBtn.classList.add('recording');
      recordBtn.setAttribute('aria-label', 'Stop');

      activeSessionStopper = () => { try { stopSessionAbort(); } catch (e) {} };

      if (analysisType === 'gait') startGaitRecording();
      else startRomCapture();
    }

    function teardownCamera() {
      core.stopCameraStream(stream);
      stream = null;
      video.srcObject = null;
      video.hidden = true;
      placeholder.style.display = 'flex';
      scanOverlay.classList.remove('active');
      angleChip.classList.remove('visible');
      recordBtn.classList.remove('recording');
      recordBtn.setAttribute('aria-label', 'Start');
      cameraBtn.innerHTML = '<i class="fas fa-camera-retro"></i>';
      paused = false;
    }

    function stopSessionAbort() {
      stopAutoGuidedLoop();
      if (mediaRecorder && mediaRecorder.state !== 'inactive') { try { mediaRecorder.stop(); } catch (e) {} }
      mediaRecorder = null;
      teardownCamera();
      sessionState = 'idle';
      activeSessionStopper = null;
      updatePromptChip();
      showToast('Session cancelled', 'info', 2000);
    }

    // =====================================================================
    // ROM capture flow
    // =====================================================================
    function buildMovementQueue() {
      if (prefs.assessmentMode === 'isolate') return [prefs.movementKey];
      return core.jointGroups[prefs.movementKey] || [];
    }

    function startRomCapture() {
      movementQueue = buildMovementQueue();
      currentQueueIndex = 0;
      currentMovement = core.movementPrompts[movementQueue[0]];
      capturedFrames = [];
      allCapturedFrames = {};
      core.loadPoseLandmarker(); // warm up in background

      updateRomPromptDisplay();

      if (prefs.autoGuided) startAutoGuidedLoop();
      else core.speak(`Let's begin. ${currentMovement.prompts[0]}`);
    }

    function updateRomPromptDisplay() {
      const stepLabel = movementQueue.length > 1
        ? `${currentMovement.name} (${currentQueueIndex + 1}/${movementQueue.length}) — ${capturedFrames.length}/${currentMovement.requiredFrames}: ${currentMovement.prompts[capturedFrames.length] || 'Hold'}`
        : `${currentMovement.name} — ${capturedFrames.length}/${currentMovement.requiredFrames}: ${currentMovement.prompts[capturedFrames.length] || 'Hold'}`;
      updatePromptChip(stepLabel);
    }

    async function captureRomFrameManually() {
      const dataUrl = core.captureFrameFromVideo(video);
      if (!dataUrl) return;
      const compressed = await core.compressImage(dataUrl, 0.8);
      await onRomFrameCaptured(compressed);
    }

    async function onRomFrameCaptured(compressedDataUrl) {
      capturedFrames.push(compressedDataUrl);
      if (navigator.vibrate) navigator.vibrate(50);

      if (capturedFrames.length >= currentMovement.requiredFrames) {
        allCapturedFrames[movementQueue[currentQueueIndex]] = [...capturedFrames];

        if (currentQueueIndex < movementQueue.length - 1) {
          currentQueueIndex++;
          currentMovement = core.movementPrompts[movementQueue[currentQueueIndex]];
          capturedFrames = [];
          updateRomPromptDisplay();
          showToast(`✓ Movement complete. Next: ${currentMovement.name}`, 'success');
          if (prefs.autoGuided) { autoScanLastSpokenPrompt = null; } // let the loop re-speak the new prompt
          else core.speak(`Next. ${currentMovement.prompts[0]}`);
        } else {
          // All movements done — analyze.
          stopAutoGuidedLoop();
          const allFrames = movementQueue.length > 1 ? Object.values(allCapturedFrames).flat() : capturedFrames;
          teardownCamera();
          await runRomAnalysis(allFrames);
        }
      } else {
        updateRomPromptDisplay();
      }
    }

    function startAutoGuidedLoop() {
      autoScanAngleBuffer = [];
      autoScanBusy = false;
      autoScanCooldownUntil = Date.now() + 1200;
      autoScanLastSpokenPrompt = null;

      const movementKey = movementQueue[currentQueueIndex];
      const trackable = !!core.JOINT_LANDMARK_MAP[movementKey];
      core.speak(`Let's begin. ${currentMovement.prompts[0]}`);
      autoScanLastSpokenPrompt = currentMovement.prompts[0];

      if (!trackable) { angleChip.classList.remove('visible'); return; }

      core.loadLiveLandmarker().then(landmarker => {
        if (!landmarker || sessionState !== 'capturing' || paused) { angleChip.classList.remove('visible'); return; }
        angleChip.classList.add('visible');
        const loop = () => {
          if (sessionState !== 'capturing' || paused || !stream) { autoScanRAF = null; return; }

          const promptNow = currentMovement.prompts[capturedFrames.length];
          if (promptNow && promptNow !== autoScanLastSpokenPrompt) {
            core.speak(promptNow);
            autoScanLastSpokenPrompt = promptNow;
          }

          try {
            const result = landmarker.detectForVideo(video, performance.now());
            const lm = result?.landmarks?.[0];
            const angle = lm ? core.currentAngleFromLandmarks(lm, movementQueue[currentQueueIndex]) : null;

            if (angle !== null) {
              angleValue.textContent = angle + '°';
              autoScanAngleBuffer.push({ angle, t: Date.now() });
              autoScanAngleBuffer = autoScanAngleBuffer.filter(s => Date.now() - s.t < 700);

              // "Perfect frame" indicator: the same spread check the
              // auto-capture below waits for, surfaced as soon as it's true
              // (from as few as 4 recent readings) so the chip turns
              // green/pulses to tell the user to hold still right as the
              // joint settles — not just at the exact instant of capture.
              const recentAngles = autoScanAngleBuffer.map(s => s.angle);
              const isHoldingSteady = recentAngles.length >= 4 &&
                (Math.max(...recentAngles) - Math.min(...recentAngles)) <= 3;
              const showStable = isHoldingSteady && !autoScanBusy;
              angleChip.classList.toggle('motion-angle-stable', showStable);
              const angleIcon = angleChip.querySelector('i');
              if (angleIcon) angleIcon.className = showStable ? 'fas fa-check-circle' : 'fas fa-ruler';

              const ready = autoScanAngleBuffer.length >= 8 && Date.now() > autoScanCooldownUntil;
              if (ready && !autoScanBusy) {
                const spread = Math.max(...recentAngles) - Math.min(...recentAngles);
                if (spread <= 3) {
                  autoScanBusy = true;
                  angleChip.classList.remove('motion-angle-stable');
                  if (navigator.vibrate) navigator.vibrate(60);
                  const dataUrl = core.captureFrameFromVideo(video);
                  core.compressImage(dataUrl, 0.8).then(compressed => onRomFrameCaptured(compressed)).finally(() => {
                    autoScanAngleBuffer = [];
                    autoScanCooldownUntil = Date.now() + 1500;
                    autoScanBusy = false;
                  });
                }
              }
            } else {
              angleValue.textContent = '—';
              angleChip.classList.remove('motion-angle-stable');
            }
          } catch (e) { /* skip this frame */ }

          autoScanRAF = requestAnimationFrame(loop);
        };
        autoScanRAF = requestAnimationFrame(loop);
      });
    }

    function stopAutoGuidedLoop() {
      if (autoScanRAF) { cancelAnimationFrame(autoScanRAF); autoScanRAF = null; }
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      angleChip.classList.remove('visible', 'motion-angle-stable');
      autoScanAngleBuffer = [];
      autoScanBusy = false;
    }

    async function runRomAnalysis(allFrames) {
      sessionState = 'analyzing';
      activeSessionStopper = null;
      showAnalyzing(['Reviewing captured frames…', 'Measuring joint angles…', 'Comparing to normative values…', 'Writing up findings…']);

      try {
        const qualityCheck = await core.validateImageQuality(allFrames);
        if (!qualityCheck.valid) throw new Error(qualityCheck.reason);
        if (qualityCheck.warning) showToast(qualityCheck.reason, 'warning', 4000);

        const aiConfig = await core.fetchOpenAiToken();
        const jointDescription = movementQueue.length > 1
          ? `Full ${core.JOINT_GROUP_LABELS.find(g => g.value === prefs.movementKey)?.label || ''} Assessment`
          : currentMovement.name;

        let measurements = [];
        let framesToSend;
        if (movementQueue.length > 1) {
          framesToSend = [];
          for (const key of movementQueue) {
            const frames = allCapturedFrames[key] || [];
            framesToSend = framesToSend.concat(frames);
            measurements.push({ key, name: core.movementPrompts[key].name, ...(await core.measureMovementROM(frames, key)) });
          }
        } else {
          framesToSend = allFrames;
          measurements.push({ key: movementQueue[0], name: currentMovement.name, ...(await core.measureMovementROM(allFrames, movementQueue[0])) });
        }

        const movementSequenceText = movementQueue.length > 1 ? 'Multiple movements assessment' : currentMovement.prompts.join(' → ');
        const { text } = await core.analyzeROM({ aiConfig, jointDescription, movementSequenceText, framesToSend, measurements });

        if (text.startsWith('ERROR:')) throw new Error(text.slice(6).trim());

        const summaryBlock = '## Measured Range of Motion\n' + measurements.map(m => m.measured
          ? `- **${m.name}: ${m.degrees}°** (pose-landmark measured)`
          : `- **${m.name}:** AI visual estimate only — see notes below`
        ).join('\n') + '\n\n---\n\n';
        const fullResult = summaryBlock + text;

        let historyKey = null;
        if (currentUser) {
          historyKey = await core.saveRomToHistory({
            scopeUid, result: fullResult, measurements, jointName: jointDescription,
            assessmentMode: prefs.assessmentMode, frameCount: allFrames.length, patientName: prefs.patientName
          });
        }

        lastResult = { html: renderMarkdown(fullResult), historyKey, type: 'rom', title: jointDescription };
        if (historyKey) refreshHistoryDrawer();
        showResults(lastResult);
      } catch (err) {
        console.error('ROM analysis error:', err);
        showToast('Analysis failed: ' + err.message, 'error', 5000);
        sessionState = 'idle';
        hideAnalyzing();
      }
    }

    // =====================================================================
    // Gait capture flow
    // =====================================================================
    function startGaitRecording() {
      recordedChunks = [];
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
      mediaRecorder.start();
      updatePromptChip(`Recording gait (${prefs.gaitView})…`);
      core.speak('Recording started. Walk naturally in view of the camera.');
    }

    function stopGaitRecording() {
      if (!mediaRecorder) return;
      stopAutoGuidedLoop(); // no-op for gait but harmless
      mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        teardownCamera();
        await runGaitAnalysis(blob);
      };
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    }

    async function runGaitAnalysis(blob) {
      sessionState = 'analyzing';
      activeSessionStopper = null;
      showAnalyzing(['Sampling video frames…', 'Analyzing gait pattern…', 'Checking for deviations…', 'Writing up findings…']);

      try {
        const frames = await core.extractVideoFramesFromBlob(blob, 5);
        const qualityCheck = await core.validateImageQuality(frames);
        if (!qualityCheck.valid) throw new Error(qualityCheck.reason);
        if (qualityCheck.warning) showToast(qualityCheck.reason, 'warning', 4000);

        const aiConfig = await core.fetchOpenAiToken();
        const { text } = await core.analyzeGait({ aiConfig, frames, patientName: prefs.patientName, view: prefs.gaitView, notes: prefs.gaitNotes });
        if (text.startsWith('ERROR:')) throw new Error(text.slice(6).trim());

        let historyKey = null;
        if (currentUser) {
          historyKey = await core.saveGaitToHistory({ scopeUid, result: text, patientName: prefs.patientName, view: prefs.gaitView, notes: prefs.gaitNotes });
        }

        lastResult = { html: renderMarkdown(text), historyKey, type: 'gait', title: `Gait Analysis${prefs.patientName ? ' — ' + prefs.patientName : ''}` };
        if (historyKey) refreshHistoryDrawer();
        showResults(lastResult);
      } catch (err) {
        console.error('Gait analysis error:', err);
        showToast('Analysis failed: ' + err.message, 'error', 5000);
        sessionState = 'idle';
        hideAnalyzing();
      }
    }

    // =====================================================================
    // Analyzing / Results overlays
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

    function renderMarkdown(text) {
      return (typeof marked !== 'undefined') ? marked.parse(text || '') : `<pre>${text || ''}</pre>`;
    }

    function showResults(result) {
      hideAnalyzing();
      sessionState = 'results';
      resultsTitle.textContent = result.title;
      resultsBody.innerHTML = result.html;
      setEditingResults(false);
      resultsEl.classList.add('active');
    }
    function hideResults() {
      if (isEditingResults) setEditingResults(false);
      resultsEl.classList.remove('active');
      resultFromLink = false;
    }

    // Edit-in-place: the pencil icon toggles resultsBody into an editable
    // state (same idea as Lixa's document editor, just inline instead of a
    // separate page) — clicking it again saves the edited HTML straight
    // back to the same history record instead of opening #/result.
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
      if (!lastResult.historyKey || !currentUser) {
        showToast('Log in to keep edits saved', 'info');
        return;
      }
      const path = lastResult.type === 'gait' ? 'gaitHistory' : 'analysisHistory';
      try {
        await firebase.database().ref(`history/${scopeUid}/${path}/${lastResult.historyKey}`).update({
          resultsHtml: updatedHtml,
          lastEditedDate: new Date().toLocaleString()
        });
        const cached = allHistoryItems.find(h => h.id === lastResult.historyKey && h.type === lastResult.type);
        if (cached) cached.resultsHtml = updatedHtml;
        showToast('Changes saved', 'success');
      } catch (err) {
        console.error('[motion] save edits error:', err);
        showToast('Could not save changes', 'error');
      }
    }

    editBtn.addEventListener('click', async () => {
      if (!lastResult) return;
      if (!isEditingResults) {
        setEditingResults(true);
        resultsBody.focus();
        return;
      }
      setEditingResults(false);
      await saveResultEdits();
    });
    shareBtn.addEventListener('click', async () => {
      if (!lastResult) return;
      const shareText = `${lastResult.title}\n\n${resultsBody.innerText}`.slice(0, 2000);
      if (navigator.share) {
        try { await navigator.share({ title: lastResult.title, text: shareText }); } catch (e) { /* user cancelled */ }
      } else {
        try { await navigator.clipboard.writeText(shareText); showToast('Copied to clipboard', 'success'); } catch (e) { showToast('Could not copy', 'error'); }
      }
    });
    printBtn.addEventListener('click', () => {
      if (!lastResult) return;
      const w = window.open('', '_blank');
      w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${lastResult.title}</title>
        <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1f2933;} h1{color:#009688;}</style>
        </head><body><h1>${lastResult.title}</h1>${resultsBody.innerHTML}</body></html>`);
      w.document.close();
      setTimeout(() => w.print(), 300);
    });
    downloadBtn.addEventListener('click', () => {
      if (!lastResult) return;
      const blob = new Blob([`${lastResult.title}\n\n${resultsBody.innerText}`], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${lastResult.title.replace(/[^\w\- ]/g, '')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });

    retakeBtn.addEventListener('click', () => {
      hideResults();
      capturedFrames = []; allCapturedFrames = {}; recordedChunks = [];
      sessionState = 'idle';
      startSession();
    });
    newSessionBtn.addEventListener('click', () => {
      hideResults();
      capturedFrames = []; allCapturedFrames = {}; recordedChunks = [];
      sessionState = 'idle';
      updatePromptChip();
    });

    // Dismisses the result view and returns to the Motion/Gait capture
    // screen — same "back to idle" outcome as New Session, just from a
    // clearly-labeled back arrow instead of relying on that button's text.
    if (resultsBackBtn) {
      resultsBackBtn.addEventListener('click', () => {
        // Opened from another page? Go back to that page (the actual
        // previous one). Opened within Motion (a fresh scan, or Motion's own
        // history drawer)? The scanner IS the previous screen — dismiss.
        if (resultFromLink && window.RehablixRouter.canGoBack()) {
          window.RehablixRouter.back('#/motion');
          return;
        }
        hideResults();
        capturedFrames = []; allCapturedFrames = {}; recordedChunks = [];
        sessionState = 'idle';
        updatePromptChip();
      });
    }

    // =====================================================================
    // =====================================================================
    // History — past ROM + Gait results, newest first. Rendered by the
    // shell's one global drawer (js/history-drawer.js); same data
    // (history/{scopeUid}/analysisHistory + gaitHistory), same open/delete
    // rules as the old private drawer.
    // =====================================================================
    function historyItemTitle(item) {
      return item.fileName || item.documentType || (item.type === 'gait' ? 'Gait Analysis' : 'ROM Analysis');
    }

    async function loadMotionHistory() {
      if (!currentUser || !scopeUid) { allHistoryItems = []; return allHistoryItems; }
      const database = firebase.database();
      const [romSnap, gaitSnap] = await Promise.all([
        database.ref(`history/${scopeUid}/analysisHistory`).once('value'),
        database.ref(`history/${scopeUid}/gaitHistory`).once('value')
      ]);
      const romItems = romSnap.val() ? Object.entries(romSnap.val()).map(([id, item]) => ({ id, type: 'rom', ...item })) : [];
      const gaitItems = gaitSnap.val() ? Object.entries(gaitSnap.val()).map(([id, item]) => ({ id, type: 'gait', ...item })) : [];
      allHistoryItems = romItems.concat(gaitItems).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      return allHistoryItems;
    }

    function refreshHistoryDrawer() {
      if (window.RehablixHistoryDrawer) window.RehablixHistoryDrawer.refresh('motion');
    }

    function openHistoricalResult(item) {
      if (sessionState === 'capturing') stopSessionAbort();
      const html = item.resultsHtml || renderMarkdown(item.results);
      lastResult = { html, historyKey: item.id, type: item.type, title: historyItemTitle(item) };
      showResults(lastResult);
    }

    // Resolves true if the result was deleted (the drawer then drops its row).
    async function deleteHistoricalResult(item) {
      if (!confirm('Delete this result?')) return false;
      const path = item.type === 'gait' ? 'gaitHistory' : 'analysisHistory';
      try {
        await firebase.database().ref(`history/${scopeUid}/${path}/${item.id}`).remove();
      } catch (err) {
        showToast('Could not delete', 'error');
        return false;
      }
      allHistoryItems = allHistoryItems.filter(h => !(h.id === item.id && h.type === item.type));
      showToast('Deleted', 'success');
      if (lastResult && lastResult.historyKey === item.id && lastResult.type === item.type) hideResults();
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
            meta: [item.type === 'gait' ? 'Gait analysis' : 'ROM analysis', item.patientName].filter(Boolean).join(' · '),
            time: item.timestamp,
            icon: item.type === 'gait' ? '🚶' : '🦵',
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

    // =====================================================================
    // Auth
    // =====================================================================
    // Deep link: index.html?openId=<id>&kind=rom|gait#/motion (from Lixa's
    // Files list). Opens that saved result straight into the result view.
    async function openResultFromLink(user) {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('openId');
      if (!id) return;
      const kind = params.get('kind') === 'gait' ? 'gait' : 'rom';
      const path = kind === 'gait' ? 'gaitHistory' : 'analysisHistory';
      // Consume the link first so this callback re-running (login change)
      // or a refresh can't re-open it.
      window.RehablixRouter.clearQuery();
      try {
        // The record is under the center's scope uid for center members, or
        // the user's own uid (Lixa's Files list reads the latter) — check both.
        let val = null;
        for (const uid of [...new Set([scopeUid, user.uid])]) {
          const snap = await firebase.database().ref(`history/${uid}/${path}/${id}`).once('value');
          if (snap.val()) { val = snap.val(); break; }
        }
        if (!val) { showToast('That result could not be found', 'error'); return; }
        openHistoricalResult(Object.assign({ id, type: kind }, val));
        resultFromLink = true;
      } catch (err) {
        console.error('[motion] could not open linked result', err);
        showToast('Could not open that result', 'error');
      }
    }

    const unsubAuth = firebase.auth().onAuthStateChanged(async (user) => {
      currentUser = user;
      if (!user) { scopeUid = null; return; }
      if (window.RehablixCenter && typeof window.RehablixCenter.getEffectiveScopeUid === 'function') {
        try { scopeUid = await window.RehablixCenter.getEffectiveScopeUid('rom'); }
        catch (err) { scopeUid = user.uid; }
      } else {
        scopeUid = user.uid;
      }
      if (scopeUid === null) showToast('Your access to the Motion Analyzer has been turned off by your center admin.', 'error', 6000);
      else if (scopeUid !== user.uid) showToast("Working on your center's shared records", 'info', 3000);
      if (scopeUid) openResultFromLink(user);
    });
    cleanupFns.push(unsubAuth);

    // ---- Init ----
    updatePromptChip();
  }

  function unmount() {
    if (activeSessionStopper) { try { activeSessionStopper(); } catch (e) {} activeSessionStopper = null; }
    cleanupFns.forEach(fn => { try { fn(); } catch (e) { /* best-effort */ } });
    cleanupFns = [];
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.motion = { mount, unmount };
})();
