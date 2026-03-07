export const id = "gpt-5-4";
export const name = "GPT-5.4";

const DEFAULT_GRID_SIZE = 40;
const DEFAULT_TILE_SIZE = 0.5;
const BASE_SPEED = 8;

const botStates = new Map();

function createBotState() {
  return {
    lastPos: null,
    lastDir: { x: 1, z: 0 },
    stuckTicks: 0,
    ticks: 0,
    initialTime: null,
    lastTimeRemaining: null,
    lastTarget: null,
    heatBias: null,
  };
}

function getBotState(id) {
  const key = id ?? "anon";
  if (!botStates.has(key)) botStates.set(key, createBotState());
  return botStates.get(key);
}

function resetBotState(bot) {
  bot.lastPos = null;
  bot.lastDir = { x: 1, z: 0 };
  bot.stuckTicks = 0;
  bot.ticks = 0;
  bot.lastTarget = null;
  bot.heatBias = null;
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

function dot(a, b) {
  return a.x * b.x + a.z * b.z;
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
      if (val > 0 && !oppIds.has(val)) counts.set(val, (counts.get(val) || 0) + 1);
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

function getPhase(timeRatio) {
  if (timeRatio > 0.68) return "early";
  if (timeRatio > 0.25) return "mid";
  return "late";
}

function countNearby(grid, gx, gy, radius, predicate) {
  let count = 0;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.length || ny >= grid[0].length) continue;
      if (predicate(grid[nx][ny] ?? 0, nx, ny)) count++;
    }
  }
  return count;
}

function buildDensityMap(grid, myId) {
  const width = grid?.length || DEFAULT_GRID_SIZE;
  const height = grid?.[0]?.length || DEFAULT_GRID_SIZE;
  const map = Array.from({ length: width }, () => Array(height).fill(0));

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let score = 0;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const owner = grid[nx][ny] ?? 0;
          const d = Math.abs(dx) + Math.abs(dy);
          const w = d === 0 ? 1.8 : d === 1 ? 1.15 : d === 2 ? 0.7 : 0.3;
          if (owner === 0) score += 1.0 * w;
          else if (myId == null || owner !== myId) score += 1.2 * w;
          else score -= 0.55 * w;
        }
      }
      map[x][y] = score;
    }
  }
  return map;
}

function tileValue(owner, meta) {
  const { myId, leaderId, phase, deficit, isLeading, shielded, aggression } = meta;

  if (myId != null && owner === myId) return shielded ? -0.45 : -1.5;

  if (owner === 0) {
    if (phase === "early") return 2.35;
    if (phase === "mid") return 1.72;
    return 1.02 + clamp(deficit * 0.05, 0, 0.55);
  }

  let value = 1.25;
  if (owner === leaderId && leaderId != null && leaderId !== myId) value += 1.5;
  if (!isLeading) value += aggression * 0.55;
  if (phase === "late") value += 0.35;
  return value;
}

function estimateBombGain(grid, gx, gy, myId) {
  if (!grid) return 6;
  return countNearby(grid, gx, gy, 1, (owner) => myId == null || owner !== myId);
}

function powerupBaseValue(type, meta) {
  const { phase, isLeading, deficit, haveShield, haveSpeed, shielded } = meta;
  if (type === "bomb") {
    let value = phase === "late" ? 8.8 : 7.5;
    value += clamp(deficit * 0.18, 0, 2.0);
    if (!isLeading) value += 0.4;
    return value;
  }
  if (type === "speed") {
    if (haveSpeed) return 0.9;
    if (phase === "early") return 6.8;
    if (phase === "mid") return 5.3;
    return 3.7;
  }
  if (type === "shield") {
    if (haveShield || shielded) return 0.9;
    return isLeading ? 7.9 : 5.6;
  }
  return 0;
}

function evalPowerup(p, self, others, grid, myId, meta, state) {
  let value = powerupBaseValue(p.type, meta);
  if (p.type === "bomb") {
    const gp = worldToGrid(p.x, p.z, state.tileSize, state.halfW, state.halfH, state.gridWidth, state.gridHeight);
    value += estimateBombGain(grid, gp.gx, gp.gy, myId) * 0.72;
  }

  const mySpeed = BASE_SPEED * (meta.haveSpeed ? 1.5 : 1);
  const tSelf = dist(self.x, self.z, p.x, p.z) / Math.max(1, mySpeed);

  let bestOpp = Infinity;
  for (const o of others) {
    const tOpp = dist(o.x, o.z, p.x, p.z) / BASE_SPEED;
    if (tOpp < bestOpp) bestOpp = tOpp;
  }

  if (bestOpp < tSelf) value *= 0.55;
  else if (bestOpp < tSelf * 1.18) value *= 0.8;

  value -= tSelf * 2.25;
  return value;
}

function pressurePenalty(gx, gy, state, meta) {
  let penalty = 0;
  for (const o of state.others || []) {
    const og = worldToGrid(o.x, o.z, state.tileSize, state.halfW, state.halfH, state.gridWidth, state.gridHeight);
    const d = Math.abs(og.gx - gx) + Math.abs(og.gy - gy);
    if (meta.haveShield) {
      if (d <= 2) penalty -= 0.08;
      continue;
    }
    if (d < 3) penalty += (3 - d) * (meta.isLeading ? 1.25 : 0.65);
    else if (d < 6) penalty += (6 - d) * 0.08;
  }
  return penalty;
}

function chooseWaypoint(state, meta, bot) {
  const { self, grid, gridWidth, gridHeight, tileSize, halfW, halfH, myId, densityMap } = state;
  if (!grid) return null;

  const selfGX = clamp(self.gridX ?? 0, 0, gridWidth - 1);
  const selfGY = clamp(self.gridY ?? 0, 0, gridHeight - 1);

  const radius = meta.phase === "early" ? 10 : meta.phase === "mid" ? 12 : 14;
  const minX = clamp(selfGX - radius, 0, gridWidth - 1);
  const maxX = clamp(selfGX + radius, 0, gridWidth - 1);
  const minY = clamp(selfGY - radius, 0, gridHeight - 1);
  const maxY = clamp(selfGY + radius, 0, gridHeight - 1);

  let best = null;
  let bestScore = -Infinity;

  for (let gx = minX; gx <= maxX; gx++) {
    for (let gy = minY; gy <= maxY; gy++) {
      const owner = grid[gx][gy] ?? 0;
      let score = tileValue(owner, meta);
      if (score < -1.2) continue;

      const manhattan = Math.abs(gx - selfGX) + Math.abs(gy - selfGY);
      score -= manhattan * 0.14;

      const density = densityMap?.[gx]?.[gy] ?? 0;
      score += density * 0.09;

      const frontier = countNearby(grid, gx, gy, 1, (o) => meta.myId == null || o !== meta.myId);
      score += frontier * (owner === 0 ? 0.075 : 0.11);

      if (meta.phase === "late" && !meta.isLeading && owner === meta.leaderId) score += 0.95;
      if (meta.phase === "early" && owner === 0) score += 0.25;

      score -= pressurePenalty(gx, gy, state, meta);

      if (bot.lastTarget) {
        const continuity = Math.abs(bot.lastTarget.gx - gx) + Math.abs(bot.lastTarget.gy - gy);
        if (continuity <= 2) score += 0.22;
      }

      if (score > bestScore) {
        bestScore = score;
        best = { gx, gy, ...gridToWorld(gx, gy, tileSize, halfW, halfH) };
      }
    }
  }

  return best;
}

function scoreDirection(dir, state, meta, desiredDir, bot) {
  const { self, grid, gridWidth, gridHeight, tileSize, halfW, halfH, powerups = [], others = [], densityMap } = state;

  const steps = meta.phase === "early" ? 13 : meta.phase === "mid" ? 11 : 15;
  const stepDist = tileSize * (meta.haveSpeed ? 1.06 : 0.88);

  let x = self.x;
  let z = self.z;
  let total = 0;
  const visited = new Set();

  for (let i = 1; i <= steps; i++) {
    x += dir.x * stepDist;
    z += dir.z * stepDist;

    x = clamp(x, -halfW + tileSize / 2, halfW - tileSize / 2);
    z = clamp(z, -halfH + tileSize / 2, halfH - tileSize / 2);

    const gp = worldToGrid(x, z, tileSize, halfW, halfH, gridWidth, gridHeight);
    const owner = grid?.[gp.gx]?.[gp.gy] ?? 0;

    let tileScore = tileValue(owner, meta);
    const key = gp.gx + "," + gp.gy;
    if (visited.has(key)) tileScore *= 0.22;
    visited.add(key);

    const localDensity = densityMap?.[gp.gx]?.[gp.gy] ?? 0;
    tileScore += localDensity * 0.055;

    if (owner === 0) {
      const open = countNearby(grid, gp.gx, gp.gy, 1, (o) => o === 0);
      tileScore += open * 0.05;
    }

    if (meta.myId != null && owner === meta.myId) {
      const frontier = countNearby(grid, gp.gx, gp.gy, 1, (o) => o !== meta.myId);
      tileScore += frontier * 0.045;
    }

    let nearestOpp = Infinity;
    for (const o of others) {
      const od = dist(x, z, o.x, o.z);
      if (od < nearestOpp) nearestOpp = od;
    }

    if (!meta.haveShield) {
      if (nearestOpp < 1.1) tileScore -= (1.1 - nearestOpp) * (meta.isLeading ? 2.3 : 1.3);
      else if (nearestOpp < 2.3) tileScore -= (2.3 - nearestOpp) * 0.22;
    } else if (nearestOpp < 1.0) {
      tileScore += 0.12;
    }

    for (const p of powerups) {
      const pd = dist(x, z, p.x, p.z);
      if (pd < 2.7) tileScore += powerupBaseValue(p.type, meta) * (0.085 / (1 + pd * 1.55));
    }

    const edgeDist = Math.min(halfW - Math.abs(x), halfH - Math.abs(z));
    if (edgeDist < tileSize * 0.8) tileScore -= (tileSize * 0.8 - edgeDist) * 1.0;

    total += tileScore * Math.pow(0.9, i - 1);
  }

  const toCenter = dist(x, z, 0, 0) / Math.max(1, halfW + halfH);
  if (meta.phase === "early") total += (1 - toCenter) * 0.22;

  total += dot(dir, meta.lastDir) * (meta.phase === "late" ? 0.26 : 0.18);
  if (desiredDir) total += dot(dir, desiredDir) * 1.55;
  if (bot.heatBias) total += dot(dir, bot.heatBias) * 0.18;

  return total;
}

function buildCandidateDirs(centerDir) {
  if (centerDir) {
    const base = Math.atan2(centerDir.z, centerDir.x);
    const offsets = [0, 0.18, -0.18, 0.38, -0.38, 0.65, -0.65, 0.95, -0.95, 1.25, -1.25, Math.PI];
    return offsets.map((off) => ({ x: Math.cos(base + off), z: Math.sin(base + off) }));
  }

  const dirs = [];
  const slices = 24;
  for (let i = 0; i < slices; i++) {
    const a = (i / slices) * Math.PI * 2;
    dirs.push({ x: Math.cos(a), z: Math.sin(a) });
  }
  return dirs;
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
  } = state;

  const halfW = (gridWidth * tileSize) / 2;
  const halfH = (gridHeight * tileSize) / 2;

  const myId = inferMyId(self, grid, others);
  const bot = getBotState(myId ?? self.id);

  if (bot.lastTimeRemaining != null && timeRemaining > bot.lastTimeRemaining + 0.5) {
    resetBotState(bot);
  }
  bot.lastTimeRemaining = timeRemaining;

  if (bot.initialTime == null || timeRemaining > bot.initialTime + 0.5) {
    bot.initialTime = timeRemaining || 60;
  }

  bot.ticks += 1;

  if (bot.lastPos) {
    const moved = dist(self.x, self.z, bot.lastPos.x, bot.lastPos.z);
    if (moved < 0.016) bot.stuckTicks += 1;
    else bot.stuckTicks = 0;
  }
  bot.lastPos = { x: self.x, z: self.z };

  const { leaderId, leaderScore } = computeLeader(self, others, myId);
  const myScore = self.score || 0;
  const deficit = Math.max(0, leaderScore - myScore);
  const isLeading = myScore >= leaderScore - 0.5;

  const totalTime = bot.initialTime || 60;
  const timeRatio = totalTime > 0 ? timeRemaining / totalTime : 1;
  const phase = getPhase(timeRatio);

  const haveShield = (self.powerups?.shield || 0) > 0;
  const haveSpeed = (self.powerups?.speedBoost || 0) > 0;
  const shielded = haveShield;
  const aggression = clamp(deficit / 10 + (1 - timeRatio) * 0.55 + (haveShield ? 0.25 : 0), 0, 1.8);

  const meta = {
    myId,
    leaderId,
    deficit,
    isLeading,
    phase,
    aggression,
    haveShield,
    haveSpeed,
    shielded,
    lastDir: bot.lastDir,
  };

  if (bot.stuckTicks > 14) {
    bot.stuckTicks = 0;
    const turn = bot.ticks % 2 === 0 ? 1 : -1;
    const escape = normalize(-bot.lastDir.z * turn, bot.lastDir.x * turn);
    bot.lastDir = escape;
    bot.heatBias = escape;
    return escape;
  }

  const densityMap = buildDensityMap(grid, myId);

  const evalState = {
    self,
    others,
    powerups,
    grid,
    gridWidth,
    gridHeight,
    tileSize,
    halfW,
    halfH,
    myId,
    densityMap,
  };

  let bestPowerup = null;
  let bestPowerupValue = -Infinity;
  for (const p of powerups) {
    const v = evalPowerup(p, self, others, grid, myId, meta, evalState);
    if (v > bestPowerupValue) {
      bestPowerupValue = v;
      bestPowerup = p;
    }
  }

  let waypoint = null;
  const powerupThreshold = phase === "early" ? 2.5 : phase === "mid" ? 2.1 : 1.6;
  if (bestPowerup && bestPowerupValue > powerupThreshold) {
    waypoint = { x: bestPowerup.x, z: bestPowerup.z };
    bot.lastTarget = null;
  } else {
    const target = chooseWaypoint(evalState, meta, bot);
    if (target) {
      waypoint = { x: target.x, z: target.z };
      bot.lastTarget = { gx: target.gx, gy: target.gy };
    }
  }

  let desiredDir = null;
  if (waypoint) desiredDir = normalize(waypoint.x - self.x, waypoint.z - self.z);

  const candidateDirs = buildCandidateDirs(desiredDir);

  let bestDir = desiredDir || bot.lastDir;
  let bestScore = -Infinity;
  for (const dir of candidateDirs) {
    const score = scoreDirection(dir, evalState, meta, desiredDir, bot);
    if (score > bestScore) {
      bestScore = score;
      bestDir = dir;
    }
  }

  let smoothed = normalize(bestDir.x * 0.84 + bot.lastDir.x * 0.16, bestDir.z * 0.84 + bot.lastDir.z * 0.16);
  if (smoothed.x === 0 && smoothed.z === 0) smoothed = normalize(-self.x, -self.z);

  bot.lastDir = smoothed;
  bot.heatBias = desiredDir || smoothed;
  return smoothed;
}
