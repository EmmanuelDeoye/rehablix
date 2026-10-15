// js/lixa-agent/agent-avatar.js — Lixa, the agent's mascot, drawn on a <canvas>
// from the kit's layers (img/lixa/*.png, cropped and halved for the web; geometry
// in img/lixa/lixa-web.json). The same animation as the Android app
// (…/lixa/agent/LixaAvatar.kt): a slow float, arm sway, blinks and small glances;
// per state a pose, brows, mouth and effect; while speaking the mouth follows the
// voice (open/close, rounded/spread lips, upper teeth, a tongue only inside the
// mouth), brows lift on stressed words and for questions, and the hands gesture
// with the voice (one arm at a time) and wave on hello / goodbye.
//
// One requestAnimationFrame loop; it stops while the tab is hidden or the avatar
// is not on screen, and holds still with the "reduce motion" setting.
(function () {
  'use strict';
  const BASE = 'img/lixa/';
  const STATES = ['Idle', 'Listening', 'Thinking', 'Working', 'Speaking', 'Success', 'NeedsConfirmation', 'Error'];
  const FACE = ['lixa_head_no_arms', 'lixa_eye_left_white', 'lixa_eye_right_white', 'lixa_iris_left', 'lixa_iris_right', 'lixa_lid_left', 'lixa_lid_right', 'lixa_brow_left', 'lixa_brow_right', 'lixa_mouth_smile'];
  const MOUTH = '#0B3B40', MOUTH_INNER = '#04201F';
  const TONGUE_TOP = '#F2939C', TONGUE_BOTTOM = '#C9566A', TONGUE_LINE = '#A9404F';
  const TEETH = '#F8F6F1', TEETH_EDGE = '#C9C3B8';
  const WORK_AIM = -18;

  // The kit layout is fetched once and shared by every avatar on the page.
  let layoutPromise = null;
  function loadLayout() {
    if (!layoutPromise) layoutPromise = fetch(BASE + 'lixa-web.json').then(r => r.json());
    return layoutPromise;
  }
  const images = {};           // name -> Image (shared)
  function image(name, meta, onload) {
    if (images[name]) return images[name];
    const img = new Image();
    img.decoding = 'async';
    img.onload = onload;
    img.src = BASE + meta.file;
    images[name] = img;
    return img;
  }
  const ready = img => img && img.complete && img.naturalWidth > 0;

  function poseFor(state, left) {
    switch (state) {
      case 'Working': return left ? 'rest' : 'point';
      case 'Success': case 'NeedsConfirmation': case 'Error': case 'Speaking': return 'open';
      default: return 'rest';
    }
  }
  const limit = pose => (pose === 'rest' ? 35 : 12);
  const approach = (cur, target, dt, speed) => {
    if (dt <= 0) return cur;
    const next = cur + (target - cur) * (1 - Math.exp(-speed * dt));
    return Math.abs(target - next) < 0.001 ? target : next;
  };

  class LixaAvatar {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.p = { state: 'Idle', mouthOpen: 0, mouthShape: 0.5, asking: false, waving: false, gentle: false, gazeX: 0, gazeY: 0 };
      this.still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
      this.lay = null;
      this.reset();
      this.eyeCanvas = { left: document.createElement('canvas'), right: document.createElement('canvas') };
      loadLayout().then(lay => { this.lay = lay; FACE.forEach(n => this.layer(n)); this.layer(this.armName(true, 'rest')); this.layer(this.armName(false, 'rest')); }).catch(() => {});
      this.frame = this.frame.bind(this);
      this.running = false;
      this.visible = true;
      if ('IntersectionObserver' in window) {
        this.io = new IntersectionObserver(es => { this.visible = es.some(e => e.isIntersecting); if (this.visible) this.start(); });
        this.io.observe(canvas);
      }
      this.onVis = () => { if (!document.hidden) this.start(); };
      document.addEventListener('visibilitychange', this.onVis);
    }

    reset() {
      Object.assign(this, {
        time: 0, state: 'Idle', stateTime: 0, bob: 0, shake: 0, pulse: 1,
        blink: 0, blinkT: -1, nextBlink: 2.5, doubleBlink: false, gazeXv: 0, gazeYv: 0, eyeScale: 1, eyeSquint: 0,
        sacX: 0, sacY: 0, nextSaccade: 1.2, emph: 0, lastOpen: 0,
        browLY: 0, browLRot: 0, browRY: 0, browRRot: 0,
        mHalfW: 158, mUpper: 120, mLower: 184, mY: 554, mRound: 0, mImage: 1, mShape: 0.5,
        armL: 'rest', armLPrev: 'rest', armLFade: 1, armLRot: 0, armR: 'rest', armRPrev: 'rest', armRFade: 1, armRRot: 0,
        speakL: 'rest', speakR: 'rest', gestureAt: 0, relaxAt: 0, lastMovedLeft: false, voiceLevel: 0, prevOpen: 0, quietFor: 0, armRAim: 0,
        ring: 0, dots: 0, spinner: 0, badgeCheck: 0, badgeAsk: 0
      });
    }

    /** state, mouthOpen (0..1), mouthShape (0 rounded .. 1 spread), asking, waving, gentle, gazeX/gazeY (-1..1). */
    set(params) { Object.assign(this.p, params); if (params.state && STATES.indexOf(params.state) < 0) this.p.state = 'Idle'; this.start(); }

    armName(left, pose) { return 'lixa_arm_' + (left ? 'left' : 'right') + '_' + pose; }
    layer(name) {
      if (!this.lay) return null;
      const meta = this.lay.layers[name];
      if (!meta) return null;
      const img = image(name, meta, () => this.start());
      return ready(img) ? { img, meta } : null;
    }

    start() { if (!this.running && !document.hidden && this.visible) { this.running = true; this.last = 0; requestAnimationFrame(this.frame); } }
    destroy() { this.running = false; this.dead = true; if (this.io) this.io.disconnect(); document.removeEventListener('visibilitychange', this.onVis); }

    frame(now) {
      if (this.dead || document.hidden || !this.visible) { this.running = false; return; }
      const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 0;
      this.last = now;
      if (this.source) Object.assign(this.p, this.source());      // (live values: the voice moves the mouth every frame)
      this.fit();
      this.update(dt);
      this.draw();
      requestAnimationFrame(this.frame);
    }

    /** The canvas backing store follows its on-screen size (crisp on every screen). */
    fit() {
      const c = this.canvas;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
      if (w > 0 && h > 0 && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; }
    }

    // ------------------------------------------------------------------ animation
    update(dt) {
      const P = this.p, still = this.still, fast = still ? 1000 : 1;
      this.time += dt;
      if (P.state !== this.state) { this.state = P.state; this.stateTime = 0; } else this.stateTime += dt;
      const state = this.state, speaking = state === 'Speaking';
      const gazeMax = this.lay ? this.lay.gazeMax : 10;

      const o = Math.min(1, Math.max(0, P.mouthOpen || 0));
      if (!still && speaking && o > 0.55 && this.lastOpen <= 0.55 && this.emph < 0.3) this.emph = 1;
      this.lastOpen = o;
      this.emph = Math.max(0, this.emph - dt * 2.2);

      this.bob = still ? 0 : 10 * Math.sin(this.time * 1.55);
      this.pulse = !still && speaking ? 1 + 0.01 * Math.sin(this.time * 5.2) : 1;
      this.shake = !still && state === 'Error' && this.stateTime < 0.9 ? 16 * Math.sin(this.stateTime * 42) * Math.exp(-this.stateTime * 5.5) : 0;

      // blink: every 2.5–5 s, about 120 ms, now and then twice
      if (still) this.blink = 0;
      else {
        if (this.blinkT < 0 && this.time >= this.nextBlink) this.blinkT = 0;
        if (this.blinkT >= 0) {
          this.blinkT += dt;
          const p = this.blinkT / 0.12;
          if (p >= 1) {
            this.blink = 0; this.blinkT = -1;
            if (!this.doubleBlink && Math.random() < 0.18) { this.doubleBlink = true; this.nextBlink = this.time + 0.14; }
            else { this.doubleBlink = false; this.nextBlink = this.time + 2.5 + Math.random() * 2.5; }
          } else this.blink = Math.sin(p * Math.PI);
        }
      }

      // gaze: what is asked, the state's own look, and small glances
      let tx = Math.max(-1, Math.min(1, P.gazeX || 0)) * gazeMax, ty = Math.max(-1, Math.min(1, P.gazeY || 0)) * gazeMax;
      if (state === 'Thinking') { tx += still ? 4 : 6 * Math.sin(this.time * 0.9); ty += -7 + (still ? 0 : 2 * Math.sin(this.time * 1.3)); }
      if (state === 'Working') ty += 6;
      if (still || state === 'Thinking' || state === 'Working') { this.sacX = 0; this.sacY = 0; }
      else if (this.time >= this.nextSaccade) {
        if (Math.random() < 0.4) { this.sacX = 0; this.sacY = 0; }
        else { this.sacX = (Math.random() * 2 - 1) * gazeMax * 0.35; this.sacY = (Math.random() * 2 - 1) * gazeMax * 0.18; }
        this.nextSaccade = this.time + (speaking ? 0.7 + Math.random() * 1.3 : state === 'Listening' ? 1.8 + Math.random() * 2.4 : 1.2 + Math.random() * 2.6);
      }
      tx += this.sacX; ty += this.sacY;
      this.gazeXv = approach(this.gazeXv, Math.max(-gazeMax, Math.min(gazeMax, tx)), dt, 18 * fast);
      this.gazeYv = approach(this.gazeYv, Math.max(-gazeMax, Math.min(gazeMax, ty)), dt, 18 * fast);
      this.eyeScale = approach(this.eyeScale, (state === 'Listening' ? 1.07 : state === 'Success' ? 1.03 : 1) + 0.04 * this.emph, dt, 10 * fast);
      this.eyeSquint = approach(this.eyeSquint, state === 'Success' ? 0.14 : state === 'Idle' ? 0.04 : 0, dt, 8 * fast);

      // brows
      let ly = 0, lr = 0, ry = 0, rr = 0;
      switch (state) {
        case 'Listening': ly = -13; ry = -13; break;
        case 'Thinking': ly = -9; ry = -4; lr = -3; break;
        case 'Working': ly = 7; ry = 7; lr = 8; rr = -8; break;
        case 'Speaking': ly = -4; ry = -4; break;
        case 'Success': ly = -9; ry = -9; break;
        case 'NeedsConfirmation': ly = -17; lr = -7; ry = 3; break;
        case 'Error': ly = -3; ry = -3; lr = -13; rr = 13; break;
      }
      if (P.gentle && (speaking || state === 'Listening' || state === 'Idle')) { lr -= 5; rr += 5; ly -= 3; ry -= 3; }
      if (P.asking && speaking) { ly -= 9; lr -= 4; }
      ly -= 6 * this.emph; ry -= 6 * this.emph;
      this.browLY = approach(this.browLY, ly, dt, 11 * fast); this.browLRot = approach(this.browLRot, lr, dt, 11 * fast);
      this.browRY = approach(this.browRY, ry, dt, 11 * fast); this.browRRot = approach(this.browRRot, rr, dt, 11 * fast);

      // mouth
      let hw = 158, up = 120, lo = 184, my = 554, round = 0, img = 0;
      this.mShape = approach(this.mShape, Math.min(1, Math.max(0, P.mouthShape == null ? 0.5 : P.mouthShape)), dt, 14 * fast);
      if (o > 0.02 || speaking) {
        const w = this.mShape;
        hw = 96 + 48 * w; up = 78 - o * (44 - 18 * w); lo = 112 + o * (150 - 46 * w); my = 560;
      } else switch (state) {
        case 'Idle': img = 1; break;
        case 'Listening': case 'Thinking': case 'Working': hw = 60; up = 30; lo = 54; my = 584; break;
        case 'Success': hw = 166; up = 34; lo = 238; my = 552; break;
        case 'NeedsConfirmation': round = 1; break;
        case 'Error': hw = 72; up = -46; lo = -20; my = 628; break;
      }
      this.mHalfW = approach(this.mHalfW, hw, dt, 14 * fast); this.mUpper = approach(this.mUpper, up, dt, 18 * fast);
      this.mLower = approach(this.mLower, lo, dt, 18 * fast); this.mY = approach(this.mY, my, dt, 14 * fast);
      this.mRound = approach(this.mRound, round, dt, 12 * fast); this.mImage = approach(this.mImage, img, dt, 12 * fast);

      // arms: whole sprites cross-faded, one arm at a time while speaking
      if (speaking) {
        if (still) { this.speakL = 'open'; this.speakR = 'open'; } else this.gesture(dt, o, this.stateTime === 0);
        if (P.waving && !still) this.speakR = 'open';
      } else { this.quietFor = 0; this.prevOpen = 0; }
      if (speaking) { this.layer(this.armName(true, 'open')); this.layer(this.armName(false, 'open')); this.layer(this.armName(true, 'point')); this.layer(this.armName(false, 'point')); }
      this.voiceLevel = approach(this.voiceLevel, speaking ? o : 0, dt, 9 * fast);
      const wantL = speaking ? this.speakL : poseFor(state, true);
      const wantR = speaking ? this.speakR : poseFor(state, false);
      if (wantL !== this.armL && this.layer(this.armName(true, wantL))) { this.armLPrev = this.armL; this.armL = wantL; this.armLFade = 0; }
      if (wantR !== this.armR && this.layer(this.armName(false, wantR))) { this.armRPrev = this.armR; this.armR = wantR; this.armRFade = 0; }
      const fadeStep = still ? 1 : dt / (speaking ? 0.22 : 0.15);
      this.armLFade = Math.min(1, this.armLFade + fadeStep); this.armRFade = Math.min(1, this.armRFade + fadeStep);
      const clamp = (v, pose) => Math.max(-limit(pose), Math.min(limit(pose), v));
      if (speaking && !still) {
        const liftL = this.voiceLevel * (this.armL === 'rest' ? 5 : 8) + (this.armL === 'rest' ? 0 : 6 * this.emph);
        const liftR = this.voiceLevel * (this.armR === 'rest' ? 5 : 8) + (this.armR === 'rest' ? 0 : 6 * this.emph);
        this.armLRot = clamp(3.5 * Math.sin(this.time * 2.3) + liftL, this.armL);
        this.armRRot = clamp(-3.5 * Math.sin(this.time * 1.7 + 1.1) - liftR, this.armR);
        if (P.waving && this.armR === 'open') this.armRRot = clamp(-4 - 9 * Math.sin(this.time * 15), this.armR);
      } else {
        const sway = still ? 0 : state === 'Working' ? 6 : 3;
        const swayR = this.armR === 'point' ? Math.min(3, sway) : sway;
        this.armLRot = clamp(sway * Math.sin(this.time * 1.9), this.armL);
        this.armRRot = clamp(-swayR * Math.sin(this.time * 1.9 + 0.6), this.armR);
      }
      this.armRAim = approach(this.armRAim, state === 'Working' && this.armR === 'point' ? WORK_AIM : 0, dt, 10 * fast);
      this.armRRot += this.armRAim;

      // effects
      this.ring = approach(this.ring, state === 'Listening' ? 1 : 0, dt, 9 * fast);
      this.dots = approach(this.dots, state === 'Thinking' ? 1 : 0, dt, 9 * fast);
      this.spinner = approach(this.spinner, state === 'Working' ? 1 : 0, dt, 9 * fast);
      this.badgeCheck = approach(this.badgeCheck, state === 'Success' ? 1 : 0, dt, 11 * fast);
      this.badgeAsk = approach(this.badgeAsk, state === 'NeedsConfirmation' ? 1 : 0, dt, 11 * fast);
    }

    /** Speaking: which pose each arm takes, the way a person gestures (see LixaAvatar.kt gesture()). */
    gesture(dt, open, begin) {
      this.quietFor = open < 0.06 ? this.quietFor + dt : 0;
      const stressed = open > 0.45 && this.prevOpen <= 0.45;
      this.prevOpen = open;
      if (begin) {
        this.lastMovedLeft = Math.random() < 0.5;
        this.speakL = this.lastMovedLeft ? 'open' : 'rest'; this.speakR = this.lastMovedLeft ? 'rest' : 'open';
        this.gestureAt = this.time + 0.8 + Math.random() * 0.7;
        return;
      }
      if (this.quietFor > 0.5) {
        if (this.time < this.relaxAt) return;
        if (this.speakL !== 'rest' && this.speakR !== 'rest') {
          if (this.speakL === 'point') this.speakL = 'rest';
          else if (this.speakR === 'point') this.speakR = 'rest';
          else if (this.lastMovedLeft) this.speakR = 'rest'; else this.speakL = 'rest';
        } else if (this.speakL === 'point') this.speakL = 'open';
        else if (this.speakR === 'point') this.speakR = 'open';
        this.relaxAt = this.time + 0.35; this.gestureAt = this.time + 0.5;
        return;
      }
      if (this.time < this.gestureAt) return;
      if (!stressed && this.time < this.gestureAt + 0.8) return;
      const left = Math.random() < 0.8 ? !this.lastMovedLeft : this.lastMovedLeft;
      const current = left ? this.speakL : this.speakR, other = left ? this.speakR : this.speakL;
      const wOpen = current === 'open' ? 0 : 5;
      const wPoint = current === 'point' || other === 'point' ? 0 : 2;
      const wRest = current === 'rest' || other === 'rest' ? 0 : 3;
      const pick = Math.random() * (wOpen + wPoint + wRest);
      const next = wOpen + wPoint + wRest <= 0 ? current : pick < wOpen ? 'open' : pick < wOpen + wPoint ? 'point' : 'rest';
      if (left) this.speakL = next; else this.speakR = next;
      this.lastMovedLeft = left;
      this.gestureAt = this.time + 0.7 + Math.random() * 1.1;
    }

    // ------------------------------------------------------------------ drawing
    draw() {
      const c = this.ctx, lay = this.lay;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!lay || !this.layer('lixa_head_no_arms')) return;
      const s = this.canvas.width / lay.canvas[0];
      const cx = lay.canvas[0] / 2 * s, cy = lay.canvas[1] / 2 * s;
      // (the theme's accent, read about once a second rather than every frame)
      if (!this.accent || (this.accentAt = (this.accentAt || 0) + 1) % 60 === 0) this.accent = (getComputedStyle(this.canvas).getPropertyValue('--accent') || '').trim() || '#009688';
      const accent = this.accent;

      if (this.ring > 0.01) {
        for (let i = 0; i < 2; i++) {
          const p = this.still ? 0.35 + 0.3 * i : ((this.time * 0.55 + i * 0.5) % 1);
          c.globalAlpha = this.ring * 0.34 * (1 - p);
          c.strokeStyle = accent; c.lineWidth = 6 * s;
          c.beginPath(); c.arc(cx, cy - 20 * s, 470 * s * (0.92 + 0.22 * p), 0, Math.PI * 2); c.stroke();
        }
        c.globalAlpha = 1;
      }

      c.save();
      c.translate(this.shake * s, this.bob * s);
      c.translate(cx, cy); c.scale(this.pulse, this.pulse); c.translate(-cx, -cy);
      this.arm(true, s); this.arm(false, s);
      this.drawLayer('lixa_head_no_arms', s, 1);
      this.eye(true, s); this.eye(false, s);
      this.brow(true, s); this.brow(false, s);
      this.mouth(s);
      if (this.dots > 0.01) for (let i = 0; i < 3; i++) {
        const lift = this.still ? 0 : 10 * Math.sin(this.time * 3.2 - i * 0.9);
        c.globalAlpha = this.dots * (0.55 + 0.15 * i); c.fillStyle = accent;
        c.beginPath(); c.arc((1392 + 44 * i) * s, (150 - 34 * i + lift) * s, (11 + 4 * i) * s, 0, Math.PI * 2); c.fill();
      }
      if (this.spinner > 0.01) {
        const r = 46 * s, x = 1340 * s, y = 150 * s, start = this.still ? -Math.PI / 2 : ((this.time * 300) % 360) * Math.PI / 180;
        c.lineWidth = 9 * s; c.lineCap = 'round'; c.strokeStyle = accent;
        c.globalAlpha = this.spinner * 0.18; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke();
        c.globalAlpha = this.spinner; c.beginPath(); c.arc(x, y, r, start, start + 100 * Math.PI / 180); c.stroke();
      }
      if (this.badgeCheck > 0.01) this.badge(s, this.badgeCheck, accent, true);
      if (this.badgeAsk > 0.01) this.badge(s, this.badgeAsk, '#F59E0B', false);
      c.globalAlpha = 1;
      c.restore();
    }

    drawLayer(name, s, alpha) {
      const l = this.layer(name);
      if (!l || alpha <= 0.003) return;
      const c = this.ctx;
      c.globalAlpha = Math.min(1, alpha);
      c.drawImage(l.img, l.meta.x * s, l.meta.y * s, l.meta.w * s, l.meta.h * s);
      c.globalAlpha = 1;
    }

    arm(left, s) {
      const lay = this.lay, c = this.ctx;
      const piv = left ? lay.pivots.left : lay.pivots.right;
      const fade = left ? this.armLFade : this.armRFade;
      c.save();
      c.translate(piv[0] * s, piv[1] * s); c.rotate((left ? this.armLRot : this.armRRot) * Math.PI / 180); c.translate(-piv[0] * s, -piv[1] * s);
      if (fade < 1) this.drawLayer(this.armName(left, left ? this.armLPrev : this.armRPrev), s, 1 - fade);
      this.drawLayer(this.armName(left, left ? this.armL : this.armR), s, fade);
      c.restore();
    }

    /** White, then the iris kept inside the white, then the lid; the whole eye squashes to blink. */
    eye(left, s) {
      const white = this.layer(left ? 'lixa_eye_left_white' : 'lixa_eye_right_white');
      const iris = this.layer(left ? 'lixa_iris_left' : 'lixa_iris_right');
      if (!white) return;
      const c = this.ctx, e = left ? this.lay.eyes.left : this.lay.eyes.right;
      const ex = e[0] * s, ey = e[1] * s;
      // the white and the iris are composed on their own small canvas, so the iris never shows outside the white
      const off = this.eyeCanvas[left ? 'left' : 'right'];
      const w = Math.max(1, Math.ceil(white.meta.w * s)), h = Math.max(1, Math.ceil(white.meta.h * s));
      if (off.width !== w || off.height !== h) { off.width = w; off.height = h; }
      const o = off.getContext('2d');
      o.globalCompositeOperation = 'source-over';
      o.clearRect(0, 0, w, h);
      o.drawImage(white.img, 0, 0, w, h);
      if (iris) {
        o.globalCompositeOperation = 'source-atop';
        o.drawImage(iris.img, (iris.meta.x - white.meta.x + this.gazeXv) * s, (iris.meta.y - white.meta.y + this.gazeYv) * s, iris.meta.w * s, iris.meta.h * s);
        o.globalCompositeOperation = 'source-over';
      }
      c.save();
      c.translate(ex, ey); c.scale(this.eyeScale, this.eyeScale * (1 - 0.92 * this.blink) * (1 - this.eyeSquint)); c.translate(-ex, -ey);
      c.drawImage(off, white.meta.x * s, white.meta.y * s, white.meta.w * s, white.meta.h * s);
      this.drawLayer(left ? 'lixa_lid_left' : 'lixa_lid_right', s, 1);
      c.restore();
    }

    brow(left, s) {
      const c = this.ctx, b = left ? this.lay.brows.left : this.lay.brows.right;
      c.save();
      c.translate(0, (left ? this.browLY : this.browRY) * s);
      c.translate(b[0] * s, b[1] * s); c.rotate((left ? this.browLRot : this.browRRot) * Math.PI / 180); c.translate(-b[0] * s, -b[1] * s);
      this.drawLayer(left ? 'lixa_brow_left' : 'lixa_brow_right', s, 1);
      c.restore();
    }

    mouthPath(cx, y, halfW, upper, lower) {
      const c = this.ctx;
      c.beginPath();
      c.moveTo(cx - halfW, y);
      c.quadraticCurveTo(cx, y + upper, cx + halfW, y);
      c.quadraticCurveTo(cx, y + lower, cx - halfW, y);
      c.closePath();
    }

    /** The kit's smile image, cross-faded with the mouths drawn here (closed, speaking, wide, worried, "o"). */
    mouth(s) {
      const c = this.ctx;
      this.drawLayer('lixa_mouth_smile', s, this.mImage);
      const drawn = 1 - this.mImage;
      if (drawn <= 0.01) return;
      const cx = this.lay.mouth[0] * s;
      const curve = drawn * (1 - this.mRound);
      if (curve > 0.01) {
        const gap = Math.abs(this.mLower - this.mUpper);
        this.mouthPath(cx, this.mY * s, this.mHalfW * s, this.mUpper * s, this.mLower * s);
        c.globalAlpha = curve; c.fillStyle = MOUTH; c.fill();
        if (gap > 44) {
          const inset = 0.74;
          const innerY = this.mY + (this.mUpper + this.mLower) * 0.25 * (1 - inset);
          const inside = curve * Math.min(1, Math.max(0, (gap - 44) / 40));
          this.mouthPath(cx, innerY * s, this.mHalfW * inset * s, this.mUpper * inset * s, this.mLower * inset * s);
          c.globalAlpha = inside; c.fillStyle = MOUTH_INNER; c.fill();
          c.save();
          c.clip();                                    // neither teeth nor tongue ever shows outside the opening
          const roof = (innerY + this.mUpper * inset * 0.5) * s;
          const teeth = Math.min(24, Math.max(8, gap * inset * 0.2)) * s;
          const left = cx - this.mHalfW * inset * s, width = this.mHalfW * inset * 2 * s;
          c.globalAlpha = inside; c.fillStyle = TEETH; c.fillRect(left, roof - 60 * s, width, 60 * s + teeth);
          c.globalAlpha = 0.5 * inside; c.fillStyle = TEETH_EDGE; c.fillRect(left, roof + teeth - 2.5 * s, width, 2.5 * s);
          const floor = (innerY + this.mLower * inset * 0.5) * s;
          const tw = this.mHalfW * inset * 0.9 * s, th = Math.min(42, gap * inset * 0.34) * s;
          this.tongue(cx - tw / 2, floor - th * 0.55, tw, th, inside * Math.min(1, Math.max(0, (gap - 90) / 80)));
          c.restore();
        }
        c.globalAlpha = 1;
      }
      if (this.mRound > 0.01) {
        const x = cx, y = 600 * s, a = drawn * this.mRound;
        c.globalAlpha = a; c.fillStyle = MOUTH;
        c.beginPath(); c.ellipse(x, y, 40 * s, 46 * s, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = MOUTH_INNER; c.beginPath(); c.ellipse(x, y, 27 * s, 32 * s, 0, 0, Math.PI * 2); c.fill();
        c.save(); c.clip(); this.tongue(x - 30 * s, y + 6 * s, 60 * s, 40 * s, a); c.restore();
        c.globalAlpha = 1;
      }
    }

    tongue(x, y, w, h, alpha) {
      if (alpha <= 0.01) return;
      const c = this.ctx;
      const g = c.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, TONGUE_TOP); g.addColorStop(1, TONGUE_BOTTOM);
      c.globalAlpha = alpha; c.fillStyle = g;
      c.beginPath(); c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); c.fill();
      c.globalAlpha = 0.5 * alpha; c.strokeStyle = TONGUE_LINE; c.lineWidth = w * 0.035; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x + w / 2, y + h * 0.16); c.lineTo(x + w / 2, y + h * 0.5); c.stroke();
    }

    badge(s, amount, color, check) {
      const c = this.ctx, x = 1290 * s, y = 150 * s, r = 62 * s * (0.6 + 0.4 * amount);
      c.globalAlpha = amount;
      c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, r + 7 * s, 0, Math.PI * 2); c.fill();
      c.fillStyle = color; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#fff'; c.lineWidth = 13 * s; c.lineCap = 'round'; c.lineJoin = 'round';
      c.beginPath();
      if (check) { c.moveTo(x - r * 0.42, y + r * 0.02); c.lineTo(x - r * 0.10, y + r * 0.34); c.lineTo(x + r * 0.46, y - r * 0.30); c.stroke(); }
      else {
        c.moveTo(x - r * 0.26, y - r * 0.22);
        c.bezierCurveTo(x - r * 0.26, y - r * 0.66, x + r * 0.34, y - r * 0.66, x + r * 0.30, y - r * 0.24);
        c.bezierCurveTo(x + r * 0.28, y - r * 0.02, x, y - r * 0.02, x, y + r * 0.20);
        c.stroke();
        c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y + r * 0.48, 8.5 * s, 0, Math.PI * 2); c.fill();
      }
      c.globalAlpha = 1;
    }
  }

  window.LixaAgentAvatar = LixaAvatar;
})();
