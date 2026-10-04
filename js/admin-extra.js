// js/admin-extra.js — admin dashboard add-ons (loaded after js/admin.js):
//   • App & Versions: Android version numbers, forced-update floor, release
//     notes and the "testers: move to the Play Store version" notice.
//   • Notifications: send an announcement (in-app banner + push), see/remove
//     past ones, and how many devices can be reached.
//   • Change Plan: quick period presets (default 1 month).
//
// Data written:
//   appConfig/android = { latestVersionCode, latestVersionName, minVersionCode, updateUrl,
//                         releaseNotes, testerNotice: { enabled, title, message, playUrl, repeatHours }, updatedAt }
//   announcements/{id} = { title, body, url, cta, platform, push, active, createdAt, expiresAt, by }
// The Android app and the web app read these directly; pushes are sent by
// backend/functions/notifications.js (onAnnouncement) once that is deployed.
document.addEventListener('DOMContentLoaded', () => {
  const db = firebase.database();
  const $ = (id) => document.getElementById(id);
  const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };

  function toast(message, isError) {
    const t = document.createElement('div');
    t.textContent = message;
    t.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:9999;padding:10px 16px;border-radius:10px;font:600 14px system-ui;color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.25);background:' + (isError ? '#dc2626' : '#0f766e');
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }
  const msg = (el, text, ok) => { if (!el) return; el.textContent = text; el.className = 'settings-msg ' + (ok ? 'success' : 'error'); };

  // ---- view switching (admin.js hides every view first; these two are ours) ----
  document.querySelectorAll('.sidebar-link').forEach((link) => {
    link.addEventListener('click', () => {
      const view = link.dataset.view;
      if (view === 'app') { $('viewApp').style.display = 'block'; loadAppConfig(); }
      else if (view === 'notifications') { $('viewNotifications').style.display = 'block'; loadAnnouncements(); loadReach(); }
    });
  });

  // =====================================================================
  // Dashboard: all-time visits (only counted when the admin switches it on)
  // =====================================================================
  const allTimeToggle = $('allTimeToggle');
  if (allTimeToggle) allTimeToggle.addEventListener('change', async () => {
    const value = $('statVisitsAllTime'), hint = $('allTimeHint');
    if (!allTimeToggle.checked) { value.textContent = '—'; hint.textContent = 'Show'; return; }
    hint.textContent = 'Counting…'; value.textContent = '…';
    allTimeToggle.disabled = true;
    try {
      const count = (v) => (Array.isArray(v) ? v.filter(Boolean).length : (v && typeof v === 'object' ? Object.keys(v).length : 0));
      const [usersSnap, anonSnap] = await Promise.all([db.ref('users').once('value'), db.ref('anonymous-visits').once('value')]);
      let signedIn = 0;
      usersSnap.forEach((u) => { signedIn += count((u.val() || {}).visits); });
      const anonymous = count(anonSnap.val());
      value.textContent = (signedIn + anonymous).toLocaleString();
      hint.textContent = signedIn.toLocaleString() + ' signed-in · ' + anonymous.toLocaleString() + ' anonymous';
    } catch (e) {
      value.textContent = '—'; hint.textContent = 'Could not count'; allTimeToggle.checked = false;
    } finally { allTimeToggle.disabled = false; }
  });

  // =====================================================================
  // App & Versions
  // =====================================================================
  const APP_FIELDS = { latestVersionName: 'appLatestName', latestVersionCode: 'appLatestCode', minVersionCode: 'appMinCode', updateUrl: 'appUpdateUrl', releaseNotes: 'appReleaseNotes' };
  const TESTER_FIELDS = { title: 'testerTitle', message: 'testerMessage', playUrl: 'testerPlayUrl', repeatHours: 'testerRepeat' };

  async function loadAppConfig() {
    try {
      const cfg = (await db.ref('appConfig/android').once('value')).val() || {};
      Object.entries(APP_FIELDS).forEach(([k, id]) => { if ($(id)) $(id).value = cfg[k] == null ? '' : cfg[k]; });
      const t = cfg.testerNotice || {};
      $('testerEnabled').checked = !!t.enabled;
      Object.entries(TESTER_FIELDS).forEach(([k, id]) => { if ($(id)) $(id).value = t[k] == null ? '' : t[k]; });
      if (!$('testerTitle').value) $('testerTitle').value = 'Rehablix is now on Google Play';
      if (!$('testerMessage').value) $('testerMessage').value = 'Thank you for testing! This test version will stop receiving updates. Please uninstall it and install the official app from the Play Store. Your account and all your saved work stay exactly as they are.';
      if (!$('testerRepeat').value) $('testerRepeat').value = 6;
      paintTesterState();
      $('appConfigUpdated').textContent = cfg.updatedAt ? 'Last saved ' + new Date(cfg.updatedAt).toLocaleString() : 'Not saved yet';
    } catch (e) { msg($('appConfigMsg'), 'Could not load the app settings: ' + e.message, false); }
  }

  function paintTesterState() {
    const on = $('testerEnabled').checked;
    $('testerState').textContent = on ? 'ON — test builds are asking people to move to the Play Store version' : 'Off — testers see nothing';
    $('testerState').style.color = on ? '#b45309' : '';
  }
  if ($('testerEnabled')) $('testerEnabled').addEventListener('change', paintTesterState);

  if ($('saveAppConfigBtn')) $('saveAppConfigBtn').addEventListener('click', async () => {
    const num = (id) => { const n = parseInt($(id).value, 10); return Number.isFinite(n) && n > 0 ? n : null; };
    const latest = num('appLatestCode'), min = num('appMinCode');
    if (min && latest && min > latest) { msg($('appConfigMsg'), 'The minimum supported version cannot be higher than the latest version.', false); return; }
    const playUrl = $('testerPlayUrl').value.trim();
    if ($('testerEnabled').checked && !/^https:\/\/play\.google\.com\//.test(playUrl)) { msg($('appConfigMsg'), 'Add the Play Store link (https://play.google.com/…) before switching the tester notice on.', false); return; }
    if ($('testerEnabled').checked && !window.confirm('Switch the tester notice ON? Everyone using a test build will be asked to uninstall it and install from the Play Store.')) return;
    const cfg = {
      latestVersionName: $('appLatestName').value.trim() || null,
      latestVersionCode: latest,
      minVersionCode: min,
      updateUrl: $('appUpdateUrl').value.trim() || null,
      releaseNotes: $('appReleaseNotes').value.trim() || null,
      testerNotice: {
        enabled: $('testerEnabled').checked,
        title: $('testerTitle').value.trim(),
        message: $('testerMessage').value.trim(),
        playUrl,
        repeatHours: Math.max(1, parseInt($('testerRepeat').value, 10) || 6),
      },
      updatedAt: Date.now(),
    };
    try {
      await db.ref('appConfig/android').set(cfg);
      msg($('appConfigMsg'), 'Saved. Apps pick this up the next time they are opened.', true);
      $('appConfigUpdated').textContent = 'Last saved ' + new Date(cfg.updatedAt).toLocaleString();
    } catch (e) { msg($('appConfigMsg'), 'Could not save: ' + e.message, false); }
  });

  // =====================================================================
  // Notifications: announcements
  // =====================================================================
  async function loadReach() {
    const el = $('notifReach');
    if (!el) return;
    el.textContent = 'Counting devices…';
    try {
      const snap = await db.ref('users').once('value');
      let web = 0, android = 0, people = 0, off = 0;
      snap.forEach((u) => {
        const n = (u.val() || {}).notifications;
        if (!n || !n.tokens) return;
        people++;
        if (n.prefs && n.prefs.announcements === false) off++;
        Object.values(n.tokens).forEach((t) => { if (t && t.token) { if (t.platform === 'android') android++; else web++; } });
      });
      el.textContent = people + ' people have notifications on (' + android + ' Android devices, ' + web + ' browsers). ' + off + ' switched announcements off.';
    } catch (e) { el.textContent = 'Could not count devices.'; }
  }

  async function loadAnnouncements() {
    const list = $('announcementList');
    if (!list) return;
    list.innerHTML = '<p class="settings-hint">Loading…</p>';
    try {
      const snap = await db.ref('announcements').orderByChild('createdAt').limitToLast(20).once('value');
      const rows = [];
      snap.forEach((c) => { rows.push(Object.assign({ id: c.key }, c.val())); });
      rows.reverse();
      list.innerHTML = rows.length ? rows.map((a) => `
        <div class="announcement-row" data-id="${esc(a.id)}">
          <div class="announcement-row-text">
            <strong>${esc(a.title)}</strong>
            <span>${esc(a.body || '')}</span>
            <small>${new Date(a.createdAt || 0).toLocaleString()} · ${esc(a.platform || 'all')} · ${a.push === false ? 'in-app only' : (a.pushedAt ? 'pushed' : 'push pending')}${a.active === false ? ' · hidden' : ''}</small>
          </div>
          <div class="announcement-row-actions">
            <button class="admin-btn" data-act="toggle">${a.active === false ? 'Show' : 'Hide'}</button>
            <button class="admin-btn danger" data-act="delete">Delete</button>
          </div>
        </div>`).join('') : '<p class="settings-hint">No announcements yet.</p>';
    } catch (e) { list.innerHTML = '<p class="settings-hint">Could not load announcements: ' + esc(e.message) + '</p>'; }
  }

  if ($('announcementList')) $('announcementList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]'); if (!btn) return;
    const id = btn.closest('.announcement-row').dataset.id;
    try {
      if (btn.dataset.act === 'delete') {
        if (!window.confirm('Delete this announcement? It disappears from every app.')) return;
        await db.ref('announcements/' + id).remove();
      } else {
        const cur = (await db.ref('announcements/' + id + '/active').once('value')).val();
        await db.ref('announcements/' + id + '/active').set(cur === false);
      }
      loadAnnouncements();
    } catch (err) { toast('Could not update: ' + err.message, true); }
  });

  if ($('sendAnnouncementBtn')) $('sendAnnouncementBtn').addEventListener('click', async () => {
    const title = $('annTitle').value.trim(), body = $('annBody').value.trim();
    if (!title || !body) { msg($('annMsg'), 'A title and a message are both needed.', false); return; }
    const days = parseInt($('annDays').value, 10) || 7;
    const target = $('annTarget').value === 'custom' ? $('annUrl').value.trim() : $('annTarget').value;
    if (!window.confirm('Send "' + title + '" to ' + ($('annPlatform').value === 'all' ? 'everyone' : $('annPlatform').value + ' users') + '?')) return;
    const user = firebase.auth().currentUser;
    try {
      await db.ref('announcements').push({
        title: title.slice(0, 80), body: body.slice(0, 240), url: target || 'index.html#/lixa', cta: $('annCta').value.trim().slice(0, 24) || 'Open',
        platform: $('annPlatform').value, push: $('annPush').checked, active: true,
        createdAt: Date.now(), expiresAt: Date.now() + days * 86400000, by: user ? user.uid : null,
      });
      msg($('annMsg'), 'Announcement published.', true);
      $('annTitle').value = ''; $('annBody').value = '';
      loadAnnouncements();
    } catch (e) { msg($('annMsg'), 'Could not publish: ' + e.message, false); }
  });
  if ($('annTarget')) $('annTarget').addEventListener('change', () => { $('annUrl').style.display = $('annTarget').value === 'custom' ? '' : 'none'; });
  ['annTitle', 'annBody'].forEach((id) => { if ($(id)) $(id).addEventListener('input', () => {
    $('annPreviewTitle').textContent = $('annTitle').value || 'Title';
    $('annPreviewBody').textContent = $('annBody').value || 'Your message appears here.';
  }); });

  // =====================================================================
  // Change Plan: period presets (default 1 month)
  // =====================================================================
  const expiry = $('planExpiryDateInput');
  const presets = $('planPeriodPresets');
  function addPeriod(spec) {
    const d = new Date();
    if (spec.d) d.setDate(d.getDate() + spec.d);
    if (spec.m) d.setMonth(d.getMonth() + spec.m);
    if (spec.y) d.setFullYear(d.getFullYear() + spec.y);
    return d.toISOString().split('T')[0];
  }
  const PERIODS = { '1d': { d: 1 }, '1w': { d: 7 }, '2w': { d: 14 }, '1m': { m: 1 }, '1y': { y: 1 } };
  function choosePeriod(key) {
    if (!expiry || !PERIODS[key]) return;
    expiry.value = addPeriod(PERIODS[key]);
    if (presets) presets.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.period === key));
  }
  if (presets) presets.addEventListener('click', (e) => { const b = e.target.closest('button[data-period]'); if (b) choosePeriod(b.dataset.period); });
  if (expiry) expiry.addEventListener('input', () => { if (presets) presets.querySelectorAll('button').forEach((b) => b.classList.remove('active')); });
  // admin.js fills the date when the modal opens; the default period is 1 month.
  const modal = $('changePlanModal');
  if (modal) new MutationObserver(() => { if (modal.classList.contains('show')) choosePeriod('1m'); }).observe(modal, { attributes: true, attributeFilter: ['class'] });
});
