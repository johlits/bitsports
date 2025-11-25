export const id = "claude-opus-4-5";
export const name = "Claude Opus 4.5";

// Elite AI with full crease awareness and advanced strategy
// Goal crease radius = 2.5, paddles cannot enter the half-circle in front of goals

const TABLE_WIDTH = 10;
const TABLE_HEIGHT = 20;
const GOAL_CREASE_RADIUS = 2.5;
const PADDLE_RADIUS = 0.35;
const PUCK_RADIUS = 0.25;

/**
 * Check if position is inside a goal crease
 */
function isInCrease(x, z, isBlue) {
  const goalZ = isBlue ? TABLE_HEIGHT / 2 : -TABLE_HEIGHT / 2;
  const dz = isBlue ? (goalZ - z) : (z - goalZ);
  if (dz <= 0) return false;
  const distSq = x * x + dz * dz;
  return distSq < (GOAL_CREASE_RADIUS + PADDLE_RADIUS) ** 2;
}

/**
 * Clamp position to stay outside crease
 */
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
    z: isBlue ? goalZ - dz * factor : goalZ + dz * factor
  };
}

/**
 * Get optimal defensive position at crease edge for a given predicted X
 */
function getCreaseEdgePosition(predX, isBlue) {
  const goalZ = isBlue ? TABLE_HEIGHT / 2 : -TABLE_HEIGHT / 2;
  const minDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.05;

  // Clamp X to goal coverage range
  const clampedX = Math.max(-2.2, Math.min(2.2, predX));

  // Calculate position on crease arc
  const angle = Math.atan2(clampedX, minDist);
  const edgeX = Math.sin(angle) * minDist;
  const edgeZ = isBlue ? goalZ - Math.cos(angle) * minDist : goalZ + Math.cos(angle) * minDist;

  return { x: edgeX, z: edgeZ };
}

/**
 * Predict puck X position at target Z with wall bounces
 */
function predictXAtZ(puck, targetZ) {
  const vz = puck.velocity.y;
  if (Math.abs(vz) < 0.001) return puck.x;

  const t = (targetZ - puck.y) / vz;
  if (t <= 0) return puck.x;

  let x = puck.x + puck.velocity.x * t;
  const halfW = TABLE_WIDTH / 2 - PUCK_RADIUS;

  // Simulate wall bounces
  let bounces = 0;
  while ((x > halfW || x < -halfW) && bounces < 10) {
    if (x > halfW) x = 2 * halfW - x;
    else if (x < -halfW) x = -2 * halfW - x;
    bounces++;
  }
  return Math.max(-halfW, Math.min(halfW, x));
}

/**
 * Predict puck position after time t
 */
function predictPuckPosition(puck, t) {
  if (t <= 0) return { x: puck.x, z: puck.y };

  let x = puck.x + puck.velocity.x * t;
  let z = puck.y + puck.velocity.y * t;
  const halfW = TABLE_WIDTH / 2 - PUCK_RADIUS;

  // Simulate X bounces
  let bounces = 0;
  while ((x > halfW || x < -halfW) && bounces < 10) {
    if (x > halfW) x = 2 * halfW - x;
    else if (x < -halfW) x = -2 * halfW - x;
    bounces++;
  }

  return { x: Math.max(-halfW, Math.min(halfW, x)), z };
}

/**
 * Assess threat level of each puck - returns sorted array
 */
function assessThreats(pucks, self, isBlue) {
  const goalZ = isBlue ? TABLE_HEIGHT / 2 : -TABLE_HEIGHT / 2;
  const threats = [];

  for (const p of pucks) {
    const movingTowardsMe = isBlue ? p.velocity.y > 0 : p.velocity.y < 0;
    const distToGoal = Math.abs(goalZ - p.y);
    const speedZ = Math.abs(p.velocity.y);
    const totalSpeed = Math.hypot(p.velocity.x, p.velocity.y);
    const inMyHalf = isBlue ? p.y > 0 : p.y < 0;

    let score = 0;

    if (movingTowardsMe && speedZ > 0.1) {
      const timeToGoal = distToGoal / speedZ;
      score += 80 / (timeToGoal + 0.05);
      score += totalSpeed * 3;

      // Proximity to goal bonus
      if (distToGoal < 5.0) score += 20;
      if (distToGoal < 3.0) score += 30;

      // Check if on target for goal
      const predX = predictXAtZ(p, goalZ);
      if (Math.abs(predX) < 2.0) score += 25;
    } else if (inMyHalf) {
      // Static threat in my half
      score += 15 - distToGoal * 0.5;
      if (totalSpeed < 0.5) score += 5; // Slow puck = opportunity
    } else {
      score -= 10;
    }

    if (inMyHalf) score += 10;

    const distToPuck = Math.hypot(p.x - self.x, p.y - self.y);
    threats.push({ puck: p, score, distToPuck, inMyHalf, movingTowardsMe, speed: totalSpeed });
  }

  threats.sort((a, b) => b.score - a.score);
  return threats;
}

/**
 * Calculate optimal approach position to hit puck toward target
 */
function calculateShotApproach(puck, targetX, targetZ) {
  const aimX = targetX - puck.x;
  const aimZ = targetZ - puck.y;
  const aimLen = Math.hypot(aimX, aimZ) || 1;

  // Position behind puck relative to target
  const behindDist = PADDLE_RADIUS + PUCK_RADIUS + 0.3;
  return {
    x: puck.x - (aimX / aimLen) * behindDist,
    z: puck.y - (aimZ / aimLen) * behindDist
  };
}

export function tick({ pucks, self, opponent, dt }) {
  if (!pucks || pucks.length === 0) return { x: 0, z: 0 };

  const isBlue = self.y > 0;
  const myGoalZ = isBlue ? TABLE_HEIGHT / 2 : -TABLE_HEIGHT / 2;
  const opponentGoalZ = isBlue ? -TABLE_HEIGHT / 2 : TABLE_HEIGHT / 2;
  const defenseLineZ = isBlue ? 5.5 : -5.5;

  // Analyze all threats
  const threats = assessThreats(pucks, self, isBlue);
  const primary = threats[0];

  let targetX = self.x;
  let targetZ = self.y;
  let speedMult = 1.0;

  if (!primary || primary.score < 5) {
    // LOW/NO THREAT: Look for offensive opportunity or hold position
    let foundOffense = false;

    for (const t of threats) {
      const p = t.puck;
      if (t.inMyHalf && t.speed < 2.5 && t.distToPuck < 6.0) {
        // Offensive opportunity - aim for opponent's weak side
        const shotTargetX = opponent.x > 0 ? -1.5 : 1.5;
        const approach = calculateShotApproach(p, shotTargetX, opponentGoalZ);
        targetX = approach.x;
        targetZ = approach.z;
        speedMult = 1.15;
        foundOffense = true;
        break;
      }
    }

    if (!foundOffense) {
      // Hold at crease edge, centered
      const pos = getCreaseEdgePosition(0, isBlue);
      targetX = pos.x;
      targetZ = pos.z;
    }

  } else {
    const puck = primary.puck;
    const { inMyHalf, movingTowardsMe, speed, distToPuck } = primary;

    if (primary.score > 50 || (inMyHalf && movingTowardsMe && speed > 1.5)) {
      // CRITICAL/HIGH THREAT: Intercept immediately

      // Calculate intercept point - meet puck before it reaches goal
      const timeToReach = distToPuck / 6.0; // Rough paddle speed estimate
      const futurePos = predictPuckPosition(puck, timeToReach * 0.7);

      // Clamp intercept Z to stay in front of crease
      const maxZ = isBlue ? 7.5 : -7.5;
      const interceptZ = isBlue
        ? Math.min(futurePos.z, maxZ)
        : Math.max(futurePos.z, maxZ);

      targetX = futurePos.x;
      targetZ = interceptZ;
      speedMult = 1.35;

      // Very close - commit to aggressive clear
      if (distToPuck < 1.3) {
        const clearZ = isBlue ? -2.5 : 2.5;
        targetX = puck.x;
        targetZ = puck.y + clearZ;
        speedMult = 1.4;
      }

    } else if (inMyHalf && speed > 0.3) {
      // MEDIUM THREAT: Controlled clear toward opponent weakness
      const shotTargetX = opponent.x > 0 ? -1.8 : 1.8;
      const approach = calculateShotApproach(puck, shotTargetX, opponentGoalZ);
      targetX = approach.x;
      targetZ = approach.z;
      speedMult = 1.1;

    } else if (inMyHalf) {
      // LOW THREAT: Approach puck for control
      targetX = puck.x;
      targetZ = puck.y;

    } else {
      // DEFENSIVE: Puck in opponent half - position at crease edge
      const predX = predictXAtZ(puck, isBlue ? 7.0 : -7.0);
      const pos = getCreaseEdgePosition(predX, isBlue);
      targetX = pos.x;
      targetZ = pos.z;

      // Opponent close to puck - they might shoot, tighten defense
      const oppDistToPuck = Math.hypot(puck.x - opponent.x, puck.y - opponent.y);
      if (oppDistToPuck < 2.0) {
        // Predict shot trajectory and position to block
        const shotPredX = predictXAtZ(puck, myGoalZ);
        const tightPos = getCreaseEdgePosition(shotPredX * 0.6, isBlue);
        targetX = tightPos.x;
        targetZ = tightPos.z;
        speedMult = 1.2;
      }
    }
  }

  // Final safety: ensure target is outside our crease
  const clamped = clampOutsideCrease(targetX, targetZ, isBlue);
  targetX = clamped.x;
  targetZ = clamped.z;

  // Calculate movement direction
  const dirX = targetX - self.x;
  const dirZ = targetZ - self.y;
  const len = Math.hypot(dirX, dirZ) || 1;

  return {
    x: (dirX / len) * speedMult,
    z: (dirZ / len) * speedMult
  };
}
