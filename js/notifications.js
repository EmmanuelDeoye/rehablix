// js/notifications.js — Rehablix notifications (Web / PWA).
//
// Four kinds only, each with its own switch (Settings > Notifications):
//   aiTasks        a background AI job finished (reply, document, deck, transcript…)
//   reminders      occasional, friendly nudges to come back
//   invites        an invitation to join a center
//   announcements  important news from Rehablix
//
// Delivery
//   • Push (app closed / in the background): Firebase Cloud Messaging with the
//     site's VAPID key; the service worker (service-worker.js) shows it.
//     Sending is done by backend/functions/notifications.js.
//   • Local: when a long AI job finishes while this tab is hidden, the page
//     itself raises the notification — no server involved.
//   • In-app: with the page open, a toast is shown instead of a system popup,
//     and the newest unseen announcement appears as a banner.
//
// Stored per user:
//   users/{uid}/notifications/prefs   = { aiTasks, reminders, invites, announcements }  (booleans)
//   users/{uid}/notifications/tokens/{id} = { token, platform: 'web'|'android', ua, updatedAt }
(function () {
  const VAPID_KEY = 'BCOpSuWoh7QEbKpHwlWM7p6xWUd0TdDZQeX2ZCv0OuAoD1KL55x6uy9QNzyBnIgl9bWiZDPT09fWmSwdHsQ7Ti0';
  const DEFAULT_PREFS = { aiTasks: true, reminders: true, invites: true, announcements: true };
  const PREFS_CACHE_KEY = 'rehablix_notif_prefs';
  const SEEN_ANNOUNCEMENT_KEY = 'rehablix_seen_announcement';
  const TYPE_PREF = { ai_task: 'aiTasks', reminder: 'reminders', invite: 'invites', announcement: 'announcements' };

  let prefs = Object.assign({}, DEFAULT_PREFS);
  try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS_CACHE_KEY) || '{}')); } catch (e) {}
  let messaging = null;
  let tokenId = null;

  const supported = () => 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  const permission = () => (supported() ? Notification.permission : 'unsupported');
  const user = () => (window.firebase && firebase.auth ? firebase.auth().currentUser : null);
  const db = () => firebase.database();

  function toast(message, type) {
    let c = document.getElementById('toast-container');
    if (!c) { c = document.createElement('div'); c.id = 'toast-container'; document.body.appendChild(c); }
    const t = document.createElement('div');
    t.className = 'toast ' + (type || 'info');
    const span = document.createElement('span'); span.textContent = message;
    t.innerHTML = '<i class="fas fa-bell"></i>'; t.appendChild(span);
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 5000);
  }

  // ---- preferences ---------------------------------------------------------
  async function loadPrefs() {
    const u = user();
    if (!u) return prefs;
    try {
      const v = (await db().ref('users/' + u.uid + '/notifications/prefs').once('value')).val();
      prefs = Object.assign({}, DEFAULT_PREFS, v || {});
      localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(prefs));
    } catch (e) { /* keep cached */ }
    return prefs;
  }
  async function savePrefs(next) {
    prefs = Object.assign({}, DEFAULT_PREFS, prefs, next);
    try { localStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(prefs)); } catch (e) {}
    const u = user();
    if (u) await db().ref('users/' + u.uid + '/notifications/prefs').set(prefs);
    return prefs;
  }

  // ---- push registration ---------------------------------------------------
  function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return 'w' + (h >>> 0).toString(36); }

  async function registerToken() {
    const u = user();
    if (!u || !supported() || Notification.permission !== 'granted' || !firebase.messaging) return null;
    try {
      const reg = await navigator.serviceWorker.ready;
      if (!messaging) {
        messaging = firebase.messaging();
        // Page open: show a toast instead of a system popup.
        messaging.onMessage((payload) => {
          const d = Object.assign({}, payload.data, payload.notification);
          if (!allowed(d.type)) return;
          toast((d.title ? d.title + ': ' : '') + (d.body || ''), 'info');
        });
      }
      const token = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
      if (!token) return null;
      tokenId = hash(token);
      await db().ref('users/' + u.uid + '/notifications/tokens/' + tokenId).set({
        token, platform: 'web', ua: (navigator.userAgent || '').slice(0, 160), updatedAt: Date.now(),
      });
      return token;
    } catch (e) {
      console.warn('[notify] push registration failed', e);
      return null;
    }
  }

  /** Asks for permission (must be called from a tap/click) and registers this browser. */
  async function enable() {
    if (!supported()) return { ok: false, reason: 'unsupported' };
    let p = Notification.permission;
    if (p === 'default') p = await Notification.requestPermission();
    if (p !== 'granted') return { ok: false, reason: p === 'denied' ? 'denied' : 'dismissed' };
    const token = await registerToken();
    return { ok: true, push: !!token };
  }

  async function disableThisDevice() {
    const u = user();
    try { if (messaging) await messaging.deleteToken(); } catch (e) {}
    if (u && tokenId) await db().ref('users/' + u.uid + '/notifications/tokens/' + tokenId).remove().catch(() => {});
    tokenId = null;
  }

  // ---- showing --------------------------------------------------------------
  function allowed(type) { const k = TYPE_PREF[type]; return !k || prefs[k] !== false; }

  /**
   * Raises a notification from the page itself. System popup when the tab is
   * hidden (and permission was given); otherwise a toast when `toastWhenVisible`.
   */
  async function show(type, title, body, url, opts) {
    opts = opts || {};
    if (!allowed(type)) return false;
    if (document.visibilityState === 'visible') { if (opts.toastWhenVisible) toast(title + (body ? ': ' + body : ''), 'info'); return false; }
    if (!supported() || Notification.permission !== 'granted') return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, {
        body: body || '', icon: '/img/icon-192.png', badge: '/img/icon-192.png',
        tag: opts.tag || type, renotify: true, data: { url: url || '/index.html', type },
      });
      return true;
    } catch (e) { return false; }
  }

  /** A long AI job finished: tell the user only if they've looked away. */
  let lastSpecificAt = 0;
  function aiTaskDone(title, body, url) { lastSpecificAt = Date.now(); return show('ai_task', title || 'Your result is ready', body || 'Tap to open it in Rehablix.', url || location.href, { tag: 'ai-task' }); }

  // Every tool, not just Lixa: when the last AI request of a task finishes
  // while this tab is in the background, raise "Your result is ready" (unless
  // the tool already announced its own result).
  (function watchAiRequests() {
    const AI_HOST = /^https:\/\/(api\.deepseek\.com|api\.openai\.com)\//;
    const inner = window.fetch.bind(window);
    let inFlight = 0, leftWhileBusy = false, idleTimer = null;
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { if (inFlight > 0) leftWhileBusy = true; } else leftWhileBusy = false; });
    const settle = () => {
      inFlight = Math.max(0, inFlight - 1);
      if (inFlight > 0) return;
      clearTimeout(idleTimer);
      // Tools often chain several calls: only "done" once nothing new starts for a few seconds.
      idleTimer = setTimeout(() => {
        if (inFlight > 0) return;
        if (leftWhileBusy && document.visibilityState === 'hidden' && Date.now() - lastSpecificAt > 15000) {
          show('ai_task', 'Your result is ready', 'Rehablix finished working on your request.', location.href, { tag: 'ai-task' });
        }
        leftWhileBusy = false;
      }, 5000);
    };
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!AI_HOST.test(url)) return inner(input, init);
      inFlight++;
      clearTimeout(idleTimer);
      if (document.visibilityState === 'hidden') leftWhileBusy = true;
      return inner(input, init).then((res) => {
        // Streaming replies are finished when their body ends, not when the headers arrive.
        try { res.clone().arrayBuffer().then(settle, settle); } catch (e) { settle(); }
        return res;
      }, (err) => { settle(); throw err; });
    };
  })();

  // One gentle, one-time invitation to turn notifications on (never the
  // browser prompt out of the blue: that only opens when the user taps).
  function offerNotifications() {
    const KEY = 'rehablix_notif_offered';
    try { if (localStorage.getItem(KEY) === '1') return; } catch (e) { return; }
    if (!supported() || Notification.permission !== 'default' || document.getElementById('rxNotifOffer')) return;
    const el = document.createElement('div');
    el.id = 'rxNotifOffer'; el.className = 'rx-announcement'; el.setAttribute('role', 'status');
    el.innerHTML = '<i class="fas fa-bell" aria-hidden="true"></i><div class="rx-announcement-text"><strong>Get notified when results are ready</strong><span>Rehablix can tell you when a long AI task finishes, even if you switch tabs.</span></div>';
    const done = () => { try { localStorage.setItem(KEY, '1'); } catch (e) {} el.remove(); };
    const on = document.createElement('button'); on.type = 'button'; on.className = 'rx-announcement-open'; on.textContent = 'Turn on';
    on.addEventListener('click', async () => { done(); const r = await enable(); if (r.ok) toast('Notifications turned on', 'success'); });
    const close = document.createElement('button'); close.type = 'button'; close.className = 'rx-announcement-close'; close.setAttribute('aria-label', 'Not now'); close.innerHTML = '<i class="fas fa-xmark"></i>';
    close.addEventListener('click', done);
    el.appendChild(on); el.appendChild(close);
    document.body.appendChild(el);
  }

  // ---- in-app announcement banner (works without push) -----------------------
  async function checkAnnouncement() {
    if (!allowed('announcement')) return;
    try {
      const snap = await db().ref('announcements').orderByChild('createdAt').limitToLast(1).once('value');
      let latest = null;
      snap.forEach((c) => { latest = Object.assign({ id: c.key }, c.val()); });
      if (!latest || latest.active === false) return;
      if (latest.platform && latest.platform !== 'all' && latest.platform !== 'web') return;
      if (latest.expiresAt && latest.expiresAt < Date.now()) return;
      if (localStorage.getItem(SEEN_ANNOUNCEMENT_KEY) === latest.id) return;
      renderBanner(latest);
    } catch (e) { /* not readable / offline */ }
  }

  function renderBanner(a) {
    if (document.getElementById('rxAnnouncement')) return;
    const el = document.createElement('div');
    el.id = 'rxAnnouncement'; el.className = 'rx-announcement'; el.setAttribute('role', 'status');
    const text = document.createElement('div'); text.className = 'rx-announcement-text';
    const strong = document.createElement('strong'); strong.textContent = a.title || 'Announcement';
    const p = document.createElement('span'); p.textContent = a.body || '';
    text.appendChild(strong); text.appendChild(p);
    el.innerHTML = '<i class="fas fa-bullhorn" aria-hidden="true"></i>';
    el.appendChild(text);
    const dismiss = () => { try { localStorage.setItem(SEEN_ANNOUNCEMENT_KEY, a.id); } catch (e) {} el.remove(); };
    if (a.url) {
      const open = document.createElement('button'); open.type = 'button'; open.className = 'rx-announcement-open'; open.textContent = a.cta || 'Open';
      open.addEventListener('click', () => { dismiss(); if (/^https?:/i.test(a.url)) window.open(a.url, '_blank', 'noopener'); else if (window.RehablixRouter) window.RehablixRouter.go(a.url); else location.href = a.url; });
      el.appendChild(open);
    }
    const close = document.createElement('button'); close.type = 'button'; close.className = 'rx-announcement-close'; close.setAttribute('aria-label', 'Dismiss'); close.innerHTML = '<i class="fas fa-xmark"></i>';
    close.addEventListener('click', dismiss);
    el.appendChild(close);
    document.body.appendChild(el);
  }

  // ---- lifecycle --------------------------------------------------------------
  function init() {
    if (!window.firebase || !firebase.auth) return;
    firebase.auth().onAuthStateChanged(async (u) => {
      if (!u) return;
      await loadPrefs();
      if (permission() === 'granted') registerToken();   // refresh silently; never prompts on its own
      // Last seen: lets the reminder sender skip people who are active anyway.
      db().ref('users/' + u.uid + '/notifications/lastSeenAt').set(Date.now()).catch(() => {});
      checkAnnouncement();
      setTimeout(offerNotifications, 6000);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.RehablixNotify = {
    supported, permission, enable, disableThisDevice, loadPrefs, savePrefs, getPrefs: () => Object.assign({}, prefs),
    show, aiTaskDone, checkAnnouncement, DEFAULT_PREFS,
  };
})();
