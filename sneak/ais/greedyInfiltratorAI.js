export const id = "greedy-infil";
export const name = "Greedy Infiltrator";

// Per-agent state for exploration
const agentState = new Map();

function getState(agentId) {
  if (!agentState.has(agentId)) {
    agentState.set(agentId, { 
      exploreTarget: null, 
      exploreTime: 0,
      lastGoldCheck: 0
    });
  }
  return agentState.get(agentId);
}

function randDir() {
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a), z: Math.sin(a) };
}

// Exploration targets for bigger map - infiltrator side and center
const explorePoints = [
  { x: 0, z: 0 },      // vault/center
  { x: 3, z: -4 },     // upper middle
  { x: 3, z: 4 },      // lower middle
  { x: 5, z: -3 },     // upper right (gold location)
  { x: 5, z: 3 },      // lower right (gold location)
  { x: 7, z: 0 },      // right side
  { x: -2, z: -3 },    // venture into guard territory upper
  { x: -2, z: 3 },     // venture into guard territory lower
  { x: -5, z: -4 },    // gold in guard territory upper
  { x: -5, z: 4 },     // gold in guard territory lower
];

export function tick({ self, myBase, visibleGold, visibleEnemies, getDirectionToward, dt }) {
  const state = getState(self.id);
  state.exploreTime += dt || 0.016;
  
  // If spotted risk is high (enemy visible), drift away from nearest enemy a bit.
  if (visibleEnemies && visibleEnemies.length > 0) {
    let nearest = visibleEnemies[0];
    let best = Infinity;
    for (const e of visibleEnemies) {
      const dx = e.x - self.x;
      const dz = e.z - self.z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        nearest = e;
      }
    }
    // Run away vector
    const rx = self.x - nearest.x;
    const rz = self.z - nearest.z;
    const rlen = Math.hypot(rx, rz) || 1;

    // But still bias toward objective (gold/base) using pathfinding
    const obj = self.carryingGoldId ? myBase : (visibleGold && visibleGold[0]) ? visibleGold[0] : myBase;
    const toObj = getDirectionToward(obj.x, obj.z) || { x: 0, z: 0 };

    const mixX = (rx / rlen) * 0.6 + toObj.x * 0.4;
    const mixZ = (rz / rlen) * 0.6 + toObj.z * 0.4;
    const mlen = Math.hypot(mixX, mixZ) || 1;
    return { x: mixX / mlen, z: mixZ / mlen };
  }

  // Use pathfinding to navigate around walls
  if (self.carryingGoldId) {
    const dir = getDirectionToward(myBase.x, myBase.z);
    if (dir) return dir;
    return randDir();
  }

  if (visibleGold && visibleGold.length > 0) {
    // go to nearest visible gold using pathfinding
    let best = visibleGold[0];
    let bestD = Infinity;
    for (const g of visibleGold) {
      const dx = g.x - self.x;
      const dz = g.z - self.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = g;
      }
    }
    state.exploreTarget = null; // Reset exploration when we see gold
    const dir = getDirectionToward(best.x, best.z);
    if (dir) return dir;
  }

  // No gold visible - explore the map to find some
  if (!state.exploreTarget || state.exploreTime > 3.0) {
    // Pick a new random exploration target
    state.exploreTarget = explorePoints[Math.floor(Math.random() * explorePoints.length)];
    state.exploreTime = 0;
  }
  
  // Check if we reached explore target
  const dx = state.exploreTarget.x - self.x;
  const dz = state.exploreTarget.z - self.z;
  if (dx * dx + dz * dz < 0.5 * 0.5) {
    state.exploreTarget = explorePoints[Math.floor(Math.random() * explorePoints.length)];
    state.exploreTime = 0;
  }

  const dir = getDirectionToward(state.exploreTarget.x, state.exploreTarget.z);
  if (dir) return dir;
  
  return randDir();
}
