// js/views/audioview-view.js — dedicated view for Audio Transcription
// results. Reuses the exact same full-screen "results" interface and
// styling as js/views/motion-view.js / js/views/formatview-view.js
// (css/motion-view.css .motion-results*) instead of routing through the
// shared multi-type #/result editor. Registered as the "audioview" SPA view.
//
// Unlike formatview (a full styled HTML document that needs an iframe to
// render correctly), a transcript is plain narrative text/markdown, so
// this uses a simple contenteditable body — the same approach Motion's own
// results view uses.
//
// Deep link shape matches every other result-ish route: index.html?id=...
// (optionally &uid=... for a shared/public link) #/audioview.

(function () {
  let cleanupFns = [];

  function mount() {
    const $ = (id) => document.getElementById(id);

    const titleEl = $('audioViewTitle');
    const bodyEl = $('audioViewBody');
    const backBtn = $('audioViewBackBtn');
    const editBtn = $('audioViewEditBtn');
    const shareBtn = $('audioViewShareBtn');
    const printBtn = $('audioViewPrintBtn');
    const downloadBtn = $('audioViewDownloadBtn');
    const newBtn = $('audioViewNewBtn');
    const closeBtn = $('audioViewCloseBtn');
    if (!bodyEl) return;

    let record = null;
    let recordId = null;
    let ownerUid = null;
    let isOwner = false;
    let isEditing = false;
    let lastAuthUid = null; // the auth uid load() most recently rendered for — kept in sync so the self-correcting listener below can't misjudge its own first callback (see mount())

    function showToast(message, type, duration) {
      type = type || 'success';
      duration = duration || 3500;
      let container = document.getElementById('toast-container');
      if (!container) { container = document.createElement('div'); container.id = 'toast-container'; document.body.appendChild(container); }
      const toast = document.createElement('div');
      toast.className = `toast ${type}`;
      const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'exclamation-circle' : 'info-circle';
      toast.innerHTML = `<i class="fas fa-${icon}"></i><span>${message}</span>`;
      container.appendChild(toast);
      setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateY(20px)'; toast.style.transition = 'all .3s'; setTimeout(() => toast.remove(), 300); }, duration);
    }

    // Same rule as FormatView: return to the page the user came from; only a
    // cold deep link falls back to the Audio tool.
    function goBack() {
      window.RehablixRouter.back('#/audio');
    }

    function renderMarkdown(text) {
      return (typeof marked !== 'undefined') ? marked.parse(text || '') : `<pre>${text || ''}</pre>`;
    }

    function setEditing(editing) {
      if (!isOwner) return;
      isEditing = editing;
      bodyEl.contentEditable = editing ? 'true' : 'false';
      bodyEl.classList.toggle('motion-results-editing', editing);
      const icon = editBtn.querySelector('i');
      if (icon) icon.className = editing ? 'fas fa-check' : 'fas fa-pen';
      editBtn.title = editing ? 'Save changes' : 'Edit';
      if (editing) bodyEl.focus();
    }

    async function saveEdits() {
      const html = bodyEl.innerHTML;
      if (!recordId || !ownerUid) return;
      try {
        await firebase.database().ref(`history/${ownerUid}/audio/${recordId}`).update({
          cleanedTranscript: bodyEl.innerText,
          resultsHtml: html,
          lastEditedDate: new Date().toLocaleString()
        });
        if (record) { record.cleanedTranscript = bodyEl.innerText; record.resultsHtml = html; }
        showToast('Changes saved', 'success');
      } catch (err) {
        console.error('[audioview] save error:', err);
        showToast('Could not save changes', 'error');
      }
    }

    // EMR UPGRADE (item 5): a small reg-number chip with a copy button next
    // to the title, matching the treatment js/result.js and js/docresult.js
    // give it — this view has no metadata bar of its own to hook into.
    function renderRegNumberChip(regNumber) {
        const existing = document.getElementById('audioViewRegChip');
        if (existing) existing.remove();
        if (!regNumber || !titleEl) return;
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.id = 'audioViewRegChip';
        chip.title = 'Copy reference number';
        chip.style.cssText = 'margin-left:0.6rem;font-size:0.75rem;border:1px solid var(--border-light);background:var(--accent-soft);color:var(--accent);border-radius:999px;padding:0.15rem 0.6rem;cursor:pointer;';
        chip.innerHTML = `<i class="fas fa-id-badge"></i> <span></span> <i class="fas fa-copy"></i>`;
        chip.querySelector('span').textContent = `Reg #${regNumber}`;
        chip.addEventListener('click', () => {
            navigator.clipboard.writeText(regNumber).then(() => showToast('Reference number copied', 'success'));
        });
        titleEl.insertAdjacentElement('afterend', chip);
    }

    async function load() {
      editBtn.style.display = 'none'; // only shown once a record we own has actually loaded

      const params = new URLSearchParams(window.location.search);
      recordId = params.get('id');
      const sharedUid = params.get('uid');
      // RehablixAuthReady only ever settles once (on the FIRST auth check),
      // so it can't be used as the user value itself on later visits within
      // the same SPA session — it's only awaited to guarantee that first
      // check has happened, and the live currentUser is read afterward.
      if (window.RehablixAuthReady) await window.RehablixAuthReady;
      const user = firebase.auth().currentUser;
      lastAuthUid = user ? user.uid : null;

      if (!recordId) {
        titleEl.textContent = 'Not found';
        bodyEl.innerHTML = '<p>No transcript was specified.</p>';
        return;
      }

      ownerUid = sharedUid || (user && user.uid) || null;
      isOwner = !!user && !sharedUid;
      if (!ownerUid) {
        titleEl.textContent = 'Log in required';
        bodyEl.innerHTML = '<p>Please log in to view this transcript.</p>';
        return;
      }

      try {
        const snap = await firebase.database().ref(`history/${ownerUid}/audio/${recordId}`).once('value');
        record = snap.val();
        if (!record) {
          titleEl.textContent = 'Not found';
          isOwner = false;
          bodyEl.innerHTML = "<p>This transcript could not be found, or you don't have access to it.</p>";
          return;
        }
        titleEl.textContent = record.title || 'Audio Transcript';
        bodyEl.innerHTML = record.resultsHtml || renderMarkdown(record.cleanedTranscript || record.rawTranscript || 'No content available');
        editBtn.style.display = isOwner ? '' : 'none';
        renderRegNumberChip(record.regNumber); // EMR UPGRADE (item 5)
      } catch (err) {
        console.error('[audioview] load error:', err);
        titleEl.textContent = 'Error';
        bodyEl.innerHTML = '<p>Could not load this transcript.</p>';
      }
    }

    editBtn.addEventListener('click', async () => {
      if (!record) return;
      if (!isEditing) { setEditing(true); return; }
      setEditing(false);
      await saveEdits();
    });

    shareBtn.addEventListener('click', async () => {
      if (!record) return;
      const shareText = `${titleEl.textContent}\n\n${bodyEl.innerText}`.slice(0, 2000);
      if (navigator.share) {
        try { await navigator.share({ title: titleEl.textContent, text: shareText }); } catch (e) { /* user cancelled */ }
      } else {
        try { await navigator.clipboard.writeText(shareText); showToast('Copied to clipboard', 'success'); } catch (e) { showToast('Could not copy', 'error'); }
      }
    });

    printBtn.addEventListener('click', () => {
      if (!record) return;
      const w = window.open('', '_blank');
      w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${titleEl.textContent}</title>
        <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1f2933;} h1{color:#009688;}</style>
        </head><body><h1>${titleEl.textContent}</h1>${bodyEl.innerHTML}</body></html>`);
      w.document.close();
      setTimeout(() => w.print(), 300);
    });

    downloadBtn.addEventListener('click', () => {
      if (!record) return;
      const blob = new Blob([`${titleEl.textContent}\n\n${bodyEl.innerText}`], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${titleEl.textContent.replace(/[^\w\- ]/g, '')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    });

    backBtn.addEventListener('click', goBack);
    closeBtn.addEventListener('click', goBack);
    newBtn.addEventListener('click', () => window.RehablixRouter.go('#/audio'));

    load();

    // Self-correct if the user logs in/out while this view is showing. Also
    // covers Firebase's own startup race (see formatview-view.js's mount()
    // for the full explanation) — compares against lastAuthUid (kept in
    // sync by load() itself) rather than skipping this listener's own first
    // callback, so a late correction is never silently dropped.
    const unsubAuth = firebase.auth().onAuthStateChanged((user) => {
      const uid = user ? user.uid : null;
      if (uid !== lastAuthUid) { lastAuthUid = uid; load(); }
    });
    cleanupFns.push(unsubAuth);
  }

  function unmount() {
    cleanupFns.forEach(fn => { try { fn(); } catch (e) { /* best-effort */ } });
    cleanupFns = [];
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.audioview = { mount, unmount };
})();
