export const id = "gpt-5.1-codex-max-low";
export const name = "GPT-5.1-Codex Max Low";

// Balanced painter: prioritizes powerups, steals leader tiles when behind,
// sweeps clusters of neutrals when safe, and avoids close collisions.

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

function manhattan(gx1, gy1, gx2, gy2) {
  return Math.abs(gx2 - gx1) + Math.abs(gy2 - gy1);
}

function dist(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

function evaluatePowerup(p, self, others, timeRemaining, initialTime) {
  const d = dist(self.x, self.z, p.x, p.z) || 0.0001;
  const ratio = initialTime > 0 ? timeRemaining / initialTime : 1;
  const leaderScore = others.reduce((m, o) => Math.max(m, o.score), self.score);
  const behindBy = leaderScore - self.score;

  let base = 0;
  switch (p.type) {
    case "bomb":
      base = 9;
      if (ratio < 0.5) base *= 1.2;
      if (ratio < 0.25) base *= 1.15;
      break;
    case "speed":
      base = ratio > 0.6 ? 7 : 5;
      if (self.powerups.speedBoost > 0) base *= 0.4;
      break;
    case "shield":
      base = behindBy <= 0 ? 8 : 5;
      if (self.powerups.shield > 0) base *= 0.4;
      break;
  }

  const travelCost = 1 + d * 0.6;
  return base / travelCost;
}

function pickTileTarget({ self, others, grid, gridWidth, gridHeight, timeRemaining, initialTime }) {
  const { gx: selfGX, gy: selfGY } = worldToGrid(self.x, self.z);
  const leader = others.reduce(
    (best, o) => (o.score > best.score ? o : best),
    { id: null, score: self.score }
  );

  const behindBy = leader.score - self.score;
  const lateGame = (initialTime > 0 ? timeRemaining / initialTime : 1) < 0.33;

  let best = null;
  let bestScore = -Infinity;

  for (let gx = 0; gx < gridWidth; gx++) {
    for (let gy = 0; gy < gridHeight; gy++) {
      const owner = grid[gx][gy];
      if (owner !== 0 && owner === self.id) continue; // skip own tiles

      // Base value
      let base = owner === 0 ? 1.2 : 1.0;
      if (owner !== 0 && owner === leader.id && behindBy > 0) {
        base *= 2.0; // steal from leader when behind
      } else if (owner !== 0) {
        base *= 1.3; // enemy tile in general
      }
      if (lateGame && owner !== 0) base *= 1.15;

      // Cluster bonus (3x3 neighborhood)
      let cluster = 0;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue;
          const nOwner = grid[nx][ny];
          if (owner === 0) {
            if (nOwner === 0) cluster += 0.4;
          } else if (nOwner === owner) {
            cluster += 0.5;
          }
        }
      }

      // Distance and risk
      const gDist = manhattan(selfGX, selfGY, gx, gy);
      const distPenalty = gDist * 0.22;

      let riskPenalty = 0;
      for (const o of others) {
        const og = worldToGrid(o.x, o.z);
        const od = manhattan(og.gx, og.gy, gx, gy);
        if (od < 3) riskPenalty += (3 - od) * 0.8;
      }

      const score = base + cluster - distPenalty - riskPenalty;
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
    tileSize, // unused but provided
    timeRemaining,
    dt, // unused but provided
  } = state;

  const initialTime = state.initialTime || 60; // engine doesn't send; assume 60s default

  // === Powerups first ===
  let bestPU = null;
  let bestPUScore = 0;
  for (const p of powerups) {
    const val = evaluatePowerup(p, self, others, timeRemaining, initialTime);
    if (val > bestPUScore) {
      bestPUScore = val;
      bestPU = p;
    }
  }

  const puThreshold = 1.05;
  if (bestPU && bestPUScore > puThreshold) {
    const dx = bestPU.x - self.x;
    const dz = bestPU.z - self.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  // === Tile targeting ===
  const target = pickTileTarget({
    self,
    others,
    grid,
    gridWidth,
    gridHeight,
    timeRemaining,
    initialTime,
  });

  if (target) {
    const world = gridToWorld(target.gx, target.gy);
    const dx = world.x - self.x;
    const dz = world.z - self.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  // === Fallback: chase leader or drift center ===
  if (others.length > 0) {
    const leader = others.reduce((best, o) => (o.score > best.score ? o : best), {
      score: -Infinity,
    });
    if (leader && leader.score > 0) {
      const dx = leader.x - self.x;
      const dz = leader.z - self.z;
      const len = Math.hypot(dx, dz) || 1;
      return { x: dx / len, z: dz / len };
    }
  }

  const dx = -self.x;
  const dz = -self.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}
