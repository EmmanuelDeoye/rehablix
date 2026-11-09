// js/space/arcade/chess-engine.js — Rehablix Space: Clinical Chess, the rules and the computer opponent.
// Pure (no DOM): full legal chess (castling, en passant, promotion, check, checkmate, stalemate, the 50-move rule,
// threefold repetition, insufficient material) on a 0x88 board, and an alpha-beta opponent at three levels.
// tests/arcade-chess.test.js checks the move generator with perft against the published counts.
(function () {
  'use strict';

  const FILES = 'abcdefgh';
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const KNIGHT = [-33, -31, -18, -14, 14, 18, 31, 33];
  const BISHOP = [-17, -15, 15, 17];
  const ROOK = [-16, -1, 1, 16];
  const KING = [-17, -16, -15, -1, 1, 15, 16, 17];
  const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

  // rows: 0 = rank 8 (top), 7 = rank 1; square = row * 16 + col
  const sqName = (sq) => FILES[sq & 7] + (8 - (sq >> 4));
  const sqIndex = (name) => (8 - Number(name[1])) * 16 + FILES.indexOf(name[0]);
  const colorOf = (p) => (p === p.toUpperCase() ? 'w' : 'b');
  const typeOf = (p) => p.toLowerCase();
  const onBoard = (sq) => (sq & 0x88) === 0;

  function Game(fen) {
    this.load(fen || START);
  }

  Game.prototype.load = function (fen) {
    const parts = String(fen).trim().split(/\s+/);
    this.board = new Array(128).fill(null);
    const rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('Bad FEN');
    for (let r = 0; r < 8; r++) {
      let c = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) c += Number(ch);
        else { this.board[r * 16 + c] = ch; c++; }
      }
    }
    this.turn = parts[1] || 'w';
    const cs = parts[2] || '-';
    this.castle = { K: cs.includes('K'), Q: cs.includes('Q'), k: cs.includes('k'), q: cs.includes('q') };
    this.ep = parts[3] && parts[3] !== '-' ? sqIndex(parts[3]) : -1;
    this.half = Number(parts[4] || 0);
    this.full = Number(parts[5] || 1);
    this.history = [];
    this.positions = [this.key()];
  };

  // The position without the move counters (for repetition).
  Game.prototype.key = function () {
    let s = '';
    for (let r = 0; r < 8; r++) {
      let empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = this.board[r * 16 + c];
        if (!p) { empty++; continue; }
        if (empty) { s += empty; empty = 0; }
        s += p;
      }
      if (empty) s += empty;
      if (r < 7) s += '/';
    }
    const cs = (this.castle.K ? 'K' : '') + (this.castle.Q ? 'Q' : '') + (this.castle.k ? 'k' : '') + (this.castle.q ? 'q' : '');
    return s + ' ' + this.turn + ' ' + (cs || '-') + ' ' + (this.ep >= 0 ? sqName(this.ep) : '-');
  };
  Game.prototype.fen = function () { return this.key() + ' ' + this.half + ' ' + this.full; };

  Game.prototype.kingSquare = function (color) {
    const k = color === 'w' ? 'K' : 'k';
    for (let sq = 0; sq < 128; sq++) if (onBoard(sq) && this.board[sq] === k) return sq;
    return -1;
  };

  // Is `sq` attacked by any piece of `by`?
  Game.prototype.attacked = function (sq, by) {
    const b = this.board;
    // pawns: a white pawn attacks up-left/up-right (−17, −15), so it sits at sq + 17 / sq + 15
    if (by === 'w') { for (const d of [15, 17]) { const s = sq + d; if (onBoard(s) && b[s] === 'P') return true; } }
    else { for (const d of [-15, -17]) { const s = sq + d; if (onBoard(s) && b[s] === 'p') return true; } }
    const n = by === 'w' ? 'N' : 'n', k = by === 'w' ? 'K' : 'k';
    for (const d of KNIGHT) { const s = sq + d; if (onBoard(s) && b[s] === n) return true; }
    for (const d of KING) { const s = sq + d; if (onBoard(s) && b[s] === k) return true; }
    const bq = by === 'w' ? ['B', 'Q'] : ['b', 'q'];
    for (const d of BISHOP) {
      let s = sq + d;
      while (onBoard(s)) { const p = b[s]; if (p) { if (p === bq[0] || p === bq[1]) return true; break; } s += d; }
    }
    const rq = by === 'w' ? ['R', 'Q'] : ['r', 'q'];
    for (const d of ROOK) {
      let s = sq + d;
      while (onBoard(s)) { const p = b[s]; if (p) { if (p === rq[0] || p === rq[1]) return true; break; } s += d; }
    }
    return false;
  };

  Game.prototype.inCheck = function (color) {
    color = color || this.turn;
    const k = this.kingSquare(color);
    return k >= 0 && this.attacked(k, color === 'w' ? 'b' : 'w');
  };

  // All moves that obey piece movement (the king may still be left in check).
  Game.prototype.pseudo = function () {
    const us = this.turn, them = us === 'w' ? 'b' : 'w', b = this.board, out = [];
    const add = (from, to, piece, flags, promo) => {
      const captured = flags === 'e' ? (us === 'w' ? 'p' : 'P') : b[to];
      out.push({ from, to, piece, captured: captured || null, flags, promotion: promo || null });
    };
    for (let from = 0; from < 128; from++) {
      if (!onBoard(from)) { from += 7; continue; }
      const p = b[from];
      if (!p || colorOf(p) !== us) continue;
      const t = typeOf(p);
      if (t === 'p') {
        const dir = us === 'w' ? -16 : 16, startRow = us === 'w' ? 6 : 1, promoRow = us === 'w' ? 0 : 7;
        const one = from + dir;
        const pushPromo = (to, flags) => {
          if ((to >> 4) === promoRow) for (const q of ['q', 'r', 'b', 'n']) add(from, to, p, flags + 'p', us === 'w' ? q.toUpperCase() : q);
          else add(from, to, p, flags);
        };
        if (onBoard(one) && !b[one]) {
          pushPromo(one, 'n');
          const two = one + dir;
          if ((from >> 4) === startRow && !b[two]) add(from, two, p, 'b');
        }
        for (const d of us === 'w' ? [-17, -15] : [15, 17]) {
          const to = from + d;
          if (!onBoard(to)) continue;
          if (b[to] && colorOf(b[to]) === them) pushPromo(to, 'c');
          else if (to === this.ep) add(from, to, p, 'e');
        }
      } else if (t === 'n' || t === 'k') {
        for (const d of t === 'n' ? KNIGHT : KING) {
          const to = from + d;
          if (!onBoard(to)) continue;
          if (!b[to]) add(from, to, p, 'n');
          else if (colorOf(b[to]) === them) add(from, to, p, 'c');
        }
        if (t === 'k') {
          // castling: rights, empty squares between, not in check, not crossing an attacked square
          const home = us === 'w' ? 116 : 4;
          if (from === home && !this.attacked(home, them)) {
            const ks = us === 'w' ? this.castle.K : this.castle.k, qs = us === 'w' ? this.castle.Q : this.castle.q;
            const rook = us === 'w' ? 'R' : 'r';
            if (ks && !b[home + 1] && !b[home + 2] && b[home + 3] === rook && !this.attacked(home + 1, them)) add(from, home + 2, p, 'k');
            if (qs && !b[home - 1] && !b[home - 2] && !b[home - 3] && b[home - 4] === rook && !this.attacked(home - 1, them)) add(from, home - 2, p, 'q');
          }
        }
      } else {
        const dirs = t === 'b' ? BISHOP : t === 'r' ? ROOK : KING;
        for (const d of dirs) {
          let to = from + d;
          while (onBoard(to)) {
            if (!b[to]) add(from, to, p, 'n');
            else { if (colorOf(b[to]) === them) add(from, to, p, 'c'); break; }
            to += d;
          }
        }
      }
    }
    return out;
  };

  // Plays a move (from pseudo or moves) and records how to take it back.
  Game.prototype.make = function (m) {
    const b = this.board, us = this.turn;
    this.history.push({ m, castle: { ...this.castle }, ep: this.ep, half: this.half, full: this.full });
    b[m.to] = m.promotion || m.piece;
    b[m.from] = null;
    if (m.flags === 'e') b[us === 'w' ? m.to + 16 : m.to - 16] = null;
    if (m.flags === 'k') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = null; }
    if (m.flags === 'q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = null; }
    // castling rights: a king move loses both; a rook leaving or being taken on its corner loses that side
    if (typeOf(m.piece) === 'k') { if (us === 'w') { this.castle.K = this.castle.Q = false; } else { this.castle.k = this.castle.q = false; } }
    const corner = { 119: 'K', 112: 'Q', 7: 'k', 0: 'q' };
    if (corner[m.from]) this.castle[corner[m.from]] = false;
    if (corner[m.to]) this.castle[corner[m.to]] = false;
    this.ep = m.flags === 'b' ? (m.from + m.to) / 2 : -1;
    this.half = typeOf(m.piece) === 'p' || m.captured ? 0 : this.half + 1;
    if (us === 'b') this.full++;
    this.turn = us === 'w' ? 'b' : 'w';
    this.positions.push(this.key());
  };

  Game.prototype.unmake = function () {
    const h = this.history.pop();
    if (!h) return null;
    const m = h.m, b = this.board;
    this.positions.pop();
    this.turn = this.turn === 'w' ? 'b' : 'w';
    const us = this.turn;
    b[m.from] = m.piece;
    b[m.to] = m.flags === 'e' ? null : m.captured;
    if (m.flags === 'e') b[us === 'w' ? m.to + 16 : m.to - 16] = m.captured;
    if (m.flags === 'k') { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = null; }
    if (m.flags === 'q') { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = null; }
    this.castle = h.castle; this.ep = h.ep; this.half = h.half; this.full = h.full;
    return m;
  };

  // Legal moves (the king is never left in check). Each move also gets readable squares and SAN.
  Game.prototype.moves = function () {
    const us = this.turn, out = [];
    for (const m of this.pseudo()) {
      this.make(m);
      if (!this.inCheck(us)) out.push(m);
      this.unmake();
    }
    return out;
  };

  Game.prototype.san = function (m, legal) {
    legal = legal || this.moves();
    const t = typeOf(m.piece);
    let s;
    if (m.flags === 'k') s = 'O-O';
    else if (m.flags === 'q') s = 'O-O-O';
    else {
      const capture = !!m.captured;
      if (t === 'p') s = (capture ? FILES[m.from & 7] + 'x' : '') + sqName(m.to);
      else {
        s = t.toUpperCase();
        const twins = legal.filter((o) => o !== m && o.piece === m.piece && o.to === m.to && o.from !== m.from);
        if (twins.length) {
          const sameFile = twins.some((o) => (o.from & 7) === (m.from & 7)), sameRank = twins.some((o) => (o.from >> 4) === (m.from >> 4));
          s += !sameFile ? FILES[m.from & 7] : !sameRank ? String(8 - (m.from >> 4)) : sqName(m.from);
        }
        s += (capture ? 'x' : '') + sqName(m.to);
      }
      if (m.promotion) s += '=' + m.promotion.toUpperCase();
    }
    this.make(m);
    const reply = this.moves();
    if (this.inCheck()) s += reply.length ? '+' : '#';
    this.unmake();
    return s;
  };

  // Finds a legal move by squares ('e2', 'e4', promotion 'q'): the move object, or null.
  Game.prototype.find = function (from, to, promotion) {
    const f = typeof from === 'string' ? sqIndex(from) : from, t = typeof to === 'string' ? sqIndex(to) : to;
    const list = this.moves().filter((m) => m.from === f && m.to === t);
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    const want = (promotion || 'q').toLowerCase();
    return list.find((m) => m.promotion && m.promotion.toLowerCase() === want) || list[0];
  };

  Game.prototype.insufficient = function () {
    const minor = [];
    for (let sq = 0; sq < 128; sq++) {
      if (!onBoard(sq)) continue;
      const p = this.board[sq];
      if (!p) continue;
      const t = typeOf(p);
      if (t === 'k') continue;
      if (t === 'n' || t === 'b') { minor.push({ t, sqColor: ((sq >> 4) + (sq & 7)) % 2 }); continue; }
      return false;
    }
    if (minor.length <= 1) return true;
    // only bishops, all on the same colour of square
    return minor.every((x) => x.t === 'b') && minor.every((x) => x.sqColor === minor[0].sqColor);
  };

  Game.prototype.repetition = function () {
    const k = this.positions[this.positions.length - 1];
    return this.positions.filter((x) => x === k).length >= 3;
  };

  // { over, result: 'checkmate' | 'stalemate' | 'fifty' | 'repetition' | 'material', winner: 'w' | 'b' | null }
  Game.prototype.status = function () {
    const legal = this.moves();
    if (!legal.length) return this.inCheck() ? { over: true, result: 'checkmate', winner: this.turn === 'w' ? 'b' : 'w' } : { over: true, result: 'stalemate', winner: null };
    if (this.insufficient()) return { over: true, result: 'material', winner: null };
    if (this.half >= 100) return { over: true, result: 'fifty', winner: null };
    if (this.repetition()) return { over: true, result: 'repetition', winner: null };
    return { over: false, result: null, winner: null, check: this.inCheck() };
  };

  // 8×8 view for drawing: rows from rank 8 down, each square { piece, square } (piece null when empty).
  Game.prototype.grid = function () {
    const rows = [];
    for (let r = 0; r < 8; r++) {
      const row = [];
      for (let c = 0; c < 8; c++) row.push({ square: sqName(r * 16 + c), piece: this.board[r * 16 + c] });
      rows.push(row);
    }
    return rows;
  };

  Game.prototype.perft = function (depth) {
    if (depth === 0) return 1;
    let n = 0;
    const us = this.turn;
    for (const m of this.pseudo()) {
      this.make(m);
      if (!this.inCheck(us)) n += depth === 1 ? 1 : this.perft(depth - 1);
      this.unmake();
    }
    return n;
  };

  // ------------------------------------------------------------------ the computer opponent
  // Piece-square tables (white's view, row 0 = rank 8): encourage development, centre, king safety, pawn advance.
  const PST = {
    p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
      0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
    n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
      -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
    b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
      -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
    r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
      -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
    q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
      0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
    k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
      -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
  };

  // Score for the side to move (centipawns).
  Game.prototype.evaluate = function () {
    let s = 0;
    for (let sq = 0; sq < 128; sq++) {
      if (!onBoard(sq)) { sq += 7; continue; }
      const p = this.board[sq];
      if (!p) continue;
      const t = typeOf(p), white = p === p.toUpperCase();
      const r = sq >> 4, c = sq & 7;
      const idx = white ? r * 8 + c : (7 - r) * 8 + c;
      const v = VALUE[t] + PST[t][idx];
      s += white ? v : -v;
    }
    return this.turn === 'w' ? s : -s;
  };

  const order = (list) => list.sort((a, b) => score(b) - score(a));
  const score = (m) => (m.captured ? 10 * VALUE[typeOf(m.captured)] - VALUE[typeOf(m.piece)] : 0) + (m.promotion ? 800 : 0);

  function search(g, depth, alpha, beta, ctx, ply) {
    if (Date.now() > ctx.deadline) { ctx.timeUp = true; return 0; }
    if (depth <= 0) return quiesce(g, alpha, beta, ctx, 0);
    const us = g.turn;
    let any = false;
    for (const m of order(g.pseudo())) {
      g.make(m);
      if (g.inCheck(us)) { g.unmake(); continue; }
      any = true;
      const v = g.half >= 100 || g.repetition() ? 0 : -search(g, depth - 1, -beta, -alpha, ctx, ply + 1);
      g.unmake();
      if (ctx.timeUp) return 0;
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    if (!any) return g.inCheck() ? -100000 + ply : 0;
    return alpha;
  }

  function quiesce(g, alpha, beta, ctx, qply) {
    const stand = g.evaluate();
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (qply >= 4) return alpha;
    const us = g.turn;
    for (const m of order(g.pseudo().filter((x) => x.captured || x.promotion))) {
      g.make(m);
      if (g.inCheck(us)) { g.unmake(); continue; }
      const v = -quiesce(g, -beta, -alpha, ctx, qply + 1);
      g.unmake();
      if (v >= beta) return beta;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  const LEVELS = {
    easy: { depth: 1, noise: 90, blunder: 0.22, ms: 400 },
    normal: { depth: 2, noise: 20, blunder: 0, ms: 1200 },
    hard: { depth: 3, noise: 0, blunder: 0, ms: 2200 },
  };

  // The computer's move for the side to move (iterative deepening within the level's time; never returns an illegal move).
  Game.prototype.bestMove = function (level, rand) {
    const L = LEVELS[level] || LEVELS.normal;
    rand = rand || Math.random;
    const legal = this.moves();
    if (!legal.length) return null;
    if (L.blunder && rand() < L.blunder) return legal[Math.floor(rand() * legal.length)];
    const ctx = { deadline: Date.now() + L.ms, timeUp: false };
    let best = order(legal.slice())[0];
    for (let d = 1; d <= L.depth; d++) {
      let alpha = -Infinity, choice = null;
      const scored = [];
      for (const m of order(legal.slice())) {
        this.make(m);
        // (with noise every move gets its exact score, a full window: a pruned move's score is only a bound, and noise
        // added to a bound could pick a much worse move than intended)
        const upper = L.noise ? Infinity : -alpha;
        let v = this.half >= 100 || this.repetition() ? 0 : -search(this, d - 1, -Infinity, upper, ctx, 1);
        this.unmake();
        if (ctx.timeUp) break;
        if (L.noise) v += (rand() - 0.5) * L.noise;
        scored.push({ m, v });
        if (v > alpha) { alpha = v; choice = m; }
      }
      if (ctx.timeUp) break;
      if (choice) best = choice;
    }
    return best;
  };

  const API = { Game, START, sqName, sqIndex, VALUE, LEVELS };
  if (typeof window !== 'undefined') window.RxChess = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
