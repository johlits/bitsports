export const id = "random-infil";
export const name = "Random Infiltrator";

// Per-agent state
const agentState = new Map();

function getState(agentId) {
  if (!agentState.has(agentId)) {
    agentState.set(agentId, { 
      target: null,
      time: 0
    });
  }
  return agentState.get(agentId);
}

function randDir() {
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a), z: Math.sin(a) };
}

// Random exploration points for bigger map
const wanderPoints = [
  { x: 0, z: 0 },      // vault
  { x: 3, z: -3 },     // upper middle
  { x: 3, z: 3 },      // lower middle
  { x: 5, z: -3 },     // upper right (gold)
  { x: 5, z: 3 },      // lower right (gold)
  { x: 7, z: 0 },      // right side
  { x: 2, z: 0 },      // near center
  { x: 6, z: -5 },     // far upper right
  { x: 6, z: 5 },      // far lower right
  { x: -3, z: 0 },     // venture left
];

export function tick({ self, myBase, dt, getDirectionToward, visibleGold }) {
  const state = getState(self.id);
  state.time += dt || 0.016;

  // If carrying gold, use pathfinding to go home
  if (self.carryingGoldId) {
    const dir = getDirectionToward(myBase.x, myBase.z);
    if (dir) return dir;
    return randDir();
  }

  // If we see gold, go for it!
  if (visibleGold && visibleGold.length > 0) {
    const gold = visibleGold[Math.floor(Math.random() * visibleGold.length)];
    const dir = getDirectionToward(gold.x, gold.z);
    if (dir) return dir;
  }

  // Pick a new wander target periodically
  if (!state.target || state.time > 2.0) {
    state.target = wanderPoints[Math.floor(Math.random() * wanderPoints.length)];
    state.time = 0;
  }

  // Check if reached target
  const dx = state.target.x - self.x;
  const dz = state.target.z - self.z;
  if (dx * dx + dz * dz < 0.5 * 0.5) {
    state.target = wanderPoints[Math.floor(Math.random() * wanderPoints.length)];
    state.time = 0;
  }

  const dir = getDirectionToward(state.target.x, state.target.z);
  if (dir) return dir;

  return randDir();
}
