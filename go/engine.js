// Go (Baduk) Engine
// Board: 19x19 grid of intersections
// 0 = empty, 1 = black, 2 = white

export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export const BOARD_SIZE = 19;
export const KOMI = 6.5; // White's compensation for going second

// ─── Core board helpers ───────────────────────────────────────────────────────

export function makeBoard() {
  return new Uint8Array(BOARD_SIZE * BOARD_SIZE);
}

export function idx(x, y) {
  return y * BOARD_SIZE + x;
}

export function coord(i) {
  return { x: i % BOARD_SIZE, y: Math.floor(i / BOARD_SIZE) };
}

export function inBounds(x, y) {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
}

export function neighbors(x, y) {
  const ns = [];
  if (x > 0)               ns.push(idx(x - 1, y));
  if (x < BOARD_SIZE - 1)  ns.push(idx(x + 1, y));
  if (y > 0)               ns.push(idx(x, y - 1));
  if (y < BOARD_SIZE - 1)  ns.push(idx(x, y + 1));
  return ns;
}

// Flood-fill: returns { stones: Set<idx>, liberties: Set<idx> }
export function getGroup(board, startIdx) {
  const color = board[startIdx];
  const stones = new Set();
  const liberties = new Set();
  const queue = [startIdx];
  stones.add(startIdx);

  while (queue.length > 0) {
    const cur = queue.pop();
    const { x, y } = coord(cur);
    for (const n of neighbors(x, y)) {
      if (board[n] === EMPTY) {
        liberties.add(n);
      } else if (board[n] === color && !stones.has(n)) {
        stones.add(n);
        queue.push(n);
      }
    }
  }
  return { stones, liberties };
}

// ─── Move validation ──────────────────────────────────────────────────────────

// Returns { ok, captures } or { ok: false, reason }
export function tryMove(board, x, y, color, koPoint) {
  if (!inBounds(x, y)) return { ok: false, reason: 'out of bounds' };
  const i = idx(x, y);
  if (board[i] !== EMPTY) return { ok: false, reason: 'occupied' };
  if (koPoint !== null && i === koPoint) return { ok: false, reason: 'ko' };

  const opponent = color === BLACK ? WHITE : BLACK;
  const newBoard = board.slice();
  newBoard[i] = color;

  // Capture opponent groups with no liberties
  const captured = new Set();
  const { x: xi, y: yi } = coord(i);
  for (const n of neighbors(xi, yi)) {
    if (newBoard[n] === opponent) {
      const g = getGroup(newBoard, n);
      if (g.liberties.size === 0) {
        for (const s of g.stones) captured.add(s);
      }
    }
  }
  for (const s of captured) newBoard[s] = EMPTY;

  // Suicide check: placed stone's group must have liberties
  const myGroup = getGroup(newBoard, i);
  if (myGroup.liberties.size === 0) return { ok: false, reason: 'suicide' };

  // Ko: if exactly one stone captured and board reverts to previous position,
  // the ko point is that captured intersection.
  let newKoPoint = null;
  if (captured.size === 1) {
    const [capturedIdx] = captured;
    // Simple ko: the captured point becomes the ko restriction for next move
    newKoPoint = capturedIdx;
  }

  return { ok: true, newBoard, captured, newKoPoint };
}

// ─── Scoring (Area scoring / Tromp-Taylor) ────────────────────────────────────

export function score(board) {
  const visited = new Uint8Array(board.length);
  let black = 0, white = 0;

  for (let i = 0; i < board.length; i++) {
    if (board[i] === BLACK) { black++; continue; }
    if (board[i] === WHITE) { white++; continue; }
    if (visited[i]) continue;

    // Flood fill empty region
    const region = [];
    const queue = [i];
    visited[i] = 1;
    let touchesBlack = false, touchesWhite = false;

    while (queue.length > 0) {
      const cur = queue.pop();
      region.push(cur);
      const { x, y } = coord(cur);
      for (const n of neighbors(x, y)) {
        if (board[n] === BLACK) touchesBlack = true;
        else if (board[n] === WHITE) touchesWhite = true;
        else if (!visited[n]) {
          visited[n] = 1;
          queue.push(n);
        }
      }
    }

    if (touchesBlack && !touchesWhite) black += region.length;
    else if (touchesWhite && !touchesBlack) white += region.length;
    // Dame (neutral) — not counted
  }

  return { black, white, blackFinal: black, whiteFinal: white + KOMI };
}

// ─── Life / dominance detection ─────────────────────────────────────────────

// Returns true if the empty intersection `i` is a true eye for `color`:
// all 4 (or 3 at edge, 2 at corner) orthogonal neighbors are `color`,
// AND at most 1 diagonal is not `color` (classic eye definition).
export function isTrueEye(board, i, color) {
  const { x, y } = coord(i);
  if (board[i] !== EMPTY) return false;

  // All orthogonal neighbors must be the same color
  for (const n of neighbors(x, y)) {
    if (board[n] !== color) return false;
  }

  // Diagonal check: count bad diagonals (empty or opponent)
  const diags = [];
  if (x > 0 && y > 0)                          diags.push(idx(x-1, y-1));
  if (x < BOARD_SIZE-1 && y > 0)               diags.push(idx(x+1, y-1));
  if (x > 0 && y < BOARD_SIZE-1)               diags.push(idx(x-1, y+1));
  if (x < BOARD_SIZE-1 && y < BOARD_SIZE-1)    diags.push(idx(x+1, y+1));

  // At corner (2 diags) — 0 bad allowed; at edge (3 diags) — ≤1 bad; center (4 diags) — ≤1 bad
  const maxBad = diags.length <= 2 ? 0 : 1;
  let bad = 0;
  for (const d of diags) {
    if (board[d] !== color) bad++;
  }
  return bad <= maxBad;
}

// Returns the number of true eyes in a group identified by its stone set.
function countEyesForGroup(board, stones, color) {
  const checked = new Set();
  let eyes = 0;
  for (const s of stones) {
    const { x, y } = coord(s);
    for (const n of neighbors(x, y)) {
      if (!checked.has(n) && board[n] === EMPTY && isTrueEye(board, n, color)) {
        eyes++;
      }
      checked.add(n);
    }
  }
  return eyes;
}

// Returns the count of stones belonging to groups that have ≥ 2 true eyes (alive).
export function countAliveStones(board, color) {
  const visited = new Set();
  let alive = 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== color || visited.has(i)) continue;
    const { stones } = getGroup(board, i);
    for (const s of stones) visited.add(s);
    if (countEyesForGroup(board, stones, color) >= 2) {
      alive += stones.size;
    }
  }
  return alive;
}

// Check dominance: one player's alive stones + their captured-stone lead > half the board.
// Returns the winning color, or null if no dominance.
export function checkDominance(board, captures) {
  const total = BOARD_SIZE * BOARD_SIZE;
  const half = total / 2;

  for (const color of [BLACK, WHITE]) {
    const opponent = color === BLACK ? WHITE : BLACK;
    const aliveCount = countAliveStones(board, color);
    // Net captured advantage: stones captured by this color minus stones it lost
    const captureAdvantage = captures[color] - captures[opponent];
    const effective = aliveCount + Math.max(0, captureAdvantage);
    if (effective > half) return color;
  }
  return null;
}

// ─── Game state ───────────────────────────────────────────────────────────────

export class GoGame {
  constructor() {
    this.reset();
  }

  reset() {
    this.board = makeBoard();
    this.turn = BLACK;          // Black goes first
    this.captures = { [BLACK]: 0, [WHITE]: 0 };
    this.koPoint = null;        // Forbidden intersection this turn (ko rule)
    this.passCount = 0;         // Two consecutive passes → game over
    this.history = [];          // Array of board snapshots (Uint8Array) for superko
    this.lastMove = null;       // { x, y } | 'pass' | null
    this.gameOver = false;
    this.result = null;         // { winner, blackScore, whiteScore, reason }
  }

  // Returns true if move was played, false if invalid
  playMove(x, y) {
    if (this.gameOver) return false;
    const result = tryMove(this.board, x, y, this.turn, this.koPoint);
    if (!result.ok) return false;

    // Superko: reject if resulting board was seen before
    const hash = result.newBoard.join(',');
    if (this.history.some(h => h === hash)) return false;

    this.history.push(hash);
    if (this.history.length > 8) this.history.shift(); // keep last 8 for memory

    this.board = result.newBoard;
    this.captures[this.turn] += result.captured.size;
    this.koPoint = result.newKoPoint;
    this.lastMove = { x, y };
    this.passCount = 0;
    this.turn = this.turn === BLACK ? WHITE : BLACK;

    // Dominance end condition
    const dominant = checkDominance(this.board, this.captures);
    if (dominant !== null) {
      this._endGameByDominance(dominant);
    }

    return true;
  }

  pass() {
    if (this.gameOver) return;
    this.passCount++;
    this.koPoint = null;
    this.lastMove = 'pass';
    if (this.passCount >= 2) {
      this._endGame('double-pass');
      return;
    }
    this.turn = this.turn === BLACK ? WHITE : BLACK;

    // Dominance end condition
    const dominant = checkDominance(this.board, this.captures);
    if (dominant !== null) {
      this._endGameByDominance(dominant);
    }
  }

  resign(color) {
    if (this.gameOver) return;
    const winner = color === BLACK ? WHITE : BLACK;
    this.gameOver = true;
    this.result = { winner, reason: 'resign', blackScore: null, whiteScore: null };
  }

  _endGame(reason) {
    this.gameOver = true;
    const s = score(this.board);
    const winner = s.blackFinal > s.whiteFinal ? BLACK : WHITE;
    this.result = {
      winner,
      reason,
      blackScore: s.blackFinal,
      whiteScore: s.whiteFinal,
    };
  }

  _endGameByDominance(winner) {
    this.gameOver = true;
    const aliveB = countAliveStones(this.board, BLACK);
    const aliveW = countAliveStones(this.board, WHITE);
    this.result = {
      winner,
      reason: 'dominance',
      blackScore: aliveB + this.captures[BLACK],
      whiteScore: aliveW + this.captures[WHITE],
    };
  }

  // Returns all valid move positions for a color
  validMoves(color) {
    const moves = [];
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        if (tryMove(this.board, x, y, color, this.koPoint).ok) {
          moves.push({ x, y });
        }
      }
    }
    return moves;
  }
}
