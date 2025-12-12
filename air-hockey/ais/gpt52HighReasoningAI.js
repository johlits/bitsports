export const id = "gpt-5-2-high-reasoning";
export const name = "GPT-5.2 High Reasoning";

const TABLE_WIDTH = 10;
const TABLE_HEIGHT = 20;
const GOAL_WIDTH = 4.0;
const GOAL_CREASE_RADIUS = 2.5;
const PADDLE_RADIUS = 0.35;
const PUCK_RADIUS = 0.25;

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

function predictXAtZ(puck, targetZ) {
  const vx = puck.velocity?.x ?? 0;
  const vz = puck.velocity?.y ?? 0;

  if (Math.abs(vz) < 0.001) return puck.x;
  const t = (targetZ - puck.y) / vz;
  if (t <= 0) return puck.x;

  let x = puck.x + vx * t;
  const halfW = HALF_W - PUCK_RADIUS;

  let bounces = 0;
  while ((x > halfW || x < -halfW) && bounces < 12) {
    if (x > halfW) x = 2 * halfW - x;
    else if (x < -halfW) x = -2 * halfW - x;
    bounces++;
  }

  return clamp(x, -halfW, halfW);
}

function timeToZ(puck, targetZ) {
  const vz = puck.velocity?.y ?? 0;
  if (Math.abs(vz) < 0.001) return Infinity;

  const t = (targetZ - puck.y) / vz;
  return t > 0 ? t : Infinity;
}

function puckSpeed(puck) {
  const vx = puck.velocity?.x ?? 0;
  const vz = puck.velocity?.y ?? 0;
  return Math.hypot(vx, vz);
}

function isMovingTowardsGoal(puck, isBlue) {
  const vz = puck.velocity?.y ?? 0;
  return isBlue ? vz > 0 : vz < 0;
}

function assessThreat(puck, self, opponent, isBlue) {
  const myGoalZ = isBlue ? HALF_H : -HALF_H;
  const movingTowardsMe = isMovingTowardsGoal(puck, isBlue);
  const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;

  const speed = puckSpeed(puck);
  const tGoal = movingTowardsMe ? timeToZ(puck, myGoalZ) : Infinity;
  const distToGoal = Math.abs(myGoalZ - puck.y);
  const predXAtGoal = predictXAtZ(puck, myGoalZ);

  const onTarget = Math.abs(predXAtGoal) <= GOAL_WIDTH / 2;

  let score = 0;
  if (tGoal < Infinity) score += 120 / (tGoal + 0.08);
  score += clamp(10 - distToGoal, -10, 10);
  if (onTarget) score += 30;
  if (inMyHalf) score += 10;
  score += speed * 1.2;

  const oppDist = Math.hypot(puck.x - opponent.x, puck.y - opponent.y);
  if (!inMyHalf && oppDist < 2.0) score += 10;

  const selfDist = Math.hypot(puck.x - self.x, puck.y - self.y);
  score += clamp(8 - selfDist, -8, 8) * 0.5;

  return {
    puck,
    score,
    tGoal,
    speed,
    movingTowardsMe,
    inMyHalf,
    predXAtGoal,
  };
}

function choosePrimaryThreat(pucks, self, opponent, isBlue) {
  let best = null;
  for (const p of pucks) {
    const t = assessThreat(p, self, opponent, isBlue);
    if (!best || t.score > best.score) best = t;
  }
  return best;
}

function chooseOffenseCandidate(pucks, self, isBlue) {
  let best = null;
  for (const p of pucks) {
    const inMyHalf = isBlue ? p.y > 0 : p.y < 0;
    if (!inMyHalf) continue;

    const speed = puckSpeed(p);
    if (speed > 4.2) continue;

    const dist = Math.hypot(p.x - self.x, p.y - self.y);
    if (dist > 6.2) continue;

    const vz = p.velocity?.y ?? 0;
    if (isBlue ? vz > 0.2 : vz < -0.2) continue;

    const value = (6.2 - dist) + (4.2 - speed);
    if (!best || value > best.value) best = { puck: p, value };
  }
  return best?.puck ?? null;
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

  const primary = choosePrimaryThreat(pucks, self, opponent, isBlue);

  let targetX = self.x;
  let targetZ = self.y;

  if (!primary) {
    const pos = getCreaseEdgePosition(0, isBlue);
    targetX = pos.x;
    targetZ = pos.z;
  } else {
    const { puck, tGoal, speed, movingTowardsMe, inMyHalf } = primary;

    const emergency = tGoal < 0.85;
    if (emergency && movingTowardsMe) {
      const predX = predictXAtZ(puck, creaseEdgeZ);
      const pos = getCreaseEdgePosition(predX, isBlue);
      targetX = pos.x;
      targetZ = pos.z;
    } else {
      const offensePuck = chooseOffenseCandidate(pucks, self, isBlue);
      if (offensePuck) {
        const shotX = opponent.x >= 0 ? -1.7 : 1.7;
        const approach = calculateApproachBehindPuck(offensePuck, shotX, oppGoalZ);
        targetX = approach.x;
        targetZ = approach.z;
      } else if (inMyHalf) {
        const shotX = opponent.x >= 0 ? -1.8 : 1.8;
        const approach = calculateApproachBehindPuck(puck, shotX, oppGoalZ);
        targetX = approach.x;
        targetZ = approach.z;

        const distToPuck = Math.hypot(puck.x - self.x, puck.y - self.y);
        if (distToPuck < 1.35) {
          targetX = puck.x;
          targetZ = puck.y + (isBlue ? -1.2 : 1.2);
        }
      } else {
        const oppDistToPuck = Math.hypot(puck.x - opponent.x, puck.y - opponent.y);
        if (movingTowardsMe && oppDistToPuck < 2.0 && speed > 2.0) {
          const predX = predictXAtZ(puck, creaseEdgeZ);
          const pos = getCreaseEdgePosition(predX, isBlue);
          targetX = pos.x;
          targetZ = pos.z;
        } else {
          const guardZ = speed > 4.5 ? defenseZ : pressZ;
          const predX = predictXAtZ(puck, guardZ);
          targetX = clamp(predX, -(GOAL_WIDTH / 2 + 0.6), (GOAL_WIDTH / 2 + 0.6));
          targetZ = guardZ;
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
