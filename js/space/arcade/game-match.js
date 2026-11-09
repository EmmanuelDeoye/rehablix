// js/space/arcade/game-match.js — Muscle Match: drag each muscle card into the nerve that supplies it (or tap the card,
// then the nerve). Four rounds of three nerves; a wrong drop bounces back with the right answer and its teaching note.
(function () {
  'use strict';
  const K = window.RxArcade, A = window.RxArcadeContent;
  const ROUNDS = 4;
  const BIN_COLORS = ['#38bdf8', '#a78bfa', '#f472b6'];

  K.games.match = {
    title: 'Muscle Match', emoji: '🧲', color: '#ec4899', color2: '#8b5cf6',
    start(stage) {
      const rounds = A.muscleMatchRound((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0, ROUNDS);
      const results = [];
      let r = 0, correct = 0, firstTry = 0;
      const missed = [];

      function show() {
        const round = rounds[r];
        let selected = null, left = round.cards.length;
        const tried = new Set();
        stage.body.innerHTML = stage.dots(ROUNDS, r, results) +
          '<div class="rxa-muted" style="text-align:center;margin-bottom:8px">Drag each muscle into the nerve that supplies it</div>' +
          '<div class="rxa-deck"></div><div class="rxa-bins"></div><div class="rxa-after"></div>';
        const deck = stage.body.querySelector('.rxa-deck'), binsEl = stage.body.querySelector('.rxa-bins'), after = stage.body.querySelector('.rxa-after');
        const bins = round.bins.map((b, k) => {
          const e = K.h('div', 'rxa-bin', '<b>' + K.esc(b.label) + '</b><div class="n">0</div>');
          e.style.setProperty('--c', BIN_COLORS[k]);
          e.dataset.bin = b.id;
          e.onclick = () => { if (selected) drop(selected, e); };
          binsEl.appendChild(e);
          return e;
        });
        round.cards.forEach((c, k) => {
          const e = K.h('div', 'rxa-card', K.esc(c.name));
          e.style.animationDelay = (k * 0.06) + 's';
          K.draggable(e, {
            targets: () => bins,
            onDrop: (bin) => drop(c, bin, e),
            onTap: () => { deck.querySelectorAll('.rxa-card').forEach((x) => x.classList.remove('selected')); selected = c; selected.el = e; e.classList.add('selected'); K.sfx.tap(); },
          });
          c.el = e;
          deck.appendChild(e);
        });

        function drop(c, bin, el) {
          el = el || c.el;
          if (bin.dataset.bin === c.bin) {
            correct++;
            if (!tried.has(c.id)) firstTry++;
            el.classList.add('gone');
            setTimeout(() => el.remove(), 260);
            const n = bin.querySelector('.n'); n.textContent = String(Number(n.textContent) + 1);
            bin.classList.remove('yes'); void bin.offsetWidth; bin.classList.add('yes');
            stage.good(bin, tried.has(c.id) ? 5 : 10);
            selected = null;
            after.innerHTML = '';
            if (--left === 0) roundDone();
            return true;
          }
          tried.add(c.id);
          stage.bad(el);
          if (missed.length < 12 && !missed.includes(c.note)) missed.push(c.note);
          after.innerHTML = '';
          after.appendChild(stage.explain('no', c.name + ' is not supplied by the ' + bin.querySelector('b').textContent.toLowerCase() + '.', 'Try again. Hint: ' + c.note.split('.').slice(1).join('.').trim()));
          el.classList.remove('selected'); selected = null;
          return false;
        }
        function roundDone() {
          results[r] = true;
          stage.confetti(50);
          after.innerHTML = '';
          after.appendChild(stage.explain('ok', 'Round ' + (r + 1) + ' complete!', round.bins.map((b) => b.label + ': ' + round.cards.filter((c) => c.bin === b.id).map((c) => c.name).join(', ')).join(' · ')));
          const go = K.h('button', 'rxa-btn', r + 1 < ROUNDS ? 'Next round →' : 'See results');
          go.style.cssText = 'margin-top:12px;width:100%';
          go.onclick = () => { r++; if (r < ROUNDS) show(); else end(); };
          after.appendChild(go);
          setTimeout(() => go.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
        }
      }
      function end() {
        const total = rounds.reduce((s, x) => s + x.cards.length, 0);
        stage.finish({
          title: firstTry === total ? 'Perfect match!' : firstTry >= total * 0.7 ? 'Great matching!' : 'Good effort!',
          big: firstTry + '/' + total, sub: 'right first time',
          xp: A.xp.match(correct, firstTry), trophy: firstTry === total ? '🏆' : '🧲',
          lines: missed.slice(0, 3),
        });
      }
      show();
    },
  };
})();
