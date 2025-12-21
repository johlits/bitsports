export const id = "claude-opus-guard";
export const name = "Claude Opus 4.5 Guard";

// Per-agent state for sophisticated behavior
const agentState = new Map();

function getState(agentId) {
  if (!agentState.has(agentId)) {
    agentState.set(agentId, {
      mode: "patrol",           // patrol, chase, intercept, guard_gold
      patrolIdx: 0,
      lastSeenEnemy: null,
      lastSeenTime: 0,
      targetGold: null,
      chaseTarget: null,
      stuckTime: 0,
      lastPos: null,
      teamCoordination: 0,      // which role this guard takes
    });
  }
  return agentState.get(agentId);
}

// Strategic patrol points - more aggressive, pushing into enemy territory
const patrolZones = [
  // Zone 0: Aggressive upper sweep - pushes into infiltrator territory
  [{ x: -4, z: -4 }, { x: 0, z: -4 }, { x: 4, z: -3 }, { x: 2, z: -1 }, { x: -2, z: -2 }],
  // Zone 1: Aggressive lower sweep
  [{ x: -4, z: 4 }, { x: 0, z: 4 }, { x: 4, z: 3 }, { x: 2, z: 1 }, { x: -2, z: 2 }],
  // Zone 2: Center control - fast circuit around vault
  [{ x: -1, z: -2 }, { x: 3, z: -1 }, { x: 3, z: 1 }, { x: -1, z: 2 }, { x: -3, z: 0 }],
  // Zone 3: Deep infiltration patrol - hunts in enemy territory
  [{ x: 2, z: 0 }, { x: 5, z: -2 }, { x: 6, z: 0 }, { x: 5, z: 2 }, { x: 3, z: 0 }],
];

export function tick({ self, teammates, visibleEnemies, visibleGold, getDirectionToward, dt }) {
  const state = getState(self.id);
  
  // Assign coordination role based on agent ID
  if (state.teamCoordination === 0) {
    const idNum = parseInt(self.id.replace(/\D/g, '')) || 1;
    state.teamCoordination = idNum;
  }
  
  // Track time for various behaviors
  state.lastSeenTime += dt || 0.016;
  
  // Stuck detection
  if (state.lastPos) {
    const moved = Math.hypot(self.x - state.lastPos.x, self.z - state.lastPos.z);
    if (moved < 0.01) {
      state.stuckTime += dt || 0.016;
    } else {
      state.stuckTime = 0;
    }
  }
  state.lastPos = { x: self.x, z: self.z };
  
  // === PRIORITY 1: Chase visible enemies (especially gold carriers) ===
  if (visibleEnemies && visibleEnemies.length > 0) {
    // Prioritize gold carriers heavily
    let bestTarget = null;
    let bestScore = -Infinity;
    
    for (const enemy of visibleEnemies) {
      const dist = Math.hypot(enemy.x - self.x, enemy.z - self.z);
      let score = 100 - dist * 10;  // closer is better
      
      if (enemy.carryingGold) {
        score += 200;  // massive priority for gold carriers
      }
      
      // Bonus for enemies heading toward their base (about to score)
      const enemyToBase = Math.hypot(enemy.x - 10, enemy.z);  // infiltrator base at x=10
      if (enemyToBase < 5) {
        score += 50;  // they're close to scoring!
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestTarget = enemy;
      }
    }
    
    if (bestTarget) {
      state.mode = "chase";
      state.chaseTarget = bestTarget;
      state.lastSeenEnemy = { x: bestTarget.x, z: bestTarget.z };
      state.lastSeenTime = 0;
      
      // Predict interception point for gold carriers
      if (bestTarget.carryingGold) {
        // They're heading to their base at x=10, z=0
        const baseX = 10, baseZ = 0;
        const enemyToBase = Math.hypot(baseX - bestTarget.x, baseZ - bestTarget.z);
        const meToEnemy = Math.hypot(bestTarget.x - self.x, bestTarget.z - self.z);
        
        // If we can intercept, aim ahead of them
        if (meToEnemy < enemyToBase * 1.5) {
          const interceptX = bestTarget.x + (baseX - bestTarget.x) * 0.3;
          const interceptZ = bestTarget.z + (baseZ - bestTarget.z) * 0.3;
          const dir = getDirectionToward(interceptX, interceptZ);
          if (dir) return dir;
        }
      }
      
      // Direct chase
      const dir = getDirectionToward(bestTarget.x, bestTarget.z);
      if (dir) return dir;
    }
  }
  
  // === PRIORITY 2: Go to last known enemy position ===
  if (state.lastSeenEnemy && state.lastSeenTime < 3.0) {
    const dist = Math.hypot(state.lastSeenEnemy.x - self.x, state.lastSeenEnemy.z - self.z);
    if (dist > 0.5) {
      state.mode = "investigate";
      const dir = getDirectionToward(state.lastSeenEnemy.x, state.lastSeenEnemy.z);
      if (dir) return dir;
    } else {
      // Reached last known position, clear it
      state.lastSeenEnemy = null;
    }
  }
  
  // === PRIORITY 3: Guard gold locations ===
  if (visibleGold && visibleGold.length > 0) {
    // Find gold that's not being guarded by teammates
    let unguardedGold = null;
    let minGuardDist = Infinity;
    
    for (const gold of visibleGold) {
      // Check if any teammate is closer to this gold
      let teammateGuarding = false;
      if (teammates) {
        for (const tm of teammates) {
          const tmDist = Math.hypot(tm.x - gold.x, tm.z - gold.z);
          const myDist = Math.hypot(self.x - gold.x, self.z - gold.z);
          if (tmDist < myDist - 1) {
            teammateGuarding = true;
            break;
          }
        }
      }
      
      if (!teammateGuarding) {
        const dist = Math.hypot(self.x - gold.x, self.z - gold.z);
        if (dist < minGuardDist) {
          minGuardDist = dist;
          unguardedGold = gold;
        }
      }
    }
    
    if (unguardedGold) {
      state.mode = "guard_gold";
      state.targetGold = unguardedGold;
      
      // Patrol around the gold rather than standing on it
      const orbitRadius = 1.5;
      const orbitSpeed = 1.5;
      const angle = (performance.now() / 1000 * orbitSpeed + state.teamCoordination) % (Math.PI * 2);
      const targetX = unguardedGold.x + Math.cos(angle) * orbitRadius;
      const targetZ = unguardedGold.z + Math.sin(angle) * orbitRadius;
      
      const dir = getDirectionToward(targetX, targetZ);
      if (dir) return dir;
    }
  }
  
  // === PRIORITY 4: Aggressive patrol ===
  state.mode = "patrol";
  
  // Select patrol zone based on coordination role - cycle through zones for variety
  const time = performance.now() / 1000;
  const zoneShift = Math.floor(time / 15) % patrolZones.length;  // change zone every 15 sec
  const zoneIdx = ((state.teamCoordination - 1) + zoneShift) % patrolZones.length;
  const zone = patrolZones[zoneIdx];
  const point = zone[state.patrolIdx % zone.length];
  
  const distToPoint = Math.hypot(point.x - self.x, point.z - self.z);
  // Move to next point quickly - smaller threshold for faster patrol
  if (distToPoint < 0.4 || state.stuckTime > 0.8) {
    state.patrolIdx = (state.patrolIdx + 1) % zone.length;
    state.stuckTime = 0;
  }
  
  const dir = getDirectionToward(point.x, point.z);
  if (dir) return dir;
  
  // Fallback: move toward center aggressively
  const centerDir = getDirectionToward(0, 0);
  if (centerDir) return centerDir;
  
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}
