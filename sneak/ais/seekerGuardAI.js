export const id = "seeker-guard";
export const name = "Seeker Guard";

// Per-agent state for hunting behavior
const agentState = new Map();

function getState(agentId) {
  if (!agentState.has(agentId)) {
    agentState.set(agentId, { 
      huntTarget: null,
      huntTime: 0,
      lastSeenEnemy: null,
      lastSeenTime: 0
    });
  }
  return agentState.get(agentId);
}

function randDir() {
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a), z: Math.sin(a) };
}

// Key locations to patrol when hunting (bigger map)
const huntPoints = [
  { x: 0, z: 0 },      // center/vault
  { x: -5, z: -4 },    // upper left (gold location)
  { x: -5, z: 4 },     // lower left (gold location)
  { x: -3, z: -2 },    // upper middle
  { x: -3, z: 2 },     // lower middle
  { x: -7, z: 0 },     // left side
  { x: 2, z: 0 },      // right of center
  { x: -4, z: -5 },    // far upper left
  { x: -4, z: 5 },     // far lower left
];

export function tick({ self, visibleEnemies, visibleGold, getDirectionToward, dt }) {
  const state = getState(self.id);
  state.huntTime += dt || 0.016;
  state.lastSeenTime += dt || 0.016;
  
  // If we see infiltrators, chase closest using pathfinding
  if (visibleEnemies && visibleEnemies.length > 0) {
    // Prioritize enemies carrying gold
    let best = null;
    let bestD = Infinity;
    for (const e of visibleEnemies) {
      const dx = e.x - self.x;
      const dz = e.z - self.z;
      const d = dx * dx + dz * dz;
      // Heavily prioritize gold carriers
      const priority = e.carryingGoldId ? d * 0.3 : d;
      if (priority < bestD) {
        bestD = priority;
        best = e;
      }
    }
    if (best) {
      state.lastSeenEnemy = { x: best.x, z: best.z };
      state.lastSeenTime = 0;
      const dir = getDirectionToward(best.x, best.z);
      if (dir) return dir;
    }
  }

  // If we recently saw an enemy, go to their last known position
  if (state.lastSeenEnemy && state.lastSeenTime < 2.0) {
    const dx = state.lastSeenEnemy.x - self.x;
    const dz = state.lastSeenEnemy.z - self.z;
    if (dx * dx + dz * dz > 0.3 * 0.3) {
      const dir = getDirectionToward(state.lastSeenEnemy.x, state.lastSeenEnemy.z);
      if (dir) return dir;
    }
  }

  // Otherwise, hover around gold locations if seen (deny access)
  if (visibleGold && visibleGold.length > 0) {
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
    // Stay near gold but not exactly on it - patrol around it
    const orbitDist = 1.2;
    const angle = (Date.now() / 2000 + self.id.charCodeAt(0)) % (Math.PI * 2);
    const targetX = best.x + Math.cos(angle) * orbitDist;
    const targetZ = best.z + Math.sin(angle) * orbitDist;
    const dir = getDirectionToward(targetX, targetZ);
    if (dir) return dir;
  }

  // Hunt mode: patrol key locations
  if (!state.huntTarget || state.huntTime > 2.5) {
    state.huntTarget = huntPoints[Math.floor(Math.random() * huntPoints.length)];
    state.huntTime = 0;
  }
  
  const dx = state.huntTarget.x - self.x;
  const dz = state.huntTarget.z - self.z;
  if (dx * dx + dz * dz < 0.5 * 0.5) {
    state.huntTarget = huntPoints[Math.floor(Math.random() * huntPoints.length)];
    state.huntTime = 0;
  }

  const dir = getDirectionToward(state.huntTarget.x, state.huntTarget.z);
  if (dir) return dir;
  
  return randDir();
}
