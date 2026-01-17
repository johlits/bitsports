export const id = "gpt-5-2-codex-xhigh";
export const name = "GPT-5.2-Codex XHigh";

const DEFAULT_GRID_SIZE = 40;
const DEFAULT_TILE_SIZE = 0.5;

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
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function dist(x1, z1, x2, z2) {
  return Math.hypot(x2 - x1, z2 - z1);
}

function normalize(x, z) {
  const len = Math.hypot(x, z);
  if (!len || len < 1e-6) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
}

function worldToGrid(x, z, tileSize, halfW, halfH, gridWidth, gridHeight) {
  const gx = Math.floor((x + halfW) / tileSize);
  const gy = Math.floor((z + halfH) / tileSize);
  return {
    gx: clamp(gx, 0, gridWidth - 1),
    gy: clamp(gy, 0, gridHeight - 1),
  };
}

function gridToWorld(gx, gy, tileSize, halfW, halfH) {
  return {
    x: gx * tileSize - halfW + tileSize / 2,
    z: gy * tileSize - halfH + tileSize / 2,
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

function countPaintableAround(grid, gx, gy, myId) {
  let count = 0;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const x = gx + dx;
      const y = gy + dy;
      if (x < 0 || y < 0 || x >= grid.length || y >= grid[0].length) continue;
      const owner = grid[x][y] ?? 0;
      if (myId != null && owner === myId) continue;
      count++;
    }
  }
  return count;
}

function evaluatePowerup(p, state, meta) {
  const { self, others, grid, gridWidth, gridHeight, tileSize } = state;
  const { halfW, halfH, ratio, behindBy, isLeading, shielded, speedBoost, myId } = meta;

  const dx = p.x - self.x;
  const dz = p.z - self.z;
  const distance = Math.hypot(dx, dz) || 0.0001;

  let base = 0;
  if (p.type === "bomb") {
    const gp = worldToGrid(p.x, p.z, tileSize, halfW, halfH, gridWidth, gridHeight);
    const paintable = grid ? countPaintableAround(grid, gp.gx, gp.gy, myId) : 5;
    base = 6 + paintable * 1.15;
    if (ratio < 0.4) base *= 1.3;
    if (behindBy > 6) base *= 1.2;
    if (shielded) base *= 1.05;
  } else if (p.type === "speed") {
    base = ratio > 0.6 ? 7.2 : ratio > 0.35 ? 5.4 : 4.0;
    if (speedBoost) base *= 0.25;
  } else if (p.type === "shield") {
    base = isLeading ? 7.8 : 4.2;
    if (ratio < 0.25 && isLeading) base *= 1.25;
    if (shielded) base *= 0.25;
  }

  base = base / (1 + distance * 0.85);

  let minOppDist = Infinity;
  for (const o of others || []) {
    const od = dist(o.x, o.z, p.x, p.z);
    if (od < minOppDist) minOppDist = od;
  }
  if (!shielded && minOppDist < distance * 0.85) base *= 0.5;
  if (!shielded && minOppDist < distance * 0.65) base *= 0.35;

  return base;
}

function chooseBestPowerup(state, meta) {
  const { powerups = [] } = state;
  if (!powerups.length) return null;

  let best = null;
  let bestScore = 0;
  for (const p of powerups) {
    const score = evaluatePowerup(p, state, meta);
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  const threshold = meta.ratio > 0.6 ? 1.1 : meta.ratio > 0.35 ? 1.0 : 0.9;
  if (best && bestScore >= threshold) return best;
  return null;
}

function tileValue(owner, meta) {
  const { myId, preferStealLeader, leaderId, isLeading, behindBy, ratio, shielded } = meta;

  if (myId != null && owner === myId) return -Infinity;

  let value = 0;
  if (owner === 0) {
    value = 1.15 + (ratio > 0.6 ? 0.3 : 0.05);
    if (preferStealLeader) value *= 0.75;
  } else {
    value = 1.0;
    if (preferStealLeader && owner === leaderId) value = 2.7;
    if (behindBy > 6 && ratio < 0.45) value *= 1.35;
    if (ratio < 0.25) value *= 1.2;
    if (isLeading && ratio > 0.55) value *= 0.9;
  }

  if (shielded) value *= 1.15;
  return value;
}

function chooseTileTarget(state, meta, heading) {
  const { self, others, grid, gridWidth, gridHeight } = state;
  if (!grid) return null;

  const selfGX = clamp(self.gridX ?? 0, 0, gridWidth - 1);
  const selfGY = clamp(self.gridY ?? 0, 0, gridHeight - 1);

  const headingLen = Math.hypot(heading.x, heading.z) || 1;
  const hx = heading.x / headingLen;
  const hz = heading.z / headingLen;

  const centerGX = gridWidth / 2;
  const centerGY = gridHeight / 2;

  let best = null;
  let bestScore = -Infinity;

  for (let gx = 0; gx < gridWidth; gx++) {
    for (let gy = 0; gy < gridHeight; gy++) {
      const owner = grid[gx][gy] ?? 0;
      const base = tileValue(owner, meta);
      if (base <= 0) continue;

      const manhattanDist = Math.abs(gx - selfGX) + Math.abs(gy - selfGY);
      let distPenalty = manhattanDist * (meta.speedBoost ? 0.08 : 0.12);
      if (meta.ratio < 0.35) distPenalty *= 0.85;

      let cluster = 0;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= gridWidth || ny >= gridHeight) continue;
          const nOwner = grid[nx][ny] ?? 0;
          if (meta.myId != null && nOwner === meta.myId) continue;
          cluster++;
        }
      }
      const clusterBonus = cluster * (owner === 0 ? 0.05 : 0.07);

      const dx = gx - selfGX;
      const dy = gy - selfGY;
      const len = Math.hypot(dx, dy) || 1;
      const align = ((dx / len) * hx + (dy / len) * hz) * 0.35;

      const centerDist = Math.abs(gx - centerGX) + Math.abs(gy - centerGY);
      const centerBonus = meta.ratio > 0.6 ? Math.max(0, 12 - centerDist) * 0.04 : 0;

      let risk = 0;
      if (!meta.shielded && others && others.length > 0) {
        for (const o of others) {
          const ogx = Math.floor((o.x + meta.halfW) / meta.tileSize);
          const ogy = Math.floor((o.z + meta.halfH) / meta.tileSize);
          const od = Math.abs(ogx - gx) + Math.abs(ogy - gy);
          if (od < 3) risk += (3 - od) * (meta.isLeading ? 1.1 : 0.6);
        }
      } else if (meta.shielded && others && others.length > 0) {
        for (const o of others) {
          const ogx = Math.floor((o.x + meta.halfW) / meta.tileSize);
          const ogy = Math.floor((o.z + meta.halfH) / meta.tileSize);
          const od = Math.abs(ogx - gx) + Math.abs(ogy - gy);
          if (od < 2) risk -= (2 - od) * 0.25;
        }
      }

      const score = base + clusterBonus + align + centerBonus - distPenalty - risk;
      if (score > bestScore) {
        bestScore = score;
        best = { gx, gy };
      }
    }
  }

  return best;
}

function targetStillValid(target, grid, meta) {
  if (!target) return false;
  const owner = grid?.[target.gx]?.[target.gy] ?? 0;
  if (meta.myId != null && owner === meta.myId) return false;
  if (meta.preferStealLeader && owner !== meta.leaderId) return false;
  return true;
}

export function tick(state) {
  const {
    self,
    others = [],
    powerups = [],
    grid,
    gridWidth = DEFAULT_GRID_SIZE,
    gridHeight = DEFAULT_GRID_SIZE,
    tileSize = DEFAULT_TILE_SIZE,
    timeRemaining = 60,
    dt = 0.016,
  } = state;

  const myId = inferMyId(self, grid, others);
  const bot = getBotState(myId ?? self.id);

  if (bot.lastTimeRemaining != null && timeRemaining > bot.lastTimeRemaining + 0.5) {
    resetBotState(bot);
  }
  bot.lastTimeRemaining = timeRemaining;

  if (bot.initialTime == null || timeRemaining > bot.initialTime + 0.5) {
    bot.initialTime = timeRemaining || 60;
  }

  const halfW = (gridWidth * tileSize) / 2;
  const halfH = (gridHeight * tileSize) / 2;

  if (bot.lastPos) {
    const moved = dist(self.x, self.z, bot.lastPos.x, bot.lastPos.z);
    if (moved < 0.03) bot.stuckCount += 1;
    else bot.stuckCount = 0;

    if (moved > 0.001) {
      bot.heading = { x: self.x - bot.lastPos.x, z: self.z - bot.lastPos.z };
    }
  }
  bot.lastPos = { x: self.x, z: self.z };

  if (bot.stuckCount > 12) {
    bot.stuckCount = 0;
    bot.target = null;
    bot.targetAge = 0;
    const angle = Math.random() * Math.PI * 2;
    return { x: Math.cos(angle), z: Math.sin(angle) };
  }

  const { leaderId, leaderScore } = computeLeader(self, others, myId);
  const myScore = self.score || 0;
  const isLeading = myScore >= leaderScore - 0.5;
  const behindBy = Math.max(0, leaderScore - myScore);

  const totalTime = bot.initialTime || 60;
  const ratio = totalTime > 0 ? timeRemaining / totalTime : 1;
  const shielded = (self.powerups?.shield || 0) > 0;
  const speedBoost = (self.powerups?.speedBoost || 0) > 0;
  const preferStealLeader = !isLeading && ratio < 0.4 && behindBy > 4 && leaderId != null && leaderId !== myId;

  const meta = {
    myId,
    leaderId,
    isLeading,
    behindBy,
    ratio,
    shielded,
    speedBoost,
    tileSize,
    halfW,
    halfH,
    gridWidth,
    gridHeight,
    preferStealLeader,
  };

  const bestPowerup = chooseBestPowerup({ self, others, powerups, grid, gridWidth, gridHeight, tileSize }, meta);
  if (bestPowerup) {
    bot.target = null;
    bot.targetAge = 0;
    const dir = normalize(bestPowerup.x - self.x, bestPowerup.z - self.z);
    bot.lastDir = dir;
    return dir;
  }

  bot.targetAge += dt;
  const refreshInterval = speedBoost ? 0.75 : ratio < 0.25 ? 0.9 : 1.2;
  if (!targetStillValid(bot.target, grid, meta) || bot.targetAge > refreshInterval) {
    bot.target = chooseTileTarget({ self, others, grid, gridWidth, gridHeight }, meta, bot.heading);
    bot.targetAge = 0;
  }

  if (bot.target) {
    const world = gridToWorld(bot.target.gx, bot.target.gy, tileSize, halfW, halfH);
    let aimX = world.x;
    let aimZ = world.z;

    const distToTarget = dist(self.x, self.z, world.x, world.z);
    if (distToTarget < tileSize * 0.45) {
      const hlen = Math.hypot(bot.heading.x, bot.heading.z);
      if (hlen > 0.01) {
        aimX += (bot.heading.x / hlen) * tileSize * 0.35;
        aimZ += (bot.heading.z / hlen) * tileSize * 0.35;
      }
    }

    aimX = clamp(aimX, -halfW + tileSize / 2, halfW - tileSize / 2);
    aimZ = clamp(aimZ, -halfH + tileSize / 2, halfH - tileSize / 2);

    let dir = normalize(aimX - self.x, aimZ - self.z);
    if (bot.lastDir) {
      dir = normalize(dir.x * 0.78 + bot.lastDir.x * 0.22, dir.z * 0.78 + bot.lastDir.z * 0.22);
    }
    bot.lastDir = dir;
    return dir;
  }

  const fallback = normalize(-self.x, -self.z);
  bot.lastDir = fallback;
  return fallback;
}
