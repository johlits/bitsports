export const id = "gpt-5.1-high";
export const name = "GPT-5.1 (high, priority)";

// Persistent state
let myId = null;
let initialTime = null;

const GRID_SIZE = 40;
const TILE_SIZE = 0.5;
const HALF_WORLD = 10;

function worldToGrid(x, z) {
  return {
    gx: Math.floor((x + HALF_WORLD) / TILE_SIZE),
    gy: Math.floor((z + HALF_WORLD) / TILE_SIZE),
  };
}

function gridToWorld(gx, gy) {
  return {
    x: gx * TILE_SIZE - HALF_WORLD + TILE_SIZE / 2,
    z: gy * TILE_SIZE - HALF_WORLD + TILE_SIZE / 2,
  };
}

function dist(x1, z1, x2, z2) {
  return Math.sqrt((x2 - x1) ** 2 + (z2 - z1) ** 2);
}

function manhattan(gx1, gy1, gx2, gy2) {
  return Math.abs(gx2 - gx1) + Math.abs(gy2 - gy1);
}

function ensureInitialTime(timeRemaining) {
  if (initialTime == null || timeRemaining > initialTime) {
    initialTime = timeRemaining || 60;
  }
  return initialTime;
}

function inferMyId(self, grid) {
  if (myId != null) return;
  const { gx, gy } = worldToGrid(self.x, self.z);
  if (gx >= 0 && gx < GRID_SIZE && gy >= 0 && gy < GRID_SIZE) {
    const owner = grid[gx][gy];
    if (owner > 0) {
      myId = owner;
    }
  }
}

function evaluatePowerup(p, self, others, timeRemaining, totalTime) {
  const d = dist(self.x, self.z, p.x, p.z) || 0.0001;
  const ratio = totalTime > 0 ? timeRemaining / totalTime : 1;

  let base = 0;
  const myScore = self.score;
  const leaderScore = others.reduce((m, o) => (o.score > m ? o.score : m), myScore);
  const behindBy = leaderScore - myScore;
  const isLeading = myScore >= leaderScore;

  switch (p.type) {
    case "bomb": {
      // Very strong throughout, especially mid/late game or when close to clusters
      base = 9;
      if (ratio < 0.5) base *= 1.3;
      if (ratio < 0.25) base *= 1.2;
      break;
    }
    case "speed": {
      base = ratio > 0.6 ? 7 : 5; // more valuable early
      if (self.powerups.speedBoost > 0) base *= 0.3; // already boosted
      break;
    }
    case "shield": {
      base = isLeading ? 9 : 5;
      if (behindBy > 10 && ratio < 0.4) base *= 0.7; // defense less important when far behind late
      if (self.powerups.shield > 0) base *= 0.3;
      break;
    }
  }

  // Travel cost
  const travelCost = 1 + d * 0.7;
  return base / travelCost;
}

function findBestTileTarget(self, others, grid, gridWidth, gridHeight, timeRemaining) {
  const { gx: selfGX, gy: selfGY } = worldToGrid(self.x, self.z);

  const myScore = self.score;
  let leaderScore = myScore;
  let leaderId = myId;
  for (const o of others) {
    if (o.score > leaderScore) {
      leaderScore = o.score;
      leaderId = o.id;
    }
  }

  const behindBy = leaderScore - myScore;
  const isLeading = myScore >= leaderScore;

  const totalTime = initialTime || 60;
  const ratio = totalTime > 0 ? timeRemaining / totalTime : 1;
  const lateGame = ratio < 0.33;

  let best = null;
  let bestScore = -Infinity;

  for (let gx = 0; gx < gridWidth; gx++) {
    for (let gy = 0; gy < gridHeight; gy++) {
      const owner = grid[gx][gy];
      if (owner === 0) {
        // Unpainted
      } else if (myId != null && owner === myId) {
        continue; // Our tile - no direct value
      }

      // Base value depending on owner
      let base = 0;
      if (owner === 0) {
        base = 1.0;
        if (!isLeading && lateGame) base *= 0.8; // in late game when behind, enemy tiles are better
      } else {
        // Enemy tile
        base = 0.8;
        if (!isLeading && (behindBy > 5 || lateGame)) base *= 2.0;
        if (isLeading && !lateGame) base *= 0.7; // don't overfight early when ahead
      }

      if (base <= 0) continue;

      // Cluster bonus in a 5x5 area
      let cluster = 0;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue;
          const nOwner = grid[nx][ny];
          if (owner === 0) {
            if (nOwner === 0) cluster += 0.6;
          } else {
            if (nOwner === owner) cluster += 0.8;
          }
        }
      }

      // Distance penalty (grid manhattan distance)
      const gDist = manhattan(selfGX, selfGY, gx, gy);
      const distPenalty = gDist * 0.25;

      // Opponent risk: avoid tiles too close to opponents
      let riskPenalty = 0;
      for (const o of others) {
        const og = worldToGrid(o.x, o.z);
        const od = manhattan(og.gx, og.gy, gx, gy);
        if (od < 4) {
          riskPenalty += (4 - od) * 0.7;
        }
      }

      // Slight preference for central tiles (harder to defend edges late)
      const centerGX = gridWidth / 2;
      const centerGY = gridHeight / 2;
      const centerDist = manhattan(gx, gy, centerGX, centerGY);
      const centerBonus = lateGame ? Math.max(0, 8 - centerDist) * 0.1 : 0;

      const score = base + cluster - distPenalty - riskPenalty + centerBonus;
      if (score > bestScore) {
        bestScore = score;
        best = { gx, gy };
      }
    }
  }

  return best;
}

export function tick(state) {
  const {
    self,
    others,
    powerups,
    grid,
    gridWidth,
    gridHeight,
    tileSize,
    timeRemaining,
    dt,
  } = state;

  ensureInitialTime(timeRemaining);
  inferMyId(self, grid);

  const totalTime = initialTime || 60;
  const ratio = totalTime > 0 ? timeRemaining / totalTime : 1;

  // === 1. Powerup targeting ===
  let bestPU = null;
  let bestPUScore = 0;
  if (powerups.length > 0) {
    for (const p of powerups) {
      const val = evaluatePowerup(p, self, others, timeRemaining, totalTime);
      if (val > bestPUScore) {
        bestPUScore = val;
        bestPU = p;
      }
    }
  }

  // Dynamic threshold: more willing to chase strong powerups late-game
  const puThreshold = ratio > 0.66 ? 1.4 : ratio > 0.33 ? 1.2 : 1.0;
  if (bestPU && bestPUScore > puThreshold) {
    const dx = bestPU.x - self.x;
    const dz = bestPU.z - self.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  // === 2. Tile targeting ===
  const target = findBestTileTarget(self, others, grid, gridWidth, gridHeight, timeRemaining);
  if (target) {
    const worldPos = gridToWorld(target.gx, target.gy);
    const dx = worldPos.x - self.x;
    const dz = worldPos.z - self.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;

    // Mild look-ahead smoothing: if very close, bias slightly toward center
    if (len < 0.3) {
      const towardCenterX = -self.x;
      const towardCenterZ = -self.z;
      const clen = Math.sqrt(towardCenterX * towardCenterX + towardCenterZ * towardCenterZ) || 1;
      const mix = 0.3;
      const mx = (1 - mix) * (dx / len) + mix * (towardCenterX / clen);
      const mz = (1 - mix) * (dz / len) + mix * (towardCenterZ / clen);
      const mlen = Math.sqrt(mx * mx + mz * mz) || 1;
      return { x: mx / mlen, z: mz / mlen };
    }

    return { x: dx / len, z: dz / len };
  }

  // === 3. Fallback behavior ===
  // If no good target found (almost all tiles ours), pressure the current leader
  if (others.length > 0) {
    const leader = others.reduce((best, o) => (o.score > best.score ? o : best), {
      score: -Infinity,
    });
    if (leader && leader.score > 0) {
      const dx = leader.x - self.x;
      const dz = leader.z - self.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      return { x: dx / len, z: dz / len };
    }
  }

  // Drift toward center as a safe default
  const dx = -self.x;
  const dz = -self.z;
  const len = Math.sqrt(dx * dx + dz * dz) || 1;
  return { x: dx / len, z: dz / len };
}
