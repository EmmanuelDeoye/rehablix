// js/views/formatview-view.js — dedicated view/editor for Assessment
// Format results. Reuses the same full-screen "results" interface pattern
// as js/views/motion-view.js (css/motion-view.css .motion-results*)
// instead of routing Format results through the shared multi-type
// #/result editor. Registered as the "formatview" SPA view.
//
// Deep link shape matches every other result-ish route: index.html?id=...
// (optionally &uid=... for a shared/public link) #/formatview.

(function () {
  let cleanupFns = [];

  function mount() {
    const $ = (id) => document.getElementById(id);

    const titleEl = $('formatViewTitle');
    const bodyEl = $('formatViewBody');
    const backBtn = $('formatViewBackBtn');
    const editBtn = $('formatViewEditBtn');
    const shareBtn = $('formatViewShareBtn');
    const printBtn = $('formatViewPrintBtn');
    const downloadBtn = $('formatViewDownloadBtn');
    const newBtn = $('formatViewNewBtn');
    const closeBtn = $('formatViewCloseBtn');
    if (!bodyEl) return;

    let record = null;
    let recordId = null;
    let ownerUid = null;
    let isOwner = false;
    let isEditing = false;

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

    function goBack() {
      window.location.hash = '#/format';
    }

    // Edit-in-place, same pattern as Motion's results view: the pencil
    // toggles the body editable, clicking it again saves straight back to
    // the same history/{uid}/formats/{id} record.
    function setEditing(editing) {
      if (!isOwner) return;
      isEditing = editing;
      bodyEl.contentEditable = editing ? 'true' : 'false';
      bodyEl.classList.toggle('motion-results-editing', editing);
      const icon = editBtn.querySelector('i');
      if (icon) icon.className = editing ? 'fas fa-check' : 'fas fa-pen';
      editBtn.title = editing ? 'Save changes' : 'Edit';
    }

    async function saveEdits() {
      const html = bodyEl.innerHTML;
      if (!recordId || !ownerUid) return;
      try {
        await firebase.database().ref(`history/${ownerUid}/formats/${recordId}`).update({
          generatedText: html,
          preview: html.replace(/<[^>]*>/g, ' ').substring(0, 150).replace(/\n/g, ' '),
          lastEditedDate: new Date().toLocaleString()
        });
        if (record) record.generatedText = html;
        showToast('Changes saved', 'success');
      } catch (err) {
        console.error('[formatview] save error:', err);
        showToast('Could not save changes', 'error');
      }
    }

    function titleFor(data) {
      const parts = [data.assessmentType || 'Assessment', data.diagnosis || data.patientName || 'Result'];
      return parts.filter(Boolean).join(' — ');
    }

    async function load() {
      editBtn.style.display = 'none'; // only shown once a record we own has actually loaded

      const params = new URLSearchParams(window.location.search);
      recordId = params.get('id');
      const sharedUid = params.get('uid');
      const user = firebase.auth().currentUser;

      if (!recordId) {
        titleEl.textContent = 'Not found';
        bodyEl.innerHTML = '<p>No assessment was specified.</p>';
        return;
      }

      ownerUid = sharedUid || (user && user.uid) || null;
      isOwner = !!user && !sharedUid;
      if (!ownerUid) {
        titleEl.textContent = 'Log in required';
        bodyEl.innerHTML = '<p>Please log in to view this assessment.</p>';
        return;
      }

      try {
        const snap = await firebase.database().ref(`history/${ownerUid}/formats/${recordId}`).once('value');
        record = snap.val();
        if (!record) {
          titleEl.textContent = 'Not found';
          bodyEl.innerHTML = "<p>This assessment could not be found, or you don't have access to it.</p>";
          isOwner = false;
          return;
        }
        titleEl.textContent = titleFor(record);
        bodyEl.innerHTML = (record.generatedText && record.generatedText.trim().length > 0) ? record.generatedText : '<p>No content available</p>';
        editBtn.style.display = isOwner ? '' : 'none';
      } catch (err) {
        console.error('[formatview] load error:', err);
        titleEl.textContent = 'Error';
        bodyEl.innerHTML = '<p>Could not load this assessment.</p>';
      }
    }

    editBtn.addEventListener('click', async () => {
      if (!record) return;
      if (!isEditing) { setEditing(true); bodyEl.focus(); return; }
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
      w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${titleEl.textContent}</title></head><body>${bodyEl.innerHTML}</body></html>`);
      w.document.close();
      setTimeout(() => w.print(), 300);
    });

    downloadBtn.addEventListener('click', () => {
      if (!record) { return; }
      if (!window.html2pdf) { showToast('PDF export library not loaded', 'error'); return; }
      const original = downloadBtn.innerHTML;
      downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      const fileBase = titleFor(record).replace(/[^\w\- ]/g, '').replace(/\s+/g, '_') || 'Assessment';
      html2pdf().set({
        margin: [0.4, 0.4, 0.4, 0.4],
        filename: `${fileBase}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
      }).from(bodyEl).save().finally(() => { downloadBtn.innerHTML = original; });
    });

    backBtn.addEventListener('click', goBack);
    closeBtn.addEventListener('click', goBack);
    newBtn.addEventListener('click', goBack);

    load();
  }

  function unmount() {
    cleanupFns.forEach(fn => { try { fn(); } catch (e) { /* best-effort */ } });
    cleanupFns = [];
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.formatview = { mount, unmount };
})();
