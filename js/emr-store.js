// js/emr-store.js — shared Smart EMR data layer (EMR security/scale pass).
//
// * Concurrency-safe list edits. Clinical lists (problemList, treatmentPlans,
//   progressNotes, summaries, dischargeSummaries, linkedRecords, …) keep their
//   existing ARRAY shape so every older reader (docresult, Lixa context,
//   Android builds already in the field) keeps working — but every add/edit/
//   delete now goes through an RTDB transaction, so two clinicians (or two
//   tabs) editing the same patient can no longer silently overwrite each
//   other's additions. Items are located by id, falling back to a content
//   fingerprint for legacy items that predate ids.
// * Lightweight patient index at history/{scope}/patientIndex/{id} so lists,
//   search and the dashboard never download full patient/session data.
// * Transaction-safe registration numbers (history/{scope}/regCounters/{prefix}).
// * Review stamps ("Mark as reviewed") and an append-only audit trail.
(function () {
  const DAY = 24 * 3600 * 1000;
  const db = () => firebase.database();
  const patientPath = (scope, pid) => `history/${scope}/patients/${pid}`;

  function toArray(v) {
    if (Array.isArray(v)) return v.filter(x => x != null);
    if (v && typeof v === 'object') {
      return Object.keys(v)
        .sort((a, b) => (Number(a) - Number(b)) || String(a).localeCompare(String(b)))
        .map(k => v[k]).filter(x => x != null);
    }
    return [];
  }

  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function fingerprint(it) {
    if (!it || typeof it !== 'object') return '';
    return [it.id || '', it.title || '', it.date || '', String(it.content || it.detail || it.details || '').slice(0, 160)].join('|');
  }

  // ref: { id } or { index, item } (item = the version the UI rendered).
  function locate(arr, ref) {
    if (!ref) return -1;
    if (ref.id) {
      const i = arr.findIndex(x => x && x.id === ref.id);
      if (i >= 0) return i;
    }
    if (ref.item) {
      const fp = fingerprint(ref.item);
      if (ref.index != null && arr[ref.index] && fingerprint(arr[ref.index]) === fp) return ref.index;
      return arr.findIndex(x => fingerprint(x) === fp);
    }
    if (ref.index != null && arr[ref.index]) return ref.index;
    return -1;
  }

  // Runs fn(arr) inside a transaction on patients/{pid}/{field}. fn mutates
  // arr in place and returns a result, or false to abort (nothing written).
  // An empty local cache on the first pass is handled by RTDB's retry: we
  // return null, the server rejects the stale hash and re-runs us with the
  // real value.
  async function mutateList(scope, pid, field, fn, opts) {
    const ref = db().ref(`${patientPath(scope, pid)}/${field}`);
    let result;
    const res = await ref.transaction(cur => {
      if (cur == null && !(opts && opts.allowEmpty)) return null;
      const arr = toArray(cur);
      result = fn(arr);
      if (result === false) return; // abort
      return arr.length ? arr : null;
    });
    if (!res.committed || result === false) return null;
    return result === undefined ? true : result;
  }

  function addItem(scope, pid, field, item) {
    const it = Object.assign({}, item);
    if (!it.id) it.id = newId();
    return mutateList(scope, pid, field, arr => { arr.push(it); return it; }, { allowEmpty: true });
  }

  // patch: object merged into the item, or fn(item) -> new item.
  function updateItem(scope, pid, field, ref, patch) {
    return mutateList(scope, pid, field, arr => {
      const i = locate(arr, ref);
      if (i < 0) return false;
      const next = typeof patch === 'function' ? patch(Object.assign({}, arr[i])) : Object.assign({}, arr[i], patch);
      if (!next) return false;
      if (!next.id) next.id = newId();
      arr[i] = next;
      return next;
    });
  }

  function removeItem(scope, pid, field, ref) {
    return mutateList(scope, pid, field, arr => {
      const i = locate(arr, ref);
      if (i < 0) return false;
      return arr.splice(i, 1)[0];
    });
  }

  // AI regeneration of a whole list: keeps manual and reviewed items, drops
  // only unreviewed AI drafts, then appends the fresh drafts.
  function replaceUnreviewedAI(scope, pid, field, newItems) {
    return mutateList(scope, pid, field, arr => {
      const kept = arr.filter(x => !(x && x.aiGenerated && !x.reviewed));
      arr.length = 0;
      kept.forEach(x => arr.push(x));
      newItems.forEach(x => arr.push(Object.assign({ id: newId() }, x)));
      return { kept: kept.length, added: newItems.length };
    }, { allowEmpty: true });
  }

  // Transaction on a single object node (e.g. nextSessionPlan).
  // fn(obj|null) returns the new object, null to delete, or false to abort.
  async function mutateObject(scope, pid, field, fn, opts) {
    const ref = db().ref(`${patientPath(scope, pid)}/${field}`);
    let result;
    const res = await ref.transaction(cur => {
      if (cur == null && !(opts && opts.allowEmpty)) return null;
      const obj = cur ? JSON.parse(JSON.stringify(cur)) : null;
      result = fn(obj);
      if (result === false) return;
      return result;
    });
    if (!res.committed || result === false) return null;
    return result == null ? true : result;
  }

  function incrementSessionCount(scope, pid, delta) {
    return db().ref(`${patientPath(scope, pid)}/sessionCount`).transaction(cur => Math.max(0, (Number(cur) || 0) + delta));
  }

  // ---------------------------------------------------------------------
  // Review stamps + audit trail
  // ---------------------------------------------------------------------
  function actor() {
    const u = firebase.auth && firebase.auth().currentUser;
    if (!u) return { uid: null, name: 'Clinician' };
    return { uid: u.uid, name: u.displayName || (u.email ? u.email.split('@')[0] : 'Clinician') };
  }

  function reviewStamp() {
    const a = actor();
    return { reviewed: true, reviewedBy: a.name, reviewedByUid: a.uid, reviewedAt: new Date().toISOString() };
  }

  function isUnreviewedAI(item) { return !!(item && item.aiGenerated && !item.reviewed && !item.signed); }

  // Append-only; failures never block clinical work.
  function audit(scope, pid, action, detail) {
    try {
      const a = actor();
      return db().ref(`history/${scope}/emrAudit`).push({
        patientId: pid || null, action: String(action), detail: String(detail || '').slice(0, 200),
        by: a.uid, byName: a.name, at: firebase.database.ServerValue.TIMESTAMP
      }).catch(() => {});
    } catch (e) { return Promise.resolve(); }
  }

  // ---------------------------------------------------------------------
  // Patient index
  // ---------------------------------------------------------------------
  function pendingOf(p) {
    const pending = [];
    Object.entries(p.sessions || {}).forEach(([sid, s]) => {
      if (s && s.aiGenerated && !s.signed && !s.reviewed) pending.push({ kind: 'session', label: `${s.type || 'Session'} note`, date: s.date || '', sessionId: s.id || sid });
    });
    toArray(p.problemList).forEach(x => { if (isUnreviewedAI(x)) pending.push({ kind: 'problems', label: `Problem: ${x.title || ''}`, date: '' }); });
    toArray(p.treatmentPlans).forEach(x => { if (isUnreviewedAI(x)) pending.push({ kind: 'treatment', label: x.title || 'Treatment Plan', date: x.date || '' }); });
    toArray(p.summaries).forEach(x => { if (isUnreviewedAI(x)) pending.push({ kind: 'summary', label: x.title || 'Summary Report', date: x.date || '' }); });
    toArray(p.progressNotes).forEach(x => { if (isUnreviewedAI(x)) pending.push({ kind: 'progress', label: x.title || 'Progress Note', date: x.date || '' }); });
    toArray(p.dischargeSummaries).forEach(x => { if (isUnreviewedAI(x)) pending.push({ kind: 'discharge', label: x.title || 'Discharge Summary', date: x.date || '' }); });
    if (p.nextSessionPlan && isUnreviewedAI(p.nextSessionPlan)) pending.push({ kind: 'nextsession', label: 'Next session plan', date: p.nextSessionPlan.date || '' });
    return pending;
  }

  function painTrendUp(p) {
    const list = Object.values(p.sessions || {}).filter(Boolean).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    if (list.length < 3) return false;
    const r = list.slice(-3).map(s => s.pain || 5);
    return r[0] < r[2];
  }

  function indexEntryFrom(p) {
    if (!p) return null;
    const pending = pendingOf(p);
    const e = {
      name: p.name || '', regNumber: p.regNumber || null, primaryDx: p.primaryDx || '',
      state: p.state || '', category: p.category || '', profession: p.profession || p.department || '',
      status: p.status || 'active', active: p.active !== false,
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : (Date.parse(p.createdAt) || 0),
      updatedAt: Date.now(),
      sessionCount: Object.keys(p.sessions || {}).length || Number(p.sessionCount) || 0,
      pendingCount: pending.length,
      pendingNotes: pending.filter(x => x.kind === 'session').length,
      pending: pending.slice(0, 20),
      painTrendUp: painTrendUp(p)
    };
    const h = p.heightCm || p.height;
    if (h) e.heightCm = Number(h) || null;
    return e;
  }

  const lastWritten = {};
  function updateIndex(scope, pid, p) {
    if (!scope || !pid) return Promise.resolve();
    const ref = db().ref(`history/${scope}/patientIndex/${pid}`);
    if (!p) { delete lastWritten[scope + pid]; return ref.remove().catch(() => {}); }
    const entry = indexEntryFrom(p);
    const sig = JSON.stringify(Object.assign({}, entry, { updatedAt: 0 }));
    if (lastWritten[scope + pid] === sig) return Promise.resolve();
    lastWritten[scope + pid] = sig;
    return ref.set(entry).catch(e => { delete lastWritten[scope + pid]; console.warn('[emr-store] index update failed', e); });
  }

  function reconcileKey(scope) { return 'rehab_patient_index_reconciled_' + scope; }

  // Returns {id: entry}. Built from full data on first run, then reconciled
  // at most once a day (catches patients written by older app builds).
  async function loadIndex(scope, opts) {
    if (!scope) return {};
    const force = opts && opts.force;
    let idx = null;
    try { idx = (await db().ref(`history/${scope}/patientIndex`).once('value')).val(); } catch (e) { idx = null; }
    let last = 0;
    try { last = Number(localStorage.getItem(reconcileKey(scope)) || 0); } catch (e) { /* storage blocked */ }
    if (idx && !force && Date.now() - last < DAY) return idx;
    try {
      const full = (await db().ref(`history/${scope}/patients`).once('value')).val() || {};
      const updates = {};
      const built = {};
      Object.entries(full).forEach(([id, p]) => { if (p) { built[id] = indexEntryFrom(p); updates[id] = built[id]; } });
      Object.keys(idx || {}).forEach(id => { if (!built[id]) updates[id] = null; });
      if (Object.keys(updates).length) await db().ref(`history/${scope}/patientIndex`).update(updates);
      try { localStorage.setItem(reconcileKey(scope), String(Date.now())); } catch (e) { /* ignore */ }
      return built;
    } catch (e) {
      console.warn('[emr-store] index rebuild failed', e);
      return idx || {};
    }
  }

  // ---------------------------------------------------------------------
  // Registration numbers
  // ---------------------------------------------------------------------
  async function allocateRegNumber(scope) {
    const R = window.RehablixPatientReg;
    if (!R || !scope) return null;
    const owner = await R.getOwnerName(scope);
    const prefix = R.initialsOf(owner);
    const idx = await loadIndex(scope);
    const existing = Object.values(idx).map(e => e && e.regNumber).filter(Boolean);
    const seed = parseInt(R.generateRegNumber(owner, existing).slice(prefix.length), 10) - 1 || 0;
    const res = await db().ref(`history/${scope}/regCounters/${prefix}`).transaction(cur => Math.max(Number(cur) || 0, seed) + 1);
    if (!res.committed) throw new Error('Could not allocate a registration number');
    return prefix + String(res.snapshot.val()).padStart(3, '0');
  }

  // Badge HTML for an AI-generated clinical block.
  function reviewBadge(item, esc) {
    if (!item) return '';
    if (item.reviewed) {
      const when = item.reviewedAt ? new Date(item.reviewedAt).toLocaleDateString() : '';
      return `<span class="tag tag-green">Reviewed${item.reviewedBy ? ' by ' + esc(item.reviewedBy) : ''}${when ? ' · ' + esc(when) : ''}</span>`;
    }
    if (item.aiGenerated) return '<span class="tag tag-amber ai-draft-tag">AI draft, review before use.</span>';
    return '';
  }

  window.RehablixEmrStore = {
    toArray, newId, fingerprint, locate,
    mutateList, addItem, updateItem, removeItem, replaceUnreviewedAI, mutateObject, incrementSessionCount,
    actor, reviewStamp, isUnreviewedAI, audit, reviewBadge,
    indexEntryFrom, updateIndex, loadIndex, allocateRegNumber
  };
})();
