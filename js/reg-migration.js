// js/reg-migration.js — one-time-per-page discovery of patients/records
// saved before the reg-number system existed (Smart EMR Round 2, item 5).
// Same opt-in "detect, ask, then backfill" pattern as the existing
// js/history-migration.js, applied to a different problem: assigning
// missing regNumber values rather than moving data between old/new paths.
//
// Unlike history-migration.js (one page = one <body> = one auto-init),
// EMR/Motion/Presentation/Audio are all SPA views sharing one <body>, so
// this exposes a function each view calls once it knows its own scopeUid
// and which of ITS OWN nodes to check — one confirmation modal per page,
// covering however many of that page's own paths need it (e.g. Motion's
// three history nodes checked together, not as three separate popups).
(function () {
  function db() { return firebase.database(); }

  const NAME_FIELD_FOR = { patients: 'name' }; // every other path uses `patientName`
  const LABEL_FOR = {
    patients: 'patients', caseHistory: 'presentation/report records',
    analysisHistory: 'ROM records', gaitHistory: 'gait records',
    assistiveHistory: 'assistive-device records', audio: 'audio transcripts'
  };

  // Flags an item if it has no regNumber at all, OR has one that doesn't
  // start with this account's correct prefix (Round 3 fix: reg numbers were
  // originally generated from the PATIENT's initials instead of the
  // ACCOUNT OWNER's — this catches both the never-numbered and the
  // wrongly-numbered in one pass).
  async function findNeedingFix(scopeUid, path, ownerInitials) {
    const snap = await db().ref(`history/${scopeUid}/${path}`).once('value');
    const data = snap.val() || {};
    const nameField = NAME_FIELD_FOR[path] || 'patientName';
    const src = (window.RehablixPatientReg.SEARCH_SOURCES || []).find((s) => s.path === path);
    const dateField = (src && src.dateField) || 'createdAt';
    return Object.entries(data)
      .filter(([id, item]) => item && item[nameField])
      .map(([id, item]) => ({ id, name: item[nameField], regNumber: item.regNumber || null, date: item[dateField] || 0 }))
      .filter((item) => !item.regNumber || !item.regNumber.toUpperCase().startsWith(ownerInitials));
  }

  // Numbers already matching this account's prefix are left untouched and
  // seed the sequence so a fix never collides with a correct number.
  async function correctRegNumbers(scopeUid, path, ownerInitials) {
    const snap = await db().ref(`history/${scopeUid}/${path}`).once('value');
    const data = snap.val() || {};
    return Object.values(data)
      .map((item) => item && item.regNumber)
      .filter((n) => n && n.toUpperCase().startsWith(ownerInitials));
  }

  function buildModal(groups) {
    if (document.getElementById('regMigrationModal')) return document.getElementById('regMigrationModal');
    const totalCount = groups.reduce((sum, g) => sum + g.needsFix.length, 0);
    const labels = groups.map((g) => LABEL_FOR[g.path] || g.path).join(', ');
    const overlay = document.createElement('div');
    overlay.id = 'regMigrationModal';
    overlay.className = 'hm-overlay'; // reuses history-migration.css's existing overlay styling
    overlay.innerHTML = `
      <div class="hm-box">
        <div class="hm-icon"><i class="fas fa-id-badge"></i></div>
        <h3>Update reference numbers</h3>
        <p>Found ${totalCount} ${labels} that need a reference-number update (missing or not matching your
        account's numbering). Fix them now so they show up correctly in cross-tool search and linking.</p>
        <div class="hm-actions">
          <button type="button" class="hm-btn hm-btn-secondary" id="regmLaterBtn">Remind Me Later</button>
          <button type="button" class="hm-btn hm-btn-primary" id="regmAssignBtn"><i class="fas fa-id-badge"></i> Fix Now</button>
        </div>
        <div class="hm-status" id="regmStatus" style="display:none;"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  async function fixRegNumbers(scopeUid, groups, ownerName) {
    if (!window.RehablixPatientReg) throw new Error('Reg-number generator not loaded');
    for (const group of groups) {
      const updates = {};
      // Oldest first, so the corrected sequence reads chronologically.
      const ordered = [...group.needsFix].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      let existing = group.existing.slice();
      for (const item of ordered) {
        const reg = window.RehablixPatientReg.generateRegNumber(ownerName, existing);
        existing = existing.concat([reg]);
        updates[`${item.id}/regNumber`] = reg;
      }
      await db().ref(`history/${scopeUid}/${group.path}`).update(updates);
    }
  }

  // Public entry point. `paths` — one path (string) or several (array) that
  // belong to the SAME page, checked together and offered as one prompt.
  async function checkAndPrompt(scopeUid, paths) {
    if (!scopeUid || !paths || !window.RehablixPatientReg) return;
    const list = Array.isArray(paths) ? paths : [paths];
    let groups;
    try {
      const ownerName = await window.RehablixPatientReg.getOwnerName(scopeUid);
      const ownerInitials = window.RehablixPatientReg.initialsOf(ownerName);
      groups = (await Promise.all(list.map(async (path) => ({
        path,
        needsFix: await findNeedingFix(scopeUid, path, ownerInitials),
        existing: await correctRegNumbers(scopeUid, path, ownerInitials)
      })))).filter((g) => g.needsFix.length > 0);
      if (!groups.length) return;
      showModal(scopeUid, groups, ownerName);
    } catch (e) { /* silent — this is a best-effort background prompt */ }
  }

  function showModal(scopeUid, groups, ownerName) {
    const overlay = buildModal(groups);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const laterBtn = document.getElementById('regmLaterBtn');
    const assignBtn = document.getElementById('regmAssignBtn');
    const statusEl = document.getElementById('regmStatus');
    const totalCount = groups.reduce((sum, g) => sum + g.needsFix.length, 0);

    function dismiss() {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
    }
    laterBtn.addEventListener('click', dismiss);

    assignBtn.addEventListener('click', async () => {
      assignBtn.disabled = true; laterBtn.disabled = true;
      statusEl.style.display = 'block';
      statusEl.textContent = 'Updating reference numbers…';
      try {
        await fixRegNumbers(scopeUid, groups, ownerName);
        statusEl.textContent = `✅ Done! ${totalCount} reference number(s) updated.`;
        setTimeout(dismiss, 1200);
      } catch (err) {
        console.error('[reg-migration] fix failed:', err);
        statusEl.textContent = "⚠️ Something went wrong. Nothing was changed — we'll try again next time.";
        assignBtn.disabled = false; laterBtn.disabled = false;
      }
    });
  }

  window.RehablixRegMigration = { checkAndPrompt };
})();
