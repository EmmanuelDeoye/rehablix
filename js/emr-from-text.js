// js/emr-from-text.js — a Smart EMR patient from a case presentation or report.
//
// Used by Lixa chat (js/lixa.js), Lixa Agent (js/lixa-agent/agent-brain.js, emr_create_patient) and the
// result page of Case Presentation files (js/result.js). The user pastes or attaches a presentation / report and
// asks for the patient to be created in Smart EMR:
//   1. The patient's identifiers (name, date of birth, phone, age, sex) are read HERE, on the device, from the
//      text's own labels ("Name:", "DOB:", "Mr …", "a 45-year-old woman").
//   2. Those identifiers are taken out of the text, and only the de-identified text goes to the SI, which fills the
//      clinical intake (diagnosis, complaint, category, setting, goals, assessment). The patient's name, date of
//      birth and phone number are never sent to the SI.
//   3. The record is created in Smart EMR (the user's own records, or their center's) as a DRAFT with a
//      registration number, for the clinician to check and confirm there.
(function () {
  'use strict';

  const CATEGORIES = ['Psychiatry', 'Neurology', 'Orthopaedics', 'Paediatrics', 'Other'];
  const PROFESSIONS = ['Occupational Therapy', 'Physiotherapy', 'Consultant', 'Registrar', 'Nurse'];
  const STATES = ['Inpatient', 'Outpatient', 'Home Service', 'Telehealth'];

  // ------------------------------------------------------------------ the request
  const EMR = '(?:smart\\s*)?(?:emr|ehr|e\\.m\\.r|electronic\\s+(?:medical|health)\\s+records?|medical\\s+records?|patient\\s+records?)';
  const MAKE = '(?:create|add|make|open|register|enrol|enroll|save|set\\s*up|start|put|file|log|record|import|transfer|move|build)';
  const THING = '(?:patient|client|case|biodata|bio-data|intake|record|file|folder|profile|entry|chart)';
  const WANTS = [
    new RegExp('\\b' + MAKE + '\\b[\\s\\S]{0,60}\\b' + THING + '\\b[\\s\\S]{0,60}\\b(?:in|into|on|to|for)\\b[\\s\\S]{0,12}\\b' + EMR + '\\b', 'i'),
    new RegExp('\\b' + MAKE + '\\b[\\s\\S]{0,40}\\b(?:in|into|on|to)\\s+(?:the\\s+|my\\s+)?' + EMR + '\\b', 'i'),
    new RegExp('\\b' + EMR + '\\b[\\s\\S]{0,30}\\b(?:patient|record|file|biodata|intake)\\b[\\s\\S]{0,30}\\b(?:for|from)\\s+(?:this|the|it|that)\\b', 'i'),
    /\b(?:create|add|register|enrol|enroll|admit)\s+(?:this|the|a\s+new|new|a)\s+(?:patient|client)\b(?!['’]s)/i,
    // "create patient", "save this patient", "add patient to my records" (not "add the patient's pain score…")
    /\b(?:create|add|register|enrol|enroll|admit|save)\s+(?:(?:this|the|a|new|my|her|his|their)\s+){0,2}(?:patient|client)\b(?!['’]s)/i,
    // "open a new patient file", "create patient record"
    /\b(?:create|open|start|make|set\s*up)\s+(?:a\s+)?(?:new\s+)?(?:patient|client)\s+(?:file|record|folder|profile|chart)\b/i,
    // "create biodata and intake for this patient"
    /\b(?:create|fill|make|add|generate|do)\b[\s\S]{0,20}\bbio-?data\b/i
  ];
  const NOT = /\b(?:don'?t|do\s+not|never|without|no\s+need\s+to|how\s+(?:do|can|to)\s+i)\b[\s\S]{0,25}\b(?:create|add|make|open|register|save|put)\b/i;

  /** The user is asking for a patient to be created in Smart EMR (from a report or presentation). */
  function wants(text) {
    const t = String(text || '');
    if (!t.trim() || NOT.test(t)) return false;
    return WANTS.some(re => re.test(t));
  }

  // ------------------------------------------------------------------ identifiers, read on the device
  const TITLES = /^(?:mr|mrs|ms|miss|master|mx|dr|chief|alhaji|alhaja|mallam|madam|pastor|prof|engr|baby|bro|sis)\.?\s+/i;
  function field(text, labels) {
    const re = new RegExp('(?:^|[\\n;|•*])\\s*(?:' + labels + ')\\s*[:=\\-–—]\\s*([^\\n;|]{1,90})', 'i');
    const m = re.exec(text);
    return m ? m[1].trim().replace(/[.,]+$/, '') : '';
  }
  function cleanName(raw) {
    let n = String(raw || '').replace(/\s*[,(].*$/, '').replace(/\s+(?:aged?|is|was|a|an|who|with)\b.*$/i, '').replace(/\s+\d.*$/, '').trim();
    while (TITLES.test(n)) n = n.replace(TITLES, '');
    n = n.replace(/[^\p{L}' .\-]/gu, '').replace(/\s+/g, ' ').trim();
    const words = n.split(' ').filter(Boolean);
    if (words.length < 1 || words.length > 5 || n.length < 2 || n.length > 60) return '';
    if (/\b(?:unknown|n\/?a|nil|none|patient|client|male|female|years?|old)\b/i.test(n)) return '';
    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  /** A date of birth as YYYY-MM-DD (day first, as written in Nigeria and the UK), or '' when it can't be read. */
  function isoDate(raw) {
    const s = String(raw || '').trim();
    let y, mo, d, m;
    if ((m = /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/.exec(s))) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s))) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += y > (new Date().getFullYear() % 100) ? 1900 : 2000; }
    else if ((m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9}),?\s+(\d{4})/.exec(s))) { d = +m[1]; mo = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()]; y = +m[3]; }
    else if ((m = /^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(s))) { mo = MONTHS[m[1].slice(0, 4).toLowerCase()] || MONTHS[m[1].slice(0, 3).toLowerCase()]; d = +m[2]; y = +m[3]; }
    if (!y || !mo || !d || mo > 12 || d > 31 || y < 1900 || y > new Date().getFullYear()) return '';
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  function genderOf(raw) {
    const s = String(raw || '').toLowerCase();
    if (/\b(?:f|female|woman|lady|girl|she)\b/.test(s)) return 'Female';
    if (/\b(?:m|male|man|gentleman|boy|he)\b/.test(s)) return 'Male';
    return '';
  }

  /** {name, dob, dobRaw, age, gender, phone} found in the text itself (nothing is sent anywhere). */
  function identifiers(text) {
    const t = String(text || '');
    let name = cleanName(field(t, "patient'?s?\\s+(?:full\\s+)?name|full\\s+name|name\\s+of\\s+(?:the\\s+)?patient|client'?s?\\s+name|name|patient|pt\\.?|client"));
    if (!name) { const m = /\b(?:Mr|Mrs|Ms|Miss|Master|Mx)\.?\s+([A-Z][\p{L}'\-]+(?:\s+[A-Z][\p{L}'\-]+){0,3})/u.exec(t); if (m) name = cleanName(m[1]); }
    const dobRaw = field(t, 'd\\.?\\s*o\\.?\\s*b\\.?|date\\s+of\\s+birth|birth\\s*date|born(?:\\s+on)?');
    const phoneRaw = field(t, "phone(?:\\s+(?:no|number))?|tel(?:ephone)?|mobile(?:\\s+(?:no|number))?|gsm|contact(?:\\s+(?:no|number))?|phone\\s*#");
    const phone = (/(\+?\d[\d\s().\-]{6,}\d)/.exec(phoneRaw) || [])[1] || '';
    let age = null;
    const ageField = field(t, 'age');
    let m = /(\d{1,3})/.exec(ageField);
    if (!m) m = /\b(\d{1,3})\s*(?:-|\s)?(?:years?|yrs?|yo|y\/o|y\.o\.?)(?:[\s-]*old)?\b/i.exec(t);
    if (m && +m[1] > 0 && +m[1] < 120) age = +m[1];
    let gender = genderOf(field(t, 'sex|gender'));
    if (!gender) { const g = /\b\d{1,3}\s*(?:-|\s)?(?:years?|yrs?|yo|y\/o)(?:[\s-]*old)?\s+(male|female|man|woman|boy|girl|lady|gentleman)\b/i.exec(t) || /\b(?:a|an)\s+(male|female|man|woman|boy|girl|lady|gentleman)\b/i.exec(t); if (g) gender = genderOf(g[1]); }
    return { name, dob: isoDate(dobRaw), dobRaw, age, gender, phone: phone.trim() };
  }

  /** The text with the patient's identifiers taken out: this is all the SI ever sees. */
  function deidentify(text, ids) {
    const list = [];
    if (ids.name) list.push(ids.name, ...ids.name.split(' ').filter(w => w.length >= 3));
    if (ids.dobRaw) list.push(ids.dobRaw);
    if (ids.phone) list.push(ids.phone);
    const D = window.RehablixDeidentify;
    return D ? D.scrubText(text, list) : String(text || '');
  }

  // ------------------------------------------------------------------ the clinical intake (SI, de-identified text only)
  const SYSTEM = 'You turn a de-identified rehabilitation case presentation, referral or report into Smart EMR intake fields. ' +
    'The patient\'s name, date of birth and phone number have been removed (shown as [redacted], [date], [phone]); never guess or invent them. ' +
    'Use only what the text says; leave a field empty ("" or null) when it is not stated or clearly implied. Reply with ONE JSON object and nothing else:\n' +
    '{"primaryDx": "main diagnosis, with its ICD-10 code first only if you are sure, e.g. \\"I63.9 — Cerebral infarction\\"",\n' +
    ' "chiefComplaint": "the presenting complaint in one or two sentences",\n' +
    ' "category": one of ' + JSON.stringify(CATEGORIES) + ' or "",\n' +
    ' "profession": one of ' + JSON.stringify(PROFESSIONS) + ' (the discipline the report is written for) or "",\n' +
    ' "state": one of ' + JSON.stringify(STATES) + ' or "",\n' +
    ' "referring": "the referring doctor or unit, if stated", "insurance": "the insurer or HMO, if stated",\n' +
    ' "goals": "the functional goals stated or clearly implied (max 600 characters)",\n' +
    ' "assessment": "a concise clinical summary: history, examination and assessment findings, with the measures and scores given (max 1500 characters)",\n' +
    ' "age": number or null, "gender": "Male", "Female" or ""}';
  // With patients' details sent in full (js/deidentify.js), the SI reads the biodata too.
  const SYSTEM_FULL = SYSTEM.replace(
    'The patient\'s name, date of birth and phone number have been removed (shown as [redacted], [date], [phone]); never guess or invent them. ',
    'Read the patient\'s biodata from the text too; never guess or invent it. '
  ).replace('{"primaryDx"', '{"name": "the patient\'s full name, without titles (Mr, Mrs…)", "dob": "date of birth as YYYY-MM-DD", "phone": "the patient\'s phone number",\n "primaryDx"');
  const sendAll = () => !!(window.RehablixDeidentify && window.RehablixDeidentify.sendIdentifiers && window.RehablixDeidentify.sendIdentifiers());

  function pick(v, list) { const s = String(v || '').trim().toLowerCase(); return list.find(x => x.toLowerCase() === s) || ''; }
  function str(v, max) { return String(v == null ? '' : v).replace(/\s+\n/g, '\n').trim().slice(0, max); }

  function parseJson(raw) {
    const s = String(raw || '');
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { return null; }
  }

  function user() { try { return firebase.auth().currentUser; } catch (e) { return null; } }
  function plan() { return (window.rehabPlans && window.rehabPlans.getCurrentPlan && window.rehabPlans.getCurrentPlan()) || 'free'; }

  /**
   * Reads [sourceText] into intake fields. Returns {fields, missing: ['name', …], ids}.
   * Throws an Error with a plain message when it can't (not logged in, no budget, nothing to read).
   */
  async function draft(sourceText) {
    const u = user();
    if (!u) throw new Error('Log in to create patients in Smart EMR.');
    const text = String(sourceText || '').trim();
    if (text.replace(/\s+/g, ' ').length < 60) throw new Error('Paste or attach the presentation or report first, then ask me to create the patient.');
    const ids = identifiers(text);
    const clean = deidentify(text, ids).slice(0, 14000);
    const core = window.RehablixAIQuotaCore;
    if (window.RehabPlanTiers) {
      const q = await window.RehabPlanTiers.hasQuota(u.uid, plan());
      if (q && q.allowed === false) throw new Error("You've used your token budget for this window.");
    }
    const cfg = core && await core.resolveModelConfig('basal100');
    if (!cfg) throw new Error('The SI service is not available right now.');
    const res = await fetch(cfg.endpoint.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: sendAll() ? SYSTEM_FULL : SYSTEM }, { role: 'user', content: clean }], max_tokens: 1800, temperature: 0.2, stream: false })
    });
    if (!res.ok) throw new Error('The SI could not read the report just now. Please try again.');
    const j = await res.json().catch(() => ({}));
    const answer = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    try { if (core && core.reportTokenUsage) core.reportTokenUsage(u.uid, plan(), clean + answer, cfg.weight || 1); } catch (e) { /* usage is best-effort */ }
    const ai = parseJson(answer);
    if (!ai) throw new Error('The SI could not read the report just now. Please try again.');
    const aiAge = Number(ai.age);
    // (what the text's own labels say comes first; the SI's reading fills the gaps when it was given the details)
    const full = sendAll();
    const fields = {
      name: ids.name || (full ? cleanName(ai.name) : ''),
      dob: ids.dob || (full ? isoDate(ai.dob) : ''),
      age: ids.age != null ? ids.age : (aiAge > 0 && aiAge < 120 ? Math.round(aiAge) : null),
      gender: ids.gender || pick(ai.gender, ['Male', 'Female']),
      phone: ids.phone || (full ? str(ai.phone, 30) : ''),
      primaryDx: str(ai.primaryDx, 200),
      chiefComplaint: str(ai.chiefComplaint, 600),
      category: pick(ai.category, CATEGORIES),
      profession: pick(ai.profession, PROFESSIONS),
      state: pick(ai.state, STATES) || 'Outpatient',
      referring: str(ai.referring, 120),
      insurance: str(ai.insurance, 120),
      goals: str(ai.goals, 800),
      assessment: str(ai.assessment, 2000)
    };
    const missing = [];
    if (!fields.name) missing.push('name');
    if (!fields.dob && fields.age == null) missing.push('date of birth or age');
    if (!fields.primaryDx) missing.push('diagnosis');
    return { fields, missing, ids };
  }

  // ------------------------------------------------------------------ creating it
  async function scopeUid(u) {
    if (window.RehablixCenter && window.RehablixCenter.getEffectiveScopeUid) {
      const s = await window.RehablixCenter.getEffectiveScopeUid('doc');
      if (s === null) throw new Error('Your center admin has turned off Smart EMR for you.');
      return s || u.uid;
    }
    return u.uid;
  }

  /** Creates the draft patient. Returns {id, regNumber, scope}. */
  async function create(fields, source) {
    const u = user();
    if (!u) throw new Error('Log in to create patients in Smart EMR.');
    const scope = await scopeUid(u);
    const Store = window.RehablixEmrStore;
    let regNumber = null;
    try { if (window.RehablixPatientReg && Store) regNumber = await Store.allocateRegNumber(scope); } catch (e) { regNumber = null; }
    const db = firebase.database();
    const ref = db.ref('history/' + scope + '/patients').push();
    const record = Object.assign({}, fields, {
      name: fields.name || 'Unnamed patient',
      regNumber,
      status: 'draft',
      active: true,
      sessionCount: 0,
      sessions: {},
      treatmentPlans: [], progressNotes: [], reports: [], summaries: [], dischargeSummaries: [], problemList: [],
      generatedReport: '', uploadedFiles: [], nextSessionPlan: null,
      createdFrom: { by: 'lixa', source: source || 'report', at: Date.now(), aiGenerated: true, reviewed: false },
      createdAt: firebase.database.ServerValue.TIMESTAMP
    });
    await ref.set(record);
    if (Store) {
      Store.updateIndex(scope, ref.key, Object.assign({}, record, { createdAt: Date.now() }));
      Store.audit(scope, ref.key, 'create', (regNumber ? 'Reg #' + regNumber + ' — ' : '') + 'created by Lixa from a ' + (source || 'report') + ' (draft)');
    }
    if (window.RehablixCenter && window.RehablixCenter.logActivity) window.RehablixCenter.logActivity('doc', 'Created patient', record.name).catch(() => {});
    return { id: ref.key, regNumber, scope };
  }

  /** A short summary for the chat, WITHOUT the patient's name, date of birth or phone (the chat goes to the SI). */
  function summary(result, d) {
    const f = d.fields;
    const lines = ['I\'ve created ' + (sendAll() && f.name ? '**' + f.name + '**' : 'the patient') + ' in Smart EMR' + (result.regNumber ? ' (Reg #' + result.regNumber + ')' : '') + ' as a **draft**, with the biodata and intake from the report.'];
    const got = [];
    if (f.name) got.push('name'); if (f.dob) got.push('date of birth'); else if (f.age != null) got.push('age'); if (f.gender) got.push('sex'); if (f.phone) got.push('phone');
    if (got.length) lines.push('- Biodata: ' + got.join(', '));
    if (f.primaryDx) lines.push('- Diagnosis: ' + f.primaryDx);
    if (f.chiefComplaint) lines.push('- Chief complaint: ' + f.chiefComplaint.slice(0, 160) + (f.chiefComplaint.length > 160 ? '…' : ''));
    const more = [f.category, f.profession, f.state].filter(Boolean);
    if (more.length) lines.push('- ' + more.join(' · '));
    if (f.goals) lines.push('- Goals and assessment summary added');
    if (d.missing.length) lines.push('', 'I couldn\'t find the patient\'s ' + d.missing.join(', ') + ' in the report: please add ' + (d.missing.length > 1 ? 'them' : 'it') + ' in Smart EMR.');
    lines.push('', 'Open **Smart EMR** to check the details and confirm the patient. SI can make mistakes.');
    return lines.join('\n');
  }

  window.RehablixEmrFromText = { wants, identifiers, deidentify, draft, create, summary, CATEGORIES, PROFESSIONS, STATES };
})();
