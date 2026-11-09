// js/space/arcade/game-chess.js — Clinical Chess: real chess against the computer (chess-engine.js) on a tilted 3D
// board. The clinical twist: to capture a piece you must answer a knowledge check; a wrong answer blocks the capture
// (the move is not played) and you choose again. Drag a piece, or tap it and then a square.
(function () {
  'use strict';
  const K = window.RxArcade, A = window.RxArcadeContent, C = window.RxChess;

  // Pieces: simple, clear silhouettes (our own drawings), filled with an ivory or onyx gradient.
  const SHAPES = {
    p: '<circle cx="22.5" cy="13" r="6.2"/><path d="M16.5 21.5Q22.5 17 28.5 21.5L27 31H18Z"/><path d="M11.5 38.5Q11.5 31.5 17.5 30.5H27.5Q33.5 31.5 33.5 38.5Z"/>',
    r: '<path d="M11 8.5H16V12H20V8.5H25V12H29V8.5H34V16L30.5 18.5V30L34 33.5V38.5H11V33.5L14.5 30V18.5L11 16Z"/>',
    b: '<circle cx="22.5" cy="7.5" r="3"/><path d="M22.5 10.5C14.5 16 14.5 24.5 18 28.5H27C30.5 24.5 30.5 16 22.5 10.5Z"/><path d="M13 38.5Q13 31 18 29.5H27Q32 31 32 38.5Z"/><path d="M20 17.5L26 23.5" fill="none" stroke-width="2"/>',
    n: '<path d="M13.5 38.5L14.5 30Q15.5 24 20 21L14.5 19.5Q12 15.5 16 11.5L21.5 7.5L23.5 4L26 8.5Q34 12 33.5 23L32.5 38.5Z"/><circle cx="20" cy="13" r="1.4" fill="currentColor"/>',
    q: '<path d="M10.5 13L15 26.5L18 10.5L22.5 25L27 10.5L30 26.5L34.5 13L31 31H14Z"/><path d="M12 38.5Q12 32 14 31H31Q33 32 33 38.5Z"/><circle cx="10.5" cy="11" r="2.4"/><circle cx="18" cy="8.5" r="2.4"/><circle cx="27" cy="8.5" r="2.4"/><circle cx="34.5" cy="11" r="2.4"/>',
    k: '<path d="M21 3.5H24V7.5H28V10.5H24V13.5H21V10.5H17V7.5H21Z"/><path d="M22.5 13.5C13.5 13.5 11.5 22 14.5 30.5H30.5C33.5 22 31.5 13.5 22.5 13.5Z"/><path d="M12 38.5Q12 32 14.5 30.5H30.5Q33 32 33 38.5Z"/>',
  };
  const svg = (p) => {
    const white = p === p.toUpperCase();
    return '<svg viewBox="0 0 45 45" style="color:' + (white ? '#1f2937' : '#f8fafc') + '"><g fill="url(#' + (white ? 'rxaIvory' : 'rxaOnyx') + ')" stroke="' + (white ? '#3f3f46' : '#e2e8f0') + '" stroke-width="1.4" stroke-linejoin="round">' + SHAPES[p.toLowerCase()] + '</g></svg>';
  };
  const DEFS = '<svg width="0" height="0" style="position:absolute"><defs>' +
    '<linearGradient id="rxaIvory" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#f5ecd7"/><stop offset="1" stop-color="#cbb894"/></linearGradient>' +
    '<linearGradient id="rxaOnyx" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#64748b"/><stop offset="0.45" stop-color="#1e293b"/><stop offset="1" stop-color="#020617"/></linearGradient></defs></svg>';
  const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  const LEVELS = [
    { id: 'easy', label: '🌱 Easy', sub: 'Learning the moves; the computer sometimes slips' },
    { id: 'normal', label: '⚔️ Normal', sub: 'Looks two moves ahead' },
    { id: 'hard', label: '🔥 Hard', sub: 'Looks three moves ahead and punishes mistakes' },
  ];

  K.games.chess = {
    title: 'Clinical Chess', emoji: '♟️', color: '#8b5cf6', color2: '#0ea5e9',
    start(stage) {
      let alive = true;
      stage.onCleanup(() => { alive = false; });
      chooseLevel();

      function chooseLevel() {
        stage.body.innerHTML = DEFS + '<div class="rxa-glass" style="padding:16px;border-radius:20px">' +
          '<div class="rxa-title" style="font-size:1.25rem">Real chess, with a clinical twist</div>' +
          '<p class="rxa-muted" style="margin-top:6px">You play white. To capture a piece, answer a quick clinical question: get it right and the capture stands; get it wrong and you must choose another move.</p>' +
          '<div class="rxa-level"></div></div>';
        const box = stage.body.querySelector('.rxa-level');
        LEVELS.forEach((L) => {
          const b = K.h('button', 'rxa-opt', '<b>' + L.label + '</b><div class="rxa-muted" style="font-weight:500;margin-top:2px">' + K.esc(L.sub) + '</div>');
          b.onclick = () => play(L.id);
          box.appendChild(b);
        });
      }

      function play(level) {
        const g = new C.Game();
        let selected = null, last = null, busy = false, checksRight = 0, checksWrong = 0;
        const taken = { w: [], b: [] };          // pieces taken BY white / BY black
        const learned = [];
        stage.body.innerHTML = DEFS +
          '<div class="rxa-chess-info"><div class="rxa-tray" data-t="b"></div><span class="rxa-muted" data-s>Computer</span></div>' +
          '<div class="rxa-chess-wrap"><div class="rxa-chess"></div></div>' +
          '<div class="rxa-chess-info"><div class="rxa-tray" data-t="w"></div><span data-turn style="font-weight:800">Your move</span></div>' +
          '<div class="rxa-row" style="margin-top:8px"><button class="rxa-btn small ghost" data-a="resign">Resign</button></div><div class="rxa-after"></div>';
        const boardEl = stage.body.querySelector('.rxa-chess'), turnEl = stage.body.querySelector('[data-turn]'), after = stage.body.querySelector('.rxa-after');
        stage.body.querySelector('[data-a="resign"]').onclick = () => { if (!busy) end('loss', 'You resigned'); };

        function render() {
          const grid = g.grid(), legal = selected ? g.moves().filter((m) => C.sqName(m.from) === selected) : [];
          const targets = new Map(legal.map((m) => [C.sqName(m.to), m]));
          const st = g.status();
          const kingInCheck = st.check || (st.result === 'checkmate') ? C.sqName(g.kingSquare(g.turn)) : null;
          boardEl.innerHTML = '';
          grid.forEach((row, r) => row.forEach((cell, c) => {
            const sq = K.h('div', 'rxa-sq ' + ((r + c) % 2 ? 'd' : 'l'));
            sq.dataset.sq = cell.square;
            if (last && (last.from === cell.square || last.to === cell.square)) sq.classList.add('last');
            if (selected === cell.square) sq.classList.add('sel');
            if (kingInCheck === cell.square) sq.classList.add('check');
            if (c === 0) sq.appendChild(K.h('span', 'rxa-coord r', String(8 - r)));
            if (r === 7) sq.appendChild(K.h('span', 'rxa-coord f', 'abcdefgh'[c]));
            if (cell.piece) {
              const pc = K.h('div', 'rxa-piece', svg(cell.piece));
              const mine = cell.piece === cell.piece.toUpperCase();
              pc.style.pointerEvents = mine ? 'auto' : 'none';
              if (mine) {
                K.draggable(pc, {
                  hit: (x, y) => { const e = document.elementFromPoint(x, y); return e && e.closest && e.closest('.rxa-sq'); },
                  targets: () => Array.from(boardEl.querySelectorAll('.rxa-sq')),
                  onLift: () => { if (!busy) { selected = cell.square; } },
                  onDrop: (t) => { if (busy) return false; selected = cell.square; return tryMove(cell.square, t.dataset.sq); },
                  onTap: () => { if (busy) return; selected = selected === cell.square ? null : cell.square; K.sfx.tap(); render(); },
                });
              }
              sq.appendChild(pc);
            }
            if (targets.has(cell.square)) sq.appendChild(K.h('span', cell.piece || targets.get(cell.square).flags === 'e' ? 'ring' : 'dot'));
            sq.onclick = () => { if (!busy && selected && targets.has(cell.square)) tryMove(selected, cell.square); };
            boardEl.appendChild(sq);
          }));
          ['w', 'b'].forEach((side) => { stage.body.querySelector('[data-t="' + side + '"]').innerHTML = taken[side].map(svg).join(''); });
        }

        function tryMove(from, to) {
          const options = g.moves().filter((m) => C.sqName(m.from) === from && C.sqName(m.to) === to);
          if (!options.length) { selected = null; render(); return false; }
          busy = true;
          const promo = options.length > 1 ? choosePromotion() : Promise.resolve(null);
          promo.then((p) => {
            const m = p ? options.find((x) => x.promotion && x.promotion.toLowerCase() === p) : options[0];
            if (!m.captured) { commit(m); return; }
            // the clinical twist: answer to capture
            const check = A.knowledgeCheck();
            stage.ask(check).then((ok) => {
              if (!alive) return;
              if (ok) { checksRight++; stage.addScore(10); commit(m); }
              else {
                checksWrong++;
                if (learned.length < 5) learned.push(check.note);
                busy = false; selected = null;
                after.innerHTML = ''; after.appendChild(stage.explain('no', 'Capture blocked! Choose another move.', ''));
                render();
              }
            });
          });
          return true;
        }
        function choosePromotion() {
          return new Promise((resolve) => {
            const m = K.h('div', 'rxa-modal');
            const card = K.h('div', 'rxa-modal-card rxa-glass', '<div class="rxa-q">Promote your pawn to:</div>');
            const row = K.h('div', 'rxa-row');
            ['q', 'r', 'b', 'n'].forEach((t) => {
              const b = K.h('button', 'rxa-opt', '<div style="width:46px;height:46px">' + svg(t.toUpperCase()) + '</div>');
              b.setAttribute('aria-label', NAMES[t]);
              b.onclick = () => { m.remove(); resolve(t); };
              row.appendChild(b);
            });
            card.appendChild(row); m.appendChild(card); stage.el.appendChild(m);
          });
        }
        function commit(m) {
          if (m.captured) taken[g.turn].push(m.captured);
          g.make(m);
          last = { from: C.sqName(m.from), to: C.sqName(m.to) };
          selected = null;
          K.sfx.drop();
          after.innerHTML = '';
          render();
          if (finished()) return;
          // the computer's turn
          turnEl.textContent = '🤖 Thinking…';
          setTimeout(() => {
            if (!alive) return;
            const reply = g.bestMove(level);
            if (!reply) { finished(); return; }
            if (reply.captured) taken[g.turn].push(reply.captured);
            g.make(reply);
            last = { from: C.sqName(reply.from), to: C.sqName(reply.to) };
            busy = false;
            K.sfx.tap();
            render();
            if (!finished()) turnEl.textContent = g.inCheck() ? '⚠️ Check! Your move' : 'Your move';
            if (reply.captured && !after.childNodes.length) after.appendChild(stage.explain('info', 'The computer took your ' + NAMES[reply.captured.toLowerCase()] + '.', ''));
          }, 380);
        }
        function finished() {
          const st = g.status();
          if (!st.over) return false;
          busy = true;
          if (st.result === 'checkmate') end(st.winner === 'w' ? 'win' : 'loss', st.winner === 'w' ? 'Checkmate! You win' : 'Checkmate');
          else end('draw', { stalemate: 'Stalemate', fifty: 'Draw by the 50-move rule', repetition: 'Draw by repetition', material: 'Draw: not enough pieces to mate' }[st.result]);
          return true;
        }
        function end(result, title) {
          if (!alive) return;
          busy = true;
          stage.finish({
            title, big: checksRight + '/' + (checksRight + checksWrong), sub: 'knowledge checks right · ' + level,
            xp: A.xp.chess(result, level, checksRight), trophy: result === 'win' ? '👑' : result === 'draw' ? '🤝' : '♟️',
            lines: learned.slice(0, 3),
          });
        }
        render();
      }
    },
  };
})();
