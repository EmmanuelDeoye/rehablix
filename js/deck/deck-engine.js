// js/deck/deck-engine.js — Rehablix premium presentation engine.
//
// One engine for BOTH apps: the web loads it in the Deck Studio / Lixa, and
// the Android app runs this exact file inside an off-screen WebView
// (app/src/main/assets/deck/), so decks look identical everywhere.
//
//   AI  → a JSON "deck spec" (content + layout intent + style choice)
//   Engine → a designed .pptx (PptxGenJS): per-deck visual identity,
//   canvas-generated textured / embossed backgrounds and illustrations,
//   16 editorial layouts with automatic variation, native charts, glass
//   cards, speaker notes and slide transitions.
//
// The engine never calls an AI itself: hosts pass the model's text in, so
// every token goes through the host's Rehablix quota checks.
(function (root) {
  'use strict';

  const W = 13.333, H = 7.5;           // 16:9, inches
  const PX = 144;                      // canvas pixels per inch for backgrounds

  // ===================================================================
  // Design systems — each deck picks one; a per-deck seed then varies the
  // motif placement, glow positions and accent rotation so two decks in
  // the same style still get their own identity.
  // ===================================================================
  const THEMES = {
    aurora: {
      name: 'Aurora', mood: 'Rehablix teal, deep and cinematic', dark: true,
      bg: ['0B1F24', '0E2E33', '07151A'], surface: 'FFFFFF', text: 'EEF6F5', muted: '9FC3C0',
      primary: '14B8A6', secondary: '38BDF8', accent: 'FBBF24', glass: true,
      head: 'Segoe UI Semibold', body: 'Segoe UI', motif: 'pulse', swatch: ['0E2E33', '14B8A6', 'FBBF24'],
    },
    clinical: {
      name: 'Clinical', mood: 'Crisp white and blue, precise', dark: false,
      bg: ['F7FAFD', 'EAF2FB', 'FFFFFF'], surface: 'FFFFFF', text: '0F1E33', muted: '5B6B80',
      primary: '1D4ED8', secondary: '0EA5E9', accent: '10B981', glass: false,
      head: 'Segoe UI Semibold', body: 'Segoe UI', motif: 'grid', swatch: ['F7FAFD', '1D4ED8', '0EA5E9'],
    },
    editorial: {
      name: 'Editorial', mood: 'Warm paper, serif, magazine-like', dark: false,
      bg: ['F6F1E9', 'EFE6D8', 'FBF8F3'], surface: 'FFFDF8', text: '1C1917', muted: '6B5E50',
      primary: 'B4532A', secondary: '1C1917', accent: 'C08A2B', glass: false,
      head: 'Georgia', body: 'Segoe UI', motif: 'lines', swatch: ['F6F1E9', 'B4532A', '1C1917'],
    },
    midnight: {
      name: 'Midnight', mood: 'Navy and gold, executive', dark: true,
      bg: ['0A1024', '121A3A', '05091A'], surface: 'FFFFFF', text: 'F1F4FF', muted: 'A9B3D6',
      primary: 'E0B45A', secondary: '6D8BFF', accent: 'F4D58D', glass: true,
      head: 'Georgia', body: 'Segoe UI', motif: 'orbits', swatch: ['121A3A', 'E0B45A', '6D8BFF'],
    },
    botanic: {
      name: 'Botanic', mood: 'Sage and moss, calm and human', dark: false,
      bg: ['F1F5EF', 'E4EDDF', 'F8FAF6'], surface: 'FFFFFF', text: '1E2B22', muted: '5C6F60',
      primary: '3F7D5A', secondary: '8BAF6E', accent: 'D08C4B', glass: false,
      head: 'Trebuchet MS', body: 'Segoe UI', motif: 'topo', swatch: ['E4EDDF', '3F7D5A', 'D08C4B'],
    },
    coral: {
      name: 'Coral', mood: 'Warm coral and plum, energetic', dark: false,
      bg: ['FFF6F2', 'FDE8E1', 'FFFBF9'], surface: 'FFFFFF', text: '2A1830', muted: '7A5F72',
      primary: 'E4572E', secondary: '7B2D6B', accent: 'F2A541', glass: false,
      head: 'Segoe UI Semibold', body: 'Segoe UI', motif: 'arcs', swatch: ['FDE8E1', 'E4572E', '7B2D6B'],
    },
    graphite: {
      name: 'Graphite', mood: 'Graphite and electric lime, modern tech', dark: true,
      bg: ['15171A', '1E2226', '0E1012'], surface: 'FFFFFF', text: 'F2F4F5', muted: 'A2AAB0',
      primary: 'B6F23C', secondary: '38BDF8', accent: 'F472B6', glass: true,
      head: 'Segoe UI Semibold', body: 'Segoe UI', motif: 'cells', swatch: ['1E2226', 'B6F23C', '38BDF8'],
    },
    sunrise: {
      name: 'Sunrise', mood: 'Peach to violet gradients, uplifting', dark: false,
      bg: ['FFF4EC', 'F9E3F1', 'FFF9F4'], surface: 'FFFFFF', text: '2B1B3D', muted: '6E5A7E',
      primary: '8B5CF6', secondary: 'F97316', accent: 'EC4899', glass: false,
      head: 'Segoe UI Semibold', body: 'Segoe UI', motif: 'waves', swatch: ['F9E3F1', '8B5CF6', 'F97316'],
    },
  };

  // Font Awesome solid glyphs (codepoints stable across FA 5/6 free).
  const ICONS = {
    brain: '', heart: '', walking: '', wheelchair: '', bone: '', lungs: '',
    hand: '', stethoscope: '', dumbbell: '', chart: '', doctor: '', hospital: '',
    notes: '', pills: '', syringe: '', dna: '', microscope: '', graduation: '',
    idea: '', target: '', checklist: '', team: '', care: '', eye: '', ear: '',
    child: '', running: '', flask: '', book: '', calendar: '', clock: '',
    check: '', warning: '', cycle: '', bolt: '', star: '', chat: '', pie: '',
    bar: '', list: '', route: '', compass: '', rocket: '', puzzle: '',
    growth: '', balance: '', search: '', crutch: '', xray: '', apple: '',
    bed: '', spa: '', shield: '', user: '', home: '', globe: '', award: '',
    handshake: '', lightbulb: '', question: '', quote: '', flag: '', layers: '',
    mind: '', baby: '', tooth: '', virus: '若', hands: '', seedling: '',
  };
  const ICON_FONT = '"Font Awesome 6 Free", "Font Awesome 5 Free", "RxFA"';

  const LAYOUTS = ['cover', 'agenda', 'section', 'split', 'cards', 'iconList', 'stats', 'timeline', 'process',
    'comparison', 'quote', 'chart', 'table', 'imageFocus', 'cycle', 'closing'];
  const TEXT_FAMILY = ['split', 'cards', 'iconList', 'imageFocus'];

  // ===================================================================
  // Small utilities
  // ===================================================================
  const clean = (h) => String(h || '').replace('#', '').slice(0, 6).toUpperCase();
  function rgb(h) { h = clean(h); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
  function hex(r, g, b) { return [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
  function mix(a, b, t) { const x = rgb(a), y = rgb(b); return hex(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t); }
  function rgba(h, a) { const c = rgb(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let a = seed >>> 0; return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const str = (v, max) => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return max ? s.slice(0, max) : s; };
  const arr = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const strip = (s) => str(s).replace(/\*\*|__|`|^#+\s*/g, '');

  // Rough fit: estimated lines of `text` in a box `wIn` wide at `pt`.
  function linesFor(text, wIn, pt) { const cpl = Math.max(8, (wIn * 144) / pt); return Math.max(1, Math.ceil(String(text || '').length / cpl)); }
  function fitPt(text, wIn, hIn, maxPt, minPt) {
    for (let pt = maxPt; pt > minPt; pt -= 1) { if (linesFor(text, wIn, pt) * pt * 1.22 / 72 <= hIn) return pt; }
    return minPt;
  }

  // Largest size at which a short figure stays on ONE line.
  function onePt(text, wIn, maxPt, minPt) { return Math.max(minPt, Math.min(maxPt, Math.floor((wIn * 72) / (Math.max(1, String(text || '').length) * 0.6)))); }

  // ===================================================================
  // Canvas art — backgrounds, illustration panels, icons
  // ===================================================================
  function canvas(w, h) {
    const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h);
    return c;
  }
  function dataOf(c, type) { return c.toDataURL(type || 'image/png', 0.9).replace(/^data:/, ''); }

  function grain(ctx, w, h, strength, r) {
    const img = ctx.getImageData(0, 0, w, h); const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * strength;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  }

  // Engraved / embossed stroke: shadow pass + highlight pass + body.
  function emboss(ctx, draw, t, alpha) {
    const dark = t.dark;
    ctx.save();
    ctx.translate(2, 2); ctx.strokeStyle = dark ? `rgba(0,0,0,${0.55 * alpha})` : `rgba(0,0,0,${0.12 * alpha})`; draw(); ctx.restore();
    ctx.save();
    ctx.translate(-1.5, -1.5); ctx.strokeStyle = dark ? `rgba(255,255,255,${0.08 * alpha})` : `rgba(255,255,255,${0.9 * alpha})`; draw(); ctx.restore();
    ctx.save(); ctx.strokeStyle = rgba(dark ? mix(t.bg[1], 'FFFFFF', 0.12) : mix(t.bg[1], t.primary, 0.12), 0.55 * alpha); draw(); ctx.restore();
  }

  function motif(ctx, t, name, w, h, r, region, alpha) {
    ctx.save();
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.rect(region.x, region.y, region.w, region.h); ctx.clip();
    const cx = region.x + region.w * (0.55 + r() * 0.35), cy = region.y + region.h * (0.3 + r() * 0.4);
    const paths = {
      pulse() { // ECG lines
        for (let k = 0; k < 4; k++) {
          const y = region.y + region.h * (0.25 + k * 0.17);
          emboss(ctx, () => {
            ctx.beginPath(); let x = region.x; ctx.moveTo(x, y);
            while (x < region.x + region.w) {
              const beat = r() < 0.25;
              if (beat) { ctx.lineTo(x + 20, y); ctx.lineTo(x + 32, y - 60 - r() * 50); ctx.lineTo(x + 46, y + 40); ctx.lineTo(x + 58, y); x += 58; }
              else { x += 40 + r() * 60; ctx.lineTo(x, y + (r() - 0.5) * 6); }
            }
            ctx.stroke();
          }, t, alpha * (1 - k * 0.18));
        }
      },
      grid() {
        const step = 36;
        ctx.save(); ctx.fillStyle = rgba(t.dark ? 'FFFFFF' : t.primary, 0.12 * alpha);
        for (let x = region.x; x < region.x + region.w; x += step) for (let y = region.y; y < region.y + region.h; y += step) { ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
        for (let k = 0; k < 6; k++) { const x = region.x + r() * region.w, y = region.y + r() * region.h; emboss(ctx, () => { ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x + 10, y); ctx.moveTo(x, y - 10); ctx.lineTo(x, y + 10); ctx.stroke(); }, t, alpha); }
      },
      lines() { for (let k = -20; k < 60; k++) { const x = region.x + k * 34; emboss(ctx, () => { ctx.beginPath(); ctx.moveTo(x, region.y + region.h); ctx.lineTo(x + region.h * 0.6, region.y); ctx.stroke(); }, t, alpha * 0.45); } },
      orbits() { for (let k = 0; k < 7; k++) { const rx = 120 + k * 90, ry = 60 + k * 45; emboss(ctx, () => { ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, -0.35, 0, Math.PI * 2); ctx.stroke(); }, t, alpha * (1 - k * 0.1)); } },
      topo() {
        for (let k = 0; k < 11; k++) {
          const base = 60 + k * 46;
          emboss(ctx, () => {
            ctx.beginPath();
            for (let a = 0; a <= Math.PI * 2 + 0.01; a += 0.12) {
              const rr = base + Math.sin(a * 3 + k) * 14 + Math.cos(a * 5 - k * 0.7) * 9;
              const x = cx + Math.cos(a) * rr * 1.25, y = cy + Math.sin(a) * rr;
              if (a === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath(); ctx.stroke();
          }, t, alpha * (1 - k * 0.06));
        }
      },
      arcs() { const ox = region.x + region.w, oy = region.y + region.h; for (let k = 0; k < 10; k++) emboss(ctx, () => { ctx.beginPath(); ctx.arc(ox, oy, 140 + k * 70, Math.PI, Math.PI * 1.5); ctx.stroke(); }, t, alpha * (1 - k * 0.07)); },
      cells() {
        const s = 46, hgt = Math.sqrt(3) * s;
        for (let x = region.x - s; x < region.x + region.w + s; x += s * 1.5) {
          for (let y = region.y - hgt; y < region.y + region.h + hgt; y += hgt) {
            const yy = y + ((Math.round((x - region.x) / (s * 1.5)) % 2) ? hgt / 2 : 0);
            const d = Math.hypot(x - cx, yy - cy); if (d > region.w * 0.55) continue;
            emboss(ctx, () => { ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = Math.PI / 3 * i; const px = x + Math.cos(a) * s * 0.92, py = yy + Math.sin(a) * s * 0.92; if (!i) ctx.moveTo(px, py); else ctx.lineTo(px, py); } ctx.closePath(); ctx.stroke(); }, t, alpha * Math.max(0.15, 1 - d / (region.w * 0.55)));
          }
        }
      },
      waves() { for (let k = 0; k < 9; k++) { const y0 = region.y + region.h * (0.15 + k * 0.09); emboss(ctx, () => { ctx.beginPath(); for (let x = region.x; x <= region.x + region.w; x += 12) { const y = y0 + Math.sin((x / 180) + k * 0.6) * 28 + Math.sin(x / 70) * 6; if (x === region.x) ctx.moveTo(x, y); else ctx.lineTo(x, y); } ctx.stroke(); }, t, alpha * (1 - k * 0.07)); } },
    };
    (paths[name] || paths.waves)();
    ctx.restore();
  }

  // Big engraved illustration (an FA glyph) carved into the surface.
  function engravedGlyph(ctx, t, glyph, x, y, size, alpha) {
    if (!glyph) return;
    ctx.save();
    ctx.font = `900 ${size}px ${ICON_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = t.dark ? `rgba(0,0,0,${0.5 * alpha})` : `rgba(0,0,0,${0.1 * alpha})`; ctx.fillText(glyph, x + 5, y + 5);
    ctx.fillStyle = t.dark ? `rgba(255,255,255,${0.07 * alpha})` : `rgba(255,255,255,${0.95 * alpha})`; ctx.fillText(glyph, x - 3, y - 3);
    ctx.fillStyle = rgba(t.dark ? mix(t.bg[1], 'FFFFFF', 0.1) : mix(t.bg[1], t.primary, 0.1), alpha); ctx.fillText(glyph, x, y);
    ctx.restore();
  }

  function glow(ctx, x, y, radius, color, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, rgba(color, a)); g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  const bgCache = new Map();
  function background(t, kind, seed, glyph) {
    const key = [t.name, kind, seed, glyph || ''].join('|');
    if (bgCache.has(key)) return bgCache.get(key);
    const w = W * PX, h = H * PX, c = canvas(w, h), ctx = c.getContext('2d'), r = rng(seed + hashStr(kind));
    const hero = kind === 'cover' || kind === 'section' || kind === 'closing';
    // 1. base gradient
    const ang = r() * Math.PI;
    const g = ctx.createLinearGradient(w / 2 - Math.cos(ang) * w / 2, h / 2 - Math.sin(ang) * h / 2, w / 2 + Math.cos(ang) * w / 2, h / 2 + Math.sin(ang) * h / 2);
    g.addColorStop(0, '#' + t.bg[0]); g.addColorStop(0.55, '#' + t.bg[1]); g.addColorStop(1, '#' + t.bg[2]);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // 2. colour glows
    const ga = hero ? (t.dark ? 0.32 : 0.22) : (t.dark ? 0.14 : 0.08);
    glow(ctx, w * (0.75 + r() * 0.2), h * (0.1 + r() * 0.3), h * 0.9, t.primary, ga);
    glow(ctx, w * (0.05 + r() * 0.25), h * (0.7 + r() * 0.3), h * 0.8, t.secondary, ga * 0.8);
    if (hero) glow(ctx, w * (0.5 + r() * 0.2), h * 1.05, h * 0.6, t.accent, ga * 0.5);
    // 3. embossed motif — full-bleed on hero slides, a quiet edge band on content
    const region = hero ? { x: w * 0.42, y: 0, w: w * 0.58, h } : (r() < 0.5 ? { x: w * 0.72, y: 0, w: w * 0.28, h } : { x: 0, y: h * 0.82, w, h: h * 0.18 });
    motif(ctx, t, t.motif, w, h, r, region, hero ? 1 : 0.55);
    // 4. carved illustration on hero slides
    if (hero && glyph) engravedGlyph(ctx, t, glyph, w * (kind === 'section' ? 0.8 : 0.78), h * 0.5, h * (kind === 'section' ? 0.62 : 0.7), 1);
    // 5. grain + vignette
    grain(ctx, w, h, t.dark ? 10 : 7, r);
    if (t.dark) { const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 1.05); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.45)'); ctx.fillStyle = v; ctx.fillRect(0, 0, w, h); }
    // JPEG keeps a deck small; fixMediaNames() then gives the file its true extension.
    // Without JSZip that repair cannot run, so fall back to real PNG data.
    const out = dataOf(c, root.JSZip ? 'image/jpeg' : 'image/png');
    bgCache.set(key, out);
    return out;
  }

  // Rounded illustration panel for imageFocus slides ("smart image placement").
  function illustrationPanel(t, glyph, seed, wIn, hIn) {
    const w = wIn * PX, h = hIn * PX, c = canvas(w, h), ctx = c.getContext('2d'), r = rng(seed ^ 0x9e3779b9);
    const rad = 0.35 * PX;
    ctx.beginPath(); ctx.moveTo(rad, 0); ctx.arcTo(w, 0, w, h, rad); ctx.arcTo(w, h, 0, h, rad); ctx.arcTo(0, h, 0, 0, rad); ctx.arcTo(0, 0, w, 0, rad); ctx.closePath(); ctx.clip();
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#' + mix(t.primary, t.dark ? '000000' : 'FFFFFF', 0.15)); g.addColorStop(1, '#' + mix(t.secondary, '000000', t.dark ? 0.35 : 0.1));
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    glow(ctx, w * 0.8, h * 0.15, h * 0.8, 'FFFFFF', 0.28);
    const tt = Object.assign({}, t, { dark: true, bg: [t.primary, t.primary, t.secondary] });
    motif(ctx, tt, t.motif, w, h, r, { x: 0, y: 0, w, h }, 0.7);
    ctx.save(); ctx.font = `900 ${h * 0.46}px ${ICON_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18;
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillText(glyph || ICONS.idea, w / 2, h / 2);
    ctx.restore();
    grain(ctx, w, h, 12, r);
    return dataOf(c, 'image/png');
  }

  const iconCache = new Map();
  function iconImg(glyph, color, px) {
    const key = glyph + color + (px || 128);
    if (iconCache.has(key)) return iconCache.get(key);
    const s = px || 128, c = canvas(s, s), ctx = c.getContext('2d');
    ctx.font = `900 ${s * 0.7}px ${ICON_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#' + clean(color); ctx.fillText(glyph, s / 2, s / 2 + s * 0.02);
    const out = dataOf(c);
    iconCache.set(key, out);
    return out;
  }

  function glyphFor(name, fallbackText, r) {
    const n = str(name).toLowerCase().replace(/[^a-z]/g, '');
    if (ICONS[n]) return ICONS[n];
    const t = (str(fallbackText) + ' ' + n).toLowerCase();
    const guess = [
      [/brain|cognit|neuro|stroke|memory/, 'brain'], [/heart|cardi/, 'heart'], [/gait|walk|mobil|ambul/, 'walking'],
      [/wheel|spinal|sci\b/, 'wheelchair'], [/bone|fractur|joint|ortho|knee|hip|shoulder/, 'bone'], [/lung|respir|breath|copd/, 'lungs'],
      [/hand|grip|fine motor|upper limb/, 'hand'], [/assess|exam|diagnos/, 'stethoscope'], [/exercis|strength|train/, 'dumbbell'],
      [/outcome|result|data|evidence|trend/, 'chart'], [/team|staff|family|caregiver|people/, 'team'], [/goal|aim|objective/, 'target'],
      [/plan|protocol|checklist|steps/, 'checklist'], [/educat|learn|student|teach/, 'graduation'], [/research|study|trial/, 'microscope'],
      [/medic|drug|pharm/, 'pills'], [/child|paediat|pediat/, 'child'], [/time|duration|schedule/, 'clock'], [/risk|caution|contraind|red flag/, 'warning'],
      [/idea|insight|key|takeaway/, 'idea'], [/balance|fall/, 'balance'], [/care|support|compassion/, 'care'], [/home|community/, 'home'],
    ].find(([re]) => re.test(t));
    if (guess) return ICONS[guess[1]];
    const keys = ['idea', 'target', 'check', 'star', 'chart', 'care', 'growth', 'compass'];
    return ICONS[keys[Math.floor((r ? r() : Math.random()) * keys.length)]];
  }

  // ===================================================================
  // Spec normalisation + automatic layout variation
  // ===================================================================
  function parseSpec(text) {
    let s = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a >= 0 && b > a) s = s.slice(a, b + 1);
    let obj;
    try { obj = JSON.parse(s); } catch (e) { obj = JSON.parse(s.replace(/,(\s*[\]}])/g, '$1')); }
    return normalize(obj);
  }

  function items(v, max) {
    return arr(v).map(x => (typeof x === 'string' ? { heading: '', text: strip(x) } : { heading: strip(x.heading || x.title || x.label), text: strip(x.text || x.description || x.detail || ''), icon: x.icon }))
      .filter(x => x.heading || x.text).slice(0, max || 8);
  }

  function normalize(spec) {
    spec = spec || {};
    const out = {
      title: strip(spec.title) || 'Presentation', subtitle: strip(spec.subtitle), style: str(spec.style).toLowerCase(),
      presenter: strip(spec.presenter), audience: strip(spec.audience), slides: [],
    };
    arr(spec.slides).forEach((raw) => {
      if (!raw || typeof raw !== 'object') return;
      const s = {
        layout: LAYOUTS.includes(raw.layout) ? raw.layout : 'split', title: strip(raw.title), kicker: strip(raw.kicker), subtitle: strip(raw.subtitle),
        lead: strip(raw.lead || raw.text), bullets: arr(raw.bullets).map(strip).filter(Boolean).slice(0, 7), icon: raw.icon, notes: str(raw.notes, 1500),
        items: items(raw.items, 8), steps: items(raw.steps, 7), center: strip(raw.center),
        stats: arr(raw.stats).map(x => ({ value: strip(x.value), label: strip(x.label), note: strip(x.note) })).filter(x => x.value).slice(0, 4),
        left: raw.left ? { heading: strip(raw.left.heading), bullets: arr(raw.left.bullets).map(strip).filter(Boolean).slice(0, 6) } : null,
        right: raw.right ? { heading: strip(raw.right.heading), bullets: arr(raw.right.bullets).map(strip).filter(Boolean).slice(0, 6) } : null,
        quote: strip(raw.quote), attribution: strip(raw.attribution),
        chart: raw.chart && Array.isArray(raw.chart.labels) && Array.isArray(raw.chart.series) ? {
          type: ['bar', 'column', 'line', 'doughnut', 'pie'].includes(raw.chart.type) ? raw.chart.type : 'bar',
          labels: raw.chart.labels.map(x => str(x, 40)).slice(0, 12), unit: str(raw.chart.unit, 12),
          series: raw.chart.series.map(se => ({ name: str(se.name, 40) || 'Series', values: arr(se.values).map(Number).map(v => (isFinite(v) ? v : 0)) })).slice(0, 4),
        } : null,
        columns: arr(raw.columns).map(x => str(x, 40)).slice(0, 6), rows: arr(raw.rows).slice(0, 8).map(rw => arr(rw).map(x => str(x, 80)).slice(0, 6)),
      };
      out.slides.push(s);
    });
    return out;
  }

  // Make every slide's content fit its layout, then vary consecutive
  // text-heavy slides so the deck never repeats one template.
  function plan(spec) {
    const s = spec.slides;
    const fits = {
      cover: () => true, section: (x) => !!x.title, closing: () => true, agenda: (x) => (x.items.length || x.bullets.length) >= 3,
      split: (x) => x.bullets.length >= 2 || !!x.lead, cards: (x) => x.items.length >= 2 && x.items.length <= 6, iconList: (x) => x.items.length >= 3,
      imageFocus: (x) => !!(x.lead || x.bullets.length), stats: (x) => x.stats.length >= 2, timeline: (x) => x.steps.length >= 3 && x.steps.length <= 6,
      process: (x) => x.steps.length >= 3 && x.steps.length <= 5, comparison: (x) => !!(x.left && x.right), quote: (x) => !!x.quote,
      chart: (x) => !!(x.chart && x.chart.series.length && x.chart.labels.length >= 2), table: (x) => x.columns.length >= 2 && x.rows.length >= 1,
      cycle: (x) => x.steps.length >= 3 && x.steps.length <= 6,
    };
    s.forEach((x) => {
      // bullets ⇄ items interchange so a layout switch never loses content
      if (!x.items.length && x.bullets.length >= 3 && ['cards', 'iconList', 'agenda'].includes(x.layout)) x.items = x.bullets.map(b => { const m = b.split(/:\s+|\s[—–-]\s/); return m.length > 1 ? { heading: m[0], text: m.slice(1).join(' — ') } : { heading: '', text: b }; });
      if (!x.steps.length && x.items.length >= 3 && ['timeline', 'process', 'cycle'].includes(x.layout)) x.steps = x.items.slice();
      if (!x.bullets.length && x.items.length && ['split', 'imageFocus', 'closing'].includes(x.layout)) x.bullets = x.items.map(i => i.heading ? `${i.heading}: ${i.text}` : i.text);
      if (!fits[x.layout] || !fits[x.layout](x)) {
        if (x.items.length >= 2 && x.items.length <= 6) x.layout = 'cards';
        else if (x.steps.length >= 3) x.layout = 'timeline';
        else if (x.quote) x.layout = 'quote';
        else x.layout = 'split';
        if (x.layout === 'split' && !x.bullets.length && !x.lead) x.lead = x.items.map(i => i.text).join(' ');
      }
    });
    if (!s.length || s[0].layout !== 'cover') s.unshift({ layout: 'cover', title: spec.title, subtitle: spec.subtitle, kicker: '', bullets: [], items: [], steps: [], stats: [], columns: [], rows: [] });
    if (s[s.length - 1].layout !== 'closing') s.push({ layout: 'closing', title: 'Thank you', bullets: [], items: [], steps: [], stats: [], columns: [], rows: [], lead: 'Questions & discussion' });
    // anti-repetition inside the text family
    for (let i = 1; i < s.length; i++) {
      const prev = s[i - 1].layout, cur = s[i];
      if (cur.layout !== prev || !TEXT_FAMILY.includes(cur.layout)) continue;
      const order = ['split', 'iconList', 'imageFocus', 'cards'];
      for (const alt of order) {
        if (alt === prev) continue;
        if (alt === 'iconList' && !cur.items.length && cur.bullets.length >= 3) cur.items = cur.bullets.map(b => ({ heading: '', text: b }));
        if (alt === 'cards' && !cur.items.length && cur.bullets.length >= 2 && cur.bullets.length <= 4) cur.items = cur.bullets.map(b => ({ heading: '', text: b }));
        if (fits[alt](cur)) { cur.layout = alt; break; }
      }
    }
    return spec;
  }

  function chooseTheme(spec, forced) {
    if (forced && THEMES[forced]) return forced;
    if (spec.style && THEMES[spec.style]) return spec.style;
    const t = (spec.title + ' ' + spec.subtitle + ' ' + spec.audience).toLowerCase();
    if (/research|trial|evidence|clinical|protocol|anatomy|patho/.test(t)) return 'clinical';
    if (/board|strategy|business|budget|executive|investor/.test(t)) return 'midnight';
    if (/wellbeing|mental|mindful|holistic|community|palliative/.test(t)) return 'botanic';
    if (/paediatric|pediatric|child|play|youth/.test(t)) return 'sunrise';
    if (/tech|ai|digital|robot|innovation|sensor/.test(t)) return 'graphite';
    if (/history|philosophy|ethic|essay|case study/.test(t)) return 'editorial';
    return 'aurora';
  }

  // ===================================================================
  // PPTX rendering
  // ===================================================================
  function renderer(pptx, t, spec, seed) {
    const r = rng(seed);
    const S = pptx.ShapeType || pptx.shapes;
    const txt = t.text, muted = t.muted;
    const cardFill = t.dark ? { color: 'FFFFFF', transparency: 90 } : { color: t.surface, transparency: t.glass ? 18 : 0 };
    const cardLine = t.dark ? { color: 'FFFFFF', transparency: 78, width: 1 } : { color: mix(t.bg[1], t.primary, 0.18), width: 1 };
    const shadow = { type: 'outer', blur: 14, offset: 5, angle: 90, color: '000000', opacity: t.dark ? 0.35 : 0.12 };
    const total = spec.slides.length;

    function card(slide, x, y, w, h, opts) {
      slide.addShape(S.roundRect, Object.assign({ x, y, w, h, rectRadius: 0.16, fill: cardFill, line: cardLine, shadow }, opts || {}));
    }
    function badge(slide, x, y, d, glyph, color) {
      slide.addShape(S.ellipse, { x, y, w: d, h: d, fill: { color: color || t.primary, transparency: t.dark ? 70 : 82 }, line: { color: color || t.primary, transparency: 55, width: 1 } });
      slide.addImage({ data: iconImg(glyph, color || t.primary, 128), x: x + d * 0.2, y: y + d * 0.2, w: d * 0.6, h: d * 0.6 });
    }
    function header(slide, s, idx) {
      if (s.kicker) slide.addText(s.kicker.toUpperCase(), { x: 0.7, y: 0.42, w: 9, h: 0.3, fontFace: t.body, fontSize: 11, bold: true, color: t.primary, charSpacing: 3 });
      const pt = fitPt(s.title, 11.4, 0.9, 30, 20);
      slide.addText(s.title || '', { x: 0.7, y: 0.68, w: 11.6, h: 0.9, fontFace: t.head, fontSize: pt, bold: true, color: txt, valign: 'top', margin: 0 });
      slide.addShape(S.rect, { x: 0.72, y: 1.62, w: 0.9, h: 0.06, fill: { color: t.primary }, line: { color: t.primary, width: 0 } });
    }
    function footer(slide, idx) {
      slide.addText(spec.title, { x: 0.7, y: 7.02, w: 8, h: 0.3, fontFace: t.body, fontSize: 9, color: muted, margin: 0 });
      slide.addText(`${idx + 1} / ${total}`, { x: 11.13, y: 7.02, w: 1.5, h: 0.3, fontFace: t.body, fontSize: 9, color: muted, align: 'right', margin: 0 });
    }
    function bulletsBox(slide, list, x, y, w, h, pt, glyph) {
      if (!list.length) return;
      // Largest type (up to +5pt) that fits, then the leftover space is shared
      // between the items so a short list never floats in an empty card.
      const textH = (p) => list.reduce((s, b) => s + linesFor(b, w - 0.6, p) * p * 1.3 / 72, 0);
      let p = pt + 5;
      while (p > 11 && textH(p) + list.length * 0.16 > h) p -= 1;
      const gap = Math.max(0.12, Math.min(0.5, (h - textH(p)) / list.length));
      const ic = Math.min(0.34, p / 72 * 1.25);
      let cy = y;
      list.forEach((b) => {
        const hh = linesFor(b, w - 0.6, p) * p * 1.3 / 72;
        slide.addImage({ data: iconImg(glyph || ICONS.check, t.primary, 96), x, y: cy + (p * 1.3 / 72 - ic) / 2, w: ic, h: ic });
        slide.addText(b, { x: x + ic + 0.18, y: cy, w: w - ic - 0.18, h: Math.max(0.34, hh), fontFace: t.body, fontSize: p, color: txt, valign: 'top', margin: 0 });
        cy += hh + gap;
      });
    }

    const L = {
      cover(slide, s) {
        slide.background = { data: background(t, 'cover', seed, glyphFor(s.icon, spec.title, r)) };
        const kick = s.kicker || spec.audience || 'Rehablix';
        slide.addShape(S.roundRect, { x: 0.8, y: 1.55, w: Math.min(5, 0.4 + kick.length * 0.11), h: 0.42, rectRadius: 0.21, fill: { color: t.primary, transparency: t.dark ? 70 : 84 }, line: { color: t.primary, transparency: 40, width: 1 } });
        slide.addText(kick.toUpperCase(), { x: 0.8, y: 1.55, w: Math.min(5, 0.4 + kick.length * 0.11), h: 0.42, align: 'center', fontFace: t.body, fontSize: 10.5, bold: true, color: t.dark ? t.accent : t.primary, charSpacing: 2.5, margin: 0 });
        const title = s.title || spec.title;
        const pt = fitPt(title, 7.4, 2.6, 50, 30);
        slide.addText(title, { x: 0.8, y: 2.2, w: 7.6, h: 2.7, fontFace: t.head, fontSize: pt, bold: true, color: txt, valign: 'top', margin: 0, lineSpacingMultiple: 0.95 });
        const sub = s.subtitle || spec.subtitle;
        if (sub) slide.addText(sub, { x: 0.8, y: 4.95, w: 7.2, h: 0.9, fontFace: t.body, fontSize: 17, color: muted, valign: 'top', margin: 0 });
        slide.addShape(S.rect, { x: 0.82, y: 6.2, w: 1.2, h: 0.05, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
        const meta = [spec.presenter, new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long' })].filter(Boolean).join('  ·  ');
        slide.addText(meta, { x: 0.8, y: 6.35, w: 7, h: 0.35, fontFace: t.body, fontSize: 11, color: muted, margin: 0 });
      },
      section(slide, s, idx, secNo) {
        slide.background = { data: background(t, 'section', seed + secNo * 7, glyphFor(s.icon, s.title, r)) };
        slide.addText(String(secNo).padStart(2, '0'), { x: 0.7, y: 1.2, w: 5, h: 2.2, fontFace: t.head, fontSize: 140, bold: true, color: t.primary, transparency: 35, margin: 0 });
        slide.addText(s.title, { x: 0.8, y: 3.55, w: 7.4, h: 1.5, fontFace: t.head, fontSize: fitPt(s.title, 7.2, 1.4, 42, 26), bold: true, color: txt, valign: 'top', margin: 0 });
        if (s.lead) slide.addText(s.lead, { x: 0.8, y: 5.15, w: 6.8, h: 1.1, fontFace: t.body, fontSize: 16, color: muted, valign: 'top', margin: 0 });
      },
      agenda(slide, s, idx) {
        header(slide, s, idx);
        const list = (s.items.length ? s.items.map(i => i.heading || i.text) : s.bullets).slice(0, 8);
        const cols = list.length > 4 ? 2 : 1, rows = Math.ceil(list.length / cols);
        const cw = cols === 2 ? 5.85 : 8.2, ch = Math.min(1.05, (4.9 - (rows - 1) * 0.2) / rows);
        list.forEach((it, i) => {
          const c = Math.floor(i / rows), rw = i % rows, x = 0.7 + c * (cw + 0.23), y = 2.05 + rw * (ch + 0.2);
          card(slide, x, y, cw, ch);
          slide.addShape(S.ellipse, { x: x + 0.25, y: y + ch / 2 - 0.3, w: 0.6, h: 0.6, fill: { color: t.primary }, line: { color: t.primary, width: 0 } });
          slide.addText(String(i + 1), { x: x + 0.25, y: y + ch / 2 - 0.3, w: 0.6, h: 0.6, align: 'center', valign: 'middle', fontFace: t.head, fontSize: 16, bold: true, color: t.dark ? '0B1F24' : 'FFFFFF', margin: 0 });
          slide.addText(it, { x: x + 1.05, y, w: cw - 1.25, h: ch, valign: 'middle', fontFace: t.body, fontSize: fitPt(it, cw - 1.3, ch, 19, 12), color: txt, margin: 0 });
        });
      },
      split(slide, s, idx) {
        header(slide, s, idx);
        const hasLead = !!s.lead;
        if (hasLead) slide.addText(s.lead, { x: 0.7, y: 2.0, w: 5.4, h: 4.6, fontFace: t.body, fontSize: fitPt(s.lead, 5.3, 4.5, 24, 13), color: muted, valign: 'top', margin: 0, lineSpacingMultiple: 1.1 });
        const x = hasLead ? 6.55 : 0.7, w = hasLead ? 6.1 : 11.95;
        if (s.bullets.length) { card(slide, x, 1.95, w, 4.85); bulletsBox(slide, s.bullets, x + 0.45, 2.4, w - 0.9, 4.0, 16); }
      },
      cards(slide, s, idx) {
        header(slide, s, idx);
        const n = s.items.length, cols = n <= 3 ? n : (n === 4 ? 4 : 3), rows = Math.ceil(n / cols);
        const gap = 0.3, cw = (11.93 - gap * (cols - 1)) / cols, ch = rows === 1 ? 4.5 : 2.3;
        s.items.forEach((it, i) => {
          const x = 0.7 + (i % cols) * (cw + gap), y = 2.05 + Math.floor(i / cols) * (ch + 0.25);
          card(slide, x, y, cw, ch);
          slide.addShape(S.rect, { x: x + 0.01, y: y + 0.01, w: cw - 0.02, h: 0.07, fill: { color: [t.primary, t.secondary, t.accent][i % 3] }, line: { width: 0, color: t.primary } });
          const d = rows === 1 ? 0.85 : 0.6;
          badge(slide, x + 0.3, y + 0.35, d, glyphFor(it.icon, it.heading + ' ' + it.text, r), [t.primary, t.secondary, t.accent][i % 3]);
          const ty = y + 0.35 + d + 0.18;
          if (it.heading) slide.addText(it.heading, { x: x + 0.3, y: ty, w: cw - 0.6, h: 0.55, fontFace: t.head, fontSize: fitPt(it.heading, cw - 0.6, 0.55, rows === 1 ? 22 : 17, 12), bold: true, color: txt, margin: 0, valign: 'top' });
          const by = ty + (it.heading ? 0.58 : 0);
          slide.addText(it.text, { x: x + 0.3, y: by, w: cw - 0.6, h: y + ch - by - 0.2, fontFace: t.body, fontSize: fitPt(it.text, cw - 0.6, y + ch - by - 0.2, rows === 1 ? 17 : 13.5, 10), color: muted, lineSpacingMultiple: 1.08, valign: 'top', margin: 0 });
        });
      },
      iconList(slide, s, idx) {
        header(slide, s, idx);
        const list = s.items.slice(0, 8), cols = list.length > 4 ? 2 : 1, rows = Math.ceil(list.length / cols);
        const cw = cols === 2 ? 5.85 : 11.9, rh = (4.9 - (rows - 1) * 0.15) / rows;
        list.forEach((it, i) => {
          const c = Math.floor(i / rows), rw = i % rows, x = 0.7 + c * (cw + 0.23), y = 2.0 + rw * (rh + 0.15);
          badge(slide, x, y + Math.max(0, (rh - 0.7) / 2), 0.7, glyphFor(it.icon, it.heading + ' ' + it.text, r));
          const body = it.heading ? [{ text: it.heading + '  ', options: { bold: true, color: txt, fontFace: t.head } }, { text: it.text, options: { color: muted } }] : [{ text: it.text, options: { color: txt } }];
          slide.addText(body, { x: x + 0.95, y, w: cw - 1.0, h: rh, valign: 'middle', fontFace: t.body, fontSize: fitPt(it.heading + ' ' + it.text, cw - 1.0, rh, 17, 10), margin: 0 });
        });
      },
      imageFocus(slide, s, idx) {
        const left = idx % 2 === 0;
        const px = left ? 0.6 : 7.6, pw = 5.15, ph = 6.3;
        slide.addImage({ data: illustrationPanel(t, glyphFor(s.icon, s.title + ' ' + s.lead, r), seed + idx, pw, ph), x: px, y: 0.6, w: pw, h: ph, shadow });
        const tx = left ? 6.25 : 0.7, tw = 6.4;
        if (s.kicker) slide.addText(s.kicker.toUpperCase(), { x: tx, y: 0.9, w: tw, h: 0.3, fontFace: t.body, fontSize: 11, bold: true, color: t.primary, charSpacing: 3, margin: 0 });
        slide.addText(s.title, { x: tx, y: 1.2, w: tw, h: 1.3, fontFace: t.head, fontSize: fitPt(s.title, tw, 1.3, 32, 20), bold: true, color: txt, valign: 'top', margin: 0 });
        let y = 2.65;
        if (s.lead) { const h = Math.min(1.9, linesFor(s.lead, tw, 18) * 0.34 + 0.1); slide.addText(s.lead, { x: tx, y, w: tw, h, fontFace: t.body, fontSize: 18, color: muted, valign: 'top', margin: 0 }); y += h + 0.2; }
        bulletsBox(slide, s.bullets, tx, y, tw, Math.min(6.7 - y, 0.6 + s.bullets.length * 0.95), 15);
      },
      stats(slide, s, idx) {
        header(slide, s, idx);
        const n = s.stats.length, gap = 0.35, cw = (11.93 - gap * (n - 1)) / n;
        s.stats.forEach((st, i) => {
          const x = 0.7 + i * (cw + gap), y = 2.35, h = 3.7;
          card(slide, x, y, cw, h);
          slide.addText(st.value, { x: x + 0.3, y: y + 0.45, w: cw - 0.6, h: 1.45, fontFace: t.head, fontSize: onePt(st.value, cw - 0.6, 64, 20), valign: 'bottom', bold: true, color: [t.primary, t.secondary, t.accent][i % 3], margin: 0 });
          slide.addShape(S.rect, { x: x + 0.32, y: y + 2.0, w: 0.6, h: 0.05, fill: { color: [t.primary, t.secondary, t.accent][i % 3] }, line: { width: 0, color: t.primary } });
          slide.addText(st.label, { x: x + 0.3, y: y + 2.15, w: cw - 0.6, h: 0.8, fontFace: t.body, fontSize: 18, bold: true, color: txt, valign: 'top', margin: 0 });
          if (st.note) slide.addText(st.note, { x: x + 0.3, y: y + 2.85, w: cw - 0.6, h: 0.75, fontFace: t.body, fontSize: fitPt(st.note, cw - 0.6, 0.75, 14, 10), color: muted, valign: 'top', margin: 0 });
        });
      },
      timeline(slide, s, idx) {
        header(slide, s, idx);
        const n = s.steps.length, x0 = 1.1, x1 = 12.2, y = 3.95, step = (x1 - x0) / (n - 1);
        slide.addShape(S.line, { x: x0, y, w: x1 - x0, h: 0, line: { color: t.primary, width: 2.5, transparency: 30 } });
        s.steps.forEach((st, i) => {
          const cx = x0 + i * step, up = i % 2 === 0, col = [t.primary, t.secondary, t.accent][i % 3];
          slide.addShape(S.ellipse, { x: cx - 0.32, y: y - 0.32, w: 0.64, h: 0.64, fill: { color: col }, line: { color: t.dark ? '0B1F24' : 'FFFFFF', width: 3 }, shadow });
          slide.addText(String(i + 1), { x: cx - 0.32, y: y - 0.32, w: 0.64, h: 0.64, align: 'center', valign: 'middle', fontFace: t.head, fontSize: 15, bold: true, color: t.dark ? '0B1F24' : 'FFFFFF', margin: 0 });
          const bw = Math.min(2.6, step * 0.95 + 0.3), bx = Math.max(0.5, Math.min(W - 0.5 - bw, cx - bw / 2));
          const by = up ? 1.95 : 4.55;
          if (st.heading) slide.addText(st.heading, { x: bx, y: by, w: bw, h: 0.5, align: 'center', fontFace: t.head, fontSize: 17, bold: true, color: txt, margin: 0, valign: 'middle' });
          slide.addText(st.text, { x: bx, y: by + (st.heading ? 0.5 : 0), w: bw, h: 1.35, align: 'center', fontFace: t.body, fontSize: fitPt(st.text, bw, 1.3, 14, 9), color: muted, margin: 0, valign: 'top' });
        });
      },
      process(slide, s, idx) {
        header(slide, s, idx);
        const n = s.steps.length, gap = 0.08, w = (11.93 - gap * (n - 1)) / n;
        s.steps.forEach((st, i) => {
          const x = 0.7 + i * (w + gap), col = mix(t.primary, t.secondary, n > 1 ? i / (n - 1) : 0);
          slide.addShape(i === 0 ? S.homePlate : S.chevron, { x, y: 2.1, w, h: 1.15, fill: { color: col }, line: { color: col, width: 0 }, shadow });
          slide.addText(st.heading || `Step ${i + 1}`, { x: x + 0.3, y: 2.1, w: w - 0.55, h: 1.15, align: 'center', valign: 'middle', fontFace: t.head, fontSize: fitPt(st.heading, w - 0.6, 1.0, 19, 10), bold: true, color: 'FFFFFF', margin: 0 });
          card(slide, x + 0.05, 3.55, w - 0.1, 2.7);
          slide.addText(String(i + 1).padStart(2, '0'), { x: x + 0.28, y: 3.72, w: 1.2, h: 0.5, fontFace: t.head, fontSize: 20, bold: true, color: col, margin: 0 });
          slide.addText(st.text, { x: x + 0.28, y: 4.28, w: w - 0.56, h: 1.85, fontFace: t.body, fontSize: fitPt(st.text, w - 0.56, 1.8, 17, 10), color: txt, valign: 'top', margin: 0 });
        });
      },
      cycle(slide, s, idx) {
        header(slide, s, idx);
        const n = s.steps.length, cx = 6.67, cy = 4.3, R = 2.05;
        slide.addShape(S.ellipse, { x: cx - R, y: cy - R, w: R * 2, h: R * 2, fill: { color: t.primary, transparency: 96 }, line: { color: t.primary, width: 2, dashType: 'dash', transparency: 40 } });
        slide.addShape(S.ellipse, { x: cx - 0.95, y: cy - 0.95, w: 1.9, h: 1.9, fill: { color: t.primary }, line: { color: t.primary, width: 0 }, shadow });
        slide.addText(s.center || s.title, { x: cx - 0.9, y: cy - 0.9, w: 1.8, h: 1.8, align: 'center', valign: 'middle', fontFace: t.head, fontSize: fitPt(s.center || s.title, 1.6, 1.5, 17, 9), bold: true, color: t.dark ? '0B1F24' : 'FFFFFF', margin: 0.05 });
        s.steps.forEach((st, i) => {
          const a = (n % 2 ? 0 : -Math.PI / 2 + Math.PI / n) + (i / n) * Math.PI * 2, nx = cx + Math.cos(a) * R, ny = cy + Math.sin(a) * R, col = [t.secondary, t.accent, t.primary][i % 3];
          badge(slide, nx - 0.38, ny - 0.38, 0.76, glyphFor(st.icon, st.heading + ' ' + st.text, r), col);
          const right = Math.cos(a) >= 0, bw = 3.5;
          const bx = right ? nx + 0.58 : nx - 0.58 - bw;
          slide.addText([{ text: (st.heading || `Stage ${i + 1}`) + '\n', options: { bold: true, color: txt, fontFace: t.head, fontSize: 16 } }, { text: st.text, options: { color: muted, fontSize: 12.5 } }],
            { x: bx, y: Math.max(1.85, Math.min(5.9, ny - 0.55)), w: bw, h: 1.1, align: right ? 'left' : 'right', valign: 'middle', fontFace: t.body, margin: 0 });
        });
      },
      comparison(slide, s, idx) {
        header(slide, s, idx);
        [[s.left, 0.7, t.primary], [s.right, 7.03, t.secondary]].forEach(([side, x, col]) => {
          card(slide, x, 2.0, 5.6, 4.75);
          slide.addShape(S.roundRect, { x, y: 2.0, w: 5.6, h: 0.8, rectRadius: 0.16, fill: { color: col }, line: { color: col, width: 0 } });
          slide.addText(side.heading, { x: x + 0.3, y: 2.0, w: 5.0, h: 0.8, valign: 'middle', fontFace: t.head, fontSize: fitPt(side.heading, 5.0, 0.7, 20, 13), bold: true, color: t.dark ? '0B1F24' : 'FFFFFF', margin: 0 });
          bulletsBox(slide, side.bullets, x + 0.35, 3.1, 4.95, 3.4, 14, ICONS.check);
        });
        slide.addShape(S.ellipse, { x: 6.17, y: 3.9, w: 1.0, h: 1.0, fill: { color: t.accent }, line: { color: t.dark ? '0B1F24' : 'FFFFFF', width: 3 }, shadow });
        slide.addText('VS', { x: 6.17, y: 3.9, w: 1.0, h: 1.0, align: 'center', valign: 'middle', fontFace: t.head, fontSize: 16, bold: true, color: '1A1A1A', margin: 0 });
      },
      quote(slide, s, idx) {
        slide.background = { data: background(t, 'section', seed + 99, null) };
        slide.addImage({ data: iconImg(ICONS.quote, t.primary, 256), x: 0.9, y: 0.9, w: 1.3, h: 1.3 });
        slide.addText(s.quote, { x: 1.2, y: 2.2, w: 10.6, h: 3.2, fontFace: 'Georgia', italic: true, fontSize: fitPt(s.quote, 10.4, 3.1, 34, 20), color: txt, valign: 'middle', margin: 0 });
        if (s.attribution) {
          slide.addShape(S.rect, { x: 1.22, y: 5.75, w: 0.7, h: 0.05, fill: { color: t.accent }, line: { color: t.accent, width: 0 } });
          slide.addText(s.attribution, { x: 2.1, y: 5.55, w: 9, h: 0.45, fontFace: t.body, fontSize: 14, color: muted, margin: 0 });
        }
      },
      chart(slide, s, idx) {
        header(slide, s, idx);
        const ch = s.chart, type = { bar: 'bar', column: 'bar', line: 'line', doughnut: 'doughnut', pie: 'pie' }[ch.type];
        const round = type === 'doughnut' || type === 'pie';
        const data = (round ? ch.series.slice(0, 1) : ch.series).map(se => ({ name: se.name, labels: ch.labels, values: ch.labels.map((_, i) => se.values[i] || 0) }));
        const colors = [t.primary, t.secondary, t.accent, mix(t.primary, t.secondary, 0.5), mix(t.secondary, t.accent, 0.5), mix(t.primary, 'FFFFFF', 0.4)];
        const hasSide = s.bullets.length > 0;
        card(slide, 0.7, 1.95, hasSide ? 7.3 : 11.93, 4.85);
        slide.addChart(pptx.ChartType ? pptx.ChartType[type] : pptx.charts[type.toUpperCase()], data, {
          x: 0.9, y: 2.1, w: hasSide ? 6.9 : 11.5, h: 4.55, chartColors: colors, barDir: ch.type === 'bar' ? 'bar' : 'col',
          showLegend: data.length > 1 || round, legendPos: 'b', legendFontSize: 11, legendColor: muted, legendFontFace: t.body,
          catAxisLabelColor: muted, valAxisLabelColor: muted, catAxisLabelFontFace: t.body, valAxisLabelFontFace: t.body, catAxisLabelFontSize: 11, valAxisLabelFontSize: 10,
          valGridLine: { color: t.dark ? '3A4A50' : 'E3E8EE', size: 0.5 }, catGridLine: { style: 'none' }, valAxisLineShow: false,
          showValue: round || data.length === 1, dataLabelColor: round ? 'FFFFFF' : txt, dataLabelFontSize: 10, dataLabelFormatCode: ch.unit ? `0"${ch.unit}"` : '#,##0.##',
          holeSize: 58, lineSize: 3, lineDataSymbolSize: 8, barGapWidthPct: 60,
        });
        if (hasSide) { card(slide, 8.3, 1.95, 4.33, 4.85); slide.addText('KEY INSIGHTS', { x: 8.6, y: 2.2, w: 3.8, h: 0.35, fontFace: t.body, fontSize: 11, bold: true, color: t.primary, charSpacing: 2, margin: 0 }); bulletsBox(slide, s.bullets, 8.6, 2.75, 3.75, Math.min(3.8, 0.5 + s.bullets.length * 1.1), 13, ICONS.idea); }
      },
      table(slide, s, idx) {
        header(slide, s, idx);
        const cols = s.columns.length, rows = [s.columns.map(c => ({ text: c, options: { bold: true, color: 'FFFFFF', fill: { color: t.primary }, fontFace: t.head } }))];
        s.rows.forEach((rw, i) => rows.push(s.columns.map((_, j) => ({ text: str(rw[j] || ''), options: { color: txt, fill: { color: i % 2 ? (t.dark ? '1E3036' : mix(t.bg[1], 'FFFFFF', 0.5)) : (t.dark ? '16262B' : 'FFFFFF') } } }))));
        const rowH = Math.max(0.5, Math.min(0.85, 4.7 / (s.rows.length + 1)));
        slide.addTable(rows, { x: 0.7, y: 2.0, w: 11.93, colW: Array(cols).fill(11.93 / cols), rowH, fontFace: t.body, fontSize: s.rows.length > 5 ? 13 : (cols > 4 ? 14 : 16), border: { type: 'solid', pt: 0.5, color: t.dark ? '2E4248' : 'D8E0E8' }, valign: 'middle', margin: [0.06, 0.16, 0.06, 0.16], autoPage: false });
      },
      closing(slide, s, idx) {
        slide.background = { data: background(t, 'closing', seed + 5, glyphFor(s.icon, spec.title, r)) };
        const list = s.bullets.slice(0, 5);
        slide.addText(s.title || 'Thank you', { x: 0.8, y: list.length ? 0.9 : 2.3, w: 7.5, h: 1.3, fontFace: t.head, fontSize: 44, bold: true, color: txt, margin: 0, valign: 'top' });
        if (s.lead) slide.addText(s.lead, { x: 0.8, y: list.length ? 2.2 : 3.7, w: 7, h: 0.8, fontFace: t.body, fontSize: 18, color: muted, margin: 0, valign: 'top' });
        if (list.length) { card(slide, 0.8, 3.1, 7.2, 3.6); slide.addText('KEY TAKEAWAYS', { x: 1.15, y: 3.35, w: 5, h: 0.35, fontFace: t.body, fontSize: 11, bold: true, color: t.primary, charSpacing: 2, margin: 0 }); bulletsBox(slide, list, 1.15, 3.85, 6.5, 2.65, 14, ICONS.check); }
      },
    };

    return function renderAll(onProgress) {
      let secNo = 0;
      spec.slides.forEach((s, idx) => {
        const slide = pptx.addSlide();
        const hero = ['cover', 'section', 'closing', 'quote'].includes(s.layout);
        if (!hero) slide.background = { data: background(t, 'content', seed + (idx % 3), null) };
        if (s.layout === 'section') secNo++;
        try { (L[s.layout] || L.split)(slide, s, idx, secNo); }
        catch (e) { console.warn('[deck] layout failed, using split', s.layout, e); L.split(slide, Object.assign({}, s, { bullets: s.bullets.length ? s.bullets : [s.lead || s.title] }), idx); }
        if (!hero) footer(slide, idx);
        if (s.notes) slide.addNotes(s.notes);
        s._transition = s.layout === 'cover' ? 'fade' : s.layout === 'section' ? 'push' : s.layout === 'closing' ? 'fade' : 'fade';
        if (onProgress) onProgress(0.3 + 0.6 * ((idx + 1) / spec.slides.length), `Designing slide ${idx + 1} of ${spec.slides.length}…`);
      });
    };
  }

  // Slide transitions: PptxGenJS doesn't write them, so they're injected
  // into each slide's XML (valid OOXML; PowerPoint, Keynote, Google Slides).
  //
  // The same pass repairs image file names. PptxGenJS stores every slide
  // BACKGROUND as "….png" whatever the data is, and the backgrounds here are
  // JPEG (PNG would be several MB per slide). A JPEG labelled .png makes
  // PowerPoint for Android refuse the whole file and other apps drop the
  // image, so each media file is renamed to match its real content and every
  // relationship that points at it is updated.
  async function fixMediaNames(zip) {
    const renames = [];
    const media = zip.file(/^ppt\/media\/[^/]+$/);
    for (const f of media) {
      const head = await f.async('uint8array');
      const real = head[0] === 0x89 && head[1] === 0x50 ? 'png' : (head[0] === 0xFF && head[1] === 0xD8 ? 'jpg' : (head[0] === 0x47 && head[1] === 0x49 ? 'gif' : null));
      const dot = f.name.lastIndexOf('.');
      const ext = f.name.slice(dot + 1).toLowerCase();
      const same = real === ext || (real === 'jpg' && ext === 'jpeg');
      if (!real || same) continue;
      const to = f.name.slice(0, dot + 1) + real;
      zip.file(to, head, { binary: true });
      zip.remove(f.name);
      renames.push([f.name.split('/').pop(), to.split('/').pop()]);
    }
    if (!renames.length) return;
    for (const rel of zip.file(/\.rels$/)) {
      let xml = await rel.async('string');
      let changed = false;
      renames.forEach(([from, to]) => { if (xml.includes('/' + from + '"')) { xml = xml.split('/' + from + '"').join('/' + to + '"'); changed = true; } });
      if (changed) zip.file(rel.name, xml);
    }
    // jpg / jpeg / png / gif are all declared as Default types by PptxGenJS; make sure of jpg.
    const ctFile = zip.file('[Content_Types].xml');
    if (ctFile) {
      let ct = await ctFile.async('string');
      if (!/Extension="jpg"/i.test(ct)) { ct = ct.replace('<Default ', '<Default Extension="jpg" ContentType="image/jpeg"/><Default '); zip.file('[Content_Types].xml', ct); }
    }
  }

  async function addTransitions(blob, slides, withTransitions) {
    const JSZipLib = root.JSZip;
    if (!JSZipLib) return blob;
    try {
      const zip = await JSZipLib.loadAsync(blob);
      await fixMediaNames(zip);
      if (withTransitions !== false) await Promise.all(slides.map(async (s, i) => {
        const path = `ppt/slides/slide${i + 1}.xml`;
        const f = zip.file(path); if (!f) return;
        let xml = await f.async('string');
        if (xml.includes('<p:transition')) return;
        const tr = s._transition === 'push' ? '<p:transition spd="slow"><p:push dir="u"/></p:transition>' : '<p:transition spd="med"><p:fade/></p:transition>';
        // Schema order inside <p:sld>: cSld, clrMapOvr, transition, timing, extLst. Only look
        // AFTER the slide content: tables carry their own <p:extLst> inside <p:cSld>, and
        // putting the transition there makes PowerPoint reject the whole file.
        const body = Math.max(xml.lastIndexOf('</p:cSld>'), xml.lastIndexOf('</p:clrMapOvr>'), xml.lastIndexOf('<p:clrMapOvr'));
        const at = ['<p:timing', '<p:extLst', '</p:sld>'].map(k => xml.indexOf(k, Math.max(0, body))).filter(k => k > 0).sort((a, b) => a - b)[0];
        if (!(at > 0)) return;
        xml = xml.slice(0, at) + tr + xml.slice(at);
        zip.file(path, xml);
      }));
      return await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', compression: 'DEFLATE' });
    } catch (e) { console.warn('[deck] transitions skipped', e); return blob; }
  }

  async function ensureFonts() {
    try { if (document.fonts && document.fonts.load) await Promise.all([document.fonts.load(`900 64px ${ICON_FONT}`), document.fonts.ready]); } catch (e) { /* glyphs fall back */ }
  }

  // ===================================================================
  // Public API
  // ===================================================================
  function buildPrompt(input) {
    input = input || {};
    const count = Math.max(6, Math.min(20, parseInt(input.slideCount, 10) || 10));
    const styles = Object.entries(THEMES).map(([id, th]) => `${id} (${th.mood})`).join('; ');
    const system = `You are a world-class presentation designer and clinical educator creating a premium, Gamma-quality slide deck for rehabilitation and healthcare professionals.

Return ONLY valid JSON (no markdown fences, no commentary) with this shape:
{"title": string, "subtitle": string, "style": one of [${Object.keys(THEMES).join(', ')}], "audience": string,
 "slides": [ { "layout": string, ...fields } ]}

Layouts and their fields (use the one that best fits each idea, and VARY them — never the same layout twice in a row):
- "cover": title, subtitle, kicker (2-4 words), icon
- "agenda": title, items:[string]  (3-8)
- "section": title, lead (one sentence), icon — use before each major part
- "split": title, kicker, lead (1-2 sentence insight), bullets:[string] (3-5, each <= 16 words)
- "cards": title, kicker, items:[{heading, text, icon}] (2-4; text <= 22 words)
- "iconList": title, items:[{heading, text, icon}] (3-8)
- "imageFocus": title, kicker, lead, bullets (2-4), icon — a hero idea with a big illustration
- "stats": title, stats:[{value, label, note}] (2-4) — ONLY real, well-established figures or figures present in the source; never invent numbers
- "timeline": title, steps:[{heading, text}] (3-6, chronological)
- "process": title, steps:[{heading, text}] (3-5, sequential how-to)
- "cycle": title, center (2-3 words), steps:[{heading, text, icon}] (3-6, a repeating loop)
- "comparison": title, left:{heading, bullets}, right:{heading, bullets}
- "quote": quote, attribution — only real, correctly attributed quotes, otherwise skip
- "chart": title, chart:{type: bar|column|line|doughnut|pie, labels:[...], series:[{name, values:[numbers]}], unit}, bullets (2-3 insights) — ONLY with real data from the source
- "table": title, columns:[...], rows:[[...]] (<= 6 rows)
- "closing": title, lead, bullets (3-5 key takeaways)
Every slide may also have "notes": 2-4 sentences of speaker notes.
"icon" must be one of: ${Object.keys(ICONS).join(', ')}.

Rules: ${count} slides total including cover and closing. Tell a story: hook → context → core content (grouped into sections with "section" slides for decks of 10+) → application → takeaways. Keep on-slide text short, specific and scannable; put detail in notes. Use accurate, current, evidence-informed clinical content; if a claim is uncertain, phrase it cautiously. Never include patient-identifying details. Pick the "style" that suits the topic: ${styles}.`;
    const parts = [];
    if (input.topic) parts.push(`TOPIC / REQUEST:\n${input.topic}`);
    if (input.content) parts.push(`SOURCE CONTENT (build the deck from this; keep facts faithful):\n${String(input.content).slice(0, 24000)}`);
    if (input.audience) parts.push(`AUDIENCE: ${input.audience}`);
    if (input.instructions) parts.push(`EXTRA INSTRUCTIONS: ${input.instructions}`);
    if (input.style && THEMES[input.style]) parts.push(`Use style: ${input.style}`);
    parts.push(`Create the ${count}-slide deck JSON now.`);
    return { system, user: parts.join('\n\n'), maxTokens: 900 + count * 420 };
  }

  async function render(specOrText, opts) {
    opts = opts || {};
    const PptxGen = root.PptxGenJS;
    if (!PptxGen) throw new Error('Presentation library not loaded');
    const spec = plan(typeof specOrText === 'string' ? parseSpec(specOrText) : normalize(specOrText));
    const themeId = chooseTheme(spec, opts.style);
    const t = THEMES[themeId];
    const seed = hashStr(spec.title + themeId + (opts.seed || ''));
    if (opts.onProgress) opts.onProgress(0.25, 'Preparing the design system…');
    await ensureFonts();
    const pptx = new PptxGen();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.author = spec.presenter || 'Rehablix';
    pptx.company = 'Rehablix';
    pptx.title = spec.title;
    pptx.subject = spec.subtitle || spec.title;
    pptx.theme = { headFontFace: t.head, bodyFontFace: t.body };
    renderer(pptx, t, spec, seed)(opts.onProgress);
    if (opts.onProgress) opts.onProgress(0.93, 'Adding transitions…');
    let blob = await pptx.write({ outputType: 'blob' });
    blob = await addTransitions(blob, spec.slides, opts.transitions);   // also repairs image file names (see fixMediaNames)
    const fileName = (spec.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'Rehablix deck') + '.pptx';
    return { blob, fileName, spec, theme: themeId, slides: spec.slides.map(s => ({ layout: s.layout, title: s.title || s.quote || '' })) };
  }

  async function renderBase64(specOrText, opts) {
    const res = await render(specOrText, opts);
    const buf = new Uint8Array(await res.blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { base64: btoa(bin), fileName: res.fileName, theme: res.theme, title: res.spec.title, slides: res.slides };
  }

  // ===================================================================
  // HTML preview — the SAME layout code drives a tiny recorder that mimics
  // the PptxGenJS calls and paints each slide as HTML (cqw units, so a
  // thumbnail scales with its container). Used for in-app slide previews.
  // ===================================================================
  function htmlDeck() {
    const IN = 100 / W; // 1 inch in cqw
    const u = (v) => (v * IN).toFixed(3) + 'cqw';
    const pt = (v) => ((v / 72) * IN).toFixed(3) + 'cqw';
    const col = (c, tr) => (c == null ? 'transparent' : rgba(c, 1 - (tr || 0) / 100));
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
    const box = (o) => `left:${u(o.x || 0)};top:${u(o.y || 0)};width:${u(o.w || 0)};height:${u(o.h || 0)};`;
    const slides = [];
    const api = {
      ShapeType: { roundRect: 'roundRect', ellipse: 'ellipse', rect: 'rect', line: 'line', chevron: 'chevron', homePlate: 'homePlate' },
      ChartType: { bar: 'bar', line: 'line', doughnut: 'doughnut', pie: 'pie' },
      addSlide() {
        const parts = []; const sl = { bg: '' };
        const slide = {
          set background(b) { sl.bg = b && b.data ? `background:url(data:${b.data}) center/cover;` : `background:${col(b && b.color)};`; },
          addShape(type, o) {
            const fill = o.fill ? col(o.fill.color, o.fill.transparency) : 'transparent';
            const ln = o.line && o.line.width ? `${Math.max(1, o.line.width)}px ${o.line.dashType ? 'dashed' : 'solid'} ${col(o.line.color, o.line.transparency)}` : '0';
            const sh = o.shadow ? `box-shadow:0 ${u(0.06)} ${u(0.18)} rgba(0,0,0,${o.shadow.opacity});` : '';
            let extra = '';
            if (type === 'ellipse') extra = 'border-radius:50%;';
            else if (type === 'roundRect') extra = `border-radius:${u(o.rectRadius || 0.1)};`;
            else if (type === 'chevron') extra = 'clip-path:polygon(0 0,82% 0,100% 50%,82% 100%,0 100%,18% 50%);';
            else if (type === 'homePlate') extra = 'clip-path:polygon(0 0,82% 0,100% 50%,82% 100%,0 100%);';
            if (type === 'line') parts.push(`<div style="position:absolute;${box(o)}height:0;border-top:${ln};"></div>`);
            else parts.push(`<div style="position:absolute;box-sizing:border-box;${box(o)}background:${fill};border:${ln};${extra}${sh}"></div>`);
          },
          addText(text, o) {
            const runs = Array.isArray(text) ? text : [{ text: String(text), options: {} }];
            const html = runs.map(rn => { const ro = rn.options || {}; return `<span style="${ro.bold ? 'font-weight:700;' : ''}${ro.color ? 'color:' + col(ro.color) + ';' : ''}${ro.fontSize ? 'font-size:' + pt(ro.fontSize) + ';' : ''}${ro.fontFace ? `font-family:'${ro.fontFace}',sans-serif;` : ''}">${esc(rn.text).replace(/\n/g, '<br>')}</span>`; }).join('');
            const jc = { top: 'flex-start', middle: 'center', bottom: 'flex-end' }[o.valign || 'middle'];
            parts.push(`<div style="position:absolute;display:flex;flex-direction:column;justify-content:${jc};overflow:hidden;${box(o)}text-align:${o.align || 'left'};font-family:'${o.fontFace || 'Segoe UI'}',sans-serif;font-size:${pt(o.fontSize || 14)};line-height:${(o.lineSpacingMultiple || 1) * 1.2};color:${col(o.color || '000000', o.transparency)};${o.bold ? 'font-weight:700;' : ''}${o.italic ? 'font-style:italic;' : ''}${o.charSpacing ? 'letter-spacing:' + pt(o.charSpacing) + ';' : ''}"><div>${html}</div></div>`);
          },
          addImage(o) { parts.push(`<img alt="" src="data:${o.data}" style="position:absolute;${box(o)}${o.shadow ? `filter:drop-shadow(0 ${u(0.08)} ${u(0.2)} rgba(0,0,0,.3));` : ''}">`); },
          addChart(type, data, o) {
            const colors = o.chartColors || ['888888'], se = data[0] || { values: [], labels: [] }, max = Math.max(1, ...data.flatMap(d => d.values));
            let inner;
            if (type === 'doughnut' || type === 'pie') {
              const sum = se.values.reduce((a, b) => a + b, 0) || 1; let acc = 0;
              const stops = se.values.map((v, i) => { const a = acc; acc += v / sum * 100; return `${col(colors[i % colors.length])} ${a}% ${acc}%`; }).join(',');
              inner = `<div style="margin:auto;height:80%;aspect-ratio:1;border-radius:50%;background:conic-gradient(${stops});${type === 'doughnut' ? '-webkit-mask:radial-gradient(circle,transparent 38%,#000 39%);mask:radial-gradient(circle,transparent 38%,#000 39%);' : ''}"></div>`;
            } else {
              inner = `<div style="display:flex;align-items:flex-end;gap:3%;height:86%;width:92%;margin:auto;">${se.labels.map((lb, i) => `<div style="flex:1;display:flex;gap:6%;align-items:flex-end;height:100%;">${data.map((d, k) => `<div style="flex:1;height:${(d.values[i] / max * 100).toFixed(1)}%;background:${col(colors[k % colors.length])};border-radius:${u(0.05)} ${u(0.05)} 0 0;"></div>`).join('')}</div>`).join('')}</div>`;
            }
            parts.push(`<div style="position:absolute;display:flex;${box(o)}">${inner}</div>`);
          },
          addTable(rows, o) {
            parts.push(`<table style="position:absolute;left:${u(o.x)};top:${u(o.y)};width:${u(o.w)};border-collapse:collapse;font-family:'${o.fontFace}',sans-serif;font-size:${pt(o.fontSize || 12)};">${rows.map(rw => `<tr>${rw.map(c => `<td style="height:${u(o.rowH || 0.4)};padding:${u(0.06)} ${u(0.16)};border:1px solid ${col(o.border && o.border.color)};background:${col(c.options.fill && c.options.fill.color)};color:${col(c.options.color)};${c.options.bold ? 'font-weight:700;' : ''}">${esc(c.text)}</td>`).join('')}</tr>`).join('')}</table>`);
          },
          addNotes() {},
        };
        slides.push({ sl, parts });
        return slide;
      },
    };
    api.toHtml = () => slides.map(s => `<div class="rx-deck-slide" style="position:relative;width:100%;aspect-ratio:${W}/${H};container-type:inline-size;overflow:hidden;${s.sl.bg}">${s.parts.join('')}</div>`);
    return api;
  }

  /** Renders every slide as an HTML string (same layouts as the PPTX). */
  async function previewHtml(specOrText, opts) {
    opts = opts || {};
    const spec = plan(typeof specOrText === 'string' ? parseSpec(specOrText) : normalize(specOrText));
    const themeId = chooseTheme(spec, opts.style), t = THEMES[themeId], seed = hashStr(spec.title + themeId + (opts.seed || ''));
    await ensureFonts();
    const rec = htmlDeck();
    renderer(rec, t, spec, seed)(opts.onProgress);
    return { slides: rec.toHtml(), spec, theme: themeId };
  }

  // Cover preview (studio / Lixa card thumbnail) — a real render of the
  // deck's generated cover art with its title set on top.
  async function coverPreview(spec, styleId, px) {
    await ensureFonts();
    spec = typeof spec === 'string' ? parseSpec(spec) : normalize(spec);
    const id = chooseTheme(spec, styleId), t = THEMES[id], seed = hashStr(spec.title + id);
    const w = px || 640, h = w * H / W, c = canvas(w, h), ctx = c.getContext('2d');
    const img = new Image();
    await new Promise((res) => { img.onload = res; img.onerror = res; img.src = 'data:' + background(t, 'cover', seed, glyphFor((spec.slides[0] || {}).icon, spec.title)); });
    ctx.drawImage(img, 0, 0, w, h);
    ctx.fillStyle = '#' + t.text; ctx.font = `700 ${w * 0.052}px "${t.head}", "Segoe UI", sans-serif`;
    const words = spec.title.split(' '); let line = '', y = h * 0.42; const maxW = w * 0.55;
    words.forEach(wd => { const test = line ? line + ' ' + wd : wd; if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, w * 0.06, y); line = wd; y += w * 0.06; } else line = test; });
    ctx.fillText(line, w * 0.06, y);
    return c.toDataURL('image/jpeg', 0.85);
  }

  root.RehablixDeck = { THEMES, ICONS, LAYOUTS, buildPrompt, parseSpec, normalize, plan, chooseTheme, render, renderBase64, previewHtml, coverPreview, version: 1 };
})(typeof window !== 'undefined' ? window : this);
