// js/space/arcade/game-quiz.js — the quiz arenas: Muscle Rush (60 seconds, streak bonuses) and Special Test Showdown
// (10 scenarios). The same questions and scoring as before (space-core.js), in a 3D arena: question cards flip in,
// answers are colourful 3D pads, a streak flame grows, and every answer shows a short teaching note.
(function () {
  'use strict';
  const K = window.RxArcade, A = window.RxArcadeContent, S = window.RehablixSpace;
  const PAD_COLORS = ['#3b82f6', '#a855f7', '#f97316', '#14b8a6'];

  function arena(stage, opts) {
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    const r = S.rng(seed);
    const results = [];
    let n = 0, correct = 0, streak = 0, best = 0, score = 0, timer = null, timeLeft = opts.seconds || 0, over = false;
    const learned = [];
    const nextQ = () => opts.question(r, n);

    stage.body.innerHTML = (opts.seconds ? '<div class="rxa-timer"><i></i></div>' : '') + '<div class="rxa-top"></div><div class="rxa-arena"></div><div class="rxa-after"></div>';
    const top = stage.body.querySelector('.rxa-top'), ar = stage.body.querySelector('.rxa-arena'), after = stage.body.querySelector('.rxa-after');
    const bar = stage.body.querySelector('.rxa-timer i');

    if (opts.seconds) {
      timer = setInterval(() => {
        timeLeft -= 0.25;
        if (bar) bar.style.transform = 'scaleX(' + Math.max(0, timeLeft / opts.seconds) + ')';
        if (timeLeft <= 0) { clearInterval(timer); timer = null; finish(); }
      }, 250);
      stage.onCleanup(() => { if (timer) clearInterval(timer); });
    }

    function head() {
      top.innerHTML = opts.seconds
        ? '<div class="rxa-chess-info"><span>✅ ' + correct + ' right</span><span>' + (streak >= 2 ? '<span class="rxa-flame">🔥 ' + streak + ' streak</span>' : '') + '</span></div>'
        : stage.dots(opts.count, n, results);
    }
    function show() {
      if (over) return;
      head();
      const q = nextQ();
      const card = K.h('div', 'rxa-qcard rxa-glass', '<div class="q">' + K.esc(q.prompt) + '</div>');
      const pads = K.h('div', 'rxa-pads');
      q.options.forEach((o, k) => {
        const b = K.h('button', 'rxa-pad', K.esc(o));
        b.style.setProperty('--c', PAD_COLORS[k % 4]);
        b.onclick = () => answer(q, k, b, pads);
        pads.appendChild(b);
      });
      ar.innerHTML = '';
      ar.append(card, pads);
      after.innerHTML = '';
    }
    function answer(q, k, b, pads) {
      if (over) return;
      const ok = k === q.answer;
      pads.querySelectorAll('button').forEach((x, i) => { x.disabled = true; if (i === q.answer) x.classList.add('right'); else if (x !== b) x.classList.add('dim'); });
      const note = A.noteFor(q);
      if (ok) {
        const pts = opts.points(streak);
        correct++; streak++; best = Math.max(best, streak); score += pts;
        stage.good(b, pts);
        results[n] = true;
      } else {
        b.classList.add('wrong');
        streak = 0;
        stage.bad(b);
        results[n] = false;
        if (note && learned.length < 6 && !learned.includes(note)) learned.push(note);
      }
      n++;
      if (opts.seconds) {
        // timed: a quick flash of the note, then straight on
        after.innerHTML = '';
        if (!ok) after.appendChild(stage.explain('no', 'Answer: ' + q.options[q.answer], note));
        setTimeout(show, ok ? 450 : 1600);
      } else {
        after.innerHTML = '';
        after.appendChild(stage.explain(ok ? 'ok' : 'no', ok ? 'Correct!' : 'Answer: ' + q.options[q.answer], note));
        const go = K.h('button', 'rxa-btn', n < opts.count ? 'Next →' : 'See results');
        go.style.cssText = 'margin-top:12px;width:100%';
        go.onclick = () => { if (n < opts.count) show(); else finish(); };
        after.appendChild(go);
        setTimeout(() => go.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
      }
    }
    function finish() {
      if (over) return;
      over = true;
      if (timer) { clearInterval(timer); timer = null; }
      stage.finish(opts.result({ score, correct, answered: n, best, learned }));
    }
    show();
  }

  K.games.rush = {
    title: 'Muscle Rush', emoji: '💪', color: '#f97316', color2: '#ef4444',
    start(stage) {
      arena(stage, {
        seconds: S.RUSH_SECONDS,
        question: (r) => S.muscleQuestion(r),
        points: (streak) => S.rushPoints(streak),
        result: (x) => ({
          title: x.score >= 300 ? 'On fire!' : x.score >= 150 ? 'Strong run!' : 'Warm-up done!',
          big: x.score, sub: x.correct + ' right of ' + x.answered + ' · best streak ' + x.best,
          xp: S.xp.rush(x.score), trophy: x.best >= 5 ? '🔥' : '💪', lines: x.learned.slice(0, 3),
        }),
      });
    },
  };

  K.games.tests = {
    title: 'Special Test Showdown', emoji: '🩺', color: '#10b981', color2: '#0ea5e9',
    start(stage) {
      let set = null;
      arena(stage, {
        count: 10,
        question: (r, n) => { set = set || S.questionSet('tests', 10, Math.floor(r() * 1e9)); return set[n]; },
        points: () => 10,
        result: (x) => ({
          title: x.correct >= 9 ? 'Test master!' : x.correct >= 6 ? 'Sharp skills!' : 'Keep practising!',
          big: x.correct + '/10', sub: 'tests right',
          xp: S.xp.tests(x.correct), trophy: x.correct >= 9 ? '🏆' : '🩺', lines: x.learned.slice(0, 3),
        }),
      });
    },
  };
})();
