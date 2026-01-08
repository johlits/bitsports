export const id = "gpt-5-2-high-reasoning";
export const name = "GPT-5.2 High Reasoning";

const TABLE_WIDTH = 10;
const TABLE_HEIGHT = 20;
const GOAL_WIDTH = 4.0;
const GOAL_CREASE_RADIUS = 2.5;
const PADDLE_RADIUS = 0.35;
const PUCK_RADIUS = 0.25;
 const MAX_PADDLE_SPEED = 6;
 const FRICTION = 0.997;
 const MIN_PUCK_SPEED = 0.5;

const HALF_W = TABLE_WIDTH / 2;
const HALF_H = TABLE_HEIGHT / 2;
const PADDLE_X_LIMIT = HALF_W - PADDLE_RADIUS;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function clampOutsideCrease(x, z, isBlue) {
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const dz = isBlue ? (goalZ - z) : (z - goalZ);
  if (dz <= 0) return { x, z };

  const distSq = x * x + dz * dz;
  const minDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.05;
  if (distSq >= minDist * minDist) return { x, z };

  const dist = Math.sqrt(distSq) || 0.001;
  const factor = minDist / dist;
  return {
    x: x * factor,
    z: isBlue ? goalZ - dz * factor : goalZ + dz * factor,
  };
}

function clampToHalfAndWalls(x, z, isBlue) {
  const clampedX = clamp(x, -PADDLE_X_LIMIT, PADDLE_X_LIMIT);
  const zMin = isBlue ? 0 : -9.65;
  const zMax = isBlue ? 9.65 : 0;

  return { x: clampedX, z: clamp(z, zMin, zMax) };
}

function getCreaseEdgePosition(predX, isBlue) {
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const minDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.08;

  const clampedX = clamp(predX, -(GOAL_WIDTH / 2 + 0.4), (GOAL_WIDTH / 2 + 0.4));
  const angle = Math.atan2(clampedX, minDist);

  const edgeX = Math.sin(angle) * minDist;
  const edgeZ = isBlue ? goalZ - Math.cos(angle) * minDist : goalZ + Math.cos(angle) * minDist;

  return { x: edgeX, z: edgeZ };
}

function puckSpeed(puck) {
  const vx = puck.velocity?.x ?? 0;
  const vz = puck.velocity?.y ?? 0;
  return Math.hypot(vx, vz);
}

function isMovingTowardsMyGoal(puck, isBlue) {
  const vz = puck.velocity?.y ?? 0;
  return isBlue ? vz > 0.1 : vz < -0.1;
}

function simulatePuckPath(puck, maxTime, dt) {
  const path = [];
  let x = puck.x;
  let z = puck.y;
  let vx = puck.velocity?.x ?? 0;
  let vz = puck.velocity?.y ?? 0;
  const wallX = HALF_W - PUCK_RADIUS;
  const wallZ = HALF_H - PUCK_RADIUS;

  for (let t = 0; t < maxTime; t += dt) {
    const speed = Math.hypot(vx, vz);
    if (speed > MIN_PUCK_SPEED) {
      vx *= FRICTION;
      vz *= FRICTION;
    }

    x += vx * dt;
    z += vz * dt;

    if (x > wallX) {
      x = 2 * wallX - x;
      vx = -vx;
    } else if (x < -wallX) {
      x = -2 * wallX - x;
      vx = -vx;
    }

    if (z > wallZ) {
      if (Math.abs(x) > GOAL_WIDTH / 2) {
        z = 2 * wallZ - z;
        vz = -vz;
      }
    } else if (z < -wallZ) {
      if (Math.abs(x) > GOAL_WIDTH / 2) {
        z = -2 * wallZ - z;
        vz = -vz;
      }
    }

    path.push({ x, z, vx, vz, t: t + dt });
  }

  return path;
}

function predictAtZ(puck, targetZ, isBlue) {
  const path = simulatePuckPath(puck, 2.6, 0.016);
  for (const p of path) {
    if (isBlue) {
      if (p.z >= targetZ) return p;
    } else {
      if (p.z <= targetZ) return p;
    }
  }
  return path.length ? path[path.length - 1] : { x: puck.x, z: puck.y, vx: 0, vz: 0, t: 0 };
}

function timeToReach(self, x, z) {
  return Math.hypot(x - self.x, z - self.y) / MAX_PADDLE_SPEED;
}

function findBestIntercept(puck, self, isBlue) {
  const path = simulatePuckPath(puck, 2.2, 0.016);
  const zMin = isBlue ? 0 : -9.65;
  const zMax = isBlue ? 9.65 : 0;
  
  let best = null;
  let bestScore = -Infinity;

  for (const p of path) {
    if (p.z < zMin || p.z > zMax) continue;
    const tReach = timeToReach(self, p.x, p.z);
    if (tReach > p.t + 0.08) continue;

    const distToGoal = isBlue ? (HALF_H - p.z) : (p.z + HALF_H);
    const score = distToGoal * 3 - p.t * 14;
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best;
}

function assessThreat(puck, self, opponent, isBlue) {
  const myGoalZ = isBlue ? HALF_H : -HALF_H;
  const movingTowardsMe = isMovingTowardsMyGoal(puck, isBlue);
  const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;
  const speed = puckSpeed(puck);

  const predAtGoal = movingTowardsMe ? predictAtZ(puck, myGoalZ, isBlue) : null;
  const tGoal = predAtGoal ? predAtGoal.t : Infinity;
  const predXAtGoal = predAtGoal ? predAtGoal.x : puck.x;
  const onTarget = predAtGoal ? Math.abs(predXAtGoal) <= GOAL_WIDTH / 2 + 0.35 : false;
  const distToGoalNow = Math.abs(myGoalZ - puck.y);

  let score = 0;
  if (tGoal < Infinity) score += 140 / (tGoal + 0.08);
  if (onTarget) score += 45;
  if (distToGoalNow < 5.0) score += 25;
  if (distToGoalNow < 3.0) score += 35;
  if (inMyHalf) score += 15;
  score += speed * 4;

  const oppDist = Math.hypot(puck.x - opponent.x, puck.y - opponent.y);
  if (!inMyHalf && oppDist < 2.0) score += 18;

  const selfDist = Math.hypot(puck.x - self.x, puck.y - self.y);
  score += clamp(7 - selfDist, -7, 7) * 1.2;

  const intercept = movingTowardsMe ? findBestIntercept(puck, self, isBlue) : null;

  return {
    puck,
    score,
    tGoal,
    speed,
    movingTowardsMe,
    inMyHalf,
    predXAtGoal,
    onTarget,
    intercept,
  };
}

function assessAllThreats(pucks, self, opponent, isBlue) {
  const threats = [];
  for (const p of pucks) {
    threats.push(assessThreat(p, self, opponent, isBlue));
  }
  threats.sort((a, b) => b.score - a.score);
  return threats;
}

function chooseOffenseCandidate(threats, self, isBlue) {
  let best = null;
  for (const t of threats) {
    const p = t.puck;
    const inMyHalf = isBlue ? p.y > 0 : p.y < 0;
    if (!inMyHalf) continue;
    if (t.movingTowardsMe && t.tGoal < 1.4) continue;
    if (t.speed > 3.8) continue;

    const dist = Math.hypot(p.x - self.x, p.y - self.y);
    if (dist > 6.0) continue;

    const value = (6.0 - dist) + (3.8 - t.speed) + (t.movingTowardsMe ? -1 : 1);
    if (!best || value > best.value) best = { puck: p, value };
  }
  return best ? best.puck : null;
}

function shotTargetX(opponentX) {
  const x = opponentX >= 0 ? -1.7 : 1.7;
  return clamp(x, -(GOAL_WIDTH / 2 - 0.1), (GOAL_WIDTH / 2 - 0.1));
}

function calculateApproachBehindPuck(puck, targetX, targetZ) {
  const aimX = targetX - puck.x;
  const aimZ = targetZ - puck.y;
  const aimLen = Math.hypot(aimX, aimZ) || 1;
  const behindDist = PADDLE_RADIUS + PUCK_RADIUS + 0.28;
  return {
    x: puck.x - (aimX / aimLen) * behindDist,
    z: puck.y - (aimZ / aimLen) * behindDist,
  };
}

export function tick({ pucks, self, opponent, dt }) {
  if (!pucks || pucks.length === 0) return { x: 0, z: 0 };

  const isBlue = self.y > 0;
  const myGoalZ = isBlue ? HALF_H : -HALF_H;
  const oppGoalZ = isBlue ? -HALF_H : HALF_H;

  const creaseEdgeZ = isBlue
    ? HALF_H - (GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.08)
    : -HALF_H + (GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.08);

  const defenseZ = isBlue ? 5.8 : -5.8;
  const pressZ = isBlue ? 2.2 : -2.2;

  const threats = assessAllThreats(pucks, self, opponent, isBlue);
  const primary = threats[0];

  let targetX = self.x;
  let targetZ = self.y;

  if (!primary) {
    const pos = getCreaseEdgePosition(0, isBlue);
    targetX = pos.x;
    targetZ = pos.z;
  } else {
    const { puck, tGoal, speed, movingTowardsMe, inMyHalf, predXAtGoal, intercept, onTarget } = primary;

    const critical = threats.filter((t) => t.score > 90 && t.movingTowardsMe && t.tGoal < 1.2);
    if (critical.length > 1) {
      let sum = 0;
      let wsum = 0;
      for (const t of critical) {
        const w = 1 / Math.max(0.15, t.tGoal);
        sum += t.predXAtGoal * w;
        wsum += w;
      }
      const avgX = wsum ? sum / wsum : 0;
      const pos = getCreaseEdgePosition(avgX, isBlue);
      targetX = pos.x;
      targetZ = pos.z;
    } else {
      const emergency = movingTowardsMe && tGoal < 0.85 && onTarget;
      if (emergency) {
        if (intercept) {
          targetX = intercept.x;
          targetZ = intercept.z;
        } else {
          const pos = getCreaseEdgePosition(predXAtGoal, isBlue);
          targetX = pos.x;
          targetZ = pos.z;
        }
      } else {
        const offensePuck = chooseOffenseCandidate(threats, self, isBlue);
        if (offensePuck) {
          const approach = calculateApproachBehindPuck(offensePuck, shotTargetX(opponent.x), oppGoalZ);
          targetX = approach.x;
          targetZ = approach.z;
        } else if (inMyHalf) {
          const approach = calculateApproachBehindPuck(puck, shotTargetX(opponent.x), oppGoalZ);
          targetX = approach.x;
          targetZ = approach.z;

          const distToPuck = Math.hypot(puck.x - self.x, puck.y - self.y);
          if (distToPuck < 1.25) {
            targetX = puck.x;
            targetZ = puck.y + (isBlue ? -1.25 : 1.25);
          }
        } else {
          const oppDistToPuck = Math.hypot(puck.x - opponent.x, puck.y - opponent.y);
          if (movingTowardsMe && oppDistToPuck < 2.0 && speed > 2.0) {
            const pos = getCreaseEdgePosition(predXAtGoal, isBlue);
            targetX = pos.x;
            targetZ = pos.z;
          } else {
            const guardZ = speed > 4.5 ? defenseZ : pressZ;
            const pred = predictAtZ(puck, guardZ, isBlue);
            targetX = clamp(pred.x, -(GOAL_WIDTH / 2 + 0.6), (GOAL_WIDTH / 2 + 0.6));
            targetZ = guardZ;
          }
        }
      }
    }
  }

  let clamped = clampToHalfAndWalls(targetX, targetZ, isBlue);
  clamped = clampOutsideCrease(clamped.x, clamped.z, isBlue);
  clamped = clampToHalfAndWalls(clamped.x, clamped.z, isBlue);

  const dirX = clamped.x - self.x;
  const dirZ = clamped.z - self.y;
  const len = Math.hypot(dirX, dirZ);
  if (!len || len < 0.001) return { x: 0, z: 0 };

  return { x: dirX / len, z: dirZ / len };
}
