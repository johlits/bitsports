export const id = "gemini-3-1-pro-high";
export const name = "Gemini 3.1 Pro High";

// Gemini 3.1 Pro High - Advanced Paint AI
// Uses multi-directional raycasting to evaluate the most profitable path,
// combined with precise powerup interception math and leader-targeting.

function dist(x1, z1, x2, z2) {
  const dx = x1 - x2;
  const dz = z1 - z2;
  return Math.sqrt(dx * dx + dz * dz);
}

function worldToGrid(x, z, gridWidth, gridHeight, tileSize) {
  const halfW = (gridWidth * tileSize) / 2;
  const halfH = (gridHeight * tileSize) / 2;
  const gx = Math.floor((x + halfW) / tileSize);
  const gy = Math.floor((z + halfH) / tileSize);
  return {
    gx: Math.max(0, Math.min(gridWidth - 1, gx)),
    gy: Math.max(0, Math.min(gridHeight - 1, gy))
  };
}

export function tick({ self, others, powerups, grid, gridWidth, gridHeight, tileSize, timeRemaining, dt }) {
  // 1. Identify the leader
  let leaderId = -1;
  let highestScore = -1;
  for (const p of others) {
    if (p.score > highestScore) {
      highestScore = p.score;
      leaderId = p.id;
    }
  }
  const iAmWinning = self.score >= highestScore;

  // 2. Powerup Evaluation
  // If there's a highly valuable powerup we can reach first, go for it.
  let bestPowerupTarget = null;
  let bestPowerupScore = 0;
  
  const mySpeed = 8 * (self.powerups.speedBoost > 0 ? 1.5 : 1);

  for (const p of powerups) {
    const myDist = dist(self.x, self.z, p.x, p.z);
    const myTime = myDist / mySpeed;

    // Check if an opponent can reach it faster
    let oppCanReachFirst = false;
    for (const opp of others) {
      // We don't know if they have speed boost, assume base speed for safety unless they are moving fast
      // But just use distance as a rough proxy
      const oppDist = dist(opp.x, opp.z, p.x, p.z);
      if (oppDist < myDist - 0.5) {
        oppCanReachFirst = true;
        break;
      }
    }

    if (oppCanReachFirst) continue;

    // Base value of powerup
    let pVal = 0;
    if (p.type === "bomb") pVal = 100;
    else if (p.type === "speed") pVal = 80;
    else if (p.type === "shield") pVal = self.score > 40 ? 60 : 20;

    // Score is value divided by time to reach
    const score = pVal / (1 + myTime * 2);

    if (score > bestPowerupScore && score > 15) { // Threshold to abandon painting for powerup
      bestPowerupScore = score;
      bestPowerupTarget = { x: p.x, z: p.z };
    }
  }

  // If we found a great powerup, go straight to it
  if (bestPowerupTarget) {
    const dx = bestPowerupTarget.x - self.x;
    const dz = bestPowerupTarget.z - self.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    return { x: dx / len, z: dz / len };
  }

  // 3. Raycast Path Evaluation
  // Cast rays in 32 directions to find the most profitable path
  const RAY_COUNT = 32;
  const RAY_LENGTH = 12; // units
  const STEP_SIZE = tileSize * 0.8; // Step slightly smaller than tile size to not miss any
  
  let bestDir = { x: 0, z: 0 };
  let bestRayScore = -1;

  for (let i = 0; i < RAY_COUNT; i++) {
    const angle = (i / RAY_COUNT) * Math.PI * 2;
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    
    let rayScore = 0;
    let px = self.x;
    let pz = self.z;
    
    // To avoid counting the same tile twice in a ray
    const visitedTiles = new Set();

    for (let d = 0; d < RAY_LENGTH; d += STEP_SIZE) {
      px += dirX * STEP_SIZE;
      pz += dirZ * STEP_SIZE;
      
      // Bounds check
      if (px < -10 || px > 10 || pz < -10 || pz > 10) {
        // Penalty for hitting a wall early
        rayScore -= (RAY_LENGTH - d) * 2; 
        break;
      }

      const { gx, gy } = worldToGrid(px, pz, gridWidth, gridHeight, tileSize);
      const tileKey = `${gx},${gy}`;
      
      if (!visitedTiles.has(tileKey)) {
        visitedTiles.add(tileKey);
        
        const owner = grid[gx][gy];
        let tileVal = 0;
        
        if (owner === 0) {
          tileVal = 2.0; // Unpainted is great
        } else if (owner !== self.id) {
          tileVal = 2.0; // Stealing is also great
          if (!iAmWinning && owner === leaderId) {
            tileVal = 3.5; // Stealing from leader when losing is amazing
          }
        } else {
          tileVal = -0.5; // Penalty for revisiting our own tiles (wasted time)
        }
        
        // Discount future tiles based on distance (time to reach)
        rayScore += tileVal / (1 + d * 0.15);
      }
    }

    // Add a slight bias to cardinal directions to encourage painting clean lines
    // (dot product with closest cardinal direction)
    const cardinalDot = Math.max(
      Math.abs(dirX), 
      Math.abs(dirZ)
    );
    rayScore *= (1 + cardinalDot * 0.1);

    if (rayScore > bestRayScore) {
      bestRayScore = rayScore;
      bestDir = { x: dirX, z: dirZ };
    }
  }

  // 4. Return the best direction
  // If somehow all rays are terrible (e.g., trapped in a corner surrounded by own tiles),
  // just move towards the center of the map
  if (bestRayScore <= 0) {
    const dx = 0 - self.x;
    const dz = 0 - self.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  return bestDir;
}
