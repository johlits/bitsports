export const id = "claude-opus-4-6-thinking";
export const name = "Claude Opus 4.6 Thinking";

// Advanced AI with deep trajectory analysis, opponent modeling,
// multi-puck triage, bank-shot awareness, and adaptive strategy.

// ─── Constants ────────────────────────────────────────────────
const TABLE_W = 10;
const TABLE_H = 20;
const HALF_W = TABLE_W / 2;
const HALF_H = TABLE_H / 2;
const CORNER_R = 1.0;

const GOAL_W = 4.0;
const HALF_GOAL = GOAL_W / 2;
const CREASE_R = 2.5;
const PADDLE_R = 0.35;
const PUCK_R = 0.25;
const HIT_DIST = PADDLE_R + PUCK_R;

const MAX_SPEED = 6;
const FRICTION = 0.997;
const MIN_PUCK_SPEED = 0.5;

const SIM_DT = 0.016;
const SIM_HORIZON = 4.0;

const PX_LIMIT = HALF_W - PADDLE_R;
const BLUE_Z_MIN = 0;
const BLUE_Z_MAX = HALF_H - PADDLE_R;
const RED_Z_MIN = -(HALF_H - PADDLE_R);
const RED_Z_MAX = 0;

// ─── Per-side state (so AI works correctly when used for both blue and red) ──
const sideState = {
  blue: { prevOpponent: null, opponentVel: { x: 0, z: 0 }, tickCount: 0 },
  red:  { prevOpponent: null, opponentVel: { x: 0, z: 0 }, tickCount: 0 },
};

// ─── Utilities ────────────────────────────────────────────────
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function hypot(a, b) {
  return Math.sqrt(a * a + b * b);
}

function normalize(x, z) {
  const len = hypot(x, z);
  return len < 1e-6 ? { x: 0, z: 0 } : { x: x / len, z: z / len };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ─── Boundary helpers ─────────────────────────────────────────
function clampBounds(x, z, isBlue) {
  return {
    x: clamp(x, -PX_LIMIT, PX_LIMIT),
    z: clamp(z, isBlue ? BLUE_Z_MIN : RED_Z_MIN, isBlue ? BLUE_Z_MAX : RED_Z_MAX),
  };
}

function pushOutCorner(x, z, radius) {
  const cr = CORNER_R;
  const limit = cr - radius;
  const corners = [
    { cx: HALF_W - cr, cz: HALF_H - cr },
    { cx: -(HALF_W - cr), cz: HALF_H - cr },
    { cx: HALF_W - cr, cz: -(HALF_H - cr) },
    { cx: -(HALF_W - cr), cz: -(HALF_H - cr) },
  ];
  let rx = x, rz = z;
  for (const c of corners) {
    const inX = c.cx > 0 ? rx > c.cx : rx < c.cx;
    const inZ = c.cz > 0 ? rz > c.cz : rz < c.cz;
    if (inX && inZ) {
      const dx = rx - c.cx;
      const dz = rz - c.cz;
      const d = hypot(dx, dz) || 1e-4;
      if (d > limit) {
        rx = c.cx + (dx / d) * limit;
        rz = c.cz + (dz / d) * limit;
      }
    }
  }
  return { x: rx, z: rz };
}

function pushOutCrease(x, z, isBlue) {
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const dz = isBlue ? goalZ - z : z - goalZ;
  if (dz <= 0) return { x, z };
  const minD = CREASE_R + PADDLE_R + 0.06;
  const dSq = x * x + dz * dz;
  if (dSq >= minD * minD) return { x, z };
  const d = Math.sqrt(dSq) || 1e-4;
  const s = minD / d;
  return {
    x: x * s,
    z: isBlue ? goalZ - dz * s : goalZ + dz * s,
  };
}

function validPaddlePos(x, z, isBlue) {
  let p = clampBounds(x, z, isBlue);
  p = pushOutCorner(p.x, p.z, PADDLE_R);
  p = pushOutCrease(p.x, p.z, isBlue);
  p = clampBounds(p.x, p.z, isBlue);
  return p;
}

// ─── Physics simulation ───────────────────────────────────────
function reflectCorner(state) {
  const cr = CORNER_R;
  const limit = cr - PUCK_R;
  const corners = [
    { cx: HALF_W - cr, cz: HALF_H - cr },
    { cx: -(HALF_W - cr), cz: HALF_H - cr },
    { cx: HALF_W - cr, cz: -(HALF_H - cr) },
    { cx: -(HALF_W - cr), cz: -(HALF_H - cr) },
  ];
  for (const c of corners) {
    const inX = c.cx > 0 ? state.x > c.cx : state.x < c.cx;
    const inZ = c.cz > 0 ? state.z > c.cz : state.z < c.cz;
    if (inX && inZ) {
      const dx = state.x - c.cx;
      const dz = state.z - c.cz;
      const d = hypot(dx, dz) || 1e-4;
      if (d > limit) {
        const nx = dx / d;
        const nz = dz / d;
        state.x = c.cx + nx * limit;
        state.z = c.cz + nz * limit;
        const dot = state.vx * nx + state.vz * nz;
        state.vx -= 2 * dot * nx;
        state.vz -= 2 * dot * nz;
        return true;
      }
    }
  }
  return false;
}

function simulatePuck(puck, horizon) {
  const path = [];
  let x = puck.x;
  let z = puck.y;
  let vx = puck.velocity ? puck.velocity.x : 0;
  let vz = puck.velocity ? puck.velocity.y : 0;
  const wallX = HALF_W - PUCK_R;
  const wallZ = HALF_H - PUCK_R;
  const cornerBound = HALF_W - CORNER_R;

  for (let t = 0; t < horizon; t += SIM_DT) {
    // Friction / min-speed enforcement
    const spd = hypot(vx, vz);
    if (spd > MIN_PUCK_SPEED) {
      vx *= FRICTION;
      vz *= FRICTION;
    } else if (spd > 0 && spd < MIN_PUCK_SPEED) {
      const s = MIN_PUCK_SPEED / spd;
      vx *= s;
      vz *= s;
    }

    x += vx * SIM_DT;
    z += vz * SIM_DT;

    // Corner reflections
    const st = { x, z, vx, vz };
    const hitCorner = reflectCorner(st);
    x = st.x; z = st.z; vx = st.vx; vz = st.vz;

    // Flat wall reflections (skip if corner handled it)
    if (!hitCorner) {
      if (x <= -wallX && Math.abs(z) < HALF_H - CORNER_R) { x = -wallX; vx = -vx; }
      if (x >= wallX && Math.abs(z) < HALF_H - CORNER_R) { x = wallX; vx = -vx; }
    }

    // Z walls / goal detection
    let goalSide = null;
    if (z >= wallZ) {
      if (Math.abs(x) < HALF_GOAL) { goalSide = "blue"; }
      else if (Math.abs(x) < cornerBound) { z = wallZ; vz = -vz; }
    } else if (z <= -wallZ) {
      if (Math.abs(x) < HALF_GOAL) { goalSide = "red"; }
      else if (Math.abs(x) < cornerBound) { z = -wallZ; vz = -vz; }
    }

    path.push({ x, z, vx, vz, t: t + SIM_DT, goalSide });
    if (goalSide) break;
  }
  return path;
}

// ─── Intercept finding ────────────────────────────────────────
function findIntercept(path, self, isBlue, maxTimeBuffer) {
  const zMin = isBlue ? BLUE_Z_MIN : RED_Z_MIN;
  const zMax = isBlue ? BLUE_Z_MAX : RED_Z_MAX;
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const creaseMinD = CREASE_R + PADDLE_R + 0.12;
  const buffer = maxTimeBuffer || 0.08;

  let best = null;
  let bestScore = -Infinity;

  for (const p of path) {
    if (p.z < zMin || p.z > zMax) continue;

    // Skip if inside crease zone
    const dz = isBlue ? goalZ - p.z : p.z - goalZ;
    if (dz > 0 && (p.x * p.x + dz * dz) < creaseMinD * creaseMinD) continue;

    const dist = hypot(p.x - self.x, p.z - self.y);
    const tReach = dist / MAX_SPEED;
    if (tReach > p.t + buffer) continue;

    // Score: prefer intercepts far from our goal, early, and reachable
    const distFromGoal = isBlue ? (HALF_H - p.z) : (p.z + HALF_H);
    const timeSlack = p.t - tReach; // positive = we arrive early (good)
    const score = distFromGoal * 3.0 + timeSlack * 8.0 - p.t * 2.0;

    if (score > bestScore) {
      bestScore = score;
      best = { x: p.x, z: p.z, t: p.t, vx: p.vx, vz: p.vz, score };
    }
  }
  return best;
}

function predictAtZ(path, targetZ, isBlue) {
  for (const p of path) {
    if (isBlue ? p.z >= targetZ : p.z <= targetZ) return p;
  }
  return path.length ? path[path.length - 1] : { x: 0, z: targetZ, t: Infinity };
}

// ─── Crease-edge defensive positioning ────────────────────────
function creaseEdge(predX, isBlue) {
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const minD = CREASE_R + PADDLE_R + 0.08;
  const cx = clamp(predX, -2.3, 2.3);
  const angle = Math.atan2(cx, minD);
  return {
    x: Math.sin(angle) * minD,
    z: isBlue ? goalZ - Math.cos(angle) * minD : goalZ + Math.cos(angle) * minD,
  };
}

// ─── Threat analysis ──────────────────────────────────────────
function analyzePuck(puck, self, opp, isBlue) {
  const path = simulatePuck(puck, SIM_HORIZON);
  const speed = hypot(puck.velocity ? puck.velocity.x : 0, puck.velocity ? puck.velocity.y : 0);
  const movingToMe = isBlue ? (puck.velocity ? puck.velocity.y : 0) > 0.05
    : (puck.velocity ? puck.velocity.y : 0) < -0.05;
  const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;
  const myGoalSide = isBlue ? "blue" : "red";
  const distToGoal = Math.abs((isBlue ? HALF_H : -HALF_H) - puck.y);
  const selfDist = hypot(puck.x - self.x, puck.y - self.y);
  const oppDist = hypot(puck.x - opp.x, puck.y - opp.y);

  // Goal-crossing analysis
  let timeToGoal = Infinity;
  let predXAtGoal = puck.x;
  let onTarget = false;

  for (const p of path) {
    if (p.goalSide === myGoalSide) {
      timeToGoal = p.t;
      predXAtGoal = p.x;
      onTarget = true;
      break;
    }
    const goalZ = isBlue ? HALF_H : -HALF_H;
    if (isBlue ? p.z >= goalZ - PUCK_R : p.z <= goalZ + PUCK_R) {
      predXAtGoal = p.x;
      onTarget = Math.abs(p.x) <= HALF_GOAL;
      break;
    }
  }

  // Scoring opponent goal
  let scoringOppGoal = false;
  const oppGoalSide = isBlue ? "red" : "blue";
  for (const p of path) {
    if (p.goalSide === oppGoalSide) { scoringOppGoal = true; break; }
  }

  // Intercept
  const intercept = movingToMe ? findIntercept(path, self, isBlue, 0.06) : null;

  // Threat scoring — heavily weight time-to-goal for urgent pucks
  let threat = 0;
  if (movingToMe) {
    if (timeToGoal < Infinity) {
      threat += 200 / (timeToGoal + 0.08);
    }
    if (onTarget) threat += 70;
    threat += speed * 6;
    threat += clamp(12 - distToGoal, 0, 12) * 4;
  }
  if (inMyHalf) threat += 18;
  // Puck near opponent who might shoot it at us
  if (!inMyHalf && oppDist < 2.0) threat += 22;
  if (!inMyHalf && oppDist < 1.2) threat += 18;
  // Closer pucks in my half are slightly more urgent
  if (inMyHalf) threat += clamp(6 - selfDist, 0, 6) * 2;

  return {
    puck, path, speed, movingToMe, inMyHalf,
    timeToGoal, predXAtGoal, onTarget, scoringOppGoal,
    intercept, distToGoal, selfDist, oppDist, threat,
  };
}

// ─── Shot targeting ───────────────────────────────────────────
function bestShotX(puck, opp, isBlue) {
  const st = sideState[isBlue ? "blue" : "red"];
  // Analyze opponent coverage gaps
  const oppX = opp.x;

  // Primary: aim away from opponent
  const awayX = oppX >= 0 ? -1.5 : 1.5;

  // Secondary: angle shot using puck's current X position
  const angleBias = clamp(-puck.x * 0.35, -1.2, 1.2);

  // Tertiary: if we tracked opponent moving, aim where they came from
  let velBias = 0;
  if (Math.abs(st.opponentVel.x) > 0.5) {
    velBias = st.opponentVel.x > 0 ? -0.8 : 0.8; // aim opposite to their movement
  }

  // Weighted blend
  const raw = awayX * 0.55 + angleBias * 0.2 + velBias * 0.25;
  return clamp(raw, -(HALF_GOAL - 0.3), HALF_GOAL - 0.3);
}

function approachBehind(puck, targetX, targetZ, extra) {
  const dx = targetX - puck.x;
  const dz = targetZ - puck.y;
  const len = hypot(dx, dz) || 1;
  const dist = HIT_DIST + (extra || 0.18);
  return {
    x: puck.x - (dx / len) * dist,
    z: puck.y - (dz / len) * dist,
  };
}

// ─── Offense selection ────────────────────────────────────────
function pickOffense(analyses, self, isBlue) {
  let best = null;
  let bestS = -Infinity;

  for (const a of analyses) {
    if (!a.inMyHalf) continue;
    if (a.movingToMe && a.timeToGoal < 1.2) continue;
    if (a.speed > 6) continue;
    if (a.scoringOppGoal) continue; // already heading to their goal, leave it

    const d = hypot(a.puck.x - self.x, a.puck.y - self.y);
    if (d > 7) continue;

    const controlScore = (7 - d) * 1.8 + (6 - a.speed) * 0.8;
    const posBonus = a.movingToMe ? -3 : 2;
    // Prefer pucks closer to center for better shot angles
    const centerBonus = (2.5 - Math.abs(a.puck.x)) * 0.5;
    const s = controlScore + posBonus + centerBonus;

    if (s > bestS) { bestS = s; best = a; }
  }
  return best;
}

// ─── Adaptive defense depth ───────────────────────────────────
function defenseZ(isBlue, numPucks, hasCritical) {
  // With more pucks, stay tighter to goal; with few, can be more aggressive
  const baseDepth = CREASE_R + PADDLE_R + 0.5;
  const aggressiveDepth = 4.5;

  let depth;
  if (hasCritical) {
    depth = baseDepth;
  } else if (numPucks >= 5) {
    depth = baseDepth + 0.8;
  } else if (numPucks >= 3) {
    depth = lerp(aggressiveDepth, baseDepth + 0.5, 0.5);
  } else {
    depth = aggressiveDepth;
  }

  return isBlue ? HALF_H - depth : -HALF_H + depth;
}

// ─── Main tick ────────────────────────────────────────────────
export function tick({ pucks, self, opponent, dt }) {
  if (!pucks || pucks.length === 0) return { x: 0, z: 0 };

  const isBlue = self.y > 0;
  const st = sideState[isBlue ? "blue" : "red"];
  st.tickCount++;
  const myGoalZ = isBlue ? HALF_H : -HALF_H;
  const oppGoalZ = isBlue ? -HALF_H : HALF_H;

  // Track opponent velocity for shot prediction
  if (st.prevOpponent) {
    const effDt = dt || SIM_DT;
    const rawVx = (opponent.x - st.prevOpponent.x) / effDt;
    const rawVz = (opponent.y - st.prevOpponent.y) / effDt;
    // Smooth with exponential moving average
    st.opponentVel.x = st.opponentVel.x * 0.85 + rawVx * 0.15;
    st.opponentVel.z = st.opponentVel.z * 0.85 + rawVz * 0.15;
  }
  st.prevOpponent = { x: opponent.x, y: opponent.y };

  // ── Analyze every puck ──
  const analyses = pucks.map(p => analyzePuck(p, self, opponent, isBlue));
  analyses.sort((a, b) => b.threat - a.threat);

  const primary = analyses[0];
  if (!primary) return normalize(0, isBlue ? 1 : -1);

  // Identify critical threats (on-target, arriving soon)
  const critical = analyses.filter(
    a => a.movingToMe && a.onTarget && a.timeToGoal < 1.5
  );
  const hasCritical = critical.length > 0;

  let tx = self.x;
  let tz = self.y;

  // ── STRATEGY SELECTION ──

  // 1) Multiple simultaneous critical threats → weighted average coverage
  if (critical.length > 1) {
    let sumX = 0, sumW = 0;
    for (const c of critical) {
      const w = 1 / Math.max(0.08, c.timeToGoal);
      sumX += c.predXAtGoal * w;
      sumW += w;
    }
    const avgX = sumW > 0 ? sumX / sumW : 0;
    const pos = creaseEdge(avgX, isBlue);
    tx = pos.x;
    tz = pos.z;

    // If we can actually intercept the most urgent one, prefer that
    const mostUrgent = critical.reduce((a, b) => a.timeToGoal < b.timeToGoal ? a : b);
    if (mostUrgent.intercept) {
      const intDist = hypot(mostUrgent.intercept.x - self.x, mostUrgent.intercept.z - self.y);
      const reachTime = intDist / MAX_SPEED;
      if (reachTime < mostUrgent.intercept.t - 0.02) {
        tx = mostUrgent.intercept.x;
        tz = mostUrgent.intercept.z;
      }
    }
  }

  // 2) Single critical / high threat → intercept or block
  else if (hasCritical || (primary.movingToMe && primary.threat > 80)) {
    if (primary.intercept) {
      // We can intercept: aim to hit puck toward opponent's goal
      const intPt = primary.intercept;
      const distToInt = hypot(intPt.x - self.x, intPt.z - self.y);
      const reachTime = distToInt / MAX_SPEED;

      if (reachTime < intPt.t + 0.04) {
        // We have time — try to position for a controlled clear
        const shotX = bestShotX(primary.puck, opponent, isBlue);
        const behind = approachBehind(
          { x: intPt.x, y: intPt.z },
          shotX, oppGoalZ, 0.12
        );
        // Only use the approach angle if it's close to the intercept point
        const approachDist = hypot(behind.x - intPt.x, behind.z - intPt.z);
        if (approachDist < 1.5 && reachTime < intPt.t - 0.1) {
          tx = behind.x;
          tz = behind.z;
        } else {
          tx = intPt.x;
          tz = intPt.z;
        }
      } else {
        tx = intPt.x;
        tz = intPt.z;
      }
    } else {
      // Can't intercept — get on the crease edge to block
      const pos = creaseEdge(primary.predXAtGoal, isBlue);
      tx = pos.x;
      tz = pos.z;
    }

    // Very close puck rushing at us → commit aggressively
    if (primary.selfDist < 1.2 && primary.movingToMe) {
      tx = primary.puck.x;
      tz = primary.puck.y + (isBlue ? -1.2 : 1.2);
    }
  }

  // 3) Offensive opportunity
  else {
    const offense = pickOffense(analyses, self, isBlue);

    if (offense) {
      const shotX = bestShotX(offense.puck, opponent, isBlue);
      const behind = approachBehind(offense.puck, shotX, oppGoalZ, 0.18);
      tx = behind.x;
      tz = behind.z;

      // If very close to puck, charge through it
      if (offense.selfDist < 0.9) {
        tx = offense.puck.x + (shotX - offense.puck.x) * 0.3;
        tz = offense.puck.y + (isBlue ? -1.5 : 1.5);
      }
    }

    // 4) Puck in my half but no great offense → clear it
    else if (primary.inMyHalf) {
      const shotX = bestShotX(primary.puck, opponent, isBlue);
      const behind = approachBehind(primary.puck, shotX, oppGoalZ, 0.2);
      tx = behind.x;
      tz = behind.z;

      // Close and coming at us → aggressive deflect
      if (primary.selfDist < 1.0 && primary.movingToMe) {
        tx = primary.puck.x;
        tz = primary.puck.y + (isBlue ? -1.0 : 1.0);
      }
    }

    // 5) All pucks in opponent half → smart defensive positioning
    else {
      const dz = defenseZ(isBlue, pucks.length, false);
      const pred = predictAtZ(primary.path, dz, isBlue);
      tx = clamp(pred.x * 0.6, -2.5, 2.5);
      tz = dz;

      // Opponent about to shoot → tighten up to crease
      if (primary.oppDist < 2.0) {
        const shotPred = predictAtZ(primary.path, myGoalZ, isBlue);
        const pos = creaseEdge(shotPred.x * 0.55, isBlue);
        tx = pos.x;
        tz = pos.z;
      }

      // Multiple pucks and opponent active → stay tighter
      if (pucks.length >= 4 && primary.oppDist < 3.0) {
        const pos = creaseEdge(pred.x * 0.4, isBlue);
        tx = pos.x;
        tz = pos.z;
      }
    }
  }

  // ── Finalize movement ──
  const valid = validPaddlePos(tx, tz, isBlue);
  const dx = valid.x - self.x;
  const dz = valid.z - self.y;
  const dist = hypot(dx, dz);

  if (dist < 0.04) {
    // Already at target — subtle drift toward center for readiness
    const center = validPaddlePos(0, isBlue ? HALF_H - 5 : -HALF_H + 5, isBlue);
    const cdx = center.x - self.x;
    const cdz = center.z - self.y;
    const cd = hypot(cdx, cdz);
    return cd < 0.04 ? { x: 0, z: 0 } : { x: cdx / cd * 0.3, z: cdz / cd * 0.3 };
  }

  return { x: dx / dist, z: dz / dist };
}
