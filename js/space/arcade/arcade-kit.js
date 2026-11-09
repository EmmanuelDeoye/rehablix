// js/space/arcade/arcade-kit.js — Rehablix Space arcade: the shared game kit (web and Android).
// RxArcade.start(root, gameId, host) runs a game inside `root`. The host connects it to the app:
//   host.award(xp, gameId)  saves league XP (web: Firebase; Android: the app, through window.RxHost)
//   host.exit()             back to the Space hub
//   host.signedIn, host.name
// The kit gives every game the same frame (back, title, score), drag-and-drop for touch and mouse (with tap-to-place),
// confetti, floating points, sounds, haptics, a knowledge-check card and the results screen.
(function () {
  'use strict';
  const RxArcade = { games: {} };
  // Older Android WebViews have no color-mix(): arcade.css then uses its plain-colour versions.
  try { if (!(window.CSS && CSS.supports('color', 'color-mix(in srgb, red 50%, blue)'))) document.documentElement.classList.add('rxa-nocm'); } catch (e) { /* fine */ }

  // ------------------------------------------------------------------ small DOM helpers
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  RxArcade.h = h; RxArcade.esc = esc;

  // ------------------------------------------------------------------ sound and touch feedback
  let audio = null;
  const muted = () => { try { return localStorage.getItem('rxa-muted') === '1'; } catch (e) { return false; } };
  function tone(freqs, dur, type, vol) {
    if (muted()) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const t0 = audio.currentTime;
      freqs.forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.type = type || 'sine'; o.frequency.value = f;
        const s = t0 + i * dur * 0.6;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(vol || 0.12, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + dur);
        o.connect(g); g.connect(audio.destination); o.start(s); o.stop(s + dur + 0.02);
      });
    } catch (e) { /* no audio: fine */ }
  }
  const sfx = {
    tap: () => tone([660], 0.06, 'triangle', 0.06),
    good: () => tone([523, 659, 784], 0.14, 'triangle'),
    bad: () => tone([220, 165], 0.18, 'sawtooth', 0.07),
    win: () => tone([523, 659, 784, 1047], 0.18, 'triangle', 0.14),
    drop: () => tone([440], 0.05, 'sine', 0.08),
  };
  RxArcade.sfx = sfx;
  function buzz(host, ms) { try { if (host && host.vibrate) host.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* none */ } }

  // ------------------------------------------------------------------ confetti
  function confetti(stage, n) {
    const c = h('canvas', 'rxa-confetti');
    stage.el.appendChild(c);
    const r = stage.el.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = r.width * dpr; c.height = r.height * dpr;
    const ctx = c.getContext('2d');
    const colors = ['#fbbf24', '#34d399', '#60a5fa', '#f472b6', '#a78bfa', '#f97316'];
    const bits = Array.from({ length: n || 90 }, () => ({
      x: c.width / 2 + (Math.random() - 0.5) * c.width * 0.3, y: c.height * 0.35, vx: (Math.random() - 0.5) * 14 * dpr, vy: (-6 - Math.random() * 10) * dpr,
      s: (4 + Math.random() * 6) * dpr, a: Math.random() * 6, va: (Math.random() - 0.5) * 0.4, col: colors[Math.floor(Math.random() * colors.length)],
    }));
    let frames = 0;
    (function step() {
      ctx.clearRect(0, 0, c.width, c.height);
      bits.forEach((b) => { b.vy += 0.35 * dpr; b.x += b.vx; b.y += b.vy; b.a += b.va; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.a); ctx.fillStyle = b.col; ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2); ctx.restore(); });
      if (++frames < 110 && c.isConnected) requestAnimationFrame(step); else c.remove();
    })();
  }

  // ------------------------------------------------------------------ drag and drop (pointer events: touch, pen, mouse)
  // makeDraggable(el, { targets(): Element[], onDrop(target): boolean, onTap(), ghostClass })
  // A drag starts after 6 px of movement; a short press without movement is a tap (tap-to-select fallback).
  RxArcade.draggable = function (el, opts) {
    let start = null, ghost = null, over = null, pid = null;
    const pick = (x, y) => {
      // (3D-tilted targets, like the chess board: ask the browser what is under the finger; the ghost ignores pointers)
      if (opts.hit) { const t = opts.hit(x, y); return t && opts.targets().includes(t) ? t : null; }
      const list = opts.targets();
      for (const t of list) { const r = t.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return t; }
      return null;
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY }; pid = e.pointerId;
      try { el.setPointerCapture(pid); } catch (er) { /* fine */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== pid) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!ghost && Math.hypot(dx, dy) < 6) return;
      if (!ghost) {
        ghost = el.cloneNode(true);
        ghost.classList.add('ghost');
        const r = el.getBoundingClientRect();
        ghost.style.width = r.width + 'px'; ghost.style.height = r.height + 'px';
        document.body.appendChild(ghost);
        el.classList.add('used');
        if (opts.onLift) opts.onLift();
      }
      const r = ghost.getBoundingClientRect();
      ghost.style.left = (e.clientX - r.width / 2) + 'px';
      ghost.style.top = (e.clientY - r.height / 2) + 'px';
      const t = pick(e.clientX, e.clientY);
      if (t !== over) { if (over) over.classList.remove('over'); over = t; if (over) over.classList.add('over'); }
      e.preventDefault();
    });
    const end = (e) => {
      if (!start || (e && e.pointerId !== pid)) return;
      const wasDrag = !!ghost;
      if (over) over.classList.remove('over');
      if (ghost) { ghost.remove(); ghost = null; }
      el.classList.remove('used');
      const target = over; over = null; start = null;
      if (wasDrag) { if (!(target && opts.onDrop(target))) el.classList.add('rxa-shake'), setTimeout(() => el.classList.remove('rxa-shake'), 400); }
      else if (opts.onTap) opts.onTap();
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { if (ghost) ghost.remove(); ghost = null; if (over) over.classList.remove('over'); over = null; start = null; el.classList.remove('used'); });
  };

  // ------------------------------------------------------------------ the stage (one game's frame)
  RxArcade.start = function (root, gameId, host) {
    const game = RxArcade.games[gameId];
    if (!game) throw new Error('No such game: ' + gameId);
    root.innerHTML = '';
    const el = h('div', 'rxa');
    el.style.setProperty('--game', game.color);
    el.style.setProperty('--game-2', game.color2 || '#6366f1');
    root.appendChild(el);
    let score = 0, cleanups = [];
    const bar = h('div', 'rxa-bar');
    const back = h('button', 'rxa-icon-btn', '&#8249;');
    back.setAttribute('aria-label', 'Back to Space');
    const title = h('div', 'rxa-title', esc(game.emoji + ' ' + game.title));
    const scoreEl = h('div', 'rxa-score', '0');
    const sound = h('button', 'rxa-icon-btn', muted() ? '🔇' : '🔊');
    sound.setAttribute('aria-label', 'Sound on or off');
    sound.onclick = () => { try { localStorage.setItem('rxa-muted', muted() ? '0' : '1'); } catch (e) { /* storage blocked */ } sound.innerHTML = muted() ? '🔇' : '🔊'; };
    bar.append(back, title, sound, scoreEl);
    el.appendChild(bar);
    const body = h('div', 'rxa-body');
    el.appendChild(body);

    const stage = {
      el, body, host, game, gameId,
      get score() { return score; },
      addScore(n, at) {
        score = Math.max(0, score + n); scoreEl.textContent = String(score);
        scoreEl.classList.remove('pop'); void scoreEl.offsetWidth; scoreEl.classList.add('pop');
        if (n > 0 && at) stage.float('+' + n, at);
      },
      setScore(n) { score = n; scoreEl.textContent = String(n); },
      float(text, at) {
        const r = el.getBoundingClientRect(), a = at.getBoundingClientRect ? at.getBoundingClientRect() : at;
        const f = h('div', 'rxa-float', esc(text));
        f.style.left = (a.left - r.left + (a.width || 0) / 2 - 16) + 'px';
        f.style.top = (a.top - r.top - 10) + 'px';
        el.appendChild(f); setTimeout(() => f.remove(), 1000);
      },
      good(at, pts) { sfx.good(); buzz(host, 25); if (pts) stage.addScore(pts, at); },
      bad(node) { sfx.bad(); buzz(host, [40, 40, 40]); if (node) { node.classList.remove('rxa-shake'); void node.offsetWidth; node.classList.add('rxa-shake'); } },
      confetti: (n) => confetti(stage, n),
      onCleanup(fn) { cleanups.push(fn); },
      dots(total, now, results) {
        return '<div class="rxa-dots">' + Array.from({ length: total }, (_, i) => '<i class="' + (results[i] === true ? 'done' : results[i] === false ? 'miss' : i === now ? 'now' : '') + '"></i>').join('') + '</div>';
      },
      explain(kind, head, note) {
        const box = h('div', 'rxa-explain ' + kind, '<b>' + esc(head) + '</b>' + esc(note || ''));
        return box;
      },
      // A knowledge check in a card over the game. resolve(true | false) after the player answers and taps Continue.
      ask(check) {
        return new Promise((resolve) => {
          const m = h('div', 'rxa-modal');
          const card = h('div', 'rxa-modal-card rxa-glass');
          card.innerHTML = '<div class="rxa-muted">🧠 Knowledge check</div><div class="rxa-q">' + esc(check.question) + '</div>';
          const opts = h('div', 'rxa-options');
          check.options.forEach((o) => {
            const b = h('button', 'rxa-opt', esc(o));
            b.onclick = () => {
              const ok = o === check.answer;
              opts.querySelectorAll('button').forEach((x) => { x.disabled = true; if (x.textContent === check.answer) x.classList.add('right'); });
              if (!ok) b.classList.add('wrong');
              if (ok) stage.good(b); else stage.bad(card);
              card.appendChild(stage.explain(ok ? 'ok' : 'no', ok ? 'Correct!' : 'Not quite. Answer: ' + check.answer, check.note));
              const go = h('button', 'rxa-btn', 'Continue');
              go.style.marginTop = '12px'; go.style.width = '100%';
              go.onclick = () => { m.remove(); resolve(ok); };
              card.appendChild(go);
              go.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            };
            opts.appendChild(b);
          });
          card.appendChild(opts);
          m.appendChild(card);
          el.appendChild(m);
        });
      },
      // The results screen: awards XP once and offers Play again / Space.
      finish(opts) {
        const xp = Math.max(0, Math.round(opts.xp || 0));
        sfx.win(); stage.confetti(120);
        let saved = '';
        if (xp > 0 && host && host.award) {
          try { host.award(xp, gameId); saved = host.signedIn === false ? 'Sign in to save your XP to the league.' : 'Added to your weekly league.'; } catch (e) { saved = ''; }
        }
        const m = h('div', 'rxa-modal');
        m.innerHTML = '<div class="rxa-modal-card rxa-glass rxa-result">' +
          '<div class="rxa-trophy">' + (opts.trophy || '🏆') + '</div>' +
          '<div class="rxa-title" style="font-size:1.4rem;margin-top:6px">' + esc(opts.title || 'Well played!') + '</div>' +
          '<div class="big" style="margin-top:8px">' + esc(String(opts.big != null ? opts.big : score)) + '</div>' +
          '<div class="rxa-muted">' + esc(opts.sub || 'points') + '</div>' +
          (xp > 0 ? '<div class="xp">+' + xp + ' XP</div>' : '') +
          (saved ? '<div class="rxa-muted" style="margin-top:4px">' + esc(saved) + '</div>' : '') +
          (opts.lines && opts.lines.length ? '<div class="rxa-explain info" style="text-align:left">' + opts.lines.map((l) => '• ' + esc(l)).join('<br>') + '</div>' : '') +
          '<div class="rxa-row" style="margin-top:16px"><button class="rxa-btn" data-a="again">Play again</button><button class="rxa-btn ghost" data-a="hub">Space</button></div></div>';
        m.querySelector('[data-a="again"]').onclick = () => RxArcade.start(root, gameId, host);
        m.querySelector('[data-a="hub"]').onclick = () => exit();
        el.appendChild(m);
      },
    };
    const dispose = () => { cleanups.forEach((f) => { try { f(); } catch (e) { /* gone */ } }); cleanups = []; if (RxArcade.current && RxArcade.current.stage === stage) RxArcade.current = null; };
    const exit = () => { dispose(); if (host && host.exit) host.exit(); };
    back.onclick = exit;
    if (RxArcade.current) RxArcade.current.dispose();
    RxArcade.current = { stage, exit, dispose };
    game.start(stage, host);
    return stage;
  };
  // Leaving from outside (the app's back button): stops timers and returns to the hub.
  RxArcade.stop = function () { if (RxArcade.current) { const c = RxArcade.current; RxArcade.current = null; c.exit(); } };
  // Stops the running game's timers without leaving (the host is already leaving, e.g. the app's own back button).
  RxArcade.dispose = function () { if (RxArcade.current) RxArcade.current.dispose(); };

  if (typeof window !== 'undefined') window.RxArcade = RxArcade;
})();
