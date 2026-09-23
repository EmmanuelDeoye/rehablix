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

  async function findMissing(scopeUid, path) {
    const snap = await db().ref(`history/${scopeUid}/${path}`).once('value');
    const data = snap.val() || {};
    const nameField = NAME_FIELD_FOR[path] || 'patientName';
    return Object.entries(data)
      .filter(([id, item]) => item && !item.regNumber && item[nameField])
      .map(([id, item]) => ({ id, name: item[nameField] }));
  }

  // Reg numbers are seeded from EMR patients so a backfilled record's
  // number never collides with a real patient's own.
  async function existingRegNumbers(scopeUid) {
    const snap = await db().ref(`history/${scopeUid}/patients`).once('value');
    return Object.values(snap.val() || {}).map((p) => p.regNumber).filter(Boolean);
  }

  function buildModal(groups) {
    if (document.getElementById('regMigrationModal')) return document.getElementById('regMigrationModal');
    const totalCount = groups.reduce((sum, g) => sum + g.missing.length, 0);
    const labels = groups.map((g) => LABEL_FOR[g.path] || g.path).join(', ');
    const overlay = document.createElement('div');
    overlay.id = 'regMigrationModal';
    overlay.className = 'hm-overlay'; // reuses history-migration.css's existing overlay styling
    overlay.innerHTML = `
      <div class="hm-box">
        <div class="hm-icon"><i class="fas fa-id-badge"></i></div>
        <h3>Assign reference numbers</h3>
        <p>Found ${totalCount} ${labels} without a reference number yet. Assign them now so they show up in
        cross-tool search and linking — nothing else about these records changes.</p>
        <div class="hm-actions">
          <button type="button" class="hm-btn hm-btn-secondary" id="regmLaterBtn">Remind Me Later</button>
          <button type="button" class="hm-btn hm-btn-primary" id="regmAssignBtn"><i class="fas fa-id-badge"></i> Assign Now</button>
        </div>
        <div class="hm-status" id="regmStatus" style="display:none;"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    return overlay;
  }

  async function assignMissing(scopeUid, groups) {
    if (!window.RehablixPatientReg) throw new Error('Reg-number generator not loaded');
    let existing = await existingRegNumbers(scopeUid);
    for (const group of groups) {
      const updates = {};
      for (const item of group.missing) {
        const reg = window.RehablixPatientReg.generateRegNumber(item.name, existing);
        existing = existing.concat([reg]);
        updates[`${item.id}/regNumber`] = reg;
      }
      await db().ref(`history/${scopeUid}/${group.path}`).update(updates);
    }
  }

  // Public entry point. `paths` — one path (string) or several (array) that
  // belong to the SAME page, checked together and offered as one prompt.
  async function checkAndPrompt(scopeUid, paths) {
    if (!scopeUid || !paths) return;
    const list = Array.isArray(paths) ? paths : [paths];
    let groups;
    try {
      groups = (await Promise.all(list.map(async (path) => ({ path, missing: await findMissing(scopeUid, path) }))))
        .filter((g) => g.missing.length > 0);
    } catch (e) { return; }
    if (!groups.length) return;

    const overlay = buildModal(groups);
    requestAnimationFrame(() => overlay.classList.add('show'));

    const laterBtn = document.getElementById('regmLaterBtn');
    const assignBtn = document.getElementById('regmAssignBtn');
    const statusEl = document.getElementById('regmStatus');
    const totalCount = groups.reduce((sum, g) => sum + g.missing.length, 0);

    function dismiss() {
      overlay.classList.remove('show');
      setTimeout(() => overlay.remove(), 200);
    }
    laterBtn.addEventListener('click', dismiss);

    assignBtn.addEventListener('click', async () => {
      assignBtn.disabled = true; laterBtn.disabled = true;
      statusEl.style.display = 'block';
      statusEl.textContent = 'Assigning reference numbers…';
      try {
        await assignMissing(scopeUid, groups);
        statusEl.textContent = `✅ Done! ${totalCount} reference number(s) assigned.`;
        setTimeout(dismiss, 1200);
      } catch (err) {
        console.error('[reg-migration] assignment failed:', err);
        statusEl.textContent = "⚠️ Something went wrong. Nothing was changed — we'll try again next time.";
        assignBtn.disabled = false; laterBtn.disabled = false;
      }
    });
  }

  window.RehablixRegMigration = { checkAndPrompt };
})();
