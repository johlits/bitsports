import { tryMove, getGroup, neighbors, idx, coord, score, EMPTY, BLACK, WHITE, BOARD_SIZE, KOMI } from "../engine.js";

export const id = "claude-sonnet-4-6";
export const name = "Claude Sonnet 4.6";

// ─── Constants ────────────────────────────────────────────────────────────────
const MCTS_BUDGET_MS   = 280;   // thinking time per move (ms)
const UCB_C            = 1.4;   // UCB1 exploration constant
const ROLLOUT_DEPTH    = 60;    // max moves per simulation
const PASS_THRESHOLD   = 0.15;  // pass if best win-rate below this

// Star points and 3-4 approach points — high-value opening intersections
const STAR_POINTS = new Set([
  idx(3,3),idx(9,3),idx(15,3),
  idx(3,9),idx(9,9),idx(15,9),
  idx(3,15),idx(9,15),idx(15,15),
]);

// ─── Fast board clone ─────────────────────────────────────────────────────────
function cloneBoard(b) { return b.slice(); }

// ─── Heuristic move weight for rollout policy ─────────────────────────────────
// Returns a weight > 0 for each candidate; higher = more likely to be sampled.
function moveWeight(board, x, y, color, koPoint) {
  const opponent = color === BLACK ? WHITE : BLACK;
  const i = idx(x, y);
  let w = 1.0;

  // Simulate the move
  const nb = cloneBoard(board);
  nb[i] = color;

  // Check captures
  let caps = 0;
  for (const n of neighbors(x, y)) {
    if (nb[n] === opponent) {
      const g = getGroup(nb, n);
      if (g.liberties.size === 0) {
        caps += g.stones.size;
        for (const s of g.stones) nb[s] = EMPTY;
      }
    }
  }
  if (caps > 0) w += caps * 8;

  // Atari threats (put opponent in 1-liberty)
  for (const n of neighbors(x, y)) {
    if (nb[n] === opponent) {
      const g = getGroup(nb, n);
      if (g.liberties.size === 1) w += 6;
    }
  }

  // Own group liberties
  const myG = getGroup(nb, i);
  w += myG.liberties.size * 0.5;

  // Avoid self-atari
  if (myG.liberties.size === 1 && caps === 0) w *= 0.05;

  // Star points
  if (STAR_POINTS.has(i)) w += 3;

  // Prefer 3rd/4th line, penalise 1st/2nd
  const edgeDist = Math.min(x, y, BOARD_SIZE - 1 - x, BOARD_SIZE - 1 - y);
  if (edgeDist === 0) w *= 0.2;
  else if (edgeDist === 1) w *= 0.5;
  else if (edgeDist >= 2 && edgeDist <= 4) w *= 1.3;

  return w;
}

// ─── Weighted random selection ────────────────────────────────────────────────
function weightedChoice(moves, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let r = Math.random() * total;
  for (let i = 0; i < moves.length; i++) {
    r -= weights[i];
    if (r <= 0) return moves[i];
  }
  return moves[moves.length - 1];
}

// ─── Fast rollout ─────────────────────────────────────────────────────────────
// Returns 1 if `rootColor` wins, 0 if loses.
function rollout(board, turn, koPoint, rootColor) {
  board = cloneBoard(board);
  let passes = 0;

  for (let d = 0; d < ROLLOUT_DEPTH; d++) {
    // Collect candidate moves (only near existing stones for speed)
    const candidates = [];
    const weights = [];
    const seen = new Set();

    for (let i = 0; i < board.length; i++) {
      if (board[i] === EMPTY) continue;
      const { x, y } = coord(i);
      for (const n of neighbors(x, y)) {
        if (seen.has(n)) continue;
        seen.add(n);
        const { x: nx, y: ny } = coord(n);
        const res = tryMove(board, nx, ny, turn, koPoint);
        if (!res.ok) continue;
        const w = moveWeight(board, nx, ny, turn, koPoint);
        candidates.push({ x: nx, y: ny, res });
        weights.push(w);
      }
    }

    if (candidates.length === 0) {
      passes++;
      if (passes >= 2) break;
      koPoint = null;
      turn = turn === BLACK ? WHITE : BLACK;
      continue;
    }

    passes = 0;
    const chosen = weightedChoice(candidates, weights);
    board = chosen.res.newBoard;
    koPoint = chosen.res.newKoPoint;
    turn = turn === BLACK ? WHITE : BLACK;
  }

  // Score the final position
  const s = score(board);
  const blackWins = s.blackFinal > s.whiteFinal;
  return (rootColor === BLACK ? blackWins : !blackWins) ? 1 : 0;
}

// ─── MCTS Node ────────────────────────────────────────────────────────────────
class Node {
  constructor(move, parent, board, turn, koPoint) {
    this.move    = move;      // { x, y } | null (root)
    this.parent  = parent;
    this.board   = board;
    this.turn    = turn;
    this.koPoint = koPoint;
    this.wins    = 0;
    this.visits  = 0;
    this.children = [];
    this.untriedMoves = null; // lazily populated
  }

  ucb(parentVisits) {
    if (this.visits === 0) return Infinity;
    return this.wins / this.visits + UCB_C * Math.sqrt(Math.log(parentVisits) / this.visits);
  }

  bestChild() {
    let best = null, bestScore = -Infinity;
    for (const c of this.children) {
      const s = c.ucb(this.visits);
      if (s > bestScore) { bestScore = s; best = c; }
    }
    return best;
  }

  mostVisitedChild() {
    let best = null, bestV = -1;
    for (const c of this.children) {
      if (c.visits > bestV) { bestV = c.visits; best = c; }
    }
    return best;
  }
}

// ─── MCTS ─────────────────────────────────────────────────────────────────────
function mcts(game, color) {
  const root = new Node(null, null, game.board, color, game.koPoint);

  // Pre-generate candidate moves for root (near stones + star points)
  function getCandidates(board, turn, koPoint) {
    const near = new Set();
    for (let i = 0; i < board.length; i++) {
      if (board[i] === EMPTY) continue;
      const { x, y } = coord(i);
      for (const n of neighbors(x, y)) near.add(n);
      // Also add 2-point extensions (knight's move area)
      for (const n of neighbors(x, y)) {
        const { x: nx, y: ny } = coord(n);
        for (const nn of neighbors(nx, ny)) near.add(nn);
      }
    }
    // Always include star points
    for (const sp of STAR_POINTS) near.add(sp);

    const moves = [];
    for (const i of near) {
      const { x, y } = coord(i);
      const res = tryMove(board, x, y, turn, koPoint);
      if (res.ok) moves.push({ x, y, res });
    }

    // If board is empty or very sparse, add all valid moves
    if (moves.length < 10) {
      for (let y = 0; y < BOARD_SIZE; y++) {
        for (let x = 0; x < BOARD_SIZE; x++) {
          const res = tryMove(board, x, y, turn, koPoint);
          if (res.ok) moves.push({ x, y, res });
        }
      }
    }
    return moves;
  }

  root.untriedMoves = getCandidates(root.board, root.turn, root.koPoint);

  // Sort untried moves by heuristic weight (best first)
  root.untriedMoves.sort((a, b) =>
    moveWeight(root.board, b.x, b.y, color, root.koPoint) -
    moveWeight(root.board, a.x, a.y, color, root.koPoint)
  );

  const deadline = performance.now() + MCTS_BUDGET_MS;

  while (performance.now() < deadline) {
    // ── Selection
    let node = root;
    while (node.untriedMoves !== null && node.untriedMoves.length === 0 && node.children.length > 0) {
      node = node.bestChild();
    }

    // ── Expansion
    if (node.untriedMoves === null) {
      node.untriedMoves = getCandidates(node.board, node.turn, node.koPoint);
    }

    if (node.untriedMoves.length > 0) {
      // Pick the first untried move (already sorted by heuristic)
      const { x, y, res } = node.untriedMoves.shift();
      const child = new Node(
        { x, y },
        node,
        res.newBoard,
        node.turn === BLACK ? WHITE : BLACK,
        res.newKoPoint
      );
      node.children.push(child);
      node = child;
    }

    // ── Simulation (rollout from node)
    const result = rollout(node.board, node.turn, node.koPoint, color);

    // ── Backpropagation
    let cur = node;
    while (cur !== null) {
      cur.visits++;
      // Win from the perspective of the root color
      cur.wins += result;
      cur = cur.parent;
    }
  }

  return root;
}

// ─── Pattern: detect nakade (filling inside dead group) ──────────────────────
// Returns true if placing at (x,y) fills the vital point of a dead opponent shape
function isNakade(board, x, y, color) {
  const opponent = color === BLACK ? WHITE : BLACK;
  const i = idx(x, y);
  // Check if all neighbors are opponent stones
  const ns = neighbors(x, y);
  let oppCount = 0;
  for (const n of ns) {
    if (board[n] === opponent) oppCount++;
  }
  return oppCount === ns.length; // surrounded by opponent = likely eye/nakade point
}

// ─── Urgency: moves that must be played immediately ──────────────────────────
// Returns a high-priority move if one exists, else null.
function urgentMove(game, color) {
  const opponent = color === BLACK ? WHITE : BLACK;
  const board = game.board;
  const koPoint = game.koPoint;

  let saveMove = null;   // save own group in atari
  let killMove = null;   // capture opponent group in atari
  let saveSize = 0;
  let killSize = 0;

  for (let i = 0; i < board.length; i++) {
    if (board[i] === EMPTY) continue;
    const { x, y } = coord(i);

    if (board[i] === color) {
      const g = getGroup(board, i);
      if (g.liberties.size === 1) {
        // Own group in atari — try to save it
        const [lib] = g.liberties;
        const { x: lx, y: ly } = coord(lib);
        const res = tryMove(board, lx, ly, color, koPoint);
        if (res.ok && g.stones.size > saveSize) {
          // Check saving move actually gives liberties
          const savedG = getGroup(res.newBoard, idx(lx, ly));
          if (savedG.liberties.size > 1) {
            saveMove = { x: lx, y: ly };
            saveSize = g.stones.size;
          }
        }
      }
    }

    if (board[i] === opponent) {
      const g = getGroup(board, i);
      if (g.liberties.size === 1) {
        // Opponent group in atari — try to capture it
        const [lib] = g.liberties;
        const { x: lx, y: ly } = coord(lib);
        const res = tryMove(board, lx, ly, color, koPoint);
        if (res.ok && g.stones.size > killSize) {
          killMove = { x: lx, y: ly };
          killSize = g.stones.size;
        }
      }
    }
  }

  // Prefer killing large groups, then saving own large groups
  if (killSize >= saveSize && killMove) return killMove;
  if (saveMove) return saveMove;
  if (killMove) return killMove;
  return null;
}

// ─── Main tick ────────────────────────────────────────────────────────────────
export function tick({ game, color }) {
  const validMoves = game.validMoves(color);
  if (validMoves.length === 0) return 'pass';

  // 1. Check for urgent tactical moves (atari save/kill)
  const urgent = urgentMove(game, color);
  if (urgent) return urgent;

  // 2. MCTS search
  const root = mcts(game, color);

  if (root.children.length === 0) return 'pass';

  const best = root.mostVisitedChild();
  if (!best) return 'pass';

  // 3. If win-rate is very low, pass (endgame)
  const winRate = best.visits > 0 ? best.wins / best.visits : 0;
  if (winRate < PASS_THRESHOLD && root.visits > 50) return 'pass';

  return best.move;
}
