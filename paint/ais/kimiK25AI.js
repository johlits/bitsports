export const id = "kimi-k2-5";
export const name = "Kimi K2.5";

/**
 * Elite Paint Battle AI with adaptive multi-phase strategy
 * - Early game: Rapid territory expansion with efficient pathing
 * - Mid game: Powerup optimization + cluster-based painting
 * - Late game: Aggressive tile stealing when behind, defensive consolidation when leading
 */

const GRID_SIZE = 40;
const TILE_SIZE = 0.5;
const HALF_WORLD = 10;
const PLAYER_SPEED = 8;

// Persistent state per bot instance
const botStates = new Map();

function createBotState() {
  return {
    target: null,
    targetAge: 0,
    lastPos: null,
    stuckCount: 0,
    heading: { x: 1, z: 0 },
    lastDir: { x: 0, z: 0 },
    initialTime: null,
    lastTimeRemaining: null,
    visitedTiles: new Set(), // Track recently visited to avoid loops
  };
}

function getBotState(id) {
  const key = id ?? "anon";
  if (!botStates.has(key)) {
    botStates.set(key, createBotState());
  }
  return botStates.get(key);
}

function resetBotState(state) {
  state.target = null;
  state.targetAge = 0;
  state.lastPos = null;
  state.stuckCount = 0;
  state.heading = { x: 1, z: 0 };
  state.lastDir = { x: 0, z: 0 };
  state.visitedTiles.clear();
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function dist(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

function manhattanDist(x1, y1, x2, y2) {
  return Math.abs(x2 - x1) + Math.abs(y2 - y1);
}

function normalize(x, z) {
  const len = Math.hypot(x, z);
  if (len < 0.001) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
}

function worldToGrid(x, z) {
  return {
    gx: clamp(Math.floor((x + HALF_WORLD) / TILE_SIZE), 0, GRID_SIZE - 1),
    gy: clamp(Math.floor((z + HALF_WORLD) / TILE_SIZE), 0, GRID_SIZE - 1),
  };
}

function gridToWorld(gx, gy) {
  return {
    x: gx * TILE_SIZE - HALF_WORLD + TILE_SIZE / 2,
    z: gy * TILE_SIZE - HALF_WORLD + TILE_SIZE / 2,
  };
}

function inferMyId(self, grid, others) {
  if (typeof self.id === "number") return self.id;
  if (!grid) return null;

  const owner = grid?.[self.gridX]?.[self.gridY];
  if (owner > 0) return owner;

  const oppIds = new Set((others || []).map((o) => o.id).filter((id) => typeof id === "number"));
  const counts = new Map();
  for (let x = 0; x < grid.length; x++) {
    for (let y = 0; y < grid[x].length; y++) {
      const val = grid[x][y] ?? 0;
      if (val > 0 && !oppIds.has(val)) {
        counts.set(val, (counts.get(val) || 0) + 1);
      }
    }
  }

  const selfScore = self.score || 0;
  let bestId = null;
  let bestDelta = Infinity;
  for (const [id, count] of counts.entries()) {
    const delta = Math.abs(count - selfScore);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestId = id;
    }
  }

  return bestId;
}

function computeLeader(self, others, myId) {
  let leaderId = myId ?? null;
  let leaderScore = self.score || 0;
  for (const o of others || []) {
    if ((o.score || 0) > leaderScore) {
      leaderScore = o.score || 0;
      leaderId = o.id;
    }
  }
  return { leaderId, leaderScore };
}

/**
 * Count paintable tiles in a radius (for cluster scoring)
 */
function countPaintableCluster(grid, gx, gy, radius, myId) {
  if (!grid || !Array.isArray(grid) || grid.length === 0) return 0;
  let count = 0;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx >= 0 && nx < GRID_SIZE && ny >= 0 && ny < GRID_SIZE && grid[nx]) {
        const owner = grid[nx][ny];
        if (owner !== myId) count++;
      }
    }
  }
  return count;
}

/**
 * Evaluate powerup value based on game state
 */
function evaluatePowerup(p, self, others, timeRemaining, ratio, isLeading, behindBy, shielded, speedBoost) {
  const distance = dist(self.x, self.z, p.x, p.z);
  
  let value = 0;
  
  switch (p.type) {
    case "bomb":
      // Instant 9 tiles - most valuable
      const gp = worldToGrid(p.x, p.z);
      const paintableNearby = countPaintableCluster(self.grid?.grid ?? [], gp.gx, gp.gy, 1, null);
      value = 12 + paintableNearby * 1.5;
      if (ratio < 0.3) value *= 1.5; // Late game desperation
      if (behindBy > 8) value *= 1.4;
      break;
      
    case "speed":
      // Speed boost = more tiles covered
      value = ratio > 0.5 ? 9 : ratio > 0.25 ? 6 : 4;
      if (speedBoost) value *= 0.2; // Diminishing returns
      break;
      
    case "shield":
      // Shield valuable when leading or late game
      value = isLeading ? 8 : 4;
      if (ratio < 0.2 && isLeading) value *= 1.5;
      if (shielded) value *= 0.15;
      break;
  }
  
  // Distance penalty - closer is better
  const distFactor = 1 / (1 + distance * 0.6);
  value *= distFactor;
  
  // Check if opponent is closer
  for (const o of others) {
    const oppDist = dist(o.x, o.z, p.x, p.z);
    if (oppDist < distance * 0.75) {
      value *= 0.4; // They'll probably get it first
      break;
    }
  }
  
  return value;
}

/**
 * Score a tile for targeting
 */
function scoreTile(gx, gy, grid, selfGX, selfGY, myId, meta) {
  const owner = grid[gx][gy];
  
  // Skip own tiles
  if (owner === myId) return -Infinity;
  
  let score = 0;
  
  // Base value
  if (owner === 0) {
    score = 1.3; // Unpainted slightly preferred
    if (meta.ratio > 0.5) score += 0.3; // Early game priority
  } else {
    score = 1.0;
    // Steal from leader when behind
    if (meta.preferStealLeader && owner === meta.leaderId) {
      score = 2.8;
    } else if (meta.behindBy > 5 && meta.ratio < 0.4) {
      score = 1.4;
    }
  }
  
  // Distance penalty (Manhattan for grid efficiency)
  const manhattan = manhattanDist(gx, gy, selfGX, selfGY);
  let distPenalty = manhattan * (meta.speedBoost ? 0.07 : 0.1);
  if (meta.ratio < 0.3) distPenalty *= 0.8; // Late game, travel less
  
  // Cluster bonus - prefer areas with many paintable tiles
  const cluster = countPaintableCluster(grid, gx, gy, 2, myId);
  const clusterBonus = cluster * 0.06;
  
  // Direction alignment - prefer continuing current heading
  const dx = gx - selfGX;
  const dy = gy - selfGY;
  const len = Math.hypot(dx, dy) || 1;
  const headingLen = Math.hypot(meta.heading.x, meta.heading.z) || 1;
  const align = ((dx / len) * (meta.heading.x / headingLen) + (dy / len) * (meta.heading.z / headingLen)) * 0.4;
  
  // Risk penalty - avoid opponents unless shielded
  let risk = 0;
  if (!meta.shielded && meta.others) {
    for (const o of meta.others) {
      const og = worldToGrid(o.x, o.z);
      const od = manhattanDist(gx, gy, og.gx, og.gy);
      if (od < 4) risk += (4 - od) * 0.8;
    }
  }
  
  return score + clusterBonus + align - distPenalty - risk;
}

/**
 * Find best target tile using efficient search
 */
function findBestTarget(self, grid, others, timeRemaining, myId, heading, ratio) {
  const selfGX = self.gridX;
  const selfGY = self.gridY;
  
  // Compute game meta
  const { leaderId, leaderScore } = computeLeader(self, others, myId);
  const myScore = self.score || 0;
  const isLeading = myScore >= leaderScore - 0.5;
  const behindBy = Math.max(0, leaderScore - myScore);
  const shielded = (self.powerups?.shield || 0) > 1;
  const speedBoost = (self.powerups?.speedBoost || 0) > 1;
  const preferStealLeader = !isLeading && ratio < 0.45 && behindBy > 5;
  
  const meta = {
    leaderId,
    isLeading,
    behindBy,
    shielded,
    speedBoost,
    preferStealLeader,
    heading,
    others,
    ratio,
  };
  
  let bestTile = null;
  let bestScore = -Infinity;
  
  // Search in expanding rings (perimeter only for efficiency)
  const maxRadius = Math.min(25, Math.floor(GRID_SIZE / 2));
  
  for (let radius = 1; radius <= maxRadius; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        // Only check perimeter tiles
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;
        
        const gx = selfGX + dx;
        const gy = selfGY + dy;
        if (gx < 0 || gx >= GRID_SIZE || gy < 0 || gy >= GRID_SIZE) continue;
        
        const tileScore = scoreTile(gx, gy, grid, selfGX, selfGY, myId, meta);
        if (tileScore > bestScore) {
          bestScore = tileScore;
          bestTile = { gx, gy };
        }
      }
    }
    
    // Early exit if we found a good tile nearby
    if (bestTile && radius >= 4 && bestScore > 2) break;
  }
  
  return bestTile;
}

/**
 * Find nearest tile owned by specific player (for stealing)
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

export function tick(state) {
  const { self, others = [], powerups = [], grid, timeRemaining = 60, dt = 0.016 } = state;
  
  const myId = inferMyId(self, grid, others);
  const bot = getBotState(myId ?? self.id);
  
  // Detect game reset
  if (bot.lastTimeRemaining != null && timeRemaining > bot.lastTimeRemaining + 0.5) {
    resetBotState(bot);
  }
  bot.lastTimeRemaining = timeRemaining;
  
  // Set initial time
  if (bot.initialTime == null || timeRemaining > bot.initialTime + 0.5) {
    bot.initialTime = timeRemaining || 60;
  }
  
  // Stuck detection
  if (bot.lastPos) {
    const moved = dist(self.x, self.z, bot.lastPos.x, bot.lastPos.z);
    if (moved < 0.03) {
      bot.stuckCount++;
    } else {
      bot.stuckCount = 0;
      // Update heading based on actual movement
      if (moved > 0.01) {
        bot.heading = { x: self.x - bot.lastPos.x, z: self.z - bot.lastPos.z };
      }
    }
  }
  bot.lastPos = { x: self.x, z: self.z };
  
  // Escape if stuck
  if (bot.stuckCount > 10) {
    bot.stuckCount = 0;
    bot.target = null;
    const angle = Math.random() * Math.PI * 2;
    return { x: Math.cos(angle), z: Math.sin(angle) };
  }
  
  const totalTime = bot.initialTime || 60;
  const ratio = totalTime > 0 ? timeRemaining / totalTime : 1;
  
  // === PRIORITY 1: Powerups ===
  if (powerups.length > 0) {
    const { leaderId, leaderScore } = computeLeader(self, others, myId);
    const myScore = self.score || 0;
    const isLeading = myScore >= leaderScore - 0.5;
    const behindBy = Math.max(0, leaderScore - myScore);
    const shielded = (self.powerups?.shield || 0) > 0.5;
    const speedBoost = (self.powerups?.speedBoost || 0) > 0.5;
    
    let bestPowerup = null;
    let bestValue = 0;
    
    for (const p of powerups) {
      const value = evaluatePowerup(p, self, others, timeRemaining, ratio, isLeading, behindBy, shielded, speedBoost);
      if (value > bestValue) {
        bestValue = value;
        bestPowerup = p;
      }
    }
    
    // Threshold based on game phase
    const threshold = ratio > 0.6 ? 2.5 : ratio > 0.3 ? 2.0 : 1.5;
    
    if (bestPowerup && bestValue > threshold) {
      bot.target = null;
      bot.targetAge = 0;
      return normalize(bestPowerup.x - self.x, bestPowerup.z - self.z);
    }
  }
  
  // === PRIORITY 2: Strategic tile painting ===
  bot.targetAge += dt;
  const refreshInterval = ratio < 0.25 ? 0.6 : ratio < 0.5 ? 0.9 : 1.2;
  
  // Refresh target if stale or already painted
  const needsNewTarget = !bot.target || bot.targetAge > refreshInterval;
  const targetOwner = bot.target ? grid?.[bot.target.gx]?.[bot.target.gy] : null;
  const targetTaken = targetOwner === myId;
  
  if (needsNewTarget || targetTaken) {
    bot.target = findBestTarget(self, grid, others, timeRemaining, myId, bot.heading, ratio);
    bot.targetAge = 0;
  }
  
  if (bot.target) {
    const world = gridToWorld(bot.target.gx, bot.target.gy);
    const dx = world.x - self.x;
    const dz = world.z - self.z;
    const distToTarget = Math.hypot(dx, dz);
    
    // Smooth steering - blend with last direction
    let dir = normalize(dx, dz);
    if (bot.lastDir && (bot.lastDir.x !== 0 || bot.lastDir.z !== 0)) {
      dir = normalize(dir.x * 0.8 + bot.lastDir.x * 0.2, dir.z * 0.8 + bot.lastDir.z * 0.2);
    }
    bot.lastDir = dir;
    
    // Lookahead: if very close, anticipate next tile in heading direction
    if (distToTarget < TILE_SIZE * 0.4) {
      const hlen = Math.hypot(bot.heading.x, bot.heading.z);
      if (hlen > 0.01) {
        const nextGX = bot.target.gx + Math.round(bot.heading.x / hlen);
        const nextGY = bot.target.gy + Math.round(bot.heading.z / hlen);
        if (nextGX >= 0 && nextGX < GRID_SIZE && nextGY >= 0 && nextGY < GRID_SIZE) {
          if (grid[nextGX][nextGY] !== myId) {
            const nextWorld = gridToWorld(nextGX, nextGY);
            return normalize(nextWorld.x - self.x, nextWorld.z - self.z);
          }
        }
      }
    }
    
    return dir;
  }
  
  // === PRIORITY 3: Steal from leader ===
  const { leaderId, leaderScore } = computeLeader(self, others, myId);
  if (leaderId && leaderId !== myId && leaderScore > 0) {
    const enemyTile = findNearestEnemyTile(self.gridX, self.gridY, grid, leaderId);
    if (enemyTile) {
      const world = gridToWorld(enemyTile.gx, enemyTile.gy);
      return normalize(world.x - self.x, world.z - self.z);
    }
  }
  
  // === FALLBACK: Move toward center or random
  const centerDist = dist(self.x, self.z, 0, 0);
  if (centerDist > 2) {
    return normalize(-self.x * 0.7 + (Math.random() - 0.5) * 0.3, -self.z * 0.7 + (Math.random() - 0.5) * 0.3);
  }
  
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}
