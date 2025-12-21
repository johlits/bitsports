export const id = "patrol-guard";
export const name = "Patrol Guard";

// Multiple patrol routes for the bigger map (48x32)
const patrolRoutes = [
  // Upper route - covers top area
  [{ x: -6, z: -5 }, { x: -3, z: -5 }, { x: 0, z: -4 }, { x: -3, z: -2 }, { x: -6, z: -2 }],
  // Lower route - covers bottom area
  [{ x: -6, z: 5 }, { x: -3, z: 5 }, { x: 0, z: 4 }, { x: -3, z: 2 }, { x: -6, z: 2 }],
  // Center patrol - guards the vault area
  [{ x: -4, z: -2 }, { x: 0, z: -2 }, { x: 0, z: 2 }, { x: -4, z: 2 }],
  // Wide sweep - covers more ground
  [{ x: -7, z: -6 }, { x: -2, z: -6 }, { x: -2, z: 6 }, { x: -7, z: 6 }],
  // Inner patrol
  [{ x: -5, z: 0 }, { x: -2, z: -3 }, { x: 1, z: 0 }, { x: -2, z: 3 }],
];

// Per-agent state stored by agent id
const agentState = new Map();

function getState(agentId) {
  if (!agentState.has(agentId)) {
    const routeIdx = Math.floor(Math.random() * patrolRoutes.length);
    agentState.set(agentId, { idx: 0, route: patrolRoutes[routeIdx] });
  }
  return agentState.get(agentId);
}

function randDir() {
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a), z: Math.sin(a) };
}

export function tick({ self, visibleEnemies, getDirectionToward }) {
  const state = getState(self.id);
  
  // If we see an infiltrator, chase using pathfinding
  if (visibleEnemies && visibleEnemies.length > 0) {
    let best = visibleEnemies[0];
    let bestD = Infinity;
    for (const e of visibleEnemies) {
      const dx = e.x - self.x;
      const dz = e.z - self.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    const dir = getDirectionToward(best.x, best.z);
    if (dir) return dir;
  }

  const route = state.route;
  const p = route[state.idx % route.length];
  const dx = p.x - self.x;
  const dz = p.z - self.z;
  if (dx * dx + dz * dz < 0.4 * 0.4) {
    state.idx = (state.idx + 1) % route.length;
  }

  // Use pathfinding to navigate patrol route
  const dir = getDirectionToward(p.x, p.z);
  if (dir) return dir;
  
  // Fallback: random direction if pathfinding fails
  return randDir();
}
