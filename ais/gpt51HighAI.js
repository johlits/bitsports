export const id = "gpt-5-1-high-priority";
export const name = "GPT 5.1 (high, priority)";

// High-skill multi-puck AI: aggressive intercepts and offensive clears
// Uses full board (10x20) and large goals (width ~4.0)
const TABLE_WIDTH = 10;
const TABLE_HEIGHT = 20;
const GOAL_CREASE_RADIUS = 2.5;
const PADDLE_RADIUS = 0.35;

function clampOutsideCrease(x, z, isBlue) {
  const goalZ = isBlue ? TABLE_HEIGHT / 2 : -TABLE_HEIGHT / 2;
  const dz = isBlue ? (goalZ - z) : (z - goalZ);
  if (dz <= 0) return { x, z };

  const distSq = x * x + dz * dz;
  const minDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS;
  if (distSq >= minDist * minDist) return { x, z };

  const dist = Math.sqrt(distSq) || 0.001;
  const factor = minDist / dist;
  return {
    x: x * factor,
    z: isBlue ? goalZ - dz * factor : goalZ + dz * factor,
  };
}

function getCreaseEdgePosition(predX, isBlue) {
  const goalZ = isBlue ? TABLE_HEIGHT / 2 : -TABLE_HEIGHT / 2;
  const minDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.1;

  const clampedX = Math.max(-3.0, Math.min(3.0, predX));

  const angle = Math.atan2(clampedX, minDist);
  const edgeX = Math.sin(angle) * minDist;
  const edgeZ = isBlue ? goalZ - Math.cos(angle) * minDist : goalZ + Math.cos(angle) * minDist;

  return { x: edgeX, z: edgeZ };
}

function predictXAtZ(puck, targetZ, tableWidth) {
  const vz = puck.velocity.y;
  if (Math.abs(vz) < 0.001) return puck.x;

  const t = (targetZ - puck.y) / vz;
  if (t <= 0) return puck.x;

  let x = puck.x + puck.velocity.x * t;
  const halfW = tableWidth / 2 - 0.25;

  // Fold with triangle-wave reflection inside [-halfW, halfW]
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

function pickThreatPuck(pucks, isBlue) {
  const goalZ = isBlue ? 10.0 : -10.0;
  let best = null;
  let bestScore = -Infinity;

  for (const p of pucks) {
    const movingTowardsMe = isBlue ? p.velocity.y > 0 : p.velocity.y < 0;
    const distToGoal = Math.abs(goalZ - p.y);
    const speedZ = Math.abs(p.velocity.y);

    let timeToGoal = Infinity;
    if (movingTowardsMe && speedZ > 0.1) {
      timeToGoal = distToGoal / speedZ;
    }

    // Score: earlier impact time and closeness to goal are bad for us => high score
    let score = 0;
    if (timeToGoal < Infinity) {
      score += 30 / (timeToGoal + 0.1);
    }
    score += Math.max(0, 10 - distToGoal);

    const inMyHalf = isBlue ? p.y > 0 : p.y < 0;
    if (inMyHalf) score += 5;
    if (!movingTowardsMe) score -= 4;

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return best || pucks[0];
}

export function tick({ pucks, self, opponent, dt }) {
  if (!pucks || pucks.length === 0) return { x: 0, z: 0 };

  const isBlue = self.y > 0;
  const goalZ = isBlue ? 10.0 : -10.0;
  const creaseEdgeZ = isBlue
    ? TABLE_HEIGHT / 2 - (GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.1)
    : -TABLE_HEIGHT / 2 + (GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.1);
  const defenseZ = isBlue ? 6.0 : -6.0;
  const tableWidth = TABLE_WIDTH;

  const puck = pickThreatPuck(pucks, isBlue);

  const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;
  const movingTowardsMe = isBlue ? puck.velocity.y > 0 : puck.velocity.y < 0;
  const speed = Math.hypot(puck.velocity.x, puck.velocity.y);

  const dx = puck.x - self.x;
  const dz = puck.y - self.y;
  const dist = Math.hypot(dx, dz);

  let targetX = self.x;
  let targetZ = self.y;

  if (inMyHalf && movingTowardsMe && speed > 0.4) {
    // INTERCEPT: meet at forward defense line
    const interceptZ = defenseZ;
    const vz = puck.velocity.y;
    const t = (interceptZ - puck.y) / vz;

    if (t > 0 && t < 2.0) {
      let predX = puck.x + puck.velocity.x * t;
      const halfW = tableWidth / 2 - 0.3;
      predX = Math.max(-halfW, Math.min(halfW, predX));
      targetX = predX;
      targetZ = interceptZ;
    } else {
      // Fallback: align at home, shadow X
      targetX = Math.max(-2.5, Math.min(2.5, puck.x));
      targetZ = creaseEdgeZ;
    }

    // Close enough: drive through the puck towards opponent goal
    if (dist < 1.4) {
      const pushDirZ = isBlue ? -1 : 1;
      targetX = puck.x;
      targetZ = puck.y + pushDirZ * 1.0;
    }
  } else if (inMyHalf) {
    // CLEARING / ATTACK: puck is in our half but not a high-speed threat
    targetX = puck.x;
    targetZ = puck.y;

    // Bank-shot aim: stand behind puck relative to chosen corner
    const cornerX = puck.x >= 0 ? -4.5 : 4.5;
    const cornerZ = isBlue ? -10.0 : 10.0;
    const aimDX = cornerX - puck.x;
    const aimDZ = cornerZ - puck.y;

    // Offset slightly behind puck along aim direction
    targetX = puck.x - Math.sign(aimDX) * 0.35;
    targetZ = puck.y - Math.sign(aimDZ) * 0.6;
  } else {
    // NEUTRAL / OFFENSIVE SHADOWING: puck is in opponent half
    // Pick a guard line depending on puck speed: deeper if fast
    const guardZ = speed > 4.0 ? creaseEdgeZ : defenseZ;
    let predX = predictXAtZ(puck, guardZ, tableWidth);

    // Clamp near goal width so we don't drift too far wide
    targetX = Math.max(-3.0, Math.min(3.0, predX));
    targetZ = guardZ;
  }

  const clamped = clampOutsideCrease(targetX, targetZ, isBlue);
  targetX = clamped.x;
  targetZ = clamped.z;

  const dirX = targetX - self.x;
  const dirZ = targetZ - self.y;
  const len = Math.hypot(dirX, dirZ) || 1;
  return { x: dirX / len, z: dirZ / len };
}
