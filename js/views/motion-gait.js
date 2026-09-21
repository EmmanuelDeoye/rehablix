// js/views/motion-gait.js — gait, posture/balance and assistive-device engine.
// Pure computation (no DOM / network) on top of js/views/motion-engine.js.
//
// Gait is analysed from the WHOLE tracked walk (every frame the live pose
// tracker saw), not from a handful of sampled stills: heel-strike / toe-off
// events are detected from the foot trajectories (Zeni et al. 2008 method for
// side views), and cadence, step/stride time, stance/swing, symmetry, step
// length/width, foot clearance, trunk and pelvic motion, hip/knee excursion
// and stability variability are derived from those events. Each value carries
// its method, reference range, source and confidence; values whose confidence
// falls under the reliability threshold are withheld (null) and flagged.
// Everything here is MEASURED data — interpretation is the AI's job and is
// kept separate.
(function () {
  const ME = window.MotionEngine;
  const { V, LM, median, mean, sd, percentile, smooth, findPeaks, clamp, estimateFps, confLabel, RELIABLE_MIN, bodyFrame, resolveHandedness } = ME;
  const RAD = 180 / Math.PI;
  const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

  const REF = {
    cadence: { normal: '100–120 steps/min', source: 'Perry & Burnfield 2010 (adult, self-selected speed)' },
    stepTime: { normal: '0.5–0.6 s', source: 'Perry & Burnfield 2010' },
    stance: { normal: '≈60% of the gait cycle', source: 'Perry & Burnfield 2010' },
    swing: { normal: '≈40% of the gait cycle', source: 'Perry & Burnfield 2010' },
    doubleSupport: { normal: '≈20% of the gait cycle', source: 'Perry & Burnfield 2010' },
    stepLength: { normal: '0.60–0.80 m', source: 'Whittle, Gait Analysis (adult)' },
    stepWidth: { normal: '5–13 cm', source: 'Perry & Burnfield 2010' },
    speed: { normal: '1.2–1.4 m/s', source: 'Bohannon 1997 (comfortable speed, adult)' },
    symmetry: { normal: '< 10% side-to-side difference', source: 'Robinson symmetry index (screening cut-off)' },
    kneeSwing: { normal: '≈60° peak swing-phase knee flexion', source: 'Perry & Burnfield 2010' },
    mtc: { normal: '≈1–2 cm minimum toe clearance', source: 'Winter 1991' },
    cv: { normal: '< 3–5% step-time variability (healthy adults)', source: 'Hausdorff 2005' }
  };
  const si = (a, b) => (a == null || b == null || (a + b) === 0 ? null : (100 * Math.abs(a - b)) / (0.5 * (a + b)));

  // ------------------------------------------------------------------ helpers
  function usableSamples(samples) { return samples.filter(f => f.world && f.img); }

  function series(samples, fn) { return samples.map(f => { try { const v = fn(f); return v != null && isFinite(v) ? v : null; } catch (e) { return null; } }); }
  const px = (f, i) => ({ x: f.img[i].x * (f.aspect || 16 / 9), y: f.img[i].y });

  // Length scale: image units per leg length, and metres per image unit.
  function bodyScale(usable, heightCm) {
    const legImg = median(usable.map(f => {
      const d = (h, k, a) => { const H = px(f, h), K = px(f, k), A = px(f, a); return Math.hypot(H.x - K.x, H.y - K.y) + Math.hypot(K.x - A.x, K.y - A.y); };
      return (d(LM.L_HIP, LM.L_KNEE, LM.L_ANKLE) + d(LM.R_HIP, LM.R_KNEE, LM.R_ANKLE)) / 2;
    }));
    const legWorld = median(usable.map(f => {
      const d = (h, k, a) => V.dist(f.world[h], f.world[k]) + V.dist(f.world[k], f.world[a]);
      return (d(LM.L_HIP, LM.L_KNEE, LM.L_ANKLE) + d(LM.R_HIP, LM.R_KNEE, LM.R_ANKLE)) / 2;
    }));
    const legM = heightCm ? 0.491 * heightCm / 100 : legWorld; // hip-joint→ankle ≈ 0.530H − 0.039H (Drillis & Contini 1966)
    return { legImg, legM, mPerUnit: legImg ? legM / legImg : null, fromHeight: !!heightCm, legWorld };
  }

  // ------------------------------------------------------------------ gait events
  function gaitEvents(usable, view, fps, L) {
    const t = usable.map(f => f.t);
    const hipX = smooth(series(usable, f => (px(f, LM.L_HIP).x + px(f, LM.R_HIP).x) / 2), 5);
    const minDist = Math.max(3, Math.round(0.5 * fps));
    const ev = { hsL: [], hsR: [], toL: [], toR: [], method: '', dir: 0 };
    const net = hipX.filter(v => v != null);
    const displacement = net.length ? net[net.length - 1] - net[0] : 0;
    ev.dir = displacement >= 0 ? 1 : -1;
    ev.displacementLegs = Math.abs(displacement) / L;
    if (view === 'side') {
      ev.method = 'Zeni et al. 2008: heel strike = foot furthest ahead of the pelvis, toe-off = foot furthest behind (image-space foot–pelvis distance)';
      const heelRel = (side) => smooth(series(usable, f => ev.dir * (px(f, side === 'L' ? LM.L_HEEL : LM.R_HEEL).x - (px(f, LM.L_HIP).x + px(f, LM.R_HIP).x) / 2)), 3);
      const toeRel = (side) => smooth(series(usable, f => ev.dir * (px(f, side === 'L' ? LM.L_FOOT : LM.R_FOOT).x - (px(f, LM.L_HIP).x + px(f, LM.R_HIP).x) / 2)), 3);
      ['L', 'R'].forEach(s => {
        ev['hs' + s] = findPeaks(heelRel(s), minDist, 0.12 * L, 1).map(i => t[i]);
        ev['to' + s] = findPeaks(toeRel(s), minDist, 0.12 * L, -1).map(i => t[i]);
      });
    } else {
      ev.method = 'Frontal/posterior view (approximate): heel strike = moment the two ankles are furthest apart vertically in the image';
      const dy = smooth(series(usable, f => px(f, LM.L_ANKLE).y - px(f, LM.R_ANKLE).y), 3);
      ev.hsL = findPeaks(dy, Math.max(3, Math.round(0.35 * fps)), 0.04 * L, 1).map(i => t[i]);
      ev.hsR = findPeaks(dy, Math.max(3, Math.round(0.35 * fps)), 0.04 * L, -1).map(i => t[i]);
    }
    return ev;
  }

  // ------------------------------------------------------------------ gait analysis
  //  opts: { view: 'side'|'front'|'back', heightCm }
  function analyzeGait(samples, opts) {
    opts = opts || {};
    const vs = String(opts.view || 'side').toLowerCase();
    const view = (vs.includes('side') || vs.includes('sagittal')) ? 'side' : (vs.includes('post') || vs.includes('back')) ? 'back' : 'front';
    const usable = usableSamples(samples);
    const out = { kind: 'gait', view, measurements: [], deviations: [], flags: [], notes: [] };
    if (usable.length < 20) {
      out.flags.push('TOO_FEW_FRAMES'); out.notes.push('Fewer than 20 tracked frames — the walk was too short or the body was not tracked.');
      return out;
    }
    const fps = estimateFps(usable) || 15;
    const duration = usable[usable.length - 1].t - usable[0].t;
    const scale = bodyScale(usable, opts.heightCm);
    const L = scale.legImg;
    out.fps = r1(fps); out.durationSec = r1(duration);
    out.scale = { legLengthM: r2(scale.legM), source: scale.fromHeight ? 'entered patient height (leg ≈ 0.491 × height)' : 'body-model estimate (±10%) — enter height for calibrated distances', calibrated: scale.fromHeight };
    if (fps < 8) out.flags.push('LOW_FRAME_RATE');

    const ev = gaitEvents(usable, view, fps, L);
    if (ev.displacementLegs < 0.6 && view === 'side') { out.flags.push('LITTLE_FORWARD_PROGRESSION'); out.notes.push('The person barely progressed across the frame — walking may not have been captured (or this was walking on the spot).'); }

    // ---- tracking quality of the lower limbs
    const lowerIdx = [LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE, LM.L_HEEL, LM.R_HEEL, LM.L_FOOT, LM.R_FOOT];
    const visQ = clamp(((mean(usable.map(f => mean(lowerIdx.map(i => f.vis ? f.vis[i] : 1)))) || 0) - 0.5) / 0.4, 0, 1);
    const coverage = usable.length / samples.length;
    const trackQ = clamp(0.7 * visQ + 0.3 * clamp((coverage - 0.6) / 0.35, 0, 1), 0, 1);
    if (trackQ < 0.5) out.flags.push('LOW_LANDMARK_VISIBILITY');

    // ---- temporal events
    const hs = [...ev.hsL.map(t => ({ t, f: 'L' })), ...ev.hsR.map(t => ({ t, f: 'R' }))].sort((a, b) => a.t - b.t);
    let violations = 0;
    for (let i = 1; i < hs.length; i++) if (hs[i].f === hs[i - 1].f) violations++;
    const alternationOK = hs.length >= 4 && violations / (hs.length - 1) < 0.25;
    const nSteps = Math.max(0, hs.length - 1);
    const enoughSteps = hs.length >= 4 && alternationOK;
    if (!enoughSteps) out.flags.push('FEW_STEPS');
    const yaw = median(usable.slice(0, 60).map(ME.viewYaw));
    const sagFit = view === 'side' ? clamp(1 - Math.max(0, 60 - yaw) / 60, 0.25, 1) : 0.6;
    const frontFit = view === 'side' ? 0.5 : clamp(1 - Math.max(0, yaw - 35) / 55, 0.25, 1);
    const stepsQ = clamp((nSteps - 2) / 6, 0, 1);
    const eventQ = enoughSteps ? 1 : 0.2;

    // step & stride times
    const stepTimes = { L: [], R: [] };
    for (let i = 1; i < hs.length; i++) if (hs[i].f !== hs[i - 1].f) stepTimes[hs[i].f].push(hs[i].t - hs[i - 1].t);
    const strideTimes = { L: [], R: [] };
    ['L', 'R'].forEach(s => { const ts = ev['hs' + s]; for (let i = 1; i < ts.length; i++) strideTimes[s].push(ts[i] - ts[i - 1]); });
    const allSteps = [...stepTimes.L, ...stepTimes.R];
    const cvStep = allSteps.length > 2 ? sd(allSteps) / mean(allSteps) : null;
    const regQ = cvStep == null ? 0.5 : clamp(1 - cvStep / 0.3, 0.2, 1);

    const trackCap = trackQ < 0.5 ? 0.35 : 1; // poorly-tracked lower limbs: nothing derived from them is trustworthy
    const M = (id, name, value, unit, cfg) => {
      const conf = clamp(cfg.conf, 0, Math.min(trackCap, cfg.cap == null ? 1 : cfg.cap));
      const reliable = value != null && conf >= RELIABLE_MIN;
      const m = { id, name, value: reliable ? value : null, unit, side: cfg.side || 'both', plane: cfg.plane || 'sagittal', method: cfg.method, source: cfg.source || 'pose-3d',
        reference: cfg.ref || null, confidence: r2(conf), confidenceLabel: confLabel(conf), reliable, flags: cfg.flags || [] };
      if (value != null && !reliable) m.flags = m.flags.concat(['LOW_CONFIDENCE_WITHHELD']);
      if (cfg.detail) m.detail = cfg.detail;
      out.measurements.push(m); return m;
    };
    const temporalConf = 0.35 * trackQ + 0.3 * eventQ + 0.2 * stepsQ + 0.15 * regQ;

    if (enoughSteps) {
      const span = hs[hs.length - 1].t - hs[0].t;
      const cadence = span > 0 ? (60 * (hs.length - 1)) / span : null;
      M('cadence', 'Cadence', r1(cadence), 'steps/min', { conf: temporalConf, ref: REF.cadence, method: 'Heel-strike count over the walking interval', source: 'pose-2d', plane: 'n/a' });
      const stL = mean(stepTimes.L), stR = mean(stepTimes.R);
      M('step_time_left', 'Step time (left)', r2(stL), 's', { conf: temporalConf, side: 'left', ref: REF.stepTime, method: 'Right heel-strike → left heel-strike', source: 'pose-2d', plane: 'n/a' });
      M('step_time_right', 'Step time (right)', r2(stR), 's', { conf: temporalConf, side: 'right', ref: REF.stepTime, method: 'Left heel-strike → right heel-strike', source: 'pose-2d', plane: 'n/a' });
      M('step_time_symmetry', 'Step-time asymmetry', r1(si(stL, stR)), '%', { conf: temporalConf * 0.95, ref: REF.symmetry, method: 'Robinson symmetry index of left vs right step time', source: 'pose-2d', plane: 'n/a' });
      const cvS = [...strideTimes.L, ...strideTimes.R];
      if (cvS.length >= 3) M('stride_time_variability', 'Stride-time variability (CV)', r1(100 * sd(cvS) / mean(cvS)), '%', { conf: temporalConf * 0.9 * (nSteps >= 6 ? 1 : 0.6), ref: REF.cv, method: 'Coefficient of variation of stride time (needs ≥ 3 strides)', source: 'pose-2d', plane: 'n/a' });
    } else {
      out.notes.push('Fewer than 4 alternating heel strikes were detected: cadence, step timing, and symmetry cannot be reliably computed from this walk.');
    }

    // ---- stance / swing (side view)
    if (enoughSteps && view === 'side') {
      const stance = { L: [], R: [] };
      ['L', 'R'].forEach(s => {
        const h = ev['hs' + s], to = ev['to' + s];
        for (let i = 0; i + 1 < h.length; i++) {
          const toT = to.find(x => x > h[i] && x < h[i + 1]);
          if (toT) stance[s].push(100 * (toT - h[i]) / (h[i + 1] - h[i]));
        }
      });
      const sL = median(stance.L), sR = median(stance.R);
      const conf = temporalConf * sagFit * (stance.L.length >= 2 && stance.R.length >= 2 ? 1 : 0.5);
      if (sL != null && sR != null) {
        M('stance_left', 'Stance phase (left)', r1(sL), '% of cycle', { conf, side: 'left', ref: REF.stance, method: 'Heel-strike → toe-off as a fraction of the stride', source: 'pose-2d', cap: 0.85 });
        M('stance_right', 'Stance phase (right)', r1(sR), '% of cycle', { conf, side: 'right', ref: REF.stance, method: 'Heel-strike → toe-off as a fraction of the stride', source: 'pose-2d', cap: 0.85 });
        M('swing_left', 'Swing phase (left)', r1(100 - sL), '% of cycle', { conf, side: 'left', ref: REF.swing, method: '100% − stance', source: 'pose-2d', cap: 0.85 });
        M('swing_right', 'Swing phase (right)', r1(100 - sR), '% of cycle', { conf, side: 'right', ref: REF.swing, method: '100% − stance', source: 'pose-2d', cap: 0.85 });
        M('stance_symmetry', 'Stance-time asymmetry', r1(si(sL, sR)), '%', { conf: conf * 0.95, ref: REF.symmetry, method: 'Robinson symmetry index of left vs right stance %', source: 'pose-2d', cap: 0.85 });
        M('double_support', 'Double support (estimated)', r1(sL + sR - 100), '% of cycle', { conf: conf * 0.8, ref: REF.doubleSupport, method: 'Estimated as (stance L + stance R) − 100', source: 'pose-2d', cap: 0.75 });
      } else out.notes.push('Toe-off events could not be matched to heel strikes, so stance/swing timing is not reported.');
    }

    // ---- spatial (side): step length, speed
    const mPer = scale.mPerUnit;
    const scaleConf = scale.fromHeight ? 1 : 0.7;
    if (enoughSteps && view === 'side' && mPer) {
      const stepLen = { L: [], R: [] };
      hs.forEach(e => {
        const fr = usable.reduce((best, f) => (Math.abs(f.t - e.t) < Math.abs(best.t - e.t) ? f : best), usable[0]);
        const hl = px(fr, LM.L_HEEL).x, hr = px(fr, LM.R_HEEL).x;
        stepLen[e.f].push(Math.abs(hl - hr) * mPer);
      });
      const lenL = median(stepLen.L), lenR = median(stepLen.R);
      const conf = temporalConf * sagFit * scaleConf;
      M('step_length_left', 'Step length (left)', r2(lenL), 'm', { conf, side: 'left', ref: REF.stepLength, method: 'Heel-to-heel separation at left heel strike (image-space; camera must be square to the walkway)', source: 'pose-2d', cap: 0.8 });
      M('step_length_right', 'Step length (right)', r2(lenR), 'm', { conf, side: 'right', ref: REF.stepLength, method: 'Heel-to-heel separation at right heel strike', source: 'pose-2d', cap: 0.8 });
      M('step_length_symmetry', 'Step-length asymmetry', r1(si(lenL, lenR)), '%', { conf: conf * 0.95, ref: REF.symmetry, method: 'Robinson symmetry index (scale-free)', source: 'pose-2d', cap: 0.85 });
      const t0 = hs[0].t, t1 = hs[hs.length - 1].t;
      const fi = (tt) => usable.reduce((b, f) => (Math.abs(f.t - tt) < Math.abs(b.t - tt) ? f : b), usable[0]);
      const dX = Math.abs((px(fi(t1), LM.L_HIP).x + px(fi(t1), LM.R_HIP).x) / 2 - (px(fi(t0), LM.L_HIP).x + px(fi(t0), LM.R_HIP).x) / 2) * mPer;
      if (t1 > t0) M('gait_speed', 'Walking speed', r2(dX / (t1 - t0)), 'm/s', { conf: conf * 0.9, ref: REF.speed, method: 'Pelvis displacement across the frame ÷ time between first and last heel strike', source: 'pose-2d', cap: 0.75 });
    }

    // ---- step width (front/back): world-space mediolateral ankle separation at heel strike
    if (enoughSteps && view !== 'side') {
      const widths = hs.map(e => { const fr = usable.reduce((b, f) => (Math.abs(f.t - e.t) < Math.abs(b.t - e.t) ? f : b), usable[0]); return Math.abs(fr.world[LM.L_ANKLE].x - fr.world[LM.R_ANKLE].x); });
      const w = median(widths) * 100 * (scale.fromHeight && scale.legWorld ? scale.legM / scale.legWorld : 1);
      M('step_width', 'Step width', r1(w), 'cm', { conf: temporalConf * frontFit * 0.85, ref: REF.stepWidth, method: 'Mediolateral ankle separation at heel strike (3D world landmarks)', plane: 'frontal', cap: 0.7, detail: { variabilityCm: r1(sd(widths) * 100) } });
    }

    // ---- kinematics from 3D landmarks
    const hand = resolveHandedness(usable);
    const kin = { L: { knee: [], hip: [] }, R: { knee: [], hip: [] } };
    usable.forEach(f => {
      const fr = bodyFrame(f, hand);
      ['left', 'right'].forEach(sd_ => {
        const s = sd_ === 'left' ? 'L' : 'R';
        const knee = 180 - ME.angleBetween(V.sub(f.world[ME.idx('HIP', sd_)], f.world[ME.idx('KNEE', sd_)]), V.sub(f.world[ME.idx('ANKLE', sd_)], f.world[ME.idx('KNEE', sd_)]));
        const th = V.sub(f.world[ME.idx('KNEE', sd_)], f.world[ME.idx('HIP', sd_)]);
        const hipA = Math.atan2(V.dot(th, fr.ant), -V.dot(th, fr.up)) * RAD;
        kin[s].knee.push(knee); kin[s].hip.push(hipA);
      });
    });
    const kinConf = trackQ * sagFit * (enoughSteps ? 1 : 0.5);
    ['L', 'R'].forEach(s => {
      const nm = s === 'L' ? 'left' : 'right';
      const kn = smooth(kin[s].knee, 3), hp = smooth(kin[s].hip, 3);
      // swing-phase peak knee flexion per stride (needs events); otherwise overall peak
      const peaks = [];
      const h = ev['hs' + s];
      for (let i = 0; i + 1 < h.length; i++) {
        const seg = usable.map((f, k) => (f.t >= h[i] && f.t <= h[i + 1] ? kn[k] : null)).filter(v => v != null);
        if (seg.length > 3) peaks.push(Math.max(...seg));
      }
      const peakKnee = peaks.length ? median(peaks) : percentile(kn, 0.95);
      M('knee_peak_flexion_' + nm, `Peak knee flexion in gait cycle (${nm})`, r1(peakKnee), '°', { conf: kinConf, side: nm, ref: REF.kneeSwing, method: '180° − interior femur–tibia angle, 3D world landmarks; median of per-stride maxima', cap: 0.85, detail: { strides: peaks.length } });
      M('hip_range_' + nm, `Hip flexion–extension range (${nm})`, r1(percentile(hp, 0.95) - percentile(hp, 0.05)), '°', { conf: kinConf * 0.95, side: nm, ref: { normal: '≈40° in level walking', source: 'Perry & Burnfield 2010' }, method: 'Femur vs trunk axis, sagittal plane, 3D world landmarks (5th–95th percentile)', cap: 0.85 });
    });
    const kl = out.measurements.find(m => m.id === 'knee_peak_flexion_left'), kr = out.measurements.find(m => m.id === 'knee_peak_flexion_right');
    if (kl && kr && kl.value != null && kr.value != null) M('knee_flexion_symmetry', 'Knee-flexion asymmetry', r1(si(kl.value, kr.value)), '%', { conf: Math.min(kl.confidence, kr.confidence) * 0.95, ref: REF.symmetry, method: 'Robinson symmetry index of peak knee flexion', cap: 0.85 });

    // ---- foot clearance (side)
    if (enoughSteps && view === 'side' && mPer) {
      const clearance = { L: [], R: [] };
      ['L', 'R'].forEach(s => {
        const toeY = smooth(series(usable, f => px(f, s === 'L' ? LM.L_FOOT : LM.R_FOOT).y), 3);
        const ground = percentile(toeY, 0.92); // lowest toe position ≈ floor
        const h = ev['hs' + s], to = ev['to' + s];
        for (let i = 0; i + 1 < h.length; i++) {
          const toT = to.find(x => x > h[i] && x < h[i + 1]); if (!toT) continue;
          const lo = toT + 0.25 * (h[i + 1] - toT), hi = toT + 0.75 * (h[i + 1] - toT);
          const win = usable.map((f, k) => (f.t >= lo && f.t <= hi ? ground - toeY[k] : null)).filter(v => v != null);
          if (win.length > 1) clearance[s].push(Math.min(...win) * mPer * 100);
        }
      });
      ['L', 'R'].forEach(s => {
        const nm = s === 'L' ? 'left' : 'right';
        if (clearance[s].length) M('toe_clearance_' + nm, `Minimum toe clearance (${nm})`, r1(median(clearance[s])), 'cm', { conf: temporalConf * sagFit * scaleConf * 0.8, side: nm, ref: REF.mtc, method: 'Lowest toe height above the floor line during mid-swing (image-space; floor = lowest toe position seen)', source: 'pose-2d', cap: 0.65 });
      });
    }

    // ---- trunk & pelvis
    const gUp = { x: 0, y: -1, z: 0 };
    const trunk = usable.map(f => { const fr = bodyFrame(f, hand); const u = V.unit(V.sub(V.mid(f.world[LM.L_SHOULDER], f.world[LM.R_SHOULDER]), V.mid(f.world[LM.L_HIP], f.world[LM.R_HIP]))); return { sag: Math.atan2(V.dot(u, fr.ant), V.dot(u, gUp)) * RAD, lat: Math.atan2(V.dot(u, fr.lat), V.dot(u, gUp)) * RAD }; });
    const trunkQ = trackQ * 0.8;
    if (view === 'side') M('trunk_lean_sagittal', 'Trunk forward lean (mean)', r1(mean(trunk.map(x => x.sag))), '°', { conf: trunkQ * sagFit, ref: { normal: '0–5° (upright)', source: 'clinical convention; assumes a level camera' }, method: 'Mid-hip→mid-shoulder axis vs vertical, sagittal plane (assumes the camera is level)', plane: 'sagittal', cap: 0.7 });
    if (view !== 'side') {
      M('trunk_lean_frontal', 'Trunk sideways lean (mean)', r1(mean(trunk.map(x => x.lat))), '°', { conf: trunkQ * frontFit, ref: { normal: '≈0° (upright)', source: 'clinical convention; assumes a level camera' }, method: 'Trunk axis vs vertical, frontal plane (+ = toward subject’s left)', plane: 'frontal', cap: 0.7 });
      const xs = series(usable, f => (px(f, LM.L_HIP).x + px(f, LM.R_HIP).x) / 2);
      const n = xs.length, tt = usable.map(f => f.t);
      const validX = xs.map((v, i) => [tt[i], v]).filter(p => p[1] != null);
      // detrend (walking toward/away from the camera changes apparent x only through sway)
      const mt = mean(validX.map(p => p[0])), mx = mean(validX.map(p => p[1]));
      const slope = validX.reduce((s, p) => s + (p[0] - mt) * (p[1] - mx), 0) / (validX.reduce((s, p) => s + (p[0] - mt) * (p[0] - mt), 0) || 1);
      const resid = validX.map(p => (p[1] - mx) - slope * (p[0] - mt));
      if (mPer) M('trunk_sway', 'Mediolateral trunk sway (SD)', r1(sd(resid) * mPer * 100), 'cm', { conf: trunkQ * frontFit * scaleConf * 0.8, ref: { normal: 'lower is steadier', source: 'screening indicator' }, method: 'SD of detrended pelvis lateral position', plane: 'frontal', source: 'pose-2d', cap: 0.65 });
      const roll = series(usable, f => { const d = V.sub(f.world[LM.L_HIP], f.world[LM.R_HIP]); return Math.atan2(d.y, d.x) * RAD; });
      M('pelvic_obliquity_range', 'Pelvic obliquity range', r1(percentile(roll, 0.95) - percentile(roll, 0.05)), '°', { conf: trunkQ * frontFit * 0.85, ref: { normal: '≈ 8–10° total in level walking (Perry)', source: 'Perry & Burnfield 2010' }, method: 'Roll of the hip-to-hip line, 5th–95th percentile (3D world landmarks)', plane: 'frontal', cap: 0.7 });
    }
    const yawSeries = series(usable, f => { const d = V.sub(f.world[LM.L_HIP], f.world[LM.R_HIP]); return Math.atan2(d.z, d.x) * RAD; });
    M('pelvic_rotation_range', 'Pelvic rotation range', r1(percentile(yawSeries, 0.95) - percentile(yawSeries, 0.05)), '°', { conf: trunkQ * 0.6, ref: { normal: '≈ 8–10° total (Perry)', source: 'Perry & Burnfield 2010' }, method: 'Yaw of the hip-to-hip line (depth estimate from monocular video is the weakest axis)', plane: 'transverse', cap: 0.55 });

    // ---- arm swing (side)
    if (view === 'side') {
      const amp = (wr, sh) => { const v = series(usable, f => (px(f, wr).x - px(f, sh).x) * ev.dir); return percentile(v, 0.95) - percentile(v, 0.05); };
      const aL = amp(LM.L_WRIST, LM.L_SHOULDER), aR = amp(LM.R_WRIST, LM.R_SHOULDER);
      if (mPer) {
        M('arm_swing_left', 'Arm swing amplitude (left)', r1(aL * mPer * 100), 'cm', { conf: trackQ * sagFit * scaleConf * 0.7, side: 'left', ref: null, method: 'Horizontal wrist excursion relative to the shoulder (image-space)', source: 'pose-2d', cap: 0.6 });
        M('arm_swing_right', 'Arm swing amplitude (right)', r1(aR * mPer * 100), 'cm', { conf: trackQ * sagFit * scaleConf * 0.7, side: 'right', ref: null, method: 'Horizontal wrist excursion relative to the shoulder (image-space)', source: 'pose-2d', cap: 0.6 });
        // A symmetry ratio of two near-zero amplitudes is just noise — only compute it when the arms actually swing.
        const avgSwingCm = ((aL + aR) / 2) * mPer * 100;
        if (avgSwingCm >= 4) M('arm_swing_symmetry', 'Arm-swing asymmetry', r1(si(aL, aR)), '%', { conf: trackQ * sagFit * 0.6, ref: REF.symmetry, method: 'Robinson symmetry index (only computed when mean arm-swing amplitude ≥ 4 cm)', source: 'pose-2d', cap: 0.6 });
        else out.deviations.push({ id: 'minimal_arm_swing', label: 'Minimal arm swing (arms held still or not swinging)', evidence: `mean wrist excursion ${r1(avgSwingCm)} cm (typical ≈ 10–20 cm)` });
      }
    }

    // ---- observable deviation flags (screening evidence, not diagnoses)
    const get = (id) => { const m = out.measurements.find(x => x.id === id); return m && m.reliable ? m.value : null; };
    const dev = (id, label, evidence) => out.deviations.push({ id, label, evidence });
    const kmin = Math.min(...['knee_peak_flexion_left', 'knee_peak_flexion_right'].map(get).filter(v => v != null).concat([999]));
    if (kmin < 40) dev('reduced_knee_flexion', 'Reduced peak knee flexion (possible stiff-knee gait)', `lowest side ${kmin}° (typical ≈ 60°)`);
    ['left', 'right'].forEach(s => { const c = get('toe_clearance_' + s); if (c != null && c < 1.0) dev('low_toe_clearance_' + s, `Low minimum toe clearance — ${s}`, `${c} cm (typical ≈ 1–2 cm) — trip risk`); });
    [['step_time_symmetry', 'Step-time asymmetry'], ['step_length_symmetry', 'Step-length asymmetry'], ['stance_symmetry', 'Stance-time asymmetry'], ['knee_flexion_symmetry', 'Knee-flexion asymmetry'], ['arm_swing_symmetry', 'Arm-swing asymmetry']].forEach(([id, label]) => {
      const v = get(id); if (v != null && v > 10) dev(id, `${label} above the 10% screening limit`, `${v}%`);
    });
    const lean = get('trunk_lean_sagittal'); if (lean != null && Math.abs(lean) > 10) dev('trunk_lean', 'Marked forward/backward trunk lean', `${lean}°`);
    const latLean = get('trunk_lean_frontal'); if (latLean != null && Math.abs(latLean) > 6) dev('trunk_lateral_lean', 'Sideways trunk lean', `${latLean}°`);
    const obl = get('pelvic_obliquity_range'); if (obl != null && obl > 14) dev('pelvic_obliquity', 'Increased pelvic obliquity (possible hip drop/hike)', `${obl}° range`);
    const sw = get('step_width'); if (sw != null && sw > 15) dev('wide_base', 'Wide walking base', `${sw} cm (typical 5–13 cm) — often a balance strategy`);
    const cv = get('stride_time_variability'); if (cv != null && cv > 8) dev('variable_rhythm', 'Irregular walking rhythm (high stride-time variability)', `CV ${cv}%`);
    const cad = get('cadence'); if (cad != null && cad < 80) dev('slow_cadence', 'Slow cadence', `${cad} steps/min`);
    const spd = get('gait_speed'); if (spd != null && spd < 0.8) dev('slow_speed', 'Reduced walking speed (community-ambulation threshold ≈ 0.8 m/s)', `${spd} m/s`);

    out.quality = { trackQ: r2(trackQ), coverage: r2(coverage), events: { heelStrikesL: ev.hsL.length, heelStrikesR: ev.hsR.length, toeOffsL: ev.toL.length, toeOffsR: ev.toR.length }, steps: nSteps, method: ev.method, viewYawDeg: r1(yaw), walkingDirection: ev.dir > 0 ? 'left→right' : 'right→left' };
    out.measuredCount = out.measurements.filter(m => m.reliable).length;
    return out;
  }

  // ------------------------------------------------------------------ posture / balance (quiet standing)
  function analyzePosture(samples, opts) {
    opts = opts || {};
    const usable = usableSamples(samples);
    const out = { kind: 'posture', measurements: [], flags: [], notes: [] };
    if (usable.length < 20) { out.flags.push('TOO_FEW_FRAMES'); out.notes.push('Not enough tracked frames to assess posture and balance.'); return out; }
    const fps = estimateFps(usable) || 15;
    const scale = bodyScale(usable, opts.heightCm); const L = scale.legImg, mPer = scale.mPerUnit;
    const hand = resolveHandedness(usable);
    const hip = usable.map(f => ({ x: (px(f, LM.L_HIP).x + px(f, LM.R_HIP).x) / 2, y: (px(f, LM.L_HIP).y + px(f, LM.R_HIP).y) / 2 }));
    const hx = smooth(hip.map(p => p.x), 9), hy = smooth(hip.map(p => p.y), 9), kk = Math.max(2, Math.round(0.25 * fps));
    // speed over a ±0.25 s baseline of the smoothed position (raw frame-to-frame deltas are dominated by landmark jitter)
    const sps = hx.map((_, i) => { const a = Math.max(0, i - kk), b = Math.min(hx.length - 1, i + kk); return Math.hypot(hx[b] - hx[a], hy[b] - hy[a]) / ((b - a) / fps) / L; });
    // longest quiet window (pelvis speed < 0.12 leg-lengths/s) of at least 2.5 s
    let best = null, start = null;
    sps.forEach((v, i) => { const q = v != null && v < 0.12; if (q && start == null) start = i; if ((!q || i === sps.length - 1) && start != null) { const end = q ? i : i - 1; if (!best || end - start > best.end - best.start) best = { start, end }; start = null; } });
    const minLen = Math.round(2.5 * fps);
    if (!best || best.end - best.start < minLen) { out.flags.push('NO_QUIET_STANDING'); out.notes.push('No steady standing period of at least 2.5 s was found — static posture and sway were not assessed. Ask the patient to stand still for ~10 s at the start of the recording.'); return out; }
    const win = usable.slice(best.start, best.end + 1);
    // sway is computed on the SMOOTHED pelvis track: raw landmark jitter would inflate path length/velocity many-fold
    const winHip = hip.slice(best.start, best.end + 1).map((_, i) => ({ x: hx[best.start + i], y: hy[best.start + i] }));
    out.quietWindow = { startSec: r1(win[0].t - usable[0].t), durationSec: r1(win[win.length - 1].t - win[0].t) };
    const yaw = median(win.map(ME.viewYaw));
    const lowerVis = mean(win.map(f => mean([LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE, LM.L_SHOULDER, LM.R_SHOULDER].map(i => f.vis ? f.vis[i] : 1))));
    const trackQ = clamp(((lowerVis || 0) - 0.5) / 0.4, 0, 1);
    const durQ = clamp((out.quietWindow.durationSec - 2.5) / 5, 0.3, 1);
    const sagFit = clamp(1 - Math.max(0, 60 - yaw) / 60, 0.25, 1), frontFit = clamp(1 - Math.max(0, yaw - 35) / 55, 0.25, 1);
    // Base confidence: mostly landmark tracking quality, then how long the person stood still; per-metric view fit and caps are applied on top.
    const q0 = 0.55 * trackQ + 0.25 * durQ + 0.2;
    const durFactor = 0.4 + 0.6 * durQ; // sway needs a long window to mean anything
    const M = (id, name, value, unit, cfg) => { const conf = clamp(cfg.conf, 0, Math.min(trackQ < 0.5 ? 0.35 : 1, cfg.cap == null ? 1 : cfg.cap)); const reliable = value != null && conf >= RELIABLE_MIN; out.measurements.push({ id, name, value: reliable ? value : null, unit, side: cfg.side || 'both', plane: cfg.plane || 'n/a', method: cfg.method, source: cfg.source || 'pose-3d', reference: cfg.ref || null, confidence: r2(conf), confidenceLabel: confLabel(conf), reliable, flags: reliable || value == null ? [] : ['LOW_CONFIDENCE_WITHHELD'] }); };

    // sway from the pelvis landmark (this is landmark motion, so jitter inflates it — hence the low confidence cap)
    if (mPer) {
      const mx = mean(winHip.map(p => p.x)), my = mean(winHip.map(p => p.y));
      const dx = winHip.map(p => (p.x - mx) * mPer * 100), dy = winHip.map(p => (p.y - my) * mPer * 100);
      const rms = Math.sqrt(mean(dx.map((v, i) => v * v + dy[i] * dy[i])));
      let path = 0; for (let i = 1; i < winHip.length; i++) path += Math.hypot(dx[i] - dx[i - 1], dy[i] - dy[i - 1]);
      const dur = win[win.length - 1].t - win[0].t;
      M('sway_rms', 'Postural sway (RMS displacement of pelvis)', r1(rms), 'cm', { conf: q0 * durFactor * 0.75 * (scale.fromHeight ? 1 : 0.7), ref: { normal: '≈ 0.5–1.5 cm in quiet standing (landmark jitter adds ≈ 0.3–0.5 cm)', source: 'screening indicator; not force-plate CoP' }, method: 'RMS of pelvis-landmark displacement over the steady-standing window', source: 'pose-2d', cap: 0.6 });
      M('sway_velocity', 'Sway velocity (mean)', r1(path / dur), 'cm/s', { conf: q0 * durFactor * 0.6 * (scale.fromHeight ? 1 : 0.7), ref: { normal: '≈ 1–3 cm/s', source: 'screening indicator' }, method: 'Path length of the pelvis landmark ÷ time', source: 'pose-2d', cap: 0.5 });
    }
    const upG = { x: 0, y: -1, z: 0 };
    const tr = win.map(f => { const fr = bodyFrame(f, hand); const u = V.unit(V.sub(V.mid(f.world[LM.L_SHOULDER], f.world[LM.R_SHOULDER]), V.mid(f.world[LM.L_HIP], f.world[LM.R_HIP]))); return { sag: Math.atan2(V.dot(u, fr.ant), V.dot(u, upG)) * RAD, lat: Math.atan2(V.dot(u, fr.lat), V.dot(u, upG)) * RAD }; });
    M('trunk_lean_sagittal', 'Trunk lean — forward (+) / backward (−)', r1(median(tr.map(x => x.sag))), '°', { conf: q0 * sagFit * 0.8, ref: { normal: '0–5°', source: 'clinical convention; assumes a level camera' }, method: 'Trunk axis vs vertical, sagittal plane', plane: 'sagittal', cap: 0.7 });
    M('trunk_lean_frontal', 'Trunk lean — toward left (+) / right (−)', r1(median(tr.map(x => x.lat))), '°', { conf: q0 * frontFit * 0.8, ref: { normal: '≈0°', source: 'clinical convention; assumes a level camera' }, method: 'Trunk axis vs vertical, frontal plane', plane: 'frontal', cap: 0.7 });
    M('trunk_sway_sd', 'Trunk-angle sway (SD)', r1(sd(tr.map(x => (yaw >= 45 ? x.sag : x.lat)))), '°', { conf: q0 * durFactor * 0.6, ref: { normal: '< 1.5°', source: 'screening indicator' }, method: 'Standard deviation of trunk lean over the steady window', cap: 0.55 });
    // head / shoulders / pelvis
    const earSh = median(win.map(f => { const fr = bodyFrame(f, hand); const e = V.sub(V.mid(f.world[LM.L_EAR], f.world[LM.R_EAR]), V.mid(f.world[LM.L_SHOULDER], f.world[LM.R_SHOULDER])); return Math.atan2(V.dot(e, fr.ant), V.dot(e, fr.up)) * RAD; }));
    M('head_forward', 'Forward head posture (ear–shoulder angle)', r1(earSh), '°', { conf: q0 * sagFit * 0.75, ref: { normal: '< ~15–20° from vertical', source: 'craniovertebral-angle proxy; not a photogrammetric CVA' }, method: 'Angle of the mid-shoulder→mid-ear line from the trunk axis, sagittal plane', plane: 'sagittal', cap: 0.65 });
    const rollOf = (a, b) => median(win.map(f => { const d = V.sub(f.world[a], f.world[b]); return Math.atan2(d.y, d.x) * RAD; }));
    M('shoulder_tilt', 'Shoulder-line tilt', r1(rollOf(LM.L_SHOULDER, LM.R_SHOULDER)), '°', { conf: q0 * frontFit * 0.8, ref: { normal: '< 3°', source: 'clinical convention' }, method: 'Roll of the shoulder-to-shoulder line, 3D world landmarks (+ = left side lower in image)', plane: 'frontal', cap: 0.65 });
    M('pelvic_tilt_frontal', 'Pelvic obliquity (static)', r1(rollOf(LM.L_HIP, LM.R_HIP)), '°', { conf: q0 * frontFit * 0.8, ref: { normal: '< 3°', source: 'clinical convention' }, method: 'Roll of the hip-to-hip line, 3D world landmarks', plane: 'frontal', cap: 0.65 });
    // knee alignment (frontal) and resting knee flexion
    ['left', 'right'].forEach(sd_ => {
      const k = median(win.map(f => 180 - ME.angleBetween(V.sub(f.world[ME.idx('HIP', sd_)], f.world[ME.idx('KNEE', sd_)]), V.sub(f.world[ME.idx('ANKLE', sd_)], f.world[ME.idx('KNEE', sd_)]))));
      M('standing_knee_flexion_' + sd_, `Standing knee flexion (${sd_})`, r1(k), '°', { conf: q0 * 0.85, side: sd_, ref: { normal: '0–5°', source: 'clinical convention' }, method: '180° − interior femur–tibia angle (3D)', plane: 'sagittal', cap: 0.8 });
    });
    // weight-shift proxy: pelvis position between the ankles (front/back views)
    const ankMid = win.map(f => (px(f, LM.L_ANKLE).x + px(f, LM.R_ANKLE).x) / 2), ankSep = win.map(f => Math.abs(px(f, LM.L_ANKLE).x - px(f, LM.R_ANKLE).x));
    const sepM = median(ankSep);
    if (yaw < 45 && sepM > 0.08 * L) {
      const off = mean(winHip.map((p, i) => p.x - ankMid[i])) / sepM * 100; // + = toward image right
      // subject-left appears image-right when facing the camera (yaw<45 & not mirrored)
      M('weight_shift', 'Pelvis shift between the feet (weight-bearing proxy; + = toward left foot)', r1(off), '% of foot separation', { conf: q0 * frontFit * 0.5, ref: { normal: '≈ 0% (centred)', source: 'proxy — not a force measurement' }, method: 'Lateral position of the pelvis relative to the mid-point of the ankles', plane: 'frontal', source: 'pose-2d', cap: 0.45 });
    }
    // single-limb stance capability (any point in the recording)
    const lift = (side) => { let bestRun = 0, cur = 0; usable.forEach((f, i) => { const yl = px(f, LM.L_ANKLE).y, yr = px(f, LM.R_ANKLE).y; const lifted = side === 'left' ? (yr - yl) > 0.12 * L : (yl - yr) > 0.12 * L; if (lifted && sps[i] != null && sps[i] < 0.35) { cur++; bestRun = Math.max(bestRun, cur); } else cur = 0; }); return bestRun / fps; };
    out.singleLimbStance = { standingOnRightSec: r1(lift('left')), standingOnLeftSec: r1(lift('right')), note: 'Duration the OPPOSITE foot was clearly lifted while the pelvis stayed steady; 0 = not observed (not necessarily unable).' };
    out.trackQ = r2(trackQ);
    return out;
  }

  // ------------------------------------------------------------------ assistive-device recommendation
  const DEVICES = {
    none: 'No walking aid indicated on observed findings',
    cane: 'Single-point cane', quad_cane: 'Quad cane (small-base)', walker: 'Walking frame / rollator',
    forearm: 'Forearm (Lofstrand) crutches', axillary: 'Axillary crutches', wheelchair: 'Wheelchair', other: 'Other / further assessment needed'
  };
  // clinical: { wbStatus:'full'|'partial'|'non'|'unknown', wbSide:'left'|'right'|'both'|'', ueFunction:'good'|'fair'|'poor'|'unknown' }
  function recommendDevice(features, clinical) {
    clinical = clinical || {};
    const f = features || {};
    const notDeterminable = [];
    const checks = ['Grip strength and wrist/elbow/shoulder weight-bearing tolerance of both arms (functional upper-limb loading cannot be tested from video)',
      'Cognition, vision, and ability to learn/use the device safely', 'Home/community environment (stairs, thresholds, surfaces, distances)',
      'Weight-bearing precautions and medical restrictions (surgeon/physician orders)', 'Pain, fatigue, cardiopulmonary tolerance, orthostatic BP where relevant', 'Trial of the device with a therapist (fit, gait pattern, safety) before issuing'];
    const scores = {}; const why = {}; const against = {};
    Object.keys(DEVICES).forEach(k => { scores[k] = 0; why[k] = []; against[k] = []; });
    const add = (k, pts, reason) => { scores[k] += pts; (pts >= 0 ? why : against)[k].push(reason); };
    const has = (v) => v != null && isFinite(v);

    // instability score from measured findings
    const inst = [];
    if (has(f.swayRmsCm) && f.swayRmsCm > 2.5) inst.push(`postural sway ${f.swayRmsCm} cm RMS`);
    if (has(f.trunkLeanSag) && Math.abs(f.trunkLeanSag) > 12) inst.push(`trunk lean ${f.trunkLeanSag}°`);
    if (has(f.trunkLeanFront) && Math.abs(f.trunkLeanFront) > 7) inst.push(`sideways trunk lean ${f.trunkLeanFront}°`);
    if (has(f.strideCV) && f.strideCV > 8) inst.push(`irregular rhythm (stride CV ${f.strideCV}%)`);
    if (has(f.stepWidth) && f.stepWidth > 15) inst.push(`wide base (${f.stepWidth} cm)`);
    if (has(f.trunkSwayWalk) && f.trunkSwayWalk > 4) inst.push(`trunk sway while walking ${f.trunkSwayWalk} cm`);
    const instab = inst.length;
    const asym = [];
    if (has(f.stanceSI) && f.stanceSI > 12) asym.push(`stance asymmetry ${f.stanceSI}%`);
    if (has(f.stepTimeSI) && f.stepTimeSI > 12) asym.push(`step-time asymmetry ${f.stepTimeSI}%`);
    if (has(f.stepLengthSI) && f.stepLengthSI > 15) asym.push(`step-length asymmetry ${f.stepLengthSI}%`);
    const dataPoints = [f.swayRmsCm, f.trunkLeanSag, f.trunkLeanFront, f.strideCV, f.stanceSI, f.stepTimeSI, f.cadence, f.gaitSpeed].filter(has).length;
    const ue = clinical.ueFunction || 'unknown', wb = clinical.wbStatus || 'unknown';
    const unilateralWB = (wb === 'partial' || wb === 'non') && (clinical.wbSide === 'left' || clinical.wbSide === 'right');
    const walkObserved = f.walkObserved !== false && (f.steps == null || f.steps >= 3);

    if (!walkObserved) {
      add('wheelchair', 2, 'walking with sufficient steps was not observed in the recording');
      notDeterminable.push('Walking ability — fewer than 3 steps were captured, so ambulation aids cannot be ranked from movement data. Record a longer walk (≥ 6 m, at least 6 steps).');
    }
    if (instab === 0 && !asym.length && !unilateralWB && dataPoints >= 3 && walkObserved) add('none', 4, 'no instability, asymmetry, or weight-bearing restriction was measured');
    if (unilateralWB) {
      const sideTxt = clinical.wbSide;
      add('forearm', 3, `${wb}-weight-bearing restriction on the ${sideTxt} lower limb (clinician-entered)`);
      add('axillary', 2.5, `${wb}-weight-bearing restriction on the ${sideTxt} lower limb (clinician-entered) — short-term option`);
      add('walker', 1.5, 'walking frame gives the most stable support for a restricted limb');
      add('cane', -2, 'a single cane does not offload a partial/non-weight-bearing limb adequately');
      if (wb === 'non') add('quad_cane', -2, 'a cane cannot substitute for non-weight-bearing');
    }
    if (asym.length && !unilateralWB) { add('cane', 2.5, `unilateral involvement suggested (${asym.join(', ')}) — cane in the hand OPPOSITE the weaker limb`); add('quad_cane', 1.5, `asymmetry (${asym.join(', ')}) with need for a wider base`); }
    if (instab >= 1 && instab <= 2) { add('cane', 1.5, `mild–moderate instability (${inst.join(', ')})`); add('quad_cane', 2, `mild–moderate instability (${inst.join(', ')}) needs a wider base of support`); add('walker', 1.5, 'moderate instability'); }
    if (instab >= 3) { add('walker', 4, `marked instability (${inst.join(', ')})`); add('cane', -3, 'a cane is unlikely to give enough support for this level of instability'); add('quad_cane', -1, 'marked instability'); if (!walkObserved) add('wheelchair', 1, 'marked instability'); }
    if (instab >= 4 && ue === 'poor') add('wheelchair', 3, 'marked instability with poor upper-limb function (clinician-entered)');
    // upper-limb capacity
    if (ue === 'good') { add('forearm', 1, 'good upper-limb function (clinician-entered)'); add('axillary', 0.5, 'good upper-limb function (clinician-entered)'); add('walker', 0.5, 'good upper-limb function (clinician-entered)'); }
    if (ue === 'poor') { ['forearm', 'axillary', 'quad_cane', 'cane'].forEach(k => add(k, -3, 'poor upper-limb function (clinician-entered) limits crutch/cane use')); add('walker', -1.5, 'poor upper-limb function limits frame propulsion (consider a wheeled/platform frame)'); add('wheelchair', 1.5, 'poor upper-limb function (clinician-entered)'); }
    if (f.slsObserved && f.slsBestSec === 0) notDeterminable.push('Single-limb stance ability — not observed in this recording (that does not mean the patient is unable). Test it formally, e.g. a timed 10 s single-leg stance on each side.');
    if (ue === 'unknown') notDeterminable.push('Upper-limb strength and weight-bearing capacity — not entered and not assessable from video.');
    if (wb === 'unknown') notDeterminable.push('Weight-bearing status/precautions — not entered; strongly affects crutch vs frame vs cane choice.');
    if (dataPoints < 3) notDeterminable.push('Too few reliable balance/gait measurements were obtained to score devices with confidence.');

    const ranked = Object.keys(DEVICES).filter(k => k !== 'other').map(k => ({ key: k, device: DEVICES[k], score: Math.round(scores[k] * 10) / 10, reasons: why[k], cautions: against[k] })).sort((a, b) => b.score - a.score);
    let primary = ranked[0], undetermined = false;
    if (!primary || primary.score <= 0.5) { undetermined = true; primary = { key: 'other', device: DEVICES.other, score: 0, reasons: ['The measured/entered findings do not clearly favour one device — clinical assessment and a device trial are needed.'], cautions: [] }; }
    const alternatives = ranked.filter(r => r.key !== primary.key && r.score > 0 && r.score >= primary.score - 2).slice(0, 2);
    const conf = clamp(0.25 + 0.08 * dataPoints + (wb !== 'unknown' ? 0.1 : 0) + (ue !== 'unknown' ? 0.1 : 0), 0.2, 0.75);
    return { primary, alternatives, ranked, instability: { count: instab, findings: inst }, asymmetry: asym, confidence: r2(conf), confidenceLabel: confLabel(conf), undetermined,
      notDeterminable, clinicalChecks: checks, basis: 'Transparent rule-based scoring of MEASURED findings + clinician-entered inputs. It supports, and never replaces, clinical judgement.' };
  }

  // ------------------------------------------------------------------ fitting measurements
  // Stature ratios: Drillis & Contini 1966 (Winter, Biomechanics and Motor Control of Human Movement).
  const RATIO = { trochanter: 0.530, elbow: 0.630, shoulder: 0.818, knee: 0.285, thigh: 0.245, shank: 0.246, ankle: 0.039, hipBreadth: 0.191 };
  function fittingMeasurements(heightCm, deviceKey, videoSegments) {
    if (!heightCm) return { available: false, reason: 'Patient height was not entered, so no fitting estimates are given. Enter the height (cm) and re-run, or measure directly.', manual: manualMeasurements(deviceKey) };
    const H = heightCm, cm = (r) => r1(H * r);
    const basis = 'Stature ratio (Drillis & Contini 1966) — population estimate; verify by direct measurement';
    const rows = [];
    const add = (name, value, note) => rows.push({ name, value, unit: 'cm', basis, confidence: 'Estimate', note });
    if (['cane', 'quad_cane', 'walker', 'forearm', 'axillary'].includes(deviceKey)) add('Handgrip height (greater-trochanter / wrist-crease level)', cm(RATIO.trochanter), 'Patient standing in shoes with arm relaxed: grip should meet the wrist crease; elbow should then flex 20–30° on gripping.');
    if (deviceKey === 'forearm') add('Forearm-cuff top height (just below olecranon)', r1(H * RATIO.elbow - 3), 'Cuff sits ≈ 2.5–4 cm below the olecranon; adjust so the cuff does not press the elbow.');
    if (deviceKey === 'axillary') add('Overall axillary-crutch length (floor → axillary pad)', cm(0.77), 'Rule of thumb 77% of height; verify ≈ 5 cm (2–3 finger-widths) between the pad and the axilla, weight through the hands, not the axilla.');
    if (deviceKey === 'wheelchair') {
      add('Seat width (hip breadth + ≈ 5 cm)', r1(H * RATIO.hipBreadth + 5), 'Measure actual sitting hip breadth and add ≈ 2 in / 5 cm.');
      add('Seat depth (≈ thigh length + 1 cm; buttock–popliteal − 5 cm)', r1(H * RATIO.thigh + 1), 'Measure buttock-to-popliteal length and subtract ≈ 5 cm.');
      add('Leg-rest length (≈ knee height)', cm(RATIO.knee), 'Measure popliteal-to-heel length with the shoe on; allow footplate ground clearance.');
    }
    let crossCheck = null;
    if (videoSegments && videoSegments.thighM && videoSegments.shankM) {
      const predT = H / 100 * RATIO.thigh, predS = H / 100 * RATIO.shank;
      const dT = Math.abs(videoSegments.thighM - predT) / predT, dS = Math.abs(videoSegments.shankM - predS) / predS;
      crossCheck = { thighMeasuredCm: r1(videoSegments.thighM * 100), thighPredictedCm: r1(predT * 100), shankMeasuredCm: r1(videoSegments.shankM * 100), shankPredictedCm: r1(predS * 100), consistent: dT < 0.15 && dS < 0.15,
        note: (dT < 0.15 && dS < 0.15) ? 'Video-derived limb segment lengths agree with the height-based estimate (±15%).' : 'Video-derived segment lengths differ from the height-based estimate by more than 15% (proportions, camera distance, or tracking error) — measure by hand.' };
    }
    return { available: true, heightCm: H, estimates: rows, crossCheck, manual: manualMeasurements(deviceKey), confidence: 'Estimate — not a substitute for direct measurement' };
  }
  function manualMeasurements(deviceKey) {
    const base = ['Standing height (barefoot) and footwear used', 'Wrist-crease height from the floor (arm relaxed at side)'];
    if (deviceKey === 'wheelchair') return base.concat(['Sitting hip breadth', 'Buttock–popliteal length', 'Popliteal-to-heel length (with shoe)', 'Seat-to-axilla / seat-to-scapula height (backrest)', 'Seat-to-olecranon height (armrest)']);
    if (deviceKey === 'axillary' || deviceKey === 'forearm') return base.concat(['Axilla-to-floor height (axillary) / olecranon-to-floor (forearm)', 'Elbow flexion angle (20–30°) with the hand on the grip']);
    return base.concat(['Greater-trochanter height from the floor', 'Elbow flexion angle (20–30°) with the hand on the grip']);
  }

  // Full assistive-device assessment over ONE recording: quiet standing + walking.
  function assessAssistive(samples, opts) {
    opts = opts || {};
    const usable = usableSamples(samples);
    const out = { kind: 'assistive', measurements: [], flags: [], notes: [], deviations: [] };
    const posture = analyzePosture(samples, opts);
    // walking segment = everything after the quiet-standing window (or the whole clip)
    const walkStart = posture.quietWindow ? usable.findIndex(f => f.t >= usable[0].t + posture.quietWindow.startSec + posture.quietWindow.durationSec) : 0;
    const walkSamples = walkStart > 0 ? usable.slice(walkStart) : usable;
    const gait = analyzeGait(walkSamples, { view: opts.view || 'side', heightCm: opts.heightCm });
    out.posture = posture; out.gait = gait;
    out.measurements = posture.measurements.concat(gait.measurements);
    out.deviations = gait.deviations.slice();
    out.flags = Array.from(new Set(posture.flags.concat(gait.flags)));
    out.notes = posture.notes.concat(gait.notes);
    const g = (id) => { const m = gait.measurements.find(x => x.id === id); return m && m.reliable ? m.value : null; };
    const p = (id) => { const m = posture.measurements.find(x => x.id === id); return m && m.reliable ? m.value : null; };
    const sls = posture.singleLimbStance;
    const features = {
      walkObserved: !gait.flags.includes('FEW_STEPS') && !gait.flags.includes('TOO_FEW_FRAMES') && !gait.flags.includes('LITTLE_FORWARD_PROGRESSION'),
      steps: gait.quality ? gait.quality.steps : 0,
      swayRmsCm: p('sway_rms'), trunkLeanSag: p('trunk_lean_sagittal') != null ? p('trunk_lean_sagittal') : g('trunk_lean_sagittal'), trunkLeanFront: p('trunk_lean_frontal') != null ? p('trunk_lean_frontal') : g('trunk_lean_frontal'),
      strideCV: g('stride_time_variability'), stepWidth: g('step_width'), trunkSwayWalk: g('trunk_sway'), stanceSI: g('stance_symmetry'), stepTimeSI: g('step_time_symmetry'), stepLengthSI: g('step_length_symmetry'),
      cadence: g('cadence'), gaitSpeed: g('gait_speed'), slsObserved: !!sls, slsBestSec: sls ? Math.max(sls.standingOnLeftSec, sls.standingOnRightSec) : null
    };
    out.features = features;
    out.recommendation = recommendDevice(features, { wbStatus: opts.wbStatus, wbSide: opts.wbSide, ueFunction: opts.ueFunction });
    // segment lengths from the 3D landmarks for the fitting cross-check
    let seg = null;
    if (usable.length) seg = { thighM: median(usable.map(f => (V.dist(f.world[LM.L_HIP], f.world[LM.L_KNEE]) + V.dist(f.world[LM.R_HIP], f.world[LM.R_KNEE])) / 2)), shankM: median(usable.map(f => (V.dist(f.world[LM.L_KNEE], f.world[LM.L_ANKLE]) + V.dist(f.world[LM.R_KNEE], f.world[LM.R_ANKLE])) / 2)) };
    out.fitting = fittingMeasurements(opts.heightCm, out.recommendation.primary.key, seg);
    out.fittingAlternatives = out.recommendation.alternatives.map(a => ({ device: a.device, fitting: fittingMeasurements(opts.heightCm, a.key, seg) }));
    return out;
  }

  Object.assign(ME, { analyzeGait, analyzePosture, recommendDevice, fittingMeasurements, assessAssistive, DEVICES, GAIT_REF: REF });
})();
if (typeof module !== 'undefined' && module.exports) module.exports = window.MotionEngine;
