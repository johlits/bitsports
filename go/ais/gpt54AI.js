import { tryMove, getGroup, neighbors, idx, coord, score, EMPTY, BLACK, WHITE, BOARD_SIZE } from "../engine.js";

export const id = "gpt-5-4";
export const name = "GPT-5.4";

const SEARCH_BUDGET_MS = 320;
const UCB_C = 1.32;
const ROLLOUT_DEPTH = 72;
const PASS_THRESHOLD = 0.12;
const ROOT_LIMIT = 42;
const CHILD_LIMIT = 22;

const STAR_POINTS = new Set([
  idx(3, 3), idx(9, 3), idx(15, 3),
  idx(3, 9), idx(9, 9), idx(15, 9),
  idx(3, 15), idx(9, 15), idx(15, 15),
]);

function cloneBoard(b) {
  return b.slice();
}

function opponentOf(color) {
  return color === BLACK ? WHITE : BLACK;
}

function hypot2(x, y) {
  return Math.hypot(x, y);
}

function centerDistPenalty(x, y) {
  const cx = x - (BOARD_SIZE - 1) / 2;
  const cy = y - (BOARD_SIZE - 1) / 2;
  return Math.hypot(cx, cy);
}

function edgeDistance(x, y) {
  return Math.min(x, y, BOARD_SIZE - 1 - x, BOARD_SIZE - 1 - y);
}

function boardStoneCount(board) {
  let count = 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== EMPTY) count++;
  }
  return count;
}

function hasAdjacentStone(board, x, y) {
  for (const n of neighbors(x, y)) {
    if (board[n] !== EMPTY) return true;
  }
  return false;
}

function countFriendlyAdj(board, x, y, color) {
  let count = 0;
  for (const n of neighbors(x, y)) {
    if (board[n] === color) count++;
  }
  return count;
}

function countOpponentAdj(board, x, y, color) {
  const opponent = opponentOf(color);
  let count = 0;
  for (const n of neighbors(x, y)) {
    if (board[n] === opponent) count++;
  }
  return count;
}

function getInfluence(board, x, y, color) {
  let value = 0;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= BOARD_SIZE || ny >= BOARD_SIZE) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      const w = d === 0 ? 0 : d === 1 ? 1 : d === 2 ? 0.55 : 0.2;
      const stone = board[idx(nx, ny)];
      if (stone === color) value += w;
      else if (stone === opponentOf(color)) value -= w;
    }
  }
  return value;
}

function moveWeight(board, x, y, color, koPoint, moveNumber) {
  const opponent = opponentOf(color);
  const i = idx(x, y);
  let w = 1.0;

  const res = tryMove(board, x, y, color, koPoint);
  if (!res.ok) return 0;

  const myGroup = getGroup(res.newBoard, i);
  const libs = myGroup.liberties.size;

  w += res.captured.size * 11;
  w += libs * 0.9;

  if (libs === 1 && res.captured.size === 0) w *= 0.03;
  else if (libs === 2) w *= 0.65;

  let atariBonus = 0;
  let connectBonus = 0;
  let pressureBonus = 0;

  for (const n of neighbors(x, y)) {
    if (res.newBoard[n] === opponent) {
      const og = getGroup(res.newBoard, n);
      if (og.liberties.size === 1) atariBonus += 8;
      pressureBonus += Math.max(0, 4 - og.liberties.size) * 1.2;
    } else if (res.newBoard[n] === color) {
      connectBonus += 1.6;
    }
  }

  w += atariBonus + connectBonus + pressureBonus;

  if (STAR_POINTS.has(i)) w += moveNumber < 20 ? 5.5 : 1.0;

  const edgeDist = edgeDistance(x, y);
  if (moveNumber < 18) {
    if (edgeDist === 0) w *= 0.16;
    else if (edgeDist === 1) w *= 0.42;
    else if (edgeDist >= 2 && edgeDist <= 4) w *= 1.24;
  }

  w += Math.max(0, 2.5 - centerDistPenalty(x, y) * 0.14);
  w += getInfluence(board, x, y, color) * 0.35;
  w += countFriendlyAdj(board, x, y, color) * 0.7;
  w += countOpponentAdj(board, x, y, color) * 0.6;

  return Math.max(0.01, w);
}

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

function candidateMoves(board, turn, koPoint, limit, moveNumber) {
  const near = new Map();
  let stones = 0;

  for (let i = 0; i < board.length; i++) {
    if (board[i] === EMPTY) continue;
    stones++;
    const { x, y } = coord(i);
    for (const n of neighbors(x, y)) {
      if (board[n] !== EMPTY) continue;
      near.set(n, true);
      const { x: nx, y: ny } = coord(n);
      for (const nn of neighbors(nx, ny)) {
        if (board[nn] === EMPTY) near.set(nn, true);
      }
    }
  }

  for (const sp of STAR_POINTS) near.set(sp, true);

  const scored = [];
  const source = near.size > 0 ? [...near.keys()] : [...Array(board.length).keys()];

  for (const i of source) {
    const { x, y } = coord(i);
    if (board[i] !== EMPTY) continue;
    const res = tryMove(board, x, y, turn, koPoint);
    if (!res.ok) continue;

    let score = moveWeight(board, x, y, turn, koPoint, moveNumber);
    if (stones === 0) {
      if (STAR_POINTS.has(i)) score += 20;
      score -= centerDistPenalty(x, y) * 0.2;
    } else if (!hasAdjacentStone(board, x, y) && !STAR_POINTS.has(i)) {
      score *= 0.18;
    }

    scored.push({ x, y, res, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

function territoryBias(board, color) {
  let val = 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i] === color) val += 1;
    else if (board[i] === opponentOf(color)) val -= 1;
  }
  return val;
}

function evaluateBoard(board, rootColor) {
  const s = score(board);
  const raw = rootColor === BLACK ? s.blackFinal - s.whiteFinal : s.whiteFinal - s.blackFinal;
  const terr = territoryBias(board, rootColor) * 0.015;
  return raw + terr;
}

function rollout(board, turn, koPoint, rootColor, moveNumber) {
  board = cloneBoard(board);
  let passes = 0;
  let ply = moveNumber;

  for (let d = 0; d < ROLLOUT_DEPTH; d++, ply++) {
    const candidates = candidateMoves(board, turn, koPoint, 18, ply);

    if (candidates.length === 0) {
      passes++;
      if (passes >= 2) break;
      koPoint = null;
      turn = opponentOf(turn);
      continue;
    }

    passes = 0;
    const weights = candidates.map((m) => Math.max(0.01, m.score));
    const chosen = weightedChoice(candidates, weights);
    board = chosen.res.newBoard;
    koPoint = chosen.res.newKoPoint;
    turn = opponentOf(turn);
  }

  return evaluateBoard(board, rootColor) > 0 ? 1 : 0;
}

class Node {
  constructor(move, parent, board, turn, koPoint, moveNumber) {
    this.move = move;
    this.parent = parent;
    this.board = board;
    this.turn = turn;
    this.koPoint = koPoint;
    this.moveNumber = moveNumber;
    this.wins = 0;
    this.visits = 0;
    this.children = [];
    this.untriedMoves = null;
  }

  ucb(parentVisits) {
    if (this.visits === 0) return Infinity;
    return this.wins / this.visits + UCB_C * Math.sqrt(Math.log(parentVisits) / this.visits);
  }

  bestChild() {
    let best = null;
    let bestScore = -Infinity;
    for (const c of this.children) {
      const s = c.ucb(this.visits);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  }

  mostVisitedChild() {
    let best = null;
    let bestV = -1;
    for (const c of this.children) {
      if (c.visits > bestV) {
        bestV = c.visits;
        best = c;
      }
    }
    return best;
  }
}

function mcts(game, color) {
  const moveNumber = boardStoneCount(game.board);
  const root = new Node(null, null, game.board, color, game.koPoint, moveNumber);
  root.untriedMoves = candidateMoves(root.board, root.turn, root.koPoint, ROOT_LIMIT, moveNumber);

  const deadline = performance.now() + SEARCH_BUDGET_MS;

  while (performance.now() < deadline) {
    let node = root;

    while (node.untriedMoves !== null && node.untriedMoves.length === 0 && node.children.length > 0) {
      node = node.bestChild();
    }

    if (node.untriedMoves === null) {
      node.untriedMoves = candidateMoves(node.board, node.turn, node.koPoint, CHILD_LIMIT, node.moveNumber);
    }

    if (node.untriedMoves.length > 0) {
      const { x, y, res } = node.untriedMoves.shift();
      const child = new Node(
        { x, y },
        node,
        res.newBoard,
        opponentOf(node.turn),
        res.newKoPoint,
        node.moveNumber + 1
      );
      node.children.push(child);
      node = child;
    }

    const result = rollout(node.board, node.turn, node.koPoint, color, node.moveNumber);

    let cur = node;
    while (cur) {
      cur.visits++;
      cur.wins += result;
      cur = cur.parent;
    }
  }

  return root;
}

function urgentMove(game, color) {
  const opponent = opponentOf(color);
  const board = game.board;
  const koPoint = game.koPoint;

  let bestKill = null;
  let bestSave = null;
  let bestKillSize = -1;
  let bestSaveSize = -1;

  const seen = new Set();

  for (let i = 0; i < board.length; i++) {
    if (board[i] === EMPTY || seen.has(i)) continue;
    const g = getGroup(board, i);
    for (const s of g.stones) seen.add(s);

    if (board[i] === opponent && g.liberties.size === 1) {
      const [lib] = g.liberties;
      const { x, y } = coord(lib);
      const res = tryMove(board, x, y, color, koPoint);
      if (res.ok && g.stones.size > bestKillSize) {
        bestKill = { x, y };
        bestKillSize = g.stones.size;
      }
    }

    if (board[i] === color && g.liberties.size === 1) {
      const [lib] = g.liberties;
      const { x, y } = coord(lib);
      const res = tryMove(board, x, y, color, koPoint);
      if (res.ok) {
        const saved = getGroup(res.newBoard, idx(x, y));
        if (saved.liberties.size > 1 && g.stones.size > bestSaveSize) {
          bestSave = { x, y };
          bestSaveSize = g.stones.size;
        }
      }
    }
  }

  if (bestKillSize >= Math.max(2, bestSaveSize) && bestKill) return bestKill;
  if (bestSave) return bestSave;
  if (bestKill) return bestKill;
  return null;
}

function localBestMove(game, color) {
  const moves = candidateMoves(game.board, color, game.koPoint, 24, boardStoneCount(game.board));
  if (moves.length === 0) return null;
  return moves[0];
}

export function tick({ game, color }) {
  const validMoves = game.validMoves(color);
  if (validMoves.length === 0) return "pass";

  const urgent = urgentMove(game, color);
  if (urgent) return urgent;

  const root = mcts(game, color);
  if (root.children.length === 0) {
    const fallback = localBestMove(game, color);
    return fallback ? { x: fallback.x, y: fallback.y } : "pass";
  }

  const best = root.mostVisitedChild();
  if (!best) return "pass";

  const winRate = best.visits > 0 ? best.wins / best.visits : 0;
  if (winRate < PASS_THRESHOLD && root.visits > 60) return "pass";

  return best.move;
}
