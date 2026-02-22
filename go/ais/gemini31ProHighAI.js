import { tryMove, getGroup, neighbors, idx, coord, score, inBounds, EMPTY, BLACK, WHITE, BOARD_SIZE, KOMI } from "../engine.js";

export const id = "gemini-3-1-pro-high";
export const name = "Gemini 3.1 Pro High";

// ─── Hyperparameters ──────────────────────────────────────────────────────────
const MCTS_BUDGET_MS   = 400;
const UCB_C            = 0.6;    // Exploitation-heavy
const RAVE_K           = 500;    // Trust RAVE for a long time
const AMAF_K           = 50;     // AMAF equivalence
const ROLLOUT_DEPTH    = 70;
const PASS_THRESHOLD   = 0.10;
const EXPAND_VISITS    = 6;

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

// ─── Fast helpers ─────────────────────────────────────────────────────────────
function cloneBoard(b) { return b.slice(); }

// ─── Local shapes & eyes ──────────────────────────────────────────────────────
function isOwnEye(board, i, color) {
  for (const n of NEIGHBORS[i]) {
    if (board[n] !== color) return false;
  }
  const { x, y } = coord(i);
  let myDiags = 0, totalDiags = 0;
  if (x > 0 && y > 0)       { totalDiags++; if (board[idx(x-1,y-1)] === color) myDiags++; }
  if (x < SZ-1 && y > 0)    { totalDiags++; if (board[idx(x+1,y-1)] === color) myDiags++; }
  if (x > 0 && y < SZ-1)    { totalDiags++; if (board[idx(x-1,y+1)] === color) myDiags++; }
  if (x < SZ-1 && y < SZ-1) { totalDiags++; if (board[idx(x+1,y+1)] === color) myDiags++; }
  return myDiags >= totalDiags - (totalDiags === 4 ? 1 : 0);
}

// True if placing at `i` is likely a vital point of opponent's dead shape (nakade)
function isNakade(board, i, color) {
  const opp = color === BLACK ? WHITE : BLACK;
  let oppCount = 0;
  for (const n of NEIGHBORS[i]) {
    if (board[n] === opp) oppCount++;
  }
  return oppCount === NEIGHBORS[i].length;
}

// ─── Tactical Search ──────────────────────────────────────────────────────────
// Simple 1-ply liberty count (fast)
function countLibs(board, startIdx) {
  const color = board[startIdx];
  if (color === EMPTY) return 0;
  const visited = new Uint8Array(N);
  visited[startIdx] = 1;
  const queue = [startIdx];
  let libs = 0;
  const seenLibs = new Uint8Array(N);
  while (queue.length > 0) {
    const cur = queue.pop();
    for (const n of NEIGHBORS[cur]) {
      if (board[n] === EMPTY) {
        if (!seenLibs[n]) { seenLibs[n] = 1; libs++; }
      } else if (board[n] === color && !visited[n]) {
        visited[n] = 1;
        queue.push(n);
      }
    }
  }
  return libs;
}

// True if group can be captured in a ladder
function readLadder(board, groupIdx, attacker) {
  const defender = board[groupIdx];
  if (countLibs(board, groupIdx) !== 1) return false;

  let b = cloneBoard(board);
  let turn = attacker;
  for (let i = 0; i < 16; i++) { // 16-ply ladder reading
    const g = getGroup(b, groupIdx);
    if (g.liberties.size === 0) return true;
    if (g.liberties.size > 1) return false;

    if (turn === attacker) {
      const [lib] = g.liberties;
      const { x, y } = coord(lib);
      const res = tryMove(b, x, y, attacker, null);
      if (!res.ok) return false;
      b = res.newBoard;
    } else {
      const [lib] = g.liberties;
      const { x, y } = coord(lib);
      const res = tryMove(b, x, y, defender, null);
      if (!res.ok) return true;
      b = res.newBoard;
    }
    turn = turn === BLACK ? WHITE : BLACK;
  }
  return false;
}

// ─── Rollout Policy ───────────────────────────────────────────────────────────
// Heuristic weights for rollout moves.
function rolloutPolicy(board, i, color, koPoint) {
  if (isOwnEye(board, i, color)) return 0;

  const opp = color === BLACK ? WHITE : BLACK;
  let weight = 1.0;

  const { x, y } = coord(i);
  const res = tryMove(board, x, y, color, koPoint);
  if (!res.ok) return 0;

  // Captures
  if (res.captured.size > 0) {
    weight += res.captured.size * 10;
  }

  // Liberties
  const myLibs = countLibs(res.newBoard, i);
  if (myLibs === 1 && res.captured.size === 0) return 0.01; // Avoid self-atari
  weight += myLibs * 0.5;

  // Atari threats
  for (const n of NEIGHBORS[i]) {
    if (res.newBoard[n] === opp && countLibs(res.newBoard, n) === 1) {
      weight += 6;
    }
  }

  // Save own atari
  for (const n of NEIGHBORS[i]) {
    if (board[n] === color && countLibs(board, n) === 1 && myLibs > 1) {
      weight += 15;
    }
  }

  // Nakade kill
  if (isNakade(board, i, color)) weight += 12;

  // Edge penalty
  const ed = EDGE_DIST[i];
  if (ed === 0) weight *= 0.1;
  else if (ed === 1) weight *= 0.3;

  return weight;
}

function pickMove(moves, weights) {
  let total = 0;
  for (let i = 0; i < weights.length; i++) total += weights[i];
  if (total <= 0) return moves[0];
  let r = Math.random() * total;
  for (let i = 0; i < moves.length; i++) {
    r -= weights[i];
    if (r <= 0) return moves[i];
  }
  return moves[moves.length - 1];
}

// ─── AMAF Rollout ─────────────────────────────────────────────────────────────
// Returns { result, blackMoves, whiteMoves }
function rolloutAMAF(board, turn, koPoint, rootColor) {
  board = cloneBoard(board);
  const blackMoves = new Uint8Array(N);
  const whiteMoves = new Uint8Array(N);
  let passes = 0;

  for (let d = 0; d < ROLLOUT_DEPTH; d++) {
    const cands = [];
    const weights = [];
    
    // 3x3 local search around existing stones
    const active = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (board[i] === EMPTY) continue;
      for (const n of NEIGHBORS[i]) active[n] = 1;
    }

    for (let i = 0; i < N; i++) {
      if (board[i] !== EMPTY || !active[i] || i === koPoint) continue;
      const w = rolloutPolicy(board, i, turn, koPoint);
      if (w > 0) { cands.push(i); weights.push(w); }
    }

    if (cands.length === 0) {
      passes++;
      if (passes >= 2) break;
      koPoint = null;
      turn = turn === BLACK ? WHITE : BLACK;
      continue;
    }

    passes = 0;
    const moveIdx = pickMove(cands, weights);
    
    if (turn === BLACK) blackMoves[moveIdx] = 1;
    else whiteMoves[moveIdx] = 1;

    const { x, y } = coord(moveIdx);
    const res = tryMove(board, x, y, turn, koPoint);
    board = res.newBoard;
    koPoint = res.newKoPoint;
    turn = turn === BLACK ? WHITE : BLACK;
  }

  const s = score(board);
  const bWin = s.blackFinal > s.whiteFinal;
  const res = (rootColor === BLACK ? bWin : !bWin) ? 1.0 : 0.0;
  return { res, blackMoves, whiteMoves };
}

// ─── MCTS Node ────────────────────────────────────────────────────────────────
class Node {
  constructor(moveIdx, parent, board, turn, koPoint) {
    this.moveIdx = moveIdx;
    this.parent = parent;
    this.board = board;
    this.turn = turn;
    this.koPoint = koPoint;
    
    this.wins = 0;
    this.visits = 0;
    this.amafWins = 0;
    this.amafVisits = 0;
    
    this.children = [];
    this.untried = null;
  }

  score(parentVisits) {
    if (this.visits === 0) return Infinity;

    const mcExploit = this.wins / this.visits;
    const mcExplore = UCB_C * Math.sqrt(Math.log(parentVisits) / this.visits);
    const mcScore = mcExploit + mcExplore;

    if (this.amafVisits === 0) return mcScore;

    const amafScore = this.amafWins / this.amafVisits;
    // RAVE beta schedule
    const beta = this.amafVisits / (this.amafVisits + this.visits + this.amafVisits * this.visits / RAVE_K);

    return (1 - beta) * mcScore + beta * amafScore;
  }
}

// ─── Priority Expansion ───────────────────────────────────────────────────────
function getExpansionCandidates(board, turn, koPoint) {
  const cands = [];
  const active = new Uint8Array(N);

  for (let i = 0; i < N; i++) {
    if (board[i] === EMPTY) continue;
    for (const n of NEIGHBORS[i]) {
      active[n] = 1;
      for (const nn of NEIGHBORS[n]) active[nn] = 1; // 2-jump
    }
  }

  for (let i = 0; i < N; i++) {
    if (board[i] !== EMPTY || !active[i] || i === koPoint) continue;
    const w = rolloutPolicy(board, i, turn, koPoint);
    if (w > 0) cands.push({ i, w });
  }

  // Fallback
  if (cands.length < 5) {
    for (let i = 0; i < N; i++) {
      if (board[i] === EMPTY && i !== koPoint) {
        const w = rolloutPolicy(board, i, turn, koPoint);
        if (w > 0) cands.push({ i, w });
      }
    }
  }

  cands.sort((a, b) => b.w - a.w);
  return cands.map(c => c.i);
}

// ─── Search ───────────────────────────────────────────────────────────────────
function mcts(game, color) {
  const root = new Node(null, null, game.board, color, game.koPoint);
  root.untried = getExpansionCandidates(root.board, root.turn, root.koPoint);

  const deadline = performance.now() + MCTS_BUDGET_MS;

  while (performance.now() < deadline) {
    let node = root;
    const path = [node];

    // Select
    while (node.untried !== null && node.untried.length === 0 && node.children.length > 0) {
      let best = null, bestS = -Infinity;
      for (const c of node.children) {
        const s = c.score(node.visits);
        if (s > bestS) { bestS = s; best = c; }
      }
      node = best;
      path.push(node);
    }

    // Expand
    if (node.untried === null) {
      node.untried = getExpansionCandidates(node.board, node.turn, node.koPoint);
    }

    if (node.untried.length > 0 && (node.children.length === 0 || node.visits >= EXPAND_VISITS)) {
      const i = node.untried.shift();
      const { x, y } = coord(i);
      const res = tryMove(node.board, x, y, node.turn, node.koPoint);
      if (res.ok) {
        const child = new Node(i, node, res.newBoard, node.turn === BLACK ? WHITE : BLACK, res.newKoPoint);
        node.children.push(child);
        node = child;
        path.push(node);
      }
    }

    // Rollout
    const { res, blackMoves, whiteMoves } = rolloutAMAF(node.board, node.turn, node.koPoint, color);

    // Backprop (MC + AMAF)
    for (let pi = 0; pi < path.length; pi++) {
      const n = path[pi];
      n.visits++;
      n.wins += res; // res is from root color's perspective
      
      // Update AMAF stats for siblings
      if (n.parent) {
        const p = n.parent;
        const myMoves = p.turn === BLACK ? blackMoves : whiteMoves;
        for (const c of p.children) {
          if (c === n || myMoves[c.moveIdx]) {
            c.amafVisits++;
            c.amafWins += res; // AMAF always matches MC perspective for root
          }
        }
      }
    }
  }

  return root;
}

// ─── Forced Tactical Moves ────────────────────────────────────────────────────
function getUrgentMove(board, color, koPoint) {
  const opp = color === BLACK ? WHITE : BLACK;
  const visited = new Uint8Array(N);

  let bestSave = null, saveSz = 0;
  let bestKill = null, killSz = 0;
  let bestLadder = null, ladderSz = 0;

  for (let i = 0; i < N; i++) {
    if (board[i] === EMPTY || visited[i]) continue;
    const g = getGroup(board, i);
    for (const s of g.stones) visited[s] = 1;

    // Atari defense
    if (g.liberties.size === 1 && board[i] === color && g.stones.size > saveSz) {
      const [lib] = g.liberties;
      const { x, y } = coord(lib);
      const r = tryMove(board, x, y, color, koPoint);
      if (r.ok && countLibs(r.newBoard, idx(x,y)) > 1) {
        bestSave = { x, y };
        saveSz = g.stones.size;
      }
    }

    // Atari kill
    if (g.liberties.size === 1 && board[i] === opp && g.stones.size > killSz) {
      const [lib] = g.liberties;
      const { x, y } = coord(lib);
      const r = tryMove(board, x, y, color, koPoint);
      if (r.ok) {
        bestKill = { x, y };
        killSz = g.stones.size;
      }
    }

    // Ladder attack
    if (g.liberties.size === 2 && board[i] === opp && g.stones.size > ladderSz) {
      for (const lib of g.liberties) {
        const { x, y } = coord(lib);
        const r = tryMove(board, x, y, color, koPoint);
        if (r.ok && countLibs(r.newBoard, i) === 1) {
          if (readLadder(r.newBoard, i, color)) {
            bestLadder = { x, y };
            ladderSz = g.stones.size;
          }
        }
      }
    }
  }

  if (killSz >= 4) return bestKill;
  if (saveSz >= 4) return bestSave;
  if (ladderSz >= 2) return bestLadder;
  if (killSz > saveSz) return bestKill;
  if (saveSz > 0) return bestSave;
  if (killSz > 0) return bestKill;
  return null;
}

// ─── Final wrapper ────────────────────────────────────────────────────────────
export function tick({ game, color }) {
  const valid = game.validMoves(color);
  if (valid.length === 0) return 'pass';

  const urgent = getUrgentMove(game.board, color, game.koPoint);
  if (urgent) return urgent;

  const root = mcts(game, color);
  
  if (root.children.length === 0) return 'pass';

  let best = null, bestV = -1;
  for (const c of root.children) {
    if (c.visits > bestV) { bestV = c.visits; best = c; }
  }

  const winRate = best.visits > 0 ? best.wins / best.visits : 0;
  if (winRate < PASS_THRESHOLD && root.visits > 30) {
    const s = score(game.board);
    const m = color === BLACK ? s.blackFinal : s.whiteFinal;
    const o = color === BLACK ? s.whiteFinal : s.blackFinal;
    if (m > o + 8) return 'pass'; // ahead and no good moves
  }

  // Self-atari guard for MCTS output
  if (best) {
    const r = tryMove(game.board, coord(best.moveIdx).x, coord(best.moveIdx).y, color, game.koPoint);
    if (r.ok && countLibs(r.newBoard, best.moveIdx) === 1 && r.captured.size === 0 && root.children.length > 1) {
      let sec = null, secV = -1;
      for (const c of root.children) {
        if (c !== best && c.visits > secV) { secV = c.visits; sec = c; }
      }
      if (sec && sec.visits > root.visits * 0.1) return coord(sec.moveIdx);
    }
  }

  return coord(best.moveIdx);
}
