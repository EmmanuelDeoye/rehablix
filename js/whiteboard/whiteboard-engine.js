// js/whiteboard/whiteboard-engine.js — Lixa's Whiteboard: visual, step-by-step explanations.
//
// ONE file for both platforms (as js/deck/deck-engine.js): the web app loads it here, and the Android app ships a
// byte-for-byte copy in app/src/main/assets/whiteboard/ and runs it in a WebView (whiteboard/WhiteboardWeb.kt).
// After editing this file, copy it to the Android assets.
//
// What it does (no network, no AI calls of its own):
//   * the board model: { title, subject, steps: [{ title, say, items: [...] }] } on a 1000×640 canvas;
//   * the prompts the apps send to their AI (buildPrompt / buildRevisePrompt) and parseBoard() for the reply;
//   * a library of rehab diagrams (knee, shoulder, spine, brain, gait cycle…) with named parts the AI labels;
//   * mount(): the interactive board — steps, play, pen, shapes, arrows, handwritten text, sticky notes,
//     diagrams, move, edit, delete, undo;
//   * toSVG() / toPNG(): the board (up to a step) as an image, for export and thumbnails.
(function (root) {
  'use strict';

  const W = 1000, H = 640;
  const HAND = "'Caveat','Patrick Hand','Comic Neue','Dancing Script','Segoe Print',cursive";
  const SANS = "'Inter','Segoe UI',Roboto,Arial,sans-serif";
  const COLORS = { ink: '#1f2937', teal: '#0d9488', blue: '#2563eb', red: '#dc2626', orange: '#ea580c', purple: '#7c3aed', green: '#16a34a' };
  const COLOR_KEYS = Object.keys(COLORS);
  const NOTE_FILL = { ink: '#fef3c7', teal: '#ccfbf1', blue: '#dbeafe', red: '#fee2e2', orange: '#ffedd5', purple: '#ede9fe', green: '#dcfce7' };
  const TYPES = ['box', 'circle', 'arrow', 'line', 'text', 'note', 'diagram', 'ink', 'image'];
  const MAX_STEPS = 12, MAX_ITEMS = 40, MAX_IMAGES = 4;

  // ------------------------------------------------------------------ the diagram library
  // Each drawing lives in its own box (w × h) and is a list of shapes; `parts` are the named points the AI labels.
  const ST = {
    bone: ['#f5ecd9', '#8a7454'], cart: ['#bfe3f5', '#4a90b8'], muscle: ['#f28b82', '#b3473f'], tendon: ['#f4e3b1', '#b8a165'],
    lig: ['#c9e7c4', '#5d9a55'], nerve: ['#ffe27a', '#c9a400'], organ: ['#f7c6c7', '#b06a6c'], skin: ['#fde7d4', '#c8a083'],
    blue: ['#cfe0fc', '#3b6fd1'], purple: ['#e4d7fb', '#7a5bb5'], white: ['#ffffff', '#6b7280'], none: ['none', '#374151'],
  };
  const P = (d, s, o) => Object.assign({ k: 'path', d, s }, o || {});
  const E = (cx, cy, rx, ry, s, o) => Object.assign({ k: 'ellipse', cx, cy, rx, ry, s }, o || {});
  const L = (d, color, width, o) => Object.assign({ k: 'path', d, s: 'none', stroke: color, sw: width }, o || {});
  const T = (x, y, text, o) => Object.assign({ k: 'text', x, y, text }, o || {});

  function spine() {
    const shapes = [], parts = {};
    const segs = [['cervical', 7, 8, 22, -14], ['thoracic', 12, 10, 26, 20], ['lumbar', 5, 13, 34, -16]];
    let y = 8;
    segs.forEach(([name, n, h, w, bulge]) => {
      const top = y;
      for (let i = 0; i < n; i++) {
        const s = n > 1 ? i / (n - 1) : 0;
        const cx = 80 + bulge * Math.sin(Math.PI * s);
        shapes.push(P(`M${cx - w / 2} ${y} h${w} a3 3 0 0 1 3 3 v${h - 6} a3 3 0 0 1 -3 3 h${-w} a3 3 0 0 1 -3 -3 v${-(h - 6)} a3 3 0 0 1 3 -3 Z`, 'bone'));
        shapes.push(P(`M${cx + w / 2} ${y + 2} l${10 + w / 5} ${h / 2 + 2} l${-(10 + w / 5)} ${h / 2 - 3} Z`, 'bone'));
        if (name === 'lumbar' && i === 3) { parts['intervertebral disc'] = [cx, y + h + 1.5]; parts['spinous process'] = [cx + w / 2 + 8, y + h / 2]; parts['vertebral body'] = [cx, y + h / 2]; }
        y += h;
        shapes.push(P(`M${cx - w / 2 + 1} ${y} h${w - 2} v3 h${-(w - 2)} Z`, 'cart'));
        y += 3;
      }
      parts[name] = parts[name + ' spine'] = [80 + bulge, (top + y) / 2];
    });
    shapes.push(P(`M${80 - 22} ${y + 2} L${80 + 26} ${y + 2} L${80 + 14} ${y + 52} L${80 - 4} ${y + 56} Z`, 'bone'));
    parts.sacrum = [82, y + 26];
    shapes.push(P(`M${80 - 2} ${y + 58} l12 2 l-4 14 l-8 -2 Z`, 'bone'));
    parts.coccyx = [84, y + 66];
    shapes.push(T(8, 12, 'Anterior', { size: 9, fill: '#6b7280' }), T(118, 12, 'Posterior', { size: 9, fill: '#6b7280' }));
    return { label: 'Spine (side view)', w: 160, h: y + 80, shapes, parts };
  }

  function hand() {
    const shapes = [], parts = {};
    const bone = (x1, y1, x2, y2, w) => { shapes.push(L(`M${x1} ${y1} L${x2} ${y2}`, '#8a7454', w + 3, { cap: 'round' })); shapes.push(L(`M${x1} ${y1} L${x2} ${y2}`, '#f5ecd9', w, { cap: 'round' })); };
    shapes.push(P('M70 262 L84 214 L100 214 L94 262 Z', 'bone'), P('M108 262 L106 214 L130 214 L136 262 Z', 'bone'));
    parts.radius = [118, 248]; parts.ulna = [84, 248];
    [[78, 200], [96, 196], [114, 196], [130, 202], [84, 184], [102, 180], [120, 182], [136, 188]].forEach(([x, y]) => shapes.push(E(x, y, 9, 8, 'bone')));
    parts.carpals = [106, 190];
    [[-1, 66], [0, 90], [1, 114], [2, 136]].forEach(([i, bx], n) => {
      const spread = (i - 0.5) * 7, mcpY = 150, len = [44, 48, 45, 38][n];
      const mx = bx + spread * 0.6, px = bx + spread * 1.4, dx = bx + spread * 2, tx = bx + spread * 2.5;
      bone(bx, 176, mx, mcpY, 9);
      bone(mx, mcpY, px, mcpY - len * 0.8, 8); bone(px, mcpY - len * 0.8, dx, mcpY - len * 1.35, 7); bone(dx, mcpY - len * 1.35, tx, mcpY - len * 1.7, 6);
      if (n === 1) { parts['MCP joint'] = [mx, mcpY]; parts['PIP joint'] = [px, mcpY - len * 0.8]; parts['DIP joint'] = [dx, mcpY - len * 1.35]; parts.phalanges = [px, mcpY - len * 1.05]; parts.metacarpals = [(bx + mx) / 2, 163]; }
    });
    bone(60, 186, 38, 150, 10); bone(38, 150, 24, 120, 8); bone(24, 120, 16, 96, 7);
    parts.thumb = [30, 132]; parts['CMC joint (thumb)'] = [58, 184];
    return { label: 'Hand (bones, back view)', w: 170, h: 270, shapes, parts };
  }

  const DIAGRAMS = {
    knee: {
      label: 'Knee joint (front view)', w: 200, h: 300,
      shapes: [
        P('M78 0 H122 V140 C150 150 160 175 150 196 C140 210 118 206 104 196 L100 194 L96 196 C82 206 60 210 50 196 C40 175 50 150 78 140 Z', 'bone'),
        P('M52 222 C60 214 140 214 148 222 C152 236 138 246 124 250 V300 H80 V250 C62 246 48 236 52 222 Z', 'bone'),
        P('M152 248 C160 244 168 250 166 258 L162 300 H152 L154 262 C150 258 148 252 152 248 Z', 'bone'),
        P('M54 214 Q75 206 96 212 L96 218 Q75 214 56 220 Z', 'cart'), P('M104 212 Q125 206 146 214 L144 220 Q125 214 104 218 Z', 'cart'),
        L('M96 196 L108 222', '#5d9a55', 5), L('M106 196 L94 222', '#3f7a38', 5),
        L('M50 188 L56 242', '#5d9a55', 6), L('M150 190 L158 252', '#5d9a55', 6),
        P('M90 108 H110 L106 152 H94 Z', 'tendon', { op: 0.9 }), P('M94 190 H106 L110 238 H90 Z', 'tendon', { op: 0.85 }),
        E(100, 172, 18, 22, 'bone'),
      ],
      parts: { femur: [100, 60], tibia: [100, 278], fibula: [159, 285], patella: [100, 172], acl: [104, 204], pcl: [97, 214], 'anterior cruciate ligament': [104, 204], 'posterior cruciate ligament': [97, 214], 'medial meniscus': [70, 213], 'lateral meniscus': [130, 213], meniscus: [70, 213], mcl: [53, 215], lcl: [154, 221], 'medial collateral ligament': [53, 215], 'lateral collateral ligament': [154, 221], 'quadriceps tendon': [100, 126], 'patellar tendon': [100, 220], 'tibial tuberosity': [100, 242], 'articular cartilage': [75, 205] },
    },
    shoulder: {
      label: 'Shoulder (front view)', w: 240, h: 230,
      shapes: [
        P('M120 60 L200 50 L190 200 L130 120 Z', 'bone'),
        P('M20 40 C60 30 110 30 150 42 L152 52 C110 42 60 42 22 52 Z', 'bone'),
        P('M150 40 C175 34 200 40 205 52 L196 60 C180 52 165 50 152 54 Z', 'bone'),
        P('M128 62 C118 56 106 62 110 72 L122 72 Z', 'bone'),
        P('M92 120 H124 L120 228 H96 Z', 'bone'), E(104, 100, 30, 30, 'bone'),
        P('M126 78 Q134 100 126 122 L132 122 Q140 100 132 78 Z', 'cart'),
        P('M200 62 C160 62 120 66 96 76 L100 86 C125 78 160 74 196 74 Z', 'muscle', { op: 0.85 }),
        P('M190 120 C160 110 130 108 118 112 L120 122 C140 120 165 124 186 134 Z', 'muscle', { op: 0.85 }),
        P('M150 44 C110 40 64 70 66 130 C70 150 84 170 100 176 L106 166 C92 150 86 130 90 110 C96 80 120 62 150 56 Z', 'muscle', { op: 0.5 }),
        L('M112 72 C104 100 104 130 108 172', '#b8a165', 4),
        E(145, 61, 16, 5, 'blue', { op: 0.8 }),
      ],
      parts: { clavicle: [70, 40], acromion: [186, 46], scapula: [176, 140], 'humeral head': [96, 100], humerus: [108, 205], glenoid: [131, 100], 'glenohumeral joint': [124, 100], supraspinatus: [170, 68], subscapularis: [160, 121], deltoid: [72, 120], 'biceps tendon': [105, 140], 'subacromial bursa': [145, 61], 'rotator cuff': [150, 70], coracoid: [114, 66] },
    },
    spine: spine(),
    vertebra: {
      label: 'Lumbar vertebra & disc (from above)', w: 220, h: 200,
      shapes: [
        P('M72 104 L20 96 L20 110 L70 118 Z', 'bone'), P('M148 104 L200 96 L200 110 L150 118 Z', 'bone'),
        P('M70 95 C60 120 70 150 95 158 L125 158 C150 150 160 120 150 95 L135 100 C140 120 132 140 110 142 C88 140 80 120 85 100 Z', 'bone'),
        P('M100 156 L120 156 L114 196 L106 196 Z', 'bone'),
        E(110, 60, 70, 45, 'cart'), E(110, 60, 30, 18, 'blue'),
        E(110, 118, 22, 18, 'white'), E(110, 118, 14, 11, 'nerve'),
        E(78, 140, 8, 6, 'cart'), E(142, 140, 8, 6, 'cart'),
        L('M98 126 C82 136 64 130 46 132', '#c9a400', 5), L('M122 126 C138 136 156 130 174 132', '#c9a400', 5),
        T(96, 14, 'Anterior', { size: 9, fill: '#6b7280' }),
      ],
      parts: { 'annulus fibrosus': [158, 60], 'nucleus pulposus': [110, 60], disc: [150, 72], 'intervertebral disc': [150, 72], 'spinal cord': [110, 118], 'spinal canal': [92, 118], 'nerve root': [52, 132], 'spinous process': [110, 186], 'transverse process': [30, 103], 'facet joint': [78, 140], lamina: [94, 150], pedicle: [76, 108] },
    },
    brain: {
      label: 'Brain (side view)', w: 260, h: 200,
      shapes: [
        P('M40 110 C30 60 80 20 128 22 L120 70 L104 112 C80 118 58 122 40 110 Z', 'organ', { fill: '#f9c5d1' }),
        P('M128 22 C175 22 210 40 222 72 L160 86 L120 70 Z', 'blue'),
        P('M222 72 C236 92 238 118 226 140 L190 132 L160 86 Z', 'lig'),
        P('M104 112 L120 70 L160 86 L190 132 C170 148 130 152 100 146 C88 140 92 120 104 112 Z', 'tendon'),
        P('M178 140 C190 132 228 134 232 150 C234 168 210 178 190 172 C176 168 170 152 178 140 Z', 'purple'),
        L('M184 150 C200 146 218 148 228 154 M182 160 C198 158 214 160 226 164', '#7a5bb5', 1.2),
        P('M150 142 L172 142 L176 198 L156 198 Z', 'skin'),
        L('M124 24 L116 70 L102 110', '#e05570', 6, { op: 0.7 }), L('M134 25 L126 72 L114 112', '#3b6fd1', 5, { op: 0.6 }),
      ],
      parts: { 'frontal lobe': [70, 75], 'parietal lobe': [172, 48], 'occipital lobe': [214, 108], 'temporal lobe': [140, 122], cerebellum: [206, 158], brainstem: [164, 182], 'motor cortex': [114, 56], 'primary motor cortex': [114, 56], 'sensory cortex': [130, 50], "broca's area": [92, 104], "wernicke's area": [170, 108] },
    },
    neuron: {
      label: 'Neuron', w: 300, h: 140,
      shapes: [
        L('M60 70 L20 30 M38 48 L24 52 M60 70 L14 78 M34 74 L22 92 M60 70 L30 118 M60 70 L54 18 M56 40 L42 22 M60 70 L76 22', '#7a5bb5', 3),
        L('M84 70 L250 70', '#7a5bb5', 4),
        ...[98, 136, 174, 212].map(x => P(`M${x} 63 h28 a7 7 0 0 1 0 14 h-28 a7 7 0 0 1 0 -14 Z`, 'nerve')),
        L('M250 70 L284 44 M250 70 L290 70 M250 70 L284 96', '#7a5bb5', 3),
        E(286, 44, 5, 5, 'purple'), E(292, 70, 5, 5, 'purple'), E(286, 96, 5, 5, 'purple'),
        E(60, 70, 24, 24, 'purple'), E(60, 70, 9, 9, 'purple', { fill: '#9b7fd4' }),
      ],
      parts: { dendrites: [24, 32], dendrite: [24, 32], 'cell body': [52, 88], soma: [52, 88], nucleus: [60, 70], 'axon hillock': [88, 70], axon: [160, 70], 'myelin sheath': [112, 70], myelin: [112, 70], 'node of ranvier': [131, 70], 'axon terminal': [290, 70], synapse: [292, 70] },
    },
    muscle: {
      label: 'Skeletal muscle', w: 300, h: 140,
      shapes: [
        P('M0 64 H46 V76 H0 Z', 'tendon'), P('M254 64 H300 V76 H254 Z', 'tendon'),
        P('M40 70 C80 20 220 20 260 70 C220 120 80 120 40 70 Z', 'muscle'),
        L('M60 70 C110 48 190 48 240 70 M60 70 C110 92 190 92 240 70 M70 70 L230 70', '#b3473f', 1.4, { op: 0.7 }),
        E(150, 70, 22, 16, 'muscle', { fill: '#f6aaa4' }),
        ...[[142, 64], [152, 62], [160, 70], [146, 74], [156, 78], [138, 72]].map(([x, y]) => E(x, y, 4, 4, 'muscle', { fill: '#e8736a' })),
      ],
      parts: { tendon: [22, 70], origin: [8, 70], insertion: [292, 70], 'muscle belly': [150, 38], fascicle: [150, 70], 'muscle fibre': [160, 70], 'muscle fiber': [160, 70], 'musculotendinous junction': [46, 70] },
    },
    skeleton: {
      label: 'Body & main joints', w: 160, h: 360,
      shapes: [
        E(80, 30, 22, 24, 'bone'), L('M80 54 L80 200', '#8a7454', 6),
        E(80, 105, 34, 40, 'none', { stroke: '#8a7454', sw: 2 }),
        L('M88 90 C100 92 108 100 110 110 M72 90 C60 92 52 100 50 110 M88 110 C100 112 108 120 108 128 M72 110 C60 112 52 120 52 128', '#8a7454', 1.5),
        P('M56 188 C64 178 96 178 104 188 L108 206 L80 214 L52 206 Z', 'bone'),
        ...[[48, 70, 36, 140], [36, 140, 30, 200], [112, 70, 124, 140], [124, 140, 130, 200], [64, 206, 62, 275], [62, 275, 60, 345], [96, 206, 98, 275], [98, 275, 100, 345], [48, 70, 112, 70]]
          .map(([a, b, c, d]) => L(`M${a} ${b} L${c} ${d}`, '#b9a37f', 7, { cap: 'round' })),
        ...[[48, 70], [112, 70], [36, 140], [124, 140], [30, 200], [130, 200], [64, 206], [96, 206], [62, 275], [98, 275], [60, 345], [100, 345]].map(([x, y]) => E(x, y, 5, 5, 'cart', { fill: '#5eead4', stroke: '#0d9488' })),
      ],
      parts: { head: [80, 30], skull: [80, 30], spine: [80, 160], ribcage: [80, 105], pelvis: [80, 196], shoulder: [48, 70], elbow: [36, 140], wrist: [30, 200], hip: [64, 206], knee: [62, 275], ankle: [60, 345], 'right shoulder': [48, 70], 'left shoulder': [112, 70], 'right knee': [62, 275], 'left knee': [98, 275], 'right hip': [64, 206], 'left hip': [96, 206] },
    },
    hand: hand(),
    foot: {
      label: 'Foot & ankle (inner side)', w: 300, h: 160,
      shapes: [
        P('M70 0 H80 L76 80 L66 80 Z', 'tendon'),
        P('M78 0 H112 L114 56 C100 50 86 52 76 58 Z', 'bone'),
        P('M20 110 C18 86 40 76 70 80 L92 96 L86 124 C60 132 30 130 20 110 Z', 'bone'),
        P('M70 62 C90 50 118 54 124 70 L110 90 L84 92 Z', 'bone'),
        P('M120 72 C132 70 140 78 138 90 L118 94 L114 84 Z', 'bone'),
        P('M140 82 L166 86 L164 104 L138 100 Z', 'bone'),
        P('M166 88 L236 112 L232 124 L164 106 Z', 'bone'),
        P('M240 114 L266 120 L264 130 L236 124 Z', 'bone'), P('M270 122 L288 126 L286 134 L268 130 Z', 'bone'),
        L('M36 128 C120 136 200 138 274 136', '#b8a165', 4),
        L('M86 120 C120 96 170 96 232 118', '#0d9488', 1.5, { dash: '4 4' }),
      ],
      parts: { calcaneus: [45, 105], heel: [36, 112], talus: [98, 68], tibia: [95, 25], navicular: [128, 82], cuneiform: [152, 93], metatarsals: [200, 108], phalanges: [262, 124], toes: [262, 124], 'achilles tendon': [72, 40], 'plantar fascia': [120, 133], 'ankle joint': [95, 60], 'medial longitudinal arch': [160, 104], arch: [160, 104] },
    },
    gait: {
      label: 'Gait cycle', w: 400, h: 170,
      shapes: [
        P('M20 30 H236 V56 H20 Z', 'cart', { fill: '#99f6e4', stroke: '#0d9488' }), P('M236 30 H380 V56 H236 Z', 'purple'),
        T(128, 47, 'Stance phase (60%)', { size: 11, anchor: 'middle', weight: 700, fill: '#115e59' }),
        T(308, 47, 'Swing phase (40%)', { size: 11, anchor: 'middle', weight: 700, fill: '#5b21b6' }),
        ...[0, 10, 30, 50, 60, 73, 87, 100].map(p => L(`M${20 + p * 3.6} 24 V62`, '#374151', 1.2)),
        ...[[0, 'Initial contact'], [5, 'Loading response'], [20, 'Mid stance'], [40, 'Terminal stance'], [55, 'Pre-swing'], [66.5, 'Initial swing'], [80, 'Mid swing'], [93.5, 'Terminal swing']]
          .map(([p, t]) => T(20 + p * 3.6, 72, t, { size: 10, rotate: 40, fill: '#374151' })),
        ...[0, 60, 100].map(p => T(20 + p * 3.6, 18, p + '%', { size: 9, anchor: 'middle', fill: '#6b7280' })),
      ],
      parts: { stance: [128, 43], 'stance phase': [128, 43], swing: [308, 43], 'swing phase': [308, 43], 'initial contact': [20, 56], 'heel strike': [20, 56], 'loading response': [38, 56], 'mid stance': [92, 56], midstance: [92, 56], 'terminal stance': [164, 56], 'pre-swing': [218, 56], 'toe off': [236, 56], 'initial swing': [259, 56], 'mid swing': [308, 56], 'terminal swing': [357, 56] },
    },
    lungs: {
      label: 'Lungs & airways', w: 240, h: 230,
      shapes: [
        P('M112 0 H128 V60 H112 Z', 'cart'),
        L('M120 58 L88 90 L70 120 M88 90 L92 130 M120 58 L152 90 L170 120 M152 90 L148 130', '#4a90b8', 5),
        P('M104 70 C70 60 30 100 26 160 C24 190 40 200 70 196 C96 192 108 180 110 160 Z', 'organ', { op: 0.85 }),
        P('M136 70 C170 60 212 100 214 160 C216 190 200 200 170 196 C144 192 132 180 130 160 Z', 'organ', { op: 0.85 }),
        L('M10 214 C60 190 180 190 230 214', '#b3473f', 4),
        ...[[60, 170], [68, 178], [56, 180], [64, 186]].map(([x, y]) => E(x, y, 4, 4, 'organ', { fill: '#f19ca0' })),
      ],
      parts: { trachea: [120, 30], bronchi: [88, 92], bronchus: [88, 92], 'right lung': [62, 130], 'left lung': [178, 130], diaphragm: [120, 200], alveoli: [62, 180], bronchioles: [70, 120] },
    },
    hip: {
      label: 'Hip joint (front view)', w: 220, h: 240,
      shapes: [
        P('M150 0 C200 10 214 60 200 96 C190 120 160 128 140 120 C120 112 112 90 120 70 C130 40 120 16 150 0 Z', 'bone'),
        P('M140 120 C150 150 170 170 200 176 L196 196 C160 190 130 160 124 128 Z', 'bone'),
        E(112, 104, 34, 34, 'cart'),
        P('M60 110 L110 96 L118 116 L74 140 Z', 'bone'),
        E(108, 104, 28, 28, 'bone'),
        P('M50 100 C40 104 36 120 44 134 L60 140 L74 126 L66 106 Z', 'bone'),
        P('M44 130 L74 132 L80 240 H48 Z', 'bone'),
        E(74, 160, 8, 6, 'bone'),
      ],
      parts: { ilium: [168, 50], pelvis: [168, 50], acetabulum: [130, 92], 'femoral head': [108, 104], 'femoral neck': [86, 118], 'greater trochanter': [48, 118], 'lesser trochanter': [76, 162], femur: [64, 210], 'hip joint': [112, 104], 'articular cartilage': [136, 112], pubis: [184, 176] },
    },
    rom: {
      label: 'Joint angle (goniometry)', w: 220, h: 180,
      shapes: [
        L('M60 140 L205 140', '#374151', 6, { cap: 'round' }), L('M60 140 L130 20', '#0d9488', 6, { cap: 'round' }),
        L('M110 140 A50 50 0 0 0 85 97', '#ea580c', 2.5), E(60, 140, 8, 8, 'cart', { fill: '#5eead4', stroke: '#0d9488' }),
        T(112, 116, 'θ', { size: 18, fill: '#ea580c', weight: 700 }),
      ],
      parts: { axis: [60, 140], fulcrum: [60, 140], 'axis of rotation': [60, 140], 'stationary arm': [160, 140], 'moving arm': [102, 68], angle: [98, 120], 'range of motion': [98, 120] },
    },
    'pain-scale': {
      label: 'Pain scale 0–10', w: 400, h: 90,
      shapes: Array.from({ length: 11 }, (_, i) => {
        const hue = 120 - i * 12;
        return [P(`M${8 + i * 35} 20 h32 v32 h-32 Z`, 'none', { fill: `hsl(${hue},70%,62%)`, stroke: `hsl(${hue},60%,38%)` }), T(24 + i * 35, 42, String(i), { size: 14, anchor: 'middle', weight: 700, fill: '#1f2937' })];
      }).flat().concat([T(8, 72, 'No pain', { size: 10, fill: '#374151' }), T(200, 72, 'Moderate', { size: 10, anchor: 'middle', fill: '#374151' }), T(392, 72, 'Worst pain', { size: 10, anchor: 'end', fill: '#374151' })]),
      parts: { 'no pain': [24, 36], mild: [94, 36], moderate: [199, 36], severe: [304, 36], 'worst pain': [384, 36] },
    },
    heart: {
      label: 'Heart', w: 220, h: 220,
      shapes: [
        L('M120 40 C120 0 190 0 190 40 L190 60', '#dc2626', 12, { cap: 'round' }),
        P('M110 210 C60 170 20 130 24 86 C28 50 70 36 110 64 C150 36 192 50 196 86 C200 130 160 170 110 210 Z', 'organ', { fill: '#f8b4b4', stroke: '#b91c1c' }),
        L('M110 64 L110 206', '#b91c1c', 2), L('M30 108 C70 116 150 116 190 108', '#b91c1c', 2),
      ],
      parts: { aorta: [180, 18], 'right atrium': [64, 86], 'left atrium': [156, 86], 'right ventricle': [70, 144], 'left ventricle': [150, 144], septum: [110, 140] },
    },
    lever: {
      label: 'Lever (biomechanics)', w: 300, h: 160,
      shapes: [
        L('M20 90 L280 90', '#8a7454', 8, { cap: 'round' }), P('M120 96 L140 136 L100 136 Z', 'cart', { fill: '#99f6e4', stroke: '#0d9488' }),
        P('M236 46 h36 v36 h-36 Z', 'blue'), T(254, 70, 'Load', { size: 11, anchor: 'middle', weight: 700, fill: '#1e3a8a' }),
        L('M40 30 L40 80', '#dc2626', 4), L('M32 70 L40 84 L48 70', '#dc2626', 4),
        T(40, 22, 'Effort', { size: 11, anchor: 'middle', weight: 700, fill: '#dc2626' }),
      ],
      parts: { fulcrum: [120, 120], axis: [120, 120], effort: [40, 50], force: [40, 50], load: [254, 64], resistance: [254, 64], 'effort arm': [80, 90], 'load arm': [190, 90] },
    },
    'vocal-tract': {
      label: 'Head & neck: speech and swallowing', w: 240, h: 260,
      shapes: [
        P('M150 10 C210 14 236 70 226 120 C220 150 200 170 196 200 L196 260 H120 L124 200 C100 196 74 186 60 170 L44 168 C34 160 40 150 48 146 L44 136 C38 128 42 120 50 118 L46 104 C40 96 50 86 64 86 C70 50 100 10 150 10 Z', 'skin'),
        P('M60 98 C90 92 130 92 156 100 L158 108 C130 102 92 102 62 106 Z', 'bone'),
        P('M64 112 C96 100 140 104 158 124 C162 146 150 160 138 166 C120 160 92 140 70 126 Z', 'muscle', { op: 0.85 }),
        P('M156 102 C168 104 176 112 176 122 L170 124 C168 116 162 110 154 108 Z', 'muscle', { fill: '#f6aaa4' }),
        P('M170 124 L186 124 L184 200 L166 200 Z', 'organ', { fill: '#fbd5d5', op: 0.8 }),
        P('M160 200 L176 200 L176 250 L160 250 Z', 'cart'), P('M178 200 L194 200 L194 258 L178 258 Z', 'organ', { fill: '#f9c5d1' }),
        L('M162 222 L174 222', '#b3473f', 3), E(52, 136, 6, 5, 'muscle', { fill: '#e8736a' }),
        P('M70 60 C100 50 140 54 160 70 L156 92 C130 84 100 82 66 88 Z', 'blue', { op: 0.5 }),
      ],
      parts: { 'nasal cavity': [112, 72], 'hard palate': [108, 98], palate: [108, 98], 'soft palate': [166, 112], velum: [166, 112], tongue: [112, 128], lips: [50, 136], 'oral cavity': [96, 112], pharynx: [178, 160], larynx: [168, 214], 'vocal folds': [168, 222], 'vocal cords': [168, 222], trachea: [168, 244], oesophagus: [186, 236], esophagus: [186, 236], epiglottis: [176, 196] },
    },
  };
  const ALIASES = { body: 'skeleton', joints: 'skeleton', 'knee joint': 'knee', 'shoulder joint': 'shoulder', 'hip joint': 'hip', 'lumbar vertebra': 'vertebra', disc: 'vertebra', 'gait cycle': 'gait', painscale: 'pain-scale', pain: 'pain-scale', goniometer: 'rom', 'joint angle': 'rom', ankle: 'foot', larynx: 'vocal-tract', swallowing: 'vocal-tract', speech: 'vocal-tract', nerve: 'neuron', 'nerve cell': 'neuron', lung: 'lungs', respiratory: 'lungs' };
  function diagramKey(name) {
    const n = String(name || '').toLowerCase().trim();
    if (DIAGRAMS[n]) return n;
    if (ALIASES[n]) return ALIASES[n];
    const k1 = Object.keys(DIAGRAMS).find(k => n.indexOf(k) >= 0);
    if (k1) return k1;
    const k2 = Object.keys(ALIASES).find(k => n.indexOf(k) >= 0);
    return k2 ? ALIASES[k2] : null;
  }
  function partPoint(def, part) {
    const p = String(part || '').toLowerCase().trim();
    if (def.parts[p]) return def.parts[p];
    const k = Object.keys(def.parts).find(x => x.toLowerCase() === p) || Object.keys(def.parts).find(x => p.indexOf(x.toLowerCase()) >= 0 || x.toLowerCase().indexOf(p) >= 0);
    return k ? def.parts[k] : null;
  }

  // ------------------------------------------------------------------ the AI's prompt and its reply
  function libraryText() {
    return Object.keys(DIAGRAMS).map(k => '- "' + k + '" (' + DIAGRAMS[k].label + '): parts ' + Object.keys(DIAGRAMS[k].parts).slice(0, 16).join(', ')).join('\n');
  }
  const FORMAT = [
    'Return ONLY one JSON object, no markdown:',
    '{"title": "<short title>", "subject": "<e.g. Physiotherapy, Neuroanatomy>", "steps": [{"title": "<step title>", "say": "<1-3 sentences a teacher says while drawing this step>", "items": [ITEM, ...]}]}',
    'The canvas is 1000 wide and 640 high, origin top-left. Keep every item inside x 20-980, y 20-620. Items of a step stay on the board in later steps, so later steps ADD to the drawing: plan the whole layout first and never overlap items.',
    'A board holds about 8 to 12 items. When it would get crowded, start the next step with "clear": true: the board is wiped (like a teacher erasing it) and that step is laid out afresh, e.g. {"title": "...", "clear": true, "say": "...", "items": [...]}. A closing summary usually starts a clean board.',
    'LAYOUT: plan two areas. With a diagram: the diagram and its labels on the left (diagram x 150-470, labels need the space beside it) and boxes, notes and text on the right (x 540-970), stacked top to bottom with at least 20 px between items. Without a diagram: a flow or cycle across the board. Boxes 60-90 high; one sticky note per board at most; handwritten text lines are short (about 6 words). Fewer, well-spaced items are better than a crowded board.',
    'ITEM is one of:',
    '{"id": "a1", "type": "diagram", "name": "<library name>", "x": 40, "y": 60, "w": 360, "labels": [{"part": "<a part of that diagram>", "text": "<label, 1-4 words>"}]}  (height follows the drawing; labels are drawn beside it with leader lines, so leave ~140 px free on each side)',
    '{"id": "b1", "type": "box", "x": 620, "y": 60, "w": 300, "h": 70, "text": "<up to 10 words>", "color": "teal"}',
    '{"id": "c1", "type": "circle", "x": 620, "y": 200, "w": 140, "h": 90, "text": "<up to 6 words>", "color": "blue"}',
    '{"id": "d1", "type": "arrow", "from": "b1", "to": "c1", "text": "<optional, 1-3 words>", "color": "ink"}  (or "x","y","x2","y2" instead of from/to)',
    '{"id": "e1", "type": "text", "x": 600, "y": 400, "text": "<handwritten note, up to 14 words>", "size": 30, "color": "red"}',
    '{"id": "f1", "type": "note", "x": 640, "y": 470, "w": 300, "text": "<sticky note: key point, up to 25 words>", "color": "orange"}',
    'Colours: ink, teal, blue, red, orange, purple, green.',
    'Diagram library (use one when the topic involves it; otherwise build the picture from boxes, circles and arrows, e.g. a flow or a cycle):',
  ].join('\n');

  /**
   * opts: { topic, content, level, steps (wanted, optional), instructions }
   * Returns { system, user, maxTokens }.
   */
  function buildPrompt(opts) {
    const o = opts || {};
    const steps = parseInt(o.steps, 10) > 0 ? Math.max(2, Math.min(MAX_STEPS, parseInt(o.steps, 10))) : 0;
    const system = 'You are Lixa, a rehabilitation educator (physiotherapy, occupational therapy, speech and language therapy, rehabilitation medicine, nursing, psychology, sports and exercise science). ' +
      'You explain ONE topic visually on a whiteboard, step by step, the way a great teacher draws it: start simple, then add structure, labels, arrows and key points. ' +
      'Be clinically accurate and current. Never include a patient\'s name or other identifier.\n\n' + FORMAT + '\n' + libraryText() + '\n\n' +
      (steps ? 'Use exactly ' + steps + ' steps.' : 'Use 3 to 6 steps.') + ' Each step adds 1 to 6 items. Finish with a step that sums up the key points (a note or boxes).';
    const user = 'TOPIC: ' + String(o.topic || '').slice(0, 2000) +
      (o.content ? '\n\nSOURCE MATERIAL (base the board on this):\n' + String(o.content).slice(0, 12000) : '') +
      (o.level ? '\n\nAUDIENCE: ' + o.level : '') + (o.instructions ? '\n\nALSO: ' + String(o.instructions).slice(0, 1000) : '');
    return { system, user, maxTokens: 4200 };
  }

  /** A change to an existing board ("add a step on…", "label the ACL", "make it simpler"). */
  function buildRevisePrompt(board, instruction) {
    const lean = JSON.stringify(leanBoard(board));
    const base = buildPrompt({});
    return {
      system: base.system.replace(/Use (exactly \d+ steps|3 to 6 steps)\.[^\n]*$/, '') + '\n\nYou are CHANGING an existing whiteboard. Keep every step and item the request does not touch (same ids). Return the complete updated board JSON.',
      user: 'CURRENT BOARD JSON:\n' + lean + '\n\nREQUESTED CHANGE:\n' + String(instruction || '').slice(0, 1500),
      maxTokens: 5200,
    };
  }

  function leanBoard(b) {
    return { title: b.title, subject: b.subject, steps: b.steps.map(s => ({ title: s.title, say: s.say, clear: s.clear || undefined, items: s.items.filter(i => i.type !== 'ink' && i.type !== 'image').map(i => { const o = Object.assign({}, i); delete o.points; delete o.src; return o; }) })) };
  }

  function extractJson(raw) {
    let s = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('The SI reply was not a whiteboard.');
    return JSON.parse(s.slice(a, b + 1));
  }

  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  let idSeq = 0;
  const newId = () => 'i' + Date.now().toString(36) + (idSeq++).toString(36);

  function normItem(it, used) {
    if (!it || typeof it !== 'object') return null;
    const type = TYPES.indexOf(it.type) >= 0 ? it.type : null;
    if (!type) return null;
    let id = str(it.id, 24) || newId();
    while (used[id]) id = id + '_';
    used[id] = 1;
    const o = { id, type, color: COLORS[it.color] ? it.color : (type === 'note' ? 'orange' : type === 'text' ? 'ink' : 'teal') };
    o.x = num(it.x, 60, 0, W); o.y = num(it.y, 60, 0, H);
    if (type === 'diagram') {
      const key = diagramKey(it.name);
      if (!key) return null;
      o.name = key;
      const d = DIAGRAMS[key];
      o.w = num(it.w, 320, 80, 900); o.h = o.w * d.h / d.w;
      if (o.h > H - 20) { o.h = H - 40; o.w = o.h * d.w / d.h; }
      o.labels = (Array.isArray(it.labels) ? it.labels : []).slice(0, 12).map(l => ({ part: str(l && l.part, 40), text: str(l && (l.text || l.part), 40) })).filter(l => l.part && partPoint(d, l.part));
    } else if (type === 'arrow' || type === 'line') {
      if (it.from) o.from = str(it.from, 24);
      if (it.to) o.to = str(it.to, 24);
      o.x2 = num(it.x2, o.x + 120, 0, W); o.y2 = num(it.y2, o.y, 0, H);
      if (it.text) o.text = str(it.text, 40);
    } else if (type === 'ink') {
      o.points = (Array.isArray(it.points) ? it.points : []).slice(0, 2000).map(p => [num(p[0], 0, 0, W), num(p[1], 0, 0, H)]);
      o.width = num(it.width, 4, 1, 24);
      if (o.points.length < 2) return null;
    } else if (type === 'image') {
      if (typeof it.src !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(it.src)) return null;
      o.src = it.src; o.w = num(it.w, 300, 40, W); o.h = num(it.h, 300, 40, H); o.text = str(it.text, 200);
    } else {
      o.text = str(it.text, type === 'note' ? 220 : 160);
      if (type === 'text') o.size = num(it.size, 30, 14, 72);
      else { o.w = num(it.w, type === 'note' ? 280 : 260, 40, W); o.h = type === 'note' ? num(it.h, 0, 0, H) : num(it.h, 80, 30, H); }
    }
    if (it.rot != null) o.rot = num(it.rot, 0, -30, 30);
    return o;
  }

  /** Any board-like object (an AI reply, a saved record, an edited board) → a clean, safe board. */
  function normalize(b) {
    const src = b && typeof b === 'object' ? b : {};
    const used = {};
    let images = 0;
    const steps = (Array.isArray(src.steps) ? src.steps : []).slice(0, MAX_STEPS).map((s, i) => ({
      title: str(s && s.title, 80) || 'Step ' + (i + 1),
      say: str(s && s.say, 600),
      clear: i > 0 && !!(s && s.clear),
      items: (Array.isArray(s && s.items) ? s.items : []).slice(0, MAX_ITEMS).map(it => normItem(it, used)).filter(it => it && (it.type !== 'image' || ++images <= MAX_IMAGES)),
    }));
    if (!steps.length) steps.push({ title: 'Step 1', say: '', items: [] });
    // arrows that point at items which do not exist keep their own ends
    steps.forEach(s => s.items.forEach(it => { if (it.from && !used[it.from]) delete it.from; if (it.to && !used[it.to]) delete it.to; }));
    return { title: str(src.title, 100) || 'Whiteboard', subject: str(src.subject, 60), steps };
  }

  /** After an AI change: the user's own pen strokes and pictures (never sent to the AI) go back on their steps. */
  function keepHandwork(before, after) {
    const b = normalize(before), a = normalize(after), ids = {};
    a.steps.forEach(s => s.items.forEach(i => { ids[i.id] = 1; }));
    b.steps.forEach((s, i) => s.items.forEach(it => {
      if ((it.type === 'ink' || it.type === 'image') && !ids[it.id]) a.steps[Math.min(i, a.steps.length - 1)].items.push(it);
    }));
    return normalize(a);
  }

  function parseBoard(raw) {
    const b = normalize(extractJson(raw));
    if (!b.steps.some(s => s.items.length)) throw new Error('The SI did not draw anything on the board.');
    // a step that no longer fits on the board starts a fresh page (the board is wiped), then the layout is redone
    for (let guard = 0; guard < b.steps.length; guard++) {
      const crowded = declutter(b);
      if (crowded <= 0 || b.steps[crowded].clear) break;
      b.steps[crowded].clear = true;
    }
    // a fresh page starts at the top of the board (its items were planned below the earlier ones)
    const all = b.steps.reduce((a, s) => a.concat(s.items), []);
    b.steps.forEach((s, i) => {
      if (!s.clear) return;
      const pg = pageOf(b, i), items = [];
      for (let j = pg.start; j <= pg.end; j++) items.push(...b.steps[j].items);
      const ys = items.map(it => extent(it, all).y);
      const dy = ys.length ? Math.min(...ys) - 30 : 0;
      if (dy > 30) items.forEach(it => {
        if (it.type === 'ink') it.points = it.points.map(p => [p[0], p[1] - dy]);
        else { it.y -= dy; if (it.y2 != null) it.y2 -= dy; }
      });
    });
    return b;
  }

  // ---- the AI's layout, tidied: everything inside the board, nothing on top of anything else
  /** The item's rectangle including a diagram's labels. */
  function extent(it, all) {
    const b = bbox(it, all);
    if (it.type !== 'diagram' || !DIAGRAMS[it.name]) return b;
    let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
    diagramLabels(it).forEach(l => {
      const tw = l.text.length * 11 + 6, lx = l.side === 'left' ? l.tx - tw : l.tx;
      x1 = Math.min(x1, lx); x2 = Math.max(x2, lx + tw); y1 = Math.min(y1, l.ty - 22); y2 = Math.max(y2, l.ty + 6);
    });
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
  const overlaps = (a, b, m) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
  const inside = e => e.x >= 6 && e.y >= 6 && e.x + e.w <= W - 6 && e.y + e.h <= H - 6;
  /**
   * Moves each item that sticks out of the board or lands on an earlier one to the nearest free spot (in order of the
   * steps). Returns the first step with an item that found no free spot (-1: everything fits).
   */
  function declutter(board) {
    const all = board.steps.reduce((a, s) => a.concat(s.items), []);
    let placed = [], crowded = -1;
    board.steps.forEach((s, si) => { if (s.clear) placed = []; s.items.forEach(it => {
      if (it.type === 'arrow' || it.type === 'line' || it.type === 'ink') return;
      let e = extent(it, all);
      if (e.x + e.w > W - 6) it.x -= Math.min(e.x - 6, e.x + e.w - (W - 6));
      if (e.y + e.h > H - 6) it.y -= Math.min(e.y - 6, e.y + e.h - (H - 6));
      e = extent(it, all);
      if (e.x < 6) it.x += 6 - e.x;
      if (e.y < 6) it.y += 6 - e.y;
      const ox = it.x, oy = it.y;
      const free = () => { const x = extent(it, all); return inside(x) && !placed.some(p => overlaps(x, p, 8)); };
      if (!free()) {
        let done = false;
        // (small moves only: an item sent across the board would leave its arrows and neighbours behind)
        for (let d = 8; d <= 220 && !done; d += 8) {
          for (const [dx, dy] of [[0, d], [d, 0], [0, -d], [-d, 0]]) {
            it.x = ox + dx; it.y = oy + dy;
            if (free()) { done = true; break; }
          }
        }
        if (!done) { it.x = ox; it.y = oy; if (crowded < 0) crowded = si; }
      }
      placed.push(extent(it, all));
    }); });
    return crowded;
  }

  // ------------------------------------------------------------------ geometry and drawing
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function wrap(text, maxChars) {
    const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
    let cur = '';
    words.forEach(w => { if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
    if (cur) lines.push(cur);
    return lines;
  }
  function noteHeight(it) { return Math.max(70, 34 + wrap(it.text, Math.max(8, Math.floor(it.w / 13))).length * 30); }
  /** A box or circle grows to fit its words (never cut off). */
  function shapeText(it) {
    const h0 = it.h || 80, pad = it.type === 'circle' ? 40 : 24, k = it.type === 'circle' ? 1.3 : 1;
    const fit = fs => { const lines = wrap(it.text, Math.max(6, Math.floor((it.w - pad) / (fs * 0.55)))); return { fs, lines, need: (lines.length * fs * 1.2 + 16) * k }; };
    // the words shrink to fit the shape first (down to 13 px); only then does the shape grow
    for (let fs = Math.max(13, Math.min(22, h0 / 2.6)); fs >= 13; fs -= 1) { const f = fit(fs); if (f.need <= h0) return { fs, lines: f.lines, h: h0 }; }
    const f = fit(13);
    return { fs: 13, lines: f.lines, h: Math.max(h0, f.need) };
  }
  function textBox(it) {
    const maxW = Math.max(160, Math.min(520, W - 16 - it.x));
    const lines = wrap(it.text, Math.max(8, Math.floor(maxW / (it.size * 0.48))));
    const w = Math.min(W, Math.max(...lines.map(l => l.length), 1) * it.size * 0.48 + 8);
    return { x: it.x, y: it.y, w, h: lines.length * it.size * 1.05 + 6, lines };
  }
  /** The item's rectangle on the board (labels of a diagram not included). */
  function bbox(it, all) {
    switch (it.type) {
      case 'text': { const t = textBox(it); return { x: t.x, y: t.y, w: t.w, h: t.h }; }
      case 'note': return { x: it.x, y: it.y, w: it.w, h: it.h || noteHeight(it) };
      case 'arrow': case 'line': { const e = ends(it, all); return { x: Math.min(e[0], e[2]), y: Math.min(e[1], e[3]), w: Math.abs(e[2] - e[0]) || 1, h: Math.abs(e[3] - e[1]) || 1 }; }
      case 'ink': { const xs = it.points.map(p => p[0]), ys = it.points.map(p => p[1]); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x || 1, h: Math.max(...ys) - y || 1 }; }
      case 'box': case 'circle': return { x: it.x, y: it.y, w: it.w, h: shapeText(it).h };
      default: return { x: it.x, y: it.y, w: it.w || 100, h: it.h || 80 };
    }
  }
  function edgePoint(b, tx, ty, round) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    if (round) { const t = 1 / Math.sqrt((dx * dx) / ((b.w / 2) ** 2) + (dy * dy) / ((b.h / 2) ** 2)); return [cx + dx * t, cy + dy * t]; }
    const t = Math.min(dx ? (b.w / 2) / Math.abs(dx) : Infinity, dy ? (b.h / 2) / Math.abs(dy) : Infinity);
    return [cx + dx * t, cy + dy * t];
  }
  function ends(it, all) {
    const find = id => id && all && all.find(x => x.id === id && x.type !== 'arrow' && x.type !== 'line');
    const a = find(it.from), b = find(it.to);
    const ab = a && bbox(a, all), bb = b && bbox(b, all);
    const tgt0 = bb ? [bb.x + bb.w / 2, bb.y + bb.h / 2] : [it.x2, it.y2];
    const src0 = ab ? [ab.x + ab.w / 2, ab.y + ab.h / 2] : [it.x, it.y];
    const s = ab ? edgePoint(ab, tgt0[0], tgt0[1], a.type === 'circle') : src0;
    const t = bb ? edgePoint(bb, src0[0], src0[1], b.type === 'circle') : tgt0;
    const pad = (p, q, d) => { const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [p[0] + (q[0] - p[0]) * d / L, p[1] + (q[1] - p[1]) * d / L]; };
    const s2 = ab ? pad(s, t, 6) : s, t2 = bb ? pad(t, s, 6) : t;
    return [s2[0], s2[1], t2[0], t2[1]];
  }

  function shapeSvg(sh) {
    const st = ST[sh.s] || ST.none;
    const fill = sh.fill || st[0], stroke = sh.stroke || st[1];
    const common = ` fill="${fill}" stroke="${stroke}" stroke-width="${sh.sw || 1.6}"${sh.op ? ` opacity="${sh.op}"` : ''}${sh.dash ? ` stroke-dasharray="${sh.dash}"` : ''}${sh.cap ? ` stroke-linecap="${sh.cap}"` : ' stroke-linecap="round"'} stroke-linejoin="round"`;
    if (sh.k === 'ellipse') return `<ellipse cx="${sh.cx}" cy="${sh.cy}" rx="${sh.rx}" ry="${sh.ry}"${common}/>`;
    if (sh.k === 'text') return `<text x="${sh.x}" y="${sh.y}" font-family="${SANS}" font-size="${sh.size || 10}" font-weight="${sh.weight || 500}" fill="${sh.fill || '#374151'}"${sh.anchor ? ` text-anchor="${sh.anchor}"` : ''}${sh.rotate ? ` transform="rotate(${sh.rotate} ${sh.x} ${sh.y})"` : ''}>${esc(sh.text)}</text>`;
    return `<path d="${sh.d}"${common}/>`;
  }
  const diagramCache = {};
  function diagramInner(key) {
    if (!diagramCache[key]) diagramCache[key] = DIAGRAMS[key].shapes.map(shapeSvg).join('');
    return diagramCache[key];
  }

  /** The labels of a diagram, placed on its left and right with leader lines (no two on top of each other). */
  function diagramLabels(it) {
    const d = DIAGRAMS[it.name], sx = it.w / d.w, sy = it.h / d.h, cx = it.x + it.w / 2;
    const placed = { left: [], right: [] };
    (it.labels || []).forEach(l => {
      const p = partPoint(d, l.part); if (!p) return;
      const ax = it.x + p[0] * sx, ay = it.y + p[1] * sy, tw = l.text.length * 11 + 10;
      let side = ax < cx ? 'left' : 'right';
      if (side === 'left' && it.x - 14 - tw < 4) side = 'right';
      else if (side === 'right' && it.x + it.w + 14 + tw > W - 4 && it.x - 14 - tw >= 4) side = 'left';
      placed[side].push({ ax, ay, text: l.text, y: ay });
    });
    const out = [];
    ['left', 'right'].forEach(side => {
      const list = placed[side].sort((a, b) => a.ay - b.ay);
      for (let i = 1; i < list.length; i++) if (list[i].y - list[i - 1].y < 24) list[i].y = list[i - 1].y + 24;
      const over = list.length ? list[list.length - 1].y - (H - 14) : 0;
      if (over > 0) list.forEach(l => { l.y -= over; });
      list.forEach(l => {
        const tx = side === 'left' ? it.x - 14 : it.x + it.w + 14;
        out.push({ side, tx, ty: l.y, ax: l.ax, ay: l.ay, text: l.text });
      });
    });
    return out;
  }

  function itemSvg(it, all, opts) {
    const c = COLORS[it.color] || COLORS.ink;
    const rot = it.rot ? ` transform="rotate(${it.rot} ${it.x + (it.w || 0) / 2} ${it.y + (it.h || 0) / 2})"` : '';
    const anim = opts && opts.fresh ? ' wb-fresh' : '';
    const g = inner => `<g class="wb-item wb-${it.type}${anim}" data-id="${esc(it.id)}"${rot}>${inner}</g>`;
    switch (it.type) {
      case 'box': case 'circle': {
        const fill = (NOTE_FILL[it.color] || '#f0fdfa');
        const { fs, lines, h } = shapeText(it);
        const shape = it.type === 'box'
          ? `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${h}" rx="14" fill="${fill}" stroke="${c}" stroke-width="3"/>`
          : `<ellipse cx="${it.x + it.w / 2}" cy="${it.y + h / 2}" rx="${it.w / 2}" ry="${h / 2}" fill="${fill}" stroke="${c}" stroke-width="3"/>`;
        const y0 = it.y + h / 2 - (lines.length - 1) * fs * 0.6 + fs * 0.35;
        return g(shape + lines.map((l, i) => `<text x="${it.x + it.w / 2}" y="${y0 + i * fs * 1.2}" text-anchor="middle" font-family="${SANS}" font-size="${fs}" font-weight="600" fill="${c}">${esc(l)}</text>`).join(''));
      }
      case 'arrow': case 'line': {
        const e = ends(it, all);
        const mid = [(e[0] + e[2]) / 2, (e[1] + e[3]) / 2];
        const head = it.type === 'arrow' ? (() => {
          const ang = Math.atan2(e[3] - e[1], e[2] - e[0]), s = 16;
          return `<path d="M${e[2]} ${e[3]} L${e[2] - s * Math.cos(ang - 0.45)} ${e[3] - s * Math.sin(ang - 0.45)} M${e[2]} ${e[3]} L${e[2] - s * Math.cos(ang + 0.45)} ${e[3] - s * Math.sin(ang + 0.45)}" stroke="${c}" stroke-width="3.5" stroke-linecap="round" fill="none"/>`;
        })() : '';
        const label = it.text ? `<text x="${mid[0]}" y="${mid[1] - 10}" text-anchor="middle" font-family="${HAND}" font-size="24" font-weight="700" fill="${c}" paint-order="stroke" stroke="#ffffff" stroke-width="5">${esc(it.text)}</text>` : '';
        return g(`<path class="wb-stroke" pathLength="1" d="M${e[0]} ${e[1]} L${e[2]} ${e[3]}" stroke="${c}" stroke-width="3.5" stroke-linecap="round" fill="none"/>${head}${label}<path d="M${e[0]} ${e[1]} L${e[2]} ${e[3]}" stroke="transparent" stroke-width="22" fill="none"/>`);
      }
      case 'text': {
        const t = textBox(it);
        return g(t.lines.map((l, i) => `<text x="${it.x}" y="${it.y + it.size * 0.85 + i * it.size * 1.05}" font-family="${HAND}" font-size="${it.size}" font-weight="700" fill="${c}">${esc(l)}</text>`).join('') + `<rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" fill="transparent"/>`);
      }
      case 'note': {
        const h = it.h || noteHeight(it);
        const lines = wrap(it.text, Math.max(8, Math.floor(it.w / 13)));
        return g(`<rect x="${it.x + 4}" y="${it.y + 6}" width="${it.w}" height="${h}" rx="4" fill="rgba(0,0,0,.10)"/><rect x="${it.x}" y="${it.y}" width="${it.w}" height="${h}" rx="4" fill="${NOTE_FILL[it.color] || '#fef3c7'}" stroke="${c}" stroke-opacity=".35"/>` +
          `<rect x="${it.x + it.w / 2 - 30}" y="${it.y - 8}" width="60" height="16" fill="rgba(255,255,255,.65)" stroke="rgba(0,0,0,.08)"/>` +
          lines.map((l, i) => `<text x="${it.x + 16}" y="${it.y + 40 + i * 30}" font-family="${HAND}" font-size="27" font-weight="600" fill="${c === COLORS.ink ? '#1f2937' : c}">${esc(l)}</text>`).join(''));
      }
      case 'diagram': {
        const d = DIAGRAMS[it.name]; if (!d) return '';
        const labels = diagramLabels(it).map(l => {
          const anchor = l.side === 'left' ? 'end' : 'start';
          const lx = l.side === 'left' ? l.tx + 4 : l.tx - 4;
          return `<g class="wb-label"><path class="wb-stroke" pathLength="1" d="M${lx} ${l.ty - 6} L${l.ax} ${l.ay}" stroke="${c}" stroke-width="2" fill="none"/><circle cx="${l.ax}" cy="${l.ay}" r="3.5" fill="${c}"/>` +
            `<text x="${l.tx}" y="${l.ty}" text-anchor="${anchor}" font-family="${HAND}" font-size="25" font-weight="700" fill="${c}">${esc(l.text)}</text></g>`;
        }).join('');
        return g(`<g transform="translate(${it.x} ${it.y}) scale(${it.w / d.w} ${it.h / d.h})">${diagramInner(it.name)}</g><rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="transparent"/>${labels}`);
      }
      case 'ink': {
        const p = it.points;
        let d = `M${p[0][0]} ${p[0][1]}`;
        for (let i = 1; i < p.length - 1; i++) d += ` Q${p[i][0]} ${p[i][1]} ${(p[i][0] + p[i + 1][0]) / 2} ${(p[i][1] + p[i + 1][1]) / 2}`;
        d += ` L${p[p.length - 1][0]} ${p[p.length - 1][1]}`;
        return g(`<path class="wb-stroke" pathLength="1" d="${d}" stroke="${c}" stroke-width="${it.width}" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="${d}" stroke="transparent" stroke-width="${it.width + 16}" fill="none"/>`);
      }
      case 'image':
        return g(`<image href="${it.src}" x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" preserveAspectRatio="xMidYMid meet"/><rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" fill="none" stroke="#e5e7eb" stroke-width="2" rx="8"/>`);
    }
    return '';
  }

  /** The page step [k] is on: from the last step that wiped the board ("clear") to the step before the next one. */
  function pageOf(board, k) {
    let start = 0, end = board.steps.length - 1;
    for (let i = 1; i <= k; i++) if (board.steps[i].clear) start = i;
    for (let i = k + 1; i < board.steps.length; i++) if (board.steps[i].clear) { end = i - 1; break; }
    return { start, end };
  }
  /** Every item shown at step [upto]: the items of the earlier steps on the same page stay on the board. */
  function itemsUpTo(board, upto) {
    const k = Math.max(0, Math.min(upto, board.steps.length - 1)), out = [];
    for (let i = pageOf(board, k).start; i <= k; i++) board.steps[i].items.forEach(it => out.push({ it, step: i }));
    return out;
  }

  /** The board at step [upto] (default: all) as a standalone SVG string. */
  function toSVG(board, upto, opts) {
    const b = normalize(board);
    const k = upto == null ? b.steps.length - 1 : upto;
    const list = itemsUpTo(b, k), all = list.map(x => x.it);
    const o = opts || {};
    const grid = o.grid === false ? '' : `<defs><pattern id="wbgrid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0 L0 0 0 40" fill="none" stroke="#eef2f7" stroke-width="1.2"/></pattern></defs><rect width="${W}" height="${H}" fill="url(#wbgrid)"/>`;
    const title = o.title ? `<text x="24" y="40" font-family="${SANS}" font-size="22" font-weight="700" fill="#0f766e">${esc(b.title)}</text>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * (o.scale || 1)}" height="${H * (o.scale || 1)}"><rect width="${W}" height="${H}" fill="#ffffff"/>${grid}${title}${list.map(x => itemSvg(x.it, all)).join('')}</svg>`;
  }

  /** The board at step [upto] as a PNG data URL (scale 2 = 2000×1280). */
  function toPNG(board, upto, scale) {
    const s = scale || 2;
    const svg = toSVG(board, upto, { scale: s });
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = W * s; cv.height = H * s;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        try { resolve(cv.toDataURL('image/png')); } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('The board could not be turned into a picture.'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }

  // ------------------------------------------------------------------ the interactive board
  const ICON = {
    select: 'M5 3l13 8-6 1.5L9.5 19z', pen: 'M4 20l4-1L19 8l-3-3L5 16zM14 6l3 3', box: 'M4 6h16v12H4z', circle: 'M12 5a7 7 0 1 0 0.01 0z',
    arrow: 'M4 18L18 6M10 6h8v8', text: 'M5 6h14M12 6v13', note: 'M5 4h14v11l-5 5H5zM14 20v-5h5', diagram: 'M12 3a3 3 0 1 0 .01 0zM12 8v6M7 11h10M12 14l-4 6M12 14l4 6',
    undo: 'M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-2', del: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13', bigger: 'M12 5v14M5 12h14', smaller: 'M5 12h14',
    color: 'M12 3a9 9 0 1 0 0 18c1 0 2-1 2-2 0-1-1-1-1-2s1-2 2-2h2a4 4 0 0 0 4-4c0-5-4-8-9-8z', prev: 'M15 5l-7 7 7 7', next: 'M9 5l7 7-7 7',
    play: 'M7 5l12 7-12 7z', pause: 'M7 5h3v14H7zM14 5h3v14h-3z', eraser: 'M15 4l5 5-9 9H6l-3-3zM10 9l5 5M11 18h9', plus: 'M12 5v14M5 12h14', all: 'M4 5h16M4 12h16M4 19h16', picture: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9a1.5 1.5 0 1 0 .01 0',
  };
  const icon = (name, filled) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${ICON[name]}" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  /**
   * Shows [board] in [el] and lets the user work on it.
   * opts: { onChange(board), onStep(index, step), aiPicture: async () => {src, w, h, text} | null (shows the AI picture button) }
   * Returns { board(), setBoard(b, keepStep), step(), go(i), next(), prev(), play(), stop(), addPicture(item), destroy() }.
   */
  function mount(el, initial, opts) {
    const o = opts || {};
    let board = normalize(initial);
    let cur = board.steps.length - 1, tool = 'select', color = 'teal', sel = null, showAll = false, playing = null;
    const undo = [];
    let freshStep = -1;

    el.innerHTML = `<div class="wb">
      <div class="wb-bar" role="toolbar" aria-label="Whiteboard tools">
        ${[['select', 'Select and move'], ['pen', 'Pen'], ['box', 'Box'], ['circle', 'Circle'], ['arrow', 'Arrow'], ['text', 'Handwritten text'], ['note', 'Sticky note'], ['diagram', 'Rehab diagram']]
          .map(([t, l]) => `<button type="button" class="wb-tool" data-tool="${t}" title="${l}" aria-label="${l}">${icon(t)}</button>`).join('')}
        <span class="wb-sep"></span>
        <button type="button" class="wb-tool wb-color" data-act="color" title="Colour" aria-label="Colour">${icon('color')}<i></i></button>
        <button type="button" class="wb-tool" data-act="smaller" title="Smaller" aria-label="Make smaller">${icon('smaller')}</button>
        <button type="button" class="wb-tool" data-act="bigger" title="Bigger" aria-label="Make bigger">${icon('bigger')}</button>
        <button type="button" class="wb-tool" data-act="del" title="Delete" aria-label="Delete the selected item">${icon('del')}</button>
        <button type="button" class="wb-tool" data-act="undo" title="Undo" aria-label="Undo">${icon('undo')}</button>
        ${o.aiPicture ? `<span class="wb-sep"></span><button type="button" class="wb-tool wb-ai" data-act="picture" title="AI picture" aria-label="Add an AI picture">${icon('picture')}<span>AI picture</span></button>` : ''}
      </div>
      <div class="wb-pop" hidden></div>
      <div class="wb-stage"><svg class="wb-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Whiteboard"></svg><textarea class="wb-edit" hidden aria-label="Text"></textarea></div>
      <div class="wb-steps">
        <button type="button" class="wb-nav" data-act="prev" aria-label="Previous step">${icon('prev')}</button>
        <div class="wb-stepinfo"><span class="wb-count"></span><input class="wb-steptitle" aria-label="Step title" maxlength="80"></div>
        <button type="button" class="wb-nav" data-act="next" aria-label="Next step">${icon('next')}</button>
        <button type="button" class="wb-nav" data-act="play" aria-label="Play the steps">${icon('play', true)}</button>
        <button type="button" class="wb-nav" data-act="all" aria-label="Show all steps of this page" title="Show all steps of this page">${icon('all')}</button>
        <button type="button" class="wb-nav" data-act="page" aria-label="Wipe the board at this step" title="Wipe the board at this step (a fresh page)">${icon('eraser')}</button>
        <button type="button" class="wb-nav" data-act="addstep" aria-label="Add a step" title="Add a step">${icon('plus')}</button>
      </div>
      <textarea class="wb-say" rows="2" placeholder="What this step explains…" aria-label="What this step explains" maxlength="600"></textarea>
    </div>`;
    const svg = el.querySelector('.wb-svg'), stage = el.querySelector('.wb-stage'), edit = el.querySelector('.wb-edit'), pop = el.querySelector('.wb-pop');
    const titleIn = el.querySelector('.wb-steptitle'), sayIn = el.querySelector('.wb-say');

    const changed = () => { if (o.onChange) o.onChange(board); };
    const snapshot = () => { undo.push(JSON.stringify(board)); if (undo.length > 40) undo.shift(); };
    const visible = () => itemsUpTo(board, showAll ? pageOf(board, cur).end : cur);
    const findItem = id => { for (const s of board.steps) { const i = s.items.findIndex(x => x.id === id); if (i >= 0) return { step: s, i, it: s.items[i] }; } return null; };

    function render() {
      const list = visible(), all = list.map(x => x.it);
      svg.innerHTML = `<defs><pattern id="wbgrid-m" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0 L0 0 0 40" fill="none" stroke="#eef2f7" stroke-width="1.2"/></pattern></defs><rect class="wb-bg" width="${W}" height="${H}" fill="#ffffff"/><rect width="${W}" height="${H}" fill="url(#wbgrid-m)" pointer-events="none"/>` +
        list.map(x => itemSvg(x.it, all, { fresh: x.step === freshStep })).join('') +
        (sel ? (() => { const f = findItem(sel); if (!f) return ''; const b = bbox(f.it, all); return `<rect class="wb-sel" x="${b.x - 8}" y="${b.y - 8}" width="${b.w + 16}" height="${b.h + 16}" rx="8" fill="none" stroke="#0d9488" stroke-width="2" stroke-dasharray="7 5" pointer-events="none"/>`; })() : '');
      freshStep = -1;
      const s = board.steps[cur];
      el.querySelector('.wb-count').textContent = 'Step ' + (cur + 1) + ' of ' + board.steps.length;
      if (document.activeElement !== titleIn) titleIn.value = s.title;
      if (document.activeElement !== sayIn) sayIn.value = s.say || '';
      el.querySelectorAll('.wb-tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
      el.querySelector('.wb-color i').style.background = COLORS[color];
      el.querySelector('[data-act="all"]').classList.toggle('on', showAll);
      const pageBtn = el.querySelector('[data-act="page"]');
      pageBtn.classList.toggle('on', !!s.clear); pageBtn.disabled = cur === 0;
      el.querySelector('[data-act="play"]').innerHTML = icon(playing ? 'pause' : 'play', true);
      el.querySelector('[data-act="prev"]').disabled = cur === 0;
      el.querySelector('[data-act="next"]').disabled = cur >= board.steps.length - 1;
      stage.classList.toggle('wb-drawing', tool !== 'select');
    }

    function go(i, animate) {
      const n = Math.max(0, Math.min(board.steps.length - 1, i));
      if (animate && n > cur) freshStep = n;
      cur = n; sel = null; showAll = false; closeEdit(); render();
      if (o.onStep) o.onStep(cur, board.steps[cur]);
    }
    function stop() { if (playing) { clearTimeout(playing); playing = null; render(); } }
    function play() {
      stop();
      if (cur >= board.steps.length - 1) go(0, false); else go(cur + 1, true);
      const tick = () => {
        if (cur >= board.steps.length - 1) { playing = null; render(); return; }
        playing = setTimeout(() => { go(cur + 1, true); tick(); }, Math.max(3500, Math.min(12000, (board.steps[cur].say || '').length * 60)));
        render();
      };
      tick();
    }

    // -- pointer → board coordinates
    const pt = e => { const m = svg.getScreenCTM(); if (!m) return [0, 0]; const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const q = p.matrixTransform(m.inverse()); return [Math.max(0, Math.min(W, q.x)), Math.max(0, Math.min(H, q.y))]; };
    let drag = null, lastTap = { id: null, at: 0 };

    function addItem(it) {
      snapshot();
      const fresh = normItem(Object.assign({ color }, it), Object.fromEntries(board.steps.flatMap(s => s.items.map(x => [x.id, 1]))));
      if (!fresh) return null;
      board.steps[cur].items.push(fresh);
      sel = fresh.id; render(); changed();
      return fresh;
    }

    svg.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      stop(); closePop();
      const p = pt(e);
      const g = e.target.closest && e.target.closest('.wb-item');
      if (tool === 'select') {
        if (!g) { sel = null; closeEdit(); render(); return; }
        const id = g.getAttribute('data-id');
        const f = findItem(id);
        if (!f) return;
        const now = Date.now();
        if (lastTap.id === id && now - lastTap.at < 380) { openEdit(f.it); lastTap = { id: null, at: 0 }; return; }
        lastTap = { id, at: now };
        sel = id; render();
        drag = { kind: 'move', id, start: p, moved: false, orig: JSON.stringify(f.it) };
        svg.setPointerCapture(e.pointerId);
        return;
      }
      if (tool === 'text' || tool === 'note') {
        const it = addItem(tool === 'text' ? { type: 'text', x: p[0], y: p[1] - 20, text: '', size: 32 } : { type: 'note', x: Math.min(p[0], W - 280), y: p[1], w: 260, text: '' });
        if (it) openEdit(it, true);
        return;
      }
      if (tool === 'diagram') { openDiagramPicker(p); return; }
      drag = { kind: tool, start: p, points: [p] };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener('pointermove', e => {
      if (!drag) return;
      const p = pt(e);
      if (drag.kind === 'move') {
        const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1];
        if (!drag.moved && Math.hypot(dx, dy) < 4) return;
        if (!drag.moved) { snapshot(); drag.moved = true; }
        const f = findItem(drag.id); if (!f) return;
        const orig = JSON.parse(drag.orig), it = f.it;
        if (it.type === 'ink') it.points = orig.points.map(q => [q[0] + dx, q[1] + dy]);
        else if (it.type === 'arrow' || it.type === 'line') {
          const e0 = ends(orig, visible().map(x => x.it));
          delete it.from; delete it.to;
          it.x = e0[0] + dx; it.y = e0[1] + dy; it.x2 = e0[2] + dx; it.y2 = e0[3] + dy;
        } else { it.x = orig.x + dx; it.y = orig.y + dy; }
        render();
        return;
      }
      drag.points.push(p);
      drawPreview(drag, p);
    });
    const endDrag = e => {
      if (!drag) return;
      const d = drag; drag = null;
      try { svg.releasePointerCapture(e.pointerId); } catch (x) { /* already released */ }
      const prev = svg.querySelector('.wb-preview'); if (prev) prev.remove();
      if (d.kind === 'move') { if (d.moved) changed(); return; }
      const p = pt(e), s = d.start;
      const w = Math.abs(p[0] - s[0]), h = Math.abs(p[1] - s[1]);
      if (d.kind === 'pen') { if (d.points.length > 1) addItem({ type: 'ink', points: d.points.filter((q, i) => i % 2 === 0 || i === d.points.length - 1), width: 4 }); return; }
      if (d.kind === 'arrow') { addItem(w + h < 12 ? { type: 'arrow', x: s[0], y: s[1], x2: s[0] + 140, y2: s[1] } : { type: 'arrow', x: s[0], y: s[1], x2: p[0], y2: p[1] }); return; }
      const big = w > 20 && h > 20;
      const it = addItem({ type: d.kind, x: big ? Math.min(s[0], p[0]) : s[0] - 110, y: big ? Math.min(s[1], p[1]) : s[1] - 40, w: big ? w : 220, h: big ? h : 80, text: '' });
      if (it) openEdit(it, true);
    };
    svg.addEventListener('pointerup', endDrag);
    svg.addEventListener('pointercancel', endDrag);

    function drawPreview(d, p) {
      let prev = svg.querySelector('.wb-preview');
      if (!prev) { prev = document.createElementNS('http://www.w3.org/2000/svg', 'g'); prev.setAttribute('class', 'wb-preview'); svg.appendChild(prev); }
      const c = COLORS[color], s = d.start;
      if (d.kind === 'pen') prev.innerHTML = `<polyline points="${d.points.map(q => q.join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;
      else if (d.kind === 'arrow') prev.innerHTML = `<line x1="${s[0]}" y1="${s[1]}" x2="${p[0]}" y2="${p[1]}" stroke="${c}" stroke-width="3.5" stroke-linecap="round"/>`;
      else if (d.kind === 'box') prev.innerHTML = `<rect x="${Math.min(s[0], p[0])}" y="${Math.min(s[1], p[1])}" width="${Math.abs(p[0] - s[0])}" height="${Math.abs(p[1] - s[1])}" rx="14" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="8 6"/>`;
      else if (d.kind === 'circle') prev.innerHTML = `<ellipse cx="${(s[0] + p[0]) / 2}" cy="${(s[1] + p[1]) / 2}" rx="${Math.abs(p[0] - s[0]) / 2}" ry="${Math.abs(p[1] - s[1]) / 2}" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="8 6"/>`;
    }

    // -- writing on an item (text, note, box, circle, arrow label)
    let editing = null;
    function openEdit(it, isNew) {
      if (['text', 'note', 'box', 'circle', 'arrow', 'line'].indexOf(it.type) < 0) return;
      editing = { id: it.id, isNew: !!isNew, before: it.text || '' };
      const r = svg.getBoundingClientRect(), k = r.width / W, sr = stage.getBoundingClientRect();
      const b = bbox(it, visible().map(x => x.it));
      edit.hidden = false;
      edit.value = it.text || '';
      edit.style.left = Math.max(0, (r.left - sr.left) + b.x * k) + 'px';
      edit.style.top = Math.max(0, (r.top - sr.top) + b.y * k) + 'px';
      edit.style.width = Math.max(160, Math.min(sr.width - 8, (b.w || 200) * k)) + 'px';
      edit.placeholder = it.type === 'note' ? 'Write the note…' : 'Write here…';
      setTimeout(() => edit.focus(), 0);
    }
    function closeEdit(commit) {
      if (!editing) return;
      const f = findItem(editing.id), was = editing;
      editing = null; edit.hidden = true;
      if (!f) return;
      if (commit !== false) {
        const text = edit.value.replace(/\s+/g, ' ').trim().slice(0, f.it.type === 'note' ? 220 : 160);
        if (!text && (f.it.type === 'text' || f.it.type === 'note')) { f.step.items.splice(f.i, 1); sel = null; render(); changed(); return; }
        if (text !== was.before) { if (!was.isNew) snapshot(); f.it.text = text; if (f.it.type === 'note') f.it.h = 0; render(); changed(); }
      }
    }
    edit.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeEdit(); } if (e.key === 'Escape') closeEdit(); });
    edit.addEventListener('blur', () => closeEdit());

    // -- popovers: colours and the diagram library
    function closePop() { pop.hidden = true; pop.innerHTML = ''; }
    function openDiagramPicker(p) {
      pop.innerHTML = '<div class="wb-pop-title">Rehab diagrams</div><div class="wb-lib">' + Object.keys(DIAGRAMS).map(k => {
        const d = DIAGRAMS[k];
        return `<button type="button" class="wb-libitem" data-diagram="${k}"><svg viewBox="-6 -6 ${d.w + 12} ${d.h + 12}">${diagramInner(k)}</svg><span>${esc(d.label)}</span></button>`;
      }).join('') + '</div>';
      pop.hidden = false;
      pop.onclick = ev => {
        const b = ev.target.closest('[data-diagram]'); if (!b) return;
        const d = DIAGRAMS[b.dataset.diagram];
        const w = Math.min(340, 300 * d.w / Math.max(d.w, d.h) * 1.4);
        addItem({ type: 'diagram', name: b.dataset.diagram, x: Math.max(150, Math.min(W - w - 150, p[0] - w / 2)), y: Math.max(20, Math.min(H - 40 - w * d.h / d.w, p[1] - 60)), w, labels: [] });
        closePop(); tool = 'select'; render();
      };
    }
    function openColors() {
      pop.innerHTML = '<div class="wb-pop-title">Colour</div><div class="wb-colors">' + COLOR_KEYS.map(k => `<button type="button" class="wb-swatch${k === color ? ' on' : ''}" data-color="${k}" style="background:${COLORS[k]}" aria-label="${k}"></button>`).join('') + '</div>';
      pop.hidden = false;
      pop.onclick = ev => {
        const b = ev.target.closest('[data-color]'); if (!b) return;
        color = b.dataset.color;
        if (sel) { const f = findItem(sel); if (f) { snapshot(); f.it.color = color; changed(); } }
        closePop(); render();
      };
    }

    function resize(f) {
      if (!sel) return;
      const x = findItem(sel); if (!x) return;
      const it = x.it; snapshot();
      if (it.type === 'text') it.size = Math.max(14, Math.min(72, it.size * f));
      else if (it.type === 'ink') { const b = bbox(it); it.points = it.points.map(q => [b.x + (q[0] - b.x) * f, b.y + (q[1] - b.y) * f]); }
      else if (it.type === 'arrow' || it.type === 'line') return;
      else if (it.type === 'diagram') { const d = DIAGRAMS[it.name]; it.w = Math.max(80, Math.min(900, it.w * f)); it.h = it.w * d.h / d.w; }
      else { it.w = Math.max(40, Math.min(W, it.w * f)); if (it.h) it.h = Math.max(30, Math.min(H, it.h * f)); }
      render(); changed();
    }

    el.querySelector('.wb').addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b || b.closest('.wb-pop')) return;
      if (b.dataset.tool) { tool = b.dataset.tool; sel = null; closePop(); if (tool === 'diagram') openDiagramPicker([W / 2, H / 2]); render(); return; }
      switch (b.dataset.act) {
        case 'color': if (pop.hidden) openColors(); else closePop(); break;
        case 'bigger': resize(1.15); break;
        case 'smaller': resize(0.87); break;
        case 'del': if (sel) { const f = findItem(sel); if (f) { snapshot(); f.step.items.splice(f.i, 1); sel = null; render(); changed(); } } break;
        case 'undo': if (undo.length) { board = normalize(JSON.parse(undo.pop())); cur = Math.min(cur, board.steps.length - 1); sel = null; render(); changed(); } break;
        case 'prev': stop(); go(cur - 1); break;
        case 'next': stop(); go(cur + 1, true); break;
        case 'play': if (playing) stop(); else play(); break;
        case 'all': showAll = !showAll; sel = null; render(); break;
        case 'page': if (cur > 0) { snapshot(); board.steps[cur].clear = !board.steps[cur].clear; sel = null; render(); changed(); } break;
        case 'addstep':
          if (board.steps.length >= MAX_STEPS) break;
          snapshot(); board.steps.splice(cur + 1, 0, { title: 'Step ' + (cur + 2), say: '', items: [] }); go(cur + 1); changed(); setTimeout(() => titleIn.select(), 0); break;
        case 'picture': {
          if (!o.aiPicture) break;
          b.disabled = true; b.classList.add('busy');
          try { const pic = await o.aiPicture(board, cur); if (pic && pic.src) addPicture(pic); }
          finally { b.disabled = false; b.classList.remove('busy'); }
          break;
        }
      }
    });
    titleIn.addEventListener('change', () => { const v = str(titleIn.value, 80); if (v && v !== board.steps[cur].title) { snapshot(); board.steps[cur].title = v; changed(); } render(); });
    sayIn.addEventListener('change', () => { const v = str(sayIn.value, 600); if (v !== board.steps[cur].say) { snapshot(); board.steps[cur].say = v; changed(); } });
    const onKey = e => {
      if (!el.isConnected) return;
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); el.querySelector('[data-act="del"]').click(); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); el.querySelector('[data-act="undo"]').click(); }
      if (e.key === 'ArrowRight' && !sel) go(cur + 1, true);
      if (e.key === 'ArrowLeft' && !sel) go(cur - 1);
    };
    document.addEventListener('keydown', onKey);

    /** Adds an AI picture ({src, w, h, text}) to the current step, in the first free corner. */
    function addPicture(pic) {
      const imgs = board.steps.reduce((n, s) => n + s.items.filter(i => i.type === 'image').length, 0);
      if (imgs >= MAX_IMAGES) return null;
      const w = 300, h = Math.round(300 * (pic.h || 1) / (pic.w || 1));
      return addItem({ type: 'image', src: pic.src, x: W - w - 30, y: 30, w, h: Math.min(h, H - 60), text: pic.text || '' });
    }

    render();
    return {
      board: () => board,
      setBoard(b, keepStep) { board = normalize(b); cur = keepStep ? Math.min(cur, board.steps.length - 1) : board.steps.length - 1; sel = null; render(); },
      step: () => cur,
      go: i => go(i, true), next: () => go(cur + 1, true), prev: () => go(cur - 1), play, stop, addPicture,
      destroy() { stop(); document.removeEventListener('keydown', onKey); el.innerHTML = ''; },
    };
  }

  root.RehablixWhiteboard = { W, H, COLORS, DIAGRAMS, MAX_STEPS, MAX_IMAGES, diagramKey, buildPrompt, buildRevisePrompt, parseBoard, normalize, leanBoard, keepHandwork, toSVG, toPNG, mount };
})(typeof window !== 'undefined' ? window : this);
