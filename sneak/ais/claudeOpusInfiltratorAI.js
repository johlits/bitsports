export const id = "claude-opus-infil";
export const name = "Claude Opus 4.5 Infiltrator";

// Per-agent state for sophisticated stealth behavior
const agentState = new Map();

function getState(agentId) {
  if (!agentState.has(agentId)) {
    agentState.set(agentId, {
      mode: "seek_gold",        // seek_gold, return_gold, evade, explore
      targetGold: null,
      exploreTarget: null,
      exploreTime: 0,
      lastKnownGuards: [],      // remember where guards were seen
      evasionDir: null,
      evasionTime: 0,
      stuckTime: 0,
      lastPos: null,
      safePathMemory: [],       // remember safe routes
    });
  }
  return agentState.get(agentId);
}

// Exploration points - aggressive gold hunting across the map
const explorePoints = [
  { x: 0, z: 0, priority: 10 },      // center vault - highest priority
  { x: -5, z: -4, priority: 9 },     // guard territory gold - risky but rewarding
  { x: -5, z: 4, priority: 9 },      // guard territory gold
  { x: -3, z: -2, priority: 8 },     // mid-left upper
  { x: -3, z: 2, priority: 8 },      // mid-left lower
  { x: 3, z: -3, priority: 7 },      // right upper
  { x: 3, z: 3, priority: 7 },       // right lower
  { x: -6, z: 0, priority: 6 },      // deep in guard territory
  { x: 1, z: -5, priority: 5 },      // far upper
  { x: 1, z: 5, priority: 5 },       // far lower
];

// Calculate danger level at a position based on known guard positions
function getDangerLevel(x, z, guards, lastKnownGuards) {
  let danger = 0;
  
  // Current visible guards
  if (guards) {
    for (const guard of guards) {
      const dist = Math.hypot(guard.x - x, guard.z - z);
      if (dist < 5) {
        danger += (5 - dist) * 20;  // closer = more danger
      }
    }
  }
  
  // Recently seen guards (fading memory)
  for (const mem of lastKnownGuards) {
    const dist = Math.hypot(mem.x - x, mem.z - z);
    if (dist < 4) {
      danger += (4 - dist) * 5 * mem.confidence;
    }
  }
  
  return danger;
}

// Find safest direction to move
function getSafeDirection(self, guards, lastKnownGuards) {
  let bestDir = null;
  let lowestDanger = Infinity;
  
  // Check 8 directions
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    const testX = self.x + Math.cos(angle) * 2;
    const testZ = self.z + Math.sin(angle) * 2;
    const danger = getDangerLevel(testX, testZ, guards, lastKnownGuards);
    
    if (danger < lowestDanger) {
      lowestDanger = danger;
      bestDir = { x: Math.cos(angle), z: Math.sin(angle) };
    }
  }
  
  return bestDir;
}

export function tick({ self, myBase, teammates, visibleEnemies, visibleGold, getDirectionToward, dt }) {
  const state = getState(self.id);
  
  // Update timers
  state.exploreTime += dt || 0.016;
  state.evasionTime = Math.max(0, state.evasionTime - (dt || 0.016));
  
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
  
  // Update guard memory
  if (visibleEnemies && visibleEnemies.length > 0) {
    state.lastKnownGuards = visibleEnemies.map(g => ({
      x: g.x,
      z: g.z,
      confidence: 1.0,
      time: performance.now()
    }));
  } else {
    // Decay confidence of old memories
    state.lastKnownGuards = state.lastKnownGuards
      .map(m => ({ ...m, confidence: m.confidence * 0.98 }))
      .filter(m => m.confidence > 0.1);
  }
  
  // === PRIORITY 1: Return gold to base if carrying ===
  if (self.carryingGoldId) {
    state.mode = "return_gold";
    
    // Check for danger on the way back
    const dangerLevel = getDangerLevel(self.x, self.z, visibleEnemies, state.lastKnownGuards);
    
    if (visibleEnemies && visibleEnemies.length > 0) {
      // Find closest guard
      let closestGuard = null;
      let closestDist = Infinity;
      for (const guard of visibleEnemies) {
        const dist = Math.hypot(guard.x - self.x, guard.z - self.z);
        if (dist < closestDist) {
          closestDist = dist;
          closestGuard = guard;
        }
      }
      
      if (closestDist < 3.5) {
        // Guard is close! Evasive maneuvers
        // Calculate escape vector (away from guard, toward base)
        const awayX = self.x - closestGuard.x;
        const awayZ = self.z - closestGuard.z;
        const awayLen = Math.hypot(awayX, awayZ) || 1;
        
        const toBaseX = myBase.x - self.x;
        const toBaseZ = myBase.z - self.z;
        const toBaseLen = Math.hypot(toBaseX, toBaseZ) || 1;
        
        // Blend: 60% away from guard, 40% toward base
        const blendX = (awayX / awayLen) * 0.6 + (toBaseX / toBaseLen) * 0.4;
        const blendZ = (awayZ / awayLen) * 0.6 + (toBaseZ / toBaseLen) * 0.4;
        const blendLen = Math.hypot(blendX, blendZ) || 1;
        
        return { x: blendX / blendLen, z: blendZ / blendLen };
      }
    }
    
    // Safe to head home
    const dir = getDirectionToward(myBase.x, myBase.z);
    if (dir) return dir;
  }
  
  // === PRIORITY 2: Evade if guards are very close ===
  if (visibleEnemies && visibleEnemies.length > 0) {
    let closestDist = Infinity;
    let closestGuard = null;
    
    for (const guard of visibleEnemies) {
      const dist = Math.hypot(guard.x - self.x, guard.z - self.z);
      if (dist < closestDist) {
        closestDist = dist;
        closestGuard = guard;
      }
    }
    
    // If guard is dangerously close, evade
    if (closestDist < 2.5) {
      state.mode = "evade";
      
      // Run away from guard
      const awayX = self.x - closestGuard.x;
      const awayZ = self.z - closestGuard.z;
      const len = Math.hypot(awayX, awayZ) || 1;
      
      return { x: awayX / len, z: awayZ / len };
    }
    
    // If guard is nearby but not critical, be cautious
    if (closestDist < 4) {
      // Try to find a safe direction that also makes progress
      const safeDir = getSafeDirection(self, visibleEnemies, state.lastKnownGuards);
      if (safeDir) {
        return safeDir;
      }
    }
  }
  
  // === PRIORITY 3: Go for visible gold ===
  if (visibleGold && visibleGold.length > 0) {
    state.mode = "seek_gold";
    
    // Find best gold (closest, but avoid dangerous areas)
    let bestGold = null;
    let bestScore = -Infinity;
    
    for (const gold of visibleGold) {
      const dist = Math.hypot(gold.x - self.x, gold.z - self.z);
      const danger = getDangerLevel(gold.x, gold.z, visibleEnemies, state.lastKnownGuards);
      
      // Score: closer is better, less danger is better
      const score = 100 - dist * 5 - danger * 2;
      
      // Bonus for gold that teammates aren't going for
      let teammateGoingFor = false;
      if (teammates) {
        for (const tm of teammates) {
          const tmDist = Math.hypot(tm.x - gold.x, tm.z - gold.z);
          if (tmDist < dist - 1) {
            teammateGoingFor = true;
            break;
          }
        }
      }
      if (!teammateGoingFor) {
        if (score > bestScore) {
          bestScore = score;
          bestGold = gold;
        }
      }
    }
    
    // If no uncontested gold, just go for closest
    if (!bestGold) {
      bestGold = visibleGold.reduce((best, g) => {
        const dist = Math.hypot(g.x - self.x, g.z - self.z);
        const bestDist = Math.hypot(best.x - self.x, best.z - self.z);
        return dist < bestDist ? g : best;
      }, visibleGold[0]);
    }
    
    if (bestGold) {
      state.targetGold = bestGold;
      const dir = getDirectionToward(bestGold.x, bestGold.z);
      if (dir) return dir;
    }
  }
  
  // === PRIORITY 4: Aggressive exploration to find gold ===
  state.mode = "explore";
  
  // Pick exploration target - change targets quickly for active searching
  if (!state.exploreTarget || state.exploreTime > 2.0 || state.stuckTime > 0.6) {
    // Weight by priority, prefer unexplored areas
    let bestPoint = null;
    let bestScore = -Infinity;
    
    for (const point of explorePoints) {
      const dist = Math.hypot(point.x - self.x, point.z - self.z);
      if (dist < 0.8) continue;  // skip if we're already there
      
      // Reduced danger weight - be more aggressive
      const danger = getDangerLevel(point.x, point.z, visibleEnemies, state.lastKnownGuards);
      const score = point.priority * 12 - dist * 1.5 - danger * 0.5;
      
      // More randomness for unpredictable movement
      const randomBonus = Math.random() * 8;
      
      if (score + randomBonus > bestScore) {
        bestScore = score + randomBonus;
        bestPoint = point;
      }
    }
    
    state.exploreTarget = bestPoint || explorePoints[0];
    state.exploreTime = 0;
    state.stuckTime = 0;
  }
  
  // Check if reached explore target - smaller threshold for faster cycling
  const distToTarget = Math.hypot(state.exploreTarget.x - self.x, state.exploreTarget.z - self.z);
  if (distToTarget < 0.5) {
    state.exploreTarget = null;
    state.exploreTime = 10;  // force new target selection
  }
  
  if (state.exploreTarget) {
    const dir = getDirectionToward(state.exploreTarget.x, state.exploreTarget.z);
    if (dir) return dir;
  }
  
  // Fallback: move toward center where gold likely is
  const centerDir = getDirectionToward(0, 0);
  if (centerDir) return centerDir;
  
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}
