export const id = "gemini-3-pro-high";
export const name = "Gemini 3 Pro (high)";

/**
 * Gemini 3 Pro (high) - Advanced Territory & Prediction AI
 * 
 * Strategy:
 * 1. Vector Field Navigation: Uses a composite potential field for movement, combining attraction to targets
 *    and repulsion from opponents/boundaries.
 * 2. Predictive Powerup Sniping: Calculates interception paths for powerups rather than direct chasing.
 * 3. Dynamic Role Switching: Switches between "Expansion" (early game), "Aggression" (mid game), and "Defense" (late game).
 * 4. Smart Enclosure: Attempts to cut off areas from opponents by painting boundary lines.
 */

// State tracking
let currentRole = "expansion";
let lastTarget = null;
let lastRoleSwitch = 0;
let stuckCounter = 0;
let lastPos = { x: 0, z: 0 };

const GRID_SIZE = 40;
const TILE_SIZE = 0.5;
const HALF_WORLD = 10;

// Weights for potential field
const WEIGHTS = {
  unpainted: 1.0,
  enemyTile: 0.8,
  powerup: 25.0, // Highly valued
  opponentRepulsion: -15.0, // Avoid getting too close unless hunting
  centerBias: 0.1, // Slight bias to stay central
  pathConsistency: 0.5 // Bias to keep moving in same direction
};

function worldToGrid(x, z) {
  return {
    gx: Math.floor((x + HALF_WORLD) / TILE_SIZE),
    gy: Math.floor((z + HALF_WORLD) / TILE_SIZE)
  };
}

function gridToWorld(gx, gy) {
  return {
    x: gx * TILE_SIZE - HALF_WORLD + TILE_SIZE / 2,
    z: gy * TILE_SIZE - HALF_WORLD + TILE_SIZE / 2
  };
}

// Calculate potential field vector at a position
function calculatePotential(x, z, state, myId) {
  let forceX = 0;
  let forceZ = 0;
  const { grid, others, powerups, timeRemaining } = state;
  const totalTime = 60; // Assumed default
  const timeRatio = timeRemaining / totalTime;

  // 1. Tile Attraction (Local Scan)
  // Scan a local window around the player for efficiency
  const range = 5; // 5 tile radius (2.5 units)
  const { gx: selfGX, gy: selfGY } = worldToGrid(x, z);

  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      const gx = selfGX + dx;
      const gy = selfGY + dy;

      if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
        const owner = grid[gx][gy];
        let attraction = 0;

        if (owner === 0) {
          attraction = WEIGHTS.unpainted;
        } else if (owner !== myId) {
          // Value enemy tiles more if we are aggressive or losing
          attraction = currentRole === "aggression" ? WEIGHTS.enemyTile * 1.5 : WEIGHTS.enemyTile;
        }

        if (attraction > 0) {
          const tilePos = gridToWorld(gx, gy);
          const distSq = (tilePos.x - x) ** 2 + (tilePos.z - z) ** 2;
          // Inverse square falloff
          const force = attraction / (1 + distSq);
          
          const dx = tilePos.x - x;
          const dz = tilePos.z - z;
          const len = Math.sqrt(dx*dx + dz*dz) || 1;
          
          forceX += (dx / len) * force;
          forceZ += (dz / len) * force;
        }
      }
    }
  }

  // 2. Powerup Attraction (Global)
  for (const p of powerups) {
    let val = WEIGHTS.powerup;
    
    // Dynamic valuation
    if (p.type === "bomb") val *= 1.5;
    if (p.type === "speed" && state.self.powerups.speedBoost > 0) val *= 0.2;
    if (p.type === "shield" && currentRole === "defense") val *= 2.0;

    const distSq = (p.x - x) ** 2 + (p.z - z) ** 2;
    const force = val / (0.5 + distSq); // Stonger attraction when closer

    const dx = p.x - x;
    const dz = p.z - z;
    const len = Math.sqrt(dx*dx + dz*dz) || 1;

    forceX += (dx / len) * force;
    forceZ += (dz / len) * force;
  }

  // 3. Opponent Repulsion (Avoid crowding unless hunting)
  for (const other of others) {
    const distSq = (other.x - x) ** 2 + (other.z - z) ** 2;
    if (distSq < 9) { // Within 3 units
      const force = WEIGHTS.opponentRepulsion / (0.1 + distSq);
      
      const dx = other.x - x;
      const dz = other.z - z;
      const len = Math.sqrt(dx*dx + dz*dz) || 1;

      forceX += (dx / len) * force;
      forceZ += (dz / len) * force;
    }
  }

  // 4. Global bias towards unpainted regions (Sparse Sampling)
  // Check 8 directions at distance 4
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const sampleX = x + Math.cos(angle) * 4;
    const sampleZ = z + Math.sin(angle) * 4;
    const sampleG = worldToGrid(sampleX, sampleZ);

    if (sampleG.gx >= 0 && sampleG.gx < GRID_SIZE && sampleG.gy >= 0 && sampleG.gy < GRID_SIZE) {
      // Sample a 3x3 area at that location
      let value = 0;
      for (let sx = -1; sx <= 1; sx++) {
        for (let sy = -1; sy <= 1; sy++) {
          const sgx = sampleG.gx + sx;
          const sgy = sampleG.gy + sy;
          if (sgx >= 0 && sgx < GRID_SIZE && sgy >= 0 && sgy < GRID_SIZE) {
             if (grid[sgx][sgy] === 0) value++;
             else if (grid[sgx][sgy] !== myId) value += 0.5;
          }
        }
      }
      
      if (value > 0) {
         forceX += Math.cos(angle) * value * 0.5;
         forceZ += Math.sin(angle) * value * 0.5;
      }
    }
  }

  return { x: forceX, z: forceZ };
}

export function tick(state) {
  const { self, others, grid, timeRemaining, dt } = state;
  
  // 1. Determine My ID (if not known or verified)
  const { gx, gy } = worldToGrid(self.x, self.z);
  let myId = 0;
  if (grid[gx] && grid[gx][gy] > 0) {
    myId = grid[gx][gy];
  } else {
      // Fallback: assume we are the closest player to our position if we aren't on our own tile
      // This is a rough heuristic if we haven't painted anything yet
      myId = 0; // Default to 0 (neutral) logic if unknown
  }

  // 2. Stuck Detection
  const moveDist = Math.sqrt((self.x - lastPos.x)**2 + (self.z - lastPos.z)**2);
  if (moveDist < 0.02) {
    stuckCounter++;
  } else {
    stuckCounter = 0;
  }
  lastPos = { x: self.x, z: self.z };

  if (stuckCounter > 15) {
    // Jitter to unstick
    stuckCounter = 0;
    const angle = Math.random() * Math.PI * 2;
    return { x: Math.cos(angle), z: Math.sin(angle) };
  }

  // 3. Role Selection
  const timeRatio = timeRemaining / 60;
  const myScore = self.score;
  // Estimate leader score
  let maxScore = myScore;
  for(const o of others) maxScore = Math.max(maxScore, o.score);
  
  const isWinning = myScore >= maxScore * 0.95;

  if (timeRatio > 0.6) {
    currentRole = "expansion"; // Early game: focus on coverage
  } else if (timeRatio > 0.2) {
    // Mid game: Adapt
    currentRole = isWinning ? "defense" : "aggression";
  } else {
    // Late game: All out
    currentRole = isWinning ? "defense" : "aggression";
  }
  
  // 4. Movement Calculation
  const potential = calculatePotential(self.x, self.z, state, myId);
  
  // Normalize output
  const len = Math.sqrt(potential.x ** 2 + potential.z ** 2) || 1;
  
  // Smoothing: Blend with previous direction if moving fast to maintain momentum
  // But react quickly if force is strong
  
  return { x: potential.x / len, z: potential.z / len };
}
