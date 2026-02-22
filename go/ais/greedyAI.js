import { tryMove, getGroup, neighbors, idx, coord, EMPTY, BLACK, WHITE, BOARD_SIZE } from "../engine.js";

export const id = "greedy";
export const name = "Greedy AI";

// Scores a move by how many opponent stones it captures + how many liberties
// the resulting group has. Falls back to random if no captures available.
export function tick({ game, color }) {
  const opponent = color === BLACK ? WHITE : BLACK;
  const moves = game.validMoves(color);
  if (moves.length === 0) return 'pass';

  let bestScore = -Infinity;
  let bestMove = null;

  for (const m of moves) {
    const result = tryMove(game.board, m.x, m.y, color, game.koPoint);
    if (!result.ok) continue;

    let score = 0;

    // Captures are the highest priority
    score += result.captured.size * 20;

    // Liberties of the placed group
    const g = getGroup(result.newBoard, idx(m.x, m.y));
    score += g.liberties.size * 2;

    // Reduce opponent liberties near this move
    for (const n of neighbors(m.x, m.y)) {
      if (result.newBoard[n] === opponent) {
        const og = getGroup(result.newBoard, n);
        score -= og.liberties.size;
        // Bonus for putting opponent in atari (1 liberty)
        if (og.liberties.size === 1) score += 10;
      }
    }

    // Slight center preference
    const cx = m.x - (BOARD_SIZE - 1) / 2;
    const cy = m.y - (BOARD_SIZE - 1) / 2;
    score -= Math.hypot(cx, cy) * 0.3;

    // Tie-break with randomness
    score += Math.random() * 0.5;

    if (score > bestScore) {
      bestScore = score;
      bestMove = m;
    }
  }

  return bestMove ?? moves[Math.floor(Math.random() * moves.length)];
}
