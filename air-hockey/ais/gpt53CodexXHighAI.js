export const id = "gpt-5-3-codex-xhigh";
export const name = "GPT-5.3-Codex X-High";

// High-performance Air Hockey AI with multi-puck triage,
// physics-aware trajectory simulation, adaptive defense/offense,
// and side-safe state tracking for blue/red symmetry.

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
const BASE_HORIZON = 4.0;

const PX_LIMIT = HALF_W - PADDLE_R;
const BLUE_Z_MIN = 0;
const BLUE_Z_MAX = HALF_H - PADDLE_R;
const RED_Z_MIN = -(HALF_H - PADDLE_R);
const RED_Z_MAX = 0;

function makeSideState() {
  return {
    prevOpponent: null,
    prevSelf: null,
    opponentVel: { x: 0, z: 0 },
    selfVel: { x: 0, z: 0 },
    lastTarget: null,
    frames: 0,
  };
}

const sideState = {
  blue: makeSideState(),
  red: makeSideState(),
};

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

function clampBounds(x, z, isBlue) {
  return {
    x: clamp(x, -PX_LIMIT, PX_LIMIT),
    z: clamp(z, isBlue ? BLUE_Z_MIN : RED_Z_MIN, isBlue ? BLUE_Z_MAX : RED_Z_MAX),
  };
}

function pushOutCorner(x, z, radius) {
  const limit = CORNER_R - radius;
  const corners = [
    { cx: HALF_W - CORNER_R, cz: HALF_H - CORNER_R },
    { cx: -(HALF_W - CORNER_R), cz: HALF_H - CORNER_R },
    { cx: HALF_W - CORNER_R, cz: -(HALF_H - CORNER_R) },
    { cx: -(HALF_W - CORNER_R), cz: -(HALF_H - CORNER_R) },
  ];

  let rx = x;
  let rz = z;

  for (const c of corners) {
    const inX = c.cx > 0 ? rx > c.cx : rx < c.cx;
    const inZ = c.cz > 0 ? rz > c.cz : rz < c.cz;
    if (!inX || !inZ) continue;

    const dx = rx - c.cx;
    const dz = rz - c.cz;
    const d = hypot(dx, dz) || 1e-4;
    if (d > limit) {
      rx = c.cx + (dx / d) * limit;
      rz = c.cz + (dz / d) * limit;
    }
  }

  return { x: rx, z: rz };
}

function pushOutCrease(x, z, isBlue) {
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const dz = isBlue ? goalZ - z : z - goalZ;
  if (dz <= 0) return { x, z };

  const minDist = CREASE_R + PADDLE_R + 0.06;
  const dSq = x * x + dz * dz;
  if (dSq >= minDist * minDist) return { x, z };

  const d = Math.sqrt(dSq) || 1e-4;
  const scale = minDist / d;
  return {
    x: x * scale,
    z: isBlue ? goalZ - dz * scale : goalZ + dz * scale,
  };
}

function validPaddlePos(x, z, isBlue) {
  let p = clampBounds(x, z, isBlue);
  p = pushOutCorner(p.x, p.z, PADDLE_R);
  p = pushOutCrease(p.x, p.z, isBlue);
  p = clampBounds(p.x, p.z, isBlue);
  return p;
}

function reflectCorner(state) {
  const limit = CORNER_R - PUCK_R;
  const corners = [
    { cx: HALF_W - CORNER_R, cz: HALF_H - CORNER_R },
    { cx: -(HALF_W - CORNER_R), cz: HALF_H - CORNER_R },
    { cx: HALF_W - CORNER_R, cz: -(HALF_H - CORNER_R) },
    { cx: -(HALF_W - CORNER_R), cz: -(HALF_H - CORNER_R) },
  ];

  for (const c of corners) {
    const inX = c.cx > 0 ? state.x > c.cx : state.x < c.cx;
    const inZ = c.cz > 0 ? state.z > c.cz : state.z < c.cz;
    if (!inX || !inZ) continue;

    const dx = state.x - c.cx;
    const dz = state.z - c.cz;
    const d = hypot(dx, dz) || 1e-4;
    if (d <= limit) continue;

    const nx = dx / d;
    const nz = dz / d;
    state.x = c.cx + nx * limit;
    state.z = c.cz + nz * limit;

    const dot = state.vx * nx + state.vz * nz;
    state.vx -= 2 * dot * nx;
    state.vz -= 2 * dot * nz;
    return true;
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
    const speed = hypot(vx, vz);
    if (speed > MIN_PUCK_SPEED) {
      vx *= FRICTION;
      vz *= FRICTION;
    } else if (speed > 0 && speed < MIN_PUCK_SPEED) {
      const s = MIN_PUCK_SPEED / speed;
      vx *= s;
      vz *= s;
    } else if (speed === 0) {
      vx = MIN_PUCK_SPEED;
      vz = 0;
    }

    x += vx * SIM_DT;
    z += vz * SIM_DT;

    const st = { x, z, vx, vz };
    const cornerHit = reflectCorner(st);
    x = st.x;
    z = st.z;
    vx = st.vx;
    vz = st.vz;

    if (!cornerHit) {
      if (x <= -wallX && Math.abs(z) < HALF_H - CORNER_R) {
        x = -wallX;
        vx = -vx;
      }
      if (x >= wallX && Math.abs(z) < HALF_H - CORNER_R) {
        x = wallX;
        vx = -vx;
      }
    }

    let goalSide = null;
    if (z >= wallZ) {
      if (Math.abs(x) < HALF_GOAL) {
        goalSide = "blue";
      } else if (Math.abs(x) < cornerBound) {
        z = wallZ;
        vz = -vz;
      }
    } else if (z <= -wallZ) {
      if (Math.abs(x) < HALF_GOAL) {
        goalSide = "red";
      } else if (Math.abs(x) < cornerBound) {
        z = -wallZ;
        vz = -vz;
      }
    }

    path.push({ x, z, vx, vz, t: t + SIM_DT, goalSide });
    if (goalSide) break;
  }

  return path;
}

function findIntercept(path, self, isBlue, aggressive) {
  const zMin = isBlue ? BLUE_Z_MIN : RED_Z_MIN;
  const zMax = isBlue ? BLUE_Z_MAX : RED_Z_MAX;
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const minCreaseDist = CREASE_R + PADDLE_R + 0.1;

  let best = null;
  let bestScore = -Infinity;

  for (const p of path) {
    if (p.z < zMin || p.z > zMax) continue;

    const dz = isBlue ? goalZ - p.z : p.z - goalZ;
    if (dz > 0 && p.x * p.x + dz * dz < minCreaseDist * minCreaseDist) continue;

    const dist = hypot(p.x - self.x, p.z - self.y);
    const tReach = dist / MAX_SPEED;
    const buffer = aggressive ? 0.08 : 0.03;
    if (tReach > p.t + buffer) continue;

    const distFromGoal = isBlue ? HALF_H - p.z : p.z + HALF_H;
    const timeSlack = p.t - tReach;
    const laneBonus = Math.max(0, 1 - Math.abs(p.x) / 3.6);
    const score = distFromGoal * 3.4 + timeSlack * 8.5 - p.t * 2.4 + laneBonus * 1.5;

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

function creaseEdge(predX, isBlue, depthAdjust = 0) {
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const minDist = CREASE_R + PADDLE_R + 0.08 + depthAdjust;
  const cx = clamp(predX, -2.35, 2.35);
  const angle = Math.atan2(cx, minDist);

  return {
    x: Math.sin(angle) * minDist,
    z: isBlue ? goalZ - Math.cos(angle) * minDist : goalZ + Math.cos(angle) * minDist,
  };
}

function chooseShotX(puck, opponent, opponentVel, underPressure) {
  const predOppX = clamp(
    opponent.x + opponentVel.x * (underPressure ? 0.35 : 0.22),
    -PX_LIMIT,
    PX_LIMIT
  );

  const candidates = [-1.85, -1.4, -0.95, -0.35, 0.35, 0.95, 1.4, 1.85];
  let bestX = predOppX >= 0 ? -1.6 : 1.6;
  let bestScore = -Infinity;

  for (const x of candidates) {
    const separation = Math.abs(x - predOppX);
    const edgeBonus = Math.abs(x) * 0.35;
    const controlPenalty = Math.abs(x - puck.x) * 0.18;
    const centerPenalty = Math.abs(x) < 0.45 ? 0.35 : 0;
    const score = separation * 2.0 + edgeBonus - controlPenalty - centerPenalty;
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
    }
  }

  return clamp(bestX, -(HALF_GOAL - 0.2), HALF_GOAL - 0.2);
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

function driveThrough(puck, targetX, targetZ, pushDist) {
  const dx = targetX - puck.x;
  const dz = targetZ - puck.y;
  const len = hypot(dx, dz) || 1;
  const d = pushDist || 1.2;

  return {
    x: puck.x + (dx / len) * d,
    z: puck.y + (dz / len) * d,
  };
}

function analyzePuck(puck, self, opponent, isBlue, horizon) {
  const path = simulatePuck(puck, horizon);
  const vx = puck.velocity ? puck.velocity.x : 0;
  const vz = puck.velocity ? puck.velocity.y : 0;

  const speed = hypot(vx, vz);
  const movingToMe = isBlue ? vz > 0.05 : vz < -0.05;
  const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;

  const myGoalSide = isBlue ? "blue" : "red";
  const oppGoalSide = isBlue ? "red" : "blue";

  const selfDist = hypot(puck.x - self.x, puck.y - self.y);
  const oppDist = hypot(puck.x - opponent.x, puck.y - opponent.y);
  const distToGoal = Math.abs((isBlue ? HALF_H : -HALF_H) - puck.y);

  let timeToMyGoal = Infinity;
  let predXAtMyGoal = puck.x;
  let onTarget = false;

  for (const p of path) {
    if (p.goalSide === myGoalSide) {
      timeToMyGoal = p.t;
      predXAtMyGoal = p.x;
      onTarget = true;
      break;
    }

    const myGoalZ = isBlue ? HALF_H : -HALF_H;
    if (isBlue ? p.z >= myGoalZ - PUCK_R : p.z <= myGoalZ + PUCK_R) {
      predXAtMyGoal = p.x;
      onTarget = Math.abs(p.x) <= HALF_GOAL;
      break;
    }
  }

  let timeToOppGoal = Infinity;
  let scoringOppGoal = false;
  for (const p of path) {
    if (p.goalSide === oppGoalSide) {
      timeToOppGoal = p.t;
      scoringOppGoal = true;
      break;
    }
  }

  const intercept = movingToMe ? findIntercept(path, self, isBlue, true) : null;

  let threat = 0;
  if (movingToMe) {
    if (timeToMyGoal < Infinity) threat += 230 / (timeToMyGoal + 0.08);
    if (onTarget) threat += 75;
    threat += speed * 6.2;
    threat += clamp(11 - distToGoal, 0, 11) * 3.7;
  }

  if (inMyHalf) threat += 16;
  threat += clamp(6 - selfDist, 0, 6) * 2.0;

  if (!inMyHalf && oppDist < 2.2) threat += 18;
  if (!inMyHalf && oppDist < 1.3) threat += 20;

  if (scoringOppGoal) threat -= 20;

  let opportunity = 0;
  if (inMyHalf && !movingToMe) opportunity += 14;
  if (speed < 4.8) opportunity += 8;
  opportunity += clamp(5.5 - selfDist, 0, 5.5) * 1.9;
  if (scoringOppGoal) opportunity -= 24;

  return {
    puck,
    path,
    speed,
    movingToMe,
    inMyHalf,
    selfDist,
    oppDist,
    distToGoal,
    timeToMyGoal,
    predXAtMyGoal,
    onTarget,
    timeToOppGoal,
    scoringOppGoal,
    intercept,
    threat,
    opportunity,
  };
}

function pickOffense(analyses) {
  let best = null;
  let bestScore = -Infinity;

  for (const a of analyses) {
    if (!a.inMyHalf) continue;
    if (a.scoringOppGoal && a.timeToOppGoal < 1.4) continue;
    if (a.movingToMe && a.timeToMyGoal < 1.3) continue;
    if (a.speed > 7) continue;

    const control = (7 - Math.min(7, a.selfDist)) * 1.8 + (6.5 - Math.min(6.5, a.speed)) * 0.7;
    const centerBonus = (2.8 - Math.abs(a.puck.x)) * 0.55;
    const safeBonus = a.movingToMe ? -2.2 : 2.5;
    const score = control + centerBonus + safeBonus + a.opportunity;

    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }

  return best;
}

function defenseDepth(numPucks, highPressure) {
  const base = CREASE_R + PADDLE_R + 0.45;

  if (highPressure) {
    if (numPucks >= 5) return base + 0.9;
    if (numPucks >= 3) return base + 0.65;
    return base + 0.35;
  }

  if (numPucks >= 5) return base + 0.8;
  if (numPucks >= 3) return base + 0.45;
  return 4.6;
}

export function tick({ pucks, self, opponent, dt }) {
  if (!pucks || pucks.length === 0) return { x: 0, z: 0 };

  const isBlue = self.y > 0;
  const st = sideState[isBlue ? "blue" : "red"];
  st.frames++;

  const effDt = dt && dt > 0 ? clamp(dt, 0.008, 0.05) : SIM_DT;

  if (st.prevOpponent) {
    const rawVx = (opponent.x - st.prevOpponent.x) / effDt;
    const rawVz = (opponent.y - st.prevOpponent.y) / effDt;
    const a = 0.22;
    st.opponentVel.x = st.opponentVel.x * (1 - a) + rawVx * a;
    st.opponentVel.z = st.opponentVel.z * (1 - a) + rawVz * a;
  }
  st.prevOpponent = { x: opponent.x, y: opponent.y };

  if (st.prevSelf) {
    const rawVx = (self.x - st.prevSelf.x) / effDt;
    const rawVz = (self.y - st.prevSelf.y) / effDt;
    const a = 0.25;
    st.selfVel.x = st.selfVel.x * (1 - a) + rawVx * a;
    st.selfVel.z = st.selfVel.z * (1 - a) + rawVz * a;
  }
  st.prevSelf = { x: self.x, y: self.y };

  const myGoalZ = isBlue ? HALF_H : -HALF_H;
  const oppGoalZ = isBlue ? -HALF_H : HALF_H;
  const horizon = BASE_HORIZON + Math.min(1.2, pucks.length * 0.16);

  const analyses = pucks.map((p) => analyzePuck(p, self, opponent, isBlue, horizon));
  analyses.sort((a, b) => b.threat - a.threat);

  const primary = analyses[0];
  if (!primary) {
    const fallback = validPaddlePos(0, isBlue ? HALF_H - 4.8 : -HALF_H + 4.8, isBlue);
    const hold = normalize(fallback.x - self.x, fallback.z - self.y);
    return { x: hold.x, z: hold.z };
  }

  const critical = analyses.filter((a) => a.movingToMe && a.onTarget && a.timeToMyGoal < 1.45);
  const panic = critical.some((a) => a.timeToMyGoal < 0.55);

  let tx = self.x;
  let tz = self.y;

  if (critical.length > 1) {
    let sumX = 0;
    let sumW = 0;
    for (const c of critical) {
      const w = 1 / Math.max(0.08, c.timeToMyGoal);
      sumX += c.predXAtMyGoal * w;
      sumW += w;
    }

    const avgX = sumW > 0 ? sumX / sumW : 0;
    const block = creaseEdge(avgX, isBlue, panic ? -0.1 : 0);
    tx = block.x;
    tz = block.z;

    const urgent = critical.reduce((a, b) => (a.timeToMyGoal < b.timeToMyGoal ? a : b));
    if (urgent.intercept) {
      const d = hypot(urgent.intercept.x - self.x, urgent.intercept.z - self.y);
      const reach = d / MAX_SPEED;
      if (reach < urgent.intercept.t - (panic ? 0.01 : 0.05)) {
        tx = urgent.intercept.x;
        tz = urgent.intercept.z;
      }
    }
  } else if (critical.length === 1 || (primary.movingToMe && primary.threat > 86)) {
    const danger = critical[0] || primary;

    if (danger.intercept) {
      const d = hypot(danger.intercept.x - self.x, danger.intercept.z - self.y);
      const reach = d / MAX_SPEED;
      const shotX = chooseShotX(danger.puck, opponent, st.opponentVel, true);

      if (reach < danger.intercept.t - 0.08) {
        const behind = approachBehind({ x: danger.intercept.x, y: danger.intercept.z }, shotX, oppGoalZ, panic ? 0.08 : 0.12);
        if (hypot(behind.x - danger.intercept.x, behind.z - danger.intercept.z) < 1.6) {
          tx = behind.x;
          tz = behind.z;
        } else {
          tx = danger.intercept.x;
          tz = danger.intercept.z;
        }
      } else {
        tx = danger.intercept.x;
        tz = danger.intercept.z;
      }
    } else {
      const block = creaseEdge(danger.predXAtMyGoal, isBlue, panic ? -0.1 : 0);
      tx = block.x;
      tz = block.z;
    }

    if (danger.selfDist < 1.1 && danger.movingToMe) {
      const shotX = chooseShotX(danger.puck, opponent, st.opponentVel, true);
      const drive = driveThrough(danger.puck, shotX, oppGoalZ, 1.25);
      tx = drive.x;
      tz = drive.z;
    }
  } else {
    const offense = pickOffense(analyses);

    if (offense) {
      if (offense.scoringOppGoal && offense.timeToOppGoal < 1.1) {
        const depth = defenseDepth(pucks.length, false);
        const guardZ = isBlue ? HALF_H - depth : -HALF_H + depth;
        const pred = predictAtZ(primary.path, guardZ, isBlue);
        tx = clamp(pred.x * 0.5, -2.6, 2.6);
        tz = guardZ;
      } else {
        const shotX = chooseShotX(offense.puck, opponent, st.opponentVel, false);
        const behind = approachBehind(offense.puck, shotX, oppGoalZ, 0.16);
        tx = behind.x;
        tz = behind.z;

        if (offense.selfDist < 0.95) {
          const drive = driveThrough(offense.puck, shotX, oppGoalZ, 1.45);
          tx = drive.x;
          tz = drive.z;
        }
      }
    } else if (primary.inMyHalf) {
      const shotX = chooseShotX(primary.puck, opponent, st.opponentVel, false);
      const behind = approachBehind(primary.puck, shotX, oppGoalZ, 0.2);
      tx = behind.x;
      tz = behind.z;

      if (primary.selfDist < 1.0 && primary.movingToMe) {
        const drive = driveThrough(primary.puck, shotX, oppGoalZ, 1.2);
        tx = drive.x;
        tz = drive.z;
      }
    } else {
      const pressure = primary.oppDist < 2.2 || pucks.length >= 4;
      const depth = defenseDepth(pucks.length, pressure);
      const guardZ = isBlue ? HALF_H - depth : -HALF_H + depth;
      const pred = predictAtZ(primary.path, guardZ, isBlue);

      tx = clamp(pred.x * (pressure ? 0.75 : 0.55), -2.8, 2.8);
      tz = guardZ;

      if (primary.oppDist < 1.6) {
        const shotPred = predictAtZ(primary.path, myGoalZ, isBlue);
        const block = creaseEdge(shotPred.x * 0.65, isBlue, -0.05);
        tx = block.x;
        tz = block.z;
      }
    }
  }

  let valid = validPaddlePos(tx, tz, isBlue);

  if (st.lastTarget && !panic) {
    const smoothing = pucks.length >= 4 ? 0.62 : 0.72;
    valid = {
      x: lerp(st.lastTarget.x, valid.x, smoothing),
      z: lerp(st.lastTarget.z, valid.z, smoothing),
    };
    valid = validPaddlePos(valid.x, valid.z, isBlue);
  }

  st.lastTarget = valid;

  const dx = valid.x - self.x;
  const dz = valid.z - self.y;
  const d = hypot(dx, dz);

  if (d < 0.03) {
    const home = validPaddlePos(0, isBlue ? HALF_H - 4.9 : -HALF_H + 4.9, isBlue);
    const h = normalize(home.x - self.x, home.z - self.y);
    return { x: h.x * 0.3, z: h.z * 0.3 };
  }

  const dir = normalize(dx, dz);
  return { x: dir.x, z: dir.z };
}
