export const id = "gpt-5-1-codex-max-low";
export const name = "GPT-5.1-Codex Max Low";

// Hybrid defensive-offensive AI tuned for wide goals and multi-puck chaos.
// Priorities:
// 1) Stop imminent goals with crease-edge positioning.
// 2) Intercept approaching pucks early at a forward defense line.
// 3) When safe, clear or press forward with controlled pushes.

const TABLE_WIDTH = 10;
const TABLE_HEIGHT = 20;
const GOAL_CREASE_RADIUS = 2.5;
const PADDLE_RADIUS = 0.35;

function clampOutsideCrease(x, z, isBlue) {
  const goalZ = isBlue ? TABLE_HEIGHT / 2 : -TABLE_HEIGHT / 2;
  const dz = isBlue ? goalZ - z : z - goalZ;
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

function predictXAtZ(puck, targetZ) {
  const vz = puck.velocity.y;
  if (Math.abs(vz) < 0.001) return puck.x;

  const t = (targetZ - puck.y) / vz;
  if (t <= 0) return puck.x;

  let x = puck.x + puck.velocity.x * t;
  const halfW = TABLE_WIDTH / 2 - 0.3;
  while (x > halfW || x < -halfW) {
    if (x > halfW) {
      const over = x - halfW;
      x = halfW - over;
    } else if (x < -halfW) {
      const over = -halfW - x;
      x = -halfW + over;
    }
  }
  return x;
}

function timeToGoalLine(puck, isBlue) {
  const goalZ = isBlue ? TABLE_HEIGHT / 2 : -TABLE_HEIGHT / 2;
  const vz = puck.velocity.y;
  const dz = goalZ - puck.y;
  if ((isBlue && vz <= 0) || (!isBlue && vz >= 0)) return Infinity;
  if (Math.abs(vz) < 0.001) return Infinity;
  const t = dz / vz;
  return t > 0 ? t : Infinity;
}

function pickThreatPuck(pucks, isBlue) {
  let best = pucks[0];
  let bestScore = -Infinity;
  const goalZ = isBlue ? TABLE_HEIGHT / 2 : -TABLE_HEIGHT / 2;

  for (const p of pucks) {
    const tGoal = timeToGoalLine(p, isBlue);
    const distToGoal = Math.abs(goalZ - p.y);
    const movingTowards = isBlue ? p.velocity.y > 0 : p.velocity.y < 0;
    const inMyHalf = isBlue ? p.y > 0 : p.y < 0;
    const speed = Math.hypot(p.velocity.x, p.velocity.y);

    let score = 0;
    if (tGoal < Infinity) score += 50 / (tGoal + 0.1);
    score += Math.max(0, 14 - distToGoal);
    if (movingTowards) score += speed * 3;
    if (inMyHalf) score += 6;
    else score -= 4;

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best;
}

export function tick({ pucks, self, opponent, dt }) {
  if (!pucks || pucks.length === 0) return { x: 0, z: 0 };

  const isBlue = self.y > 0;
  const goalZ = isBlue ? TABLE_HEIGHT / 2 : -TABLE_HEIGHT / 2;
  const homeZ = isBlue ? 8.8 : -8.8;
  const defenseZ = isBlue ? 6.3 : -6.3;
  const pressZ = isBlue ? 2.0 : -2.0;

  const puck = pickThreatPuck(pucks, isBlue);
  const movingTowards = isBlue ? puck.velocity.y > 0 : puck.velocity.y < 0;
  const speed = Math.hypot(puck.velocity.x, puck.velocity.y);
  const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;
  const tGoal = timeToGoalLine(puck, isBlue);

  let targetX = self.x;
  let targetZ = self.y;

  // 1) Emergency save at crease edge
  if (tGoal < 0.9 && movingTowards) {
    const edgeZ = isBlue
      ? TABLE_HEIGHT / 2 - (GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.1)
      : -TABLE_HEIGHT / 2 + (GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.1);
    targetZ = edgeZ;
    targetX = predictXAtZ(puck, edgeZ);
  }
  // 2) Forward intercept
  else if (inMyHalf && movingTowards && speed > 0.35) {
    const interceptZ = defenseZ;
    const vz = puck.velocity.y;
    if (Math.abs(vz) > 0.001) {
      const t = (interceptZ - puck.y) / vz;
      if (t > 0 && t < 2.5) {
        targetX = predictXAtZ(puck, interceptZ);
        targetZ = interceptZ;
      } else {
        targetX = Math.max(-3.0, Math.min(3.0, puck.x));
        targetZ = homeZ;
      }
    } else {
      targetX = Math.max(-2.5, Math.min(2.5, puck.x));
      targetZ = defenseZ;
    }

    // If close enough, drive through puck toward opponent
    const dist = Math.hypot(puck.x - self.x, puck.y - self.y);
    if (dist < 1.3) {
      targetX = puck.x;
      targetZ = puck.y + (isBlue ? -1.1 : 1.1);
    }
  }
  // 3) Clear when safe in our half
  else if (inMyHalf) {
    targetX = puck.x;
    targetZ = puck.y;
  }
  // 4) Guard and light press when puck is far
  else {
    targetZ = Math.abs(puck.velocity.y) > 3.5 ? defenseZ : pressZ;
    targetX = predictXAtZ(puck, targetZ);
  }

  const clamped = clampOutsideCrease(targetX, targetZ, isBlue);
  targetX = clamped.x;
  targetZ = clamped.z;

  const dirX = targetX - self.x;
  const dirZ = targetZ - self.y;
  const len = Math.hypot(dirX, dirZ) || 1;
  return { x: dirX / len, z: dirZ / len };
}
