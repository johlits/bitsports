export const id = "gpt-5-3-codex-high";
export const name = "GPT-5.3-Codex High";

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
  if (timeRatio > 0.66) return "early";
  if (timeRatio > 0.28) return "mid";
  return "late";
}

function tileValue(owner, meta) {
  const { myId, leaderId, phase, behindBy, isLeading, aggression } = meta;

  if (myId != null && owner === myId) return -1.6;

  if (owner === 0) {
    if (phase === "early") return 2.1;
    if (phase === "mid") return 1.55;
    return 1.0 + clamp(behindBy * 0.05, 0, 0.5);
  }

  let value = 1.2;
  if (owner === leaderId && leaderId != null && leaderId !== myId) value += 1.2;
  if (!isLeading) value += aggression * 0.5;
  if (phase === "late") value += 0.25;
  return value;
}

function countNearby(grid, gx, gy, radius, predicate) {
  let count = 0;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const nx = gx + dx;
      const ny = gy + dy;
      if (nx < 0 || ny < 0 || nx >= grid.length || ny >= grid[0].length) continue;
      if (predicate(grid[nx][ny] ?? 0)) count++;
    }
  }
  return count;
}

function estimateBombGain(grid, gx, gy, myId) {
  if (!grid) return 6;
  return countNearby(grid, gx, gy, 1, (owner) => myId == null || owner !== myId);
}

function powerupBaseValue(type, meta) {
  const { phase, isLeading, behindBy, haveShield, haveSpeed } = meta;
  if (type === "bomb") {
    let value = phase === "late" ? 8.2 : 7.3;
    value += clamp(behindBy * 0.18, 0, 1.8);
    return value;
  }
  if (type === "speed") {
    if (haveSpeed) return 1.0;
    if (phase === "early") return 6.5;
    if (phase === "mid") return 5.1;
    return 3.8;
  }
  if (type === "shield") {
    if (haveShield) return 1.0;
    return isLeading ? 7.4 : 5.2;
  }
  return 0;
}

function choosePowerupTarget(state, meta) {
  const { self, others = [], powerups = [], grid, tileSize, halfW, halfH, myId } = state;
  if (!powerups.length) return null;

  let best = null;
  let bestScore = -Infinity;

  for (const p of powerups) {
    let value = powerupBaseValue(p.type, meta);

    if (p.type === "bomb") {
      const gp = worldToGrid(p.x, p.z, tileSize, halfW, halfH, state.gridWidth, state.gridHeight);
      value += estimateBombGain(grid, gp.gx, gp.gy, myId) * 0.7;
    }

    const dSelf = dist(self.x, self.z, p.x, p.z);
    const selfSpeed = BASE_SPEED * (meta.haveSpeed ? 1.5 : 1);
    const tSelf = dSelf / Math.max(1, selfSpeed);

    let fastestOpp = Infinity;
    for (const o of others) {
      const dOpp = dist(o.x, o.z, p.x, p.z);
      const tOpp = dOpp / BASE_SPEED;
      if (tOpp < fastestOpp) fastestOpp = tOpp;
    }

    if (fastestOpp < tSelf) value *= 0.58;
    else if (fastestOpp < tSelf * 1.2) value *= 0.8;

    value -= tSelf * 2.2;

    if (value > bestScore) {
      bestScore = value;
      best = p;
    }
  }

  return bestScore > 2.2 ? best : null;
}

function chooseWaypoint(state, meta) {
  const { self, grid, gridWidth, gridHeight, tileSize, halfW, halfH } = state;
  if (!grid) return null;

  const selfGX = clamp(self.gridX ?? 0, 0, gridWidth - 1);
  const selfGY = clamp(self.gridY ?? 0, 0, gridHeight - 1);

  const radius = meta.phase === "early" ? 9 : 11;
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
      if (score < -1) continue;

      const manhattan = Math.abs(gx - selfGX) + Math.abs(gy - selfGY);
      score -= manhattan * 0.16;

      const frontier = countNearby(grid, gx, gy, 1, (o) => meta.myId == null || o !== meta.myId);
      score += frontier * (owner === 0 ? 0.07 : 0.09);

      if (meta.phase === "late" && !meta.isLeading && owner === meta.leaderId) score += 0.8;

      if (!meta.haveShield) {
        for (const o of state.others || []) {
          const og = worldToGrid(o.x, o.z, tileSize, halfW, halfH, gridWidth, gridHeight);
          const od = Math.abs(og.gx - gx) + Math.abs(og.gy - gy);
          if (od < 3) score -= (3 - od) * (meta.isLeading ? 1.0 : 0.5);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        best = gridToWorld(gx, gy, tileSize, halfW, halfH);
      }
    }
  }

  return best;
}

function scoreDirection(dir, state, meta, desiredDir) {
  const { self, grid, gridWidth, gridHeight, tileSize, halfW, halfH, powerups = [], others = [] } = state;

  const steps = meta.phase === "early" ? 12 : meta.phase === "mid" ? 10 : 14;
  const stepDist = tileSize * (meta.haveSpeed ? 1.02 : 0.86);

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
    if (visited.has(key)) tileScore *= 0.25;
    visited.add(key);

    if (owner === 0) {
      const localOpen = countNearby(grid, gp.gx, gp.gy, 1, (o) => o === 0);
      tileScore += localOpen * 0.045;
    }

    if (meta.myId != null && owner === meta.myId) {
      const frontier = countNearby(grid, gp.gx, gp.gy, 1, (o) => o !== meta.myId);
      tileScore += frontier * 0.04;
    }

    let nearestOpp = Infinity;
    for (const o of others) {
      const od = dist(x, z, o.x, o.z);
      if (od < nearestOpp) nearestOpp = od;
    }

    if (!meta.haveShield) {
      if (nearestOpp < 1.2) tileScore -= (1.2 - nearestOpp) * (meta.isLeading ? 2.1 : 1.2);
      else if (nearestOpp < 2.2) tileScore -= (2.2 - nearestOpp) * 0.18;
    } else if (nearestOpp < 1.0) {
      tileScore += 0.12;
    }

    for (const p of powerups) {
      const pd = dist(x, z, p.x, p.z);
      if (pd < 2.5) tileScore += powerupBaseValue(p.type, meta) * (0.08 / (1 + pd * 1.6));
    }

    const edgeDist = Math.min(halfW - Math.abs(x), halfH - Math.abs(z));
    if (edgeDist < tileSize * 0.8) tileScore -= (tileSize * 0.8 - edgeDist) * 0.9;

    total += tileScore * Math.pow(0.9, i - 1);
  }

  const toCenter = dist(x, z, 0, 0) / Math.max(1, halfW + halfH);
  if (meta.phase === "early") total += (1 - toCenter) * 0.24;

  total += dot(dir, meta.lastDir) * (meta.phase === "late" ? 0.24 : 0.16);
  if (desiredDir) total += dot(dir, desiredDir) * 1.45;

  return total;
}

function buildCandidateDirs(centerDir) {
  if (centerDir) {
    const base = Math.atan2(centerDir.z, centerDir.x);
    const offsets = [0, 0.22, -0.22, 0.44, -0.44, 0.75, -0.75, 1.1, -1.1, Math.PI];
    return offsets.map((off) => ({ x: Math.cos(base + off), z: Math.sin(base + off) }));
  }

  const dirs = [];
  const slices = 20;
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
  const behindBy = Math.max(0, leaderScore - myScore);
  const isLeading = myScore >= leaderScore - 0.5;

  const totalTime = bot.initialTime || 60;
  const timeRatio = totalTime > 0 ? timeRemaining / totalTime : 1;
  const phase = getPhase(timeRatio);

  const haveShield = (self.powerups?.shield || 0) > 0;
  const haveSpeed = (self.powerups?.speedBoost || 0) > 0;
  const aggression = clamp(behindBy / 10 + (1 - timeRatio) * 0.5 + (haveShield ? 0.2 : 0), 0, 1.6);

  const meta = {
    myId,
    leaderId,
    behindBy,
    isLeading,
    phase,
    aggression,
    haveShield,
    haveSpeed,
    lastDir: bot.lastDir,
  };

  if (bot.stuckTicks > 14) {
    bot.stuckTicks = 0;
    const turn = bot.ticks % 2 === 0 ? 1 : -1;
    const escape = normalize(-bot.lastDir.z * turn, bot.lastDir.x * turn);
    bot.lastDir = escape;
    return escape;
  }

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
  };

  const powerupTarget = choosePowerupTarget(evalState, meta);
  const waypoint = powerupTarget || chooseWaypoint(evalState, meta);

  let desiredDir = null;
  if (waypoint) desiredDir = normalize(waypoint.x - self.x, waypoint.z - self.z);

  const candidateDirs = buildCandidateDirs(desiredDir);

  let bestDir = desiredDir || bot.lastDir;
  let bestScore = -Infinity;

  for (const dir of candidateDirs) {
    const score = scoreDirection(dir, evalState, meta, desiredDir);
    if (score > bestScore) {
      bestScore = score;
      bestDir = dir;
    }
  }

  let smoothed = normalize(bestDir.x * 0.82 + bot.lastDir.x * 0.18, bestDir.z * 0.82 + bot.lastDir.z * 0.18);
  if (smoothed.x === 0 && smoothed.z === 0) smoothed = normalize(-self.x, -self.z);

  bot.lastDir = smoothed;
  return smoothed;
}
