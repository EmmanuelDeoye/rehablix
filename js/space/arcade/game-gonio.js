// js/space/arcade/game-gonio.js — Goniometer 3D: a 3D figure (shaded limbs, a plinth, a floor) seen from a camera that
// starts at a different angle each round and drifts, so the angle must be judged in 3D, as on a real patient. Set
// your estimate; the reveal draws a 3D goniometer on the joint with the true angle beside your guess. Same joints,
// ranges and scoring as before (space-core.js). A small canvas renderer of its own: no 3D library needed.
(function () {
  'use strict';
  const K = window.RxArcade, S = window.RehablixSpace;
  const ROUND = 5;
  const rad = (d) => (d * Math.PI) / 180;

  // ------------------------------------------------------------------ the 3D scene for a joint at an angle
  // Units are metres. x right, y up, z toward the viewer. Each segment: { a, b, r, col } (a capsule); spheres: { c, r, col }.
  const SKIN = '#f2b68f', SKIN_D = '#d38b63', SHIRT = '#38bdf8', SHORTS = '#334155', MOVE = '#fbbf24';
  const add = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
  function scene(joint, angle) {
    const t = rad(angle);
    const caps = [], balls = [], boxes = [];
    let pivot, u, v, len, baseYaw;
    if (joint === 'elbowFlex' || joint === 'shoulderAbd') {
      // standing
      caps.push({ a: [-0.1, 0.95, 0], b: [-0.1, 0.06, 0], r: 0.07, col: SHORTS }, { a: [0.1, 0.95, 0], b: [0.1, 0.06, 0], r: 0.07, col: SHORTS });
      caps.push({ a: [0, 0.98, 0], b: [0, 1.42, 0], r: 0.16, col: SHIRT });
      caps.push({ a: [0, 1.48, 0], b: [0, 1.56, 0], r: 0.05, col: SKIN });
      balls.push({ c: [0, 1.7, 0], r: 0.115, col: SKIN });
      // the other arm, by the side (for the side view of the elbow, the measured arm is the one nearer the camera)
      const restX = joint === 'elbowFlex' ? 0.21 : -0.21;
      caps.push({ a: [restX, 1.42, 0], b: [restX * 1.1, 0.82, 0], r: 0.05, col: SKIN });
      if (joint === 'elbowFlex') {
        const sh = [-0.21, 1.42, 0], el = [-0.215, 1.12, 0];
        caps.push({ a: sh, b: el, r: 0.055, col: SKIN });
        u = [0, -1, 0]; v = [0, 0, 1]; pivot = el; len = 0.27; baseYaw = 90;
      } else {
        u = [0, -1, 0]; v = [1, 0, 0]; pivot = [0.21, 1.42, 0]; len = 0.6; baseYaw = 0;
      }
    } else {
      // lying on a plinth
      boxes.push({ min: [-1.05, 0, -0.32], max: [0.95, 0.55, 0.32], top: '#94a3b8', side: '#475569' });
      const y = 0.68;
      balls.push({ c: [-0.92, y, 0], r: 0.11, col: SKIN });
      caps.push({ a: [-0.76, y, 0], b: [-0.16, y, 0], r: 0.16, col: SHIRT });
      caps.push({ a: [-0.12, y, -0.09], b: [0.78, y, -0.09], r: 0.07, col: SHORTS });          // the other leg, straight
      if (joint === 'kneeFlex') {
        const hip = [-0.12, y, 0.09], knee = [0.32, y, 0.09];
        caps.push({ a: hip, b: knee, r: 0.075, col: SHORTS });
        u = [1, 0, 0]; v = [0, 1, 0]; pivot = knee; len = 0.42; baseYaw = 0;
      } else {
        u = [1, 0, 0]; v = [0, 1, 0]; pivot = [-0.12, y, 0.09]; len = 0.88; baseYaw = 0;
      }
    }
    const dir = [u[0] * Math.cos(t) + v[0] * Math.sin(t), u[1] * Math.cos(t) + v[1] * Math.sin(t), u[2] * Math.cos(t) + v[2] * Math.sin(t)];
    const end = add(pivot, dir, len);
    caps.push({ a: pivot, b: end, r: joint === 'hipFlex' || joint === 'kneeFlex' ? 0.07 : 0.05, col: SKIN, moving: true });
    balls.push({ c: end, r: joint === 'shoulderAbd' || joint === 'elbowFlex' ? 0.05 : 0.065, col: SKIN_D });
    balls.push({ c: pivot, r: 0.04, col: '#fde68a', joint: true });
    // framing: where the camera looks and how close, per joint, so the moving limb fills the view
    const cam = { elbowFlex: { target: [-0.12, 1.2, 0.06], zoom: 2.5 }, shoulderAbd: { target: [0.05, 1.2, 0], zoom: 1.75 }, kneeFlex: { target: [0.22, 0.72, 0.05], zoom: 2.3 }, hipFlex: { target: [0.12, 0.8, 0.05], zoom: 1.85 } }[joint];
    return { caps, balls, boxes, pivot, u, v, len, baseYaw, cam };
  }

  // ------------------------------------------------------------------ projection and drawing
  function camera(yaw, pitch, w, h, target, zoom) {
    const cy = Math.cos(rad(yaw)), sy = Math.sin(rad(yaw)), cp = Math.cos(rad(pitch)), sp = Math.sin(rad(pitch));
    const D = 3.2, F = Math.min(w, h) * (zoom || 1.25);
    return (p) => {
      const x = p[0] - target[0], y = p[1] - target[1], z = p[2] - target[2];
      const xr = x * cy + z * sy, zr = -x * sy + z * cy;
      const yr = y * cp - zr * sp, zz = y * sp + zr * cp;
      const depth = D - zz;
      return { x: w / 2 + (F * xr) / depth, y: h * 0.56 - (F * yr) / depth, d: depth, s: F / depth };
    };
  }
  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(c * k)));
    return 'rgb(' + f(n >> 16) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
  }
  function draw(ctx, w, h, sc, proj, reveal) {
    ctx.clearRect(0, 0, w, h);
    // floor grid
    ctx.lineWidth = 1;
    for (let i = -6; i <= 6; i++) {
      const a = proj([i * 0.25, 0, -1.5]), b = proj([i * 0.25, 0, 1.5]), c = proj([-1.5, 0, i * 0.25]), d = proj([1.5, 0, i * 0.25]);
      ctx.strokeStyle = 'rgba(148,197,255,' + (i === 0 ? 0.22 : 0.1) + ')';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y); ctx.stroke();
    }
    const items = [];
    sc.boxes.forEach((bx) => {
      const [x0, y0, z0] = bx.min, [x1, y1, z1] = bx.max;
      const faces = [
        { pts: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], col: bx.top },
        { pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], col: bx.side },
        { pts: [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], col: bx.side },
        { pts: [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], col: shade(bx.side.length === 7 ? bx.side : '#475569', 0.85) },
        { pts: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], col: shade('#475569', 0.85) },
      ];
      faces.forEach((f) => { const pp = f.pts.map(proj); items.push({ d: pp.reduce((s, p) => s + p.d, 0) / 4 + 0.05, face: pp, col: f.col }); });
    });
    sc.caps.forEach((c) => { const a = proj(c.a), b = proj(c.b); items.push({ d: (a.d + b.d) / 2, cap: [a, b], r: c.r, col: c.col, moving: c.moving }); });
    sc.balls.forEach((bl) => { const p = proj(bl.c); items.push({ d: p.d - 0.01, ball: p, r: bl.r, col: bl.col, joint: bl.joint }); });
    items.sort((a, b) => b.d - a.d);
    for (const it of items) {
      if (it.face) {
        ctx.fillStyle = it.col; ctx.strokeStyle = 'rgba(15,23,42,0.4)';
        ctx.beginPath(); it.face.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (it.cap) {
        const [a, b] = it.cap, wpx = 2 * it.r * (a.s + b.s) / 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = shade(it.col, 0.62); ctx.lineWidth = wpx; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.strokeStyle = it.col; ctx.lineWidth = wpx * 0.72;
        ctx.beginPath(); ctx.moveTo(a.x - wpx * 0.08, a.y - wpx * 0.1); ctx.lineTo(b.x - wpx * 0.08, b.y - wpx * 0.1); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = wpx * 0.18;
        ctx.beginPath(); ctx.moveTo(a.x - wpx * 0.2, a.y - wpx * 0.22); ctx.lineTo(b.x - wpx * 0.2, b.y - wpx * 0.22); ctx.stroke();
        if (it.moving && !reveal) { ctx.strokeStyle = 'rgba(251,191,36,0.0)'; }
      } else {
        const p = it.ball, rr = it.r * p.s;
        const g = ctx.createRadialGradient(p.x - rr * 0.35, p.y - rr * 0.35, rr * 0.1, p.x, p.y, rr);
        g.addColorStop(0, it.joint ? '#fff7d6' : shade(it.col, 1.15)); g.addColorStop(1, shade(it.col, 0.65));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, rr), 0, Math.PI * 2); ctx.fill();
      }
    }
    if (reveal) drawGoniometer(ctx, sc, proj, reveal);
  }
  // The 3D goniometer: the zero arm, the true moving arm, the arc between, and the player's guess (gold, dashed).
  function drawGoniometer(ctx, sc, proj, rv) {
    const R = 0.2;
    const at = (deg, r) => { const t = rad(deg); return proj(add(sc.pivot, [sc.u[0] * Math.cos(t) + sc.v[0] * Math.sin(t), sc.u[1] * Math.cos(t) + sc.v[1] * Math.sin(t), sc.u[2] * Math.cos(t) + sc.v[2] * Math.sin(t)], r)); };
    const p = proj(sc.pivot);
    ctx.lineCap = 'round';
    // arc fill
    ctx.fillStyle = 'rgba(34,211,238,0.22)';
    ctx.beginPath(); ctx.moveTo(p.x, p.y);
    for (let d = 0; d <= rv.truth; d += 3) { const q = at(d, R); ctx.lineTo(q.x, q.y); }
    const qt = at(rv.truth, R); ctx.lineTo(qt.x, qt.y); ctx.closePath(); ctx.fill();
    // arms
    const arm = (deg, col, dash, wdt) => { const q = at(deg, sc.len * 0.95); ctx.setLineDash(dash || []); ctx.strokeStyle = col; ctx.lineWidth = wdt; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]); };
    arm(0, 'rgba(255,255,255,0.85)', [6, 6], 3);
    arm(rv.truth, '#22d3ee', null, 4);
    arm(rv.guess, '#fbbf24', [8, 6], 4);
    ctx.fillStyle = '#22d3ee'; ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, Math.PI * 2); ctx.fill();
    // label
    const lp = at(rv.truth / 2, R + 0.1);
    ctx.font = '800 18px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(2,6,23,0.85)'; ctx.strokeText(rv.truth + '°', lp.x, lp.y);
    ctx.fillStyle = '#a5f3fc'; ctx.fillText(rv.truth + '°', lp.x, lp.y);
  }

  K.games.gonio = {
    title: 'Goniometer 3D', emoji: '📐', color: '#06b6d4', color2: '#3b82f6',
    start(stage) {
      const targets = S.goniometerRound((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0, ROUND);
      const results = [];
      let i = 0, total = 0, raf = 0, alive = true;
      const lines = [];
      stage.onCleanup(() => { alive = false; cancelAnimationFrame(raf); });

      function show() {
        const tg = targets[i], j = S.JOINTS[tg.joint];
        const sc = scene(tg.joint, tg.angle);
        const side = Math.random() < 0.5 ? -1 : 1;
        const yaw0 = sc.baseYaw + side * (12 + Math.random() * 22);
        let guess = Math.round((j.min + j.max) / 2), reveal = null;
        stage.body.innerHTML = stage.dots(ROUND, i, results) +
          '<div class="rxa-canvas-wrap"><canvas></canvas><span class="tag">' + K.esc(j.name) + ' · ' + K.esc(j.view) + '</span></div>' +
          '<div class="rxa-deg">' + guess + '°</div>' +
          '<div class="rxa-dial"><button class="rxa-btn small ghost" data-d="-5">−5</button><button class="rxa-btn small ghost" data-d="-1">−1</button>' +
          '<input type="range" min="' + j.min + '" max="' + j.max + '" step="1" value="' + guess + '" aria-label="Your estimate in degrees">' +
          '<button class="rxa-btn small ghost" data-d="1">+1</button><button class="rxa-btn small ghost" data-d="5">+5</button></div>' +
          '<div class="rxa-row" style="margin-top:14px"><button class="rxa-btn" data-a="lock" style="width:100%">Lock in my estimate</button></div><div class="rxa-after"></div>';
        const wrap = stage.body.querySelector('.rxa-canvas-wrap'), canvas = wrap.querySelector('canvas');
        const range = stage.body.querySelector('input'), deg = stage.body.querySelector('.rxa-deg'), after = stage.body.querySelector('.rxa-after');
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const W = wrap.clientWidth || 320, H = Math.round(W * 0.78);
        canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = H + 'px';
        const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
        const t0 = performance.now();
        (function frame(now) {
          if (!alive || !canvas.isConnected) return;
          const sway = reveal ? 0 : Math.sin((now - t0) / 1600) * 6;
          draw(ctx, W, H, sc, camera(yaw0 + sway, 14, W, H, sc.cam.target, sc.cam.zoom), reveal);
          raf = requestAnimationFrame(frame);
        })(t0);
        const set = (v) => { guess = Math.max(j.min, Math.min(j.max, Math.round(v))); range.value = String(guess); deg.textContent = guess + '°'; };
        range.oninput = () => { set(Number(range.value)); };
        stage.body.querySelectorAll('[data-d]').forEach((b) => { b.onclick = () => { set(guess + Number(b.dataset.d)); K.sfx.tap(); }; });
        stage.body.querySelector('[data-a="lock"]').onclick = (e) => {
          if (reveal) return;
          e.target.disabled = true; range.disabled = true;
          stage.body.querySelectorAll('[data-d]').forEach((b) => { b.disabled = true; });
          const err = Math.abs(guess - tg.angle), pts = S.goniometerPoints(guess, tg.angle);
          total += pts;
          reveal = { truth: tg.angle, guess };
          results[i] = err <= 10;
          if (err <= 10) stage.good(deg, pts); else { stage.bad(deg); stage.addScore(pts, deg); }
          if (err <= 3) stage.confetti(60);
          deg.innerHTML = guess + '° <span style="font-size:1rem;opacity:.8">vs</span> <span style="color:#22d3ee">' + tg.angle + '°</span>';
          lines.push(j.name + ': ' + tg.angle + '° (you said ' + guess + '°)');
          after.appendChild(stage.explain(err <= 6 ? 'ok' : err <= 15 ? 'info' : 'no', S.goniometerVerdict(err) + ' · off by ' + err + '° · +' + pts,
            'Normal ' + j.name.toLowerCase().replace(/ \(.*\)/, '') + ' range: ' + j.min + '–' + j.max + '°. Line the goniometer\'s axis up with the joint, the fixed arm along the still segment and the moving arm along the moving one.'));
          const go = K.h('button', 'rxa-btn', i + 1 < ROUND ? 'Next joint →' : 'See results');
          go.style.cssText = 'margin-top:12px;width:100%';
          go.onclick = () => { i++; if (i < ROUND) show(); else end(); };
          after.appendChild(go);
          setTimeout(() => go.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
        };
      }
      function end() {
        stage.finish({
          title: total >= 400 ? 'Eagle eye!' : total >= 250 ? 'Great judgement!' : 'Keep measuring!',
          big: total, sub: 'of 500 points', xp: S.xp.goniometer(total), trophy: total >= 400 ? '🎯' : '📐', lines,
        });
      }
      show();
    },
  };
})();
