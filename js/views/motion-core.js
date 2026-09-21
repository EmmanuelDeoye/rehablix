// js/views/motion-core.js — Motion & Gait Analyzer engine, lifted out of the
// old js/rom.js and js/gait.js so the new full-screen scanner UI
// (js/views/motion-view.js) can drive the same camera/pose/AI/history
// logic without owning any of the mechanics itself. No DOM coupling here
// beyond the <video> element callers pass in — everything else is params
// in, promises/values out.

(function () {
  // ===========================================================================
  // ROM movement catalogue (unchanged from the original tool)
  // ===========================================================================
  const movementPrompts = {
    shoulder_flexion: { name: 'Shoulder Flexion', prompts: ['Position 1: Arm relaxed at side (starting position)', 'Position 2: Raise arm forward to 90°', 'Position 3: Continue to full flexion overhead', 'Position 4: Hold at maximum range'], requiredFrames: 4 },
    shoulder_extension: { name: 'Shoulder Extension', prompts: ['Position 1: Arm at side', 'Position 2: Extend arm backward', 'Position 3: Hold at maximum extension'], requiredFrames: 3 },
    shoulder_abduction: { name: 'Shoulder Abduction', prompts: ['Position 1: Arm at side', 'Position 2: Lift arm sideways to 90°', 'Position 3: Continue to full abduction', 'Position 4: Hold at maximum range'], requiredFrames: 4 },
    shoulder_adduction: { name: 'Shoulder Adduction', prompts: ['Position 1: Arm abducted to 90°', 'Position 2: Bring arm across body toward midline', 'Position 3: Hold at maximum adduction'], requiredFrames: 3 },
    shoulder_internal_rotation: { name: 'Shoulder Internal Rotation', prompts: ['Position 1: Arm at side, elbow flexed 90°', 'Position 2: Rotate forearm inward toward abdomen', 'Position 3: Hold at maximum internal rotation'], requiredFrames: 3 },
    shoulder_external_rotation: { name: 'Shoulder External Rotation', prompts: ['Position 1: Arm at side, elbow flexed 90°', 'Position 2: Rotate forearm outward away from body', 'Position 3: Hold at maximum external rotation'], requiredFrames: 3 },
    elbow_flexion: { name: 'Elbow Flexion', prompts: ['Position 1: Arm fully extended', 'Position 2: Bend elbow to 90°', 'Position 3: Continue to full flexion', 'Position 4: Hold at maximum range'], requiredFrames: 4 },
    elbow_extension: { name: 'Elbow Extension', prompts: ['Position 1: Elbow fully flexed', 'Position 2: Straighten arm to neutral', 'Position 3: Extend as far as possible (if hyperextension)', 'Position 4: Hold at end range'], requiredFrames: 4 },
    wrist_flexion: { name: 'Wrist Flexion', prompts: ['Position 1: Wrist neutral, forearm supported', 'Position 2: Bend wrist downward (palm toward forearm)', 'Position 3: Hold at maximum flexion'], requiredFrames: 3 },
    wrist_extension: { name: 'Wrist Extension', prompts: ['Position 1: Wrist neutral', 'Position 2: Bend wrist upward (back of hand toward forearm)', 'Position 3: Hold at maximum extension'], requiredFrames: 3 },
    wrist_radial_deviation: { name: 'Wrist Radial Deviation', prompts: ['Position 1: Wrist neutral', 'Position 2: Tilt hand toward thumb side', 'Position 3: Hold at maximum radial deviation'], requiredFrames: 3 },
    wrist_ulnar_deviation: { name: 'Wrist Ulnar Deviation', prompts: ['Position 1: Wrist neutral', 'Position 2: Tilt hand toward little finger side', 'Position 3: Hold at maximum ulnar deviation'], requiredFrames: 3 },
    finger_flexion: { name: 'Finger Flexion', prompts: ['Position 1: Fingers fully extended', 'Position 2: Make a fist (flex MCP, PIP, DIP)', 'Position 3: Hold full flexion'], requiredFrames: 3 },
    finger_extension: { name: 'Finger Extension', prompts: ['Position 1: Fingers relaxed in flexion', 'Position 2: Extend all fingers straight', 'Position 3: Hold full extension'], requiredFrames: 3 },
    thumb_abduction: { name: 'Thumb Abduction', prompts: ['Position 1: Thumb against index finger', 'Position 2: Move thumb away from palm (hitchhiker position)', 'Position 3: Hold maximum abduction'], requiredFrames: 3 },
    thumb_opposition: { name: 'Thumb Opposition', prompts: ['Position 1: Hand open, thumb extended', 'Position 2: Touch thumb tip to little finger base', 'Position 3: Hold opposition position'], requiredFrames: 3 },
    hip_flexion: { name: 'Hip Flexion', prompts: ['Position 1: Stand in neutral position', 'Position 2: Lift knee toward chest', 'Position 3: Continue to maximum flexion', 'Position 4: Hold at maximum range'], requiredFrames: 4 },
    hip_extension: { name: 'Hip Extension', prompts: ['Position 1: Stand upright', 'Position 2: Extend leg backward without arching back', 'Position 3: Hold at maximum extension'], requiredFrames: 3 },
    hip_abduction: { name: 'Hip Abduction', prompts: ['Position 1: Stand with feet together', 'Position 2: Lift leg out to side', 'Position 3: Hold at maximum abduction'], requiredFrames: 3 },
    hip_adduction: { name: 'Hip Adduction', prompts: ['Position 1: Leg abducted', 'Position 2: Bring leg back toward midline', 'Position 3: Cross midline if possible'], requiredFrames: 3 },
    hip_internal_rotation: { name: 'Hip Internal Rotation', prompts: ['Position 1: Seated, knee flexed 90°', 'Position 2: Rotate lower leg outward (foot moves inward)', 'Position 3: Hold maximum internal rotation'], requiredFrames: 3 },
    hip_external_rotation: { name: 'Hip External Rotation', prompts: ['Position 1: Seated, knee flexed 90°', 'Position 2: Rotate lower leg inward (foot moves outward)', 'Position 3: Hold maximum external rotation'], requiredFrames: 3 },
    knee_flexion: { name: 'Knee Flexion', prompts: ['Position 1: Stand with leg straight', 'Position 2: Bend knee to 90°', 'Position 3: Continue to full flexion', 'Position 4: Hold at maximum range'], requiredFrames: 4 },
    knee_extension: { name: 'Knee Extension', prompts: ['Position 1: Knee flexed (seated)', 'Position 2: Straighten leg to neutral', 'Position 3: Extend to full available range', 'Position 4: Hold end range'], requiredFrames: 4 },
    ankle_dorsiflexion: { name: 'Ankle Dorsiflexion', prompts: ['Position 1: Foot flat on ground', 'Position 2: Lift toes up (dorsiflex)', 'Position 3: Hold at maximum range'], requiredFrames: 3 },
    ankle_plantarflexion: { name: 'Ankle Plantarflexion', prompts: ['Position 1: Foot flat', 'Position 2: Point toes downward', 'Position 3: Hold maximum plantarflexion'], requiredFrames: 3 },
    cervical_flexion: { name: 'Cervical Flexion', prompts: ['Position 1: Head neutral', 'Position 2: Tuck chin to chest', 'Position 3: Hold maximum flexion'], requiredFrames: 3 },
    cervical_extension: { name: 'Cervical Extension', prompts: ['Position 1: Head neutral', 'Position 2: Look upward, extend neck', 'Position 3: Hold maximum extension'], requiredFrames: 3 },
    cervical_rotation: { name: 'Cervical Rotation', prompts: ['Position 1: Head in neutral position', 'Position 2: Rotate head to the right', 'Position 3: Return to center', 'Position 4: Rotate head to the left', 'Position 5: Return to center'], requiredFrames: 5 },
    cervical_lateral_flexion: { name: 'Cervical Lateral Flexion', prompts: ['Position 1: Head neutral', 'Position 2: Tilt ear toward right shoulder', 'Position 3: Return to center', 'Position 4: Tilt ear toward left shoulder', 'Position 5: Return to center'], requiredFrames: 5 },
    lumbar_flexion: { name: 'Lumbar Flexion', prompts: ['Position 1: Stand upright', 'Position 2: Bend forward slowly', 'Position 3: Reach toward toes', 'Position 4: Hold at maximum flexion'], requiredFrames: 4 },
    lumbar_extension: { name: 'Lumbar Extension', prompts: ['Position 1: Stand upright', 'Position 2: Lean backward, support hips', 'Position 3: Hold maximum extension'], requiredFrames: 3 },
    lumbar_lateral_flexion: { name: 'Lumbar Lateral Flexion', prompts: ['Position 1: Stand upright', 'Position 2: Slide hand down right thigh, bend sideways', 'Position 3: Return to center', 'Position 4: Repeat on left side'], requiredFrames: 4 }
  };

  const jointGroups = {
    shoulder: ['shoulder_flexion', 'shoulder_extension', 'shoulder_abduction', 'shoulder_adduction', 'shoulder_internal_rotation', 'shoulder_external_rotation'],
    elbow: ['elbow_flexion', 'elbow_extension'],
    wrist: ['wrist_flexion', 'wrist_extension', 'wrist_radial_deviation', 'wrist_ulnar_deviation'],
    hand: ['finger_flexion', 'finger_extension', 'thumb_abduction', 'thumb_opposition'],
    hip: ['hip_flexion', 'hip_extension', 'hip_abduction', 'hip_adduction', 'hip_internal_rotation', 'hip_external_rotation'],
    knee: ['knee_flexion', 'knee_extension'],
    ankle: ['ankle_dorsiflexion', 'ankle_plantarflexion'],
    cervical: ['cervical_flexion', 'cervical_extension', 'cervical_rotation', 'cervical_lateral_flexion'],
    lumbar: ['lumbar_flexion', 'lumbar_extension', 'lumbar_lateral_flexion']
  };

  const JOINT_GROUP_LABELS = [
    { value: 'shoulder', label: 'Shoulder Complex' }, { value: 'elbow', label: 'Elbow' },
    { value: 'wrist', label: 'Wrist' }, { value: 'hand', label: 'Hand & Fingers' },
    { value: 'hip', label: 'Hip Complex' }, { value: 'knee', label: 'Knee' },
    { value: 'ankle', label: 'Ankle' }, { value: 'cervical', label: 'Cervical Spine' },
    { value: 'lumbar', label: 'Lumbar Spine' }
  ];

  // ===========================================================================
  // Camera
  // ===========================================================================
  async function startCameraStream(constraints) {
    return navigator.mediaDevices.getUserMedia(constraints || {
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });
  }

  function stopCameraStream(stream) {
    if (stream) stream.getTracks().forEach(t => t.stop());
  }

  function captureFrameFromVideo(videoEl) {
    if (!videoEl || !videoEl.videoWidth) return null;
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    canvas.getContext('2d').drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  }

  function compressImage(dataUrl, maxSizeMB = 1) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width, h = img.height;
        const maxDim = 1024;
        if (w > maxDim || h > maxDim) {
          if (w > h) { h = (h / w) * maxDim; w = maxDim; } else { w = (w / h) * maxDim; h = maxDim; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        let quality = 0.8;
        let result = canvas.toDataURL('image/jpeg', quality);
        while (result.length > maxSizeMB * 1024 * 1024 && quality > 0.3) {
          quality -= 0.1;
          result = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(result);
      };
      img.src = dataUrl;
    });
  }

  function checkImageBrightness(dataUrl) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width; canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        try {
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let total = 0, count = 0;
          for (let i = 0; i < data.length; i += 16) {
            total += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            count++;
          }
          resolve(total / count);
        } catch (e) { resolve(128); }
      };
      img.onerror = () => resolve(128);
      img.src = dataUrl;
    });
  }

  async function validateImageQuality(frames) {
    if (!frames || frames.length === 0) return { valid: false, reason: 'No frames to analyze' };
    let darkFrames = 0;
    const THRESHOLD = 40;
    for (const frame of frames) {
      const b = await checkImageBrightness(frame);
      if (b < THRESHOLD) darkFrames++;
    }
    const darkPct = (darkFrames / frames.length) * 100;
    if (darkPct > 50) return { valid: false, reason: `Images appear too dark (${Math.round(darkPct)}% of frames). Please ensure proper lighting.`, warning: true };
    if (darkPct > 25) return { valid: true, warning: true, reason: 'Some images are dark. Consider improving lighting for better accuracy.' };
    return { valid: true, warning: false };
  }

  // ===========================================================================
  // Pose tracking — MediaPipe BlazePose with 3D WORLD landmarks (metres,
  // hip-centred) plus image landmarks and per-landmark visibility. All angle
  // and gait maths lives in js/views/motion-engine.js / motion-gait.js; this
  // file only supplies tracked frames ("samples") to it.
  // ===========================================================================
  const VISION_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
  const poseModelUrl = (v) => `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${v}/float16/1/pose_landmarker_${v}.task`;
  let visionPromise = null;
  function loadVision() {
    if (!visionPromise) visionPromise = import(`${VISION_CDN}/vision_bundle.mjs`).catch(err => { console.warn('[Motion] Vision runtime failed to load:', err); visionPromise = null; return null; });
    return visionPromise;
  }

  // Strongest model that actually loads: prefer the requested variant, fall
  // back full → lite; GPU first, CPU if the GPU delegate is unavailable.
  const landmarkerCache = {};
  function loadLandmarker(runningMode, preferred) {
    const key = runningMode + ':' + preferred;
    if (landmarkerCache[key]) return landmarkerCache[key];
    landmarkerCache[key] = (async () => {
      const vision = await loadVision();
      if (!vision) return null;
      const fileset = await vision.FilesetResolver.forVisionTasks(`${VISION_CDN}/wasm`);
      const order = { heavy: ['heavy', 'full', 'lite'], full: ['full', 'lite'], lite: ['lite'] }[preferred] || ['full', 'lite'];
      for (const variant of order) {
        for (const delegate of ['GPU', 'CPU']) {
          try {
            const lm = await vision.PoseLandmarker.createFromOptions(fileset, {
              baseOptions: { modelAssetPath: poseModelUrl(variant), delegate },
              runningMode, numPoses: 1, minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5
            });
            lm.__variant = variant; lm.__delegate = delegate;
            return lm;
          } catch (err) { console.warn(`[Motion] pose_landmarker_${variant} (${delegate}) unavailable:`, err && err.message); }
        }
      }
      landmarkerCache[key] = null;
      return null;
    })();
    return landmarkerCache[key];
  }
  // Real-time tracking uses the FULL model (the heavy model cannot keep up on
  // phones/tablets); heavy is requested first on capable devices via preferHeavy.
  function loadLiveLandmarker(preferHeavy) { return loadLandmarker('VIDEO', preferHeavy ? 'heavy' : 'full'); }
  function warmUpPoseModel() { return loadLiveLandmarker(false); }

  function resultToSample(res, tSec, aspect) {
    const lm = res && res.landmarks && res.landmarks[0];
    const wl = res && res.worldLandmarks && res.worldLandmarks[0];
    if (!lm || !wl || lm.length < 33 || wl.length < 33) return { t: tSec, world: null, img: null, vis: null, aspect };
    return {
      t: tSec, aspect,
      world: wl.map(p => ({ x: p.x, y: p.y, z: p.z })),
      img: lm.map(p => ({ x: p.x, y: p.y })),
      vis: lm.map(p => (p.visibility == null ? 1 : p.visibility))
    };
  }

  // Continuous tracker over a live <video>: every new video frame is run
  // through the landmarker and appended to `samples` (with time in seconds
  // from the first frame). Frames where no body was found are recorded too
  // (world: null) so tracking gaps are visible to the quality checks.
  function createSampler(video, opts) {
    opts = opts || {};
    const samples = []; const maxSamples = opts.maxSamples || 6000;
    let raf = null, running = false, lastVideoTime = -1, landmarker = null, t0 = null, latest = null, pausedTotal = 0, pausedAt = null;
    let loop = null;
    async function start() {
      landmarker = await loadLiveLandmarker(!!opts.preferHeavy);
      if (!landmarker) return false;
      running = true; t0 = null; lastVideoTime = -1; pausedTotal = 0; pausedAt = null;
      loop = () => {
        if (!running) return;
        if (video.readyState >= 2 && video.videoWidth && video.currentTime !== lastVideoTime) {
          lastVideoTime = video.currentTime;
          const now = performance.now();
          try {
            if (t0 === null) t0 = now;
            const res = landmarker.detectForVideo(video, now);
            const s = resultToSample(res, (now - t0 - pausedTotal) / 1000, video.videoWidth / video.videoHeight);
            latest = s;
            if (samples.length < maxSamples) samples.push(s);
            if (opts.onSample) opts.onSample(s);
          } catch (e) { /* skip this frame */ }
        }
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
      return true;
    }
    function stop() { running = false; pausedAt = null; if (raf) cancelAnimationFrame(raf); raf = null; }
    // Pause keeps the timeline continuous: paused time is subtracted so the
    // recorded trajectory has no gap for the analysis to trip over.
    function pause() { if (!running) return; running = false; pausedAt = performance.now(); if (raf) cancelAnimationFrame(raf); raf = null; }
    function resume() { if (running || !landmarker || !loop) return; if (pausedAt != null) pausedTotal += performance.now() - pausedAt; pausedAt = null; running = true; raf = requestAnimationFrame(loop); }
    return {
      start, stop, pause, resume, samples,
      clear() { samples.length = 0; t0 = null; latest = null; pausedTotal = 0; },
      get latest() { return latest; },
      get running() { return running; },
      get model() { return landmarker ? `${landmarker.__variant || 'full'} (${landmarker.__delegate || '?'})` : null; },
      // Samples recorded since `sinceSec` (for per-movement segmentation).
      since(sinceSec) { return samples.filter(s => s.t >= sinceSec); }
    };
  }

  function loadImageEl(dataUrl) {
    return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = dataUrl; });
  }

  // ===========================================================================
  // Voice guidance
  // ===========================================================================
  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1; utter.pitch = 1;
      window.speechSynthesis.speak(utter);
    } catch (err) { console.warn('[Motion] Speech synthesis failed:', err); }
  }

  // ===========================================================================
  // AI tokens
  // ===========================================================================
  async function fetchOpenAiToken() {
    const snap = await firebase.database().ref('tokens/open_ai').once('value');
    const data = snap.val();
    if (!data || !data.api_key) throw new Error('AI service is not configured.');
    return { token: data.api_key, endpoint: 'https://api.openai.com/v1' };
  }

  // ===========================================================================
  // AI INTERPRETATION — interprets the MEASURED data; it never produces the
  // measurements. The engine (motion-engine.js / motion-gait.js) computes
  // every number; the model gets those numbers as authoritative input and is
  // told, in the strongest terms, not to change them or add any of its own.
  // If the AI is unavailable the measured report is still delivered.
  // ===========================================================================
  function compactForAI(s) {
    const meas = (s.measurements || []).map(m => ({ name: m.name, value: m.value, unit: m.unit, side: m.side, confidence: m.confidenceLabel, plane: m.plane, reference: m.reference && m.reference.normal, note: m.value == null ? 'WITHHELD — not reliably measurable' : undefined }));
    const out = { kind: s.kindLabel, patient: (s.patient && s.patient.name) || undefined, captureQuality: s.capture && s.capture.quality && { label: s.capture.quality.label, flags: s.capture.quality.flags, durationSec: s.capture.quality.durationSec },
      measurements: meas, deviationsFlagged: (s.deviations || []).map(d => `${d.label} (${d.evidence})`), notDeterminable: s.notDeterminable, prefs: s.prefs };
    if (s.kind === 'rom') out.movements = (s.movements || []).map(m => ({ name: m.name, side: m.side, start: m.start, peak: m.peak, smoothness: m.quality && m.quality.smoothness, compensations: (m.compensations || []).filter(c => c.flagged).map(c => c.label), flags: m.flags }));
    if (s.kind === 'assistive' && s.extra) {
      const r = s.extra.recommendation;
      out.ruleBasedDeviceSuggestion = r && { primary: r.primary.device, reasons: r.primary.reasons, alternatives: (r.alternatives || []).map(a => a.device), undetermined: r.undetermined, confidence: r.confidenceLabel, instabilityFindings: r.instability && r.instability.findings };
      out.clinicianEntered = s.extra.clinicalInputs; out.fittingAvailable = !!(s.extra.fitting && s.extra.fitting.available);
    }
    return out;
  }

  async function interpretMotion({ aiConfig, structured, frames }) {
    const kind = structured.kind;
    const roleByKind = {
      rom: 'range-of-motion assessment', gait: 'gait analysis', assistive: 'assistive-device (mobility aid) assessment'
    };
    const system = `You are the interpretation layer of rehablix Motion, assisting a rehabilitation professional with a ${roleByKind[kind]}.

The user message contains MEASURED DATA computed by a pose-tracking engine (3D body landmarks). It is authoritative.
ABSOLUTE RULES
1. Never change, recompute, round differently, or contradict any measured value. Never invent a measurement: no angles, distances, times, speeds, percentages, or counts that are not in the data.
2. Measurements marked WITHHELD, or with Low/Unreliable confidence, must be described as unreliable — do not interpret them as findings.
3. Anything you notice in the images that is not in the data goes ONLY under the heading "Observed in images (AI-observed, not measured)", each item clearly worded as an observation, not a measurement.
4. If the data are insufficient for a conclusion, say what is missing instead of guessing. Respect the notDeterminable list.
5. Do not diagnose. Suggest clinical considerations and next steps for the clinician to decide on.
${kind === 'assistive' ? '6. A rule-based device suggestion is provided. Explain and contextualise it using the measured findings; do not replace it with a different device. If the images suggest a factor the rules could not see, state it under the AI-observed heading and recommend the clinician weigh it.\n' : ''}
Write in concise clinical language with these headings (##): "Interpretation of measured findings", "Observed in images (AI-observed, not measured)", "Clinical considerations and suggested next steps". No tables. Maximum ~400 words.`;
    const userText = `MEASURED DATA (authoritative JSON):\n${JSON.stringify(compactForAI(structured))}\n\nThe attached images are frames from the same capture. Interpret per the rules.`;
    const content = [{ type: 'text', text: userText }].concat((frames || []).slice(0, 6).map(url => ({ type: 'image_url', image_url: { url } })));
    try {
      const response = await fetch(`${aiConfig.endpoint.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiConfig.token}` },
        body: JSON.stringify({ model: 'gpt-4.1', messages: [{ role: 'system', content: system }, { role: 'user', content }], max_tokens: 1400, temperature: 0.2 })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (window.reportApiError) window.reportApiError({ status: response.status, bodyText: JSON.stringify(err), tool: kind, context: 'interpret motion measurements' });
        return null;
      }
      const data = await response.json();
      return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || null;
    } catch (err) { console.warn('[Motion] AI interpretation unavailable:', err); return null; }
  }

  // ===========================================================================
  // History + clinical record. One structured record per assessment
  // (rehablix.motion.v1, see js/views/motion-report.js). Existing nodes keep
  // their older fields (results text, resultsHtml, patientName…) so Smart EMR's
  // linked-records list and Lixa's Files list keep working unchanged.
  // ===========================================================================
  const KIND_PATH = { rom: 'analysisHistory', gait: 'gaitHistory', assistive: 'assistiveHistory' };
  const KIND_DOC_TYPE = { rom: 'ROM Analysis', gait: 'Gait Analysis', assistive: 'Assistive Device Assessment' };
  const cleanJson = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === undefined || (typeof v === 'number' && !isFinite(v)) ? null : v)));

  async function saveMotionRecord({ scopeUid, structured, resultsHtml, interpretationText }) {
    const kind = structured.kind;
    const MR = window.MotionReport;
    const patientName = (structured.patient && structured.patient.name) || null;
    const note = MR.clinicalNote(structured);
    const fileName = kind === 'rom' ? `ROM - ${structured.title}` : `${kind === 'gait' ? 'Gait' : 'Assistive Device'} - ${patientName || 'Patient'}`;
    const payload = {
      contentType: kind, fileName, documentType: KIND_DOC_TYPE[kind],
      request: `${KIND_DOC_TYPE[kind]}: ${structured.title || ''}`.trim(),
      // `results` stays a plain-text field: Smart EMR + Lixa read it. Measured data first, AI text clearly labelled after.
      results: note + (interpretationText ? `\n\nAI INTERPRETATION (not measured; unverified):\n${interpretationText}` : ''),
      resultsHtml: resultsHtml || null,
      clinicalNote: note,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      date: new Date().toLocaleDateString(),
      patientName, emrPatientId: (structured.patient && structured.patient.emrPatientId) || null,
      status: structured.status,
      view: (structured.prefs && structured.prefs.view) || '',
      notes: (structured.prefs && structured.prefs.notes) || '',
      measurements: (structured.measurements || []).map(m => ({ name: m.name, value: m.value, unit: m.unit, side: m.side, confidence: m.confidenceLabel })),
      measuredJointCount: (structured.measurements || []).filter(m => m.value != null).length,
      structured: cleanJson(structured)
    };
    if (kind === 'rom') { payload.assessmentMode = structured.prefs && structured.prefs.assessmentMode; payload.frameCount = structured.capture && structured.capture.quality && structured.capture.quality.trackedFrames; }
    const ref = await firebase.database().ref(`history/${scopeUid}/${KIND_PATH[kind]}`).push(cleanJson(payload));
    if (window.RehablixCenter) window.RehablixCenter.logActivity(kind === 'rom' ? 'rom' : kind, `Saved ${KIND_DOC_TYPE[kind]}`, patientName || structured.title || KIND_DOC_TYPE[kind]).catch(() => {});
    return ref.key;
  }

  async function updateMotionRecord(scopeUid, kind, id, patch) {
    await firebase.database().ref(`history/${scopeUid}/${KIND_PATH[kind]}/${id}`).update(cleanJson(patch));
  }

  // Clinician review → CONFIRMED. Only the measurements/findings left ticked
  // become part of the confirmed finding. Publishes a compact, stable record to
  // history/{scope}/clinicalMeasurements/{kind}_{id} (for Smart EMR / Lixa /
  // any future consumer) and, if the assessment was tied to an EMR patient,
  // links it into that patient's record exactly like EMR's own "Link" button.
  async function confirmMotionRecord({ scopeUid, emrScopeUid, id, structured, resultsHtml, user }) {
    const MR = window.MotionReport; const db = firebase.database();
    const kind = structured.kind;
    structured.status = 'confirmed';
    structured.confirmedAt = new Date().toISOString();
    structured.confirmedBy = (user && (user.displayName || user.email)) || 'clinician';
    const note = MR.clinicalNote(structured);
    await updateMotionRecord(scopeUid, kind, id, { structured, status: 'confirmed', confirmedAt: structured.confirmedAt, clinicalNote: note, results: note, resultsHtml: resultsHtml || null });
    const inc = (structured.measurements || []).filter(m => m.include && m.value != null);
    const published = {
      schema: 'rehablix.clinicalMeasurements.v1', sourceSchema: structured.schema, kind, kindLabel: structured.kindLabel, recordId: id, sourceNode: KIND_PATH[kind],
      patientName: (structured.patient && structured.patient.name) || null, emrPatientId: (structured.patient && structured.patient.emrPatientId) || null,
      confirmedAt: structured.confirmedAt, confirmedBy: structured.confirmedBy, method: structured.capture && structured.capture.method,
      measurements: inc.map(m => ({ id: m.id, name: m.name, value: m.value, unit: m.unit, side: m.side, plane: m.plane, method: m.method, source: m.source, reference: m.reference, confidence: m.confidence, confidenceLabel: m.confidenceLabel })),
      findings: (structured.findings || []).filter(f => f.include).map(f => ({ text: f.text, source: f.source })),
      note
    };
    await db.ref(`history/${scopeUid}/clinicalMeasurements/${kind}_${id}`).set(cleanJson(published));
    let linkedToEmr = false;
    const pid = published.emrPatientId;
    if (pid) {
      try {
        const pRef = db.ref(`history/${emrScopeUid || scopeUid}/patients/${pid}`);
        const p = (await pRef.once('value')).val();
        if (p) {
          const linked = p.linkedRecords || [];
          const dateStr = new Date(structured.confirmedAt).toLocaleDateString();
          if (!linked.some(r => r.source === KIND_PATH[kind] && r.key === id)) {
            linked.push({ source: KIND_PATH[kind], key: id, type: KIND_DOC_TYPE[kind], date: dateStr, linkedAt: structured.confirmedAt, confirmed: true });
            const block = `--- Linked from ${KIND_DOC_TYPE[kind]} (${dateStr}) — CONFIRMED ---\n${note}`;
            await pRef.update({ linkedRecords: linked, assessment: p.assessment ? `${p.assessment}\n\n${block}` : block });
          }
          linkedToEmr = true;
        }
      } catch (err) { console.warn('[Motion] EMR link failed:', err); }
    }
    return { structured, note, linkedToEmr };
  }

  // Confirmed measurements for one patient (by EMR id or name) — the read side
  // used by Smart EMR / Lixa.
  async function listConfirmed(scopeUid, { emrPatientId, patientName } = {}) {
    const snap = await firebase.database().ref(`history/${scopeUid}/clinicalMeasurements`).once('value');
    const all = Object.entries(snap.val() || {}).map(([k, v]) => Object.assign({ key: k }, v));
    const norm = (s) => String(s || '').trim().toLowerCase();
    return all.filter(r => (emrPatientId && r.emrPatientId === emrPatientId) || (patientName && norm(r.patientName) === norm(patientName))).sort((a, b) => String(b.confirmedAt).localeCompare(String(a.confirmedAt)));
  }

  window.MotionCore = {
    movementPrompts, jointGroups, JOINT_GROUP_LABELS,
    startCameraStream, stopCameraStream, captureFrameFromVideo, compressImage,
    checkImageBrightness, validateImageQuality,
    loadLiveLandmarker, warmUpPoseModel, createSampler, resultToSample,
    speak, fetchOpenAiToken, interpretMotion,
    KIND_PATH, KIND_DOC_TYPE, saveMotionRecord, updateMotionRecord, confirmMotionRecord, listConfirmed
  };
})();
