// js/whiteboard/whiteboard-engine.js — Lixa's Whiteboard: a hand-drawn explainer lesson, written and narrated live.
//
// ONE file for both platforms (as js/deck/deck-engine.js): the web app loads it here, and the Android app ships a
// byte-for-byte copy in app/src/main/assets/whiteboard/ and runs it in a WebView (whiteboard/WhiteboardWeb.kt).
// After editing this file, copy it (and css/whiteboard-engine.css) to the Android assets.
//
// 2026-10-25 (the owner: "a whiteboard tool that would wow users… explain anything whichever way the user asks,
// dynamic, sophisticated and relatable"; not an editor: the AI does everything; short / moderate / long / auto):
//   * plan():   one AI call plans the lesson — scenes, each with its own goal and visual idea;
//   * player:   each scene is written by the AI while the one before plays, as "beats": 1-3 spoken sentences and the
//               drawings made WHILE they are said. A hand with a marker draws them in step with Lixa's voice;
//               the drawing waits for the voice, never the other way round;
//   * visuals:  people in poses, ~40 hand-drawn icons, the AI's own sketches, rehab diagrams, flows, cycles,
//               comparisons, timelines, charts, lists, call-outs, equations, emphasis on what is already drawn,
//               and (Pro / Max, when switched on) AI pictures;
//   * ask:      the learner asks about the lesson and Lixa adds a scene that answers it, on the spot.
// The host (web page or Android) gives the AI calls, Lixa's voice, saving and pictures; see mount().
(function (root) {
  'use strict';

  const W = 1000, H = 640;
  const HAND = "'Caveat','Kalam','Patrick Hand','Dancing Script','Segoe Print',cursive";
  const BODY = "'Patrick Hand','Kalam','Caveat','Dancing Script','Segoe Print',cursive";
  const SANS = "'Inter','Segoe UI',Roboto,Arial,sans-serif";
  /** Marker colours, and the light wash each one fills with. */
  const COLORS = { ink: '#1b1f24', blue: '#1d4ed8', red: '#c1121f', green: '#15803d', orange: '#ea580c', purple: '#6d28d9', teal: '#0f766e', gray: '#64748b' };
  const SOFT = { ink: '#f1f5f9', blue: '#dbeafe', red: '#fee2e2', green: '#dcfce7', orange: '#ffedd5', purple: '#ede9fe', teal: '#ccfbf1', gray: '#f1f5f9', yellow: '#fef08a' };
  const LENGTHS = {
    short: { label: 'Short', scenes: '3 to 4', words: 110, maxTokens: 2400 },
    moderate: { label: 'Moderate', scenes: '5 to 7', words: 170, maxTokens: 3200 },
    long: { label: 'Long', scenes: '9 to 12', words: 240, maxTokens: 4200 },
    auto: { label: 'Auto', scenes: '3 to 8 (you decide from how much the topic needs)', words: 170, maxTokens: 3400 },
  };
  /** How fast Lixa speaks (words a second): the drawing of a beat is spread over this long. */
  const WORDS_PER_SECOND = 2.5;

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

  // ------------------------------------------------------------------ small helpers
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
  const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let idSeq = 0;
  const newId = () => 'i' + Date.now().toString(36) + (idSeq++).toString(36);
  const words = s => String(s || '').trim().split(/\s+/).filter(Boolean).length;
  /** How long [text] takes to say, in ms. */
  const speechMs = text => Math.max(1400, words(text) / WORDS_PER_SECOND * 1000 + 300);
  /** Spoken sentences of a beat (what the voice says one at a time). */
  function sentencesOf(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    return (t.match(/[^.!?]+(?:[.!?]+["')\]]*|$)/g) || [t]).map(s => s.trim()).filter(Boolean);
  }
  function wrap(text, maxChars) {
    const ws = String(text || '').split(/\s+/).filter(Boolean), lines = [];
    let cur = '';
    ws.forEach(w => { if ((cur + ' ' + w).trim().length > maxChars && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); });
    if (cur) lines.push(cur);
    return lines;
  }
  /** Characters of handwriting that fit in [w] px at [size]. */
  const fit = (w, size) => Math.max(6, Math.floor(w / (size * 0.47)));
  const textW = (s, size) => String(s || '').length * size * 0.47;
  function extractJson(raw) {
    const s = String(raw || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('The SI reply was not understood.');
    return JSON.parse(s.slice(a, b + 1));
  }

  // ------------------------------------------------------------------ the lesson
  // lesson = { v: 2, title, subject, request, level, length, outline: [{title, goal, visual}],
  //            scenes: [{ title, goal, visual, followup?, status: 'empty'|'ready'|'failed', beats: [{ say, draw: [item] }] }] }
  // (status 'writing' exists only while a scene is being written; it is saved as 'empty')
  function normalizeLesson(src) {
    const o = src && typeof src === 'object' ? src : {};
    // a board from the first whiteboard (steps of items): each step becomes a scene of one beat
    if (!o.v && Array.isArray(o.steps)) {
      const scenes = o.steps.map(s => ({ title: str(s && s.title, 80) || 'Scene', goal: '', visual: '', status: 'ready', beats: [{ say: str(s && s.say, 900), draw: (s && s.items) || [] }] }));
      return normalizeLesson({ v: 2, title: o.title, subject: o.subject, request: o.title, length: 'auto', scenes });
    }
    const length = LENGTHS[o.length] ? o.length : 'auto';
    const scenes = (Array.isArray(o.scenes) ? o.scenes : []).slice(0, 24).map(s => {
      const sc = { title: str(s && s.title, 80) || 'Scene', goal: str(s && s.goal, 300), visual: str(s && s.visual, 300), status: s && s.status === 'ready' ? 'ready' : (s && s.status === 'failed' ? 'failed' : 'empty'), beats: [] };
      if (s && s.followup) sc.followup = str(s.followup, 600);
      const used = {};
      (Array.isArray(s && s.beats) ? s.beats : []).slice(0, 16).forEach(b => { const nb = normBeat(b, used); if (nb) sc.beats.push(nb); });
      if (sc.status === 'ready' && !sc.beats.length) sc.status = 'empty';
      return sc;
    });
    return { v: 2, title: str(o.title, 100) || 'Whiteboard lesson', subject: str(o.subject, 60), request: str(o.request, 2000), level: str(o.level, 120), length, scenes };
  }
  function normBeat(b, used) {
    if (!b || typeof b !== 'object') return null;
    const say = str(b.say, 900);
    const draw = (Array.isArray(b.draw) ? b.draw : (b.draw ? [b.draw] : [])).slice(0, 5).map(it => normItem(it, used)).filter(Boolean);
    if (!say && !draw.length) return null;
    return { say, draw };
  }
  // (what is saved: a scene being written is saved as not written; a picture being made is not saved)
  const leanLesson = l => JSON.parse(JSON.stringify(l, (k, v) => (k === 'pending' ? undefined : k === 'status' && v === 'writing' ? 'empty' : v)));

  // ------------------------------------------------------------------ the prompts
  const VOCAB = [
    'ITEMS you can draw (x, y = top-left corner on the 1000 x 640 board; colours: ink, blue, red, green, orange, purple, teal):',
    '{"id": "p1", "type": "person", "x": 80, "y": 200, "h": 200, "pose": "stand|walk|run|sit|wave|point|think|happy|hop|hurt|lift-weights|lift-box|squat|reach|lie|wheelchair|crutches|cane", "facing": "right|left", "mood": "neutral|happy|sad|pain", "label": "Mrs Ade, 68", "say": "My knee locks!"}  (a person acting the idea out; pick the pose that matches the story: hop = on one leg holding a hurt foot, hurt = bent over clutching a knee, lift-weights = barbell overhead; "say" draws a speech bubble)',
    '{"id": "c1", "type": "icon", "name": "<icon>", "x": 400, "y": 200, "size": 120, "label": "words", "color": "red"}  icons: ' + 'ICON_NAMES',
    '{"id": "s1", "type": "sketch", "x": 600, "y": 160, "w": 300, "h": 220, "paths": ["M10 80 C40 20 ...", "..."], "fill": "blue", "label": "a seatbelt"}  (YOUR OWN line drawing of anything not in the lists, in a 100 x 100 box: simple clear strokes, like an analogy picture: a seatbelt, a bridge, a sponge, a traffic jam, a rope, a plant growing)',
    '{"id": "d1", "type": "diagram", "name": "<diagram>", "x": 160, "y": 110, "w": 300, "labels": [{"part": "<part>", "text": "<1-3 words>"}]}  (labels are drawn beside it: leave ~150 px free on each side) diagrams: DIAGRAMS_LIST',
    '{"id": "f1", "type": "flow", "x": 60, "y": 260, "w": 880, "h": 120, "steps": ["Injury", "Swelling", "Stiffness", "Weakness"], "dir": "row|col", "color": "blue"}  (a chain of boxes with arrows: causes, stages, a process)',
    '{"id": "y1", "type": "cycle", "x": 560, "y": 120, "w": 380, "h": 380, "steps": ["Pain", "Fear", "Avoid moving", "Weakness"], "color": "red"}  (a vicious or healthy circle)',
    '{"id": "v1", "type": "compare", "x": 60, "y": 120, "w": 880, "h": 420, "columns": [{"title": "Acute", "points": ["< 6 weeks", "rest + ice"]}, {"title": "Chronic", "points": ["> 3 months", "graded activity"]}]}  (2-3 columns side by side)',
    '{"id": "t1", "type": "timeline", "x": 60, "y": 300, "w": 880, "events": [{"label": "Week 0-2", "text": "protect"}, {"label": "Week 2-6", "text": "move"}]}',
    '{"id": "g1", "type": "chart", "kind": "bar|line|pie", "x": 560, "y": 140, "w": 380, "h": 300, "labels": ["2010", "2020"], "values": [12, 30], "unit": "%", "title": "Stroke survivors"}  (only with real, well-known figures)',
    '{"id": "l1", "type": "list", "x": 520, "y": 140, "w": 440, "items": ["point one", "point two"], "numbered": true, "size": 30}  (2-6 short lines)',
    '{"id": "b1", "type": "box", "x": 100, "y": 200, "w": 260, "h": 90, "text": "short words", "color": "blue"}  /  "type": "circle" the same',
    '{"id": "a1", "type": "arrow", "from": "b1", "to": "c1", "text": "leads to", "curve": 0.3}  (or "x","y","x2","y2"; "curve" -1..1 bends it)  /  "type": "line" the same without a head',
    '{"id": "n1", "type": "note", "x": 620, "y": 420, "w": 320, "text": "a key point to remember", "color": "orange"}  (a sticky note)',
    '{"id": "k1", "type": "callout", "x": 600, "y": 120, "w": 300, "text": "Did you know…?", "to": "p1"}  (a speech / thought bubble pointing at an item)',
    '{"id": "e1", "type": "equation", "x": 300, "y": 300, "text": "Force = mass × acceleration", "size": 44}',
    '{"id": "w1", "type": "text", "x": 80, "y": 520, "text": "handwritten words", "size": 34, "color": "red"}',
    '{"type": "emphasis", "target": "d1", "style": "circle|underline|tick|cross|star|highlight|box", "color": "red"}  (mark something ALREADY drawn, when you point at it)',
  ].join('\n');

  function vocabText() {
    return VOCAB.replace('ICON_NAMES', Object.keys(ICONS).join(', '))
      .replace('DIAGRAMS_LIST', Object.keys(DIAGRAMS).map(k => k + ' (parts: ' + Object.keys(DIAGRAMS[k].parts).slice(0, 10).join(', ') + ')').join('; '));
  }

  const TEACHER = 'You are Lixa, a brilliant, warm teacher who makes whiteboard explainer videos, the hand-drawn kind people love to watch on YouTube. ' +
    'You can explain anything, in whatever way the learner asks: simply for a child, rigorously for an exam, with stories, analogies, humour or real cases. ' +
    'Health, rehabilitation and medicine are your home ground: there you are accurate, current and evidence-based. Never include a patient\'s real name or other identifier.';

  /** The plan of a lesson: opts { request, length (short|moderate|long|auto), level }. */
  function planPrompt(opts) {
    const o = opts || {}, L = LENGTHS[o.length] || LENGTHS.auto;
    const system = TEACHER + '\n\nPlan ONE whiteboard lesson for the learner\'s request. Return ONLY one JSON object, no markdown:\n' +
      '{"title": "<an inviting title>", "subject": "<e.g. Physiotherapy, Neuroscience, Everyday science>", "scenes": [{"title": "<2-6 words>", "goal": "<what this scene makes the learner understand, 1 sentence>", "visual": "<the concrete visual idea: who or what is drawn and how, e.g. \'a runner whose knee buckles as she pivots, then the knee diagram with the ACL circled\'>"}]}\n\n' +
      'Use ' + L.scenes + ' scenes. A great lesson: opens with a hook the learner can relate to (a situation, a story, a surprising fact or a question); builds the idea one clear step at a time; makes it concrete with everyday analogies and real examples; ' +
      'clears up a common mistake when there is one; ends with a short recap and a question to think about. ' +
      'Give every scene a DIFFERENT kind of visual (people acting it out, an analogy sketch, a labelled diagram, a flow, a cycle, a side-by-side comparison, a timeline, a chart, a mnemonic list, icons…). ' +
      'Whatever the learner says about style, depth, audience, tone, examples or length comes first.';
    const user = 'LEARNER\'S REQUEST: ' + str(o.request, 2000) + (o.level ? '\nAUDIENCE: ' + str(o.level, 120) : '') + '\nLENGTH: ' + L.label;
    return { system, user, maxTokens: 1600 };
  }

  /** Reads the AI's plan into a lesson (scenes not written yet). */
  function parsePlan(raw, opts) {
    const p = extractJson(raw), o = opts || {};
    const scenes = (Array.isArray(p.scenes) ? p.scenes : []).slice(0, 14).map(s => ({ title: s && s.title, goal: s && s.goal, visual: s && s.visual, status: 'empty', beats: [] }));
    if (!scenes.length) throw new Error('The SI did not plan any scenes. Please try again.');
    return normalizeLesson({ v: 2, title: p.title, subject: p.subject, request: o.request, level: o.level, length: o.length, scenes });
  }

  /** The prompt for scene [k] of [lesson]: written as a stream of beats, one JSON object a line. */
  function scenePrompt(lesson, k, opts) {
    const L = LENGTHS[lesson.length] || LENGTHS.auto, sc = lesson.scenes[k], o = opts || {};
    const system = TEACHER + '\n\n' +
      'You are now writing ONE scene of the lesson: you talk and draw at the same time. Write it as a STREAM of beats, one JSON object per line and nothing else (no array, no markdown, no blank lines):\n' +
      '{"say": "<1 to 3 spoken sentences>", "draw": [ITEM, ...]}\n' +
      (sc.followup ? 'The FIRST line is the scene\'s title: {"title": "<2-6 words>"}.\n' : '') +
      'Each beat\'s "draw" holds the 0 to 3 items that appear WHILE you say those sentences: exactly what the words are about at that moment (say "imagine Mrs Ade climbing stairs" while you draw her on the stairs). ' +
      'Use about ' + Math.round(L.words * 0.8) + ' to ' + Math.round(L.words * 1.25) + ' spoken words in 4 to 9 beats. The scene\'s title is written for you at the top of a clean board.\n\n' +
      'HOW TO TEACH: speak like a real person, warm and confident (contractions, "imagine…", "notice…", "here\'s the thing", a question now and then); one idea per beat; build the picture up piece by piece; ' +
      'use people, stories and everyday analogies; when you come back to something already drawn, point at it with an "emphasis" item (its id); explain what the drawing means instead of reading it out; ' +
      'numbers and facts must be correct; end the scene with a clear takeaway. Never say "in this scene", "on the whiteboard" or "next slide".\n\n' +
      vocabText() + '\n' +
      (o.picture ? 'You may also use at most one {"id": "q1", "type": "picture", "x": 600, "y": 130, "w": 340, "h": 260, "prompt": "<what an AI illustration should show>"} when a real-looking picture truly helps.\n' : '') +
      '\nLAYOUT: the board is 1000 wide and 640 high; keep everything inside x 30-970 and y 100-620 (the title uses the top). Plan the whole page before the first beat so that later items have room; ' +
      'leave 25 px between items and never overlap; prefer a few big, clear drawings to many small ones; text big enough to read (size 26-44). Ids are unique within the scene.';
    const outline = lesson.scenes.map((s, i) => (i + 1) + '. ' + s.title + (s.goal ? ': ' + s.goal : '') + (i === k ? '   <== THIS SCENE' : '')).join('\n');
    const before = lesson.scenes.slice(0, k).filter(s => s.beats.length).map((s, i) => '- ' + s.title + ': ' + s.beats.map(b => b.say).join(' ').slice(0, 260)).join('\n');
    const user = 'LESSON: ' + lesson.title + (lesson.subject ? ' (' + lesson.subject + ')' : '') +
      '\nTHE LEARNER ASKED FOR: ' + (lesson.request || lesson.title) + (lesson.level ? '\nAUDIENCE: ' + lesson.level : '') + '\nLENGTH: ' + L.label +
      '\n\nTHE LESSON\'S SCENES:\n' + outline +
      (before ? '\n\nALREADY SAID (do not repeat it; build on it):\n' + before : '') +
      '\n\nWRITE SCENE ' + (k + 1) + ' of ' + lesson.scenes.length + ': "' + sc.title + '"' + (sc.goal ? '\nGOAL: ' + sc.goal : '') + (sc.visual ? '\nVISUAL IDEA: ' + sc.visual : '') +
      (sc.followup ? '\n\nTHE LEARNER JUST ASKED: "' + sc.followup + '". Answer it fully in this scene, linking it to the lesson. Give it a fitting title on the first line.' : '');
    return { system, user, maxTokens: L.maxTokens };
  }

  /** Reads a scene as it streams in: push(text) with each piece, end() when it stops. emit({type: 'title'|'beat', …}). */
  function sceneParser(emit) {
    let buf = '', all = '', any = false;
    function route(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o.beats)) { if (o.title) emit({ type: 'title', title: o.title }); o.beats.forEach(b => emit({ type: 'beat', beat: b })); any = true; return; }
      if (o.say != null || o.draw != null) { emit({ type: 'beat', beat: o }); any = true; return; }
      if (o.title && Object.keys(o).length <= 2) emit({ type: 'title', title: o.title });
    }
    function line(l) {
      const s = String(l).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').replace(/^[[,\s]+/, '').replace(/[\],\s]+$/, '').trim();
      if (!s || s.charAt(0) !== '{') return;
      let o; try { o = JSON.parse(s); } catch (e) { return; }
      route(o);
    }
    return {
      push(t) { const x = String(t || ''); buf += x; all += x; let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); } },
      end() {
        if (buf.trim()) line(buf);
        buf = '';
        if (!any) { try { route(extractJson(all)); } catch (e) { /* nothing usable */ } }
        return any;
      },
    };
  }

  // ------------------------------------------------------------------ the icon library (hand-drawn line art in a 100 x 100 box)
  // each shape: ['c', cx, cy, r, fill?] a circle, ['p', d, fill?] a path; fill 'soft' = the colour's light wash
  const ICONS = {
    person: [['c', 50, 20, 11], ['p', 'M50 31 V62 M50 40 L32 54 M50 40 L68 54 M50 62 L38 88 M50 62 L62 88']],
    brain: [['p', 'M50 24 C40 14 22 20 24 34 C12 38 12 56 24 60 C22 74 38 82 50 72 C62 82 78 74 76 60 C88 56 88 38 76 34 C78 20 60 14 50 24 Z', 'soft'], ['p', 'M50 24 V72 M36 34 C42 40 40 48 32 50 M64 34 C58 40 60 48 68 50 M38 62 C42 58 46 58 50 60 M62 62 C58 58 54 58 50 60']],
    heart: [['p', 'M50 82 C22 62 14 46 20 34 C28 20 44 22 50 36 C56 22 72 20 80 34 C86 46 78 62 50 82 Z', 'soft'], ['p', 'M30 50 H40 L45 40 L52 60 L57 50 H70']],
    lungs: [['p', 'M50 16 V46 M50 40 C46 44 42 48 40 54 M50 40 C54 44 58 48 60 54'], ['p', 'M40 30 C24 32 18 54 20 72 C22 84 36 82 42 76 C46 68 46 46 40 30 Z', 'soft'], ['p', 'M60 30 C76 32 82 54 80 72 C78 84 64 82 58 76 C54 68 54 46 60 30 Z', 'soft']],
    bone: [['p', 'M30 24 C22 16 12 26 20 32 C12 38 22 48 28 40 L60 72 C52 80 62 88 68 80 C74 88 86 78 78 72 C86 64 76 56 70 62 L38 30 C44 24 36 16 30 24 Z', 'soft']],
    muscle: [['p', 'M16 74 C28 70 40 68 46 62 C42 50 44 38 54 30 C62 24 72 28 70 36 C68 42 62 42 58 40 C56 46 56 52 60 56 C70 48 86 54 84 68 C82 82 62 84 46 82 C34 82 22 80 16 78 Z', 'soft']],
    clock: [['c', 50, 50, 36, 'soft'], ['p', 'M50 26 V50 L66 60 M50 18 V22 M50 78 V82 M18 50 H22 M78 50 H82']],
    bulb: [['p', 'M50 12 C32 12 22 30 30 46 C34 54 40 58 40 66 H60 C60 58 66 54 70 46 C78 30 68 12 50 12 Z', 'soft'], ['p', 'M40 74 H60 M42 82 H58 M45 66 L45 52 L50 56 L55 52 L55 66 M18 20 L24 26 M82 20 L76 26 M50 2 V6']],
    warning: [['p', 'M50 12 L90 84 H10 Z', 'soft'], ['p', 'M50 36 V60 M50 70 V72']],
    check: [['p', 'M18 52 L40 74 L84 26']],
    cross: [['p', 'M22 22 L78 78 M78 22 L22 78']],
    question: [['c', 50, 50, 38, 'soft'], ['p', 'M38 38 C38 24 62 22 62 38 C62 48 50 48 50 60 M50 70 V72']],
    book: [['p', 'M50 24 C40 18 26 18 14 22 V80 C26 76 40 76 50 82 C60 76 74 76 86 80 V22 C74 18 60 18 50 24 Z', 'soft'], ['p', 'M50 24 V82 M24 34 H40 M24 44 H40 M60 34 H76 M60 44 H76']],
    hospital: [['p', 'M16 86 V36 H84 V86 Z', 'soft'], ['p', 'M40 86 V68 H60 V86 M50 44 V60 M42 52 H58 M30 36 V20 H70 V36 M24 70 H32 M68 70 H76']],
    wheelchair: [['c', 42, 18, 8], ['p', 'M42 28 V56 H64 L72 76 M42 40 H62'], ['c', 46, 72, 18], ['c', 76, 82, 5]],
    walker: [['p', 'M24 86 L32 24 H68 L76 86 M30 50 H70 M24 86 H34 M66 86 H76']],
    crutch: [['p', 'M34 12 H54 M44 12 L40 88 M36 46 H50 M36 88 H46']],
    dumbbell: [['p', 'M30 50 H70 M24 34 V66 M16 40 V60 M76 34 V66 M84 40 V60']],
    ball: [['c', 50, 50, 34, 'soft'], ['p', 'M18 40 C40 50 60 50 82 40 M18 60 C40 50 60 50 82 60 M50 16 V84']],
    shoe: [['p', 'M16 66 C16 48 24 40 34 40 L44 52 C54 58 70 58 82 62 C88 64 88 76 82 76 H20 C16 76 16 72 16 66 Z', 'soft'], ['p', 'M34 40 L40 30 M44 52 L50 46 M52 56 L58 50']],
    hand: [['p', 'M34 86 C26 74 22 58 24 48 C26 42 32 44 34 50 V26 C34 20 42 20 42 26 V46 V20 C42 14 50 14 50 20 V46 V24 C50 18 58 18 58 24 V48 V32 C58 26 66 26 66 32 V60 C66 74 60 84 56 86 Z', 'soft']],
    eye: [['p', 'M10 50 C28 26 72 26 90 50 C72 74 28 74 10 50 Z', 'soft'], ['c', 50, 50, 13], ['c', 50, 50, 4]],
    ear: [['p', 'M62 26 C52 12 28 16 28 40 C28 54 40 54 40 66 C40 80 54 86 62 76 M44 42 C44 32 56 32 56 42 C56 50 46 50 48 58']],
    speech: [['p', 'M14 22 H86 V66 H44 L28 82 V66 H14 Z', 'soft'], ['p', 'M28 38 H72 M28 50 H60']],
    pill: [['p', 'M30 70 L70 30 C80 20 94 34 84 44 L44 84 C34 94 20 80 30 70 Z', 'soft'], ['p', 'M50 50 L64 64']],
    syringe: [['p', 'M30 70 L62 38 L74 50 L42 82 Z', 'soft'], ['p', 'M20 80 L30 70 M62 38 L70 30 M66 34 L74 42 M70 30 L80 20 M76 16 L84 24 M44 58 L50 64 M52 50 L58 56']],
    thermometer: [['p', 'M44 18 C44 10 56 10 56 18 V60 C66 66 64 84 50 84 C36 84 34 66 44 60 Z', 'soft'], ['p', 'M50 30 V70 M58 30 H62 M58 40 H62 M58 50 H62']],
    stethoscope: [['p', 'M30 14 V40 C30 54 50 54 50 40 V14 M40 50 V66 C40 80 62 82 66 70 V62'], ['c', 66, 56, 7, 'soft']],
    calendar: [['p', 'M14 24 H86 V86 H14 Z', 'soft'], ['p', 'M14 40 H86 M32 16 V30 M68 16 V30 M28 54 H36 M46 54 H54 M64 54 H72 M28 70 H36 M46 70 H54']],
    target: [['c', 50, 50, 36], ['c', 50, 50, 22, 'soft'], ['c', 50, 50, 8], ['p', 'M50 50 L84 16 M74 16 H84 V26']],
    trophy: [['p', 'M32 16 H68 V40 C68 54 60 60 50 60 C40 60 32 54 32 40 Z', 'soft'], ['p', 'M32 24 H20 C20 40 28 44 34 44 M68 24 H80 C80 40 72 44 66 44 M50 60 V74 M36 84 H64 V74 H36 Z']],
    chartup: [['p', 'M14 86 V14 M14 86 H88 M22 72 L42 52 L56 62 L82 30 M70 30 H82 V42']],
    scale: [['p', 'M50 16 V84 M30 84 H70 M18 30 H82 M18 30 L10 54 H26 Z M82 30 L74 54 H90 Z']],
    house: [['p', 'M24 38 V84 H76 V38', 'soft'], ['p', 'M14 46 L50 16 L86 46 M42 84 V62 H58 V84']],
    car: [['p', 'M12 64 V50 L24 46 L36 30 H66 L78 46 L88 50 V64 Z', 'soft'], ['c', 30, 66, 8], ['c', 72, 66, 8]],
    stairs: [['p', 'M10 86 H30 V68 H48 V50 H66 V32 H86 V86 Z', 'soft']],
    bed: [['p', 'M10 30 V82 M10 62 H90 V82 M10 50 H90 V62 M18 50 C18 40 34 40 34 50']],
    chair: [['p', 'M30 14 V86 M30 52 H70 V86 M30 46 H70 V52']],
    phone: [['p', 'M32 10 H68 V90 H32 Z', 'soft'], ['p', 'M46 80 H54 M40 18 H60']],
    group: [['c', 30, 30, 9], ['c', 50, 24, 10], ['c', 70, 30, 9], ['p', 'M30 40 V66 M50 35 V68 M70 40 V66 M20 52 L30 46 L40 52 M60 52 L70 46 L80 52 M40 50 L50 42 L60 50']],
    doctor: [['c', 50, 18, 10], ['p', 'M30 88 V44 C30 34 70 34 70 44 V88 Z', 'soft'], ['p', 'M44 36 L50 52 L56 36 M42 60 C42 70 58 70 58 60']],
    child: [['c', 50, 30, 13], ['p', 'M50 43 V66 M50 50 L36 60 M50 50 L64 60 M50 66 L40 86 M50 66 L60 86']],
    elder: [['c', 46, 20, 10], ['p', 'M48 30 C52 40 52 50 50 62 M50 40 L64 52 L70 50 M50 62 L42 86 M50 62 L58 86 M70 50 V88']],
    happy: [['c', 50, 50, 36, 'soft'], ['p', 'M34 58 C42 70 58 70 66 58 M38 40 V42 M62 40 V42']],
    sad: [['c', 50, 50, 36, 'soft'], ['p', 'M34 68 C42 58 58 58 66 68 M38 40 V42 M62 40 V42']],
    pain: [['c', 50, 50, 36, 'soft'], ['p', 'M34 66 L42 62 L50 66 L58 62 L66 66 M34 38 L44 42 M66 38 L56 42']],
    star: [['p', 'M50 10 L61 38 L90 38 L66 56 L75 86 L50 68 L25 86 L34 56 L10 38 L39 38 Z', 'soft']],
    flag: [['p', 'M22 14 H74 L62 30 L74 46 H22', 'soft'], ['p', 'M22 88 V12']],
    magnifier: [['c', 42, 42, 26, 'soft'], ['p', 'M60 60 L86 86']],
    puzzle: [['p', 'M18 30 H40 C38 22 52 22 50 30 H70 V50 C78 48 78 62 70 60 V82 H50 C52 74 38 74 40 82 H18 V60 C26 62 26 48 18 50 Z', 'soft']],
    gear: [['c', 50, 50, 28, 'soft'], ['c', 50, 50, 12], ['p', 'M50 10 V22 M50 78 V90 M10 50 H22 M78 50 H90 M22 22 L30 30 M70 70 L78 78 M78 22 L70 30 M30 70 L22 78']],
    battery: [['p', 'M12 32 H80 V68 H12 Z M80 42 H88 V58 H80', 'soft'], ['p', 'M20 40 H44 V60 H20 Z']],
    plant: [['p', 'M50 60 C34 60 24 48 26 34 C40 34 50 44 50 60 M50 50 C62 48 74 38 74 24 C60 24 50 34 50 50', 'soft'], ['p', 'M50 88 V40 M36 88 H64']],
    money: [['p', 'M10 30 H90 V72 H10 Z', 'soft'], ['c', 50, 51, 13], ['p', 'M50 42 V60']],
    water: [['p', 'M50 12 C40 30 26 46 26 62 C26 78 38 88 50 88 C62 88 74 78 74 62 C74 46 60 30 50 12 Z', 'soft']],
    food: [['c', 50, 58, 30, 'soft'], ['p', 'M14 58 H86 M34 30 C34 20 44 20 44 30 M56 26 C56 16 66 16 66 26']],
    sleep: [['p', 'M60 14 C40 18 28 36 32 56 C36 76 58 88 78 80 C58 78 44 62 46 44 C48 30 54 20 60 14 Z', 'soft'], ['p', 'M68 26 H80 L68 38 H80']],
    fire: [['p', 'M50 88 C30 88 20 72 24 58 C28 44 40 40 38 22 C52 30 60 42 58 56 C64 52 66 44 66 40 C76 52 80 66 74 76 C70 84 62 88 50 88 Z', 'soft']],
    ice: [['p', 'M50 10 V90 M15 30 L85 70 M15 70 L85 30 M44 16 L50 22 L56 16 M44 84 L50 78 L56 84']],
    virus: [['c', 50, 50, 22, 'soft'], ['p', 'M50 28 V14 M50 72 V86 M28 50 H14 M72 50 H86 M34 34 L24 24 M66 66 L76 76 M66 34 L76 24 M34 66 L24 76']],
    dna: [['p', 'M34 10 C66 30 66 40 34 50 C2 60 2 70 34 90 M66 10 C34 30 34 40 66 50 C98 60 98 70 66 90 M40 22 H60 M38 40 H62 M38 60 H62 M40 78 H60']],
    microscope: [['p', 'M40 14 L60 14 L56 54 H44 Z', 'soft'], ['p', 'M30 86 H74 M50 54 V70 M36 70 H66 M60 30 C80 36 82 60 66 70']],
    computer: [['p', 'M14 18 H86 V66 H14 Z', 'soft'], ['p', 'M40 66 L36 82 H64 L60 66 M30 82 H70']],
    document: [['p', 'M24 10 H64 L80 26 V90 H24 Z', 'soft'], ['p', 'M64 10 V26 H80 M34 42 H70 M34 54 H70 M34 66 H60']],
  };
  const ICON_ALIASES = {
    patient: 'person', man: 'person', woman: 'person', people: 'group', family: 'group', team: 'group', crowd: 'group', nurse: 'doctor', therapist: 'doctor', clinician: 'doctor', physio: 'doctor',
    physiotherapist: 'doctor', physician: 'doctor', surgeon: 'doctor', carer: 'person', caregiver: 'person', student: 'person', athlete: 'person', player: 'person',
    kid: 'child', baby: 'child', old: 'elder', elderly: 'elder', grandma: 'elder', grandpa: 'elder', time: 'clock', timer: 'clock', idea: 'bulb', lightbulb: 'bulb', insight: 'bulb',
    alert: 'warning', danger: 'warning', risk: 'warning', caution: 'warning', yes: 'check', tick: 'check', correct: 'check', no: 'cross', wrong: 'cross', x: 'cross',
    exercise: 'dumbbell', weights: 'dumbbell', gym: 'dumbbell', strength: 'dumbbell', sport: 'ball', football: 'ball', foot: 'shoe', walking: 'shoe', home: 'house', rest: 'bed',
    smile: 'happy', joy: 'happy', unhappy: 'sad', hurt: 'pain', ache: 'pain', medicine: 'pill', medication: 'pill', drug: 'pill', injection: 'syringe', vaccine: 'syringe',
    fever: 'thermometer', temperature: 'thermometer', research: 'microscope', lab: 'microscope', data: 'chartup', graph: 'chartup', progress: 'chartup', improvement: 'chartup',
    balance: 'scale', weigh: 'scale', goal: 'target', aim: 'target', win: 'trophy', success: 'trophy', energy: 'battery', fatigue: 'battery', growth: 'plant', healing: 'plant',
    cost: 'money', hydration: 'water', drink: 'water', diet: 'food', nutrition: 'food', inflammation: 'fire', hot: 'fire', cold: 'ice', cryotherapy: 'ice', infection: 'virus', germ: 'virus',
    genetics: 'dna', gene: 'dna', report: 'document', form: 'document', notes: 'document', telehealth: 'computer', screen: 'computer', search: 'magnifier', assess: 'magnifier', examine: 'magnifier',
    problem: 'puzzle', solve: 'puzzle', process: 'gear', mechanism: 'gear', talk: 'speech', communication: 'speech', chat: 'speech', hearing: 'ear', vision: 'eye', see: 'eye',
    grip: 'hand', sit: 'chair', sitting: 'chair', transport: 'car', driving: 'car', mobile: 'phone', study: 'book', learning: 'book', calendar: 'calendar', week: 'calendar', schedule: 'calendar',
    mind: 'brain', thinking: 'brain', cardio: 'heart', breathing: 'lungs', lung: 'lungs', skeleton: 'bone', fracture: 'bone', arm: 'muscle', crutches: 'crutch', zimmer: 'walker', frame: 'walker',
  };
  function iconKey(name) {
    const n = String(name || '').toLowerCase().trim();
    if (ICONS[n]) return n;
    if (ICON_ALIASES[n]) return ICON_ALIASES[n];
    // (a whole word of the name: "heart-rate" is the heart; "nothing" is not "no")
    for (const w of n.split(/[^a-z]+/).filter(Boolean)) { if (ICONS[w]) return w; if (ICON_ALIASES[w]) return ICON_ALIASES[w]; }
    return null;
  }

  // ------------------------------------------------------------------ people (stick figures in poses, 100 x 160 box, facing right)
  const STAND = { head: [50, 18], neck: [50, 32], sh: [50, 40], hip: [50, 88], le: [36, 64], lh: [33, 88], re: [64, 64], rh: [67, 88], lk: [45, 120], lf: [42, 154], rk: [55, 120], rf: [58, 154] };
  const POSES = {
    stand: {},
    walk: { le: [40, 62], lh: [32, 82], re: [62, 64], rh: [72, 80], lk: [40, 118], lf: [28, 152], rk: [60, 120], rf: [64, 154] },
    run: { head: [56, 18], neck: [53, 32], sh: [52, 40], hip: [46, 86], le: [36, 54], lh: [24, 42], re: [66, 62], rh: [78, 48], lk: [32, 112], lf: [14, 124], rk: [64, 112], rf: [66, 152] },
    sit: { hip: [46, 100], le: [38, 68], lh: [46, 92], re: [60, 68], rh: [62, 92], lk: [76, 102], lf: [78, 150], rk: [72, 100], rf: [74, 150], prop: 'chair' },
    wave: { re: [70, 36], rh: [78, 12] },
    point: { re: [72, 46], rh: [96, 42] },
    think: { re: [66, 58], rh: [56, 30] },
    happy: { le: [30, 30], lh: [22, 10], re: [70, 30], rh: [78, 10] },
    lift: { le: [34, 30], lh: [30, 6], re: [66, 30], rh: [70, 6], prop: 'barbell' },
    'lift-box': { le: [38, 62], lh: [40, 84], re: [62, 62], rh: [62, 84], prop: 'box' },
    squat: { head: [50, 40], neck: [50, 54], sh: [50, 62], hip: [50, 104], le: [36, 78], lh: [24, 88], re: [64, 78], rh: [76, 88], lk: [30, 112], lf: [36, 154], rk: [70, 112], rf: [64, 154] },
    reach: { re: [70, 34], rh: [86, 12] },
    lie: { head: [14, 128], neck: [28, 130], sh: [34, 131], hip: [78, 134], le: [44, 146], lh: [60, 152], re: [44, 118], rh: [60, 114], lk: [100, 136], lf: [124, 138], rk: [100, 132], rf: [124, 130], prop: 'bed' },
    wheelchair: { hip: [46, 100], le: [38, 70], lh: [48, 96], re: [60, 70], rh: [60, 96], lk: [74, 102], lf: [78, 140], rk: [70, 100], rf: [74, 140], prop: 'wheelchair' },
    crutches: { le: [36, 60], lh: [30, 82], re: [64, 60], rh: [70, 82], prop: 'crutches' },
    cane: { re: [66, 64], rh: [74, 92], prop: 'cane' },
    hop: { le: [30, 54], lh: [14, 66], re: [66, 64], rh: [76, 112], lk: [50, 120], lf: [48, 154], rk: [78, 102], rf: [76, 130] },
    hurt: { head: [80, 40], neck: [72, 50], sh: [68, 56], hip: [42, 92], le: [64, 84], lh: [62, 114], re: [74, 86], rh: [68, 116], lk: [60, 120], lf: [52, 154], rk: [52, 122], rf: [38, 154] },
  };
  POSES['lift-weights'] = POSES.lift;
  function personParts(pose) {
    const p = Object.assign({}, STAND, POSES[pose] || {});
    const seg = (a, b) => `M${p[a][0]} ${p[a][1]} L${p[b][0]} ${p[b][1]}`;
    const body = [seg('neck', 'hip'), seg('sh', 'le') + ' ' + seg('le', 'lh'), seg('sh', 're') + ' ' + seg('re', 'rh'), seg('hip', 'lk') + ' ' + seg('lk', 'lf'), seg('hip', 'rk') + ' ' + seg('rk', 'rf')];
    const props = {
      chair: 'M28 100 H84 M30 100 V154 M82 100 V154 M30 100 V52',
      barbell: 'M8 6 H92 M14 -4 V16 M86 -4 V16',
      box: 'M30 84 H70 V108 H30 Z',
      bed: 'M0 142 H140 M4 142 V158 M136 142 V158 M0 124 V158',
      wheelchair: 'M34 100 H74 M36 66 V104 M28 64 L36 66',
      crutches: 'M38 42 L22 154 M62 42 L78 154 M32 40 L44 44 M56 44 L68 40',
      cane: 'M74 92 L80 154 M70 92 C70 84 78 84 78 90',
    };
    return { p, body, prop: p.prop ? props[p.prop] : '', wheel: p.prop === 'wheelchair' };
  }

  // ------------------------------------------------------------------ the items
  const TYPES = ['person', 'icon', 'sketch', 'diagram', 'flow', 'cycle', 'compare', 'timeline', 'chart', 'list', 'box', 'circle', 'arrow', 'line', 'note', 'callout', 'equation', 'text', 'emphasis', 'picture', 'image', 'title'];
  const colorOf = c => (COLORS[c] ? c : null);
  const list = (a, n, max) => (Array.isArray(a) ? a : []).slice(0, n).map(x => str(x, max)).filter(Boolean);

  function normItem(it, used) {
    if (!it || typeof it !== 'object') return null;
    const type = TYPES.indexOf(it.type) >= 0 ? it.type : null;
    if (!type || type === 'title') return null;
    let id = str(it.id, 24) || newId();
    while (used[id]) id = id + '_';
    used[id] = 1;
    const o = { id, type, color: colorOf(it.color) || (type === 'note' ? 'orange' : type === 'emphasis' ? 'red' : 'ink') };
    o.x = num(it.x, 80, 0, W); o.y = num(it.y, 120, 0, H);
    switch (type) {
      case 'person':
        o.h = num(it.h || it.size, 180, 70, 420); o.pose = POSES[it.pose] ? it.pose : 'stand'; o.facing = it.facing === 'left' ? 'left' : 'right';
        o.mood = ['happy', 'sad', 'pain'].indexOf(it.mood) >= 0 ? it.mood : 'neutral'; o.label = str(it.label, 40); o.say = str(it.say, 90); break;
      case 'icon': {
        const k = iconKey(it.name); if (!k) return null;
        o.name = k; o.size = num(it.size, 110, 40, 300); o.label = str(it.label, 40); break;
      }
      case 'sketch': {
        o.w = num(it.w, 260, 60, 900); o.h = num(it.h, 200, 60, 560); o.label = str(it.label, 50);
        o.paths = (Array.isArray(it.paths) ? it.paths : []).slice(0, 24).map(d => String(d || '').slice(0, 1600)).filter(d => /^[\sMmLlHhVvCcSsQqTtAaZz0-9.,\-eE]+$/.test(d) && /^\s*[Mm]/.test(d));
        if (!o.paths.length) return null;
        o.fill = SOFT[it.fill] ? it.fill : null; break;
      }
      case 'diagram': {
        const key = diagramKey(it.name); if (!key) return null;
        const d = DIAGRAMS[key];
        o.name = key; o.w = num(it.w, 300, 80, 760); o.h = o.w * d.h / d.w;
        if (o.h > 520) { o.h = 520; o.w = o.h * d.w / d.h; }
        o.labels = (Array.isArray(it.labels) ? it.labels : []).slice(0, 10).map(l => ({ part: str(l && l.part, 40), text: str(l && (l.text || l.part), 30) })).filter(l => l.part && partPoint(d, l.part));
        break;
      }
      case 'flow': o.steps = list(it.steps, 6, 40); if (o.steps.length < 2) return null; o.dir = it.dir === 'col' ? 'col' : 'row'; o.w = num(it.w, o.dir === 'row' ? 860 : 320, 160, 940); o.h = num(it.h, o.dir === 'row' ? 120 : 440, 80, 520); break;
      case 'cycle': o.steps = list(it.steps, 6, 30); if (o.steps.length < 3) return null; o.w = num(it.w, 380, 220, 600); o.h = num(it.h, 380, 220, 520); break;
      case 'compare':
        o.columns = (Array.isArray(it.columns) ? it.columns : []).slice(0, 3).map(c => ({ title: str(c && c.title, 30), points: list(c && c.points, 5, 60) })).filter(c => c.title || c.points.length);
        if (o.columns.length < 2) return null; o.w = num(it.w, 880, 300, 940); o.h = num(it.h, 420, 160, 520); break;
      case 'timeline':
        o.events = (Array.isArray(it.events) ? it.events : []).slice(0, 6).map(e => ({ label: str(e && e.label, 24), text: str(e && e.text, 50) })).filter(e => e.label || e.text);
        if (o.events.length < 2) return null; o.w = num(it.w, 880, 300, 940); break;
      case 'chart': {
        o.kind = ['bar', 'line', 'pie'].indexOf(it.kind) >= 0 ? it.kind : 'bar';
        const vals = (Array.isArray(it.values) ? it.values : []).slice(0, 8).map(v => Number(v)).filter(v => Number.isFinite(v) && v >= 0);
        o.labels = list(it.labels, vals.length, 16); o.values = vals.slice(0, o.labels.length);
        if (o.values.length < 2) return null;
        o.unit = str(it.unit, 8); o.title = str(it.title, 50); o.w = num(it.w, 380, 220, 900); o.h = num(it.h, 300, 180, 500); break;
      }
      case 'list': o.items = list(it.items, 7, 70); if (!o.items.length) return null; o.numbered = !!it.numbered; o.w = num(it.w, 440, 160, 940); o.size = num(it.size, 30, 20, 44); break;
      case 'box': case 'circle': o.text = str(it.text, 80); o.w = num(it.w, 240, 60, 900); o.h = num(it.h, 90, 50, 400); break;
      case 'arrow': case 'line':
        if (it.from) o.from = str(it.from, 24); if (it.to) o.to = str(it.to, 24);
        o.x2 = num(it.x2, o.x + 140, 0, W); o.y2 = num(it.y2, o.y, 0, H); o.text = str(it.text, 30); o.curve = num(it.curve, 0, -1, 1); break;
      case 'note': o.text = str(it.text, 160); if (!o.text) return null; o.w = num(it.w, 300, 150, 520); break;
      case 'callout': o.text = str(it.text, 140); if (!o.text) return null; o.w = num(it.w, 300, 140, 520); if (it.to && typeof it.to === 'string') o.to = str(it.to, 24); break;
      case 'equation': o.text = str(it.text, 80); if (!o.text) return null; o.size = num(it.size, 42, 24, 72); break;
      case 'text': o.text = str(it.text, 160); if (!o.text) return null; o.size = num(it.size, 32, 18, 72); o.w = num(it.w, 0, 0, W); break;
      case 'emphasis': o.target = str(it.target, 24); if (!o.target) return null; o.style = ['circle', 'underline', 'tick', 'cross', 'star', 'highlight', 'box'].indexOf(it.style) >= 0 ? it.style : 'circle'; break;
      case 'picture': o.prompt = str(it.prompt, 400); if (!o.prompt) return null; o.w = num(it.w, 320, 120, 700); o.h = num(it.h, 240, 100, 480); break;
      // (an AI picture once made, as saved)
      case 'image': if (typeof it.src !== 'string' || !/^data:image\/(png|jpeg|webp);base64,/.test(it.src)) return null; o.src = it.src; o.w = num(it.w, 320, 60, 900); o.h = num(it.h, 240, 60, 560); break;
    }
    return o;
  }

  // ------------------------------------------------------------------ drawing the items: each gives its svg and its rectangle
  // The hand-drawn wobble goes on each item's group, never on single strokes: a straight vertical or flat stroke has a
  // zero-size box, so a filter on it alone would hide it. The empty frame keeps even a lone flat line's box open.
  const rough = out => `<g filter="url(#wbRough)"><rect x="${out.box.x - 8}" y="${out.box.y - 8}" width="${out.box.w + 16}" height="${out.box.h + 16}" fill="none"/>${out.svg}</g>`;
  const stroke = (c, w) => ` fill="none" stroke="${c}" stroke-width="${w || 3}" stroke-linecap="round" stroke-linejoin="round"`;
  const textEl = (x, y, s, size, color, opt) => `<text x="${x}" y="${y}" font-family="${(opt && opt.font) || BODY}" font-size="${size}" fill="${color}"${opt && opt.anchor ? ` text-anchor="${opt.anchor}"` : ''}${opt && opt.weight ? ` font-weight="${opt.weight}"` : ''}>${esc(s)}</text>`;
  function linesEl(lines, x, y, size, color, opt) { return lines.map((l, i) => textEl(x, y + size * 0.85 + i * size * 1.12, l, size, color, opt)).join(''); }
  const boxOf = (x, y, w, h) => ({ x, y, w: Math.max(1, w), h: Math.max(1, h) });
  const center = b => [b.x + b.w / 2, b.y + b.h / 2];
  function edgePoint(b, tx, ty, round) {
    const [cx, cy] = center(b), dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    if (round) { const t = 1 / Math.sqrt((dx * dx) / ((b.w / 2) ** 2) + (dy * dy) / ((b.h / 2) ** 2)); return [cx + dx * t, cy + dy * t]; }
    const t = Math.min(dx ? (b.w / 2) / Math.abs(dx) : Infinity, dy ? (b.h / 2) / Math.abs(dy) : Infinity);
    return [cx + dx * t, cy + dy * t];
  }
  function arrowHead(x, y, ang, c, s) {
    s = s || 16;
    return `<path d="M${x} ${y} L${x - s * Math.cos(ang - 0.45)} ${y - s * Math.sin(ang - 0.45)} M${x} ${y} L${x - s * Math.cos(ang + 0.45)} ${y - s * Math.sin(ang + 0.45)}"${stroke(c, 3.5)}/>`;
  }
  /** A curved or straight arrow from (x1, y1) to (x2, y2). */
  function arrowPath(x1, y1, x2, y2, curve, c, head, label) {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
    const cx = mx - dy / len * curve * len * 0.45, cy = my + dx / len * curve * len * 0.45;
    const d = curve ? `M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}` : `M${x1} ${y1} L${x2} ${y2}`;
    const ang = curve ? Math.atan2(y2 - cy, x2 - cx) : Math.atan2(dy, dx);
    const lx = curve ? (mx + cx) / 2 : mx, ly = curve ? (my + cy) / 2 : my;
    return `<path d="${d}"${stroke(c, 3.5)}/>` + (head ? arrowHead(x2, y2, ang, c) : '') +
      (label ? textEl(lx, ly - 10, label, 26, c, { anchor: 'middle', font: HAND, weight: 700 }).replace('<text', '<text paint-order="stroke" stroke="#fdfdfb" stroke-width="6"') : '');
  }

  /** {svg, box} for [it]; [all] = the items on the board (for arrows, call-outs and emphasis). */
  function render(it, all) {
    const c = COLORS[it.color] || COLORS.ink, soft = SOFT[it.color] || SOFT.ink;
    const find = id => id && all.find(x => x.id === id && x.type !== 'arrow' && x.type !== 'line' && x.type !== 'emphasis');
    switch (it.type) {
      case 'title': {
        const size = 46, t = it.text, w = Math.min(W - 80, textW(t, size) * 0.98);
        return { svg: textEl(40, 66, t, size, COLORS.ink, { font: HAND, weight: 700 }) + `<path d="M40 80 C${40 + w * 0.3} 86 ${40 + w * 0.7} 76 ${40 + w} 82"${stroke(COLORS.teal, 4)}/>`, box: boxOf(30, 18, w + 20, 72) };
      }
      case 'text': {
        const maxW = it.w || Math.max(180, Math.min(620, W - 30 - it.x));
        const lines = wrap(it.text, fit(maxW, it.size));
        const w = Math.max(...lines.map(l => textW(l, it.size)), 10);
        return { svg: linesEl(lines, it.x, it.y, it.size, c, { font: HAND, weight: 700 }), box: boxOf(it.x, it.y, w, lines.length * it.size * 1.12 + 6) };
      }
      case 'equation': {
        const w = textW(it.text, it.size) * 1.02;
        return { svg: textEl(it.x, it.y + it.size * 0.9, it.text, it.size, c, { font: HAND, weight: 700 }) + `<path d="M${it.x - 10} ${it.y - 6} H${it.x + w + 10} V${it.y + it.size * 1.25} H${it.x - 10} Z"${stroke(c, 2)} stroke-dasharray="2 8"/>`, box: boxOf(it.x - 12, it.y - 8, w + 24, it.size * 1.3 + 4) };
      }
      case 'list': {
        let y = it.y, svg = '';
        const lh = it.size * 1.15, tw = it.w - it.size * 1.4;
        it.items.forEach((t, i) => {
          const lines = wrap(t, fit(tw, it.size));
          const mark = it.numbered ? textEl(it.x, y + it.size * 0.85, (i + 1) + '.', it.size, c, { font: HAND, weight: 700 }) : `<circle cx="${it.x + it.size * 0.3}" cy="${y + it.size * 0.55}" r="${it.size * 0.13}" fill="${c}"/>`;
          svg += `<g>${mark}${linesEl(lines, it.x + it.size * 1.3, y, it.size, COLORS.ink)}</g>`;
          y += lines.length * lh + it.size * 0.35;
        });
        return { svg, box: boxOf(it.x, it.y, it.w, y - it.y) };
      }
      case 'box': case 'circle': {
        const round = it.type === 'circle', pad = round ? 40 : 24;
        let fs = Math.max(20, Math.min(32, it.h / 2.6)), lines = wrap(it.text, fit(it.w - pad, fs));
        while (fs > 18 && lines.length * fs * 1.15 + 16 > it.h * (round ? 0.75 : 1)) { fs -= 1; lines = wrap(it.text, fit(it.w - pad, fs)); }
        const h = Math.max(it.h, (lines.length * fs * 1.15 + 18) * (round ? 1.3 : 1));
        const shape = round ? `<ellipse cx="${it.x + it.w / 2}" cy="${it.y + h / 2}" rx="${it.w / 2}" ry="${h / 2}" fill="${soft}"${stroke(c, 3).replace(' fill="none"', '')}/>`
          : `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${h}" rx="16" fill="${soft}"${stroke(c, 3).replace(' fill="none"', '')}/>`;
        const y0 = it.y + h / 2 - (lines.length * fs * 1.15) / 2;
        return { svg: shape + linesEl(lines, it.x + it.w / 2, y0 - fs * 0.05, fs, c, { anchor: 'middle' }), box: boxOf(it.x, it.y, it.w, h) };
      }
      case 'note': {
        const lines = wrap(it.text, fit(it.w - 34, 28)), h = Math.max(80, 36 + lines.length * 31);
        return { svg: `<rect x="${it.x + 5}" y="${it.y + 7}" width="${it.w}" height="${h}" fill="rgba(0,0,0,.10)"/><rect x="${it.x}" y="${it.y}" width="${it.w}" height="${h}" fill="${SOFT[it.color] || SOFT.yellow}" stroke="${c}" stroke-opacity=".35"/>` +
          `<rect x="${it.x + it.w / 2 - 32}" y="${it.y - 9}" width="64" height="18" fill="rgba(255,255,255,.7)" stroke="rgba(0,0,0,.08)"/>` + linesEl(lines, it.x + 18, it.y + 12, 28, c === COLORS.ink ? '#1f2937' : c), box: boxOf(it.x, it.y - 9, it.w + 5, h + 16) };
      }
      case 'callout': {
        const lines = wrap(it.text, fit(it.w - 36, 27)), h = 28 + lines.length * 30;
        const t = find(it.to), tb = t ? render(t, all).box : null;
        let tail = '';
        if (tb) {
          const [tx, ty] = center(tb), [bx, by] = [it.x + it.w / 2, it.y + h / 2];
          const [ex, ey] = edgePoint(tb, bx, by, false), [sx, sy] = edgePoint(boxOf(it.x, it.y, it.w, h), tx, ty, false);
          tail = `<path d="M${sx - 12} ${sy} L${ex + (sx - ex) * 0.15} ${ey + (sy - ey) * 0.15} L${sx + 12} ${sy}"${stroke(c, 3).replace(' fill="none"', ` fill="#ffffff"`)}/>`;
        }
        return { svg: `<rect x="${it.x}" y="${it.y}" width="${it.w}" height="${h}" rx="22" fill="#ffffff"${stroke(c, 3).replace(' fill="none"', '')}/>` + tail + linesEl(lines, it.x + 18, it.y + 12, 27, COLORS.ink), box: boxOf(it.x, it.y, it.w, h) };
      }
      case 'arrow': case 'line': {
        const a = find(it.from), b = find(it.to), ab = a && render(a, all).box, bb = b && render(b, all).box;
        const tgt = bb ? center(bb) : [it.x2, it.y2], src = ab ? center(ab) : [it.x, it.y];
        let s = ab ? edgePoint(ab, tgt[0], tgt[1], a.type === 'circle' || a.type === 'cycle') : src;
        let t = bb ? edgePoint(bb, src[0], src[1], b.type === 'circle' || b.type === 'cycle') : tgt;
        const pad = (p, q, d) => { const L2 = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [p[0] + (q[0] - p[0]) * d / L2, p[1] + (q[1] - p[1]) * d / L2]; };
        if (ab) s = pad(s, t, 10); if (bb) t = pad(t, s, 10);
        return { svg: arrowPath(s[0], s[1], t[0], t[1], it.curve, c, it.type === 'arrow', it.text), box: boxOf(Math.min(s[0], t[0]), Math.min(s[1], t[1]), Math.abs(t[0] - s[0]), Math.abs(t[1] - s[1])) };
      }
      case 'icon': {
        const k = it.size / 100;
        const parts = ICONS[it.name].map(s => {
          const f = s[s.length - 1] === 'soft' ? soft : 'none';
          return s[0] === 'c' ? `<circle cx="${s[1]}" cy="${s[2]}" r="${s[3]}" fill="${f}" stroke="${c}" stroke-width="${3.2 / k}" stroke-linecap="round" stroke-linejoin="round"/>`
            : `<path d="${s[1]}" fill="${f}" stroke="${c}" stroke-width="${3.2 / k}" stroke-linecap="round" stroke-linejoin="round"/>`;
        }).join('');
        const label = it.label ? textEl(it.x + it.size / 2, it.y + it.size + 30, it.label, 26, COLORS.ink, { anchor: 'middle' }) : '';
        const lw = it.label ? textW(it.label, 26) : 0;
        return { svg: `<g transform="translate(${it.x} ${it.y}) scale(${k})">${parts}</g>` + label, box: boxOf(Math.min(it.x, it.x + it.size / 2 - lw / 2), it.y, Math.max(it.size, lw), it.size + (it.label ? 38 : 0)) };
      }
      case 'person': {
        const k = it.h / 160, pp = personParts(it.pose), wide = it.pose === 'lie' ? 140 : 100, w = wide * k;
        const flip = it.facing === 'left' ? `translate(${it.x + w} ${it.y}) scale(${-k} ${k})` : `translate(${it.x} ${it.y}) scale(${k})`;
        const sw = 3.4 / k, hd = pp.p.head;
        const face = { happy: `M${hd[0] - 5} ${hd[1] + 3} C${hd[0] - 2} ${hd[1] + 8} ${hd[0] + 2} ${hd[1] + 8} ${hd[0] + 5} ${hd[1] + 3}`, sad: `M${hd[0] - 5} ${hd[1] + 7} C${hd[0] - 2} ${hd[1] + 3} ${hd[0] + 2} ${hd[1] + 3} ${hd[0] + 5} ${hd[1] + 7}`, pain: `M${hd[0] - 5} ${hd[1] + 5} L${hd[0] - 2} ${hd[1] + 3} L${hd[0] + 1} ${hd[1] + 6} L${hd[0] + 5} ${hd[1] + 4}`, neutral: `M${hd[0] - 4} ${hd[1] + 5} H${hd[0] + 4}` }[it.mood];
        const eyes = `M${hd[0] - 4} ${hd[1] - 3} V${hd[1] - 2} M${hd[0] + 4} ${hd[1] - 3} V${hd[1] - 2}`;
        const st = ` fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"`;
        let inner = (pp.prop ? `<path d="${pp.prop}"${st.replace(c, COLORS.gray)}/>` : '') + (pp.wheel ? `<circle cx="52" cy="124" r="28"${st.replace(c, COLORS.gray)}/><circle cx="88" cy="150" r="6"${st.replace(c, COLORS.gray)}/>` : '') +
          `<circle cx="${hd[0]}" cy="${hd[1]}" r="13" fill="${soft}"${st.replace(' fill="none"', '')}/><path d="${eyes} ${face}"${st.replace(`stroke-width="${sw}"`, `stroke-width="${sw * 0.7}"`)}/>` + pp.body.map(d => `<path d="${d}"${st}/>`).join('');
        let svg = `<g transform="${flip}">${inner}</g>`;
        let bx = it.x, by = it.y, bw = w, bh = it.h;
        if (it.label) { svg += textEl(it.x + w / 2, it.y + it.h + 30, it.label, 24, COLORS.ink, { anchor: 'middle' }); bh += 36; const lw = textW(it.label, 24); if (lw > bw) { bx -= (lw - bw) / 2; bw = lw; } }
        if (it.say) {
          const lines = wrap(it.say, 22), bwid = Math.min(280, Math.max(...lines.map(l => textW(l, 24))) * 1.15 + 34), bht = 22 + lines.length * 27;
          const right = it.facing !== 'left';
          const sx = right ? it.x + w * 0.55 : it.x + w * 0.45 - bwid, sy = Math.max(100, it.y - bht - 18);
          const tx = it.x + w * (right ? 0.62 : 0.38), ty = it.y + 6;
          svg += `<rect x="${sx}" y="${sy}" width="${bwid}" height="${bht}" rx="18" fill="#ffffff"${stroke(c, 2.6).replace(' fill="none"', '')}/><path d="M${tx - 8} ${sy + bht} L${tx} ${ty} L${tx + 10} ${sy + bht}"${stroke(c, 2.6).replace(' fill="none"', ' fill="#ffffff"')}/>` + linesEl(lines, sx + 16, sy + 9, 24, COLORS.ink);
          const nx = Math.min(bx, sx), ny = Math.min(by, sy); bw = Math.max(bx + bw, sx + bwid) - nx; bh = Math.max(by + bh, sy + bht) - ny; bx = nx; by = ny;
        }
        return { svg, box: boxOf(bx, by, bw, bh) };
      }
      case 'sketch': {
        const kx = it.w / 100, ky = it.h / 100, f = it.fill ? SOFT[it.fill] : 'none';
        const paths = it.paths.map(d => `<path d="${d}" fill="${f}" stroke="${c}" stroke-width="3.2" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
        const label = it.label ? textEl(it.x + it.w / 2, it.y + it.h + 32, it.label, 26, COLORS.ink, { anchor: 'middle' }) : '';
        return { svg: `<g transform="translate(${it.x} ${it.y}) scale(${kx} ${ky})">${paths}</g>` + label, box: boxOf(it.x, it.y, it.w, it.h + (it.label ? 40 : 0)) };
      }
      case 'diagram': {
        const d = DIAGRAMS[it.name];
        const ls = diagramLabels(it);
        const labels = ls.map(l => {
          const anchor = l.side === 'left' ? 'end' : 'start', lx = l.side === 'left' ? l.tx + 4 : l.tx - 4;
          return `<g><path d="M${lx} ${l.ty - 7} L${l.ax} ${l.ay}"${stroke(c, 2)}/><circle cx="${l.ax}" cy="${l.ay}" r="3.5" fill="${c}"/>${textEl(l.tx, l.ty, l.text, 26, c, { anchor, font: HAND, weight: 700 })}</g>`;
        }).join('');
        let x1 = it.x, x2 = it.x + it.w, y1 = it.y, y2 = it.y + it.h;
        ls.forEach(l => { const tw = textW(l.text, 26) + 6, lx = l.side === 'left' ? l.tx - tw : l.tx; x1 = Math.min(x1, lx); x2 = Math.max(x2, lx + tw); y1 = Math.min(y1, l.ty - 24); y2 = Math.max(y2, l.ty + 8); });
        return { svg: `<g transform="translate(${it.x} ${it.y}) scale(${it.w / d.w} ${it.h / d.h})">${diagramInner(it.name)}</g>` + labels, box: boxOf(x1, y1, x2 - x1, y2 - y1) };
      }
      case 'flow': {
        const n = it.steps.length, row = it.dir === 'row', gap = row ? 44 : 34;
        const bw = row ? (it.w - gap * (n - 1)) / n : it.w, bh = row ? it.h : (it.h - gap * (n - 1)) / n;
        let svg = '';
        it.steps.forEach((s, i) => {
          const x = row ? it.x + i * (bw + gap) : it.x, y = row ? it.y : it.y + i * (bh + gap);
          svg += `<g>${render({ type: 'box', x, y, w: bw, h: bh, text: s, color: it.color }, all).svg}${i < n - 1 ? (row ? arrowPath(x + bw + 6, y + bh / 2, x + bw + gap - 6, y + bh / 2, 0, c, true) : arrowPath(x + bw / 2, y + bh + 4, x + bw / 2, y + bh + gap - 4, 0, c, true)) : ''}</g>`;
        });
        return { svg, box: boxOf(it.x, it.y, it.w, it.h) };
      }
      case 'cycle': {
        const n = it.steps.length, cx = it.x + it.w / 2, cy = it.y + it.h / 2, rx = it.w / 2 - 70, ry = it.h / 2 - 40;
        const pts = it.steps.map((_, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)]; });
        let svg = '';
        it.steps.forEach((s, i) => {
          const [x, y] = pts[i], [nx, ny] = pts[(i + 1) % n];
          const nodeW = 140, nodeH = 64;
          const a1 = Math.atan2(ny - y, nx - x);
          const sx = x + Math.cos(a1) * 70, sy = y + Math.sin(a1) * 34, ex = nx - Math.cos(a1) * 70, ey = ny - Math.sin(a1) * 34;
          svg += `<g>${render({ type: 'circle', x: x - nodeW / 2, y: y - nodeH / 2, w: nodeW, h: nodeH, text: s, color: it.color }, all).svg}${arrowPath(sx, sy, ex, ey, 0.25, c, true)}</g>`;
        });
        return { svg, box: boxOf(it.x, it.y, it.w, it.h) };
      }
      case 'compare': {
        const n = it.columns.length, cw = it.w / n;
        let svg = '';
        it.columns.forEach((col, i) => {
          const x = it.x + i * cw, hc = [COLORS.blue, COLORS.red, COLORS.green][i] || c;
          let g = textEl(x + cw / 2, it.y + 38, col.title, 36, hc, { anchor: 'middle', font: HAND, weight: 700 }) + `<path d="M${x + 24} ${it.y + 52} H${x + cw - 24}"${stroke(hc, 3)}/>`;
          let y = it.y + 66;
          col.points.forEach(p => {
            const lines = wrap(p, fit(cw - 64, 27));
            g += `<g><circle cx="${x + 30}" cy="${y + 15}" r="4" fill="${hc}"/>${linesEl(lines, x + 44, y, 27, COLORS.ink)}</g>`;
            y += lines.length * 31 + 12;
          });
          if (i > 0) g = `<path d="M${x} ${it.y + 6} V${it.y + it.h - 6}"${stroke(COLORS.gray, 2)}/>` + g;
          svg += `<g>${g}</g>`;
        });
        return { svg, box: boxOf(it.x, it.y, it.w, it.h) };
      }
      case 'timeline': {
        const n = it.events.length, y = it.y + 70, step = it.w / n;
        let svg = arrowPath(it.x, y, it.x + it.w, y, 0, c, true), maxH = 0;
        it.events.forEach((e, i) => {
          const x = it.x + step * (i + 0.5), lines = wrap(e.text, fit(step - 14, 24));
          maxH = Math.max(maxH, lines.length);
          svg += `<g><circle cx="${x}" cy="${y}" r="8" fill="${SOFT[it.color] || SOFT.ink}" stroke="${c}" stroke-width="3"/>${textEl(x, y - 22, e.label, 28, c, { anchor: 'middle', font: HAND, weight: 700 })}${linesEl(lines, x, y + 18, 24, COLORS.ink, { anchor: 'middle' })}</g>`;
        });
        return { svg, box: boxOf(it.x, it.y + 20, it.w, 70 + maxH * 27 + 10) };
      }
      case 'chart': {
        const n = it.values.length, max = Math.max(...it.values) || 1, top = it.y + (it.title ? 44 : 10), left = it.x + 40, bottom = it.y + it.h - 40, right = it.x + it.w - 10;
        let svg = it.title ? textEl(it.x + it.w / 2, it.y + 30, it.title, 28, COLORS.ink, { anchor: 'middle', font: HAND, weight: 700 }) : '';
        if (it.kind === 'pie') {
          const cx = it.x + it.w / 2, cy = (top + it.y + it.h) / 2, r = Math.min(it.w, it.y + it.h - top) / 2 - 30;
          const total = it.values.reduce((a, b) => a + b, 0) || 1; let a0 = -Math.PI / 2;
          const pal = ['blue', 'red', 'green', 'orange', 'purple', 'teal', 'gray', 'ink'];
          it.values.forEach((v, i) => {
            const a1 = a0 + v / total * Math.PI * 2, big = a1 - a0 > Math.PI ? 1 : 0, col = COLORS[pal[i % pal.length]];
            const am = (a0 + a1) / 2, lx = cx + Math.cos(am) * (r + 26), ly = cy + Math.sin(am) * (r + 26);
            svg += `<g><path d="M${cx} ${cy} L${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A${r} ${r} 0 ${big} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z" fill="${SOFT[pal[i % pal.length]]}"${stroke(col, 3).replace(' fill="none"', '')}/>${textEl(lx, ly, it.labels[i] + ' ' + v + it.unit, 22, col, { anchor: Math.cos(am) < -0.2 ? 'end' : Math.cos(am) > 0.2 ? 'start' : 'middle' })}</g>`;
            a0 = a1;
          });
        } else {
          svg += `<path d="M${left} ${top} V${bottom} H${right}"${stroke(COLORS.ink, 3)}/>`;
          const step = (right - left) / n;
          const pts = [];
          it.values.forEach((v, i) => {
            const x = left + step * (i + 0.5), y = bottom - (bottom - top - 24) * v / max;
            pts.push([x, y]);
            const lab = textEl(x, bottom + 28, it.labels[i], 22, COLORS.ink, { anchor: 'middle' }), val = textEl(x, y - 10, v + it.unit, 22, c, { anchor: 'middle', weight: 700 });
            if (it.kind === 'bar') svg += `<g><rect x="${x - step * 0.3}" y="${y}" width="${step * 0.6}" height="${bottom - y}" fill="${SOFT[it.color] || SOFT.blue}"${stroke(c, 3).replace(' fill="none"', '')}/>${val}${lab}</g>`;
            else svg += `<g>${lab}</g>`;
          });
          if (it.kind === 'line') svg += `<path d="M${pts.map(p => p.join(' ')).join(' L')}"${stroke(c, 3.5)}/>` + pts.map((p, i) => `<g><circle cx="${p[0]}" cy="${p[1]}" r="6" fill="${c}"/>${textEl(p[0], p[1] - 14, it.values[i] + it.unit, 22, c, { anchor: 'middle', weight: 700 })}</g>`).join('');
        }
        return { svg, box: boxOf(it.x, it.y, it.w, it.h) };
      }
      case 'emphasis': {
        const t = find(it.target); if (!t) return { svg: '', box: boxOf(0, 0, 1, 1) };
        const b = render(t, all).box, pad = 12;
        const x = b.x - pad, y = b.y - pad, w = b.w + pad * 2, h = b.h + pad * 2;
        const svg = {
          circle: `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2 + 8}" ry="${h / 2 + 8}"${stroke(c, 4)}/>`,
          box: `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10"${stroke(c, 4)}/>`,
          underline: `<path d="M${b.x} ${b.y + b.h + 8} C${b.x + b.w * 0.3} ${b.y + b.h + 14} ${b.x + b.w * 0.6} ${b.y + b.h + 2} ${b.x + b.w} ${b.y + b.h + 9}"${stroke(c, 4.5)}/>`,
          tick: `<path d="M${b.x + b.w + 14} ${b.y + b.h / 2} L${b.x + b.w + 28} ${b.y + b.h / 2 + 16} L${b.x + b.w + 56} ${b.y + b.h / 2 - 22}"${stroke(COLORS.green, 5)}/>`,
          cross: `<path d="M${b.x + b.w + 14} ${b.y + b.h / 2 - 18} L${b.x + b.w + 48} ${b.y + b.h / 2 + 16} M${b.x + b.w + 48} ${b.y + b.h / 2 - 18} L${b.x + b.w + 14} ${b.y + b.h / 2 + 16}"${stroke(COLORS.red, 5)}/>`,
          star: `<g transform="translate(${b.x + b.w - 10} ${b.y - 30}) scale(0.42)"><path d="${ICONS.star[0][1]}" fill="${SOFT.yellow}" stroke="${COLORS.orange}" stroke-width="7"/></g>`,
          highlight: `<rect x="${x}" y="${y + h * 0.15}" width="${w}" height="${h * 0.7}" rx="6" fill="#fde047" opacity="0.38" style="mix-blend-mode:multiply"/>`,
        }[it.style];
        return { svg, box: boxOf(x, y, w, h) };
      }
      case 'image':
        return { svg: `<image href="${it.src}" x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" preserveAspectRatio="xMidYMid meet"/><rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}" rx="10"${stroke(COLORS.gray, 3)}/>`, box: boxOf(it.x, it.y, it.w, it.h) };
      case 'picture':                                   // (a picture not made: nothing is drawn)
        return { svg: '', box: boxOf(it.x, it.y, it.w, it.h) };
    }
    return { svg: '', box: boxOf(it.x || 0, it.y || 0, 1, 1) };
  }

  function shapeSvg(sh) {
    const st = ST[sh.s] || ST.none;
    const fill = sh.fill || st[0], strokeC = sh.stroke || st[1];
    const common = ` fill="${fill}" stroke="${strokeC}" stroke-width="${sh.sw || 1.6}"${sh.op ? ` opacity="${sh.op}"` : ''}${sh.dash ? ` stroke-dasharray="${sh.dash}"` : ''} stroke-linecap="${sh.cap || 'round'}" stroke-linejoin="round"`;
    if (sh.k === 'ellipse') return `<ellipse cx="${sh.cx}" cy="${sh.cy}" rx="${sh.rx}" ry="${sh.ry}"${common}/>`;
    if (sh.k === 'text') return `<text x="${sh.x}" y="${sh.y}" font-family="${SANS}" font-size="${sh.size || 10}" font-weight="${sh.weight || 500}" fill="${sh.fill || '#374151'}"${sh.anchor ? ` text-anchor="${sh.anchor}"` : ''}${sh.rotate ? ` transform="rotate(${sh.rotate} ${sh.x} ${sh.y})"` : ''}>${esc(sh.text)}</text>`;
    return `<path d="${sh.d}"${common}/>`;
  }
  const diagramCache = {};
  function diagramInner(key) {
    if (!diagramCache[key]) diagramCache[key] = DIAGRAMS[key].shapes.map(shapeSvg).join('');
    return diagramCache[key];
  }
  /** A diagram's labels, beside it, with leader lines (none on top of another). */
  function diagramLabels(it) {
    const d = DIAGRAMS[it.name], sx = it.w / d.w, sy = it.h / d.h, cx = it.x + it.w / 2;
    const placed = { left: [], right: [] };
    (it.labels || []).forEach(l => {
      const p = partPoint(d, l.part); if (!p) return;
      const ax = it.x + p[0] * sx, ay = it.y + p[1] * sy, tw = textW(l.text, 26) + 10;
      let side = ax < cx ? 'left' : 'right';
      if (side === 'left' && it.x - 16 - tw < 4) side = 'right';
      else if (side === 'right' && it.x + it.w + 16 + tw > W - 4 && it.x - 16 - tw >= 4) side = 'left';
      placed[side].push({ ax, ay, text: l.text, y: ay });
    });
    const out = [];
    ['left', 'right'].forEach(side => {
      const ls = placed[side].sort((a, b) => a.ay - b.ay);
      for (let i = 1; i < ls.length; i++) if (ls[i].y - ls[i - 1].y < 28) ls[i].y = ls[i - 1].y + 28;
      const over = ls.length ? ls[ls.length - 1].y - (H - 14) : 0;
      if (over > 0) ls.forEach(l => { l.y -= over; });
      ls.forEach(l => out.push({ side, tx: side === 'left' ? it.x - 16 : it.x + it.w + 16, ty: l.y, ax: l.ax, ay: l.ay, text: l.text }));
    });
    return out;
  }

  // ------------------------------------------------------------------ layout: inside the board, clear of what is already there
  const FREE_TYPES = { arrow: 1, line: 1, emphasis: 1 };
  const overlaps = (a, b, m) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
  /** Moves [it] (small moves only) so it is on the board and clear of [placed] rectangles. */
  function placeItem(it, placed, all) {
    if (FREE_TYPES[it.type]) return;
    const move = (dx, dy) => { it.x += dx; it.y += dy; };
    let b = render(it, all).box;
    if (b.x + b.w > W - 20) move(-Math.min(b.x - 20, b.x + b.w - (W - 20)), 0);
    if (b.y + b.h > H - 14) move(0, -Math.min(b.y - 96, b.y + b.h - (H - 14)));
    b = render(it, all).box;
    if (b.x < 20) move(20 - b.x, 0);
    if (b.y < 96) move(0, 96 - b.y);
    const ok = () => { const x = render(it, all).box; return x.x >= 14 && x.y >= 92 && x.x + x.w <= W - 14 && x.y + x.h <= H - 8 && !placed.some(p => overlaps(x, p, 14)); };
    if (ok()) return;
    const ox = it.x, oy = it.y;
    for (let d = 10; d <= 260; d += 10) {
      for (const [dx, dy] of [[0, d], [d, 0], [-d, 0], [0, -d], [d, d], [-d, d]]) { it.x = ox + dx; it.y = oy + dy; if (ok()) return; }
    }
    it.x = ox; it.y = oy;
  }
  /** Lays out [beat]'s items against the scene's earlier items (and its title). */
  function layoutBeat(scene, beat) {
    const all = sceneItems(scene).concat(beat.draw);
    const placed = [render({ type: 'title', text: scene.title }, []).box];
    sceneItems(scene).forEach(x => { if (!FREE_TYPES[x.type]) placed.push(render(x, all).box); });
    beat.draw.forEach(it => { placeItem(it, placed, all); if (!FREE_TYPES[it.type]) placed.push(render(it, all).box); });
  }
  const sceneItems = scene => scene.beats.reduce((a, b) => a.concat(b.draw), []);

  /** The whole of scene [k] as a standalone SVG (export, thumbnails). */
  function toSVG(lesson, k, opts) {
    const l = normalizeLesson(lesson), sc = l.scenes[Math.max(0, Math.min(k || 0, l.scenes.length - 1))], o = opts || {};
    if (!sc) return '';
    const items = [{ type: 'title', text: sc.title }].concat(sceneItems(sc));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * (o.scale || 1)}" height="${H * (o.scale || 1)}">${boardDefs()}<rect width="${W}" height="${H}" fill="#fdfdfb"/>${items.map(it => rough(render(it, items))).join('')}</svg>`;
  }
  function toPNG(lesson, k, scale) {
    const s = scale || 2, svg = toSVG(lesson, k, { scale: s });
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas'); cv.width = W * s; cv.height = H * s;
        const ctx = cv.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
        try { resolve(cv.toDataURL('image/png')); } catch (e) { reject(e); }
      };
      img.onerror = () => reject(new Error('The scene could not be turned into a picture.'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  /** The marker's slight wobble (hand-drawn lines). */
  const boardDefs = () => '<defs><filter id="wbRough" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.2"/></filter></defs>';

  // ------------------------------------------------------------------ the lesson, planned (one AI call)
  /** host.ai({system, user, maxTokens, json}) -> the reply's text. opts: { request, length, level }. */
  async function plan(host, opts) {
    const p = planPrompt(opts);
    const raw = await host.ai({ system: p.system, user: p.user, maxTokens: p.maxTokens, json: true });
    return parsePlan(raw, opts);
  }

  // ------------------------------------------------------------------ the hand that draws (the marker's tip at 0, 0)
  const HAND_SVG =
    '<path d="M70 92 L118 140 L150 112 L100 66 Z" fill="#334155"/>' +
    '<path d="M0 0 L9 2 L56 50 L50 56 L2 9 Z" fill="#0f766e" stroke="#064e46" stroke-width="1.2"/><path d="M0 0 L9 2 L2 9 Z" fill="#111827"/>' +
    '<path d="M50 56 L56 50 L66 60 L60 66 Z" fill="#e2e8f0"/>' +
    '<path d="M34 46 C34 34 50 30 60 36 C70 32 84 40 82 54 C90 60 88 74 78 78 C74 90 56 94 46 86 C34 82 30 66 34 46 Z" fill="#f2c9a6" stroke="#b9805e" stroke-width="2"/>' +
    '<path d="M34 46 C28 42 28 32 36 30 C42 28 48 34 50 40" fill="#f2c9a6" stroke="#b9805e" stroke-width="2"/>' +
    '<path d="M44 48 C50 46 56 48 60 52 M42 58 C50 56 58 58 62 64 M44 68 C52 68 58 70 62 74" fill="none" stroke="#b9805e" stroke-width="1.8" stroke-linecap="round"/>';

  /** How long an item takes to draw, as a share of its beat (heavier items get more of the time). */
  function weight(it) {
    const chars = (it.text || '').length + (it.items || []).join('').length + (it.steps || []).join('').length + (it.label || '').length + (it.say || '').length +
      (it.columns || []).reduce((n, c) => n + c.title.length + c.points.join('').length, 0) + (it.events || []).reduce((n, e) => n + e.label.length + e.text.length, 0) + (it.labels || []).reduce((n, l) => n + (l.text || l || '').length, 0);
    const base = { person: 1.6, icon: 1.1, sketch: 1.2 + (it.paths || []).length * 0.15, diagram: 2.6, flow: 1 + (it.steps || []).length * 0.5, cycle: 1 + (it.steps || []).length * 0.5, compare: 1.2, timeline: 1, chart: 1.4, list: 0.6, box: 0.8, circle: 0.8, arrow: 0.6, line: 0.5, note: 0.9, callout: 0.8, equation: 0.6, text: 0.4, emphasis: 0.5, image: 1, picture: 0 }[it.type] || 1;
    return base + chars * 0.03;
  }

  // ------------------------------------------------------------------ the player
  const UI_ICON = {
    play: 'M8 5l12 7-12 7z', pause: 'M7 5h3v14H7zM14 5h3v14h-3z', prev: 'M7 5v14M18 5l-9 7 9 7z', next: 'M17 5v14M6 5l9 7-9 7z',
    replay: 'M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4', cc: 'M3 6h18v12H3zM10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3', sound: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11', muted: 'M4 9v6h4l5 4V5L8 9zM16 9l5 6M21 9l-5 6',
    ask: 'M4 5h16v11H9l-5 4z',
  };
  const uiIcon = (n, filled) => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="${UI_ICON[n]}" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  /**
   * Plays [lesson] in [el]: Lixa writes each scene (one ahead), draws it with a hand and says it.
   * host: {
   *   ai({system, user, maxTokens, json, stream}, onText) -> Promise<the whole reply>   (onText gets each piece when streaming)
   *   voice: null | { open() -> session }   session: { add(sentence), close(), onSentence(fn(index)), done: Promise, stop(), pause(), resume(), failed }
   *   save(lesson)            (the host saves it; called when it changes)
   *   picture: null | (prompt) -> Promise<{src, w, h} | null>   (AI pictures: Pro / Max, switched on)
   *   toast(message, kind), onScene(index, scene), onEnd()
   * }
   * Returns { lesson(), play(k), pause(), resume(), toggle(), go(k), ask(question), scene(), playing(), muted(on), destroy() }.
   */
  function mount(el, initial, host) {
    const h = host || {};
    const lesson = normalizeLesson(initial);
    const writing = new Map();                           // scene -> its writing (a promise)
    let cur = 0, run = null, ended = false, captions = true, muted = false, pictureBudget = 2, destroyed = false;
    try { captions = localStorage.getItem('rehab-wb-cc') !== '0'; muted = localStorage.getItem('rehab-wb-muted') === '1'; } catch (e) { /* storage blocked */ }

    el.innerHTML = `<div class="wbx">
      <div class="wbx-stage">
        <svg class="wbx-board" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Whiteboard">${boardDefs()}<rect width="${W}" height="${H}" fill="#fdfdfb"/><g class="wbx-ink"></g><g class="wbx-hand" visibility="hidden"><g transform="scale(1.15)">${HAND_SVG}</g></g></svg>
        <div class="wbx-wipe" aria-hidden="true"></div>
        <div class="wbx-cover" hidden><div class="wbx-spin" aria-hidden="true"></div><p class="wbx-cover-text"></p></div>
        <button type="button" class="wbx-bigplay" hidden aria-label="Play the lesson">${uiIcon('play', true)}<span>Play the lesson</span></button>
        <div class="wbx-caption" hidden aria-live="polite"></div>
      </div>
      <div class="wbx-controls">
        <button type="button" class="wbx-btn" data-a="prev" aria-label="Previous scene">${uiIcon('prev', true)}</button>
        <button type="button" class="wbx-btn wbx-main" data-a="toggle" aria-label="Play">${uiIcon('play', true)}</button>
        <button type="button" class="wbx-btn" data-a="next" aria-label="Next scene">${uiIcon('next', true)}</button>
        <div class="wbx-where"><b></b><span></span></div>
        <button type="button" class="wbx-btn" data-a="replay" aria-label="Play this scene again">${uiIcon('replay')}</button>
        <button type="button" class="wbx-btn" data-a="cc" aria-label="Captions">${uiIcon('cc')}</button>
        <button type="button" class="wbx-btn" data-a="mute" aria-label="Mute Lixa">${uiIcon('sound')}</button>
      </div>
      <div class="wbx-scenes" role="list"></div>
      <form class="wbx-ask"><span class="wbx-ask-ico">${uiIcon('ask')}</span><input type="text" maxlength="600" aria-label="Ask Lixa about this lesson" placeholder="Ask Lixa about this lesson… e.g. “explain that more simply” or “give a real patient example”"><button type="submit" class="wbx-askgo">Ask</button></form>
    </div>`;
    const $ = s => el.querySelector(s);
    const svg = $('.wbx-board'), ink = $('.wbx-ink'), hand = $('.wbx-hand'), caption = $('.wbx-caption'), cover = $('.wbx-cover'), bigplay = $('.wbx-bigplay');
    const toast = (m, k) => { if (h.toast) h.toast(m, k); };
    const save = () => { if (h.save) h.save(leanLesson(lesson)); };

    // ---- what the board shows
    let drawn = [];                                      // the items on the board now (title first)
    const setCaption = t => { caption.textContent = t || ''; caption.hidden = !captions || !t; };
    const showCover = t => { $('.wbx-cover-text').textContent = t; cover.hidden = false; };
    const hideCover = () => { cover.hidden = true; };
    function clearBoard() { ink.innerHTML = ''; drawn = []; hand.setAttribute('visibility', 'hidden'); }
    /** A scene shown whole at once (paused on it, or skipped to without playing). */
    function showScene(k) {
      clearBoard();
      const sc = lesson.scenes[k]; if (!sc) return;
      drawn = [{ type: 'title', text: sc.title }].concat(sceneItems(sc));
      ink.innerHTML = drawn.map(it => `<g>${rough(render(it, drawn))}</g>`).join('');
    }

    function updateUi() {
      const sc = lesson.scenes[cur];
      $('.wbx-where b').textContent = 'Scene ' + (cur + 1) + ' of ' + lesson.scenes.length;
      $('.wbx-where span').textContent = sc ? sc.title : '';
      const playing = !!run && !run.paused;
      const t = $('[data-a="toggle"]'); t.innerHTML = uiIcon(playing ? 'pause' : 'play', true); t.setAttribute('aria-label', playing ? 'Pause' : 'Play');
      $('[data-a="prev"]').disabled = cur <= 0;
      $('[data-a="next"]').disabled = cur >= lesson.scenes.length - 1;
      $('[data-a="cc"]').classList.toggle('on', captions); $('[data-a="cc"]').setAttribute('aria-pressed', String(captions));
      $('[data-a="mute"]').innerHTML = uiIcon(muted ? 'muted' : 'sound'); $('[data-a="mute"]').setAttribute('aria-label', muted ? 'Let Lixa speak' : 'Mute Lixa');
      $('.wbx-scenes').innerHTML = lesson.scenes.map((s, i) => `<button type="button" role="listitem" class="wbx-chip${i === cur ? ' on' : ''} wbx-${s.status}" data-scene="${i}" title="${esc(s.title)}"><i>${i + 1}</i>${esc(s.title)}${s.status === 'writing' ? '<em> · writing…</em>' : s.status === 'failed' ? '<em> · not written</em>' : ''}</button>`).join('');
    }

    // ---- writing a scene (the AI, as a stream of beats); the next one is written while one plays
    function sceneIndex(sc) { return lesson.scenes.indexOf(sc); }
    function write(sc) {
      if (!sc || sc.status === 'ready') return Promise.resolve(!!sc);
      if (writing.has(sc)) return writing.get(sc);
      const job = (async () => {
        sc.status = 'writing'; updateUi();
        let error = null;
        for (let attempt = 0; attempt < 2 && !sc.beats.length && !destroyed; attempt++) {
          const used = {};
          const parser = sceneParser(ev => {
            if (ev.type === 'title' && sc.followup) { sc.title = str(ev.title, 80) || sc.title; updateUi(); return; }
            if (ev.type !== 'beat' || sc.beats.length >= 14) return;
            const b = normBeat(ev.beat, used); if (!b) return;
            layoutBeat(sc, b);
            b.draw.forEach(it => { if (it.type === 'picture') askPicture(it); });
            sc.beats.push(b);
          });
          try {
            const k = sceneIndex(sc), p = scenePrompt(lesson, k < 0 ? 0 : k, { picture: !!h.picture && pictureBudget > 0 });
            await h.ai({ system: p.system, user: p.user, maxTokens: p.maxTokens, stream: true }, t => parser.push(t));
          } catch (e) { error = e; }
          parser.end();
        }
        sc.status = sc.beats.length ? 'ready' : 'failed';
        writing.delete(sc);
        if (sc.status === 'failed') toast('Lixa could not write the scene “' + sc.title + '”' + (error && error.message ? ': ' + error.message : '.'), 'error');
        updateUi(); save();
        return sc.status === 'ready';
      })();
      writing.set(sc, job);
      return job;
    }
    function askPicture(it) {
      if (!h.picture || pictureBudget <= 0) { it.type = 'picture'; return; }
      pictureBudget--;
      it.pending = Promise.resolve(h.picture(it.prompt)).then(p => { if (p && p.src) { it.type = 'image'; it.src = p.src; delete it.prompt; save(); } }).catch(() => {}).then(() => { delete it.pending; });
    }

    // ---- drawing, in step with the voice
    async function until(r, cond, timeout) {
      const t0 = Date.now();
      while (!r.stopped && !cond() && !(timeout && Date.now() - t0 > timeout)) await sleep(60);
    }
    /** Waits [ms] of playing time (a pause stops the clock). */
    async function hold(r, ms) {
      let left = ms;
      while (left > 0 && !r.stopped) { await sleep(60); if (!r.paused) left -= 60; }
    }
    // (words first for text-led items: a title is written, then underlined)
    const TEXT_FIRST = { title: 1, text: 1, list: 1, equation: 1 };
    function animateGroup(g, ms, r, hurry, textFirst) {
      const toBoard = n => { try { return svg.getScreenCTM().inverse().multiply(n.getScreenCTM()); } catch (e) { return null; } };
      const strokes = [], fills = [], texts = [], images = [];
      g.querySelectorAll('path, line, polyline, rect, ellipse, circle').forEach(n => {
        const st = n.getAttribute('stroke'), fill = n.getAttribute('fill'), sw = parseFloat(n.getAttribute('stroke-width') || '1');
        if (st && st !== 'none' && st !== 'transparent' && sw > 0) {
          let real = 0; try { real = n.getTotalLength(); } catch (e) { real = 0; }
          if (real > 0) { strokes.push({ n, real, m: toBoard(n) }); n.style.strokeDasharray = real + ' ' + real; n.style.strokeDashoffset = real; }
        }
        if (fill && fill !== 'none' && fill !== 'transparent') { fills.push(n); n.style.fillOpacity = 0; }
      });
      g.querySelectorAll('text').forEach(t => { texts.push({ t, full: t.textContent, m: toBoard(t) }); t.textContent = ''; });
      g.querySelectorAll('image').forEach(im => { images.push(im); im.style.opacity = 0; });
      const total = strokes.reduce((a, s) => a + s.real, 0), chars = texts.reduce((a, x) => a + x.full.length, 0);
      const tS = strokes.length ? (chars ? (textFirst ? 0.3 : 0.5) : 0.85) : 0, tW = chars ? (strokes.length ? (textFirst ? 0.6 : 0.4) : 0.95) : 0, tF = 1 - tS - tW;
      // (start of each phase: strokes, fills, words; or words, strokes, fills)
      const oS = textFirst ? tW : 0, oF = textFirst ? tW + tS : tS, oW = textFirst ? 0 : tS + tF;
      const place = (x, y) => { hand.setAttribute('transform', `translate(${x} ${y})`); hand.setAttribute('visibility', 'visible'); };
      return new Promise(resolve => {
        let elapsed = 0, last = null;
        const frame = now => {
          if (r.stopped || destroyed) { resolve(); return; }
          const dt = last == null ? 0 : now - last; last = now;
          if (!r.paused) elapsed += dt * (hurry() ? 5 : 1);
          const p = Math.min(1, elapsed / ms);
          let along = (tS ? Math.max(0, Math.min(1, (p - oS) / tS)) : 1) * total;
          strokes.forEach(s => {
            const d = Math.max(0, Math.min(s.real, along)); along -= s.real;
            s.n.style.strokeDashoffset = s.real - d;
            if (d > 0 && d < s.real && s.m) { try { const q = s.n.getPointAtLength(d), b = new DOMPoint(q.x, q.y).matrixTransform(s.m); place(b.x, b.y); } catch (e) { /* not laid out */ } }
          });
          const fp = tF > 0 ? Math.max(0, Math.min(1, (p - oF) / tF)) : (p >= 1 ? 1 : 0);
          fills.forEach(n => { n.style.fillOpacity = fp; });
          images.forEach(im => { im.style.opacity = fp; });
          const wp = tW ? Math.max(0, Math.min(1, (p - oW) / tW)) : 1;
          let left = Math.round(wp * chars);
          texts.forEach(x => {
            const n = Math.max(0, Math.min(x.full.length, left)); left -= x.full.length;
            if (x.t.textContent.length !== n) {
              x.t.textContent = x.full.slice(0, n);
              if (n > 0 && n < x.full.length && x.m) { try { const e = x.t.getEndPositionOfChar(n - 1), b = new DOMPoint(e.x, e.y).matrixTransform(x.m); place(b.x + 3, b.y - 2); } catch (e) { /* not laid out */ } }
            }
          });
          if (p >= 1) { strokes.forEach(s => { s.n.style.strokeDasharray = ''; s.n.style.strokeDashoffset = ''; }); resolve(); } else tick();
        };
        // (a hidden page gets no animation frames; the drawing keeps time with her voice anyway)
        const tick = () => (document.hidden ? setTimeout(() => frame(performance.now()), 100) : requestAnimationFrame(frame));
        tick();
      });
    }
    async function drawItem(it, ms, r, hurry) {
      const all = drawn.concat([it]);
      const out = render(it, all);
      drawn.push(it);
      if (!out.svg) return;
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.innerHTML = rough(out);
      ink.appendChild(g);
      await animateGroup(g, Math.max(450, Math.min(9000, ms)), r, hurry, !!TEXT_FIRST[it.type]);
    }
    async function wipe(r) {
      if (!ink.childNodes.length) return;
      hand.setAttribute('visibility', 'hidden');
      const w = $('.wbx-wipe');
      w.classList.remove('go'); void w.offsetWidth; w.classList.add('go');
      await hold(r, 380);
      clearBoard();
      await hold(r, 380);
      w.classList.remove('go');
    }

    /** One scene: written (if it is not yet), drawn beat by beat while she says it. Resolves false when stopped. */
    async function playScene(k, r) {
      const sc = lesson.scenes[k];
      write(sc);
      if (!sc.beats.length) {
        showCover('Lixa is preparing “' + sc.title + '”…');
        await until(r, () => sc.beats.length || sc.status === 'failed');
        hideCover();
      }
      if (r.stopped) return false;
      if (!sc.beats.length) return true;                 // (it could not be written: on to the next)
      const next = lesson.scenes[k + 1];
      if (next) write(next);                             // the next one is written while this one plays
      if (h.onScene) h.onScene(k, sc);
      await wipe(r);
      if (r.stopped) return false;
      const title = { type: 'title', text: sc.title };
      await drawItem(title, 1100, r, () => false);
      // her voice, sentence by sentence, as the beats come
      const sess = !muted && h.voice ? h.voice.open() : null;
      const sentences = [], first = [], lastOf = [];
      let fed = 0, said = -1, voiceDone = false, closed = false;
      r.sess = sess;
      if (sess) {
        sess.onSentence(i => { said = i; setCaption(sentences[i]); });
        Promise.resolve(sess.done).then(() => { voiceDone = true; });
      }
      const voiced = () => sess && !sess.failed && !voiceDone;
      const feed = () => {
        while (fed < sc.beats.length) {
          const ss = sentencesOf(sc.beats[fed].say);
          first[fed] = sentences.length;
          ss.forEach(s => { sentences.push(s); if (sess) sess.add(s); });
          lastOf[fed] = sentences.length - 1;
          fed++;
        }
        if (sess && !closed && sc.status !== 'writing' && fed >= sc.beats.length) { closed = true; sess.close(); }
      };
      for (let j = 0; ; j++) {
        feed();
        await until(r, () => j < sc.beats.length || sc.status !== 'writing');
        if (r.stopped) return false;
        if (j >= sc.beats.length) break;
        feed();
        const b = sc.beats[j], est = speechMs(b.say), t0 = Date.now();
        const withVoice = !!(b.say && voiced());
        // the drawing of a beat starts when she starts saying it
        if (withVoice) await until(r, () => said >= first[j] || !voiced(), 20000);
        if (r.stopped) return false;
        if (!(b.say && voiced())) setCaption(b.say);
        const tw = b.draw.reduce((a, it) => a + weight(it), 0) || 1;
        const moved = () => voiced() && said > lastOf[j];
        for (const it of b.draw) {
          await until(r, () => !r.paused);
          if (r.stopped) return false;
          if (it.pending) await Promise.race([it.pending, sleep(6000)]);
          await drawItem(it, est * 0.88 * weight(it) / tw, r, moved);
          if (r.stopped) return false;
        }
        hand.setAttribute('visibility', 'hidden');
        // then the rest of what she says about it (or, without her voice, time to read the caption)
        if (b.say && voiced()) await until(r, () => said > lastOf[j] || !voiced());
        else await hold(r, Math.max(0, est - (Date.now() - t0)));
        if (r.stopped) return false;
      }
      if (sess && !closed) { closed = true; sess.close(); }
      if (sess) await until(r, () => voiceDone || sess.failed, 90000);
      if (r.stopped) return false;
      setCaption('');
      await hold(r, 900);
      return !r.stopped;
    }

    function stopRun() {
      const r = run; run = null;
      if (!r) return;
      r.stopped = true;
      if (r.sess) { try { r.sess.stop(); } catch (e) { /* gone */ } }
      hand.setAttribute('visibility', 'hidden');
    }
    async function playFrom(k) {
      stopRun();
      if (!lesson.scenes.length) return;
      ended = false; bigplay.hidden = true; hideCover();
      const r = run = { stopped: false, paused: false, sess: null };
      cur = Math.max(0, Math.min(k, lesson.scenes.length - 1));
      updateUi();
      for (let i = cur; i < lesson.scenes.length; i++) {
        cur = i; updateUi();
        const ok = await playScene(i, r);
        if (!ok || r.stopped) return;
      }
      if (run === r) {
        run = null; ended = true; setCaption('');
        bigplay.querySelector('span').textContent = 'Watch again';
        bigplay.hidden = false; updateUi();
        if (h.onEnd) h.onEnd();
      }
    }
    function pause() { if (!run || run.paused) return; run.paused = true; if (run.sess && run.sess.pause) run.sess.pause(); hand.setAttribute('visibility', 'hidden'); updateUi(); }
    function resume() { if (!run || !run.paused) return; run.paused = false; if (run.sess && run.sess.resume) run.sess.resume(); updateUi(); }
    function toggle() { if (run) { if (run.paused) resume(); else pause(); } else playFrom(ended ? 0 : cur); }

    /** The learner's question: a scene that answers it, right after the one playing, played at once. */
    function ask(question) {
      const q = str(question, 600);
      if (!q) return;
      const at = Math.min(cur + 1, lesson.scenes.length);
      lesson.scenes.splice(at, 0, { title: 'Your question', goal: 'Answer the learner\'s question: ' + q, visual: '', followup: q, status: 'empty', beats: [] });
      updateUi(); save();
      playFrom(at);
    }

    // ---- the controls
    const onClick = e => {
      const b = e.target.closest('button'); if (!b || !el.contains(b)) return;
      if (b.dataset.scene) { playFrom(Number(b.dataset.scene)); return; }
      if (b === bigplay) { playFrom(ended ? 0 : cur); return; }
      switch (b.dataset.a) {
        case 'toggle': toggle(); break;
        case 'prev': playFrom(cur - 1); break;
        case 'next': playFrom(cur + 1); break;
        case 'replay': playFrom(cur); break;
        case 'cc': captions = !captions; try { localStorage.setItem('rehab-wb-cc', captions ? '1' : '0'); } catch (x) { /* blocked */ } caption.hidden = !captions || !caption.textContent; updateUi(); break;
        case 'mute': setMuted(!muted); break;
      }
    };
    function setMuted(on) {
      muted = !!on;
      try { localStorage.setItem('rehab-wb-muted', muted ? '1' : '0'); } catch (x) { /* blocked */ }
      // (muted now: she stops at once and the drawing goes on at reading pace; her voice comes back with the next scene)
      if (muted && run && run.sess) { try { run.sess.stop(); } catch (x) { /* gone */ } run.sess.failed = true; }
      updateUi();
    }
    const onSubmit = e => { e.preventDefault(); const input = $('.wbx-ask input'); const q = input.value.trim(); if (!q) return; input.value = ''; ask(q); };
    el.addEventListener('click', onClick);
    $('.wbx-ask').addEventListener('submit', onSubmit);
    const onKey = e => {
      if (!el.isConnected || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return;
      if (e.key === ' ') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight' && cur < lesson.scenes.length - 1) playFrom(cur + 1);
      else if (e.key === 'ArrowLeft' && cur > 0) playFrom(cur - 1);
    };
    document.addEventListener('keydown', onKey);

    // the start: the first scene shown ready to play (a lesson already written shows its first page)
    if (lesson.scenes[0] && lesson.scenes[0].beats.length) showScene(0);
    bigplay.hidden = false;
    updateUi();

    return {
      lesson: () => lesson, scene: () => cur, playing: () => !!run && !run.paused, living: () => !!run,
      play: k => playFrom(k == null ? (ended ? 0 : cur) : k), go: k => playFrom(k), pause, resume, toggle, ask,
      muted: on => { if (on != null) setMuted(on); return muted; },
      destroy() { destroyed = true; stopRun(); document.removeEventListener('keydown', onKey); el.removeEventListener('click', onClick); el.innerHTML = ''; },
    };
  }

  root.RehablixWhiteboard = {
    W, H, COLORS, LENGTHS, DIAGRAMS, ICONS, POSES, diagramKey, iconKey,
    planPrompt, parsePlan, scenePrompt, sceneParser, plan, normalizeLesson, leanLesson, render, toSVG, toPNG, mount, sentencesOf, speechMs,
  };
})(typeof window !== 'undefined' ? window : this);
