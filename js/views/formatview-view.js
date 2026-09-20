// js/views/formatview-view.js — dedicated view/editor for Assessment
// Format results. Reuses the same full-screen "results" interface pattern
// as js/views/motion-view.js (css/motion-view.css .motion-results*)
// instead of routing Format results through the shared multi-type
// #/result editor. Registered as the "formatview" SPA view.
//
// The generator (js/lixa-generators/format-gen.js / js/format.js) produces
// a full, print-ready HTML document — its own @media print rules, table
// styling, and "A4 page" layout only work correctly rendered as an actual
// document, not injected as an innerHTML fragment (a `body { ... }` rule
// in the generated HTML would simply never match anything if dropped into
// a plain <div>). So the content lives in an <iframe srcdoc="...">, with
// the iframe's own document.designMode toggled on/off to edit in place —
// full editability, but rendered exactly as the form was designed.
//
// Deep link shape matches every other result-ish route: index.html?id=...
// (optionally &uid=... for a shared/public link) #/formatview.

(function () {
  let cleanupFns = [];

  function mount() {
    const $ = (id) => document.getElementById(id);

    const titleEl = $('formatViewTitle');
    const frameEl = $('formatViewFrame');
    const backBtn = $('formatViewBackBtn');
    const editBtn = $('formatViewEditBtn');
    const shareBtn = $('formatViewShareBtn');
    const printBtn = $('formatViewPrintBtn');
    const downloadBtn = $('formatViewDownloadBtn');
    const newBtn = $('formatViewNewBtn');
    const closeBtn = $('formatViewCloseBtn');
    if (!frameEl) return;

    let record = null;
    let recordId = null;
    let ownerUid = null;
    let isOwner = false;
    let isEditing = false;
    let frameLoaded = null; // Promise resolved once the current srcdoc has finished loading

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

    // The AI is asked for a full printable document and usually returns
    // one (its own <style>/@media print block); if it ever returns a bare
    // fragment instead, this still gives it sane, print-friendly defaults
    // rather than rendering unstyled.
    function wrapAssessmentHtml(rawHtml) {
      if (/<html[\s>]/i.test(rawHtml)) return rawHtml;
      return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; color:#1f2933; line-height:1.6; max-width: 800px; margin: 0 auto; padding: 2rem 1.5rem; background:#fff; }
  table { border-collapse: collapse; width:100%; margin: 1rem 0; }
  td, th { border: 1px solid #ccc; padding: 0.5rem; text-align:left; }
  textarea { font-family: inherit; }
  h1, h2, h3 { color:#00695c; }
  @media print { body { padding: 0; } }
</style>
</head><body>${rawHtml}</body></html>`;
    }

    function renderInFrame(rawHtml) {
      frameLoaded = new Promise((resolve) => {
        frameEl.addEventListener('load', function onLoad() {
          frameEl.removeEventListener('load', onLoad);
          resolve();
        });
      });
      frameEl.srcdoc = wrapAssessmentHtml(rawHtml);
      return frameLoaded;
    }

    // Edit-in-place: designMode on the iframe's own document, rather than
    // contenteditable on a wrapping div — this is what lets the AI's own
    // form styling (fonts, tables, print rules) stay exactly as rendered
    // while still being fully editable.
    async function setEditing(editing) {
      if (!isOwner) return;
      await frameLoaded;
      const doc = frameEl.contentDocument;
      if (!doc) return;
      isEditing = editing;
      doc.designMode = editing ? 'on' : 'off';
      frameEl.classList.toggle('motion-results-editing', editing);
      const icon = editBtn.querySelector('i');
      if (icon) icon.className = editing ? 'fas fa-check' : 'fas fa-pen';
      editBtn.title = editing ? 'Save changes' : 'Edit';
      if (editing) doc.body && doc.body.focus();
    }

    async function saveEdits() {
      if (!recordId || !ownerUid) return;
      await frameLoaded;
      const doc = frameEl.contentDocument;
      if (!doc) return;
      const html = doc.documentElement.outerHTML;
      const plainText = doc.body ? doc.body.innerText : '';
      try {
        await firebase.database().ref(`history/${ownerUid}/formats/${recordId}`).update({
          generatedText: html,
          preview: plainText.replace(/\s+/g, ' ').substring(0, 150),
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
      // Wait for the shared SPA auth-ready signal instead of reading
      // firebase.auth().currentUser synchronously — on a fresh load/deep
      // link, Firebase hasn't finished restoring the persisted session yet
      // at the moment this view mounts, so currentUser would read null
      // even for an already-logged-in user (the "log in required" bug).
      const user = window.RehablixAuthReady ? await window.RehablixAuthReady : firebase.auth().currentUser;

      if (!recordId) {
        titleEl.textContent = 'Not found';
        await renderInFrame('<p>No assessment was specified.</p>');
        return;
      }

      ownerUid = sharedUid || (user && user.uid) || null;
      isOwner = !!user && !sharedUid;
      if (!ownerUid) {
        titleEl.textContent = 'Log in required';
        await renderInFrame('<p>Please log in to view this assessment.</p>');
        return;
      }

      try {
        const snap = await firebase.database().ref(`history/${ownerUid}/formats/${recordId}`).once('value');
        record = snap.val();
        if (!record) {
          titleEl.textContent = 'Not found';
          isOwner = false;
          await renderInFrame("<p>This assessment could not be found, or you don't have access to it.</p>");
          return;
        }
        titleEl.textContent = titleFor(record);
        await renderInFrame((record.generatedText && record.generatedText.trim().length > 0) ? record.generatedText : '<p>No content available</p>');
        editBtn.style.display = isOwner ? '' : 'none';
      } catch (err) {
        console.error('[formatview] load error:', err);
        titleEl.textContent = 'Error';
        await renderInFrame('<p>Could not load this assessment.</p>');
      }
    }

    editBtn.addEventListener('click', async () => {
      if (!record) return;
      if (!isEditing) { await setEditing(true); return; }
      await setEditing(false);
      await saveEdits();
    });

    shareBtn.addEventListener('click', async () => {
      if (!record) return;
      await frameLoaded;
      const doc = frameEl.contentDocument;
      const shareText = `${titleEl.textContent}\n\n${doc && doc.body ? doc.body.innerText : ''}`.slice(0, 2000);
      if (navigator.share) {
        try { await navigator.share({ title: titleEl.textContent, text: shareText }); } catch (e) { /* user cancelled */ }
      } else {
        try { await navigator.clipboard.writeText(shareText); showToast('Copied to clipboard', 'success'); } catch (e) { showToast('Could not copy', 'error'); }
      }
    });

    // Printing the iframe's own contentWindow (rather than opening a new
    // tab) uses the document's own @media print rules exactly as the
    // generator wrote them, and needs no popup window at all.
    printBtn.addEventListener('click', async () => {
      if (!record) return;
      await frameLoaded;
      if (frameEl.contentWindow) frameEl.contentWindow.print();
    });

    downloadBtn.addEventListener('click', async () => {
      if (!record) return;
      if (!window.html2pdf) { showToast('PDF export library not loaded', 'error'); return; }
      await frameLoaded;
      const doc = frameEl.contentDocument;
      if (!doc || !doc.body) return;
      const original = downloadBtn.innerHTML;
      downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
      const fileBase = titleFor(record).replace(/[^\w\- ]/g, '').replace(/\s+/g, '_') || 'Assessment';
      html2pdf().set({
        margin: [0.4, 0.4, 0.4, 0.4],
        filename: `${fileBase}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
      }).from(doc.body).save().finally(() => { downloadBtn.innerHTML = original; });
    });

    backBtn.addEventListener('click', goBack);
    closeBtn.addEventListener('click', goBack);
    newBtn.addEventListener('click', goBack);

    load();

    // Self-correct if the user logs in (or out) while this view is
    // showing — e.g. they hit "log in required" and use the navbar login
    // button without leaving this page.
    let lastAuthUid = undefined;
    const unsubAuth = firebase.auth().onAuthStateChanged((user) => {
      const uid = user ? user.uid : null;
      if (lastAuthUid === undefined) { lastAuthUid = uid; return; } // skip the initial callback — load() already handled it
      if (uid !== lastAuthUid) {
        lastAuthUid = uid;
        load();
      }
    });
    cleanupFns.push(unsubAuth);
  }

  function unmount() {
    cleanupFns.forEach(fn => { try { fn(); } catch (e) { /* best-effort */ } });
    cleanupFns = [];
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.formatview = { mount, unmount };
})();
