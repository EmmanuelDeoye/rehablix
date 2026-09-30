// js/deidentify.js — one consistent de-identification layer for everything
// that is sent to an AI model (Smart EMR, Audio Coach, Lixa patient context).
//
// Direct identifiers are NEVER sent: patient name, date of birth, phone,
// email, insurance/ID numbers, referring physician, address. What remains is
// the clinical picture (age band, sex, diagnosis, findings, plans, progress).
// Scrubbing is deterministic and local — no network, no model involved.
(function () {
  const FIELD_BLOCKLIST = [
    'name', 'patientName', 'fullName', 'firstName', 'lastName', 'otherNames',
    'dob', 'dateOfBirth', 'birthDate',
    'phone', 'phoneNumber', 'mobile', 'telephone', 'email',
    'address', 'homeAddress', 'street', 'city', 'lga', 'postcode', 'zip',
    'insurance', 'insuranceNumber', 'insuranceProvider', 'hmo', 'hmoNumber', 'nhis', 'nhisNumber', 'policyNumber',
    'referringPhysician', 'referringDoctor', 'referredBy', 'referrer',
    'nextOfKin', 'nokName', 'nokPhone', 'emergencyContact', 'emergencyPhone',
    'nationalId', 'nin', 'idNumber', 'regNumber', 'hospitalNumber', 'mrn'
  ];
  const BLOCKED = new Set(FIELD_BLOCKLIST.map(k => k.toLowerCase()));

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // Ages are kept (clinically useful) but coarsened to a band; exact DOB never leaves.
  function ageBand(dob, age) {
    let years = null;
    if (dob) {
      const d = new Date(dob);
      if (!isNaN(d)) years = Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
    }
    if (years == null && age != null && age !== '') years = parseInt(age, 10);
    if (years == null || isNaN(years) || years < 0) return null;
    if (years < 1) return 'infant (<1 year)';
    if (years < 18) return years + ' years (paediatric)';
    if (years >= 90) return '90+ years';
    const lo = Math.floor(years / 5) * 5;
    return lo + '–' + (lo + 4) + ' years';
  }

  // Free-text scrubbing. `identifiers` are extra literal strings to remove
  // (e.g. the patient's name parts, reg number, referring physician).
  function scrubText(text, identifiers) {
    if (text == null) return '';
    let out = String(text);
    (identifiers || []).filter(Boolean).map(String).map(s => s.trim()).filter(s => s.length >= 2)
      .sort((a, b) => b.length - a.length)
      .forEach(id => {
        out = out.replace(new RegExp('\\b' + escapeRe(id) + '\\b', 'gi'), '[redacted]');
      });
    out = out
      // emails
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
      // phone numbers: +country form, or 10+ digits (e.g. 080x… local numbers).
      // Shorter digit runs are left alone — they're usually scores/measurements.
      .replace(/(\+?\d[\d\s().-]{7,}\d)/g, function (m) {
        const digits = m.replace(/\D/g, '').length;
        return (digits >= 10 || (m.trim().charAt(0) === '+' && digits >= 8)) ? '[phone]' : m;
      })
      // explicit dates of birth
      // Dates are only removed when they are a date of BIRTH — visit/session
      // dates stay, the clinical timeline depends on them.
      .replace(/\b(d\.?o\.?b\.?|date of birth|born(?: on)?)(\s*[:\-]?\s*)(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9},?\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4})/gi, '$1$2[date]');
    return out;
  }

  function nameParts(name) {
    return String(name || '').split(/\s+/).map(s => s.replace(/[^\p{L}'-]/gu, '')).filter(s => s.length >= 3).concat(name ? [String(name).trim()] : []);
  }

  // Identifiers present on a patient record, for scrubbing free text about them.
  function identifiersOf(p) {
    if (!p) return [];
    const ids = [];
    ['name', 'patientName', 'fullName', 'firstName', 'lastName'].forEach(k => { if (p[k]) ids.push(...nameParts(p[k])); });
    ['regNumber', 'phone', 'phoneNumber', 'email', 'address', 'insuranceNumber', 'hmoNumber', 'nhisNumber', 'referringPhysician', 'referringDoctor', 'referredBy', 'nokName', 'nokPhone', 'emergencyContact']
      .forEach(k => { if (p[k]) ids.push(String(p[k])); });
    return ids;
  }

  // Deep-copies a record dropping blocked fields and scrubbing every string.
  function scrubRecord(value, identifiers, depth) {
    depth = depth || 0;
    if (depth > 6 || value == null) return value;
    if (typeof value === 'string') return scrubText(value, identifiers);
    if (Array.isArray(value)) return value.map(v => scrubRecord(v, identifiers, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      Object.keys(value).forEach(k => {
        if (BLOCKED.has(k.toLowerCase())) return;
        out[k] = scrubRecord(value[k], identifiers, depth + 1);
      });
      return out;
    }
    return value;
  }

  // The single de-identified patient context every AI prompt should use.
  function patientContext(p) {
    if (!p) return {};
    const ids = identifiersOf(p);
    const ctx = scrubRecord(p, ids);
    delete ctx.age;
    const band = ageBand(p.dob || p.dateOfBirth, p.age);
    if (band) ctx.ageBand = band;
    return ctx;
  }

  window.RehablixDeidentify = { scrubText, scrubRecord, identifiersOf, patientContext, ageBand, BLOCKED_FIELDS: FIELD_BLOCKLIST };
})();
