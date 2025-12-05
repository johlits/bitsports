export const id = "claude-opus-4.5";
export const name = "Claude Opus 4.5";

/**
 * Advanced Paint Battle AI with multi-phase strategy:
 * 1. Early game: Efficient territory expansion using flood-fill patterns
 * 2. Mid game: Adaptive powerup hunting + strategic painting
 * 3. Late game: Aggressive tile stealing from leaders if behind
 * 
 * Key optimizations:
 * - Efficient path planning to minimize backtracking
 * - Dynamic powerup valuation based on game state
 * - Opponent position prediction and avoidance
 * - Time-aware strategy switching
 */

// Persistent state across ticks
let myId = null;
let lastPosition = null;
let stuckCounter = 0;
let currentPath = [];
let lastPathUpdate = 0;

// Constants
const GRID_SIZE = 40;
const TILE_SIZE = 0.5;
const HALF_WORLD = 10;

// Helper: World to grid coordinates
function worldToGrid(x, z) {
  return {
    gx: Math.floor((x + HALF_WORLD) / TILE_SIZE),
    gy: Math.floor((z + HALF_WORLD) / TILE_SIZE)
  };
}

// Helper: Grid to world coordinates (tile center)
function gridToWorld(gx, gy) {
  return {
    x: gx * TILE_SIZE - HALF_WORLD + TILE_SIZE / 2,
    z: gy * TILE_SIZE - HALF_WORLD + TILE_SIZE / 2
  };
}

// Helper: Distance between two points
function dist(x1, z1, x2, z2) {
  return Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
}

// Helper: Manhattan distance for grid
function manhattanDist(gx1, gy1, gx2, gy2) {
  return Math.abs(gx2 - gx1) + Math.abs(gy2 - gy1);
}

// Evaluate powerup value based on game state
function evaluatePowerup(powerup, self, others, timeRemaining, totalTime) {
  const distance = dist(self.x, self.z, powerup.x, powerup.z);
  const timeRatio = timeRemaining / totalTime;
  
  let baseValue = 0;
  
  switch (powerup.type) {
    case "bomb":
      // Bombs are worth 9 tiles instantly - very valuable
      baseValue = 9;
      // Even more valuable in crowded areas or late game
      if (timeRatio < 0.3) baseValue *= 1.5;
      break;
    case "speed":
      // Speed helps cover more ground - valuable early/mid game
      baseValue = 6;
      if (timeRatio > 0.5) baseValue *= 1.3;
      if (self.powerups.speedBoost > 0) baseValue *= 0.3; // Already have speed
      break;
    case "shield":
      // Shield protects territory - valuable when leading
      baseValue = 4;
      const myScore = self.score;
      const maxOtherScore = Math.max(...others.map(o => o.score), 0);
      if (myScore > maxOtherScore) baseValue *= 1.5; // We're leading
      if (self.powerups.shield > 0) baseValue *= 0.2; // Already have shield
      break;
  }
  
  // Discount by distance (closer = better)
  // At distance 0, full value. At distance 10, half value.
  const distancePenalty = distance / 20;
  return baseValue * (1 - distancePenalty);
}

// Find clusters of unpainted/enemy tiles for efficient painting
function findBestPaintingTarget(self, grid, others, timeRemaining) {
  const { gx: selfGX, gy: selfGY } = worldToGrid(self.x, self.z);
  
  // Determine if we should target unpainted or enemy tiles
  const myScore = self.score;
  const scores = others.map(o => ({ id: o.id, score: o.score }));
  scores.sort((a, b) => b.score - a.score);
  const leaderId = scores.length > 0 ? scores[0].id : null;
  const leaderScore = scores.length > 0 ? scores[0].score : 0;
  
  // If we're significantly behind the leader, target their tiles
  const targetEnemyTiles = leaderScore > myScore * 1.2 && timeRemaining < 30;
  const targetId = targetEnemyTiles ? leaderId : 0;
  
  // Use a scoring system for tiles based on:
  // 1. Distance from current position
  // 2. Density of target tiles nearby (cluster bonus)
  // 3. Distance from opponents (avoid contested areas)
  
  let bestTile = null;
  let bestScore = -Infinity;
  
  // Sample tiles in expanding rings for efficiency
  const maxRadius = Math.min(20, GRID_SIZE);
  
  for (let radius = 1; radius <= maxRadius; radius++) {
    let foundInRing = false;
    
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        // Only check perimeter of ring for efficiency
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        
        const gx = selfGX + dx;
        const gy = selfGY + dy;
        
        if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) continue;
        
        const tileOwner = grid[gx][gy];
        
        // Check if this is a target tile
        if (targetEnemyTiles) {
          if (tileOwner !== targetId) continue;
        } else {
          if (tileOwner !== 0) continue; // Only unpainted
        }
        
        // Calculate tile score
        let tileScore = 100 - radius * 2; // Base score decreases with distance
        
        // Cluster bonus: count nearby target tiles
        let clusterBonus = 0;
        for (let cx = -2; cx <= 2; cx++) {
          for (let cy = -2; cy <= 2; cy++) {
            const nx = gx + cx;
            const ny = gy + cy;
            if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
              if (targetEnemyTiles) {
                if (grid[nx][ny] === targetId) clusterBonus += 2;
              } else {
                if (grid[nx][ny] === 0) clusterBonus += 2;
              }
            }
          }
        }
        tileScore += clusterBonus;
        
        // Opponent avoidance: penalize tiles near opponents
        for (const other of others) {
          const otherGrid = worldToGrid(other.x, other.z);
          const distToOther = manhattanDist(gx, gy, otherGrid.gx, otherGrid.gy);
          if (distToOther < 5) {
            tileScore -= (5 - distToOther) * 3;
          }
        }
        
        if (tileScore > bestScore) {
          bestScore = tileScore;
          bestTile = { gx, gy };
          foundInRing = true;
        }
      }
    }
    
    // If we found good tiles in this ring and they're close enough, use them
    if (foundInRing && radius <= 5) break;
  }
  
  return bestTile;
}

// Generate efficient path using simple line-sweep pattern
function generateSweepPath(startGX, startGY, grid, targetId = 0) {
  const path = [];
  const visited = new Set();
  
  // Determine sweep direction based on position
  const sweepRight = startGX < GRID_SIZE / 2;
  const sweepDown = startGY < GRID_SIZE / 2;
  
  let gx = startGX;
  let gy = startGY;
  
  // Generate a snake-like path
  for (let i = 0; i < 50; i++) {
    // Move horizontally
    const hDir = sweepRight ? 1 : -1;
    for (let j = 0; j < 5; j++) {
      const nextGX = gx + hDir;
      if (nextGX >= 0 && nextGX < GRID_SIZE) {
        const key = `${nextGX},${gy}`;
        if (!visited.has(key) && grid[nextGX][gy] === targetId) {
          path.push({ gx: nextGX, gy });
          visited.add(key);
          gx = nextGX;
        }
      }
    }
    
    // Move vertically
    const vDir = sweepDown ? 1 : -1;
    const nextGY = gy + vDir;
    if (nextGY >= 0 && nextGY < GRID_SIZE) {
      gy = nextGY;
    } else {
      break;
    }
  }
  
  return path;
}

// Main AI tick function
export function tick(state) {
  const { self, others, powerups, grid, timeRemaining, dt } = state;
  
  // Initialize persistent state
  if (myId === null) {
    // Infer our ID from the grid or position
    const { gx, gy } = worldToGrid(self.x, self.z);
    if (grid[gx] && grid[gx][gy] > 0) {
      myId = grid[gx][gy];
    }
  }
  
  // Detect if stuck
  if (lastPosition) {
    const moved = dist(self.x, self.z, lastPosition.x, lastPosition.z);
    if (moved < 0.05) {
      stuckCounter++;
    } else {
      stuckCounter = 0;
    }
  }
  lastPosition = { x: self.x, z: self.z };
  
  // If stuck, add randomness to escape
  if (stuckCounter > 10) {
    stuckCounter = 0;
    currentPath = [];
    const angle = Math.random() * Math.PI * 2;
    return { x: Math.cos(angle), z: Math.sin(angle) };
  }
  
  const totalTime = 60; // Assume 60s match
  const timeRatio = timeRemaining / totalTime;
  
  // === PRIORITY 1: High-value powerups ===
  if (powerups.length > 0) {
    let bestPowerup = null;
    let bestValue = 0;
    
    for (const p of powerups) {
      const value = evaluatePowerup(p, self, others, timeRemaining, totalTime);
      
      // Only go for powerups if value is high enough
      // Threshold decreases as powerup gets closer
      const distance = dist(self.x, self.z, p.x, p.z);
      const threshold = distance < 2 ? 2 : (distance < 5 ? 4 : 6);
      
      if (value > bestValue && value > threshold) {
        bestValue = value;
        bestPowerup = p;
      }
    }
    
    if (bestPowerup) {
      const dx = bestPowerup.x - self.x;
      const dz = bestPowerup.z - self.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      return { x: dx / len, z: dz / len };
    }
  }
  
  // === PRIORITY 2: Strategic tile painting ===
  const targetTile = findBestPaintingTarget(self, grid, others, timeRemaining);
  
  if (targetTile) {
    const worldPos = gridToWorld(targetTile.gx, targetTile.gy);
    const dx = worldPos.x - self.x;
    const dz = worldPos.z - self.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    
    // If very close, look ahead to next tile for smoother movement
    if (len < 0.3) {
      // Find next unpainted tile in current direction
      const dirX = dx / len || 0;
      const dirZ = dz / len || 0;
      
      const nextGX = targetTile.gx + Math.sign(dirX);
      const nextGY = targetTile.gy + Math.sign(dirZ);
      
      if (nextGX >= 0 && nextGX < GRID_SIZE && nextGY >= 0 && nextGY < GRID_SIZE) {
        if (grid[nextGX][nextGY] === 0) {
          const nextWorld = gridToWorld(nextGX, nextGY);
          const ndx = nextWorld.x - self.x;
          const ndz = nextWorld.z - self.z;
          const nlen = Math.sqrt(ndx * ndx + ndz * ndz) || 1;
          return { x: ndx / nlen, z: ndz / nlen };
        }
      }
    }
    
    return { x: dx / len, z: dz / len };
  }
  
  // === PRIORITY 3: If all tiles painted, steal from leader ===
  const scores = others.map(o => ({ id: o.id, score: o.score, x: o.x, z: o.z }));
  scores.sort((a, b) => b.score - a.score);
  
  if (scores.length > 0 && scores[0].score > 0) {
    const leader = scores[0];
    
    // Find nearest tile owned by leader
    const { gx: selfGX, gy: selfGY } = worldToGrid(self.x, self.z);
    
    for (let radius = 1; radius < GRID_SIZE; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
          
          const gx = selfGX + dx;
          const gy = selfGY + dy;
          
          if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
            if (grid[gx][gy] === leader.id) {
              const worldPos = gridToWorld(gx, gy);
              const ddx = worldPos.x - self.x;
              const ddz = worldPos.z - self.z;
              const len = Math.sqrt(ddx * ddx + ddz * ddz) || 1;
              return { x: ddx / len, z: ddz / len };
            }
          }
        }
      }
    }
  }
  
  // === FALLBACK: Move toward center or random ===
  const centerDist = dist(self.x, self.z, 0, 0);
  if (centerDist > 5) {
    const dx = -self.x;
    const dz = -self.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    return { x: dx / len, z: dz / len };
  }
  
  // Random movement
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}
