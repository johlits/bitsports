export const id = "human";
export const name = "Human (Click)";

// Human AI — move is driven by canvas click events in main.js
// tick() returns null to signal "waiting for human input"
export function tick({ game, color }) {
  return null; // main.js handles click → game.playMove()
}
