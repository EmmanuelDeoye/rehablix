// js/patient-context.js — shared clinical-context builder for a Smart EMR
// patient (Smart EMR SPA Integration & AI Upgrade). Consumed by BOTH
// js/views/emr-view.js (Smart EMR's own AI generation) and js/ask.js
// (Lixa chat's findPatientContext) so both draw on one real context
// source instead of two separate ad hoc ones. Read-only — never writes
// anything, and only ever returns what's actually recorded; callers are
// responsible for telling their AI prompt to treat this as fact, not to
// invent beyond it.
(function () {
  function stripMarkdown(text) {
    if (!text) return '';
    return String(text)
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .trim();
  }

  // Compact summaries of Motion/standardized-assessment records already
  // linked to this patient (js/views/emr-view.js's linkRecord() stores a
  // structured entry alongside the plain-text one it always stored) —
  // actual measured values when available, not just "see Assessment".
  function summarizeLinkedRecords(patient) {
    const linked = (patient && patient.linkedRecords) || [];
    if (!linked.length) return [];
    return linked.slice(-8).map((r) => {
      const measurements = r && r.structuredSummary && Array.isArray(r.structuredSummary.measurements)
        ? r.structuredSummary.measurements
        : null;
      if (measurements && measurements.length) {
        const meas = measurements
          .filter((m) => m && m.value != null)
          .slice(0, 6)
          .map((m) => `${m.name}: ${m.value}${m.unit || ''}${m.side ? ' (' + m.side + ')' : ''}`)
          .join(', ');
        return `${r.type} (${r.date}): ${meas || 'no reliable measurements recorded'}`;
      }
      return `${(r && r.type) || 'Linked record'} (${(r && r.date) || ''}): linked — see Assessment for details`;
    });
  }

  // Recorded per-problem progress ratings (only present when the AI
  // Progress Assistant's structured save — Phase B #3 — has been used at
  // least once); never fabricated if absent.
  function summarizeProgress(patient) {
    const notes = (patient && patient.progressNotes) || [];
    if (!notes.length) return { latest: '', latestDate: null, trend: [] };
    const sorted = [...notes].sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
    const latest = sorted[sorted.length - 1];
    const trend = sorted
      .filter((n) => Array.isArray(n.ratings) && n.ratings.length)
      .slice(-5)
      .map((n) => `${n.date}: ` + n.ratings.map((r) => `${r.problemTitle || 'problem'} — ${r.rating}`).join('; '));
    return { latest: stripMarkdown(latest.content || ''), latestDate: latest.date || null, trend };
  }

  // Builds the shared context object for one patient. Pass an
  // already-loaded `patient` object (Smart EMR always has one in memory)
  // to skip a Firebase read; otherwise it's fetched fresh.
  async function build(scopeUid, patientId, patient) {
    if (!scopeUid || !patientId) return null;
    if (!patient) {
      const snap = await firebase.database().ref(`history/${scopeUid}/patients/${patientId}`).once('value');
      patient = snap.val();
    }
    if (!patient) return null;

    const problems = patient.problemList || [];
    const plans = patient.treatmentPlans || [];
    const latestPlan = plans.length ? [...plans].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))[0] : null;
    const sessions = patient.sessions ? Object.values(patient.sessions) : [];
    const progress = summarizeProgress(patient);

    return {
      patientId,
      name: patient.name || 'Patient',
      diagnosis: patient.primaryDx || '',
      chiefComplaint: patient.chiefComplaint || '',
      goals: patient.goals || '',
      category: patient.category || '',
      profession: patient.profession || patient.department || '',
      state: patient.state || '',
      assessment: patient.assessment || '',
      status: patient.status || (patient.active === false ? 'discharged' : 'active'),
      problems: problems.map((p) => ({ id: p.id, title: p.title, detail: p.detail })),
      latestTreatmentPlan: latestPlan ? { title: latestPlan.title, content: latestPlan.content, date: latestPlan.date } : null,
      treatmentPlanCount: plans.length,
      sessionCount: sessions.length,
      latestProgress: progress.latest,
      latestProgressDate: progress.latestDate,
      progressTrend: progress.trend,
      linkedClinicalResults: summarizeLinkedRecords(patient),
      dischargeSummaryCount: (patient.dischargeSummaries || []).length
    };
  }

  // Compact plain-text rendering for dropping straight into an AI prompt.
  // Defensive against a partial/fallback context object (only
  // name/diagnosis/assessment) as well as the full build() shape, since
  // callers may fall back to a minimal shape if this module ever fails to
  // load in time.
  function toPromptText(ctx) {
    if (!ctx) return '';
    const lines = [];
    lines.push(`Patient: ${ctx.name || 'Patient'}`);
    if (ctx.diagnosis) lines.push(`Diagnosis: ${ctx.diagnosis}`);
    if (ctx.chiefComplaint) lines.push(`Chief Complaint: ${ctx.chiefComplaint}`);
    if (ctx.goals) lines.push(`Functional Goals: ${ctx.goals}`);
    if (ctx.assessment) lines.push(`Assessment/Intake notes: ${ctx.assessment}`);
    if (Array.isArray(ctx.problems) && ctx.problems.length) {
      lines.push(`Identified problems:\n${ctx.problems.map((p) => `- ${p.title}${p.detail ? ': ' + p.detail : ''}`).join('\n')}`);
    }
    if (ctx.latestTreatmentPlan) {
      lines.push(`Latest treatment plan (${ctx.latestTreatmentPlan.date}):\n${ctx.latestTreatmentPlan.content}`);
    }
    if (ctx.sessionCount != null) lines.push(`Sessions completed: ${ctx.sessionCount}`);
    if (ctx.latestProgress) lines.push(`Most recent progress note (${ctx.latestProgressDate || ''}):\n${ctx.latestProgress}`);
    if (Array.isArray(ctx.progressTrend) && ctx.progressTrend.length) {
      lines.push(`Recorded per-problem progress ratings over time:\n${ctx.progressTrend.join('\n')}`);
    }
    if (Array.isArray(ctx.linkedClinicalResults) && ctx.linkedClinicalResults.length) {
      lines.push(`Linked clinical-tool results (Motion/standardized assessments):\n${ctx.linkedClinicalResults.join('\n')}`);
    }
    return lines.join('\n\n');
  }

  window.RehablixPatientContext = { build, toPromptText, stripMarkdown };
})();
