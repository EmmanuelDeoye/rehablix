// js/space/arcade/game-wordlab.js — Word Lab: clinical Scrabble. Read the clue, drag letter tiles onto the board to
// spell the term. Letter values, bonus squares (DL, DW), a speed bonus and a teaching note after every word.
(function () {
  'use strict';
  const K = window.RxArcade, A = window.RxArcadeContent;
  const WORDS_PER_GAME = 8;

  K.games.wordlab = {
    title: 'Word Lab', emoji: '🔤', color: '#f59e0b', color2: '#ec4899',
    start(stage) {
      const round = A.wordLabRound((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0, WORDS_PER_GAME);
      const results = [];
      let i = 0, points = 0, solvedClean = 0;
      const learned = [];

      function show() {
        const w = round[i];
        const n = w.word.length;
        // tile size that fits the word on one line of the screen
        const width = Math.min(stage.el.clientWidth - 40, 560);
        const tile = Math.max(24, Math.min(48, Math.floor((width - (n - 1) * 5) / n)));
        let hints = 0, t0 = Date.now(), done = false;
        const placed = new Array(n).fill(null);          // slot -> tile id
        stage.body.innerHTML = stage.dots(WORDS_PER_GAME, i, results) +
          '<div class="rxa-clue rxa-glass"><span class="cat">' + K.esc(w.cat) + ' · ' + n + ' letters</span><p>' + K.esc(w.clue) + '</p></div>' +
          '<div class="rxa-board"><div class="rxa-board-plane"><div class="rxa-slots"></div></div></div>' +
          '<div class="rxa-rack"></div>' +
          '<div class="rxa-row" style="margin-top:14px"><button class="rxa-btn small ghost" data-a="shuffle">🔀 Shuffle</button>' +
          '<button class="rxa-btn small ghost" data-a="hint">💡 Hint</button><button class="rxa-btn small ghost" data-a="skip">Skip</button></div>' +
          '<div class="rxa-after"></div>';
        const slotsEl = stage.body.querySelector('.rxa-slots'), rack = stage.body.querySelector('.rxa-rack'), after = stage.body.querySelector('.rxa-after');
        const slots = Array.from({ length: n }, (_, k) => {
          const s = K.h('div', 'rxa-slot');
          s.style.setProperty('--tile', tile + 'px');
          if (w.bonus[k]) s.appendChild(K.h('span', 'b ' + w.bonus[k], w.bonus[k]));
          s.dataset.slot = String(k);
          slotsEl.appendChild(s);
          return s;
        });
        const tileEls = {};
        const makeTile = (t) => {
          const e = K.h('div', 'rxa-tile', K.esc(t.ch) + '<sub>' + t.value + '</sub>');
          e.style.setProperty('--tile', Math.max(36, Math.min(48, tile + 6)) + 'px');
          e.dataset.id = t.id;
          K.draggable(e, {
            targets: () => slots.filter((s, k) => !placed[k]),
            onDrop: (slot) => { place(t.id, Number(slot.dataset.slot)); return true; },
            onTap: () => { const k = placed.indexOf(null); if (k >= 0) place(t.id, k); },
          });
          tileEls[t.id] = e;
          return e;
        };
        w.tiles.forEach((t) => rack.appendChild(makeTile(t)));

        function place(id, k) {
          if (done || placed[k]) return;
          placed[k] = id;
          K.sfx.drop();
          const t = w.tiles.find((x) => x.id === id);
          const e = K.h('div', 'rxa-tile', K.esc(t.ch) + '<sub>' + t.value + '</sub>');
          e.style.setProperty('--tile', tile + 'px');
          e.onclick = () => { if (!done) unplace(k); };      // tap a placed tile to send it back
          slots[k].appendChild(e);
          tileEls[id].classList.add('used');
          tileEls[id].style.display = 'none';
          if (placed.every(Boolean)) check();
        }
        function unplace(k) {
          const id = placed[k];
          if (!id) return;
          placed[k] = null;
          const e = slots[k].querySelector('.rxa-tile'); if (e) e.remove();
          tileEls[id].classList.remove('used'); tileEls[id].style.display = '';
          K.sfx.tap();
        }
        function check() {
          const guess = placed.map((id) => w.tiles.find((x) => x.id === id).ch).join('');
          if (guess === w.word) win();
          else {
            stage.bad(slotsEl);
            after.innerHTML = '';
            after.appendChild(stage.explain('no', 'Not this word. Tap tiles to move them back, or use a hint.', ''));
          }
        }
        function win() {
          done = true;
          const secs = (Date.now() - t0) / 1000;
          const pts = A.wordLabPoints(w, secs, hints);
          points += pts;
          if (!hints) solvedClean++;
          results[i] = true;
          slots.forEach((s, k) => { const e = s.querySelector('.rxa-tile'); if (e) { e.classList.add('gold'); e.style.animationDelay = (k * 0.06) + 's'; } });
          stage.good(slotsEl, pts);
          stage.confetti(60);
          learned.push(w.word.charAt(0) + w.word.slice(1).toLowerCase() + ': ' + w.note);
          next('ok', 'Correct: ' + w.word + '  (+' + pts + ')');
        }
        function next(kind, head) {
          stage.body.querySelectorAll('[data-a]').forEach((b) => { b.disabled = true; });
          after.innerHTML = '';
          after.appendChild(stage.explain(kind, head, w.note));
          const go = K.h('button', 'rxa-btn', i + 1 < WORDS_PER_GAME ? 'Next word →' : 'See results');
          go.style.cssText = 'margin-top:12px;width:100%';
          go.onclick = () => { i++; if (i < WORDS_PER_GAME) show(); else end(); };
          after.appendChild(go);
          setTimeout(() => go.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
        }
        stage.body.querySelector('[data-a="shuffle"]').onclick = () => {
          const free = Array.from(rack.children);
          for (let a = free.length - 1; a > 0; a--) { const b = Math.floor(Math.random() * (a + 1)); rack.insertBefore(free[a], free[b]); }
          K.sfx.tap();
        };
        stage.body.querySelector('[data-a="hint"]').onclick = () => {
          if (done) return;
          // the first square that is empty or wrong gets its right letter
          const k = placed.findIndex((id, idx) => !id || w.tiles.find((x) => x.id === id).ch !== w.word[idx]);
          if (k < 0) return;
          if (placed[k]) unplace(k);
          const used = new Set(placed.filter(Boolean));
          const t = w.tiles.find((x) => x.ch === w.word[k] && !used.has(x.id) && tileEls[x.id].style.display !== 'none') ||
            w.tiles.find((x) => x.ch === w.word[k] && !used.has(x.id));
          if (!t) return;
          // a tile placed elsewhere that this hint needs is freed first
          const at = placed.indexOf(t.id); if (at >= 0) unplace(at);
          hints++;
          place(t.id, k);
        };
        stage.body.querySelector('[data-a="skip"]').onclick = () => {
          if (done) return;
          done = true; results[i] = false;
          stage.bad();
          learned.push(w.word.charAt(0) + w.word.slice(1).toLowerCase() + ': ' + w.note);
          next('info', 'The word was ' + w.word);
        };
      }

      function end() {
        const solved = results.filter(Boolean).length;
        stage.finish({
          title: solved >= 6 ? 'Word wizard!' : solved >= 3 ? 'Nice work!' : 'Keep practising!',
          big: points, sub: solved + ' of ' + WORDS_PER_GAME + ' words · ' + solvedClean + ' without hints',
          xp: A.xp.wordlab(points), trophy: solved >= 6 ? '🏆' : '⭐',
          lines: learned.slice(-3),
        });
      }
      show();
    },
  };
})();
