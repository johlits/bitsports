export const id = "claude-opus-4-6-thinking";
export const name = "Claude Opus 4.6 Thinking";

/**
 * Advanced Paint Battle AI with:
 * - Density-aware pathfinding for maximum tile coverage
 * - Line-sweep scoring to evaluate entire movement paths
 * - Opponent trajectory prediction to avoid wasted repainting
 * - Smart bomb powerup evaluation (actual paintable tiles at location)
 * - Frontier-based territory expansion
 * - Adaptive multi-phase strategy with smooth transitions
 */

// ─── Constants ────────────────────────────────────────────────
const GRID = 40;
const TILE = 0.5;
const HALF = 10;
const MAX_SPEED = 8;

// ─── Per-instance state ───────────────────────────────────────
const instances = new Map();

function makeState() {
  return {
    lastPos: null,
    stuckCount: 0,
    heading: { x: 1, z: 0 },
    target: null,
    targetAge: 0,
    lastTime: null,
    oppHistory: new Map(), // id -> { x, z, vx, vz }
  };
}

function getState(id) {
  if (!instances.has(id)) instances.set(id, makeState());
  return instances.get(id);
}

function resetState(s) {
  s.lastPos = null;
  s.stuckCount = 0;
  s.heading = { x: 1, z: 0 };
  s.target = null;
  s.targetAge = 0;
  s.oppHistory.clear();
}

// ─── Utilities ────────────────────────────────────────────────
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function hypot(a, b) { return Math.sqrt(a * a + b * b); }
function dist(x1, z1, x2, z2) { return hypot(x2 - x1, z2 - z1); }
function manhattan(x1, y1, x2, y2) { return Math.abs(x2 - x1) + Math.abs(y2 - y1); }

function norm(x, z) {
  const len = hypot(x, z);
  return len < 1e-4 ? { x: 0, z: 0 } : { x: x / len, z: z / len };
}

function g2w(gx, gy) {
  return { x: gx * TILE - HALF + TILE / 2, z: gy * TILE - HALF + TILE / 2 };
}

function w2g(wx, wz) {
  return {
    gx: clamp(Math.floor((wx + HALF) / TILE), 0, GRID - 1),
    gy: clamp(Math.floor((wz + HALF) / TILE), 0, GRID - 1),
  };
}

// ─── ID inference ─────────────────────────────────────────────
function inferMyId(self, grid, others) {
  if (typeof self.id === "number") return self.id;
  const owner = grid?.[self.gridX]?.[self.gridY];
  if (owner > 0) return owner;

  const oppIds = new Set((others || []).map(o => o.id));
  const counts = new Map();
  for (let x = 0; x < GRID; x++) {
    for (let y = 0; y < GRID; y++) {
      const v = grid[x][y];
      if (v > 0 && !oppIds.has(v)) counts.set(v, (counts.get(v) || 0) + 1);
    }
  }
  let bestId = null, bestDelta = Infinity;
  for (const [cid, cnt] of counts) {
    const d = Math.abs(cnt - (self.score || 0));
    if (d < bestDelta) { bestDelta = d; bestId = cid; }
  }
  return bestId;
}

// ─── Game analysis ────────────────────────────────────────────
function getLeader(self, others, myId) {
  let lid = myId, lscore = self.score || 0;
  for (const o of others) {
    if ((o.score || 0) > lscore) { lscore = o.score; lid = o.id; }
  }
  return { lid, lscore };
}

// ─── Density map (coarse 8x8 for fast lookup) ────────────────
function buildDensityMap(grid, myId) {
  const S = 5; // 40/8 = 5 tiles per cell
  const D = 8;
  const map = new Array(D);
  for (let i = 0; i < D; i++) {
    map[i] = new Array(D).fill(0);
    for (let j = 0; j < D; j++) {
      let count = 0;
      for (let dx = 0; dx < S; dx++) {
        for (let dy = 0; dy < S; dy++) {
          const gx = i * S + dx;
          const gy = j * S + dy;
          if (gx < GRID && gy < GRID && grid[gx][gy] !== myId) count++;
        }
      }
      map[i][j] = count;
    }
  }
  return map;
}

function densityAt(densityMap, gx, gy) {
  const cx = clamp(Math.floor(gx / 5), 0, 7);
  const cy = clamp(Math.floor(gy / 5), 0, 7);
  return densityMap[cx][cy];
}

// ─── Count paintable tiles in radius ──────────────────────────
function countPaintable(grid, gx, gy, r, myId) {
  let c = 0;
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      const nx = gx + dx, ny = gy + dy;
      if (nx >= 0 && nx < GRID && ny >= 0 && ny < GRID) {
        if (grid[nx][ny] !== myId) c++;
      }
    }
  }
  return c;
}

// ─── Line sweep scoring ──────────────────────────────────────
// Score how many tiles we'd paint moving from current pos in a direction
function scoreLine(grid, startGX, startGY, dirX, dirY, length, myId) {
  let score = 0;
  for (let i = 1; i <= length; i++) {
    const gx = startGX + dirX * i;
    const gy = startGY + dirY * i;
    if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) break;
    if (grid[gx][gy] !== myId) score++;
  }
  return score;
}

// ─── Powerup evaluation ──────────────────────────────────────
function evalPowerup(p, self, others, grid, myId, timeRatio, isLeading, deficit) {
  const d = dist(self.x, self.z, p.x, p.z);
  let value = 0;

  switch (p.type) {
    case "bomb": {
      // Check actual paintable tiles at bomb location
      const bg = w2g(p.x, p.z);
      const paintable = countPaintable(grid, bg.gx, bg.gy, 1, myId);
      value = 5 + paintable * 1.8;
      if (timeRatio < 0.25) value *= 1.5;
      if (deficit > 10) value *= 1.4;
      break;
    }
    case "speed":
      value = timeRatio > 0.5 ? 10 : timeRatio > 0.25 ? 7 : 4;
      if ((self.powerups?.speedBoost || 0) > 1) value *= 0.15;
      break;
    case "shield":
      value = isLeading ? 9 : 4;
      if (timeRatio < 0.2 && isLeading) value *= 1.8;
      if ((self.powerups?.shield || 0) > 2) value *= 0.1;
      break;
  }

  // Distance decay — hyperbolic for smooth falloff
  value *= 1 / (1 + d * 0.5);

  // Opponent contention — reduce if opponent closer
  for (const o of others) {
    if (dist(o.x, o.z, p.x, p.z) < d * 0.7) {
      value *= 0.35;
      break;
    }
  }

  return value;
}

// ─── Tile scoring ─────────────────────────────────────────────
function scoreTile(gx, gy, grid, selfGX, selfGY, myId, meta) {
  const owner = grid[gx][gy];
  if (owner === myId) return -Infinity;

  let score = 0;

  // Base value by owner type
  if (owner === 0) {
    score = 1.4;
    if (meta.ratio > 0.5) score += 0.4; // Early game: unpainted is king
  } else {
    score = 0.9;
    if (meta.stealLeader && owner === meta.lid) {
      score = 3.0; // Double swing: -1 for them, +1 for us
    } else if (meta.deficit > 5 && meta.ratio < 0.4) {
      score = 1.5;
    }
  }

  // Distance cost
  const md = manhattan(gx, gy, selfGX, selfGY);
  const distCost = md * (meta.speedBoost ? 0.06 : 0.09);
  if (meta.ratio < 0.25) score -= distCost * 0.7; // Late game: nearby only
  else score -= distCost;

  // Cluster bonus from density map
  const density = densityAt(meta.densityMap, gx, gy);
  score += density * 0.025;

  // Local cluster (fine-grained)
  const localCluster = countPaintable(grid, gx, gy, 2, myId);
  score += localCluster * 0.06;

  // Frontier bonus: tile adjacent to our own territory is efficient to grab
  let frontier = false;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = gx + dx, ny = gy + dy;
      if (nx >= 0 && nx < GRID && ny >= 0 && ny < GRID && grid[nx][ny] === myId) {
        frontier = true;
        break;
      }
    }
    if (frontier) break;
  }
  if (frontier) score += 0.5;

  // Heading alignment for momentum
  const dx = gx - selfGX, dy = gy - selfGY;
  const len = hypot(dx, dy) || 1;
  const hlen = hypot(meta.hx, meta.hz) || 1;
  const align = (dx / len) * (meta.hx / hlen) + (dy / len) * (meta.hz / hlen);
  score += align * 0.35;

  // Opponent avoidance (skip if shielded)
  if (!meta.shielded) {
    for (const o of meta.others) {
      const og = w2g(o.x, o.z);
      const od = manhattan(gx, gy, og.gx, og.gy);
      if (od < 4) score -= (4 - od) * 0.7;

      // Also avoid predicted opponent position
      const oHist = meta.oppHist?.get(o.id);
      if (oHist) {
        const predGX = clamp(Math.round(og.gx + oHist.vx * 0.5), 0, GRID - 1);
        const predGY = clamp(Math.round(og.gy + oHist.vz * 0.5), 0, GRID - 1);
        const pd = manhattan(gx, gy, predGX, predGY);
        if (pd < 3) score -= (3 - pd) * 0.5;
      }
    }
  }

  return score;
}

// ─── Find best target tile ────────────────────────────────────
function findTarget(self, grid, others, myId, meta) {
  const sgx = self.gridX, sgy = self.gridY;
  let best = null, bestS = -Infinity;
  const maxR = Math.min(22, GRID / 2);

  for (let r = 1; r <= maxR; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const gx = sgx + dx, gy = sgy + dy;
        if (gx < 0 || gx >= GRID || gy < 0 || gy >= GRID) continue;

        const s = scoreTile(gx, gy, grid, sgx, sgy, myId, meta);
        if (s > bestS) { bestS = s; best = { gx, gy }; }
      }
    }
    if (best && r >= 4 && bestS > 2.5) break;
  }
  return best;
}

// ─── Sweep direction scoring ──────────────────────────────────
function bestSweepDir(grid, sgx, sgy, myId) {
  const dirs = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    { dx: 1, dy: 1 }, { dx: -1, dy: 1 },
    { dx: 1, dy: -1 }, { dx: -1, dy: -1 },
  ];
  let bestDir = dirs[0], bestScore = -1;
  for (const d of dirs) {
    const s = scoreLine(grid, sgx, sgy, d.dx, d.dy, 8, myId);
    if (s > bestScore) { bestScore = s; bestDir = d; }
  }
  return bestDir;
}

// ─── Main tick ────────────────────────────────────────────────
export function tick(state) {
  const { self, others = [], powerups = [], grid, timeRemaining = 60, dt = 0.016 } = state;

  const myId = inferMyId(self, grid, others);
  const s = getState(myId ?? "anon");

  // Detect game reset
  if (s.lastTime != null && timeRemaining > s.lastTime + 0.5) resetState(s);
  s.lastTime = timeRemaining;

  // ── Stuck detection ──
  if (s.lastPos) {
    const moved = dist(self.x, self.z, s.lastPos.x, s.lastPos.z);
    if (moved < 0.03) {
      s.stuckCount++;
    } else {
      s.stuckCount = 0;
      if (moved > 0.01) {
        s.heading = { x: self.x - s.lastPos.x, z: self.z - s.lastPos.z };
      }
    }
  }
  s.lastPos = { x: self.x, z: self.z };

  if (s.stuckCount > 10) {
    s.stuckCount = 0;
    s.target = null;
    const angle = Math.random() * Math.PI * 2;
    return { x: Math.cos(angle), z: Math.sin(angle) };
  }

  // ── Track opponent velocities ──
  for (const o of others) {
    const prev = s.oppHistory.get(o.id);
    if (prev) {
      const vx = (o.x - prev.x) / (dt || 0.016);
      const vz = (o.z - prev.z) / (dt || 0.016);
      s.oppHistory.set(o.id, { x: o.x, z: o.z, vx: vx * 0.7 + (prev.vx || 0) * 0.3, vz: vz * 0.7 + (prev.vz || 0) * 0.3 });
    } else {
      s.oppHistory.set(o.id, { x: o.x, z: o.z, vx: 0, vz: 0 });
    }
  }

  // ── Game state analysis ──
  const totalTime = 60;
  const ratio = totalTime > 0 ? timeRemaining / totalTime : 1;
  const { lid, lscore } = getLeader(self, others, myId);
  const myScore = self.score || 0;
  const isLeading = myScore >= lscore - 0.5;
  const deficit = Math.max(0, lscore - myScore);
  const shielded = (self.powerups?.shield || 0) > 0.5;
  const speedBoost = (self.powerups?.speedBoost || 0) > 0.5;

  // ── Build density map ──
  const densityMap = buildDensityMap(grid, myId);

  // ── PRIORITY 1: Powerups ──
  if (powerups.length > 0) {
    let bestPU = null, bestPUVal = 0;
    for (const p of powerups) {
      const val = evalPowerup(p, self, others, grid, myId, ratio, isLeading, deficit);
      if (val > bestPUVal) { bestPUVal = val; bestPU = p; }
    }
    const threshold = ratio > 0.6 ? 2.5 : ratio > 0.3 ? 2.0 : 1.5;
    if (bestPU && bestPUVal > threshold) {
      s.target = null;
      s.targetAge = 0;
      return norm(bestPU.x - self.x, bestPU.z - self.z);
    }
  }

  // ── PRIORITY 2: Strategic painting ──
  const meta = {
    ratio, lid, lscore, deficit, isLeading, shielded, speedBoost,
    stealLeader: !isLeading && ratio < 0.45 && deficit > 5,
    hx: s.heading.x, hz: s.heading.z,
    others, densityMap,
    oppHist: s.oppHistory,
  };

  s.targetAge += dt;
  const refreshRate = ratio < 0.25 ? 0.5 : ratio < 0.5 ? 0.8 : 1.1;

  // Refresh target if stale, taken, or too old
  const currentOwner = s.target ? grid?.[s.target.gx]?.[s.target.gy] : null;
  if (!s.target || s.targetAge > refreshRate || currentOwner === myId) {
    s.target = findTarget(self, grid, others, myId, meta);
    s.targetAge = 0;
  }

  if (s.target) {
    const world = g2w(s.target.gx, s.target.gy);
    const dx = world.x - self.x;
    const dz = world.z - self.z;
    const d = hypot(dx, dz);

    // Lookahead: if almost at target, plan the next move
    if (d < TILE * 0.5) {
      // Use sweep direction scoring for smooth continuation
      const sweep = bestSweepDir(grid, s.target.gx, s.target.gy, myId);
      const nextGX = s.target.gx + sweep.dx;
      const nextGY = s.target.gy + sweep.dy;
      if (nextGX >= 0 && nextGX < GRID && nextGY >= 0 && nextGY < GRID && grid[nextGX][nextGY] !== myId) {
        const nw = g2w(nextGX, nextGY);
        return norm(nw.x - self.x, nw.z - self.z);
      }
    }

    return norm(dx, dz);
  }

  // ── PRIORITY 3: Steal from leader ──
  if (lid && lid !== myId && lscore > 0) {
    for (let r = 1; r < GRID; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const gx = self.gridX + dx, gy = self.gridY + dy;
          if (gx >= 0 && gx < GRID && gy >= 0 && gy < GRID && grid[gx][gy] === lid) {
            const w = g2w(gx, gy);
            return norm(w.x - self.x, w.z - self.z);
          }
        }
      }
    }
  }

  // ── FALLBACK ──
  const cd = dist(self.x, self.z, 0, 0);
  if (cd > 2) return norm(-self.x, -self.z);
  const a = Math.random() * Math.PI * 2;
  return { x: Math.cos(a), z: Math.sin(a) };
}
