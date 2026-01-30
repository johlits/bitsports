export const id = "kimi-k2-5";
export const name = "Kimi K2.5";

// Elite AI with advanced multi-puck handling, physics-accurate prediction,
// corner-aware simulation, and adaptive offensive/defensive strategy

const TABLE_WIDTH = 10;
const TABLE_HEIGHT = 20;
const HALF_W = TABLE_WIDTH / 2;
const HALF_H = TABLE_HEIGHT / 2;
const CORNER_RADIUS = 1.0;

const GOAL_WIDTH = 4.0;
const GOAL_CREASE_RADIUS = 2.5;
const PADDLE_RADIUS = 0.35;
const PUCK_RADIUS = 0.25;

const MAX_PADDLE_SPEED = 6;
const FRICTION = 0.997;
const MIN_PUCK_SPEED = 0.5;

const DT_SIM = 0.016;
const PREDICTION_HORIZON = 3.5;

const PADDLE_X_LIMIT = HALF_W - PADDLE_RADIUS;
const BLUE_Z_MIN = 0;
const BLUE_Z_MAX = HALF_H - PADDLE_RADIUS;
const RED_Z_MIN = -HALF_H + PADDLE_RADIUS;
const RED_Z_MAX = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeVector(x, z) {
  const len = Math.hypot(x, z);
  if (len < 0.0001) return { x: 0, z: 0 };
  return { x: x / len, z: z / len };
}

function clampToBounds(x, z, isBlue) {
  const cx = clamp(x, -PADDLE_X_LIMIT, PADDLE_X_LIMIT);
  const cz = clamp(z, isBlue ? BLUE_Z_MIN : RED_Z_MIN, isBlue ? BLUE_Z_MAX : RED_Z_MAX);
  return { x: cx, z: cz };
}

function clampToRoundedCorners(x, z) {
  const cr = CORNER_RADIUS;
  const maxDist = cr - PADDLE_RADIUS;

  const corners = [
    { cx: HALF_W - cr + PADDLE_RADIUS, cz: HALF_H - cr + PADDLE_RADIUS },
    { cx: -HALF_W + cr - PADDLE_RADIUS, cz: HALF_H - cr + PADDLE_RADIUS },
    { cx: HALF_W - cr + PADDLE_RADIUS, cz: -HALF_H + cr - PADDLE_RADIUS },
    { cx: -HALF_W + cr - PADDLE_RADIUS, cz: -HALF_H + cr - PADDLE_RADIUS },
  ];

  let nx = x;
  let nz = z;

  for (const corner of corners) {
    const inCornerX = (corner.cx > 0 && nx > corner.cx) || (corner.cx < 0 && nx < corner.cx);
    const inCornerZ = (corner.cz > 0 && nz > corner.cz) || (corner.cz < 0 && nz < corner.cz);

    if (inCornerX && inCornerZ) {
      const dx = nx - corner.cx;
      const dz = nz - corner.cz;
      const dist = Math.hypot(dx, dz) || 0.0001;
      if (dist > maxDist) {
        const scale = maxDist / dist;
        nx = corner.cx + dx * scale;
        nz = corner.cz + dz * scale;
      }
    }
  }

  return { x: nx, z: nz };
}

function clampOutsideCrease(x, z, isBlue) {
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const dz = isBlue ? goalZ - z : z - goalZ;
  if (dz <= 0) return { x, z };

  const minDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.05;
  const distSq = x * x + dz * dz;
  if (distSq >= minDist * minDist) return { x, z };

  const dist = Math.sqrt(distSq) || 0.0001;
  const scale = minDist / dist;
  return {
    x: x * scale,
    z: isBlue ? goalZ - dz * scale : goalZ + dz * scale,
  };
}

function getValidPaddlePosition(x, z, isBlue) {
  let pos = clampToBounds(x, z, isBlue);
  pos = clampToRoundedCorners(pos.x, pos.z);
  pos = clampOutsideCrease(pos.x, pos.z, isBlue);
  pos = clampToBounds(pos.x, pos.z, isBlue);
  return pos;
}

function applyCornerReflection(state) {
  const cr = CORNER_RADIUS;
  const minDist = cr - PUCK_RADIUS;
  const corners = [
    { cx: HALF_W - cr, cz: HALF_H - cr },
    { cx: -HALF_W + cr, cz: HALF_H - cr },
    { cx: HALF_W - cr, cz: -HALF_H + cr },
    { cx: -HALF_W + cr, cz: -HALF_H + cr },
  ];

  for (const corner of corners) {
    const inCornerX = (corner.cx > 0 && state.x > corner.cx) || (corner.cx < 0 && state.x < corner.cx);
    const inCornerZ = (corner.cz > 0 && state.z > corner.cz) || (corner.cz < 0 && state.z < corner.cz);

    if (inCornerX && inCornerZ) {
      const dx = state.x - corner.cx;
      const dz = state.z - corner.cz;
      const dist = Math.hypot(dx, dz) || 0.0001;
      if (dist > minDist) {
        const nx = dx / dist;
        const nz = dz / dist;
        state.x = corner.cx + nx * minDist;
        state.z = corner.cz + nz * minDist;

        const dot = state.vx * nx + state.vz * nz;
        state.vx -= 2 * dot * nx;
        state.vz -= 2 * dot * nz;
        return true;
      }
    }
  }

  return false;
}

function simulatePuckPath(puck, timeHorizon) {
  const path = [];
  let x = puck.x;
  let z = puck.y;
  let vx = puck.velocity?.x ?? 0;
  let vz = puck.velocity?.y ?? 0;

  const wallX = HALF_W - PUCK_RADIUS;
  const wallZ = HALF_H - PUCK_RADIUS;

  for (let t = 0; t < timeHorizon; t += DT_SIM) {
    const speed = Math.hypot(vx, vz);
    if (speed > MIN_PUCK_SPEED) {
      vx *= FRICTION;
      vz *= FRICTION;
    } else if (speed > 0 && speed < MIN_PUCK_SPEED) {
      const scale = MIN_PUCK_SPEED / speed;
      vx *= scale;
      vz *= scale;
    }

    x += vx * DT_SIM;
    z += vz * DT_SIM;

    let goalSide = null;

    const state = { x, z, vx, vz };
    const hitCorner = applyCornerReflection(state);
    x = state.x;
    z = state.z;
    vx = state.vx;
    vz = state.vz;

    if (!hitCorner) {
      if (x <= -wallX && Math.abs(z) < HALF_H - CORNER_RADIUS) {
        x = -wallX;
        vx *= -1;
      }
      if (x >= wallX && Math.abs(z) < HALF_H - CORNER_RADIUS) {
        x = wallX;
        vx *= -1;
      }
    }

    if (z <= -wallZ) {
      if (Math.abs(x) < GOAL_WIDTH / 2) {
        goalSide = "red";
      } else if (Math.abs(x) < HALF_W - CORNER_RADIUS) {
        z = -wallZ;
        vz *= -1;
      }
    }

    if (z >= wallZ) {
      if (Math.abs(x) < GOAL_WIDTH / 2) {
        goalSide = "blue";
      } else if (Math.abs(x) < HALF_W - CORNER_RADIUS) {
        z = wallZ;
        vz *= -1;
      }
    }

    const step = { x, z, vx, vz, t: t + DT_SIM, goalSide };
    path.push(step);

    if (goalSide) break;
  }

  return path;
}

function findIntercept(path, self, isBlue) {
  const zMin = isBlue ? BLUE_Z_MIN : RED_Z_MIN;
  const zMax = isBlue ? BLUE_Z_MAX : RED_Z_MAX;
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const minCreaseDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.1;

  for (const p of path) {
    if (p.z < zMin || p.z > zMax) continue;

    const dz = isBlue ? goalZ - p.z : p.z - goalZ;
    if (dz > 0) {
      const distSq = p.x * p.x + dz * dz;
      if (distSq < minCreaseDist * minCreaseDist) continue;
    }

    const dist = Math.hypot(p.x - self.x, p.z - self.y);
    const timeToReach = dist / MAX_PADDLE_SPEED;
    if (timeToReach <= p.t - 0.05) {
      return { x: p.x, z: p.z, t: p.t };
    }
  }

  return null;
}

function predictAtZ(path, targetZ, isBlue) {
  for (const p of path) {
    if (isBlue ? p.z >= targetZ : p.z <= targetZ) return p;
  }
  return path.length ? path[path.length - 1] : { x: 0, z: targetZ, t: 0 };
}

function getCreaseEdgePosition(predX, isBlue) {
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const minDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.08;
  const clampedX = clamp(predX, -2.3, 2.3);
  const angle = Math.atan2(clampedX, minDist);
  return {
    x: Math.sin(angle) * minDist,
    z: isBlue ? goalZ - Math.cos(angle) * minDist : goalZ + Math.cos(angle) * minDist,
  };
}

function chooseShotTargetX(puck, opponent) {
  const goalHalf = GOAL_WIDTH / 2 - 0.25;
  
  // Aim away from opponent's position
  const awayFromOpponent = opponent.x >= 0 ? -1.6 : 1.6;
  
  // Add some bias based on puck position to use angles
  const angleBias = clamp(-puck.x * 0.4, -1.2, 1.2);
  
  // Blend strategies
  const mixed = awayFromOpponent * 0.75 + angleBias * 0.25;
  
  // Add small randomization to avoid predictability
  const jitter = (Math.random() - 0.5) * 0.2;
  
  return clamp(mixed + jitter, -goalHalf, goalHalf);
}

function approachBehindPuck(puck, targetX, targetZ, extra = 0.2) {
  const dx = targetX - puck.x;
  const dz = targetZ - puck.y;
  const len = Math.hypot(dx, dz) || 1;
  const behindDist = PADDLE_RADIUS + PUCK_RADIUS + extra;
  return {
    x: puck.x - (dx / len) * behindDist,
    z: puck.y - (dz / len) * behindDist,
  };
}

function analyzePuck(puck, self, opponent, isBlue) {
  const path = simulatePuckPath(puck, PREDICTION_HORIZON);
  const speed = Math.hypot(puck.velocity?.x ?? 0, puck.velocity?.y ?? 0);
  const movingTowardsMe = isBlue ? (puck.velocity?.y ?? 0) > 0.05 : (puck.velocity?.y ?? 0) < -0.05;
  const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;

  const myGoalSide = isBlue ? "blue" : "red";
  let timeToGoal = Infinity;
  let predXAtGoal = puck.x;
  let onTarget = false;

  for (const p of path) {
    if (p.goalSide) {
      if (p.goalSide === myGoalSide) {
        timeToGoal = p.t;
        predXAtGoal = p.x;
        onTarget = true;
      }
      break;
    }

    if (isBlue ? p.z >= HALF_H - PUCK_RADIUS : p.z <= -HALF_H + PUCK_RADIUS) {
      predXAtGoal = p.x;
      onTarget = Math.abs(p.x) <= GOAL_WIDTH / 2;
      break;
    }
  }

  const intercept = movingTowardsMe ? findIntercept(path, self, isBlue) : null;

  const distToGoal = Math.abs((isBlue ? HALF_H : -HALF_H) - puck.y);
  const selfDist = Math.hypot(puck.x - self.x, puck.y - self.y);
  const oppDist = Math.hypot(puck.x - opponent.x, puck.y - opponent.y);

  let threatScore = 0;
  if (movingTowardsMe) {
    if (timeToGoal < Infinity) threatScore += 150 / (timeToGoal + 0.1);
    if (onTarget) threatScore += 60;
    threatScore += speed * 5;
    threatScore += clamp(10 - distToGoal, -5, 10) * 4;
  }

  if (inMyHalf) threatScore += 20;
  threatScore += clamp(7 - selfDist, -7, 7) * 1.5;

  if (!inMyHalf && oppDist < 2.5) threatScore += 15;

  return {
    puck,
    path,
    speed,
    movingTowardsMe,
    inMyHalf,
    timeToGoal,
    predXAtGoal,
    onTarget,
    intercept,
    distToGoal,
    selfDist,
    threatScore,
  };
}

function chooseOffenseTarget(analyses, self, isBlue) {
  let best = null;
  let bestScore = -Infinity;

  for (const a of analyses) {
    if (!a.inMyHalf) continue;
    if (a.movingTowardsMe && a.timeToGoal < 1.5) continue;
    if (a.speed > 5.0) continue;

    const dist = Math.hypot(a.puck.x - self.x, a.puck.y - self.y);
    if (dist > 7.0) continue;

    // Prefer pucks that are easier to intercept and control
    const controlScore = (7.0 - dist) * 1.5 + (5.0 - a.speed);
    const positionScore = a.movingTowardsMe ? -2 : 3;
    const score = controlScore + positionScore;
    
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }

  return best;
}

function getDefensePosition(primary, isBlue) {
  const defenseZ = isBlue
    ? HALF_H - (GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.6)
    : -HALF_H + (GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.6);
  const pressZ = isBlue ? 3.0 : -3.0;
  
  // Adapt positioning based on threat level
  const isHighThreat = primary.speed > 4.0 || (primary.movingTowardsMe && primary.timeToGoal < 1.5);
  const guardZ = isHighThreat ? defenseZ : pressZ;
  
  const pred = predictAtZ(primary.path, guardZ, isBlue);
  return {
    x: clamp(pred.x, -2.8, 2.8),
    z: guardZ,
  };
}

export function tick({ pucks, self, opponent }) {
  if (!pucks || pucks.length === 0) return { x: 0, z: 0 };

  const isBlue = self.y > 0;
  const myGoalZ = isBlue ? HALF_H : -HALF_H;
  const oppGoalZ = isBlue ? -HALF_H : HALF_H;

  // Analyze all pucks
  const analyses = pucks.map((p) => analyzePuck(p, self, opponent, isBlue));
  analyses.sort((a, b) => b.threatScore - a.threatScore);

  const primary = analyses[0];
  let target = { x: self.x, z: self.y };

  if (!primary) {
    target = getCreaseEdgePosition(0, isBlue);
  } else {
    // Check for multiple critical threats
    const critical = analyses.filter(
      (a) => a.movingTowardsMe && a.onTarget && a.timeToGoal < 1.2
    );

    if (critical.length > 1) {
      // Multiple pucks threatening goal - position between them
      let sum = 0;
      let weight = 0;
      for (const t of critical) {
        const w = 1 / Math.max(0.15, t.timeToGoal);
        sum += t.predXAtGoal * w;
        weight += w;
      }
      const avgX = weight ? sum / weight : 0;
      target = getCreaseEdgePosition(avgX, isBlue);
    } else if (primary.movingTowardsMe && primary.timeToGoal < 0.9) {
      // Immediate threat - try to intercept
      if (primary.intercept) {
        target = primary.intercept;
      } else {
        // Can't intercept in time - get to crease edge
        target = getCreaseEdgePosition(primary.predXAtGoal, isBlue);
      }
    } else if (primary.movingTowardsMe && primary.intercept && primary.threatScore > 75) {
      // Significant threat - intercept
      target = primary.intercept;
    } else {
      // Look for offensive opportunity
      const offense = chooseOffenseTarget(analyses, self, isBlue);
      
      if (offense) {
        // Good offensive opportunity found
        const shotX = chooseShotTargetX(offense.puck, opponent);
        const approach = approachBehindPuck(offense.puck, shotX, oppGoalZ, 0.2);
        target = approach;
      } else if (primary.inMyHalf) {
        // Try to control puck in my half
        const shotX = chooseShotTargetX(primary.puck, opponent);
        const approach = approachBehindPuck(primary.puck, shotX, oppGoalZ, 0.22);
        target = approach;

        // If puck is very close and coming at us, be more aggressive
        const distToPuck = Math.hypot(primary.puck.x - self.x, primary.puck.y - self.y);
        if (distToPuck < 1.0 && primary.movingTowardsMe) {
          target = {
            x: primary.puck.x,
            z: primary.puck.y + (isBlue ? -1.0 : 1.0),
          };
        }
      } else {
        // Puck in opponent half - smart defensive positioning
        target = getDefensePosition(primary, isBlue);
        
        // Check if opponent is about to shoot
        const oppDist = Math.hypot(primary.puck.x - opponent.x, primary.puck.y - opponent.y);
        if (oppDist < 2.5) {
          // Opponent near puck - anticipate shot
          const shotPred = predictAtZ(primary.path, myGoalZ, isBlue);
          target = getCreaseEdgePosition(shotPred.x * 0.6, isBlue);
        }
      }
    }
  }

  // Ensure target is valid
  const valid = getValidPaddlePosition(target.x, target.z, isBlue);
  const dir = normalizeVector(valid.x - self.x, valid.z - self.y);

  if (dir.x === 0 && dir.z === 0) {
    // Already at target - hold position
    const fallback = getValidPaddlePosition(0, isBlue ? myGoalZ - 4.5 : myGoalZ + 4.5, isBlue);
    return normalizeVector(fallback.x - self.x, fallback.z - self.y);
  }

  return dir;
}
