// js/space/space-view.js — the Space tab (route "space"): learning games for the rehab team.
// Daily Case Challenge, Goniometer Guess, Muscle Rush, Special Test Showdown (solo + live rooms), Duels, and the
// weekly league. The rules and content live in js/space/space-core.js (shared with Android); this file is the page.
// Data: space/* in the Realtime Database (rules: backend/database.rules.json), private progress at users/{uid}/space.
(function () {
  'use strict';
  const S = window.RehablixSpace;
  if (!S) return;

  window.RehablixTemplates = window.RehablixTemplates || {};
  window.RehablixTemplates.space = '<main class="space-main"><div class="space-wrap" id="spaceRoot"></div></main>';

  let root = null;
  let screen = 'hub';
  let cleanup = [];           // listeners / timers of the screen on show
  let serverOffset = 0;
  const now = () => Date.now() + serverOffset;

  // ------------------------------------------------------------------ helpers
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const db = () => firebase.database();
  const user = () => { try { return firebase.auth().currentUser; } catch (e) { return null; } };
  const toast = (m, t) => { if (typeof window.showToast === 'function') window.showToast(m, t || 'info', 4000); else console.log(m); };
  const specialty = () => (window.RehablixSpecialty && window.RehablixSpecialty.current()) || null;
  const profession = () => S.dailyProfession(specialty() && specialty().key);
  const professionLabel = () => (window.RehablixSpecialty && window.RehablixSpecialty.label()) || 'Rehabilitation professional';
  function displayName() {
    const u = user();
    if (!u) return 'Guest';
    const n = (u.displayName || '').trim() || (u.email || '').split('@')[0] || 'Player';
    return n.split(/\s+/).slice(0, 2).join(' ').slice(0, 40);
  }
  const localDay = (d) => { d = d || new Date(); const p = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  const seed = () => (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  function stop() { cleanup.forEach((f) => { try { f(); } catch (e) { /* already gone */ } }); cleanup = []; }
  function go(name, arg) { stop(); screen = name; render(arg); window.scrollTo(0, 0); }
  function needSignIn(what) {
    if (user()) return false;
    root.innerHTML = '<div class="sp-card sp-center"><div class="sp-big-emoji">🔒</div><h2>Sign in to ' + esc(what) + '</h2><p class="sp-muted">Your scores, streak and league place are saved to your account.</p>' +
      '<button class="sp-btn sp-primary" id="spLogin">Sign in free</button> <button class="sp-btn" data-go="hub">Back</button></div>';
    root.querySelector('#spLogin').onclick = () => { const b = document.getElementById('loginBtn'); if (b) b.click(); };   // the navbar's Login (same as js/upsell.js)
    bindGo();
    return true;
  }
  function bindGo() { root.querySelectorAll('[data-go]').forEach((b) => { b.onclick = () => go(b.dataset.go); }); }
  const header = (title, sub) => '<div class="sp-head"><button class="sp-back" data-go="hub" aria-label="Back to Space">‹</button><div><h2>' + title + '</h2>' + (sub ? '<p class="sp-muted">' + sub + '</p>' : '') + '</div></div>';

  // XP: the weekly league entry (only grows) and the player's own streak / totals.
  async function award(xp, game) {
    const u = user();
    if (!u || !(xp > 0)) return null;
    const week = S.weekKey(), name = displayName(), prof = profession();
    try {
      await db().ref('space/league/' + week + '/' + u.uid).transaction((cur) => ({ name, profession: prof, xp: ((cur && cur.xp) || 0) + xp, at: Date.now() }));
      const res = await db().ref('users/' + u.uid + '/space/stats').transaction((cur) => {
        cur = cur || {};
        const today = localDay();
        return { streak: S.nextStreak(cur.lastDay || null, cur.streak || 0, today), lastDay: today, totalXp: (cur.totalXp || 0) + xp, games: Object.assign({}, cur.games, { [game]: ((cur.games || {})[game] || 0) + 1 }) };
      });
      return res && res.snapshot ? res.snapshot.val() : null;
    } catch (e) { console.warn('[space] award', e); return null; }
  }
  async function myStats() {
    const u = user();
    if (!u) return null;
    try { return (await db().ref('users/' + u.uid + '/space/stats').once('value')).val(); } catch (e) { return null; }
  }
  async function myWeekXp() {
    const u = user();
    if (!u) return 0;
    try { return ((await db().ref('space/league/' + S.weekKey() + '/' + u.uid + '/xp').once('value')).val()) || 0; } catch (e) { return 0; }
  }
  // the streak counts only if it reaches today or yesterday
  const liveStreak = (st) => { if (!st || !st.lastDay) return 0; const t = localDay(), y = localDay(new Date(Date.now() - 86400000)); return st.lastDay === t || st.lastDay === y ? st.streak || 0 : 0; };

  // AI (the Daily Case): the model chosen in the app, counted against the user's plan like every other tool.
  async function ai(modelId, system, prompt, maxTokens) {
    const Q = window.RehablixAIQuotaCore;
    const cfg = window.RehablixModelChoice && modelId !== 'basal100' ? await window.RehablixModelChoice.resolve() : await Q.resolveModelConfig(modelId);
    if (!cfg) throw new Error('SI service not configured');
    const u = user(), plan = window.rehabPlans ? window.rehabPlans.getCurrentPlan() : 'free';
    if (u) await Q.checkQuotaOrThrow(u.uid, plan);
    const r = await fetch(cfg.endpoint + '/chat/completions', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.token },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], max_tokens: maxTokens || cfg.maxTokens || 1500, temperature: 0.7 }),
    });
    if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e.error && e.error.message) || 'SI service error'); }
    const data = await r.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    if (u) Q.reportTokenUsage(u.uid, plan, system + prompt + text, cfg.weight);
    return text;
  }
  function parseJson(raw) {
    const s = String(raw || '').replace(/```json|```/gi, '').trim();
    try { return JSON.parse(s); } catch (e) { /* trimmed below */ }
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { /* none */ } }
    return null;
  }

  // ------------------------------------------------------------------ hub
  const GAMES = [
    { id: 'goniometer', emoji: '📐', name: 'Goniometer Guess', desc: 'Read the joint angle by eye. Within 3° is a bullseye.', tag: 'Solo · 5 rounds' },
    { id: 'rush', emoji: '💪', name: 'Muscle Rush', desc: 'Nerves and actions, 60 seconds, streak bonuses.', tag: 'Solo · 60 s' },
    { id: 'tests', emoji: '🩺', name: 'Special Test Showdown', desc: 'Name the test, or what a positive means. Practise, or race friends live.', tag: 'Solo · Live room' },
    { id: 'duels', emoji: '⚔️', name: 'Duels', desc: 'Challenge a colleague: the same 5 questions, best score wins.', tag: '1 v 1' },
  ];
  const LATER = [['🚶', 'Gait Detective'], ['🧭', 'Patient Journey'], ['🧩', 'ICF Sort'], ['🔎', 'Spot the Error'], ['🏟️', 'Quiz Arena']];

  async function renderHub() {
    const u = user();
    root.innerHTML = '<div class="sp-hero"><div><h1>Space</h1><p>Learn by playing. A new case every day, quick games, and a weekly league.</p></div>' +
      '<div class="sp-chips" id="spChips">' + (u ? '<span class="sp-chip">🔥 …</span><span class="sp-chip">⚡ …</span>' : '<span class="sp-chip">Sign in to save your streak and XP</span>') + '</div></div>' +
      '<button class="sp-daily" data-go="daily"><span class="sp-daily-badge">TODAY</span><span class="sp-daily-emoji">🧠</span><span class="sp-daily-text"><strong>Daily Case Challenge</strong>' +
      '<span>' + esc(professionLabel()) + ' · answer in your own words, Lixa scores it</span></span><span class="sp-arrow">›</span></button>' +
      '<div class="sp-grid">' + GAMES.map((g) => '<button class="sp-game" data-go="' + g.id + '"><span class="sp-game-emoji">' + g.emoji + '</span><strong>' + g.name + '</strong><span class="sp-game-desc">' + g.desc + '</span><span class="sp-tag">' + g.tag + '</span></button>').join('') + '</div>' +
      '<div class="sp-card"><div class="sp-row-between"><h3>🏆 Weekly league</h3><button class="sp-link" data-go="league">See all ›</button></div><div id="spLeaguePeek" class="sp-muted">Loading…</div></div>' +
      '<div class="sp-card sp-soon"><h3>Coming soon</h3><div class="sp-soon-list">' + LATER.map((x) => '<span>' + x[0] + ' ' + x[1] + '</span>').join('') + '</div></div>';
    bindGo();
    if (u) {
      const [st, xp] = await Promise.all([myStats(), myWeekXp()]);
      if (screen !== 'hub') return;
      const tier = S.tierOf(xp);
      const chips = root.querySelector('#spChips');
      if (chips) chips.innerHTML = '<span class="sp-chip">🔥 ' + liveStreak(st) + '-day streak</span><span class="sp-chip">⚡ ' + xp + ' XP this week</span><span class="sp-chip sp-tier-' + tier.name.toLowerCase() + '">' + tier.name + '</span>';
    }
    loadLeague(5).then((rows) => {
      const el = root && root.querySelector('#spLeaguePeek');
      if (!el || screen !== 'hub') return;
      el.innerHTML = rows === null ? 'Sign in to see the league.' : rows.length ? leagueRows(rows.slice(0, 5)) : 'No one has played this week yet. Be first!';
    });
  }

  // ------------------------------------------------------------------ league
  async function loadLeague(limit) {
    if (!user()) return null;
    try {
      const snap = await db().ref('space/league/' + S.weekKey()).orderByChild('xp').limitToLast(limit || 50).once('value');
      const rows = [];
      snap.forEach((c) => { rows.push(Object.assign({ uid: c.key }, c.val())); });
      return rows.sort((a, b) => b.xp - a.xp);
    } catch (e) { return []; }
  }
  function leagueRows(rows) {
    const me = user() && user().uid;
    return '<ol class="sp-board">' + rows.map((r, i) => '<li class="' + (r.uid === me ? 'me' : '') + '"><span class="sp-rank">' + (i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1) + '</span><span class="sp-name">' + esc(r.name) + '</span><span class="sp-tier sp-tier-' + S.tierOf(r.xp).name.toLowerCase() + '">' + S.tierOf(r.xp).name + '</span><span class="sp-xp">' + r.xp + ' XP</span></li>').join('') + '</ol>';
  }
  async function renderLeague() {
    if (needSignIn('join the weekly league')) return;
    let mine = false;
    root.innerHTML = header('Weekly league', 'Week ' + S.weekKey().split('-W')[1] + ' · every game earns XP · resets on Monday') +
      '<div class="sp-tabs"><button class="sp-tab active" data-f="all">Everyone</button><button class="sp-tab" data-f="mine">' + esc(professionLabel()) + 's</button></div><div class="sp-card" id="spBoard">Loading…</div>' +
      '<div class="sp-card sp-muted">Tiers: Bronze · Silver from 100 XP · Gold from 300 · Diamond from 700.</div>';
    bindGo();
    const rows = await loadLeague(100);
    const draw = () => {
      const list = mine ? rows.filter((r) => r.profession === profession()) : rows;
      const me = rows.findIndex((r) => r.uid === user().uid);
      root.querySelector('#spBoard').innerHTML = (list.length ? leagueRows(list.slice(0, 50)) : '<p class="sp-muted">No one here yet this week.</p>') +
        (me >= 0 ? '' : '<p class="sp-muted">Play any game to join this week\'s league.</p>');
    };
    root.querySelectorAll('.sp-tab').forEach((t) => { t.onclick = () => { mine = t.dataset.f === 'mine'; root.querySelectorAll('.sp-tab').forEach((x) => x.classList.toggle('active', x === t)); draw(); }; });
    draw();
  }

  // ------------------------------------------------------------------ Goniometer Guess
  function figureSvg(f, reveal, guess) {
    const line = (s, cls) => '<line x1="' + s.a[0] + '" y1="' + s.a[1] + '" x2="' + s.b[0] + '" y2="' + s.b[1] + '" stroke-width="' + s.w + '" class="' + cls + '"/>';
    let svg = '<svg viewBox="0 0 320 260" class="sp-figure" role="img" aria-label="' + esc(S.JOINTS[f.joint].name) + '">' +
      '<line x1="0" y1="' + (f.joint === 'kneeFlex' || f.joint === 'hipFlex' ? (f.pivot[1] + 14) : 256) + '" x2="320" y2="' + (f.joint === 'kneeFlex' || f.joint === 'hipFlex' ? (f.pivot[1] + 14) : 256) + '" class="sp-ground"/>' +
      f.segs.filter((s) => s.body).map((s) => line(s, 'sp-limb body')).join('') + f.circles.filter((c) => c.body).map((c) => '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + c.r + '" class="sp-limb-fill body"/>').join('') +
      f.segs.filter((s) => !s.body).map((s) => line(s, 'sp-limb')).join('') + f.circles.filter((c) => !c.body).map((c) => '<circle cx="' + c.x + '" cy="' + c.y + '" r="' + c.r + '" class="sp-limb-fill"/>').join('') +
      '<circle cx="' + f.pivot[0] + '" cy="' + f.pivot[1] + '" r="5" class="sp-pivot"/>';
    const arc = (start, sweep, r, cls) => {
      const a0 = start * Math.PI / 180, a1 = (start + sweep) * Math.PI / 180;
      const p0 = [f.pivot[0] + r * Math.cos(a0), f.pivot[1] + r * Math.sin(a0)], p1 = [f.pivot[0] + r * Math.cos(a1), f.pivot[1] + r * Math.sin(a1)];
      return '<path d="M' + p0[0].toFixed(1) + ' ' + p0[1].toFixed(1) + ' A' + r + ' ' + r + ' 0 ' + (Math.abs(sweep) > 180 ? 1 : 0) + ' ' + (sweep > 0 ? 1 : 0) + ' ' + p1[0].toFixed(1) + ' ' + p1[1].toFixed(1) + '" class="' + cls + '"/>';
    };
    if (reveal) {
      const j = S.JOINTS[f.joint];
      if (guess != null && guess !== f.angle) {
        const g = S.goniometerFigure(f.joint, guess);
        svg += '<line x1="' + f.pivot[0] + '" y1="' + f.pivot[1] + '" x2="' + g.movingArm[0] + '" y2="' + g.movingArm[1] + '" class="sp-guess-arm"/>';
      }
      svg += '<line x1="' + f.pivot[0] + '" y1="' + f.pivot[1] + '" x2="' + f.zeroArm[0] + '" y2="' + f.zeroArm[1] + '" class="sp-zero-arm"/>' +
        '<line x1="' + f.pivot[0] + '" y1="' + f.pivot[1] + '" x2="' + f.movingArm[0] + '" y2="' + f.movingArm[1] + '" class="sp-true-arm"/>' +
        (f.angle > 0 ? arc(j.zero, f.sweepDeg, 34, 'sp-arc') : '');
      const mid = (j.zero + f.sweepDeg / 2) * Math.PI / 180;
      svg += '<text x="' + (f.pivot[0] + 54 * Math.cos(mid)).toFixed(0) + '" y="' + (f.pivot[1] + 54 * Math.sin(mid) + 5).toFixed(0) + '" class="sp-arc-label">' + f.angle + '°</text>';
    }
    return svg + '</svg>';
  }
  function renderGoniometer() {
    const targets = S.goniometerRound(seed(), 5);
    let i = 0, total = 0;
    const results = [];
    const step = () => {
      const t = targets[i], j = S.JOINTS[t.joint], f = S.goniometerFigure(t.joint, t.angle);
      let guess = Math.round((j.min + j.max) / 2);
      root.innerHTML = header('📐 Goniometer Guess', 'Round ' + (i + 1) + ' of 5 · ' + total + ' points') +
        '<div class="sp-card sp-center"><div class="sp-joint"><strong>' + esc(j.name) + '</strong><span class="sp-muted">' + esc(j.view) + ' · range ' + j.min + '–' + j.max + '°</span></div>' +
        '<div id="spFig">' + figureSvg(f, false) + '</div>' +
        '<div class="sp-guess"><button class="sp-step" data-d="-5">−5</button><button class="sp-step" data-d="-1">−1</button><output id="spGuessOut">' + guess + '°</output><button class="sp-step" data-d="1">+1</button><button class="sp-step" data-d="5">+5</button></div>' +
        '<input type="range" id="spGuess" min="' + j.min + '" max="' + j.max + '" value="' + guess + '" class="sp-range" aria-label="Your estimate in degrees">' +
        '<button class="sp-btn sp-primary sp-wide" id="spLock">Lock in my guess</button><div id="spVerdict"></div></div>';
      bindGo();
      const range = root.querySelector('#spGuess'), out = root.querySelector('#spGuessOut');
      const set = (v) => { guess = Math.max(j.min, Math.min(j.max, Math.round(v))); range.value = guess; out.textContent = guess + '°'; };
      range.oninput = () => set(Number(range.value));
      root.querySelectorAll('.sp-step').forEach((b) => { b.onclick = () => set(guess + Number(b.dataset.d)); });
      root.querySelector('#spLock').onclick = () => {
        const pts = S.goniometerPoints(guess, t.angle), err = Math.abs(guess - t.angle);
        total += pts; results.push({ joint: j.name, truth: t.angle, guess, pts });
        root.querySelector('#spFig').innerHTML = figureSvg(f, true, guess);
        root.querySelectorAll('.sp-step, #spGuess').forEach((x) => { x.disabled = true; });
        root.querySelector('#spVerdict').innerHTML = '<div class="sp-verdict ' + (err <= 6 ? 'good' : err <= 15 ? 'ok' : 'bad') + '"><strong>' + S.goniometerVerdict(err) + '</strong> True angle ' + t.angle + '°, you said ' + guess + '° · +' + pts + ' points</div>';
        const lock = root.querySelector('#spLock');
        lock.textContent = i < 4 ? 'Next joint ›' : 'See my score';
        lock.onclick = () => { i++; if (i < 5) step(); else done(); };
      };
    };
    const done = async () => {
      const xp = S.xp.goniometer(total);
      const best = Math.max(total, Number(localStorage.getItem('rx-space-best-gonio') || 0));
      try { localStorage.setItem('rx-space-best-gonio', String(best)); } catch (e) { /* storage blocked */ }
      root.innerHTML = header('📐 Goniometer Guess', 'Your eye, scored') +
        '<div class="sp-card sp-center"><div class="sp-score">' + total + '<small>/500</small></div><p class="sp-muted">Best: ' + best + (user() ? ' · +' + xp + ' XP' : ' · sign in to earn XP') + '</p>' +
        '<table class="sp-table"><tr><th>Joint</th><th>True</th><th>You</th><th>Points</th></tr>' + results.map((r) => '<tr><td>' + esc(r.joint) + '</td><td>' + r.truth + '°</td><td>' + r.guess + '°</td><td>' + r.pts + '</td></tr>').join('') + '</table>' +
        '<button class="sp-btn sp-primary" id="spAgain">Play again</button> <button class="sp-btn" data-go="hub">Space</button></div>';
      bindGo();
      root.querySelector('#spAgain').onclick = () => go('goniometer');
      if (user()) award(xp, 'goniometer');
    };
    step();
  }

  // ------------------------------------------------------------------ quiz runner (Muscle Rush, practice, duels)
  // Shows questions one at a time. opts: { title, questions? or next(), seconds?, explain?(q), onDone(result) }
  function quiz(opts) {
    let i = 0, score = 0, streak = 0, correct = 0, answered = 0, ended = false;
    const t0 = Date.now();
    const timed = !!opts.seconds;
    let timer = null;
    const end = () => { if (ended) return; ended = true; if (timer) clearInterval(timer); opts.onDone({ score, correct, answered }); };
    const show = () => {
      const q = opts.questions ? opts.questions[i] : opts.next();
      if (!q) return end();
      root.innerHTML = header(opts.title, opts.questions ? 'Question ' + (i + 1) + ' of ' + opts.questions.length : '') +
        (timed ? '<div class="sp-timer"><div id="spTimeBar"></div></div>' : '') +
        '<div class="sp-card"><div class="sp-row-between sp-muted"><span>' + (timed ? 'Score ' + score : correct + ' correct') + '</span><span>' + (streak >= 2 ? '🔥 ' + streak + ' in a row' : '') + '</span></div>' +
        '<p class="sp-q">' + esc(q.prompt) + '</p><div class="sp-options">' + q.options.map((o, k) => '<button class="sp-opt" data-k="' + k + '">' + esc(o) + '</button>').join('') + '</div><div id="spExplain"></div></div>';
      bindGo();
      if (timed) tick();
      root.querySelectorAll('.sp-opt').forEach((b) => {
        b.onclick = () => {
          if (ended) return;
          const k = Number(b.dataset.k), ok = k === q.answer;
          answered++;
          if (ok) { score += S.rushPoints(streak); streak++; correct++; } else streak = 0;
          root.querySelectorAll('.sp-opt').forEach((x, n) => { x.disabled = true; if (n === q.answer) x.classList.add('right'); else if (n === k) x.classList.add('wrong'); });
          const more = () => { i++; if (opts.questions && i >= opts.questions.length) end(); else show(); };
          if (opts.explain) {
            root.querySelector('#spExplain').innerHTML = '<div class="sp-explain">' + opts.explain(q) + '</div><button class="sp-btn sp-primary sp-wide" id="spNext">Next ›</button>';
            root.querySelector('#spNext').onclick = more;
          } else setTimeout(more, ok ? 450 : 1100);
        };
      });
    };
    const tick = () => {
      const bar = root.querySelector('#spTimeBar');
      const upd = () => { const left = Math.max(0, opts.seconds * 1000 - (Date.now() - t0)); if (bar) bar.style.width = (100 * left / (opts.seconds * 1000)) + '%'; if (left <= 0) end(); };
      if (!timer) { timer = setInterval(upd, 200); cleanup.push(() => clearInterval(timer)); }
      upd();
    };
    show();
  }

  function renderRush() {
    const r = S.rng(seed());
    let last = null;
    quiz({
      title: '💪 Muscle Rush', seconds: S.RUSH_SECONDS,
      next: () => { let q; do { q = S.muscleQuestion(r); } while (last && q.id === last); last = q.id; return q; },
      onDone: async (res) => {
        const xp = S.xp.rush(res.score);
        const best = Math.max(res.score, Number(localStorage.getItem('rx-space-best-rush') || 0));
        try { localStorage.setItem('rx-space-best-rush', String(best)); } catch (e) { /* storage blocked */ }
        root.innerHTML = header('💪 Muscle Rush', 'Time!') + '<div class="sp-card sp-center"><div class="sp-score">' + res.score + '</div><p>' + res.correct + ' right out of ' + res.answered + '</p>' +
          '<p class="sp-muted">Best: ' + best + (user() ? ' · +' + xp + ' XP' : ' · sign in to earn XP') + '</p><button class="sp-btn sp-primary" id="spAgain">Play again</button> <button class="sp-btn" data-go="hub">Space</button></div>';
        bindGo();
        root.querySelector('#spAgain').onclick = () => go('rush');
        if (user()) award(xp, 'rush');
      },
    });
  }

  // ------------------------------------------------------------------ Special Test Showdown
  const testExplain = (q) => { const t = S.SPECIAL_TESTS.find((x) => x.id === q.id); return '<strong>' + esc(t.name) + '</strong> · ' + esc(t.region) + '<br>' + esc(t.how) + '<br><em>Positive: ' + esc(t.finding) + '</em>'; };
  function renderTests(arg) {
    if (arg && arg.join) return joinRoom(arg.join);
    root.innerHTML = header('🩺 Special Test Showdown', 'Name the test from how it is done, or say what a positive result means') +
      '<div class="sp-grid"><button class="sp-game" id="spPractice"><span class="sp-game-emoji">🎯</span><strong>Practice</strong><span class="sp-game-desc">10 questions, explained as you go.</span><span class="sp-tag">Solo</span></button>' +
      '<button class="sp-game" id="spHost"><span class="sp-game-emoji">📡</span><strong>Host a live room</strong><span class="sp-game-desc">Friends join with a code. Fastest right answer scores most.</span><span class="sp-tag">2–20 players</span></button></div>' +
      '<div class="sp-card"><h3>Join a room</h3><div class="sp-join"><input id="spCode" maxlength="5" placeholder="CODE" autocomplete="off" autocapitalize="characters"><button class="sp-btn sp-primary" id="spJoin">Join</button></div></div>';
    bindGo();
    root.querySelector('#spPractice').onclick = () => practice();
    root.querySelector('#spHost').onclick = hostRoom;
    const code = root.querySelector('#spCode');
    code.oninput = () => { code.value = S.cleanCode(code.value); };
    root.querySelector('#spJoin').onclick = () => { if (code.value.length === 5) joinRoom(code.value); else toast('Enter the 5-character room code', 'info'); };
  }
  function practice() {
      quiz({
        title: '🩺 Practice', questions: S.questionSet('tests', 10, seed()), explain: testExplain,
        onDone: (res) => {
          const xp = S.xp.tests(res.correct);
          root.innerHTML = header('🩺 Practice', 'Done') + '<div class="sp-card sp-center"><div class="sp-score">' + res.correct + '<small>/10</small></div><p class="sp-muted">' + (user() ? '+' + xp + ' XP' : 'Sign in to earn XP') + '</p>' +
            '<button class="sp-btn sp-primary" id="spAgain">Again</button> <button class="sp-btn" data-go="tests">Back</button></div>';
          bindGo(); root.querySelector('#spAgain').onclick = () => { stop(); practice(); };
          if (user()) award(xp, 'tests');
        },
      });
  }

  async function hostRoom() {
    if (needSignIn('host a live room')) return;
    const u = user();
    let code = null;
    for (let k = 0; k < 6 && !code; k++) {
      const c = S.roomCode(S.rng(seed()));
      const res = await db().ref('space/rooms/' + c).transaction((cur) => (cur ? undefined : {
        host: u.uid, hostName: displayName(), game: 'tests', state: 'lobby', round: 0, total: 10, createdAt: Date.now(),
        questions: S.questionSet('tests', 10, seed()), players: { [u.uid]: { name: displayName(), joinedAt: Date.now() } },
      })).catch(() => null);
      if (res && res.committed) code = c;
    }
    if (!code) { toast('Could not open a room. Please try again.', 'error'); return; }
    history.replaceState(history.state, '', 'index.html#/space/join/' + code);
    room(code);
  }
  async function joinRoom(code) {
    code = S.cleanCode(code);
    if (needSignIn('join a live room')) return;
    const snap = await db().ref('space/rooms/' + code).once('value').catch(() => null);
    const r = snap && snap.val();
    if (!r || Date.now() - (r.createdAt || 0) > 6 * 3600000) { toast('No live room with that code.', 'error'); go('tests'); return; }
    if (r.state === 'done') { toast('That room has finished.', 'info'); go('tests'); return; }
    const u = user();
    if (!(r.players && r.players[u.uid])) await db().ref('space/rooms/' + code + '/players/' + u.uid).set({ name: displayName(), joinedAt: Date.now() });
    room(code);
  }
  // One live room for host and players: everything follows the room's state.
  function room(code) {
    stop(); screen = 'room';
    const u = user(), ref = db().ref('space/rooms/' + code);
    let r = null, revealTimer = null, awarded = false;
    const offRef = db().ref('.info/serverTimeOffset');
    const onOff = (s) => { serverOffset = s.val() || 0; };
    offRef.on('value', onOff); cleanup.push(() => offRef.off('value', onOff));
    const isHost = () => r && r.host === u.uid;
    const players = () => Object.entries(r.players || {}).map(([id, p]) => ({ id, name: p.name, score: (r.scores || {})[id] || 0 }));
    const ranked = () => players().sort((a, b) => b.score - a.score);
    const leaveBtn = '<button class="sp-btn" id="spLeave">Leave room</button>';
    const startRound = (n) => ref.update({ state: 'question', round: n, qStart: firebase.database.ServerValue.TIMESTAMP });
    // host: close the round when time is up or everyone has answered, and add up the points
    const closeRound = () => {
      if (!isHost() || r.state !== 'question') return;
      const q = r.questions[r.round - 1], ans = (r.answers || {})[r.round] || {};
      const scores = Object.assign({}, r.scores);
      Object.entries(ans).forEach(([id, a]) => { scores[id] = (scores[id] || 0) + S.roomPoints(a.choice === q.answer, a.ms); });
      ref.update({ state: 'reveal', scores });
    };
    const draw = () => {
      if (!r) return;
      if (r.state === 'lobby') {
        root.innerHTML = header('📡 Live room', isHost() ? 'Share the code; start when everyone is in' : 'Waiting for ' + esc(r.hostName) + ' to start') +
          '<div class="sp-card sp-center"><div class="sp-code">' + code + '</div><p class="sp-muted">Join at Space → Special Test Showdown, or open <br><span class="sp-mono">rehablix.com/#/space/join/' + code + '</span></p>' +
          '<button class="sp-btn" id="spCopy">Copy invite link</button></div><div class="sp-card"><h3>Players (' + players().length + ')</h3><div class="sp-players">' + players().map((p) => '<span>' + esc(p.name) + '</span>').join('') + '</div></div>' +
          '<div class="sp-center">' + (isHost() ? '<button class="sp-btn sp-primary" id="spStart"' + (players().length < 1 ? ' disabled' : '') + '>Start 10 questions</button> ' : '') + leaveBtn + '</div>';
        const copy = root.querySelector('#spCopy');
        copy.onclick = () => { const link = location.origin + location.pathname + '#/space/join/' + code; (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Link copied', 'success'), () => toast(link, 'info')); };
        const st = root.querySelector('#spStart'); if (st) st.onclick = () => startRound(1);
      } else if (r.state === 'question') {
        const q = r.questions[r.round - 1], mine = ((r.answers || {})[r.round] || {})[u.uid];
        const answeredN = Object.keys((r.answers || {})[r.round] || {}).length;
        root.innerHTML = header('📡 Round ' + r.round + ' of ' + r.total, answeredN + ' of ' + players().length + ' answered') +
          '<div class="sp-timer"><div id="spTimeBar"></div></div><div class="sp-card"><p class="sp-q">' + esc(q.prompt) + '</p><div class="sp-options">' +
          q.options.map((o, k) => '<button class="sp-opt' + (mine && mine.choice === k ? ' picked' : '') + '" data-k="' + k + '"' + (mine ? ' disabled' : '') + '>' + esc(o) + '</button>').join('') + '</div>' +
          (mine ? '<p class="sp-muted sp-center">Locked in. Waiting for the others…</p>' : '') + '</div>';
        root.querySelectorAll('.sp-opt').forEach((b) => {
          b.onclick = () => { const ms = Math.max(0, now() - (r.qStart || now())); db().ref('space/rooms/' + code + '/answers/' + r.round + '/' + u.uid).set({ choice: Number(b.dataset.k), ms: Math.round(ms) }).catch(() => {}); };
        });
        const bar = root.querySelector('#spTimeBar');
        const tick = () => {
          const left = Math.max(0, S.ROOM_SECONDS * 1000 - (now() - (r.qStart || now())));
          if (bar) bar.style.width = (100 * left / (S.ROOM_SECONDS * 1000)) + '%';
          if (isHost() && (left <= 0 || answeredN >= players().length)) closeRound();
        };
        clearInterval(revealTimer); revealTimer = setInterval(tick, 250); tick();
      } else if (r.state === 'reveal') {
        clearInterval(revealTimer);
        const q = r.questions[r.round - 1], mine = ((r.answers || {})[r.round] || {})[u.uid];
        const got = mine && mine.choice === q.answer;
        root.innerHTML = header('📡 Round ' + r.round + ' of ' + r.total, got ? '✅ Right! +' + S.roomPoints(true, mine.ms) : mine ? '❌ Not this time' : '⏱️ Too slow') +
          '<div class="sp-card"><div class="sp-explain">' + testExplain(q) + '</div></div><div class="sp-card"><h3>Leaderboard</h3>' + roomBoard() + '</div>' +
          '<div class="sp-center">' + (isHost() ? '<button class="sp-btn sp-primary" id="spNextRound">' + (r.round < r.total ? 'Next question ›' : 'Final results') + '</button> ' : '<span class="sp-muted">Next question soon…</span> ') + leaveBtn + '</div>';
        const nx = root.querySelector('#spNextRound');
        if (nx) nx.onclick = () => { if (r.round < r.total) startRound(r.round + 1); else ref.update({ state: 'done' }); };
      } else if (r.state === 'done') {
        clearInterval(revealTimer);
        const list = ranked(), rank = list.findIndex((p) => p.id === u.uid) + 1;
        root.innerHTML = header('📡 Final results', 'Room ' + code) + '<div class="sp-card"><div class="sp-podium">' + list.slice(0, 3).map((p, k) => '<div class="sp-pod p' + (k + 1) + '"><span>' + ['🥇', '🥈', '🥉'][k] + '</span><strong>' + esc(p.name) + '</strong><small>' + p.score + '</small></div>').join('') + '</div>' + roomBoard() + '</div>' +
          '<div class="sp-center"><button class="sp-btn sp-primary" data-go="tests">Done</button></div>';
        bindGo();
        if (!awarded && rank > 0) { awarded = true; const xp = S.xp.room(rank, list.length); award(xp, 'room'); toast('+' + xp + ' XP', 'success'); }
      }
      const lv = root.querySelector('#spLeave');
      if (lv) lv.onclick = () => { if (!isHost()) db().ref('space/rooms/' + code + '/players/' + u.uid).remove().catch(() => {}); go('tests'); };
      bindGo();
    };
    const roomBoard = () => '<ol class="sp-board">' + ranked().map((p, k) => '<li class="' + (p.id === u.uid ? 'me' : '') + '"><span class="sp-rank">' + (k + 1) + '</span><span class="sp-name">' + esc(p.name) + '</span><span class="sp-xp">' + p.score + '</span></li>').join('') + '</ol>';
    const onVal = (s) => { r = s.val(); if (!r) { toast('The room was closed.', 'info'); go('tests'); return; } if (screen === 'room') draw(); };
    ref.on('value', onVal);
    cleanup.push(() => ref.off('value', onVal), () => clearInterval(revealTimer));
  }

  // ------------------------------------------------------------------ Duels
  async function renderDuels(arg) {
    if (needSignIn('duel')) return;
    if (arg && arg.duel) return openDuel(arg.duel);
    const u = user();
    root.innerHTML = header('⚔️ Duels', 'Five questions. Same for both of you. Best score wins.') +
      '<div class="sp-grid"><button class="sp-game" data-new="muscles"><span class="sp-game-emoji">💪</span><strong>Muscle duel</strong><span class="sp-game-desc">Nerves and actions.</span><span class="sp-tag">5 questions</span></button>' +
      '<button class="sp-game" data-new="tests"><span class="sp-game-emoji">🩺</span><strong>Special test duel</strong><span class="sp-game-desc">Name it, or read it.</span><span class="sp-tag">5 questions</span></button></div>' +
      '<div class="sp-card"><h3>Got a duel code?</h3><div class="sp-join"><input id="spDuelCode" maxlength="6" placeholder="CODE" autocomplete="off"><button class="sp-btn sp-primary" id="spDuelGo">Open</button></div></div>' +
      '<div class="sp-card"><h3>Your duels</h3><div id="spMyDuels" class="sp-muted">Loading…</div></div>';
    bindGo();
    root.querySelectorAll('[data-new]').forEach((b) => { b.onclick = () => newDuel(b.dataset.new); });
    const c = root.querySelector('#spDuelCode');
    c.oninput = () => { c.value = c.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); };
    root.querySelector('#spDuelGo').onclick = () => { if (c.value.length === 6) openDuel(c.value); };
    try {
      const idx = (await db().ref('users/' + u.uid + '/space/duels').orderByValue().limitToLast(10).once('value')).val() || {};
      const ids = Object.keys(idx).sort((a, b) => idx[b] - idx[a]);
      const duels = (await Promise.all(ids.map((id) => db().ref('space/duels/' + id).once('value').then((s) => s.val() && Object.assign({ id }, s.val())).catch(() => null)))).filter(Boolean);
      const el = root.querySelector('#spMyDuels');
      if (!el) return;
      el.innerHTML = duels.length ? '<ul class="sp-duels">' + duels.map((d) => {
        const ps = d.players || {}, me = ps[u.uid], other = Object.entries(ps).find(([id]) => id !== u.uid);
        const st = !other ? 'Waiting for an opponent' : me.correct > other[1].correct ? 'You won ' + me.correct + '–' + other[1].correct : me.correct < other[1].correct ? 'You lost ' + me.correct + '–' + other[1].correct : 'Draw ' + me.correct + '–' + other[1].correct;
        return '<li data-duel="' + d.id + '"><span>' + (d.game === 'tests' ? '🩺' : '💪') + ' ' + (other ? 'vs ' + esc(other[1].name) : 'Code ' + d.id) + '</span><span class="sp-muted">' + st + '</span></li>';
      }).join('') + '</ul>' : 'No duels yet. Start one above and send the code to a colleague.';
      el.querySelectorAll('[data-duel]').forEach((li) => { li.onclick = () => openDuel(li.dataset.duel); });
    } catch (e) { const el = root.querySelector('#spMyDuels'); if (el) el.textContent = 'Could not load your duels.'; }
  }
  async function newDuel(game) {
    const u = user(), questions = S.questionSet(game, 5, seed());
    quiz({
      title: '⚔️ Your turn', questions,
      onDone: async (res) => {
        let id = null;
        for (let k = 0; k < 5 && !id; k++) {
          const cand = S.roomCode(S.rng(seed())) + 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)];
          const t = await db().ref('space/duels/' + cand).transaction((cur) => (cur ? undefined : { by: u.uid, byName: displayName(), game, questions, createdAt: Date.now(), players: { [u.uid]: { name: displayName(), correct: res.correct, at: Date.now() } } })).catch(() => null);
          if (t && t.committed) id = cand;
        }
        if (!id) { toast('Could not save the duel. Please try again.', 'error'); go('duels'); return; }
        await db().ref('users/' + u.uid + '/space/duels/' + id).set(Date.now()).catch(() => {});
        award(S.xp.duel(res.correct, false), 'duel');
        const link = location.origin + location.pathname + '#/space/duel/' + id;
        root.innerHTML = header('⚔️ Duel ready', 'You got ' + res.correct + ' of 5') + '<div class="sp-card sp-center"><p>Send this code to your opponent:</p><div class="sp-code">' + id + '</div>' +
          '<p class="sp-muted sp-mono">' + esc(link) + '</p><button class="sp-btn sp-primary" id="spShare">Share invite</button> <button class="sp-btn" data-go="duels">Done</button></div>';
        bindGo();
        root.querySelector('#spShare').onclick = () => {
          const text = 'I scored ' + res.correct + '/5 in a Rehablix ' + (game === 'tests' ? 'special test' : 'muscle') + ' duel. Can you beat me? Code ' + id + ' ' + link;
          if (navigator.share) navigator.share({ title: 'Rehablix duel', text }).catch(() => {});
          else (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('Invite copied', 'success'), () => toast(text, 'info'));
        };
      },
    });
  }
  async function openDuel(id) {
    const u = user();
    id = String(id || '').toUpperCase().slice(0, 6);
    const d = (await db().ref('space/duels/' + id).once('value').catch(() => null))?.val?.();
    if (!d) { toast('No duel with that code.', 'error'); go('duels'); return; }
    const ps = d.players || {};
    const showResult = async (duel) => {
      const p = duel.players || {}, me = p[u.uid], other = Object.entries(p).find(([k]) => k !== u.uid);
      const verdict = !other ? 'Waiting for your opponent to play' : me.correct > other[1].correct ? '🏆 You win!' : me.correct < other[1].correct ? 'They win this one' : '🤝 A draw';
      // the creator's win bonus, once, when they first see a win
      if (other && duel.by === u.uid && me.correct > other[1].correct) {
        const claim = db().ref('users/' + u.uid + '/space/duelWins/' + id);
        const done = (await claim.once('value').catch(() => null))?.val?.();
        if (!done) { await claim.set(true).catch(() => {}); award(15, 'duel'); toast('+15 XP for the win', 'success'); }
      }
      root.innerHTML = header('⚔️ Duel ' + id, duel.game === 'tests' ? 'Special tests' : 'Muscles') + '<div class="sp-card sp-center"><div class="sp-vs"><div><strong>' + esc(me.name) + '</strong><span class="sp-score">' + me.correct + '</span></div><span>vs</span><div><strong>' + (other ? esc(other[1].name) : '…') + '</strong><span class="sp-score">' + (other ? other[1].correct : '?') + '</span></div></div><h3>' + verdict + '</h3>' +
        '<button class="sp-btn sp-primary" data-go="duels">Back to duels</button></div>';
      bindGo();
    };
    if (ps[u.uid]) return showResult(d);
    if (Object.keys(ps).length >= 2) { toast('This duel already has two players.', 'info'); go('duels'); return; }
    root.innerHTML = header('⚔️ ' + esc(d.byName) + ' challenges you', '5 ' + (d.game === 'tests' ? 'special test' : 'muscle') + ' questions. Their score stays hidden until you finish.') +
      '<div class="sp-card sp-center"><button class="sp-btn sp-primary" id="spAccept">Accept the duel</button> <button class="sp-btn" data-go="duels">Not now</button></div>';
    bindGo();
    root.querySelector('#spAccept').onclick = () => quiz({
      title: '⚔️ Duel', questions: d.questions,
      onDone: async (res) => {
        await db().ref('space/duels/' + id + '/players/' + u.uid).set({ name: displayName(), correct: res.correct, at: Date.now() }).catch(() => {});
        await db().ref('users/' + u.uid + '/space/duels/' + id).set(Date.now()).catch(() => {});
        const theirs = (ps[d.by] || {}).correct || 0;
        award(S.xp.duel(res.correct, res.correct > theirs), 'duel');
        const fresh = (await db().ref('space/duels/' + id).once('value')).val();
        showResult(fresh);
      },
    });
  }

  // ------------------------------------------------------------------ Daily Case Challenge
  async function renderDaily() {
    if (needSignIn('take the Daily Case')) return;
    const u = user(), day = S.dayKey(), prof = profession();
    root.innerHTML = header('🧠 Daily Case Challenge', esc(professionLabel()) + ' · ' + day) + '<div class="sp-card" id="spDaily"><p class="sp-muted">Loading today\'s case…</p></div>';
    bindGo();
    const box = () => root.querySelector('#spDaily');
    let c;
    try {
      c = (await db().ref('space/dailyCase/' + day + '/' + prof).once('value')).val();
      if (!c) {
        box().innerHTML = '<p class="sp-muted">Writing today\'s case… (the first player of the day gets it fresh)</p>';
        const role = prof === 'general' ? 'rehabilitation professional' : ((window.RehablixSpecialty && window.RehablixSpecialty.describe && window.RehablixSpecialty.describe(specialty())) || 'rehabilitation professional').replace(/^an? /, '');
        // (a reply cut short or not JSON is tried once more before giving up)
        let clean = null;
        for (let attempt = 0; attempt < 2 && !clean; attempt++) {
        const raw = await ai('corpus101', 'You write short, realistic clinical case vignettes for a daily reasoning challenge for rehabilitation professionals and students. Plain, professional language; no real names. Return ONLY JSON.',
          'Write the case for ' + day + ' for a ' + role + '. Topic area: ' + S.dailyTopic(day, prof) + '. The case must test clinical reasoning (assessment priorities, red flags, goals or the choice of intervention) and be answerable in a short paragraph.\n' +
          'Return {"title":"<4-7 words>","case":"<120-170 words: the person, history, findings>","question":"<one clear question>","keyPoints":["<the 5 points a strong answer covers>"],"modelAnswer":"<a strong 80-130 word answer>"}', 2200);
        clean = S.cleanDailyCase(parseJson(raw));
        }
        if (!clean) throw new Error('The case could not be written. Please try again.');
        const t = await db().ref('space/dailyCase/' + day + '/' + prof).transaction((cur) => cur || Object.assign({ at: Date.now() }, clean));
        c = t.snapshot.val();
      }
    } catch (e) { if (box()) box().innerHTML = '<p>' + esc(e.message || 'Could not load today\'s case.') + '</p><button class="sp-btn" data-go="hub">Back</button>'; bindGo(); return; }
    const mine = (await db().ref('users/' + u.uid + '/space/daily/' + day).once('value').catch(() => null))?.val?.();
    const caseHtml = '<h3>' + esc(c.title) + '</h3><p class="sp-case">' + esc(c.case) + '</p><p class="sp-q">' + esc(c.question) + '</p>';
    if (mine) return dailyResult(c, mine, day, prof);
    box().innerHTML = caseHtml + '<textarea id="spAnswer" rows="7" placeholder="Your answer, in your own words…"></textarea><div class="sp-row-between"><span class="sp-muted" id="spCount">0 words</span><button class="sp-btn sp-primary" id="spSubmit">Submit for scoring</button></div>' +
      '<p class="sp-muted">One answer a day. Lixa scores clinical reasoning, safety and completeness out of 100.</p>';
    const ta = root.querySelector('#spAnswer');
    ta.oninput = () => { root.querySelector('#spCount').textContent = (ta.value.trim().split(/\s+/).filter(Boolean).length) + ' words'; };
    root.querySelector('#spSubmit').onclick = async function () {
      const answer = ta.value.trim();
      if (answer.length < 40) { toast('Write a little more (a few sentences).', 'info'); return; }
      this.disabled = true; this.textContent = 'Scoring…';
      try {
        const raw = await ai('basal100', 'You are a fair clinical educator scoring a short answer to a case. Score 0–100 for clinical reasoning, safety, completeness against the key points, and clarity. Be encouraging and honest. Return ONLY JSON.',
          'CASE: ' + c.case + '\nQUESTION: ' + c.question + '\nKEY POINTS: ' + (c.keyPoints || []).join('; ') + '\n\nANSWER: ' + answer.slice(0, 3000) +
          '\n\nReturn {"score":<0-100>,"strengths":["<2-3 short points>"],"missed":["<2-3 short points>"],"feedback":"<2 sentences>"}', 1000);
        const res = S.cleanDailyScore(parseJson(raw));
        if (!res) throw new Error('The answer could not be scored. Please try again.');
        const rec = Object.assign({ answer, at: Date.now() }, res);
        await db().ref('users/' + u.uid + '/space/daily/' + day).set(rec);
        await db().ref('space/dailyScores/' + day + '/' + prof + '/' + u.uid).set({ name: displayName(), score: res.score, at: Date.now() }).catch(() => {});
        award(S.xp.daily(res.score), 'daily');
        dailyResult(c, rec, day, prof);
      } catch (e) { toast(e.message || 'Scoring failed', 'error'); this.disabled = false; this.textContent = 'Submit for scoring'; }
    };
  }
  async function dailyResult(c, mine, day, prof) {
    const box = root.querySelector('#spDaily');
    box.innerHTML = '<div class="sp-center"><div class="sp-score">' + mine.score + '<small>/100</small></div><p class="sp-muted">+' + S.xp.daily(mine.score) + ' XP · come back tomorrow for a new case</p></div>' +
      (mine.feedback ? '<p>' + esc(mine.feedback) + '</p>' : '') +
      '<div class="sp-two"><div><h4>✅ Strengths</h4><ul>' + (mine.strengths || []).map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul></div><div><h4>➕ To add</h4><ul>' + (mine.missed || []).map((s) => '<li>' + esc(s) + '</li>').join('') + '</ul></div></div>' +
      '<details><summary>The case and a model answer</summary><h4>' + esc(c.title) + '</h4><p class="sp-case">' + esc(c.case) + '</p><p class="sp-q">' + esc(c.question) + '</p><p><strong>Key points:</strong></p><ul>' + (c.keyPoints || []).map((k) => '<li>' + esc(k) + '</li>').join('') + '</ul><p>' + esc(c.modelAnswer || '') + '</p><p class="sp-muted"><strong>Your answer:</strong> ' + esc(mine.answer) + '</p></details>' +
      '<h3>Today\'s top scores</h3><div id="spDailyBoard" class="sp-muted">Loading…</div>';
    try {
      const snap = await db().ref('space/dailyScores/' + day + '/' + prof).orderByChild('score').limitToLast(20).once('value');
      const rows = []; snap.forEach((s) => { rows.push(Object.assign({ uid: s.key }, s.val())); });
      rows.sort((a, b) => b.score - a.score || a.at - b.at);
      const me = user().uid;
      root.querySelector('#spDailyBoard').innerHTML = '<ol class="sp-board">' + rows.map((r, i) => '<li class="' + (r.uid === me ? 'me' : '') + '"><span class="sp-rank">' + (i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1) + '</span><span class="sp-name">' + esc(r.name) + '</span><span class="sp-xp">' + r.score + '</span></li>').join('') + '</ol>';
    } catch (e) { const b = root.querySelector('#spDailyBoard'); if (b) b.textContent = 'Could not load the scores.'; }
  }

  // ------------------------------------------------------------------ routing inside the tab
  function render(arg) {
    if (!root) return;
    ({ hub: renderHub, daily: renderDaily, goniometer: renderGoniometer, rush: renderRush, tests: renderTests, duels: renderDuels, league: renderLeague }[screen] || renderHub)(arg);
  }
  // deep links: #/space/join/CODE (live room), #/space/duel/CODE
  function fromHash() {
    const m = (location.hash || '').match(/^#\/space\/(join|duel)\/([A-Za-z0-9]{5,6})/);
    if (!m) return false;
    if (m[1] === 'join') { screen = 'tests'; render({ join: m[2] }); } else { screen = 'duels'; render({ duel: m[2] }); }
    return true;
  }

  window.RehablixViews = window.RehablixViews || {};
  window.RehablixViews.space = {
    mount() {
      root = document.getElementById('spaceRoot');
      if (!fromHash()) { screen = 'hub'; render(); }
      // signing in or out refreshes the page you are on
      try { firebase.auth().onAuthStateChanged(() => { if (screen === 'hub' || !user()) render(); }); } catch (e) { /* no auth yet */ }
    },
    onShow() {
      root = document.getElementById('spaceRoot');
      if (!fromHash() && screen === 'hub') render();
    },
  };
})();
