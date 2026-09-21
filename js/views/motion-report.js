// js/views/motion-report.js — structured Motion records: build, render, summarise.
//
// A Motion result is stored as ONE structured object (schema
// "rehablix.motion.v1") next to its human-readable report. Everything
// downstream — the results screen, the review/confirm step, Smart EMR's
// linked records, and Lixa — reads this same object, so a measurement keeps
// its method, reference, source and confidence wherever it travels.
//
//   status  'draft'      produced by the tool, NOT yet reviewed by a clinician
//           'confirmed'  reviewed; only items the clinician left ticked are
//                        part of the confirmed clinical finding
//
// MEASURED data (measurements[], findings[]) is kept strictly apart from the
// AI's interpretation (interpretation.text). Pure functions, no DOM/network.
(function () {
  const MR = (window.MotionReport = window.MotionReport || {});
  const SCHEMA = 'rehablix.motion.v1';
  MR.SCHEMA = SCHEMA;
  const ME = () => window.MotionEngine;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clean = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === undefined || (typeof v === 'number' && !isFinite(v)) ? null : v)));

  const KIND_LABEL = { rom: 'Range of Motion', gait: 'Gait Analysis', assistive: 'Assistive Device Assessment' };
  MR.KIND_LABEL = KIND_LABEL;
  const FLAG_TEXT = () => (ME() && ME().FLAG_TEXT) || {};
  const flagText = (f) => FLAG_TEXT()[f] || ({ LITTLE_FORWARD_PROGRESSION: 'The person barely progressed across the frame.', FEW_STEPS: 'Too few steps were captured for timing/symmetry measures.', NO_QUIET_STANDING: 'No steady standing period was found.', LOW_CONFIDENCE_WITHHELD: 'Value withheld — confidence too low to present as a measurement.' }[f]) || f;

  const POSE_METHOD = 'MediaPipe BlazePose (3D world landmarks, temporal smoothing) — browser-based markerless tracking; not a substitute for goniometry or laboratory gait analysis';

  // ------------------------------------------------------------------ deterministic findings (MEASURED, not AI)
  function findingsFrom(kind, measurements, deviations, recommendation) {
    const out = [];
    measurements.filter(m => m.reliable && m.value != null).forEach(m => {
      if (kind === 'rom') {
        const norm = m.reference && m.reference.normal;
        const pct = m.pctOfNormal != null ? ` (${m.pctOfNormal}% of the ${norm}° reference)` : '';
        out.push({ id: 'f_' + m.id, text: `${m.name}${m.side && m.side !== 'midline' ? ' (' + m.side + ')' : ''}: ${m.value}${m.unit}${pct}`, source: 'measured', measurementId: m.id, include: true });
      }
    });
    (deviations || []).forEach(d => out.push({ id: 'd_' + d.id, text: `${d.label} — ${d.evidence}`, source: 'measured', include: true }));
    if (recommendation && recommendation.primary) {
      out.push({ id: 'rec', text: `Suggested device category from measured findings: ${recommendation.primary.device}${recommendation.undetermined ? ' (insufficient data to rank)' : ''}`, source: 'rule-based', include: true });
    }
    return out;
  }

  // ------------------------------------------------------------------ builder
  // input: { kind, patient:{name, emrPatientId, heightCm}, prefs, quality, poseModel, analyses (rom[]), gait, assistive, title, interpretation }
  MR.build = function (inp) {
    const kind = inp.kind;
    let measurements = [], compensations = [], movementSummaries = [], deviations = [], limitations = [], notDeterminable = [], extra = {};
    if (kind === 'rom') {
      (inp.analyses || []).forEach(a => {
        if (a.measurable === false) { movementSummaries.push({ key: a.key, name: a.name, measurable: false, note: a.note, flags: a.flags }); notDeterminable.push(`${a.name}: ${a.note}`); return; }
        if (!a.measurements.length) { movementSummaries.push({ key: a.key, name: a.name, measurable: true, reliable: false, note: a.note, flags: a.flags }); notDeterminable.push(`${a.name}: ${a.note || 'not measurable from this capture'}`); return; }
        a.measurements.forEach(m => measurements.push(m));
        movementSummaries.push({ key: a.key, name: a.name, measurable: true, reliable: a.reliable, side: a.side, sideMethod: a.sideMethod, plane: a.plane, start: a.start, peak: a.peak, excursion: a.excursion, basis: a.basis,
          quality: a.quality, compensations: a.compensations, planeDeviationDeg: a.planeDeviationDeg, viewYaw: a.viewYaw, coverage: a.coverage, meanVisibility: a.meanVisibility, confidence: a.confidence, flags: a.flags, series: a.series, method: a.method });
        (a.compensations || []).filter(c => c.flagged).forEach(c => deviations.push({ id: `${a.key}_${c.id}`, label: `${a.name}: compensatory ${c.label.toLowerCase()}`, evidence: `${c.max}${c.unit} (screening threshold ${c.threshold}${c.unit})` }));
      });
      limitations.push('Angles are landmark-based estimates from one camera (3D world landmarks); goniometer/inclinometer readings remain the reference standard.');
    } else if (kind === 'gait') {
      const g = inp.gait || {};
      measurements = g.measurements || []; deviations = g.deviations || [];
      extra = { events: g.quality, scale: g.scale, view: g.view, notes: g.notes };
      notDeterminable = (g.notes || []).slice();
      limitations.push('Timing, step length, and clearance are derived from image-space foot trajectories; a level camera square to the walkway is assumed. Not equivalent to instrumented gait analysis.');
    } else if (kind === 'assistive') {
      const a = inp.assistive || {};
      measurements = a.measurements || []; deviations = a.deviations || [];
      extra = { posture: a.posture && { quietWindow: a.posture.quietWindow, singleLimbStance: a.posture.singleLimbStance }, gaitEvents: a.gait && a.gait.quality, scale: a.gait && a.gait.scale, recommendation: a.recommendation, fitting: a.fitting, fittingAlternatives: a.fittingAlternatives, features: a.features, clinicalInputs: inp.clinicalInputs };
      notDeterminable = (a.notes || []).concat((a.recommendation && a.recommendation.notDeterminable) || []);
      limitations.push('Recommendation is rule-based on measured video findings plus clinician-entered inputs. It supports, and never replaces, clinical assessment and a device trial.');
      limitations.push('Fitting estimates come from stature ratios; verify every dimension by direct measurement before ordering or adjusting a device.');
    }
    measurements.forEach(m => { m.include = !!(m.reliable && m.value != null); });
    const flags = Array.from(new Set([].concat((inp.quality && inp.quality.flags) || [], measurements.flatMap(m => m.flags || []).filter(f => f !== 'LOW_CONFIDENCE_WITHHELD'), (inp.gait && inp.gait.flags) || [], (inp.assistive && inp.assistive.flags) || [])));
    if (inp.quality && inp.quality.label === 'Poor') limitations.unshift('Overall capture quality was POOR — treat every value with caution and consider repeating the capture.');
    const rec = kind === 'assistive' && inp.assistive ? inp.assistive.recommendation : null;
    const rec2 = clean({
      schema: SCHEMA, kind, kindLabel: KIND_LABEL[kind], title: inp.title, status: 'draft',
      createdAt: new Date().toISOString(), confirmedAt: null, confirmedBy: null,
      patient: inp.patient || {}, prefs: inp.prefs || {},
      capture: Object.assign({ method: POSE_METHOD, poseModel: inp.poseModel || 'MediaPipe BlazePose' }, { quality: inp.quality || null }),
      measurements, movements: movementSummaries, deviations, extra, flags,
      findings: findingsFrom(kind, measurements, deviations, rec),
      limitations, notDeterminable,
      interpretation: inp.interpretation ? { source: 'ai', text: inp.interpretation, note: 'AI interpretation of the measured data and captured images. Not measured; may contain errors; clinician review required.' } : null
    });
    return rec2;
  };

  // ------------------------------------------------------------------ plain-text summaries
  const line = (m) => `${m.name}${m.side && m.side !== 'both' && m.side !== 'midline' ? ' [' + m.side + ']' : ''}: ${m.value}${m.unit || ''} — ${m.confidenceLabel} confidence${m.reference && m.reference.normal != null ? `; ref ${m.reference.normal}${typeof m.reference.normal === 'number' ? '°' : ''} (${m.reference.source})` : (m.reference && typeof m.reference.normal === 'string' ? `; ref ${m.reference.normal}` : '')}`;
  // Clinical-record text. Only INCLUDED items; states plainly whether it has been clinician-confirmed.
  MR.clinicalNote = function (s) {
    if (!s) return '';
    const d = new Date(s.confirmedAt || s.createdAt);
    const status = s.status === 'confirmed' ? `CONFIRMED by ${s.confirmedBy || 'clinician'} on ${d.toLocaleDateString()}` : 'DRAFT — automated measurement, NOT yet reviewed/confirmed by a clinician';
    const L = [`MOTION ASSESSMENT — ${s.kindLabel}${s.title ? ' — ' + s.title : ''}`, `Date: ${d.toLocaleDateString()}  |  Status: ${status}`];
    if (s.patient && s.patient.name) L.push(`Patient: ${s.patient.name}${s.patient.heightCm ? ` (height ${s.patient.heightCm} cm)` : ''}`);
    L.push(`Method: ${POSE_METHOD}`);
    if (s.capture && s.capture.quality) L.push(`Capture quality: ${s.capture.quality.label} (${s.capture.quality.durationSec || '?'} s, ${s.capture.quality.trackedFrames || '?'} tracked frames)`);
    const inc = (s.measurements || []).filter(m => m.include && m.value != null);
    L.push('', 'MEASURED (instrument-derived):');
    L.push(...(inc.length ? inc.map(m => ' • ' + line(m)) : [' • None met the reliability threshold or were selected.']));
    const fi = (s.findings || []).filter(f => f.include);
    if (fi.length) { L.push('', 'FINDINGS:'); fi.forEach(f => L.push(' • ' + f.text + (f.source === 'rule-based' ? ' [rule-based suggestion]' : ''))); }
    if (s.kind === 'assistive' && s.extra && s.extra.recommendation) {
      const r = s.extra.recommendation;
      L.push('', `DEVICE RECOMMENDATION (rule-based, ${r.confidenceLabel} confidence): ${r.primary.device}`);
      (r.primary.reasons || []).forEach(x => L.push('   – ' + x));
      if ((r.alternatives || []).length) L.push('   Alternatives: ' + r.alternatives.map(a => a.device).join('; '));
      const f = s.extra.fitting;
      if (f && f.available) { L.push('FITTING ESTIMATES (stature-ratio; verify by measurement):'); (f.estimates || []).forEach(e => L.push(`   – ${e.name}: ${e.value} ${e.unit}`)); }
      else if (f) L.push('FITTING: ' + f.reason);
    }
    if (s.notDeterminable && s.notDeterminable.length) { L.push('', 'NOT DETERMINABLE FROM THIS CAPTURE:'); s.notDeterminable.forEach(n => L.push(' • ' + n)); }
    if (s.limitations && s.limitations.length) { L.push('', 'LIMITATIONS:'); s.limitations.forEach(n => L.push(' • ' + n)); }
    return L.join('\n');
  };
  // Compact context block for pasting into a Lixa conversation.
  MR.lixaContext = function (s) {
    return `Here is a ${s.status === 'confirmed' ? 'clinician-confirmed' : 'DRAFT (unreviewed)'} Motion result from Rehablix. Use the MEASURED values as given; do not invent numbers.\n\n${MR.clinicalNote(s)}\n\nMy question: `;
  };

  // ------------------------------------------------------------------ HTML report
  function confBadge(m) {
    const cls = { High: 'hi', Moderate: 'mo', Low: 'lo', Unreliable: 'un' }[m.confidenceLabel] || 'un';
    return `<span class="mr-conf mr-conf-${cls}" title="Confidence ${m.confidence}">${esc(m.confidenceLabel)} · ${Math.round((m.confidence || 0) * 100)}%</span>`;
  }
  function spark(series, norm) {
    if (!series || series.length < 3) return '';
    const W = 260, H = 60, xs = series.map(p => p[0]), ys = series.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) || 1, y0 = Math.min(...ys, 0), y1 = Math.max(...ys, 1);
    const sx = (x) => ((x - x0) / ((x1 - x0) || 1)) * (W - 8) + 4, sy = (y) => H - 4 - ((y - y0) / ((y1 - y0) || 1)) * (H - 8);
    const pts = series.map(p => `${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ');
    return `<svg class="mr-spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Joint angle over time"><line x1="4" x2="${W - 4}" y1="${sy(0).toFixed(1)}" y2="${sy(0).toFixed(1)}" class="mr-spark-zero"/><polyline points="${pts}" class="mr-spark-line"/></svg>`;
  }
  function measRow(m) {
    const val = m.value != null ? `<strong>${esc(m.value)}${esc(m.unit)}</strong>` : `<em class="mr-na">Not reliably measurable</em>`;
    const ref = m.reference ? (typeof m.reference.normal === 'number' ? `${m.reference.normal}°` : esc(m.reference.normal || '')) : '—';
    const flags = (m.flags || []).filter(f => f !== 'LOW_CONFIDENCE_WITHHELD').map(f => `<div class="mr-flag">⚠ ${esc(flagText(f))}</div>`).join('');
    return `<tr class="${m.value == null ? 'mr-row-na' : ''}"><td class="mr-inc"><input type="checkbox" class="mr-include" data-mid="${esc(m.id)}" ${m.include ? 'checked' : ''} ${m.value == null ? 'disabled' : ''} aria-label="Include in the confirmed record"></td>
      <td>${esc(m.name)}${m.side && m.side !== 'both' && m.side !== 'midline' ? `<div class="mr-sub">${esc(m.side)}${m.sideMethod ? ' · ' + esc(m.sideMethod) : ''}</div>` : ''}${flags}</td>
      <td>${val}</td><td>${confBadge(m)}</td><td class="mr-ref">${ref}<div class="mr-sub">${esc((m.reference && m.reference.source) || '')}</div></td>
      <td class="mr-method">${esc(m.method || '')}<div class="mr-sub">source: ${esc(m.source || '')}${m.plane && m.plane !== 'n/a' ? ' · plane: ' + esc(m.plane) : ''}</div></td></tr>`;
  }
  function measTable(list) {
    if (!list.length) return '<p class="mr-na">No measurements were produced.</p>';
    return `<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th title="Include in the confirmed clinical record">✓</th><th>Measurement</th><th>Value</th><th>Confidence</th><th>Reference</th><th>Method / source</th></tr></thead><tbody>${list.map(measRow).join('')}</tbody></table></div>`;
  }
  MR.renderHtml = function (s, interpretationHtml) {
    if (!s) return '';
    const q = s.capture && s.capture.quality;
    const parts = [];
    parts.push(`<section class="mr-sec mr-measured"><h2>Measured data <span class="mr-tag mr-tag-measured">instrument-derived</span></h2>
      <p class="mr-note">${esc(POSE_METHOD)}.</p>
      ${q ? `<div class="mr-quality mr-q-${esc((q.label || '').toLowerCase())}"><strong>Capture quality: ${esc(q.label)}</strong> · ${q.durationSec || '?'} s · ${q.trackedFrames || '?'}/${q.frames || '?'} frames tracked · ${q.fps || '?'} fps · landmark visibility ${Math.round((q.meanVisibility || 0) * 100)}%${(q.flags || []).map(f => `<div class="mr-flag">⚠ ${esc(flagText(f))}</div>`).join('')}</div>` : ''}`);
    if (s.kind === 'rom') {
      (s.movements || []).forEach(mv => {
        const ms = s.measurements.filter(m => m.id === mv.key || m.id.startsWith(mv.key + '_'));
        parts.push(`<h3>${esc(mv.name)}</h3>`);
        if (mv.measurable === false) { parts.push(`<p class="mr-na">${esc(mv.note)}</p>`); return; }
        if (!ms.length) { parts.push(`<p class="mr-na">${esc(mv.note || 'Not measurable from this capture.')}</p>`); return; }
        parts.push(measTable(ms));
        parts.push(`<div class="mr-move"><div class="mr-move-chart">${spark(mv.series)}<div class="mr-sub">Joint angle over the movement (°, anatomical zero line shown)</div></div>
          <ul class="mr-facts"><li>Start position: <strong>${esc(mv.start)}°</strong> · end range: <strong>${esc(mv.peak)}°</strong> · excursion: <strong>${esc(mv.excursion)}°</strong></li>
          <li>Side: <strong>${esc(mv.side)}</strong> <span class="mr-sub">(${esc(mv.sideMethod || '')})</span> · plane: <strong>${esc(mv.plane)}</strong></li>
          ${mv.quality ? `<li>Movement quality: <strong>${esc(mv.quality.smoothness)}</strong> (${mv.quality.hesitations} hesitation${mv.quality.hesitations === 1 ? '' : 's'}${mv.quality.holdSD != null ? `, end-range hold SD ${mv.quality.holdSD}°` : ''}), duration ${mv.quality.durationSec}s</li>` : ''}
          ${mv.planeDeviationDeg != null ? `<li>Out-of-plane deviation at end range: ${esc(mv.planeDeviationDeg)}°</li>` : ''}
          <li>Camera view: subject ${esc(mv.viewYaw)}° from front-on (0° = facing camera, 90° = side-on)</li></ul></div>`);
        const comps = mv.compensations || [];
        if (comps.length) parts.push(`<div class="mr-comp"><strong>Compensation screen</strong> <span class="mr-sub">(screening thresholds; clinical judgement required)</span><ul>${comps.map(c => `<li class="${c.flagged ? 'mr-flagged' : ''}">${c.flagged ? '⚠ ' : '✓ '}${esc(c.label)}: ${esc(c.max)}${esc(c.unit)} <span class="mr-sub">(threshold ${esc(c.threshold)}${esc(c.unit)})</span></li>`).join('')}</ul></div>`);
      });
    } else {
      parts.push(measTable(s.measurements || []));
      if ((s.deviations || []).length) parts.push(`<div class="mr-comp"><strong>Observable deviations</strong> <span class="mr-sub">(screening flags derived from the measured values above)</span><ul>${s.deviations.map(d => `<li class="mr-flagged">⚠ ${esc(d.label)} — <span class="mr-sub">${esc(d.evidence)}</span></li>`).join('')}</ul></div>`);
      if (s.extra && s.extra.scale) parts.push(`<p class="mr-note">Distance scale: leg length ${esc(s.extra.scale.legLengthM)} m from ${esc(s.extra.scale.source)}.</p>`);
    }
    if (s.kind === 'assistive' && s.extra && s.extra.recommendation) {
      const r = s.extra.recommendation, f = s.extra.fitting;
      parts.push(`</section><section class="mr-sec mr-device"><h2>Assistive device <span class="mr-tag mr-tag-rule">rule-based on measured data</span></h2>
        <div class="mr-reco"><div class="mr-reco-head"><span class="mr-reco-label">${r.undetermined ? 'Not determinable' : 'Suggested category'}</span><strong>${esc(r.primary.device)}</strong><span class="mr-conf mr-conf-${{ High: 'hi', Moderate: 'mo', Low: 'lo', Unreliable: 'un' }[r.confidenceLabel]}">${esc(r.confidenceLabel)} · ${Math.round(r.confidence * 100)}%</span></div>
        <ul>${r.primary.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
        ${r.alternatives.length ? `<div class="mr-sub"><strong>Alternatives:</strong></div><ul>${r.alternatives.map(a => `<li><strong>${esc(a.device)}</strong> — ${esc((a.reasons || []).join('; '))}</li>`).join('')}</ul>` : ''}
        ${r.primary.cautions && r.primary.cautions.length ? `<div class="mr-sub"><strong>Cautions:</strong> ${esc(r.primary.cautions.join('; '))}</div>` : ''}
        <p class="mr-note">${esc(r.basis)}</p></div>
        <h3>Fitting measurements</h3>${f && f.available ? `<div class="mr-table-wrap"><table class="mr-table"><thead><tr><th>Dimension</th><th>Estimate</th><th>How to verify</th></tr></thead><tbody>${f.estimates.map(e => `<tr><td>${esc(e.name)}</td><td><strong>${esc(e.value)} ${esc(e.unit)}</strong><div class="mr-sub">${esc(e.confidence)} · ${esc(e.basis)}</div></td><td class="mr-method">${esc(e.note)}</td></tr>`).join('')}</tbody></table></div>${f.crossCheck ? `<p class="mr-note ${f.crossCheck.consistent ? '' : 'mr-flag'}">Video cross-check: thigh ${esc(f.crossCheck.thighMeasuredCm)} cm measured vs ${esc(f.crossCheck.thighPredictedCm)} cm predicted; lower leg ${esc(f.crossCheck.shankMeasuredCm)} vs ${esc(f.crossCheck.shankPredictedCm)} cm. ${esc(f.crossCheck.note)}</p>` : ''}` : `<p class="mr-na">${esc(f ? f.reason : 'No fitting estimates available.')}</p>`}
        ${f && f.manual ? `<div class="mr-sub"><strong>Measure directly:</strong></div><ul>${f.manual.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
        <h3>Assess before deciding</h3><ul>${r.clinicalChecks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`);
    }
    if (s.notDeterminable && s.notDeterminable.length) parts.push(`<div class="mr-cannot"><strong>Cannot be reliably determined from this video</strong><ul>${s.notDeterminable.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`);
    parts.push(`</section>`);
    if (interpretationHtml) parts.push(`<section class="mr-sec mr-ai"><h2>AI interpretation <span class="mr-tag mr-tag-ai">not measured data</span></h2><p class="mr-note">${esc((s.interpretation && s.interpretation.note) || 'AI-generated interpretation. Verify against the measured data above.')}</p><div class="mr-ai-body">${interpretationHtml}</div></section>`);
    if (s.limitations && s.limitations.length) parts.push(`<section class="mr-sec"><h3>Limitations</h3><ul class="mr-limits">${s.limitations.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>`);
    return parts.join('');
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = window.MotionReport;
