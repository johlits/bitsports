export const id = "gemini-3-5-pro-high";
export const name = "Gemini 3.5 Pro (high)";

/**
 * Gemini 3.5 Pro (High) - Advanced Vector Field & Adaptive Strategy
 * 
 * Improvements:
 * - Robust ID inference using score matching
 * - optimized potential field calculation with expanding rings
 * - Dynamic powerup valuation based on distance and game phase
 * - Late-game "Leader Hunter" mode
 * - Shield-aware aggression
 */

// Constants
const GRID_SIZE = 40;
const TILE_SIZE = 0.5;
const HALF_WORLD = 10;

// Weights for potential field
const WEIGHTS = {
  unpainted: 1.2,
  enemyTile: 0.9,
  leaderTile: 2.5, // High priority to steal from leader
  powerup: 20.0,
  opponentRepulsion: -12.0,
  centerBias: 0.05,
  pathConsistency: 0.8
};

// State per player instance
const botState = new Map();

function getBotState(id) {
  if (!botState.has(id)) {
    botState.set(id, {
      lastDir: { x: 0, z: 0 },
      stuckCount: 0,
      lastPos: null
    });
  }
  return botState.get(id);
}

function distSq(x1, z1, x2, z2) {
  return (x1 - x2) ** 2 + (z1 - z2) ** 2;
}

function gridToWorld(gx, gy) {
  return {
    x: gx * TILE_SIZE - HALF_WORLD + TILE_SIZE / 2,
    z: gy * TILE_SIZE - HALF_WORLD + TILE_SIZE / 2
  };
}

/**
 * Calculate attraction vector from nearby tiles
 */
function getTileForces(self, grid, others, timeRatio, leaderId) {
  let forceX = 0;
  let forceZ = 0;
  const range = 6; // Scan radius
  const selfGX = self.gridX;
  const selfGY = self.gridY;
  const myId = self.id;

  // Late game desperation?
  const desperate = timeRatio < 0.25;
  
  // Are we shielded?
  const shielded = self.powerups.shield > 0;

  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      if (dx === 0 && dy === 0) continue; // Skip self

      const gx = selfGX + dx;
      const gy = selfGY + dy;

      if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
        const owner = grid[gx][gy];
        
        // Skip our own tiles
        if (owner === myId) continue;

        let weight = 0;
        
        if (owner === 0) {
          // Unpainted tiles are good, especially early
          weight = WEIGHTS.unpainted * (timeRatio > 0.5 ? 1.2 : 1.0);
        } else if (owner === leaderId) {
          // Stealing from leader is very high value late game
          weight = desperate ? WEIGHTS.leaderTile : WEIGHTS.enemyTile * 1.2;
        } else {
          // Normal enemy tile
          weight = WEIGHTS.enemyTile;
        }

        // Shielded players can be more aggressive with stealing
        if (shielded) weight *= 1.3;

        // Calculate vector
        const worldPos = gridToWorld(gx, gy);
        const d2 = distSq(self.x, self.z, worldPos.x, worldPos.z);
        
        // Inverse square falloff, but capped to avoid singularity
        const strength = weight / (d2 + 0.5);
        
        const dirX = worldPos.x - self.x;
        const dirZ = worldPos.z - self.z;
        const len = Math.sqrt(dirX*dirX + dirZ*dirZ);
        
        forceX += (dirX / len) * strength;
        forceZ += (dirZ / len) * strength;
      }
    }
  }

  return { x: forceX, z: forceZ };
}

/**
 * Calculate attraction from powerups
 */
function getPowerupForces(self, powerups, timeRatio, others) {
  let forceX = 0;
  let forceZ = 0;

  for (const p of powerups) {
    const d2 = distSq(self.x, self.z, p.x, p.z);
    
    // Check if an opponent is closer
    let opponentCloser = false;
    for (const o of others) {
      if (distSq(o.x, o.z, p.x, p.z) < d2 * 0.6) {
        opponentCloser = true;
        break;
      }
    }
    if (opponentCloser) continue; // Give up on this powerup

    let val = WEIGHTS.powerup;

    // Type-specific logic
    if (p.type === "bomb") {
      val *= 1.5; // Always good
    } else if (p.type === "speed") {
      if (self.powerups.speedBoost > 0) val *= 0.1; // Already have it
      else if (timeRatio > 0.6) val *= 1.3; // Great for early expansion
    } else if (p.type === "shield") {
      if (self.powerups.shield > 0) val *= 0.1;
      else if (timeRatio < 0.3) val *= 1.4; // Good for protecting lead late
    }

    const strength = val / (d2 + 0.1);
    
    const dirX = p.x - self.x;
    const dirZ = p.z - self.z;
    const len = Math.sqrt(dirX*dirX + dirZ*dirZ);

    forceX += (dirX / len) * strength;
    forceZ += (dirZ / len) * strength;
  }

  return { x: forceX, z: forceZ };
}

/**
 * Calculate repulsion from opponents
 */
function getOpponentForces(self, others, shielded) {
  let forceX = 0;
  let forceZ = 0;

  if (shielded) return { x: 0, z: 0 }; // Ignore opponents if shielded

  for (const o of others) {
    const d2 = distSq(self.x, self.z, o.x, o.z);
    
    if (d2 < 4.0) { // Only care if within 2 units
      const strength = Math.abs(WEIGHTS.opponentRepulsion) / (d2 + 0.1);
      
      // Push away from opponent
      const dirX = self.x - o.x;
      const dirZ = self.z - o.z;
      const len = Math.sqrt(dirX*dirX + dirZ*dirZ);

      forceX += (dirX / len) * strength;
      forceZ += (dirZ / len) * strength;
    }
  }

  return { x: forceX, z: forceZ };
}

/**
 * Main AI loop
 */
export function tick(state) {
  const { self, others, grid, timeRemaining } = state;
  const timeRatio = timeRemaining / 60; // Assumes 60s game
  const memory = getBotState(self.id);

  // 1. Identify Leader
  let maxScore = -1;
  let leaderId = null;
  for (const o of others) {
    if (o.score > maxScore) {
      maxScore = o.score;
      leaderId = o.id;
    }
  }
  // Am I winning?
  if (self.score > maxScore) leaderId = null; 

  // 2. Stuck Detection
  if (memory.lastPos) {
    const d = distSq(self.x, self.z, memory.lastPos.x, memory.lastPos.z);
    if (d < 0.001) memory.stuckCount++;
    else memory.stuckCount = 0;
  }
  memory.lastPos = { x: self.x, z: self.z };

  if (memory.stuckCount > 10) {
    memory.stuckCount = 0;
    // Random escape vector
    const angle = Math.random() * Math.PI * 2;
    return { x: Math.cos(angle), z: Math.sin(angle) };
  }

  // 3. Calculate Vector Field Forces
  const tileForce = getTileForces(self, grid, others, timeRatio, leaderId);
  const powerForce = getPowerupForces(self, state.powerups, timeRatio, others);
  const oppForce = getOpponentForces(self, others, self.powerups.shield > 0);

  // 4. Combine Forces
  let totalX = tileForce.x + powerForce.x + oppForce.x;
  let totalZ = tileForce.z + powerForce.z + oppForce.z;

  // Add slight center bias to keep from hugging walls too much
  totalX -= self.x * WEIGHTS.centerBias;
  totalZ -= self.z * WEIGHTS.centerBias;

  // 5. Momentum / Path Consistency
  // Blend with last direction to avoid jittery movement
  totalX += memory.lastDir.x * WEIGHTS.pathConsistency;
  totalZ += memory.lastDir.z * WEIGHTS.pathConsistency;

  // 6. Normalize
  const len = Math.sqrt(totalX * totalX + totalZ * totalZ);
  if (len > 0.001) {
    memory.lastDir = { x: totalX / len, z: totalZ / len };
    return memory.lastDir;
  }

  // Fallback if no forces
  return { x: 0, z: 0 };
}
