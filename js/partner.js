// js/partner.js – Rehablix Partners page logic
// States: logged-out | loading | none (apply) | pending | rejected | approved (dashboard)
//
// Data:
//   partners/{uid}            application + earnings/referrals/transactions (admin- and server-written)
//   partners/{uid}/profile    the partner's OWN editable details:
//                             { name, phone, payoutMethod: 'bank'|'paypal', bankName, accountName,
//                               accountNumber, paypalEmail, updatedAt }
//   users/{uid}/partner       { status, code, appliedAt }
// The legacy top-level fields (name / payoutMethod / payoutDetails) are kept
// in step where the database allows it, so the admin dashboard keeps working.

document.addEventListener('DOMContentLoaded', () => {
  const auth = firebase.auth();
  const db = firebase.database();
  const $ = (id) => document.getElementById(id);

  const els = {
    loggedOut: $('partnerLoggedOut'), loading: $('partnerLoading'), none: $('partnerStateNone'),
    pending: $('partnerStatePending'), rejected: $('partnerStateRejected'), approved: $('partnerStateApproved')
  };
  function showState(name) { Object.entries(els).forEach(([key, el]) => { if (el) el.style.display = key === name ? '' : 'none'; }); }
  showState('loading');

  const loginPromptBtn = $('partnerLoginPromptBtn');
  if (loginPromptBtn) loginPromptBtn.addEventListener('click', () => { const b = $('loginBtn'); if (b) b.click(); });

  function showToast(message, isError = false, duration = 3500) {
    let toast = $('toast');
    if (!toast) { toast = document.createElement('div'); toast.id = 'toast'; toast.className = 'toast'; document.body.appendChild(toast); }
    toast.textContent = message;
    toast.style.background = isError ? '#ef4444' : 'var(--settings-accent, var(--accent))';
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), duration);
  }
  function escapeHtml(text) { const div = document.createElement('div'); div.textContent = text == null ? '' : String(text); return div.innerHTML; }

  // ---------- Payout fields (shared by the application and "Your details") ----------
  function payoutFieldsHtml(prefix, p) {
    p = p || {};
    const method = p.payoutMethod || 'bank';
    return `
      <div class="pt-grid">
        <label class="pt-field pt-wide">Payout method
          <select id="${prefix}Method">
            <option value="bank" ${method === 'bank' ? 'selected' : ''}>Bank transfer</option>
            <option value="paypal" ${method === 'paypal' ? 'selected' : ''}>PayPal</option>
          </select>
        </label>
        <label class="pt-field" data-for="bank">Bank name<input type="text" id="${prefix}BankName" value="${escapeHtml(p.bankName || '')}" placeholder="e.g. GTBank"></label>
        <label class="pt-field" data-for="bank">Account number<input type="text" id="${prefix}AccountNumber" inputmode="numeric" autocomplete="off" value="${escapeHtml(p.accountNumber || '')}" placeholder="10 digits"></label>
        <label class="pt-field pt-wide" data-for="bank">Account name<input type="text" id="${prefix}AccountName" value="${escapeHtml(p.accountName || '')}" placeholder="Name on the account"></label>
        <label class="pt-field pt-wide" data-for="paypal">PayPal email<input type="email" id="${prefix}PaypalEmail" value="${escapeHtml(p.paypalEmail || '')}" placeholder="you@example.com"></label>
      </div>
      <p class="pt-hint"><i class="fas fa-lock"></i> Used only to pay out your commissions.</p>`;
  }
  function wirePayoutFields(root, prefix) {
    const sel = root.querySelector('#' + prefix + 'Method');
    const apply = () => root.querySelectorAll('[data-for]').forEach(el => { el.style.display = el.dataset.for === sel.value ? '' : 'none'; });
    sel.addEventListener('change', apply); apply();
  }
  function readPayout(prefix) {
    const v = (id) => ($(prefix + id) ? $(prefix + id).value.trim() : '');
    const out = { payoutMethod: v('Method') || 'bank', bankName: v('BankName'), accountName: v('AccountName'), accountNumber: v('AccountNumber').replace(/\s+/g, ''), paypalEmail: v('PaypalEmail') };
    if (out.payoutMethod === 'bank') {
      if (!out.bankName || !out.accountName || !out.accountNumber) return { error: 'Please fill in the bank name, account number and account name.' };
      if (!/^\d{6,20}$/.test(out.accountNumber)) return { error: 'The account number should contain digits only.' };
    } else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.paypalEmail)) return { error: 'Please enter a valid PayPal email.' };
    return out;
  }
  const payoutSummary = (p) => p.payoutMethod === 'paypal' ? `PayPal: ${p.paypalEmail}` : `${p.bankName} · ${p.accountNumber} · ${p.accountName}`;
  const maskAccount = (n) => { const s = String(n || ''); return s.length > 4 ? '•••• ' + s.slice(-4) : s; };

  // ---------- Referral code ----------
  function slugify(name) { return (name || 'partner').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 10) || 'partner'; }
  async function generateUniqueCode(name) {
    const base = slugify(name);
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = `${base}${Math.random().toString(36).slice(2, 6)}`;
      const snap = await db.ref('referralCodes/' + candidate).once('value');
      if (!snap.exists()) return candidate;
    }
    return `${base}${Date.now().toString(36)}`;
  }

  // ---------- Apply ----------
  const applyForm = $('partnerApplyForm');
  const applyBtn = $('partnerApplyBtn');
  const applyError = $('partnerApplyError');
  let currentUser = null;
  let currentPartner = null;

  const applyPayoutHost = document.querySelector('[data-payout-fields="apply"]');
  if (applyPayoutHost) { applyPayoutHost.innerHTML = payoutFieldsHtml('apply', {}); wirePayoutFields(applyPayoutHost, 'apply'); }

  if (applyForm) applyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const name = $('partnerFullName').value.trim();
    const phone = $('partnerPhone').value.trim();
    const audience = $('partnerAudience').value;
    const note = $('partnerNote').value.trim();
    const payout = readPayout('apply');
    if (!name || !audience) { applyError.textContent = 'Please fill in your name and how you will share rehablix.'; return; }
    if (payout.error) { applyError.textContent = payout.error; return; }

    applyError.textContent = '';
    applyBtn.disabled = true; applyBtn.textContent = 'Submitting…';
    try {
      const code = await generateUniqueCode(name);
      const now = new Date().toISOString();
      const profile = Object.assign({ name, phone, updatedAt: Date.now() }, payout);
      await db.ref('partners/' + currentUser.uid).set({
        uid: currentUser.uid, name, email: currentUser.email, audience,
        payoutMethod: payout.payoutMethod, payoutDetails: payoutSummary(payout), note, code,
        status: 'pending', appliedAt: now, profile,
        earnings: { total: 0, pending: 0, paid: 0, count: 0 }
      });
      await db.ref('referralCodes/' + code).set(currentUser.uid);
      await db.ref(`users/${currentUser.uid}/partner`).set({ status: 'pending', code, appliedAt: now });
      showToast('Application submitted. We\'ll be in touch once it\'s reviewed.');
      currentPartner = { name, email: currentUser.email, profile };
      renderDetailsCard('pending');
      showState('pending');
    } catch (err) {
      console.error('Partner application failed:', err);
      applyError.textContent = 'Something went wrong submitting your application. Please try again.';
    } finally {
      applyBtn.disabled = false; applyBtn.textContent = 'Submit application';
    }
  });

  const reapplyBtn = $('partnerReapplyBtn');
  if (reapplyBtn) reapplyBtn.addEventListener('click', () => showState('none'));

  // ---------- "Your details" (view + edit, including bank details) ----------
  function profileOf(partner) {
    const p = Object.assign({}, partner && partner.profile);
    if (!p.name) p.name = (partner && partner.name) || '';
    if (!p.payoutMethod) p.payoutMethod = (partner && partner.payoutMethod) || 'bank';
    return p;
  }

  function renderDetailsCard(which, editing) {
    const host = document.querySelector(`[data-details-card="${which}"]`);
    if (!host) return;
    const p = profileOf(currentPartner);
    const legacy = currentPartner && currentPartner.payoutDetails && !p.bankName && !p.paypalEmail ? currentPartner.payoutDetails : '';
    if (!editing) {
      const payoutLine = p.payoutMethod === 'paypal'
        ? (p.paypalEmail ? `PayPal · ${escapeHtml(p.paypalEmail)}` : '')
        : (p.bankName ? `${escapeHtml(p.bankName)} · ${escapeHtml(maskAccount(p.accountNumber))}<br><span class="pt-muted">${escapeHtml(p.accountName || '')}</span>` : '');
      host.innerHTML = `
        <section class="pt-card">
          <div class="pt-card-head">
            <h2 class="pt-card-title"><i class="fas fa-id-card"></i> Your details</h2>
            <button class="pt-btn pt-btn-ghost pt-btn-sm" data-act="edit"><i class="fas fa-pen"></i> Edit</button>
          </div>
          <dl class="pt-details">
            <div><dt>Name</dt><dd>${escapeHtml(p.name || '—')}</dd></div>
            <div><dt>Email</dt><dd>${escapeHtml((currentPartner && currentPartner.email) || (currentUser && currentUser.email) || '—')}</dd></div>
            <div><dt>Phone</dt><dd>${escapeHtml(p.phone || '—')}</dd></div>
            <div><dt>Payout account</dt><dd>${payoutLine || escapeHtml(legacy) || '<span class="pt-warn">Not set. Add it so we can pay you.</span>'}</dd></div>
          </dl>
        </section>`;
      host.querySelector('[data-act="edit"]').addEventListener('click', () => renderDetailsCard(which, true));
      return;
    }
    const prefix = which + 'Edit';
    host.innerHTML = `
      <form class="pt-card" novalidate>
        <h2 class="pt-card-title"><i class="fas fa-id-card"></i> Edit your details</h2>
        <div class="pt-grid">
          <label class="pt-field">Full name<input type="text" id="${prefix}Name" value="${escapeHtml(p.name || '')}" autocomplete="name"></label>
          <label class="pt-field">Phone number<input type="tel" id="${prefix}Phone" value="${escapeHtml(p.phone || '')}" autocomplete="tel"></label>
        </div>
        ${payoutFieldsHtml(prefix, p)}
        <p class="pt-error" role="alert"></p>
        <div class="pt-actions">
          <button type="button" class="pt-btn pt-btn-ghost" data-act="cancel">Cancel</button>
          <button type="submit" class="pt-btn">Save details</button>
        </div>
      </form>`;
    wirePayoutFields(host, prefix);
    const form = host.querySelector('form'), err = host.querySelector('.pt-error'), saveBtn = form.querySelector('button[type="submit"]');
    host.querySelector('[data-act="cancel"]').addEventListener('click', () => renderDetailsCard(which, false));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $(prefix + 'Name').value.trim();
      const payout = readPayout(prefix);
      if (!name) { err.textContent = 'Please enter your name.'; return; }
      if (payout.error) { err.textContent = payout.error; return; }
      err.textContent = '';
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      const profile = Object.assign({ name, phone: $(prefix + 'Phone').value.trim(), updatedAt: Date.now() }, payout);
      const base = 'partners/' + currentUser.uid;
      try {
        try {
          // Keep the fields the admin dashboard reads in step with the profile.
          await db.ref(base).update({ profile, name, payoutMethod: payout.payoutMethod, payoutDetails: payoutSummary(payout) });
        } catch (inner) {
          await db.ref(base + '/profile').set(profile);   // stricter rules: the profile node only
        }
        currentPartner = Object.assign({}, currentPartner, { name, profile, payoutMethod: payout.payoutMethod, payoutDetails: payoutSummary(payout) });
        showToast('Details saved');
        renderDetailsCard(which, false);
      } catch (e2) {
        console.error('Partner details save failed:', e2);
        err.textContent = 'Could not save your details. Please try again.';
        saveBtn.disabled = false; saveBtn.textContent = 'Save details';
      }
    });
  }

  // ---------- Dashboard ----------
  function formatMoney(amount) { return '$' + (Number(amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function formatDate(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return '—'; } }

  let dashboardWired = false;
  function renderDashboard(partner, keepDetails) {
    const link = `${window.location.origin}${window.location.pathname.replace('partner.html', 'index.html')}?ref=${encodeURIComponent(partner.code)}`;
    const linkInput = $('partnerLinkInput');
    if (linkInput) linkInput.value = link;
    if (!dashboardWired) {
      dashboardWired = true;
      $('copyPartnerLinkBtn').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(linkInput.value); } catch { linkInput.select(); document.execCommand('copy'); }
        showToast('Referral link copied');
      });
      const shareBtn = $('sharePartnerLinkBtn');
      if (shareBtn) {
        if (!navigator.share) shareBtn.style.display = 'none';
        shareBtn.addEventListener('click', () => navigator.share({ title: 'rehablix', text: 'Try rehablix, the clinical copilot for rehab professionals and students.', url: linkInput.value }).catch(() => {}));
      }
    }

    const earnings = partner.earnings || {};
    $('statEarningsTotal').textContent = formatMoney(earnings.total);
    $('statEarningsPending').textContent = formatMoney(earnings.pending);
    $('statConversionsCount').textContent = earnings.count || 0;

    const referrals = partner.referrals || {};
    const refKeys = Object.keys(referrals);
    $('statReferralsCount').textContent = refKeys.length;
    $('referralsEmpty').style.display = refKeys.length ? 'none' : '';
    $('referralsList').innerHTML = refKeys
      .sort((a, b) => new Date(referrals[b].joinedAt || 0) - new Date(referrals[a].joinedAt || 0))
      .map(k => { const r = referrals[k]; return `<div class="pt-row"><div class="pt-avatar">${escapeHtml((r.name || r.email || 'U').charAt(0).toUpperCase())}</div><div class="pt-row-main"><strong>${escapeHtml(r.name || r.email || 'User')}</strong><span>Joined ${formatDate(r.joinedAt)}</span></div></div>`; }).join('');

    const transactions = partner.transactions || {};
    const txKeys = Object.keys(transactions);
    $('transactionsEmpty').style.display = txKeys.length ? 'none' : '';
    $('transactionsList').innerHTML = txKeys
      .sort((a, b) => new Date(transactions[b].date || 0) - new Date(transactions[a].date || 0))
      .map(k => {
        const t = transactions[k];
        const planLabel = t.plan ? t.plan.charAt(0).toUpperCase() + t.plan.slice(1) : '—';
        return `<div class="pt-row"><div class="pt-row-main"><strong>${escapeHtml(t.referredName || t.referredEmail || 'User')}</strong><span>${escapeHtml(planLabel)} · ${escapeHtml(t.currency || '')} ${(Number(t.amount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} · ${formatDate(t.date)}</span></div><span class="pt-amount">+${formatMoney(t.commission)}</span></div>`;
      }).join('');

    if (!keepDetails) renderDetailsCard('approved');
  }

  // ---------- Auth state / status routing ----------
  let liveRef = null;
  auth.onAuthStateChanged(async (user) => {
    currentUser = user;
    if (liveRef) { liveRef.off(); liveRef = null; }
    if (!user) { showState('loggedOut'); return; }
    showState('loading');
    try {
      const [userPartnerSnap, partnerSnap] = await Promise.all([
        db.ref(`users/${user.uid}/partner/status`).once('value'),
        db.ref(`partners/${user.uid}`).once('value')
      ]);
      const status = userPartnerSnap.val();
      const partner = partnerSnap.val();
      currentPartner = partner;

      if (!status || status === 'none' || !partner) {
        const nameInput = $('partnerFullName');
        if (nameInput && !nameInput.value) {
          const snap = await db.ref(`users/${user.uid}/name`).once('value');
          nameInput.value = snap.val() || user.displayName || '';
        }
        showState('none');
        return;
      }
      if (status === 'pending') { renderDetailsCard('pending'); showState('pending'); return; }
      if (status === 'rejected') {
        const reasonEl = $('partnerRejectionReason');
        if (reasonEl && partner.rejectionReason) reasonEl.textContent = `Reason: ${partner.rejectionReason}`;
        showState('rejected');
        return;
      }
      if (status === 'approved') {
        renderDashboard(partner);
        showState('approved');
        // Keep earnings/referrals live while open (without disturbing an open edit form).
        liveRef = db.ref(`partners/${user.uid}`);
        liveRef.on('value', (snap) => {
          const updated = snap.val();
          if (!updated) return;
          currentPartner = updated;
          const editing = !!document.querySelector('[data-details-card="approved"] form');
          renderDashboard(updated, editing);
        });
        return;
      }
      showState('none');
    } catch (err) {
      console.error('Failed to load partner status:', err);
      showToast('Could not load your partner status. Please refresh.', true);
    }
  });
});
