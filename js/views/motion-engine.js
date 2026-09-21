// js/views/motion-engine.js — measurement engine for the Motion page.
//
// PURE computation: no DOM, no Firebase, no network. Everything here takes
// plain landmark samples in and returns plain measurement objects out, so it
// can be unit-tested with synthetic body motion (see the project's test
// notes) and reused by any tool that needs the same numbers.
//
// INPUT — a "sample" is one tracked video frame:
//   { t: seconds, world: [33 × {x,y,z}] (metres, hip-centred, MediaPipe
//     BlazePose 3D world landmarks), img: [33 × {x,y}] (normalised image
//     coords), vis: [33 × 0..1 visibility], aspect: width/height }
//
// DESIGN RULES (clinical reliability):
//  * Angles are computed in 3D from world landmarks against an anatomical
//    body frame built from the subject's own hips/shoulders — not from 2D
//    pixel geometry — and referenced to anatomical neutral (0°).
//  * Laterality comes from the model's anatomical LEFT/RIGHT landmarks and is
//    either user-specified or auto-detected from which limb actually moved;
//    it is never guessed from "which side looks clearer".
//  * Every measurement carries its method, reference, source and a
//    confidence built from landmark visibility, frame coverage, camera-view
//    suitability, movement-plane adherence, range and signal noise.
//    Below the reliability threshold a value is flagged and NOT presented as
//    a precise measurement.
//  * Nothing is invented: if a quantity cannot be derived from the data the
//    function returns null / a flag, never a plausible-looking number.
(function () {
  const ME = (typeof window !== 'undefined' ? (window.MotionEngine = window.MotionEngine || {}) : {});

  const RAD = 180 / Math.PI;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ------------------------------------------------------------------ vectors
  const V = {
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
    mul: (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k }),
    dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
    cross: (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
    len: (a) => Math.hypot(a.x, a.y, a.z),
    unit: (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; },
    mid: (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 }),
    dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  };
  ME.V = V;

  function angleBetween(a, b) {
    const la = V.len(a), lb = V.len(b);
    if (!la || !lb) return null;
    return Math.acos(clamp(V.dot(a, b) / (la * lb), -1, 1)) * RAD;
  }

  // ------------------------------------------------------------------ stats
  function median(arr) {
    const a = arr.filter(v => v != null && isFinite(v)).sort((x, y) => x - y);
    if (!a.length) return null;
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function mean(arr) { const a = arr.filter(v => v != null && isFinite(v)); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; }
  function sd(arr) {
    const a = arr.filter(v => v != null && isFinite(v));
    if (a.length < 2) return null;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
  }
  function percentile(arr, p) {
    const a = arr.filter(v => v != null && isFinite(v)).sort((x, y) => x - y);
    if (!a.length) return null;
    const i = clamp((a.length - 1) * p, 0, a.length - 1);
    const lo = Math.floor(i), hi = Math.ceil(i);
    return a[lo] + (a[hi] - a[lo]) * (i - lo);
  }
  // Moving average that skips nulls (occluded frames).
  function smooth(arr, win) {
    const h = Math.max(1, win >> 1);
    return arr.map((_, i) => {
      let s = 0, n = 0;
      for (let k = Math.max(0, i - h); k <= Math.min(arr.length - 1, i + h); k++) if (arr[k] != null) { s += arr[k]; n++; }
      return n ? s / n : null;
    });
  }
  function medianFilter(arr, win) {
    const h = Math.max(1, win >> 1);
    return arr.map((v, i) => {
      if (v == null) return null;
      const w = [];
      for (let k = Math.max(0, i - h); k <= Math.min(arr.length - 1, i + h); k++) if (arr[k] != null) w.push(arr[k]);
      return median(w);
    });
  }
  function estimateFps(samples) {
    if (!samples || samples.length < 3) return 0;
    const dts = [];
    for (let i = 1; i < samples.length; i++) { const d = samples[i].t - samples[i - 1].t; if (d > 0) dts.push(d); }
    const m = median(dts);
    return m ? 1 / m : 0;
  }
  // Sliding-window median extreme: ignores single-frame landmark spikes.
  function robustExtreme(vals, dir, win) {
    let best = null, bestIdx = -1;
    for (let i = 0; i + win <= vals.length; i++) {
      const w = vals.slice(i, i + win);
      if (w.some(v => v == null)) continue;
      const m = median(w);
      if (best === null || (dir > 0 ? m > best : m < best)) { best = m; bestIdx = i + (win >> 1); }
    }
    return { value: best, index: bestIdx };
  }
  function findPeaks(arr, minDist, minProm, sign) {
    // sign +1 → maxima, -1 → minima. Prominence = height above the higher of the two flanking minima within minDist.
    const a = arr.map(v => (v == null ? null : v * sign));
    const cand = [];
    for (let i = 1; i < a.length - 1; i++) {
      if (a[i] == null || a[i - 1] == null || a[i + 1] == null) continue;
      if (a[i] > a[i - 1] && a[i] >= a[i + 1]) {
        let lMin = a[i], rMin = a[i];
        for (let k = i; k >= Math.max(0, i - minDist); k--) if (a[k] != null) lMin = Math.min(lMin, a[k]);
        for (let k = i; k <= Math.min(a.length - 1, i + minDist); k++) if (a[k] != null) rMin = Math.min(rMin, a[k]);
        const prom = a[i] - Math.max(lMin, rMin);
        if (prom >= minProm) cand.push({ i, v: a[i] });
      }
    }
    cand.sort((p, q) => q.v - p.v);
    const kept = [];
    cand.forEach(c => { if (!kept.some(k => Math.abs(k.i - c.i) < minDist)) kept.push(c); });
    return kept.map(k => k.i).sort((p, q) => p - q);
  }
  Object.assign(ME, { median, mean, sd, percentile, smooth, medianFilter, estimateFps, robustExtreme, findPeaks, angleBetween, clamp });

  // ------------------------------------------------------------------ landmarks
  const LM = { NOSE: 0, L_EAR: 7, R_EAR: 8, L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14, L_WRIST: 15, R_WRIST: 16,
    L_PINKY: 17, R_PINKY: 18, L_INDEX: 19, R_INDEX: 20, L_THUMB: 21, R_THUMB: 22, L_HIP: 23, R_HIP: 24, L_KNEE: 25, R_KNEE: 26,
    L_ANKLE: 27, R_ANKLE: 28, L_HEEL: 29, R_HEEL: 30, L_FOOT: 31, R_FOOT: 32 };
  ME.LM = LM;
  // Anatomical side → landmark index for a named point.
  function idx(name, side) { return LM[(side === 'left' ? 'L_' : 'R_') + name]; }
  ME.idx = idx;
  const wp = (f, name, side) => f.world[idx(name, side)];

  // Reference-frame builder. `hand` (+1/-1) resolves the handedness of the
  // model's world axes once per capture (see resolveHandedness) so anterior
  // is always anterior.
  function bodyFrame(f, hand) {
    const w = f.world;
    const midHip = V.mid(w[LM.L_HIP], w[LM.R_HIP]);
    const midSh = V.mid(w[LM.L_SHOULDER], w[LM.R_SHOULDER]);
    const up = V.unit(V.sub(midSh, midHip));
    let lat = V.sub(w[LM.L_HIP], w[LM.R_HIP]); // → subject's LEFT (anatomical, from the model's L/R labels)
    lat = V.unit(V.sub(lat, V.mul(up, V.dot(lat, up))));
    const ant = V.mul(V.unit(V.cross(lat, up)), hand || 1);
    return { up, lat, ant, midHip, midSh, trunkLen: V.len(V.sub(midSh, midHip)) };
  }
  ME.bodyFrame = bodyFrame;

  // Which way is "forward" in this capture's coordinate system? Decided
  // from anatomy (nose ahead of the ears, toes ahead of the heels) over the
  // first frames, then held constant so it can't flip frame to frame.
  function resolveHandedness(samples) {
    let score = 0;
    samples.slice(0, 60).forEach(f => {
      if (!f.world) return;
      const w = f.world;
      const raw = bodyFrame(f, 1);
      const nose = V.sub(w[LM.NOSE], V.mid(w[LM.L_EAR], w[LM.R_EAR]));
      const toes = V.sub(V.mid(w[LM.L_FOOT], w[LM.R_FOOT]), V.mid(w[LM.L_HEEL], w[LM.R_HEEL]));
      score += V.dot(raw.ant, nose) + V.dot(raw.ant, toes);
    });
    return score < 0 ? -1 : 1;
  }
  ME.resolveHandedness = resolveHandedness;

  // Camera-view yaw of the subject: 0° = facing/away from the camera
  // (frontal), 90° = side-on (sagittal). From the shoulder/hip line.
  function viewYaw(f) {
    const l = V.sub(f.world[LM.L_HIP], f.world[LM.R_HIP]);
    const s = V.sub(f.world[LM.L_SHOULDER], f.world[LM.R_SHOULDER]);
    const v = V.add(l, s);
    return Math.atan2(Math.abs(v.z), Math.abs(v.x)) * RAD;
  }
  ME.viewYaw = viewYaw;

  const outAxis = (fr, side) => (side === 'left' ? fr.lat : V.mul(fr.lat, -1)); // away from the midline
  const sagAngle = (v, fr) => Math.atan2(V.dot(v, fr.ant), -V.dot(v, fr.up)) * RAD;             // 0 = hanging down, + = anterior
  const frontAngle = (v, fr, side) => Math.atan2(V.dot(v, outAxis(fr, side)), -V.dot(v, fr.up)) * RAD; // + = away from midline
  const trunkVec = (f) => V.sub(V.mid(f.world[LM.L_SHOULDER], f.world[LM.R_SHOULDER]), V.mid(f.world[LM.L_HIP], f.world[LM.R_HIP]));

  // ------------------------------------------------------------------ movement catalogue
  // sig(f, side, ctx) → degrees in the anatomical convention (0 = neutral).
  //  dir   +1: the movement's value is the MAXIMUM of the signal, -1: the MINIMUM
  //  basis 'neutral' → ROM is the end angle from anatomical zero;
  //        'start'   → ROM is the excursion from where the movement began.
  //  plane the plane the movement happens in; view = camera view that shows it best
  //  cap   ceiling on confidence for this landmark set (honest limit of pose tracking)
  //  norm  reference range (AAOS / Norkin & White, adult active ROM)
  const AAOS = 'AAOS / Norkin & White (adult normative)';
  const upperLm = ['SHOULDER', 'ELBOW', 'WRIST'];
  const MOVEMENTS = {
    shoulder_flexion: { joint: 'shoulder', plane: 'sagittal', view: 'side', dir: 1, basis: 'neutral', norm: 180, cap: 1, lm: ['SHOULDER', 'ELBOW'], group: 'upper',
      method: 'Humerus (shoulder→elbow) vs trunk long axis, projected on the sagittal plane, 3D world landmarks',
      sig: (f, s, c) => sagAngle(V.sub(wp(f, 'ELBOW', s), wp(f, 'SHOULDER', s)), c.fr),
      off: (f, s, c) => Math.abs(V.dot(V.unit(V.sub(wp(f, 'ELBOW', s), wp(f, 'SHOULDER', s))), c.fr.lat)) },
    shoulder_extension: { joint: 'shoulder', plane: 'sagittal', view: 'side', dir: -1, basis: 'neutral', norm: 60, cap: 1, lm: ['SHOULDER', 'ELBOW'], group: 'upper', flip: true,
      method: 'Humerus vs trunk long axis, sagittal plane, 3D world landmarks',
      sig: (f, s, c) => sagAngle(V.sub(wp(f, 'ELBOW', s), wp(f, 'SHOULDER', s)), c.fr),
      off: (f, s, c) => Math.abs(V.dot(V.unit(V.sub(wp(f, 'ELBOW', s), wp(f, 'SHOULDER', s))), c.fr.lat)) },
    shoulder_abduction: { joint: 'shoulder', plane: 'frontal', view: 'front', dir: 1, basis: 'neutral', norm: 180, cap: 1, lm: ['SHOULDER', 'ELBOW'], group: 'upper',
      method: 'Humerus vs trunk long axis, projected on the frontal plane, 3D world landmarks',
      sig: (f, s, c) => frontAngle(V.sub(wp(f, 'ELBOW', s), wp(f, 'SHOULDER', s)), c.fr, s),
      off: (f, s, c) => Math.abs(V.dot(V.unit(V.sub(wp(f, 'ELBOW', s), wp(f, 'SHOULDER', s))), c.fr.ant)) },
    shoulder_adduction: { joint: 'shoulder', plane: 'frontal', view: 'front', dir: -1, basis: 'neutral', norm: 30, cap: 1, lm: ['SHOULDER', 'ELBOW'], group: 'upper', flip: true,
      method: 'Humerus vs trunk long axis, frontal plane (negative = across the midline), 3D world landmarks',
      sig: (f, s, c) => frontAngle(V.sub(wp(f, 'ELBOW', s), wp(f, 'SHOULDER', s)), c.fr, s),
      off: (f, s, c) => Math.abs(V.dot(V.unit(V.sub(wp(f, 'ELBOW', s), wp(f, 'SHOULDER', s))), c.fr.ant)) },
    shoulder_internal_rotation: { joint: 'shoulder', plane: 'transverse', view: 'front', dir: -1, basis: 'neutral', norm: 70, cap: 0.55, lm: ['SHOULDER', 'ELBOW', 'WRIST'], group: 'upper', flip: true,
      method: 'Forearm (elbow→wrist, elbow at ~90°) rotation in the transverse plane relative to anterior; depth (z) estimate limits accuracy',
      sig: (f, s, c) => { const v = V.sub(wp(f, 'WRIST', s), wp(f, 'ELBOW', s)); return Math.atan2(V.dot(v, outAxis(c.fr, s)), V.dot(v, c.fr.ant)) * RAD; } },
    shoulder_external_rotation: { joint: 'shoulder', plane: 'transverse', view: 'front', dir: 1, basis: 'neutral', norm: 90, cap: 0.55, lm: ['SHOULDER', 'ELBOW', 'WRIST'], group: 'upper',
      method: 'Forearm rotation in the transverse plane relative to anterior; depth (z) estimate limits accuracy',
      sig: (f, s, c) => { const v = V.sub(wp(f, 'WRIST', s), wp(f, 'ELBOW', s)); return Math.atan2(V.dot(v, outAxis(c.fr, s)), V.dot(v, c.fr.ant)) * RAD; } },
    elbow_flexion: { joint: 'elbow', plane: 'sagittal', view: 'side', dir: 1, basis: 'neutral', norm: 150, cap: 1, lm: upperLm, group: 'upper',
      method: '180° − interior angle between upper arm and forearm (3-point 3D angle at the elbow)',
      sig: (f, s) => 180 - angleBetween(V.sub(wp(f, 'SHOULDER', s), wp(f, 'ELBOW', s)), V.sub(wp(f, 'WRIST', s), wp(f, 'ELBOW', s))) },
    elbow_extension: { joint: 'elbow', plane: 'sagittal', view: 'side', dir: -1, basis: 'start', norm: 150, cap: 1, lm: upperLm, group: 'upper', terminalNorm: 0,
      method: 'Excursion of (180° − interior elbow angle) from the flexed start to end range; 0° = full extension',
      sig: (f, s) => 180 - angleBetween(V.sub(wp(f, 'SHOULDER', s), wp(f, 'ELBOW', s)), V.sub(wp(f, 'WRIST', s), wp(f, 'ELBOW', s))) },
    wrist_flexion: { joint: 'wrist', plane: 'sagittal', view: 'side', dir: 1, basis: 'neutral', norm: 80, cap: 0.5, lm: ['ELBOW', 'WRIST', 'INDEX'], group: 'upper', magnitudeOnly: true,
      method: 'Angle between forearm and hand axis (wrist→index/pinky); pose model has no finger joints so this is indicative only',
      sig: (f, s) => handDeviation(f, s) },
    wrist_extension: { joint: 'wrist', plane: 'sagittal', view: 'side', dir: 1, basis: 'neutral', norm: 70, cap: 0.5, lm: ['ELBOW', 'WRIST', 'INDEX'], group: 'upper', magnitudeOnly: true,
      method: 'Angle between forearm and hand axis; indicative only (no finger joints in the pose model)', sig: (f, s) => handDeviation(f, s) },
    wrist_radial_deviation: { joint: 'wrist', plane: 'frontal', view: 'front', dir: 1, basis: 'neutral', norm: 20, cap: 0.5, lm: ['ELBOW', 'WRIST', 'INDEX'], group: 'upper', magnitudeOnly: true,
      method: 'Angle between forearm and hand axis; indicative only', sig: (f, s) => handDeviation(f, s) },
    wrist_ulnar_deviation: { joint: 'wrist', plane: 'frontal', view: 'front', dir: 1, basis: 'neutral', norm: 30, cap: 0.5, lm: ['ELBOW', 'WRIST', 'INDEX'], group: 'upper', magnitudeOnly: true,
      method: 'Angle between forearm and hand axis; indicative only', sig: (f, s) => handDeviation(f, s) },
    hip_flexion: { joint: 'hip', plane: 'sagittal', view: 'side', dir: 1, basis: 'neutral', norm: 120, cap: 1, lm: ['HIP', 'KNEE'], group: 'lower',
      method: 'Femur (hip→knee) vs trunk long axis, sagittal plane, 3D world landmarks (measured against the trunk, not the room)',
      sig: (f, s, c) => sagAngle(V.sub(wp(f, 'KNEE', s), wp(f, 'HIP', s)), c.fr),
      off: (f, s, c) => Math.abs(V.dot(V.unit(V.sub(wp(f, 'KNEE', s), wp(f, 'HIP', s))), c.fr.lat)) },
    hip_extension: { joint: 'hip', plane: 'sagittal', view: 'side', dir: -1, basis: 'neutral', norm: 30, cap: 1, lm: ['HIP', 'KNEE'], group: 'lower', flip: true,
      method: 'Femur vs trunk long axis, sagittal plane, 3D world landmarks',
      sig: (f, s, c) => sagAngle(V.sub(wp(f, 'KNEE', s), wp(f, 'HIP', s)), c.fr),
      off: (f, s, c) => Math.abs(V.dot(V.unit(V.sub(wp(f, 'KNEE', s), wp(f, 'HIP', s))), c.fr.lat)) },
    hip_abduction: { joint: 'hip', plane: 'frontal', view: 'front', dir: 1, basis: 'neutral', norm: 45, cap: 1, lm: ['HIP', 'KNEE'], group: 'lower',
      method: 'Femur vs trunk long axis, frontal plane, 3D world landmarks',
      sig: (f, s, c) => frontAngle(V.sub(wp(f, 'KNEE', s), wp(f, 'HIP', s)), c.fr, s),
      off: (f, s, c) => Math.abs(V.dot(V.unit(V.sub(wp(f, 'KNEE', s), wp(f, 'HIP', s))), c.fr.ant)) },
    hip_adduction: { joint: 'hip', plane: 'frontal', view: 'front', dir: -1, basis: 'neutral', norm: 30, cap: 1, lm: ['HIP', 'KNEE'], group: 'lower', flip: true,
      method: 'Femur vs trunk long axis, frontal plane (negative = across the midline), 3D world landmarks',
      sig: (f, s, c) => frontAngle(V.sub(wp(f, 'KNEE', s), wp(f, 'HIP', s)), c.fr, s),
      off: (f, s, c) => Math.abs(V.dot(V.unit(V.sub(wp(f, 'KNEE', s), wp(f, 'HIP', s))), c.fr.ant)) },
    hip_internal_rotation: { joint: 'hip', plane: 'frontal', view: 'front', dir: 1, basis: 'neutral', norm: 45, cap: 0.5, lm: ['HIP', 'KNEE', 'ANKLE'], group: 'lower',
      method: 'Lower-leg swing in the frontal plane with the knee at 90° (foot moves outward = internal rotation); indirect, low accuracy',
      sig: (f, s, c) => frontAngle(V.sub(wp(f, 'ANKLE', s), wp(f, 'KNEE', s)), c.fr, s) },
    hip_external_rotation: { joint: 'hip', plane: 'frontal', view: 'front', dir: -1, basis: 'neutral', norm: 45, cap: 0.5, lm: ['HIP', 'KNEE', 'ANKLE'], group: 'lower', flip: true,
      method: 'Lower-leg swing in the frontal plane with the knee at 90° (foot moves inward = external rotation); indirect, low accuracy',
      sig: (f, s, c) => frontAngle(V.sub(wp(f, 'ANKLE', s), wp(f, 'KNEE', s)), c.fr, s) },
    knee_flexion: { joint: 'knee', plane: 'sagittal', view: 'side', dir: 1, basis: 'neutral', norm: 135, cap: 1, lm: ['HIP', 'KNEE', 'ANKLE'], group: 'lower',
      method: '180° − interior angle between femur and tibia (3-point 3D angle at the knee)',
      sig: (f, s) => 180 - angleBetween(V.sub(wp(f, 'HIP', s), wp(f, 'KNEE', s)), V.sub(wp(f, 'ANKLE', s), wp(f, 'KNEE', s))) },
    knee_extension: { joint: 'knee', plane: 'sagittal', view: 'side', dir: -1, basis: 'start', norm: 135, cap: 1, lm: ['HIP', 'KNEE', 'ANKLE'], group: 'lower',
      method: 'Excursion of (180° − interior knee angle) from the flexed start to end range; 0° = full extension',
      sig: (f, s) => 180 - angleBetween(V.sub(wp(f, 'HIP', s), wp(f, 'KNEE', s)), V.sub(wp(f, 'ANKLE', s), wp(f, 'KNEE', s))) },
    ankle_dorsiflexion: { joint: 'ankle', plane: 'sagittal', view: 'side', dir: 1, basis: 'neutral', norm: 20, cap: 0.8, lm: ['KNEE', 'ANKLE', 'HEEL', 'FOOT'], group: 'lower',
      method: '90° − angle between tibia (knee→ankle) and foot (heel→toe); foot landmarks are close together so noise is amplified',
      sig: (f, s) => 90 - angleBetween(V.sub(wp(f, 'KNEE', s), wp(f, 'ANKLE', s)), V.sub(wp(f, 'FOOT', s), wp(f, 'HEEL', s))) },
    ankle_plantarflexion: { joint: 'ankle', plane: 'sagittal', view: 'side', dir: -1, basis: 'neutral', norm: 50, cap: 0.8, lm: ['KNEE', 'ANKLE', 'HEEL', 'FOOT'], group: 'lower', flip: true,
      method: 'Angle between tibia and foot vs 90° neutral; foot landmarks are close together so noise is amplified',
      sig: (f, s) => 90 - angleBetween(V.sub(wp(f, 'KNEE', s), wp(f, 'ANKLE', s)), V.sub(wp(f, 'FOOT', s), wp(f, 'HEEL', s))) },
    cervical_flexion: { joint: 'cervical', plane: 'sagittal', view: 'side', dir: 1, basis: 'neutral', norm: 45, cap: 0.8, lm: ['EAR', 'SHOULDER'], group: 'spine', bilateral: true,
      method: 'Head axis (mid-shoulder→mid-ear) vs trunk axis, sagittal plane; landmark-based, not an inclinometer',
      sig: (f, s, c) => { const e = V.sub(V.mid(f.world[LM.L_EAR], f.world[LM.R_EAR]), c.fr.midSh); return Math.atan2(V.dot(e, c.fr.ant), V.dot(e, c.fr.up)) * RAD; } },
    cervical_extension: { joint: 'cervical', plane: 'sagittal', view: 'side', dir: -1, basis: 'neutral', norm: 45, cap: 0.8, lm: ['EAR', 'SHOULDER'], group: 'spine', bilateral: true, flip: true,
      method: 'Head axis vs trunk axis, sagittal plane; landmark-based',
      sig: (f, s, c) => { const e = V.sub(V.mid(f.world[LM.L_EAR], f.world[LM.R_EAR]), c.fr.midSh); return Math.atan2(V.dot(e, c.fr.ant), V.dot(e, c.fr.up)) * RAD; } },
    cervical_rotation: { joint: 'cervical', plane: 'transverse', view: 'front', dir: 1, basis: 'neutral', norm: 60, cap: 0.7, lm: ['EAR', 'SHOULDER'], group: 'spine', bilateral: true, bidirectional: ['right', 'left'],
      method: 'Rotation of the ear-to-ear line in the transverse plane relative to the shoulder girdle (value + = left, − = right)',
      sig: (f, s, c) => { const h = V.sub(f.world[LM.L_EAR], f.world[LM.R_EAR]); return Math.atan2(-V.dot(h, c.fr.ant), V.dot(h, c.fr.lat)) * RAD; } },
    cervical_lateral_flexion: { joint: 'cervical', plane: 'frontal', view: 'front', dir: 1, basis: 'neutral', norm: 45, cap: 0.8, lm: ['EAR', 'SHOULDER'], group: 'spine', bilateral: true, bidirectional: ['right', 'left'],
      method: 'Head axis vs trunk axis, frontal plane (value + = left, − = right)',
      sig: (f, s, c) => { const e = V.sub(V.mid(f.world[LM.L_EAR], f.world[LM.R_EAR]), c.fr.midSh); return Math.atan2(V.dot(e, c.fr.lat), V.dot(e, c.fr.up)) * RAD; } },
    lumbar_flexion: { joint: 'trunk', plane: 'sagittal', view: 'side', dir: 1, basis: 'neutral', norm: 60, cap: 0.75, lm: ['SHOULDER', 'HIP'], group: 'trunk', bilateral: true, refStart: true,
      method: 'Trunk (mid-hip→mid-shoulder) inclination vs its starting orientation, sagittal plane. Whole-trunk measure — NOT lumbar-segment specific (hip hinge included)',
      sig: (f, s, c) => { const u = trunkVec(f); return Math.atan2(V.dot(u, c.ref.ant), V.dot(u, c.ref.up)) * RAD; } },
    lumbar_extension: { joint: 'trunk', plane: 'sagittal', view: 'side', dir: -1, basis: 'neutral', norm: 25, cap: 0.75, lm: ['SHOULDER', 'HIP'], group: 'trunk', bilateral: true, refStart: true, flip: true,
      method: 'Trunk inclination vs its starting orientation, sagittal plane. Whole-trunk measure — NOT lumbar-segment specific',
      sig: (f, s, c) => { const u = trunkVec(f); return Math.atan2(V.dot(u, c.ref.ant), V.dot(u, c.ref.up)) * RAD; } },
    lumbar_lateral_flexion: { joint: 'trunk', plane: 'frontal', view: 'front', dir: 1, basis: 'neutral', norm: 25, cap: 0.75, lm: ['SHOULDER', 'HIP'], group: 'trunk', bilateral: true, refStart: true, bidirectional: ['right', 'left'],
      method: 'Trunk inclination vs its starting orientation, frontal plane (+ = left, − = right). Whole-trunk measure — NOT lumbar-segment specific',
      sig: (f, s, c) => { const u = trunkVec(f); return Math.atan2(V.dot(u, c.ref.lat), V.dot(u, c.ref.up)) * RAD; } },
    finger_flexion: { joint: 'hand', measurable: false }, finger_extension: { joint: 'hand', measurable: false },
    thumb_abduction: { joint: 'hand', measurable: false }, thumb_opposition: { joint: 'hand', measurable: false }
  };
  function handDeviation(f, s) {
    const fore = V.sub(wp(f, 'WRIST', s), wp(f, 'ELBOW', s));
    const hand = V.sub(V.mid(wp(f, 'INDEX', s), wp(f, 'PINKY', s)), wp(f, 'WRIST', s));
    return angleBetween(fore, hand);
  }
  ME.MOVEMENTS = MOVEMENTS;

  // Landmark-name list → world/vis indices for one side (or both ears etc.).
  function lmIndices(names, side) {
    const out = [];
    names.forEach(n => {
      if (n === 'EAR') out.push(LM.L_EAR, LM.R_EAR);
      else if (n === 'SHOULDER' && !side) out.push(LM.L_SHOULDER, LM.R_SHOULDER);
      else if (n === 'HIP' && !side) out.push(LM.L_HIP, LM.R_HIP);
      else if (side) out.push(idx(n, side));
      else out.push(idx(n, 'left'), idx(n, 'right'));
    });
    return out;
  }
  // Frame visibility for the landmarks a movement needs: the WORST of them.
  function frameVis(f, names, side) {
    const ids = lmIndices(names, side);
    // torso landmarks are always required to build the body frame
    ['L_SHOULDER', 'R_SHOULDER', 'L_HIP', 'R_HIP'].forEach(k => ids.push(LM[k]));
    let m = 1;
    ids.forEach(i => { const v = f.vis ? f.vis[i] : 1; if (v == null) return; if (v < m) m = v; });
    return m;
  }
  ME.frameVis = frameVis;

  // ------------------------------------------------------------------ confidence
  const CONF_LABELS = [[0.8, 'High'], [0.6, 'Moderate'], [0.4, 'Low'], [0, 'Unreliable']];
  function confLabel(c) { return CONF_LABELS.find(([t]) => c >= t)[1]; }
  ME.confLabel = confLabel;
  const RELIABLE_MIN = 0.4;
  ME.RELIABLE_MIN = RELIABLE_MIN;

  function viewSuitability(plane, yaw) {
    // sagittal movements need a side-on view; frontal/transverse need a front/back view.
    const want = plane === 'sagittal' ? [60, 90] : [0, 35];
    const mismatch = yaw < want[0] ? want[0] - yaw : yaw > want[1] ? yaw - want[1] : 0;
    return { mismatch, q: clamp(1 - mismatch / 60, 0.25, 1) };
  }

  // ------------------------------------------------------------------ ROM analysis
  function movementSignal(samples, def, side, ctxBase) {
    return samples.map(f => {
      if (!f.world) return { v: null, vis: 0 };
      const vis = frameVis(f, def.lm, def.bilateral ? null : side);
      if (vis < 0.5) return { v: null, vis };
      const fr = bodyFrame(f, ctxBase.hand);
      let v = def.sig(f, side, { fr, ref: ctxBase.ref });
      if (v == null || !isFinite(v)) return { v: null, vis };
      return { v, vis, fr, off: def.off ? def.off(f, side, { fr, ref: ctxBase.ref }) : null };
    });
  }

  // Compensation screening relative to the starting posture. Thresholds are
  // screening heuristics, reported with their values so the clinician can judge.
  const COMP_LIMITS = { trunk_lean_sagittal: 10, trunk_lean_frontal: 8, shoulder_hike: 8, pelvic_obliquity: 7 };
  function compensations(samples, def, side, ref, hand) {
    const rows = [];
    const trunkAng = (f, axis) => { const u = trunkVec(f); return Math.atan2(V.dot(u, ref[axis]), V.dot(u, ref.up)) * RAD; };
    const roll = (a, b, f) => { const d = V.sub(f.world[a], f.world[b]); return Math.atan2(V.dot(d, ref.up), V.dot(d, ref.lat)) * RAD; };
    const valid = samples.filter(f => f.world);
    const startN = Math.max(3, Math.round(valid.length * 0.1));
    const base = (fn) => median(valid.slice(0, startN).map(fn));
    const maxDelta = (fn) => { const b = base(fn); let m = 0; valid.forEach(f => { const d = Math.abs(fn(f) - b); if (d > m) m = d; }); return Math.round(m * 10) / 10; };
    const push = (id, label, val, unit) => rows.push({ id, label, max: val, unit, threshold: COMP_LIMITS[id], flagged: val > COMP_LIMITS[id] });
    if (def.group === 'upper' || def.group === 'lower' || def.group === 'spine') {
      push('trunk_lean_sagittal', 'Trunk lean (forward/back)', maxDelta(f => trunkAng(f, 'ant')), '°');
      push('trunk_lean_frontal', 'Trunk lean (sideways)', maxDelta(f => trunkAng(f, 'lat')), '°');
    }
    if (def.group === 'upper' || def.group === 'spine') {
      const shoulderRoll = maxDelta(f => roll(LM.L_SHOULDER, LM.R_SHOULDER, f));
      push('shoulder_hike', 'Shoulder-line tilt / hiking', shoulderRoll, '°');
    }
    if (def.group === 'lower') push('pelvic_obliquity', 'Pelvic obliquity (hip hike / drop)', maxDelta(f => roll(LM.L_HIP, LM.R_HIP, f)), '°');
    return rows;
  }

  // Analyse one movement over the whole recorded trajectory.
  //  opts: { side: 'left'|'right'|'auto'|'both', fps? }
  function analyzeROM(samples, movementKey, opts) {
    opts = opts || {};
    const def = MOVEMENTS[movementKey];
    const name = (opts.name) || movementKey;
    const flags = [];
    if (!def) return { key: movementKey, name, measurements: [], flags: ['UNKNOWN_MOVEMENT'], reliable: false };
    if (def.measurable === false) {
      return { key: movementKey, name, measurable: false, measurements: [], flags: ['NOT_INSTRUMENT_MEASURABLE'], reliable: false,
        note: 'The pose model has no finger/thumb joints, so this movement cannot be measured from video. Measure with a finger goniometer and record it manually.' };
    }
    const usable = samples.filter(f => f.world);
    if (usable.length < 8) return { key: movementKey, name, measurements: [], flags: ['TOO_FEW_FRAMES'], reliable: false, note: 'Fewer than 8 tracked frames — the capture was too short or the body was not detected.' };

    const hand = resolveHandedness(usable);
    const startN = Math.max(3, Math.round(usable.length * 0.12));
    // Reference frame at the start of the movement (median-ish: use the mean-of-first-frames frame nearest the median trunk direction)
    const ref = bodyFrame(usable[Math.min(startN >> 1, usable.length - 1)], hand);
    const ctxBase = { hand, ref };
    const fps = opts.fps || estimateFps(usable) || 15;
    const win = clamp(Math.round(fps * 0.15) | 1, 3, 9);

    const sides = def.bilateral ? ['n/a'] : (opts.side === 'left' || opts.side === 'right') ? [opts.side] : ['left', 'right'];
    const perSide = sides.map(side => {
      const sigs = movementSignal(samples, def, side === 'n/a' ? 'left' : side, ctxBase);
      const raw = sigs.map(s => s.v);
      const sm = smooth(medianFilter(raw, 5), win);
      const vals = sm.filter(v => v != null);
      const range = vals.length ? percentile(vals, 0.95) - percentile(vals, 0.05) : 0;
      return { side, sigs, raw, sm, range, valid: vals.length };
    });
    let chosen = perSide[0];
    let sideMethod = def.bilateral ? 'not applicable (midline movement)' : `specified by clinician (${opts.side})`;
    if (perSide.length === 2) {
      chosen = perSide[0].range >= perSide[1].range ? perSide[0] : perSide[1];
      sideMethod = 'auto-detected: the limb with the larger movement excursion';
      if (Math.min(perSide[0].range, perSide[1].range) > 0.7 * Math.max(perSide[0].range, perSide[1].range) && Math.max(perSide[0].range, perSide[1].range) > 10)
        flags.push('BOTH_SIDES_MOVED');
    }

    const { sigs, raw, sm } = chosen;
    const validIdx = sm.map((v, i) => (v != null ? i : -1)).filter(i => i >= 0);
    const coverage = validIdx.length / samples.length;
    if (coverage < 0.6) flags.push('OCCLUSION_OR_LOST_TRACKING');
    if (validIdx.length < 8) return { key: movementKey, name, measurements: [], flags: ['LOST_TRACKING'], reliable: false, note: 'The joint was not tracked with sufficient visibility to measure.' };

    // Start position and extremes.
    const startVals = sm.slice(0, Math.max(3, Math.round(samples.length * 0.15))).filter(v => v != null);
    const start = median(startVals);
    const flip = def.flip ? -1 : 1; // extension-type movements are reported as positive numbers
    const dir = def.dir;
    const peak = robustExtreme(sm, dir, Math.min(win + 2, 7));
    if (peak.value == null) return { key: movementKey, name, measurements: [], flags: ['NO_STABLE_PEAK'], reliable: false, note: 'No stable end-range position could be identified.' };
    const excursion = Math.abs(peak.value - start);

    // Bidirectional movements (rotation / lateral flexion): both extremes.
    const extremeNeg = def.bidirectional ? robustExtreme(sm, -1, Math.min(win + 2, 7)) : null;

    // Movement quality.
    const dt = 1 / fps;
    let turning = 0, lastExtreme = sm[validIdx[0]], dirSign = 0;
    const hyst = 3;
    validIdx.forEach(i => {
      const v = sm[i];
      if (dirSign >= 0 && lastExtreme - v > hyst) { if (dirSign === 1) turning++; dirSign = -1; lastExtreme = v; }
      else if (dirSign <= 0 && v - lastExtreme > hyst) { if (dirSign === -1) turning++; dirSign = 1; lastExtreme = v; }
      else if ((dirSign >= 0 && v > lastExtreme) || (dirSign <= 0 && v < lastExtreme)) lastExtreme = v;
    });
    const expectedTurns = def.bidirectional ? 3 : 1;
    const hesitations = Math.max(0, turning - expectedTurns);
    const holdWin = sm.slice(Math.max(0, peak.index - Math.round(fps * 0.4)), peak.index + Math.round(fps * 0.4) + 1).filter(v => v != null);
    const holdSD = holdWin.length > 2 ? Math.round(sd(holdWin) * 10) / 10 : null;
    const resid = raw.map((v, i) => (v != null && sm[i] != null ? v - sm[i] : null)).filter(v => v != null);
    const noiseSD = resid.length > 5 ? sd(resid) : 0;
    const dts = samples[Math.min(peak.index, samples.length - 1)].t - samples[validIdx[0]].t;

    // Plane adherence at end range (limb vector's out-of-plane component).
    let planeDev = null;
    if (def.off) {
      const offs = sigs.map(s => s.off).filter(v => v != null);
      const atPeak = sigs.slice(Math.max(0, peak.index - 2), peak.index + 3).map(s => s.off).filter(v => v != null);
      if (atPeak.length) planeDev = Math.round(Math.asin(clamp(median(atPeak), 0, 1)) * RAD * 10) / 10;
    }
    const yaw = median(usable.slice(0, 40).map(viewYaw));
    const viewFit = viewSuitability(def.plane, yaw);
    if (viewFit.mismatch > 25) flags.push('POOR_CAMERA_VIEW');
    if (planeDev != null && planeDev > 20) flags.push('OUT_OF_PLANE_MOVEMENT');
    if (excursion < 8) flags.push('VERY_SMALL_MOVEMENT');

    const meanVis = mean(sigs.filter(s => s.v != null).map(s => s.vis));
    const visQ = clamp((meanVis - 0.5) / 0.45, 0, 1);
    const covQ = clamp((coverage - 0.4) / 0.5, 0, 1);
    const planeQ = planeDev == null ? 0.8 : clamp(1 - planeDev / 40, 0, 1);
    const rangeQ = clamp(excursion / 25, 0.3, 1);
    const noiseQ = clamp(1 - ((noiseSD || 0) - 1.5) / 6.5, 0.3, 1);
    let confidence = 0.35 * visQ + 0.2 * covQ + 0.2 * viewFit.q + 0.1 * planeQ + 0.05 * rangeQ + 0.1 * noiseQ;
    confidence = Math.min(confidence, def.cap);
    if (flags.includes('OCCLUSION_OR_LOST_TRACKING')) confidence = Math.min(confidence, 0.55);
    confidence = Math.round(confidence * 100) / 100;

    // Compensations.
    const comps = def.group === 'trunk' ? [] : compensations(samples, def, chosen.side, ref, hand);
    const startNotNeutral = def.basis === 'neutral' && Math.abs(start) > 15 && !def.bidirectional && !def.flip;
    if (startNotNeutral) flags.push('START_NOT_NEUTRAL');

    // Build measurement objects.
    const round1 = (v) => Math.round(v * 10) / 10;
    const series = (() => { // ~60-point downsample of the smoothed trajectory for the chart
      const step = Math.max(1, Math.floor(sm.length / 60)); const out = [];
      for (let i = 0; i < sm.length; i += step) if (sm[i] != null) out.push([round1(samples[i].t - samples[0].t), round1(sm[i])]);
      return out;
    })();
    const reliable = confidence >= RELIABLE_MIN && !flags.includes('LOST_TRACKING');
    const measurements = [];
    const base = { side: chosen.side === 'n/a' ? 'midline' : chosen.side, sideMethod, plane: def.plane, method: def.method, source: 'pose-3d',
      reference: { normal: def.norm, source: AAOS }, confidence, confidenceLabel: confLabel(confidence), reliable, flags: flags.slice() };
    const mk = (label, headline, extra) => {
      const norm = def.norm;
      return Object.assign({ id: movementKey + (extra && extra.suffix ? '_' + extra.suffix : ''), name: label, value: reliable ? round1(headline) : null, unit: '°', pctOfNormal: reliable && norm ? Math.round((headline / norm) * 100) : null }, base, extra && extra.detail ? { detail: extra.detail } : {});
    };
    if (def.bidirectional) {
      const [negName, posName] = def.bidirectional;
      const posPeak = peak.value, negPeak = extremeNeg.value;
      measurements.push(mk(`${name} — ${posName}`, Math.max(0, posPeak), { suffix: posName, detail: { start: round1(start), peakSigned: round1(posPeak) } }));
      measurements.push(mk(`${name} — ${negName}`, Math.max(0, -negPeak), { suffix: negName, detail: { start: round1(start), peakSigned: round1(negPeak) } }));
    } else {
      const headline = def.basis === 'start' ? excursion : Math.max(0, flip * peak.value);
      measurements.push(mk(name, headline, { detail: { start: round1(flip * start), endAngle: round1(flip * peak.value), excursion: round1(excursion) } }));
    }

    return {
      key: movementKey, name, measurable: true, measurements, side: base.side, sideMethod, plane: def.plane,
      start: round1(start), peak: round1(peak.value), excursion: round1(excursion), basis: def.basis,
      quality: { hesitations, holdSD, noiseSD: round1(noiseSD || 0), durationSec: round1(Math.max(0, dts)), smoothness: hesitations === 0 ? 'smooth' : hesitations <= 2 ? 'some hesitation' : 'irregular' },
      compensations: comps, planeDeviationDeg: planeDev, viewYaw: round1(yaw), viewMismatchDeg: round1(viewFit.mismatch),
      coverage: Math.round(coverage * 100) / 100, meanVisibility: round1(meanVis * 100) / 100 || meanVis, confidence, confidenceLabel: confLabel(confidence),
      reliable, flags, series, method: def.method, reference: { normal: def.norm, source: AAOS }
    };
  }
  ME.analyzeROM = analyzeROM;

  // The single live number for the on-screen chip + steady-hold detector.
  function liveSignal(f, movementKey, side, ctx) {
    const def = MOVEMENTS[movementKey];
    if (!def || def.measurable === false || !f || !f.world) return null;
    if (frameVis(f, def.lm, def.bilateral ? null : side) < 0.5) return null;
    const fr = bodyFrame(f, ctx.hand);
    const v = def.sig(f, side, { fr, ref: ctx.ref || fr });
    return v == null || !isFinite(v) ? null : (def.flip ? -v : v);
  }
  ME.liveSignal = liveSignal;

  // Whole-frame tracking quality for the live HUD and capture quality gate.
  function frameQuality(f) {
    if (!f || !f.world || !f.vis) return { score: 0, label: 'No body', flags: ['NO_BODY'] };
    const key = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE];
    const meanV = mean(key.map(i => f.vis[i]));
    const inFrame = key.filter(i => f.img && f.img[i] && f.img[i].x > 0.02 && f.img[i].x < 0.98 && f.img[i].y > 0.02 && f.img[i].y < 0.98).length / key.length;
    const flags = [];
    if (meanV < 0.6) flags.push('OCCLUSION');
    if (inFrame < 0.9) flags.push('PARTIAL_BODY');
    const score = clamp(meanV * 0.7 + inFrame * 0.3, 0, 1);
    return { score, label: score >= 0.8 ? 'Good' : score >= 0.6 ? 'Fair' : 'Poor', flags, meanVisibility: meanV, inFrame };
  }
  ME.frameQuality = frameQuality;

  // Capture-level quality summary over a whole recording.
  function captureQuality(samples, meta) {
    meta = meta || {};
    const total = samples.length;
    const tracked = samples.filter(f => f.world);
    const flags = [];
    if (!total || tracked.length / total < 0.7) flags.push('BODY_NOT_TRACKED_CONTINUOUSLY');
    const qs = tracked.map(frameQuality);
    const partial = qs.filter(q => q.flags.includes('PARTIAL_BODY')).length / (qs.length || 1);
    const occl = qs.filter(q => q.flags.includes('OCCLUSION')).length / (qs.length || 1);
    if (partial > 0.25) flags.push('BODY_PARTLY_OUT_OF_FRAME');
    if (occl > 0.25) flags.push('LOW_LANDMARK_VISIBILITY');
    const fps = estimateFps(samples);
    if (fps && fps < 8) flags.push('LOW_FRAME_RATE');
    if (meta.brightness != null && meta.brightness < 45) flags.push('LOW_LIGHT');
    const durationSec = total > 1 ? samples[total - 1].t - samples[0].t : 0;
    const score = clamp((mean(qs.map(q => q.score)) || 0) * (tracked.length / (total || 1)), 0, 1);
    return { score: Math.round(score * 100) / 100, label: score >= 0.8 ? 'Good' : score >= 0.6 ? 'Fair' : 'Poor', flags, frames: total, trackedFrames: tracked.length,
      fps: Math.round(fps * 10) / 10, durationSec: Math.round(durationSec * 10) / 10, meanVisibility: Math.round((mean(qs.map(q => q.meanVisibility)) || 0) * 100) / 100 };
  }
  ME.captureQuality = captureQuality;

  ME.FLAG_TEXT = {
    OCCLUSION_OR_LOST_TRACKING: 'The joint was hidden or lost for a large part of the movement.',
    LOST_TRACKING: 'The joint could not be tracked.',
    POOR_CAMERA_VIEW: 'The camera view does not suit this movement plane (side view for flexion/extension; front view for abduction/rotation).',
    OUT_OF_PLANE_MOVEMENT: 'The limb moved substantially out of the intended plane, which under-reads the true range.',
    VERY_SMALL_MOVEMENT: 'Very little movement was detected.',
    START_NOT_NEUTRAL: 'The movement did not start from the anatomical neutral position.',
    BOTH_SIDES_MOVED: 'Both limbs moved similarly — laterality was auto-picked; specify the side to be sure.',
    NOT_INSTRUMENT_MEASURABLE: 'Not measurable from video (needs a goniometer).',
    BODY_NOT_TRACKED_CONTINUOUSLY: 'The body was not tracked continuously.',
    BODY_PARTLY_OUT_OF_FRAME: 'Parts of the body left the camera frame.',
    LOW_LANDMARK_VISIBILITY: 'Landmark visibility was low (occlusion, clothing, or lighting).',
    LOW_FRAME_RATE: 'Low tracking frame rate — timing-based measures are less reliable.',
    LOW_LIGHT: 'The image was too dark.',
    TOO_FEW_FRAMES: 'Too few tracked frames.',
    NO_STABLE_PEAK: 'No stable end-range position was found.'
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = (typeof window !== 'undefined' ? window.MotionEngine : {});
