import { tryMove, getGroup, neighbors, idx, coord, EMPTY, BLACK, WHITE, BOARD_SIZE } from "../engine.js";

export const id = "heuristic";
export const name = "Heuristic AI";

// Star points for influence scoring
const STAR_POINTS = new Set([
  idx(3,3), idx(9,3), idx(15,3),
  idx(3,9), idx(9,9), idx(15,9),
  idx(3,15), idx(9,15), idx(15,15),
]);

function scoreMove(game, m, color) {
  const opponent = color === BLACK ? WHITE : BLACK;
  const result = tryMove(game.board, m.x, m.y, color, game.koPoint);
  if (!result.ok) return -Infinity;

  let score = 0;

  // 1. Captures — highest priority
  score += result.captured.size * 30;

  // 2. Own group liberties after move
  const myGroup = getGroup(result.newBoard, idx(m.x, m.y));
  score += myGroup.liberties.size * 3;

  // 3. Opponent pressure
  for (const n of neighbors(m.x, m.y)) {
    if (result.newBoard[n] === opponent) {
      const og = getGroup(result.newBoard, n);
      // Atari bonus
      if (og.liberties.size === 1) score += 25;
      // Reduce opponent liberties
      score -= og.liberties.size * 1.5;
    } else if (result.newBoard[n] === color) {
      // Connect to friendly stones
      score += 2;
    }
  }

  // 4. Star point bonus
  if (STAR_POINTS.has(idx(m.x, m.y))) score += 5;

  // 5. Center influence — prefer moves closer to center early
  const cx = m.x - (BOARD_SIZE - 1) / 2;
  const cy = m.y - (BOARD_SIZE - 1) / 2;
  score -= Math.hypot(cx, cy) * 0.5;

  // 6. Avoid edges and corners early (they have fewer liberties)
  const edgeDist = Math.min(m.x, m.y, BOARD_SIZE - 1 - m.x, BOARD_SIZE - 1 - m.y);
  if (edgeDist === 0) score -= 8;
  else if (edgeDist === 1) score -= 3;

  // 7. Avoid self-atari (placing into a group with only 1 liberty after)
  if (myGroup.liberties.size === 1) score -= 20;

  // Tie-break
  score += Math.random() * 0.5;

  return score;
}

export function tick({ game, color }) {
  const moves = game.validMoves(color);
  if (moves.length === 0) return 'pass';

  // Sample a subset for speed on 19x19 (up to 80 candidates)
  let candidates = moves;
  if (moves.length > 80) {
    // Prioritize moves near existing stones and star points
    const board = game.board;
    candidates = moves.filter(m => {
      if (STAR_POINTS.has(idx(m.x, m.y))) return true;
      for (const n of neighbors(m.x, m.y)) {
        if (board[n] !== EMPTY) return true;
      }
      return false;
    });
    // If too few, pad with random moves
    if (candidates.length < 20) {
      const extra = moves.filter(m => !candidates.includes(m));
      for (let i = extra.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [extra[i], extra[j]] = [extra[j], extra[i]];
      }
      candidates = [...candidates, ...extra.slice(0, 30)];
    }
  }

  let bestScore = -Infinity;
  let bestMove = null;

  for (const m of candidates) {
    const s = scoreMove(game, m, color);
    if (s > bestScore) {
      bestScore = s;
      bestMove = m;
    }
  }

  return bestMove ?? moves[Math.floor(Math.random() * moves.length)];
}
