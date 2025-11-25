export const id = "claude-opus-4-5";
export const name = "Claude Opus 4.5";

// Supreme AI with crease awareness
// Goal crease radius = 2.5, paddles cannot enter the half-circle in front of goals

const TABLE_WIDTH = 10;
const TABLE_HEIGHT = 20;
const GOAL_CREASE_RADIUS = 2.5;
const PADDLE_RADIUS = 0.35;

/**
 * Check if a position is inside a goal crease
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
 * Predict puck X position at target Z with wall bounces
 */
function predictXAtZ(puck, targetZ) {
  const vz = puck.velocity.y;
  if (Math.abs(vz) < 0.001) return puck.x;

  const t = (targetZ - puck.y) / vz;
  if (t <= 0) return puck.x;

  let x = puck.x + puck.velocity.x * t;
  const halfW = TABLE_WIDTH / 2 - 0.25;

  let bounces = 0;
  while ((x > halfW || x < -halfW) && bounces < 10) {
    if (x > halfW) x = 2 * halfW - x;
    else if (x < -halfW) x = -2 * halfW - x;
    bounces++;
  }
  return Math.max(-halfW, Math.min(halfW, x));
}

/**
 * Assess threat level of each puck
 */
function assessThreats(pucks, self, isBlue) {
  const goalZ = isBlue ? 10.0 : -10.0;
  const threats = [];

  for (const p of pucks) {
    const movingTowardsMe = isBlue ? p.velocity.y > 0 : p.velocity.y < 0;
    const distToGoal = Math.abs(goalZ - p.y);
    const speedZ = Math.abs(p.velocity.y);
    const totalSpeed = Math.hypot(p.velocity.x, p.velocity.y);
    const inMyHalf = isBlue ? p.y > 0 : p.y < 0;

    let threatScore = 0;

    if (movingTowardsMe && speedZ > 0.1) {
      const timeToGoal = distToGoal / speedZ;
      threatScore += 60 / (timeToGoal + 0.03);
      threatScore += totalSpeed * 2.5;
      if (distToGoal < 4.0) threatScore += 25;
      if (distToGoal < 2.0) threatScore += 40;
      
      const predX = predictXAtZ(p, goalZ);
      if (Math.abs(predX) < 2.0) threatScore += 15;
    } else if (inMyHalf) {
      threatScore += 10 - distToGoal * 0.4;
    } else {
      threatScore -= 8;
    }

    if (inMyHalf) threatScore += 8;
    const distToPuck = Math.hypot(p.x - self.x, p.y - self.y);
    if (distToPuck < 2.0) threatScore += 5;

    threats.push({ puck: p, score: threatScore, distToPuck });
  }

  threats.sort((a, b) => b.score - a.score);
  return threats;
}

/**
 * Get optimal defensive position at crease edge
 */
function getCreaseEdgePosition(predX, isBlue) {
  const goalZ = isBlue ? TABLE_HEIGHT / 2 : -TABLE_HEIGHT / 2;
  const minDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.1;
  
  // Clamp X to reasonable defensive range
  const clampedX = Math.max(-2.5, Math.min(2.5, predX));
  
  // Position at crease edge
  const angle = Math.atan2(clampedX, minDist);
  const edgeX = Math.sin(angle) * minDist;
  const edgeZ = isBlue ? goalZ - Math.cos(angle) * minDist : goalZ + Math.cos(angle) * minDist;
  
  return { x: edgeX, z: edgeZ };
}

/**
 * Calculate shot approach position
 */
function calculateShotVector(puck, targetX, targetZ) {
  const aimX = targetX - puck.x;
  const aimZ = targetZ - puck.y;
  const aimLen = Math.hypot(aimX, aimZ) || 1;
  const behindDist = 0.7;
  return {
    x: puck.x - (aimX / aimLen) * behindDist,
    z: puck.y - (aimZ / aimLen) * behindDist
  };
}

export function tick({ pucks, self, opponent, dt }) {
  if (!pucks || pucks.length === 0) return { x: 0, z: 0 };

  const isBlue = self.y > 0;
  const opponentGoalZ = isBlue ? -10.0 : 10.0;

  // Assess all threats
  const threats = assessThreats(pucks, self, isBlue);
  const primaryThreat = threats[0];

  let targetX = self.x;
  let targetZ = self.y;
  let speedMultiplier = 1.0;

  if (!primaryThreat || primaryThreat.score < 0) {
    // No threat - find offensive opportunity or hold position
    for (const p of pucks) {
      const inMyHalf = isBlue ? p.y > 0 : p.y < 0;
      const speed = Math.hypot(p.velocity.x, p.velocity.y);
      const distToPuck = Math.hypot(p.x - self.x, p.y - self.y);
      
      if (inMyHalf && speed < 2.0 && distToPuck < 5.0) {
        // Offensive opportunity - shoot toward opponent's weak side
        const targetCornerX = opponent.x > 0 ? -1.8 : 1.8;
        const shot = calculateShotVector(p, targetCornerX, opponentGoalZ);
        targetX = shot.x;
        targetZ = shot.z;
        speedMultiplier = 1.2;
        break;
      }
    }
    
    // Default: hold at crease edge
    if (targetX === self.x) {
      const pos = getCreaseEdgePosition(0, isBlue);
      targetX = pos.x;
      targetZ = pos.z;
    }
  } else {
    const puck = primaryThreat.puck;
    const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;
    const movingTowardsMe = isBlue ? puck.velocity.y > 0 : puck.velocity.y < 0;
    const speed = Math.hypot(puck.velocity.x, puck.velocity.y);
    const distToPuck = primaryThreat.distToPuck;

    if (primaryThreat.score > 40 || (inMyHalf && movingTowardsMe && speed > 1.0)) {
      // HIGH THREAT: Intercept aggressively
      // Predict where puck will be and move to intercept
      const interceptZ = isBlue ? Math.min(puck.y + 1.5, 7.5) : Math.max(puck.y - 1.5, -7.5);
      const predX = predictXAtZ(puck, interceptZ);
      
      targetX = predX;
      targetZ = interceptZ;
      speedMultiplier = 1.3;

      // Very close - drive through to clear
      if (distToPuck < 1.2) {
        const pushZ = isBlue ? -2.0 : 2.0;
        targetX = puck.x;
        targetZ = puck.y + pushZ;
      }

    } else if (inMyHalf && speed > 0.2) {
      // MEDIUM THREAT: Strategic clear
      const targetCornerX = opponent.x > 0 ? -1.8 : 1.8;
      const shot = calculateShotVector(puck, targetCornerX, opponentGoalZ);
      targetX = shot.x;
      targetZ = shot.z;
      speedMultiplier = 1.1;

    } else if (inMyHalf) {
      // LOW THREAT: Approach puck
      targetX = puck.x;
      targetZ = puck.y;

    } else {
      // DEFENSIVE: Puck in opponent half - position at crease edge
      const predX = predictXAtZ(puck, isBlue ? 7.5 : -7.5);
      const pos = getCreaseEdgePosition(predX, isBlue);
      targetX = pos.x;
      targetZ = pos.z;

      // Opponent about to shoot - tighten up
      const opponentDistToPuck = Math.hypot(puck.x - opponent.x, puck.y - opponent.y);
      if (opponentDistToPuck < 1.5) {
        const tightPos = getCreaseEdgePosition(predX * 0.5, isBlue);
        targetX = tightPos.x;
        targetZ = tightPos.z;
        speedMultiplier = 1.2;
      }
    }
  }

  // Ensure target is outside our crease (engine will push us out anyway, but avoid wasted movement)
  const clamped = clampOutsideCrease(targetX, targetZ, isBlue);
  targetX = clamped.x;
  targetZ = clamped.z;

  // Execute movement
  const dirX = targetX - self.x;
  const dirZ = targetZ - self.y;
  const len = Math.hypot(dirX, dirZ) || 1;

  return {
    x: (dirX / len) * speedMultiplier,
    z: (dirZ / len) * speedMultiplier
  };
}
