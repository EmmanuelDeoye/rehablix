// js/group-info.js — the Group information modal (2026-10-22: "center" accounts are called groups now). Opened from
// the group switcher on the shared tools, from a membership in Settings, and by the owner from their group card.
// It shows the group's details, its link, its members and its recent activity:
//   - the owner sees every member (with their status) and the whole group's activity;
//   - a member sees the active members and their own activity in the group.
// Data (js/center.js): users/{groupUid}/centers = { name, ownerEmail, createdAt, slug, members/{uid}, activity/{id} }.
// Android: settings/GroupInfo.kt, the same.
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const STATUS = { active: 'Active', invited: 'Invited', declined: 'Declined', revoked: 'Access revoked' };
  const when = t => (t ? new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const day = t => (t ? new Date(t).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : '—');

  function modal() {
    let m = document.getElementById('groupInfoModal');
    if (m) return m;
    document.body.insertAdjacentHTML('beforeend',
      '<div id="groupInfoModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="giTitle">' +
      '<div class="modal-content glass gi-content">' +
      '<button class="modal-close" id="giClose" aria-label="Close">&times;</button>' +
      '<div class="gi-head"><span class="gi-icon">🏥</span><div><h2 id="giTitle">Group</h2><p id="giSub"></p></div></div>' +
      '<div class="gi-tabs" role="tablist">' +
      ['info', 'members', 'activity'].map((t, i) => '<button type="button" role="tab" class="gi-tab' + (i ? '' : ' on') + '" data-tab="' + t + '">' + { info: 'Info & link', members: 'Members', activity: 'Activity' }[t] + '</button>').join('') +
      '</div><div id="giBody"></div></div></div>');
    m = document.getElementById('groupInfoModal');
    const close = () => { m.classList.remove('show'); document.body.style.overflow = ''; };
    document.getElementById('giClose').addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.classList.contains('show')) close(); });
    m.querySelector('.gi-tabs').addEventListener('click', e => {
      const b = e.target.closest('.gi-tab'); if (!b) return;
      m.querySelectorAll('.gi-tab').forEach(x => x.classList.toggle('on', x === b));
      show(b.dataset.tab);
    });
    return m;
  }

  let data = null;   // { gid, group, members, activity, isOwner, me }

  function show(tab) {
    const body = document.getElementById('giBody');
    if (!data) { body.innerHTML = '<p class="gi-note">Loading…</p>'; return; }
    const { group, members, activity, isOwner, me } = data;
    if (tab === 'info') {
      const link = group.slug ? 'https://rehablix.com/' + group.slug : '';
      const active = members.filter(x => x.status === 'active').length;
      body.innerHTML =
        '<div class="gi-rows">' +
        row('Name', group.name || '—') +
        row('Owner', isOwner ? 'You' : (group.ownerName || group.ownerEmail || '—')) +
        row('Your role', isOwner ? 'Owner' : 'Member') +
        row('Created', day(group.createdAt)) +
        row('Members', active + ' active' + (isOwner && members.length > active ? ' · ' + (members.length - active) + ' other' : '')) +
        '</div>' +
        '<h3 class="gi-sub">Group link</h3>' +
        (link
          ? '<div class="gi-link"><code>' + esc(link.replace('https://', '')) + '</code><button type="button" class="gi-btn" id="giCopy">Copy</button></div>' +
            '<p class="gi-note">Anyone with active access can use it to get straight to the group\'s tools.</p>'
          : '<p class="gi-note">' + (isOwner ? 'No link yet: create one in Settings > Group / Organization.' : 'The owner has not made a link for this group yet.') + '</p>') +
        '<h3 class="gi-sub">Shared tools</h3><p class="gi-note">Smart EMR, Project Maker, Audio Transcription and Exam Simulator work in the group\'s data when you work in this group. Everything else stays private.</p>';
      const copy = document.getElementById('giCopy');
      if (copy) copy.addEventListener('click', () => {
        (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject())
          .then(() => { copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); })
          .catch(() => { copy.textContent = 'Could not copy'; });
      });
    } else if (tab === 'members') {
      const list = isOwner ? members : members.filter(x => x.status === 'active');
      body.innerHTML = list.length ? '<div class="gi-list">' + list.map(x =>
        '<div class="gi-member"><span class="gi-avatar">' + esc((x.name || x.email || '?').charAt(0).toUpperCase()) + '</span>' +
        '<div class="gi-who"><strong>' + esc(x.name || x.email || 'Member') + (x.uid === me ? ' (you)' : '') + '</strong>' +
        (isOwner && x.email ? '<span>' + esc(x.email) + '</span>' : '') + '</div>' +
        '<span class="gi-status gi-' + esc(x.status || 'active') + '">' + esc(STATUS[x.status] || 'Active') + '</span></div>').join('') + '</div>'
        : '<p class="gi-note">' + (isOwner ? 'No members yet. Invite your team in Settings > Group / Organization.' : 'No other members yet.') + '</p>';
    } else {
      const list = isOwner ? activity : activity.filter(a => a.uid === me);
      body.innerHTML = (isOwner ? '' : '<p class="gi-note">Your recent work in this group.</p>') + (list.length ? '<div class="gi-list">' + list.map(a =>
        '<div class="gi-act"><div><strong>' + esc(isOwner ? (a.name || a.email || 'Someone') : 'You') + '</strong> ' + esc(a.action || '') + (a.detail ? ' — ' + esc(a.detail) : '') + '</div>' +
        '<span>' + esc(a.page || '') + (a.page ? ' · ' : '') + esc(when(a.timestamp)) + '</span></div>').join('') + '</div>'
        : '<p class="gi-note">No activity recorded yet.</p>');
    }
  }
  function row(k, v) { return '<div class="gi-row"><span>' + esc(k) + '</span><b>' + esc(v) + '</b></div>'; }

  /** Opens the modal for the group [gid] (its owner's uid). */
  async function open(gid) {
    const user = firebase.auth().currentUser;
    if (!user || !gid) return;
    const m = modal();
    data = null;
    m.querySelectorAll('.gi-tab').forEach((x, i) => x.classList.toggle('on', i === 0));
    document.getElementById('giTitle').textContent = 'Group';
    document.getElementById('giSub').textContent = '';
    show('info');
    m.classList.add('show');
    document.body.style.overflow = 'hidden';
    try {
      const db = firebase.database();
      const [g, acts, owner] = await Promise.all([
        db.ref('users/' + gid + '/centers').once('value').then(s => s.val() || {}),
        db.ref('users/' + gid + '/centers/activity').limitToLast(40).once('value').then(s => s.val() || {}).catch(() => ({})),
        db.ref('users/' + gid + '/name').once('value').then(s => s.val()).catch(() => null),
      ]);
      const members = Object.keys(g.members || {}).map(uid => Object.assign({ uid }, g.members[uid]))
        .filter(x => x.status !== 'declined')
        .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) || String(a.name || a.email).localeCompare(String(b.name || b.email)));
      const activity = Object.values(acts).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
      data = { gid, group: Object.assign({}, g, { ownerName: owner }), members, activity, isOwner: user.uid === gid, me: user.uid };
      document.getElementById('giTitle').textContent = g.name || 'Group';
      document.getElementById('giSub').textContent = (user.uid === gid ? 'You own this group' : 'You are a member') + ' · ' + members.filter(x => x.status === 'active').length + ' active members';
      const on = m.querySelector('.gi-tab.on');
      show(on ? on.dataset.tab : 'info');
    } catch (e) {
      document.getElementById('giBody').innerHTML = '<p class="gi-note">Could not load this group: ' + esc(e.message || 'please try again') + '.</p>';
    }
  }

  window.RehablixGroupInfo = { open };
  // any button with class "group-info-btn" and data-center="<groupUid>" opens it
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('.group-info-btn');
    if (b && b.dataset.center) { e.preventDefault(); open(b.dataset.center); }
  });
})();
