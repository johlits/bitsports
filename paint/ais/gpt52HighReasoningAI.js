export const id = "gpt-5-2-high-reasoning";
export const name = "GPT-5.2 High Reasoning";

let myId = null;
let initialTime = null;
let target = null;
let targetAge = 0;
let lastPos = null;
let stuck = 0;
let heading = { x: 1, z: 0 };

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function hypot2(x, z) {
  return Math.hypot(x, z);
}

function normalizeDir(x, z) {
  const len = hypot2(x, z);
  if (!len || len < 1e-9) return { x: 0, z: 0 };
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

function manhattan(gx1, gy1, gx2, gy2) {
  return Math.abs(gx2 - gx1) + Math.abs(gy2 - gy1);
}

function ensureInitialTime(timeRemaining) {
  if (initialTime == null || (timeRemaining != null && timeRemaining > initialTime)) {
    initialTime = timeRemaining || 60;
  }
}

function inferMyId(self, grid) {
  if (myId != null) return;
  const owner = grid?.[self.gridX]?.[self.gridY];
  if (owner > 0) myId = owner;
}

function inferMyIdFromScoresAndOpponents(self, others, grid) {
  if (myId != null) return;
  if (!grid || !Array.isArray(grid)) return;

  const oppIds = new Set((others || []).map((o) => o.id).filter((id) => typeof id === "number"));

  const counts = new Map();
  const width = grid.length;
  for (let x = 0; x < width; x++) {
    const col = grid[x];
    if (!col || !Array.isArray(col)) continue;
    const height = col.length;
    for (let y = 0; y < height; y++) {
      const owner = col[y] ?? 0;
      if (owner > 0) counts.set(owner, (counts.get(owner) || 0) + 1);
    }
  }

  if (counts.size === 0) return;

  const selfScore = self.score || 0;

  let bestId = null;
  let bestDelta = Infinity;
  for (const [id, cnt] of counts.entries()) {
    if (oppIds.has(id)) continue;
    const delta = Math.abs(cnt - selfScore);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestId = id;
    }
  }

  if (bestId != null) myId = bestId;
}

function computeLeader(self, others) {
  let leaderScore = self.score || 0;
  let leaderId = myId != null ? myId : 0;
  for (const o of others || []) {
    if ((o.score || 0) > leaderScore) {
      leaderScore = o.score || 0;
      leaderId = o.id;
    }
  }
  return { leaderId, leaderScore };
}

function evaluatePowerup(p, state, meta) {
  const { self, grid, others, timeRemaining } = state;
  const { tileSize, halfW, halfH, gridWidth, gridHeight, ratio, isLeading, behindBy, shielded } = meta;

  const dx = p.x - self.x;
  const dz = p.z - self.z;
  const d = hypot2(dx, dz) || 1e-6;

  let base = 0;
  if (p.type === "bomb") {
    const gp = worldToGrid(p.x, p.z, tileSize, halfW, halfH, gridWidth, gridHeight);
    let paintable = 0;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const x = gp.gx + ox;
        const y = gp.gy + oy;
        if (x < 0 || x >= gridWidth || y < 0 || y >= gridHeight) continue;
        const owner = grid?.[x]?.[y] ?? 0;
        if (myId != null && owner === myId) continue;
        paintable++;
      }
    }
    base = 6 + paintable * 0.9;
    if (ratio < 0.4) base *= 1.25;
    if (behindBy > 8) base *= 1.15;
    if (shielded) base *= 1.1;
  } else if (p.type === "speed") {
    base = ratio > 0.6 ? 7 : ratio > 0.35 ? 5.5 : 4.2;
    if ((self.powerups?.speedBoost || 0) > 0) base *= 0.25;
  } else if (p.type === "shield") {
    base = isLeading ? 8.5 : 4.5;
    if (ratio < 0.35 && behindBy > 6) base *= 0.6;
    if ((self.powerups?.shield || 0) > 0) base *= 0.25;
  }

  const trafficPenalty = (() => {
    if (!others || others.length === 0) return 1;
    let minD = Infinity;
    for (const o of others) {
      const od = hypot2(p.x - o.x, p.z - o.z);
      if (od < minD) minD = od;
    }
    if (shielded) return 1;
    if (!isLeading) return minD < 1.2 ? 1.1 : 1;
    return minD < 1.6 ? 1.35 : minD < 3.0 ? 1.15 : 1;
  })();

  const likelyLost = (() => {
    if (!others || others.length === 0) return false;
    for (const o of others) {
      const od = hypot2(p.x - o.x, p.z - o.z);
      if (od < d * 0.85) return true;
    }
    return false;
  })();
  if (likelyLost) base *= 0.55;

  const urgency = timeRemaining != null && timeRemaining < 10 ? 1.15 : 1;

  return (base * urgency) / ((1 + d * 0.85) * trafficPenalty);
}

function chooseBestPowerup(state, meta) {
  const { powerups } = state;
  if (!powerups || powerups.length === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const p of powerups) {
    const s = evaluatePowerup(p, state, meta);
    if (s > bestScore) {
      bestScore = s;
      best = p;
    }
  }

  const threshold = meta.ratio > 0.66 ? 1.35 : meta.ratio > 0.33 ? 1.15 : 1.0;
  if (best && bestScore >= threshold) return best;
  return null;
}

function tileValue(owner, meta) {
  const { preferStealLeader, leaderId, isLeading, behindBy, ratio, shielded } = meta;

  if (owner === 0) {
    let v = 1.0;
    if (preferStealLeader) v *= 0.65;
    if (ratio < 0.3 && behindBy > 5) v *= 0.85;
    return v;
  }

  if (myId != null && owner === myId) return 0;

  if (preferStealLeader) {
    return owner === leaderId ? (shielded ? 2.9 : 2.4) : 0;
  }

  let v = 0.9;
  if (!isLeading) {
    if (behindBy > 10) v *= 1.9;
    else if (behindBy > 4) v *= 1.4;
    if (shielded) v *= 1.2;
  } else {
    v *= ratio < 0.25 ? 1.1 : 0.75;
  }

  return v;
}

function chooseTileTarget(state, meta) {
  const { self, others, grid, gridWidth, gridHeight } = state;

  const selfGX = clamp(self.gridX, 0, gridWidth - 1);
  const selfGY = clamp(self.gridY, 0, gridHeight - 1);

  let best = null;
  let bestScore = -Infinity;

  const headingLen = hypot2(heading.x, heading.z) || 1;
  const hx = heading.x / headingLen;
  const hz = heading.z / headingLen;

  for (let gx = 0; gx < gridWidth; gx++) {
    for (let gy = 0; gy < gridHeight; gy++) {
      const owner = grid?.[gx]?.[gy] ?? 0;
      const base = tileValue(owner, meta);
      if (base <= 0) continue;

      const gDist = manhattan(selfGX, selfGY, gx, gy);
      const distPenalty = gDist * (meta.speedBoost ? 0.13 : (meta.ratio > 0.7 ? 0.22 : 0.18));

      let cluster = 0;
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || nx >= gridWidth || ny < 0 || ny >= gridHeight) continue;
          const nOwner = grid?.[nx]?.[ny] ?? 0;
          if (owner === 0) {
            if (nOwner === 0) cluster += 0.42;
          } else {
            if (nOwner === owner) cluster += 0.55;
          }
        }
      }

      let risk = 0;
      if (others && others.length > 0) {
        for (const o of others) {
          const ogx = Math.floor((o.x + meta.halfW) / meta.tileSize);
          const ogy = Math.floor((o.z + meta.halfH) / meta.tileSize);
          const od = manhattan(gx, gy, ogx, ogy);
          if (meta.shielded) {
            if (od < 2) risk += (2 - od) * 0.15;
          } else if (meta.isLeading) {
            if (od < 3) risk += (3 - od) * 1.1;
          } else {
            if (od < 2) risk += (2 - od) * 0.35;
          }
        }
      }

      const wx = (gx - selfGX);
      const wz = (gy - selfGY);
      const wlen = hypot2(wx, wz) || 1;
      const align = (wx / wlen) * hx + (wz / wlen) * hz;
      const alignBonus = align * 0.45;

      const centerGX = gridWidth / 2;
      const centerGY = gridHeight / 2;
      const centerDist = manhattan(gx, gy, centerGX, centerGY);
      const centerBonus = meta.ratio < 0.35 ? Math.max(0, 10 - centerDist) * 0.06 : 0;

      const score = base + cluster + alignBonus + centerBonus - distPenalty - risk;
      if (score > bestScore) {
        bestScore = score;
        best = { gx, gy };
      }
    }
  }

  return best;
}

function targetStillGood(state, meta) {
  if (!target) return false;

  const { grid } = state;
  const owner = grid?.[target.gx]?.[target.gy] ?? 0;
  if (myId != null && owner === myId) return false;

  if (meta.preferStealLeader && owner !== meta.leaderId) return false;

  return true;
}

function steerToWorld(self, worldX, worldZ) {
  const dx = worldX - self.x;
  const dz = worldZ - self.z;
  const dir = normalizeDir(dx, dz);
  return dir;
}

export function tick(state) {
  const {
    self,
    others = [],
    powerups = [],
    grid,
    gridWidth = 40,
    gridHeight = 40,
    tileSize = 0.5,
    timeRemaining = 60,
    dt = 0.016,
  } = state;

  ensureInitialTime(timeRemaining);

  const halfW = (gridWidth * tileSize) / 2;
  const halfH = (gridHeight * tileSize) / 2;

  if (timeRemaining > (initialTime || 60) + 0.5) {
    myId = null;
    target = null;
    targetAge = 0;
    lastPos = null;
    stuck = 0;
    heading = { x: 1, z: 0 };
    initialTime = timeRemaining;
  }

  inferMyId(self, grid);
  inferMyIdFromScoresAndOpponents(self, others, grid);

  const { leaderId, leaderScore } = computeLeader(self, others);
  const myScore = self.score || 0;
  const isLeading = myScore >= (leaderScore || 0);
  const behindBy = (leaderScore || 0) - myScore;

  const totalTime = initialTime || 60;
  const ratio = totalTime > 0 ? timeRemaining / totalTime : 1;
  const shielded = (self.powerups?.shield || 0) > 0;
  const speedBoost = (self.powerups?.speedBoost || 0) > 0;
  const preferStealLeader = !isLeading && ratio < 0.33 && behindBy > 4 && leaderId != null;

  if (lastPos) {
    const moved = hypot2(self.x - lastPos.x, self.z - lastPos.z);
    if (moved < 0.03) stuck++;
    else stuck = 0;

    const vx = self.x - lastPos.x;
    const vz = self.z - lastPos.z;
    if (hypot2(vx, vz) > 1e-4) heading = { x: vx, z: vz };
  }
  lastPos = { x: self.x, z: self.z };

  if (stuck > 12) {
    stuck = 0;
    target = null;
    targetAge = 0;
    const a = Math.random() * Math.PI * 2;
    return { x: Math.cos(a), z: Math.sin(a) };
  }

  const meta = {
    tileSize,
    halfW,
    halfH,
    gridWidth,
    gridHeight,
    ratio,
    isLeading,
    behindBy,
    leaderId,
    preferStealLeader,
    shielded,
    speedBoost,
  };

  const bestPU = chooseBestPowerup(
    { self, others, powerups, grid, gridWidth, gridHeight, tileSize, timeRemaining, dt },
    meta
  );

  if (bestPU) {
    const dir = steerToWorld(self, bestPU.x, bestPU.z);
    if (dir.x !== 0 || dir.z !== 0) {
      target = null;
      targetAge = 0;
    }
    return dir;
  }

  targetAge += dt;
  const refresh = speedBoost ? 0.85 : 1.25;
  if (!targetStillGood(state, meta) || targetAge > refresh) {
    const next = chooseTileTarget(state, meta);
    target = next;
    targetAge = 0;
  }

  if (target) {
    const wp = gridToWorld(target.gx, target.gy, tileSize, halfW, halfH);

    const jitterX = clamp((heading.z || 0) * 0.08, -0.1, 0.1);
    const jitterZ = clamp(-(heading.x || 0) * 0.08, -0.1, 0.1);

    return steerToWorld(self, wp.x + jitterX, wp.z + jitterZ);
  }

  return normalizeDir(-self.x, -self.z);
}
