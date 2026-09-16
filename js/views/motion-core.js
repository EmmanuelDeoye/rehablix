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
  // Pose landmarking (MediaPipe) — angle measurement
  // ===========================================================================
  const JOINT_LANDMARK_MAP = {
    shoulder_flexion: ['HIP', 'SHOULDER', 'ELBOW'], shoulder_extension: ['HIP', 'SHOULDER', 'ELBOW'],
    shoulder_abduction: ['HIP', 'SHOULDER', 'ELBOW'], shoulder_adduction: ['HIP', 'SHOULDER', 'ELBOW'],
    elbow_flexion: ['SHOULDER', 'ELBOW', 'WRIST'], elbow_extension: ['SHOULDER', 'ELBOW', 'WRIST'],
    hip_flexion: ['SHOULDER', 'HIP', 'KNEE'], hip_extension: ['SHOULDER', 'HIP', 'KNEE'],
    hip_abduction: ['SHOULDER', 'HIP', 'KNEE'], hip_adduction: ['SHOULDER', 'HIP', 'KNEE'],
    knee_flexion: ['HIP', 'KNEE', 'ANKLE'], knee_extension: ['HIP', 'KNEE', 'ANKLE'],
    ankle_dorsiflexion: ['KNEE', 'ANKLE', 'FOOT_INDEX'], ankle_plantarflexion: ['KNEE', 'ANKLE', 'FOOT_INDEX']
  };
  const LANDMARK_INDEX = {
    SHOULDER: [11, 12], ELBOW: [13, 14], WRIST: [15, 16],
    HIP: [23, 24], KNEE: [25, 26], ANKLE: [27, 28], FOOT_INDEX: [31, 32]
  };

  function angleAtVertex(a, b, c) {
    const v1 = { x: a.x - b.x, y: a.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const mag1 = Math.hypot(v1.x, v1.y), mag2 = Math.hypot(v2.x, v2.y);
    if (mag1 === 0 || mag2 === 0) return null;
    const cos = Math.min(1, Math.max(-1, (v1.x * v2.x + v1.y * v2.y) / (mag1 * mag2)));
    return Math.acos(cos) * (180 / Math.PI);
  }

  let poseLandmarkerPromise = null;
  function loadPoseLandmarker() {
    if (poseLandmarkerPromise) return poseLandmarkerPromise;
    poseLandmarkerPromise = (async () => {
      try {
        const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
        const filesetResolver = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
        return await vision.PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'GPU' },
          runningMode: 'IMAGE', numPoses: 1
        });
      } catch (err) { console.warn('[Motion] Pose model failed to load:', err); return null; }
    })();
    return poseLandmarkerPromise;
  }

  let liveLandmarkerPromise = null;
  function loadLiveLandmarker() {
    if (liveLandmarkerPromise) return liveLandmarkerPromise;
    liveLandmarkerPromise = (async () => {
      try {
        const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
        const filesetResolver = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
        return await vision.PoseLandmarker.createFromOptions(filesetResolver, {
          baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'GPU' },
          runningMode: 'VIDEO', numPoses: 1
        });
      } catch (err) { console.warn('[Motion] Live pose model failed to load:', err); return null; }
    })();
    return liveLandmarkerPromise;
  }

  function currentAngleFromLandmarks(lm, movementKey) {
    const pointNames = JOINT_LANDMARK_MAP[movementKey];
    if (!pointNames || !lm) return null;
    const pick = (name, side) => lm[LANDMARK_INDEX[name][side]];
    const sideScore = (side) => pointNames.reduce((sum, name) => sum + (pick(name, side)?.visibility ?? 0), 0);
    const side = sideScore(1) >= sideScore(0) ? 1 : 0;
    const pts = pointNames.map(name => pick(name, side));
    if (pts.some(p => !p || (p.visibility !== undefined && p.visibility < 0.5))) return null;
    const angle = angleAtVertex(pts[0], pts[1], pts[2]);
    return angle === null ? null : Math.round(angle);
  }

  function loadImageEl(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  async function detectAngleInFrame(dataUrl, movementKey) {
    const pointNames = JOINT_LANDMARK_MAP[movementKey];
    if (!pointNames) return null;
    const landmarker = await loadPoseLandmarker();
    if (!landmarker) return null;
    try {
      const img = await loadImageEl(dataUrl);
      const result = landmarker.detect(img);
      if (!result?.landmarks?.length) return null;
      const lm = result.landmarks[0];
      const pick = (name, side) => lm[LANDMARK_INDEX[name][side]];
      const sideScore = (side) => pointNames.reduce((sum, name) => sum + (pick(name, side)?.visibility ?? 0), 0);
      const side = sideScore(1) >= sideScore(0) ? 1 : 0;
      const pts = pointNames.map(name => pick(name, side));
      if (pts.some(p => !p || (p.visibility !== undefined && p.visibility < 0.5))) return null;
      const angle = angleAtVertex(pts[0], pts[1], pts[2]);
      return angle === null ? null : Math.round(angle);
    } catch (err) { console.warn('[Motion] Pose detection failed on a frame:', err); return null; }
  }

  async function measureMovementROM(frames, movementKey) {
    if (!JOINT_LANDMARK_MAP[movementKey] || !frames || frames.length < 2) return { measured: false, degrees: null };
    const startAngle = await detectAngleInFrame(frames[0], movementKey);
    const endAngle = await detectAngleInFrame(frames[frames.length - 1], movementKey);
    if (startAngle === null || endAngle === null) return { measured: false, degrees: null };
    return { measured: true, degrees: Math.round(Math.abs(endAngle - startAngle)), startAngle, endAngle };
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
  // AI analysis — ROM
  // ===========================================================================
  async function analyzeROM({ aiConfig, jointDescription, movementSequenceText, framesToSend, measurements }) {
    const measurementLines = measurements.map(m => m.measured
      ? `${m.name}: ${m.degrees}° — computed from pose landmark analysis (start ${m.startAngle}° → end ${m.endAngle}°). Report this exact figure as the measured ROM; do not substitute your own visual estimate for it.`
      : `${m.name}: no reliable landmark measurement available for this joint/movement — provide your best visual estimate and clearly label it in your response as "AI visual estimate (not measured)".`
    ).join('\n');

    const systemPrompt = `You are rehablix ROM Analyzer, a clinical AI specialized in range of motion assessment for rehabilitation professionals.

IMPORTANT: First, verify that the provided images clearly show a human subject performing the specified movement (${jointDescription}). The joint/body part must be visible and adequately lit. If the images do NOT show a visible human joint (e.g., empty room, darkness, blurred, or no person), respond with exactly:
"ERROR: No joint detected in the provided images. Please ensure proper lighting and that the joint is clearly visible."
Do not provide any analysis or additional text in that case.

If a joint IS clearly visible, provide a comprehensive clinical analysis including:
1. **Range of Motion** in degrees — use the computed measurements provided below wherever available; only fall back to your own visual estimate where noted, and label those estimates explicitly
2. **Movement Quality Observations** - note any compensations, asymmetries, or deviations
3. **Comparison to Normative Values** - typical ROM for this joint
4. **Clinical Recommendations** - suggested interventions or further assessments

Format your response with clear headings (## for sections), bullet points for observations, and professional clinical language. Do NOT use tables.`;

    const userContent = `Joint/Movement: ${jointDescription}
Movement Sequence: ${movementSequenceText}

Computed measurements (from pose landmark analysis of the captured frames):
${measurementLines}

The images show the progression from start position through full range of motion. Please analyze the patient's ROM and movement quality.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [{ type: 'text', text: userContent }, ...framesToSend.map(url => ({ type: 'image_url', image_url: { url } }))] }
    ];

    const response = await fetch(`${aiConfig.endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiConfig.token}` },
      body: JSON.stringify({ model: 'gpt-4.1', messages, max_tokens: 2000, temperature: 0.3 })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (window.reportApiError) window.reportApiError({ status: response.status, bodyText: JSON.stringify(err), tool: 'rom', context: 'analyze ROM images' });
      throw new Error(err.error?.message || 'API error');
    }
    const data = await response.json();
    return { text: data.choices[0].message.content };
  }

  // ===========================================================================
  // Gait — video capture -> sampled frames -> AI analysis
  // ===========================================================================
  function extractVideoFramesFromBlob(blob, frameCount = 5) {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata'; video.muted = true; video.playsInline = true;
      const url = URL.createObjectURL(blob);
      video.src = url;
      video.onloadedmetadata = async () => {
        try {
          const duration = video.duration;
          const canvas = document.createElement('canvas');
          canvas.width = Math.min(video.videoWidth, 960) || 640;
          canvas.height = Math.round(canvas.width * (video.videoHeight / video.videoWidth || 0.5625));
          const ctx = canvas.getContext('2d');
          const frames = [];
          for (let i = 0; i < frameCount; i++) {
            const t = (duration / (frameCount + 1)) * (i + 1);
            await new Promise((res) => { video.currentTime = t; video.onseeked = res; });
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            frames.push(canvas.toDataURL('image/jpeg', 0.8));
          }
          URL.revokeObjectURL(url);
          resolve(frames);
        } catch (err) { URL.revokeObjectURL(url); reject(err); }
      };
      video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('video load failed')); };
    });
  }

  async function analyzeGait({ aiConfig, frames, patientName, view, notes }) {
    const systemPrompt = `You are rehablix Gait Monitor, a clinical AI specialized in gait analysis for rehabilitation professionals.

IMPORTANT: First verify the provided frames clearly show a person walking/moving. If not (empty scene, too dark, no person visible), respond with exactly:
"ERROR: No gait pattern detected in the provided video. Please ensure proper lighting and that the full body is visible while walking."

If a person IS visible, provide a clinical gait analysis covering:
1. **Observed Gait Pattern** — overall description of the walking pattern
2. **Key Deviations** — stride/cadence, arm swing, pelvic tilt, foot clearance, trunk stability
3. **Likely Impairments** — what these deviations may suggest clinically
4. **Clinical Recommendations** — suggested interventions or further assessment

Format with ## headings and bullet points. Do NOT use tables.`;

    const userText = `View: ${view || 'Not specified'}
Patient: ${patientName || 'Not specified'}
Notes: ${notes || 'None'}

These frames are sampled evenly across a walking video. Please analyze the gait pattern.`;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [{ type: 'text', text: userText }, ...frames.map(url => ({ type: 'image_url', image_url: { url } }))] }
    ];

    const response = await fetch(`${aiConfig.endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiConfig.token}` },
      body: JSON.stringify({ model: 'gpt-4.1', messages, max_tokens: 2000, temperature: 0.3 })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (window.reportApiError) window.reportApiError({ status: response.status, bodyText: JSON.stringify(err), tool: 'gait', context: 'analyze gait video' });
      throw new Error(err.error?.message || 'API error');
    }
    const data = await response.json();
    return { text: data.choices[0].message.content };
  }

  // ===========================================================================
  // History
  // ===========================================================================
  async function saveRomToHistory({ scopeUid, result, measurements, jointName, assessmentMode, frameCount, patientName }) {
    const measuredCount = (measurements || []).filter(m => m.measured).length;
    const ref = await firebase.database().ref(`history/${scopeUid}/analysisHistory`).push({
      contentType: 'rom',
      fileName: `ROM - ${jointName}`,
      documentType: 'ROM Analysis',
      request: `Analyze ${jointName} range of motion from ${frameCount} captured frames`,
      results: result,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      date: new Date().toLocaleDateString(),
      frameCount,
      assessmentMode,
      patientName: patientName || null,
      measurements: measurements || [],
      measuredJointCount: measuredCount
    });
    if (window.RehablixCenter) window.RehablixCenter.logActivity('rom', 'Saved ROM analysis', patientName || jointName).catch(() => {});
    return ref.key;
  }

  async function saveGaitToHistory({ scopeUid, result, patientName, view, notes }) {
    const ref = await firebase.database().ref(`history/${scopeUid}/gaitHistory`).push({
      contentType: 'gait',
      fileName: `Gait - ${patientName || 'Patient'}`,
      documentType: 'Gait Analysis',
      request: `Analyze gait pattern (${view || 'view not specified'})`,
      results: result,
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      date: new Date().toLocaleDateString(),
      patientName: patientName || '',
      view: view || '',
      notes: notes || ''
    });
    if (window.RehablixCenter) window.RehablixCenter.logActivity('gait', 'Saved gait analysis', patientName || 'Gait analysis').catch(() => {});
    return ref.key;
  }

  window.MotionCore = {
    movementPrompts, jointGroups, JOINT_GROUP_LABELS, JOINT_LANDMARK_MAP,
    startCameraStream, stopCameraStream, captureFrameFromVideo, compressImage,
    checkImageBrightness, validateImageQuality,
    loadPoseLandmarker, loadLiveLandmarker, currentAngleFromLandmarks, detectAngleInFrame, measureMovementROM,
    speak, fetchOpenAiToken, analyzeROM, analyzeGait, extractVideoFramesFromBlob,
    saveRomToHistory, saveGaitToHistory
  };
})();
