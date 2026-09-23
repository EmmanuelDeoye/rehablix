// js/patient-reg.js — shared patient reference-number generator + cross-tool
// lookup (Smart EMR Round 2, items 4/5). One small module reused by
// js/views/emr-view.js (generates the number on patient creation),
// js/views/motion-view.js, js/presentation.js, js/audio.js (show/attach the
// number when linking a record to a patient), and js/reg-migration.js
// (backfills patients/records saved before this existed).
//
// Format: patient's initials + a zero-padded sequence, scoped to those
// initials — e.g. "Emmanuel Deoye" -> "ED001", the next Emmanuel Deoye (or
// anyone else with initials ED) -> "ED002".
(function () {
  function initialsOf(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'XX';
    if (parts.length === 1) return ((parts[0][0] || 'X') + (parts[0][1] || 'X')).toUpperCase();
    return ((parts[0][0] || 'X') + (parts[parts.length - 1][0] || 'X')).toUpperCase();
  }

  // `existingNumbers` — every regNumber already in use (any patient), so
  // the sequence for a given pair of initials never collides.
  function generateRegNumber(name, existingNumbers) {
    const initials = initialsOf(name);
    let maxSeq = 0;
    (existingNumbers || []).forEach((n) => {
      if (typeof n !== 'string' || !n.toUpperCase().startsWith(initials)) return;
      const m = n.slice(initials.length).match(/^(\d+)/);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    });
    return initials + String(maxSeq + 1).padStart(3, '0');
  }

  // Every place a patient reference number can show up across the app.
  // `dateField` may hold a number (timestamp) or a string date — both are
  // normalized to a locale date string for display.
  const SEARCH_SOURCES = [
    { path: 'patients', type: 'Smart EMR Patient', nameField: 'name', regField: 'regNumber', dateField: 'createdAt', titleFn: (item) => item.name || 'Patient' },
    { path: 'caseHistory', type: 'Presentation/Report', nameField: 'patientName', regField: 'regNumber', dateField: 'timestamp', titleFn: (item) => item.fileName || item.documentType || 'Presentation' },
    { path: 'analysisHistory', type: 'Motion (ROM)', nameField: 'patientName', regField: 'regNumber', dateField: 'date', titleFn: (item) => item.fileName || item.documentType || 'ROM Analysis' },
    { path: 'gaitHistory', type: 'Motion (Gait)', nameField: 'patientName', regField: 'regNumber', dateField: 'date', titleFn: (item) => item.fileName || item.documentType || 'Gait Analysis' },
    { path: 'assistiveHistory', type: 'Motion (Assistive Device)', nameField: 'patientName', regField: 'regNumber', dateField: 'date', titleFn: (item) => item.fileName || item.documentType || 'Assistive Device Assessment' },
    { path: 'audio', type: 'Audio Transcript', nameField: 'patientName', regField: 'regNumber', dateField: 'createdAt', titleFn: (item) => item.title || 'Audio Transcript' }
  ];

  function normalizeDate(v) {
    if (!v) return '';
    if (typeof v === 'number') return new Date(v).toLocaleDateString();
    // Already a locale-ish string (e.g. "9/23/2026") or an ISO date.
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : (String(v).includes('/') ? v : d.toLocaleDateString());
  }

  // Reads one source's node and returns matches for `query` (either an
  // exact reg-number match or a substring name match). `sourcePath` lets a
  // caller search only its own tools (e.g. Motion only needs its own three
  // nodes) instead of every source every time.
  async function findByRegOrName(scopeUid, query, sources) {
    const q = String(query || '').trim().toLowerCase();
    if (!scopeUid || !q) return [];
    const list = sources || SEARCH_SOURCES;
    const resultsBySource = await Promise.all(list.map(async (src) => {
      try {
        const snap = await firebase.database().ref(`history/${scopeUid}/${src.path}`).once('value');
        const data = snap.val();
        if (!data) return [];
        return Object.entries(data)
          .map(([id, item]) => {
            if (!item) return null;
            const name = String(item[src.nameField] || '').toLowerCase();
            const reg = String(item[src.regField] || '').toLowerCase();
            const isMatch = (reg && reg === q) || (name && name.includes(q));
            if (!isMatch) return null;
            return {
              source: src.path, id, type: src.type,
              patientName: item[src.nameField] || '',
              regNumber: item[src.regField] || '',
              date: normalizeDate(item[src.dateField]),
              title: (src.titleFn && src.titleFn(item)) || src.type,
              raw: item
            };
          })
          .filter(Boolean);
      } catch (e) {
        return []; // one source failing (e.g. a missing node) shouldn't break the whole search
      }
    }));
    const results = resultsBySource.flat();
    results.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    return results;
  }

  window.RehablixPatientReg = { initialsOf, generateRegNumber, findByRegOrName, SEARCH_SOURCES };
})();
