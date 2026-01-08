export const id = "swe-1-5";
export const name = "SWE-1.5";

/**
 * Elite Paint Battle AI with adaptive strategy:
 * - Early game: Rapid expansion with sweep patterns
 * - Mid game: Powerup hunting + strategic stealing
 * - Late game: Aggressive leader targeting when behind
 * - Shield mode: Maximum aggression when protected
 */

// Constants matching RULES.md
const GRID_SIZE = 40;
const TILE_SIZE = 0.5;
const HALF_WORLD = 10;
const PLAYER_SPEED = 8;
const SPEED_BOOST_MULT = 1.5;

// Persistent state
let myId = null;
let lastPos = null;
let stuckCount = 0;
let sweepDir = 1;
let lastSweepY = -1;
let targetCache = null;
let targetAge = 0;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function gridToWorld(gx, gy) {
  return {
    x: gx * TILE_SIZE - HALF_WORLD + TILE_SIZE / 2,
    z: gy * TILE_SIZE - HALF_WORLD + TILE_SIZE / 2
  };
}

function dist(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

function manhattanDist(gx1, gy1, gx2, gy2) {
  return Math.abs(gx2 - gx1) + Math.abs(gy2 - gy1);
}

function normalize(dx, dz) {
  const len = Math.hypot(dx, dz);
  if (len < 0.001) return { x: 0, z: 0 };
  return { x: dx / len, z: dz / len };
}

/**
 * Infer our player ID from the grid
 */
function inferMyId(self, grid, others) {
  if (myId !== null) return;
  
  // First try current tile
  const owner = grid?.[self.gridX]?.[self.gridY];
  if (owner > 0) {
    myId = owner;
    return;
  }
  
  // Count tiles by owner, exclude known opponents
  const oppIds = new Set(others.map(o => o.id));
  const counts = new Map();
  
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      const owner = grid[x]?.[y] ?? 0;
      if (owner > 0 && !oppIds.has(owner)) {
        counts.set(owner, (counts.get(owner) || 0) + 1);
      }
    }
  }
  
  // Find owner with tile count closest to our score
  let bestId = null;
  let bestDelta = Infinity;
  for (const [id, count] of counts.entries()) {
    const delta = Math.abs(count - self.score);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestId = id;
    }
  }
  
  if (bestId !== null) myId = bestId;
}

/**
 * Evaluate powerup value based on game state
 */
function evaluatePowerup(powerup, self, others, timeRemaining) {
  const distance = dist(self.x, self.z, powerup.x, powerup.z);
  const timeRatio = timeRemaining / 60;
  const myScore = self.score;
  const maxOtherScore = others.length > 0 ? Math.max(...others.map(o => o.score)) : 0;
  const leading = myScore > maxOtherScore;
  const behind = maxOtherScore > myScore * 1.15;
  const shielded = self.powerups?.shield > 0;
  const speedBoost = self.powerups?.speedBoost > 0;

  let value = 0;

  switch (powerup.type) {
    case "bomb":
      // 9 tiles instantly - extremely valuable
      value = 14;
      if (timeRatio < 0.25) value *= 1.4; // Late game bonus
      if (behind) value *= 1.3; // Need to catch up
      if (shielded) value *= 1.1; // Shielded = can be aggressive
      break;

    case "speed":
      // 1.5x speed for 3 seconds
      value = 10;
      if (timeRatio > 0.6) value *= 1.3; // Early game = more tiles
      if (speedBoost) value *= 0.2; // Already boosted
      break;

    case "shield":
      // 5 seconds of protection
      value = 6;
      if (leading && myScore > 100) value *= 2.0;
      if (self.powerups?.shield > 2) value *= 0.15;
      break;
  }

  // Distance penalty
  const distPenalty = Math.min(distance / 16, 0.7);
  value *= (1 - distPenalty);

  // Check if opponent is closer
  for (const o of others) {
    const oppDist = dist(o.x, o.z, powerup.x, powerup.z);
    if (oppDist < distance * 0.7) {
      value *= 0.4; // They'll probably get it
      break;
    }
  }

  return value;
}

/**
 * Count paintable tiles in a region
 */
function countPaintableTiles(grid, gx, gy, radius, myId, targetId) {
  let count = 0;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE) {
        const owner = grid[nx][ny];
        if (targetId !== null) {
          if (owner === targetId) count++;
        } else if (owner === 0 || (owner !== myId && owner !== 0)) {
          count++;
        }
      }
    }
  }
  return count;
}

/**
 * Find best tile to paint
 */
function findBestTarget(self, grid, others, timeRemaining, myId) {
  const selfGX = self.gridX;
  const selfGY = self.gridY;
  const myScore = self.score;

  // Determine strategy
  const scores = others.map(o => ({ id: o.id, score: o.score }));
  scores.sort((a, b) => b.score - a.score);
  const leaderId = scores.length > 0 ? scores[0].id : null;
  const leaderScore = scores.length > 0 ? scores[0].score : 0;

  // Target enemy tiles if significantly behind
  const behind = leaderScore > myScore * 1.2;
  const lateGame = timeRemaining < 20;
  const targetEnemy = behind && lateGame && leaderId !== null;
  
  // When shielded, be more aggressive
  const shielded = self.powerups?.shield > 0;
  const aggressiveSteal = shielded || (behind && timeRemaining < 35);

  let bestTile = null;
  let bestScore = -Infinity;

  // Search in expanding rings
  const maxRadius = 25;

  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        // Perimeter only for efficiency
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

        const gx = selfGX + dx;
        const gy = selfGY + dy;
        if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) continue;

        const owner = grid[gx][gy];

        // Determine if this is a valid target
        let isTarget = false;
        let tileValue = 1;

        if (owner === 0) {
          isTarget = true;
          tileValue = 1.2; // Unpainted slightly preferred
        } else if (owner !== myId) {
          if (targetEnemy && owner === leaderId) {
            isTarget = true;
            tileValue = 1.5; // Leader tiles are valuable
          } else if (aggressiveSteal) {
            isTarget = true;
            tileValue = 1.0;
          }
        }

        if (!isTarget) continue;

        // Score this tile
        let score = 100 - radius * 3;
        score *= tileValue;

        // Cluster bonus
        const cluster = countPaintableTiles(grid, gx, gy, 2, myId, targetEnemy ? leaderId : null);
        score += cluster * 3;

        // Avoid opponents (unless shielded)
        if (!shielded) {
          for (const o of others) {
            const ogx = Math.floor((o.x + HALF_WORLD) / TILE_SIZE);
            const ogy = Math.floor((o.z + HALF_WORLD) / TILE_SIZE);
            const d = manhattanDist(gx, gy, ogx, ogy);
            if (d < 4) score -= (4 - d) * 5;
          }
        }

        // Sweep pattern bonus
        if (lastSweepY >= 0) {
          const sameRow = (gy === lastSweepY);
          const nextRow = (gy === lastSweepY + sweepDir);
          if (sameRow) score += 8;
          if (nextRow) score += 5;
        }

        if (score > bestScore) {
          bestScore = score;
          bestTile = { gx, gy };
        }
      }
    }

    // Early exit if we found good tiles nearby
    if (bestTile && radius >= 3 && bestScore > 60) break;
  }

  return bestTile;
}

/**
 * Find nearest tile owned by a specific player
 */
function findNearestEnemyTile(selfGX, selfGY, grid, targetId) {
  for (let radius = 1; radius < GRID_SIZE; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        const gx = selfGX + dx;
        const gy = selfGY + dy;
        if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
          if (grid[gx][gy] === targetId) {
            return { gx, gy };
          }
        }
      }
    }
  }
  return null;
}

/**
 * Main AI tick
 */
export function tick(state) {
  const { self, others, powerups, grid, timeRemaining, dt } = state;

  // Use provided grid coordinates
  const selfGX = self.gridX;
  const selfGY = self.gridY;

  // Infer our ID
  inferMyId(self, grid, others);

  // Stuck detection
  if (lastPos) {
    const moved = dist(self.x, self.z, lastPos.x, lastPos.z);
    if (moved < 0.03) {
      stuckCount++;
    } else {
      stuckCount = 0;
    }
  }
  lastPos = { x: self.x, z: self.z };

  // Escape if stuck
  if (stuckCount > 15) {
    stuckCount = 0;
    sweepDir *= -1;
    const angle = Math.random() * Math.PI * 2;
    return { x: Math.cos(angle), z: Math.sin(angle) };
  }

  // === PRIORITY 1: High-value powerups ===
  if (powerups.length > 0) {
    let bestPowerup = null;
    let bestValue = 0;

    for (const p of powerups) {
      const value = evaluatePowerup(p, self, others, timeRemaining);
      const distance = dist(self.x, self.z, p.x, p.z);

      // Dynamic threshold
      const threshold = distance < 1.5 ? 3 : (distance < 4 ? 5 : 7);

      if (value > bestValue && value > threshold) {
        bestValue = value;
        bestPowerup = p;
      }
    }

    if (bestPowerup) {
      targetCache = null;
      return normalize(bestPowerup.x - self.x, bestPowerup.z - self.z);
    }
  }

  // === PRIORITY 2: Strategic painting ===
  targetAge += dt;
  const refreshInterval = self.powerups?.speedBoost > 0 ? 0.85 : 1.25;
  
  if (!targetCache || targetAge > refreshInterval) {
    const target = findBestTarget(self, grid, others, timeRemaining, myId);
    if (target) {
      targetCache = target;
      targetAge = 0;
    }
  }

  if (targetCache) {
    lastSweepY = targetCache.gy;
    const world = gridToWorld(targetCache.gx, targetCache.gy);
    const dx = world.x - self.x;
    const dz = world.z - self.z;
    const len = Math.hypot(dx, dz);

    // Look-ahead for smooth movement
    if (len < 0.25) {
      // Continue in sweep direction
      const nextGX = targetCache.gx + sweepDir;
      const nextGY = targetCache.gy;
      if (nextGX >= 0 && nextGX < GRID_SIZE) {
        if (grid[nextGX][nextGY] === 0 || grid[nextGX][nextGY] !== myId) {
          const next = gridToWorld(nextGX, nextGY);
          return normalize(next.x - self.x, next.z - self.z);
        } else {
          // Row done, move to next row
          sweepDir *= -1;
          const newY = targetCache.gy + 1;
          if (newY < GRID_SIZE) {
            const next = gridToWorld(targetCache.gx, newY);
            return normalize(next.x - self.x, next.z - self.z);
          }
        }
      }
    }

    return normalize(dx, dz);
  }

  // === PRIORITY 3: Steal from leader ===
  const scores = others.map(o => ({ id: o.id, score: o.score }));
  scores.sort((a, b) => b.score - a.score);

  if (scores.length > 0 && scores[0].score > 0) {
    const enemyTile = findNearestEnemyTile(selfGX, selfGY, grid, scores[0].id);
    if (enemyTile) {
      const world = gridToWorld(enemyTile.gx, enemyTile.gy);
      return normalize(world.x - self.x, world.z - self.z);
    }
  }

  // === FALLBACK: Move toward center ===
  const centerDist = dist(self.x, self.z, 0, 0);
  if (centerDist > 3) {
    return normalize(-self.x, -self.z);
  }

  // Random
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}
