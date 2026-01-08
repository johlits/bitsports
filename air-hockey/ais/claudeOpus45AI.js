export const id = "claude-opus-4-5";
export const name = "Claude Opus 4.5";

// Elite AI with advanced multi-puck handling, physics-accurate prediction, and strategic play
// Optimized for the Bitsports air hockey engine

const TABLE_WIDTH = 10;
const TABLE_HEIGHT = 20;
const HALF_W = TABLE_WIDTH / 2;
const HALF_H = TABLE_HEIGHT / 2;
const GOAL_WIDTH = 4.0;
const GOAL_CREASE_RADIUS = 2.5;
const PADDLE_RADIUS = 0.35;
const PUCK_RADIUS = 0.25;
const MAX_PADDLE_SPEED = 6;
const FRICTION = 0.997;
const MIN_PUCK_SPEED = 0.5;
const COLLISION_DIST = PADDLE_RADIUS + PUCK_RADIUS;

/**
 * Clamp position to stay outside goal crease
 */
function clampOutsideCrease(x, z, isBlue) {
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const dz = isBlue ? (goalZ - z) : (z - goalZ);
  if (dz <= 0) return { x, z };

  const distSq = x * x + dz * dz;
  const minDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.02;
  if (distSq >= minDist * minDist) return { x, z };

  const dist = Math.sqrt(distSq) || 0.001;
  const factor = minDist / dist;
  return {
    x: x * factor,
    z: isBlue ? goalZ - dz * factor : goalZ + dz * factor
  };
}

/**
 * Clamp to valid paddle boundaries
 */
function clampToBounds(x, z, isBlue) {
  const xLimit = HALF_W - PADDLE_RADIUS;
  const zMin = isBlue ? 0 : -(HALF_H - PADDLE_RADIUS);
  const zMax = isBlue ? (HALF_H - PADDLE_RADIUS) : 0;
  return {
    x: Math.max(-xLimit, Math.min(xLimit, x)),
    z: Math.max(zMin, Math.min(zMax, z))
  };
}

/**
 * Get optimal defensive position at crease edge
 */
function getCreaseEdgePosition(predX, isBlue) {
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const minDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.05;
  const clampedX = Math.max(-2.0, Math.min(2.0, predX));
  const angle = Math.atan2(clampedX, minDist);
  return {
    x: Math.sin(angle) * minDist,
    z: isBlue ? goalZ - Math.cos(angle) * minDist : goalZ + Math.cos(angle) * minDist
  };
}

/**
 * Physics-accurate puck trajectory prediction with friction and wall bounces
 */
function simulatePuckPath(puck, maxTime, dt = 0.016) {
  const path = [];
  let x = puck.x;
  let z = puck.y;
  let vx = puck.velocity.x;
  let vz = puck.velocity.y;
  const wallX = HALF_W - PUCK_RADIUS;
  const wallZ = HALF_H - PUCK_RADIUS;

  for (let t = 0; t < maxTime; t += dt) {
    // Apply friction
    const speed = Math.hypot(vx, vz);
    if (speed > MIN_PUCK_SPEED) {
      vx *= FRICTION;
      vz *= FRICTION;
    }

    // Move
    x += vx * dt;
    z += vz * dt;

    // Wall bounces (X)
    if (x > wallX) { x = 2 * wallX - x; vx = -vx; }
    else if (x < -wallX) { x = -2 * wallX - x; vx = -vx; }

    // Wall bounces (Z) - but not through goals
    if (z > wallZ) {
      if (Math.abs(x) > GOAL_WIDTH / 2) { z = 2 * wallZ - z; vz = -vz; }
    } else if (z < -wallZ) {
      if (Math.abs(x) > GOAL_WIDTH / 2) { z = -2 * wallZ - z; vz = -vz; }
    }

    path.push({ x, z, vx, vz, t: t + dt });
  }
  return path;
}

/**
 * Find where puck will be at a given Z coordinate
 */
function predictPuckAtZ(puck, targetZ, isBlue) {
  const path = simulatePuckPath(puck, 3.0);
  for (const p of path) {
    if (isBlue ? p.z >= targetZ : p.z <= targetZ) {
      return { x: p.x, z: p.z, t: p.t, vx: p.vx, vz: p.vz };
    }
  }
  // Puck won't reach target Z in time
  return path.length > 0 ? path[path.length - 1] : { x: puck.x, z: puck.y, t: 0, vx: 0, vz: 0 };
}

/**
 * Calculate time for paddle to reach a position
 */
function timeToReach(selfX, selfZ, targetX, targetZ) {
  const dist = Math.hypot(targetX - selfX, targetZ - selfZ);
  return dist / MAX_PADDLE_SPEED;
}

/**
 * Find optimal intercept point for a puck
 */
function findInterceptPoint(puck, self, isBlue) {
  const path = simulatePuckPath(puck, 2.5);
  let bestPoint = null;
  let bestScore = -Infinity;

  for (const p of path) {
    // Can we reach this point in time?
    const tPaddle = timeToReach(self.x, self.y, p.x, p.z);
    if (tPaddle > p.t + 0.1) continue; // Can't reach in time

    // Is it in our valid zone?
    const zMin = isBlue ? 0 : -HALF_H + PADDLE_RADIUS;
    const zMax = isBlue ? HALF_H - PADDLE_RADIUS : 0;
    if (p.z < zMin || p.z > zMax) continue;

    // Score: prefer earlier intercepts, in our half, away from goal
    const distToGoal = isBlue ? (HALF_H - p.z) : (p.z + HALF_H);
    const score = distToGoal * 2 - p.t * 10;

    if (score > bestScore) {
      bestScore = score;
      bestPoint = p;
    }
  }
  return bestPoint;
}

/**
 * Assess threat level of each puck
 */
function assessThreats(pucks, self, opponent, isBlue) {
  const myGoalZ = isBlue ? HALF_H : -HALF_H;
  const threats = [];

  for (const puck of pucks) {
    const speed = Math.hypot(puck.velocity.x, puck.velocity.y);
    const movingTowardsMe = isBlue ? puck.velocity.y > 0.1 : puck.velocity.y < -0.1;
    const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;
    const distToGoal = Math.abs(myGoalZ - puck.y);
    const distToPuck = Math.hypot(puck.x - self.x, puck.y - self.y);

    let score = 0;

    if (movingTowardsMe) {
      // Predict where it will cross goal line
      const pred = predictPuckAtZ(puck, myGoalZ, isBlue);
      const onTarget = Math.abs(pred.x) < GOAL_WIDTH / 2 + 0.5;

      // Time-based urgency
      const timeToGoal = pred.t;
      if (timeToGoal > 0 && timeToGoal < 2.0) {
        score += 100 / (timeToGoal + 0.1);
      }

      if (onTarget) score += 50;
      score += speed * 5;
      if (distToGoal < 5) score += 30;
      if (distToGoal < 3) score += 40;
    } else if (inMyHalf) {
      // Puck in my half but not moving toward goal - opportunity
      score += 20 - distToGoal;
      if (speed < 1.0) score += 15; // Slow puck = easy target
    } else {
      // Puck in opponent half
      score -= 5;
      // But watch if opponent is about to shoot
      const oppDist = Math.hypot(puck.x - opponent.x, puck.y - opponent.y);
      if (oppDist < 1.5) score += 25; // Opponent might shoot
    }

    if (inMyHalf) score += 15;

    const intercept = findInterceptPoint(puck, self, isBlue);
    threats.push({
      puck,
      score,
      speed,
      distToPuck,
      distToGoal,
      inMyHalf,
      movingTowardsMe,
      intercept
    });
  }

  threats.sort((a, b) => b.score - a.score);
  return threats;
}

/**
 * Calculate position to hit puck toward target
 */
function getApproachPosition(puck, targetX, targetZ) {
  const dx = targetX - puck.x;
  const dz = targetZ - puck.y;
  const len = Math.hypot(dx, dz) || 1;
  const behindDist = COLLISION_DIST + 0.2;
  return {
    x: puck.x - (dx / len) * behindDist,
    z: puck.y - (dz / len) * behindDist
  };
}

/**
 * Find best shot target (away from opponent)
 */
function getBestShotTarget(opponent, isBlue) {
  const goalZ = isBlue ? -HALF_H : HALF_H;
  // Aim away from opponent
  const targetX = opponent.x > 0 ? -1.2 : 1.2;
  // Clamp to goal width
  return { x: Math.max(-1.8, Math.min(1.8, targetX)), z: goalZ };
}

export function tick({ pucks, self, opponent, dt }) {
  if (!pucks || pucks.length === 0) return { x: 0, z: 0 };

  const isBlue = self.y > 0;
  const myGoalZ = isBlue ? HALF_H : -HALF_H;
  const oppGoalZ = isBlue ? -HALF_H : HALF_H;

  // Analyze all pucks
  const threats = assessThreats(pucks, self, opponent, isBlue);

  let targetX = self.x;
  let targetZ = self.y;
  let urgency = 1.0;

  // Handle multiple threats - check if secondary threats need attention
  const criticalThreats = threats.filter(t => t.score > 60);
  const primaryThreat = threats[0];

  if (criticalThreats.length > 1) {
    // Multiple critical threats - position to cover the most dangerous path
    const avgX = criticalThreats.reduce((sum, t) => {
      const pred = predictPuckAtZ(t.puck, myGoalZ, isBlue);
      return sum + pred.x;
    }, 0) / criticalThreats.length;

    const pos = getCreaseEdgePosition(avgX, isBlue);
    targetX = pos.x;
    targetZ = pos.z;
    urgency = 1.4;

  } else if (!primaryThreat || primaryThreat.score < 10) {
    // No significant threat - look for offensive opportunity
    let foundOffense = false;

    for (const t of threats) {
      if (t.inMyHalf && t.speed < 2.0 && t.distToPuck < 5.0) {
        const shotTarget = getBestShotTarget(opponent, isBlue);
        const approach = getApproachPosition(t.puck, shotTarget.x, shotTarget.z);
        targetX = approach.x;
        targetZ = approach.z;
        urgency = 1.1;
        foundOffense = true;
        break;
      }
    }

    if (!foundOffense) {
      // Hold defensive position
      const pos = getCreaseEdgePosition(0, isBlue);
      targetX = pos.x;
      targetZ = pos.z;
    }

  } else {
    const { puck, inMyHalf, movingTowardsMe, speed, distToPuck, intercept } = primaryThreat;

    if (primaryThreat.score > 50) {
      // HIGH THREAT - intercept immediately
      if (intercept) {
        targetX = intercept.x;
        targetZ = intercept.z;
        urgency = 1.4;
      } else {
        // Can't intercept cleanly - get to crease edge
        const pred = predictPuckAtZ(puck, myGoalZ, isBlue);
        const pos = getCreaseEdgePosition(pred.x, isBlue);
        targetX = pos.x;
        targetZ = pos.z;
        urgency = 1.3;
      }

      // Very close - commit to aggressive hit
      if (distToPuck < 1.0) {
        targetX = puck.x;
        targetZ = puck.y + (isBlue ? -1.5 : 1.5);
        urgency = 1.5;
      }

    } else if (inMyHalf && speed > 0.3) {
      // MEDIUM THREAT - controlled clear
      const shotTarget = getBestShotTarget(opponent, isBlue);
      const approach = getApproachPosition(puck, shotTarget.x, shotTarget.z);
      targetX = approach.x;
      targetZ = approach.z;
      urgency = 1.15;

    } else if (inMyHalf) {
      // LOW THREAT in my half - approach for control
      const shotTarget = getBestShotTarget(opponent, isBlue);
      const approach = getApproachPosition(puck, shotTarget.x, shotTarget.z);
      targetX = approach.x;
      targetZ = approach.z;

    } else {
      // Puck in opponent half - defensive positioning
      const pred = predictPuckAtZ(puck, isBlue ? 6.0 : -6.0, isBlue);
      const pos = getCreaseEdgePosition(pred.x * 0.7, isBlue);
      targetX = pos.x;
      targetZ = pos.z;

      // Opponent near puck - anticipate shot
      const oppDist = Math.hypot(puck.x - opponent.x, puck.y - opponent.y);
      if (oppDist < 2.0) {
        const shotPred = predictPuckAtZ(puck, myGoalZ, isBlue);
        const tightPos = getCreaseEdgePosition(shotPred.x * 0.5, isBlue);
        targetX = tightPos.x;
        targetZ = tightPos.z;
        urgency = 1.2;
      }
    }
  }

  // Apply boundary constraints
  let finalPos = clampToBounds(targetX, targetZ, isBlue);
  finalPos = clampOutsideCrease(finalPos.x, finalPos.z, isBlue);

  // Calculate movement
  const dx = finalPos.x - self.x;
  const dz = finalPos.z - self.y;
  const dist = Math.hypot(dx, dz);

  if (dist < 0.05) return { x: 0, z: 0 };

  return {
    x: (dx / dist) * urgency,
    z: (dz / dist) * urgency
  };
}
