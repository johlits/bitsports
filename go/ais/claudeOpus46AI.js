import { tryMove, getGroup, neighbors, idx, coord, score as scoreBoard, inBounds, EMPTY, BLACK, WHITE, BOARD_SIZE, KOMI } from "../engine.js";

export const id = "claude-opus-4-6";
export const name = "Claude Opus 4.6";

// ─── Tuning constants ─────────────────────────────────────────────────────────
const MCTS_BUDGET_MS   = 400;
const UCB_C            = 0.8;    // Lower exploration → more exploitation
const RAVE_K           = 300;    // RAVE equivalence parameter (higher = trust RAVE longer)
const ROLLOUT_DEPTH    = 80;
const PASS_THRESHOLD   = 0.12;
const EXPAND_THRESHOLD = 8;      // Visit count before expanding a node further

const SZ = BOARD_SIZE;
const N  = SZ * SZ;

// ─── Precomputed tables ───────────────────────────────────────────────────────
const NEIGHBORS = new Array(N);
const EDGE_DIST = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const { x, y } = coord(i);
  NEIGHBORS[i] = neighbors(x, y);
  EDGE_DIST[i] = Math.min(x, y, SZ - 1 - x, SZ - 1 - y);
}

const STAR_SET = new Set([
  idx(3,3),idx(9,3),idx(15,3),
  idx(3,9),idx(9,9),idx(15,9),
  idx(3,15),idx(9,15),idx(15,15),
]);

// 3-4 and 4-4 approach points for opening
const OPENING_POINTS = [
  idx(3,3),idx(15,3),idx(3,15),idx(15,15),  // 4-4 corners
  idx(2,3),idx(3,2),idx(15,2),idx(16,3),     // 3-4 approaches
  idx(2,15),idx(3,16),idx(15,16),idx(16,15),
  idx(9,3),idx(9,15),idx(3,9),idx(15,9),     // side star points
  idx(9,9),                                    // tengen
];

// ─── Fast helpers ─────────────────────────────────────────────────────────────
function cloneBoard(b) { return b.slice(); }

// Fast group liberty count without building full sets
function libertyCount(board, startIdx) {
  const color = board[startIdx];
  if (color === EMPTY) return 0;
  const visited = new Uint8Array(N);
  visited[startIdx] = 1;
  const queue = [startIdx];
  let libs = 0;
  const libSeen = new Uint8Array(N);
  while (queue.length > 0) {
    const cur = queue.pop();
    for (const n of NEIGHBORS[cur]) {
      if (board[n] === EMPTY) {
        if (!libSeen[n]) { libSeen[n] = 1; libs++; }
      } else if (board[n] === color && !visited[n]) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }
  return libs;
}

// Fast group size
function groupSize(board, startIdx) {
  const color = board[startIdx];
  if (color === EMPTY) return 0;
  const visited = new Uint8Array(N);
  visited[startIdx] = 1;
  const queue = [startIdx];
  let size = 1;
  while (queue.length > 0) {
    const cur = queue.pop();
    for (const n of NEIGHBORS[cur]) {
      if (board[n] === color && !visited[n]) {
        visited[n] = 1;
        queue.push(n);
        size++;
      }
    }
  }
  return size;
}

// ─── Eye detection ────────────────────────────────────────────────────────────
// Returns true if placing `color` at `i` would fill its own eye
function isOwnEye(board, i, color) {
  // All orthogonal neighbors must be own color or edge
  for (const n of NEIGHBORS[i]) {
    if (board[n] !== color) return false;
  }
  // For a true eye, at least 3 of 4 diagonals must be own color (or edge)
  const { x, y } = coord(i);
  let friendlyDiags = 0;
  let totalDiags = 0;
  const diags = [];
  if (x > 0 && y > 0)             diags.push(idx(x-1, y-1));
  if (x < SZ-1 && y > 0)          diags.push(idx(x+1, y-1));
  if (x > 0 && y < SZ-1)          diags.push(idx(x-1, y+1));
  if (x < SZ-1 && y < SZ-1)       diags.push(idx(x+1, y+1));
  totalDiags = diags.length;
  for (const d of diags) {
    if (board[d] === color) friendlyDiags++;
  }
  // Corner: need all diags; edge: need all; center: need 3/4
  return friendlyDiags >= totalDiags - (totalDiags === 4 ? 1 : 0);
}

// ─── Ladder detection (simplified) ────────────────────────────────────────────
// Check if a group in atari can be captured by a ladder (zigzag chase)
function isLadder(board, groupIdx, attacker) {
  const defender = board[groupIdx];
  if (defender === EMPTY) return false;
  const g = getGroup(board, groupIdx);
  if (g.liberties.size !== 1) return false;

  // Simulate up to 12 ladder steps
  let b = cloneBoard(board);
  let turn = attacker;
  for (let step = 0; step < 12; step++) {
    // Find the group being chased
    const chased = getGroup(b, groupIdx);
    if (chased.liberties.size === 0) return true;  // captured
    if (chased.liberties.size > 1) return false;    // escaped

    if (turn === attacker) {
      // Attacker plays on the liberty
      const [lib] = chased.liberties;
      const { x, y } = coord(lib);
      const res = tryMove(b, x, y, attacker, null);
      if (!res.ok) return false;
      b = res.newBoard;
    } else {
      // Defender extends
      const dg = getGroup(b, groupIdx);
      if (dg.liberties.size === 0) return true;
      if (dg.liberties.size > 1) return false;
      const [lib] = dg.liberties;
      const { x, y } = coord(lib);
      const res = tryMove(b, x, y, defender, null);
      if (!res.ok) return true; // can't extend = captured
      b = res.newBoard;
    }
    turn = turn === BLACK ? WHITE : BLACK;
  }
  return false; // inconclusive → assume not a ladder
}

// ─── Influence map ────────────────────────────────────────────────────────────
// Fast 4-step radial influence for territory estimation
function buildInfluence(board) {
  const inf = new Float32Array(N); // positive = black, negative = white
  for (let i = 0; i < N; i++) {
    if (board[i] === BLACK) inf[i] = 4;
    else if (board[i] === WHITE) inf[i] = -4;
  }
  // Spread influence 3 iterations
  for (let iter = 0; iter < 3; iter++) {
    const next = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (board[i] !== EMPTY) { next[i] = inf[i]; continue; }
      let sum = inf[i] * 2;
      let cnt = 2;
      for (const n of NEIGHBORS[i]) {
        sum += inf[n];
        cnt++;
      }
      next[i] = sum / cnt;
    }
    for (let i = 0; i < N; i++) inf[i] = next[i];
  }
  return inf;
}

// ─── Move scoring for candidate ordering ──────────────────────────────────────
function scoreMoveForOrdering(board, x, y, color, koPoint) {
  const opponent = color === BLACK ? WHITE : BLACK;
  const i = idx(x, y);
  let s = 0;

  // Quick simulate
  const nb = cloneBoard(board);
  nb[i] = color;

  let caps = 0;
  for (const n of NEIGHBORS[i]) {
    if (nb[n] === opponent) {
      const g = getGroup(nb, n);
      if (g.liberties.size === 0) {
        caps += g.stones.size;
        for (const st of g.stones) nb[st] = EMPTY;
      }
    }
  }
  s += caps * 15;

  // Atari threats
  for (const n of NEIGHBORS[i]) {
    if (nb[n] === opponent) {
      const libs = libertyCount(nb, n);
      if (libs === 1) s += 12;
      else if (libs === 2) s += 3;
    }
  }

  // Own liberties
  const myLibs = libertyCount(nb, i);
  s += myLibs * 2;

  // Self-atari penalty
  if (myLibs === 1 && caps === 0) s -= 25;

  // Save own group in atari
  for (const n of NEIGHBORS[i]) {
    if (board[n] === color) {
      const prevLibs = libertyCount(board, n);
      if (prevLibs === 1) {
        const newLibs = libertyCount(nb, n);
        if (newLibs > 1) s += 20;
      }
    }
  }

  // Star points
  if (STAR_SET.has(i)) s += 6;

  // Edge distance
  const ed = EDGE_DIST[i];
  if (ed === 0) s -= 10;
  else if (ed === 1) s -= 4;
  else if (ed >= 2 && ed <= 4) s += 2;

  // Connection bonus
  let friendlyNeighbors = 0;
  for (const n of NEIGHBORS[i]) {
    if (board[n] === color) friendlyNeighbors++;
  }
  s += friendlyNeighbors * 1.5;

  return s;
}

// ─── Rollout policy weight ────────────────────────────────────────────────────
function rolloutWeight(board, i, color) {
  const opponent = color === BLACK ? WHITE : BLACK;
  let w = 1.0;

  // Don't fill own eyes
  if (isOwnEye(board, i, color)) return 0.001;

  const nb = cloneBoard(board);
  nb[i] = color;

  let caps = 0;
  for (const n of NEIGHBORS[i]) {
    if (nb[n] === opponent) {
      const g = getGroup(nb, n);
      if (g.liberties.size === 0) {
        caps += g.stones.size;
        for (const st of g.stones) nb[st] = EMPTY;
      }
    }
  }
  if (caps > 0) w += caps * 10;

  // Atari
  for (const n of NEIGHBORS[i]) {
    if (nb[n] === opponent) {
      if (libertyCount(nb, n) === 1) w += 8;
    }
  }

  // Save own atari
  for (const n of NEIGHBORS[i]) {
    if (board[n] === color && libertyCount(board, n) === 1) {
      if (libertyCount(nb, n) > 1) w += 12;
    }
  }

  // Own liberties
  const myLibs = libertyCount(nb, i);
  w += myLibs * 0.4;
  if (myLibs === 1 && caps === 0) w *= 0.03;

  // Edge
  const ed = EDGE_DIST[i];
  if (ed === 0) w *= 0.15;
  else if (ed === 1) w *= 0.4;

  return w;
}

// ─── Weighted random selection ────────────────────────────────────────────────
function weightedPick(items, weights) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  if (total <= 0) return items[0];
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ─── Rollout ──────────────────────────────────────────────────────────────────
function rollout(board, turn, koPoint, rootColor) {
  board = cloneBoard(board);
  let passes = 0;

  for (let d = 0; d < ROLLOUT_DEPTH; d++) {
    const candidates = [];
    const weights = [];

    // Only consider moves near existing stones
    const seen = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (board[i] === EMPTY) continue;
      for (const n of NEIGHBORS[i]) {
        if (seen[n] || board[n] !== EMPTY) continue;
        seen[n] = 1;
        const { x, y } = coord(n);
        if (koPoint !== null && n === koPoint) continue;
        const res = tryMove(board, x, y, turn, koPoint);
        if (!res.ok) continue;
        const w = rolloutWeight(board, n, turn);
        if (w > 0.001) {
          candidates.push(res);
          weights.push(w);
        }
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
    const chosen = weightedPick(candidates, weights);
    board = chosen.newBoard;
    koPoint = chosen.newKoPoint;
    turn = turn === BLACK ? WHITE : BLACK;
  }

  const s = scoreBoard(board);
  const blackWins = s.blackFinal > s.whiteFinal;
  return (rootColor === BLACK ? blackWins : !blackWins) ? 1.0 : 0.0;
}

// ─── MCTS Node with RAVE ──────────────────────────────────────────────────────
class Node {
  constructor(move, parent, board, turn, koPoint) {
    this.move    = move;
    this.parent  = parent;
    this.board   = board;
    this.turn    = turn;
    this.koPoint = koPoint;
    this.wins    = 0;
    this.visits  = 0;
    this.children = [];
    this.untriedMoves = null;

    // RAVE stats: keyed by move index
    this.raveWins   = new Map();
    this.raveVisits = new Map();
  }

  // UCB1 + RAVE (MC-RAVE / UCB1-TUNED hybrid)
  raveScore(child, parentVisits) {
    if (child.visits === 0) return Infinity;

    const exploit = child.wins / child.visits;
    const explore = UCB_C * Math.sqrt(Math.log(parentVisits) / child.visits);

    // RAVE component
    const moveKey = child.move ? idx(child.move.x, child.move.y) : -1;
    const rv = this.raveVisits.get(moveKey) || 0;
    const rw = this.raveWins.get(moveKey) || 0;
    const raveVal = rv > 0 ? rw / rv : 0.5;

    // Beta: how much to trust RAVE vs actual visits
    const beta = rv / (rv + child.visits + rv * child.visits / RAVE_K);

    return (1 - beta) * exploit + beta * raveVal + explore;
  }

  bestChild() {
    let best = null, bestScore = -Infinity;
    for (const c of this.children) {
      const s = this.raveScore(c, this.visits);
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

// ─── Candidate generation ─────────────────────────────────────────────────────
function getCandidates(board, turn, koPoint, moveCount) {
  const near = new Uint8Array(N);

  // Radius-2 around all stones
  for (let i = 0; i < N; i++) {
    if (board[i] === EMPTY) continue;
    for (const n of NEIGHBORS[i]) {
      near[n] = 1;
      for (const nn of NEIGHBORS[n]) near[nn] = 1;
    }
  }

  // Always include star/opening points in first 30 moves
  if (moveCount < 30) {
    for (const p of OPENING_POINTS) near[p] = 1;
  }

  const moves = [];
  for (let i = 0; i < N; i++) {
    if (!near[i] || board[i] !== EMPTY) continue;
    const { x, y } = coord(i);
    const res = tryMove(board, x, y, turn, koPoint);
    if (res.ok) moves.push({ x, y, i: idx(x, y), res });
  }

  // Sparse board fallback
  if (moves.length < 8) {
    for (let i = 0; i < N; i++) {
      if (board[i] !== EMPTY) continue;
      const { x, y } = coord(i);
      const res = tryMove(board, x, y, turn, koPoint);
      if (res.ok) moves.push({ x, y, i: idx(x, y), res });
    }
  }

  return moves;
}

// ─── MCTS with RAVE ───────────────────────────────────────────────────────────
function mcts(game, color) {
  const moveCount = game.history.length;
  const root = new Node(null, null, game.board, color, game.koPoint);

  root.untriedMoves = getCandidates(root.board, root.turn, root.koPoint, moveCount);
  // Sort by heuristic (best first for expansion priority)
  root.untriedMoves.sort((a, b) =>
    scoreMoveForOrdering(root.board, b.x, b.y, color, root.koPoint) -
    scoreMoveForOrdering(root.board, a.x, a.y, color, root.koPoint)
  );

  const deadline = performance.now() + MCTS_BUDGET_MS;
  let iterations = 0;

  while (performance.now() < deadline) {
    iterations++;

    // ── Selection
    let node = root;
    const path = [node];
    while (node.untriedMoves !== null && node.untriedMoves.length === 0 && node.children.length > 0) {
      node = node.bestChild();
      path.push(node);
    }

    // ── Expansion (progressive widening: only expand after enough visits)
    if (node.untriedMoves === null) {
      node.untriedMoves = getCandidates(node.board, node.turn, node.koPoint, moveCount);
    }

    if (node.untriedMoves.length > 0 && (node.children.length === 0 || node.visits >= EXPAND_THRESHOLD)) {
      const m = node.untriedMoves.shift();
      const child = new Node(
        { x: m.x, y: m.y },
        node,
        m.res.newBoard,
        node.turn === BLACK ? WHITE : BLACK,
        m.res.newKoPoint
      );
      node.children.push(child);
      node = child;
      path.push(node);
    }

    // ── Simulation
    const result = rollout(node.board, node.turn, node.koPoint, color);

    // ── Backpropagation with RAVE
    // Collect all moves played in the rollout for RAVE updates
    for (let pi = path.length - 1; pi >= 0; pi--) {
      const n = path[pi];
      n.visits++;
      n.wins += result;

      // Update RAVE stats for sibling moves
      // For each child's move that appeared in the simulation path, update RAVE
      if (n.parent) {
        const moveKey = n.move ? idx(n.move.x, n.move.y) : -1;
        if (moveKey >= 0) {
          const p = n.parent;
          p.raveVisits.set(moveKey, (p.raveVisits.get(moveKey) || 0) + 1);
          p.raveWins.set(moveKey, (p.raveWins.get(moveKey) || 0) + result);
        }
      }
    }
  }

  return root;
}

// ─── Tactical urgency ─────────────────────────────────────────────────────────
function findUrgentMove(game, color) {
  const opponent = color === BLACK ? WHITE : BLACK;
  const board = game.board;
  const koPoint = game.koPoint;

  let bestSave = null, bestSaveSize = 0;
  let bestKill = null, bestKillSize = 0;
  let bestLadderKill = null, bestLadderSize = 0;

  const visited = new Uint8Array(N);

  for (let i = 0; i < N; i++) {
    if (board[i] === EMPTY || visited[i]) continue;

    const g = getGroup(board, i);
    for (const s of g.stones) visited[s] = 1;

    if (g.liberties.size === 1) {
      const [lib] = g.liberties;
      const { x, y } = coord(lib);

      if (board[i] === color && g.stones.size > bestSaveSize) {
        const res = tryMove(board, x, y, color, koPoint);
        if (res.ok) {
          const saved = getGroup(res.newBoard, idx(x, y));
          if (saved.liberties.size > 1) {
            bestSave = { x, y };
            bestSaveSize = g.stones.size;
          }
        }
      }

      if (board[i] === opponent && g.stones.size > bestKillSize) {
        const res = tryMove(board, x, y, color, koPoint);
        if (res.ok) {
          bestKill = { x, y };
          bestKillSize = g.stones.size;
        }
      }
    }

    // Ladder detection for groups with 2 liberties
    if (g.liberties.size === 2 && board[i] === opponent && g.stones.size >= 2) {
      for (const lib of g.liberties) {
        const { x, y } = coord(lib);
        const res = tryMove(board, x, y, color, koPoint);
        if (res.ok) {
          // Check if this creates a ladder
          const afterGroup = getGroup(res.newBoard, i);
          if (afterGroup.liberties.size === 1 && g.stones.size > bestLadderSize) {
            if (isLadder(res.newBoard, i, color)) {
              bestLadderKill = { x, y };
              bestLadderSize = g.stones.size;
            }
          }
        }
      }
    }
  }

  // Priority: kill large > save large > ladder kill > kill small > save small
  if (bestKillSize >= 3) return bestKill;
  if (bestSaveSize >= 3) return bestSave;
  if (bestLadderSize >= 2 && bestLadderKill) return bestLadderKill;
  if (bestKillSize >= bestSaveSize && bestKill) return bestKill;
  if (bestSave) return bestSave;
  if (bestKill) return bestKill;
  return null;
}

// ─── Score-aware pass decision ────────────────────────────────────────────────
function shouldPass(game, color) {
  const s = scoreBoard(game.board);
  const myScore = color === BLACK ? s.blackFinal : s.whiteFinal;
  const oppScore = color === BLACK ? s.whiteFinal : s.blackFinal;
  // If we're winning by a comfortable margin, consider passing
  return myScore > oppScore + 10;
}

// ─── Main tick ────────────────────────────────────────────────────────────────
export function tick({ game, color }) {
  const validMoves = game.validMoves(color);
  if (validMoves.length === 0) return 'pass';

  // 1. Urgent tactical moves
  const urgent = findUrgentMove(game, color);
  if (urgent) return urgent;

  // 2. MCTS search
  const root = mcts(game, color);

  if (root.children.length === 0) return 'pass';

  const best = root.mostVisitedChild();
  if (!best) return 'pass';

  // 3. Pass logic
  const winRate = best.visits > 0 ? best.wins / best.visits : 0;

  // If win-rate is very low and we're ahead, pass to end the game
  if (winRate < PASS_THRESHOLD && root.visits > 40) {
    if (shouldPass(game, color)) return 'pass';
  }

  // If the best move is self-atari with no captures, reconsider
  const res = tryMove(game.board, best.move.x, best.move.y, color, game.koPoint);
  if (res.ok) {
    const myLibs = libertyCount(res.newBoard, idx(best.move.x, best.move.y));
    if (myLibs === 1 && res.captured.size === 0 && root.children.length > 1) {
      // Try second-best move
      let secondBest = null, secondV = -1;
      for (const c of root.children) {
        if (c !== best && c.visits > secondV) { secondV = c.visits; secondBest = c; }
      }
      if (secondBest && secondBest.visits > root.visits * 0.15) {
        return secondBest.move;
      }
    }
  }

  return best.move;
}
