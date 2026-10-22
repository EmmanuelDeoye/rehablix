// js/emr-transfer.js — moving a Smart EMR patient to another Rehablix account.
//
// Everything that matters happens on the server (rehablix-android/backend/functions/transfers.js,
// `patientTransfer`): the record stays in the sender's account until the named recipient accepts, and the
// recipient's invitation shows no clinical data and not the patient's name. This file is only the screens:
//   * patientBar(el, scope, patientId, patient) — on the open patient: "Transfer to another account", or, while an
//     offer is open, who it is waiting for and Cancel;
//   * incoming(el, onAccepted) — on the dashboard: transfers sent to this account, with Accept / Decline.
// Only patients in the user's own records (not a group's) can be transferred.
(function () {
  'use strict';
  const BASE = () => window.REHABLIX_AI_FUNCTIONS || 'https://us-central1-rehablix-ai.cloudfunctions.net';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const user = () => { try { return firebase.auth().currentUser; } catch (e) { return null; } };
  let toastFn = null;           // the page's own toast (Smart EMR passes it in: useToast)
  const toast = (m, k, d) => { if (toastFn) toastFn(m, k, d); else if (typeof window.showToast === 'function') window.showToast(m, k, d); else alert(m); };
  const day = t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  async function call(body) {
    const u = user();
    if (!u) throw new Error('Please log in first.');
    let res;
    try {
      res = await fetch(BASE() + '/patientTransfer', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + await u.getIdToken() }, body: JSON.stringify(body)
      });
    } catch (e) { throw new Error("Can't reach Rehablix right now. Check your connection and try again."); }
    const j = await res.json().catch(() => ({}));
    if (res.status === 404 && !j.error) throw new Error('Patient transfer is not switched on yet.');
    if (!res.ok || !j.ok) throw new Error(j.error || 'The transfer could not be completed.');
    return j;
  }

  // ------------------------------------------------------------------ the offer form
  function askEmail(label) {
    return new Promise(resolve => {
      const wrap = document.createElement('div');
      wrap.className = 'rx-transfer-modal';
      wrap.innerHTML =
        '<div class="rx-transfer-card" role="dialog" aria-modal="true" aria-labelledby="rxTransferTitle">' +
        '<h3 id="rxTransferTitle"><i class="bx bx-transfer-alt" aria-hidden="true"></i> Transfer patient</h3>' +
        '<p>Send <strong>' + esc(label) + '</strong> to another Rehablix account. The record stays with you until they accept; then it moves to their Smart EMR (with its sessions, notes and plans) and leaves yours. They see only your name and the registration number until they accept.</p>' +
        '<label for="rxTransferEmail">Their Rehablix account email</label>' +
        '<input id="rxTransferEmail" type="email" autocomplete="off" placeholder="colleague@example.com">' +
        '<label class="rx-transfer-check"><input type="checkbox" id="rxTransferOk"> I have the patient\'s consent and I am allowed to hand over this record.</label>' +
        '<div class="rx-transfer-actions"><button type="button" class="btn btn-secondary" data-x>Cancel</button><button type="button" class="btn btn-primary" data-go disabled>Send transfer</button></div>' +
        '</div>';
      document.body.appendChild(wrap);
      const email = wrap.querySelector('#rxTransferEmail'), okBox = wrap.querySelector('#rxTransferOk'), go = wrap.querySelector('[data-go]');
      const valid = () => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim()) && okBox.checked;
      const sync = () => { go.disabled = !valid(); };
      email.addEventListener('input', sync); okBox.addEventListener('change', sync);
      const done = v => { wrap.remove(); resolve(v); };
      wrap.querySelector('[data-x]').addEventListener('click', () => done(null));
      wrap.addEventListener('click', e => { if (e.target === wrap) done(null); });
      go.addEventListener('click', () => { if (valid()) done(email.value.trim()); });
      setTimeout(() => email.focus(), 50);
    });
  }

  async function offer(patientId, patient) {
    const label = patient && patient.regNumber ? 'this patient (Reg #' + patient.regNumber + ')' : 'this patient';
    const email = await askEmail(label);
    if (!email) return false;
    try {
      const r = await call({ action: 'send', patientId, toEmail: email });
      toast('Transfer sent. It waits for ' + email + ' to accept until ' + day(r.expiresAt) + '.', 'success', 6000);
      return true;
    } catch (e) { toast(e.message, 'error', 7000); return false; }
  }

  // ------------------------------------------------------------------ on the open patient
  function patientBar(anchor, scope, patientId, patient) {
    if (!anchor || !anchor.parentNode) return;
    let bar = document.getElementById('patientTransferBar');
    if (!bar) { bar = document.createElement('div'); bar.id = 'patientTransferBar'; bar.className = 'rx-transfer-bar'; anchor.parentNode.insertBefore(bar, anchor.nextSibling); }
    const u = user();
    const own = u && scope === u.uid;
    const p = patient || {};
    const t = p.transferPending;
    if (!own || !patientId || !p.name) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    if (t && t.expiresAt > Date.now()) {
      bar.innerHTML = '<i class="bx bx-time-five" aria-hidden="true"></i><span>Transfer to <strong>' + esc(t.toEmail) + '</strong> is waiting for them to accept (until ' + esc(day(t.expiresAt)) + ').</span>' +
        '<button type="button" class="btn btn-secondary" data-cancel>Cancel transfer</button>';
      bar.querySelector('[data-cancel]').addEventListener('click', async e => {
        if (!confirm('Cancel this transfer? The patient stays in your records.')) return;
        e.target.disabled = true;
        try { await call({ action: 'cancel', transferId: t.id }); toast('Transfer cancelled.', 'success'); }
        catch (err) { toast(err.message, 'error', 6000); e.target.disabled = false; }
      });
    } else {
      bar.innerHTML = '<button type="button" class="btn btn-secondary rx-transfer-open"><i class="bx bx-transfer-alt" aria-hidden="true"></i> Transfer to another account</button>';
      bar.querySelector('button').addEventListener('click', () => offer(patientId, p));
    }
  }

  // ------------------------------------------------------------------ on the dashboard: transfers sent to me
  let incomingRef = null;
  function incoming(el, onAccepted) {
    const u = user();
    if (incomingRef) { incomingRef.off(); incomingRef = null; }
    if (!el) return;
    if (!u) { el.hidden = true; el.innerHTML = ''; return; }
    incomingRef = firebase.database().ref('users/' + u.uid + '/incomingTransfers');
    incomingRef.on('value', snap => {
      const list = Object.entries(snap.val() || {}).filter(([, t]) => t && t.expiresAt > Date.now()).sort((a, b) => b[1].createdAt - a[1].createdAt);
      el.hidden = !list.length;
      el.innerHTML = list.map(([id, t]) =>
        '<div class="rx-transfer-in" data-id="' + esc(id) + '"><i class="bx bx-transfer-alt" aria-hidden="true"></i>' +
        '<div><strong>' + esc(t.fromName || 'A colleague') + '</strong>' + (t.fromEmail ? ' (' + esc(t.fromEmail) + ')' : '') + ' wants to transfer a patient' + (t.regNumber ? ' (their Reg #' + esc(t.regNumber) + ')' : '') + ' to your Smart EMR. Open until ' + esc(day(t.expiresAt)) + '.</div>' +
        '<button type="button" class="btn btn-secondary" data-no>Decline</button><button type="button" class="btn btn-primary" data-yes>Accept</button></div>').join('');
      el.querySelectorAll('.rx-transfer-in').forEach(row => {
        const id = row.getAttribute('data-id');
        const act = async (action, btn) => {
          row.querySelectorAll('button').forEach(b => { b.disabled = true; });
          try {
            const r = await call({ action, transferId: id });
            toast(action === 'accept' ? 'Patient added to your Smart EMR.' : 'Transfer declined.', 'success');
            if (action === 'accept' && onAccepted) onAccepted(r.patientId);
          } catch (e) { toast(e.message, 'error', 6000); row.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
        };
        row.querySelector('[data-yes]').addEventListener('click', e => act('accept', e.target));
        row.querySelector('[data-no]').addEventListener('click', e => { if (confirm('Decline this transfer? The patient stays with the sender.')) act('decline', e.target); });
      });
    });
  }
  function stop() { if (incomingRef) { incomingRef.off(); incomingRef = null; } }

  // styles (teal, light and dark through the app's own variables)
  const css = document.createElement('style');
  css.textContent =
    '.rx-transfer-modal{position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:16px}' +
    '.rx-transfer-card{background:var(--bg-card,var(--surface,#fff));color:var(--text-primary,#0f172a);border-radius:16px;max-width:460px;width:100%;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.25)}' +
    '.rx-transfer-card h3{margin:0 0 8px;font-size:1.1rem;display:flex;gap:8px;align-items:center;color:#0d9488}' +
    '.rx-transfer-card p{margin:0 0 14px;font-size:.9rem;line-height:1.5;color:var(--text-secondary,#475569)}' +
    '.rx-transfer-card label{display:block;font-size:.85rem;font-weight:600;margin:0 0 6px}' +
    '.rx-transfer-card input[type=email]{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:10px;border:1px solid var(--border-light,#cbd5e1);background:transparent;color:inherit;font:inherit;margin-bottom:12px}' +
    '.rx-transfer-card .rx-transfer-check{display:flex;gap:8px;align-items:flex-start;font-weight:500;font-size:.85rem}' +
    '.rx-transfer-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}' +
    '.rx-transfer-bar,.rx-transfer-in{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0;padding:10px 12px;border-radius:12px;background:rgba(13,148,136,.08);border:1px solid rgba(13,148,136,.25);font-size:.9rem}' +
    '.rx-transfer-bar[hidden]{display:none}.rx-transfer-bar>span,.rx-transfer-in>div{flex:1;min-width:180px}' +
    '.rx-transfer-bar>i,.rx-transfer-in>i{color:#0d9488;font-size:1.2rem}' +
    '.rx-transfer-bar .rx-transfer-open{margin-left:auto}';
  document.head.appendChild(css);

  window.RehablixEmrTransfer = { offer, patientBar, incoming, stop, useToast: fn => { toastFn = typeof fn === 'function' ? fn : null; } };
})();
