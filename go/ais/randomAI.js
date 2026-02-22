export const id = "random";
export const name = "Random AI";

// Plays a random valid move, or passes if none available
export function tick({ game, color }) {
  const moves = game.validMoves(color);
  if (moves.length === 0) return 'pass';
  return moves[Math.floor(Math.random() * moves.length)];
}
