export const id = "gemini-3-pro-high";
export const name = "Gemini 3 Pro (high)";

// Expert AI with crease awareness
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
 * Get optimal defensive position at crease edge
 */
function getCreaseEdgePosition(predX, isBlue) {
  const goalZ = isBlue ? TABLE_HEIGHT / 2 : -TABLE_HEIGHT / 2;
  const minDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.1;
  
  // Clamp X to reasonable defensive range
  const clampedX = Math.max(-3.0, Math.min(3.0, predX));
  
  // Position at crease edge
  const angle = Math.atan2(clampedX, minDist);
  const edgeX = Math.sin(angle) * minDist;
  const edgeZ = isBlue ? goalZ - Math.cos(angle) * minDist : goalZ + Math.cos(angle) * minDist;
  
  return { x: edgeX, z: edgeZ };
}

/**
 * Predicts the x-position of the puck at a specific Z plane, accounting for wall bounces.
 */
function predictXAtZ(puck, targetZ) {
  const vz = puck.velocity.y;
  if (Math.abs(vz) < 0.001) return puck.x; // Not moving in Z

  const time = (targetZ - puck.y) / vz;
  if (time <= 0) return puck.x; // Already passed or moving wrong way

  let finalX = puck.x + puck.velocity.x * time;
  const halfW = TABLE_WIDTH / 2 - 0.25; // Effective width (minus radius)

  // Simulate bounces (triangle wave)
  let bounces = 0;
  while ((finalX > halfW || finalX < -halfW) && bounces < 10) {
    if (finalX > halfW) {
      const overshoot = finalX - halfW;
      finalX = halfW - overshoot;
    } else if (finalX < -halfW) {
      const overshoot = -halfW - finalX;
      finalX = -halfW + overshoot;
    }
    bounces++;
  }
  return finalX;
}

export function tick({ pucks, self, opponent, dt }) {
  const isBlue = self.y > 0;
  const goalZ = isBlue ? 10.0 : -10.0;
  const defenseLineZ = isBlue ? 6.0 : -6.0; // Forward defense line
  
  // 1. Threat Analysis
  // Identify the most dangerous puck based on time-to-goal
  let bestPuck = null;
  let minTimeToGoal = Infinity;

  for (const p of pucks) {
    const movingTowardsMe = isBlue ? p.velocity.y > 0 : p.velocity.y < 0;
    
    if (!movingTowardsMe) {
        // Low priority unless it's sitting in our zone
        const inMyZone = isBlue ? p.y > 0 : p.y < 0;
        if (inMyZone) {
             // Static threat. Give it a moderate "time" equivalent
             const score = 100 + Math.abs(p.y - goalZ); 
             if (score < minTimeToGoal) {
                 minTimeToGoal = score;
                 bestPuck = p;
             }
        }
        continue;
    }

    // Calculate time to goal line
    const dist = Math.abs(goalZ - p.y);
    const speedZ = Math.abs(p.velocity.y);
    const time = speedZ > 0.1 ? dist / speedZ : 999;

    if (time < minTimeToGoal) {
        minTimeToGoal = time;
        bestPuck = p;
    }
  }
  
  if (!bestPuck) {
      // No active threats, return to crease edge
      const pos = getCreaseEdgePosition(0, isBlue);
      const dirX = pos.x - self.x;
      const dirZ = pos.z - self.y;
      const len = Math.hypot(dirX, dirZ) || 1;
      return { x: dirX / len, z: dirZ / len };
  }

  // 2. High-Level Strategy
  let targetX = self.x;
  let targetZ = self.y;
  
  const distToPuck = Math.hypot(bestPuck.x - self.x, bestPuck.y - self.y);
  const puckSpeed = Math.hypot(bestPuck.velocity.x, bestPuck.velocity.y);
  const inMyZone = isBlue ? bestPuck.y > 0 : bestPuck.y < 0;
  
  if (inMyZone) {
      if (puckSpeed > 2.0) {
          // Fast puck! Intercept.
          // Don't wait at goal, meet it at defenseLineZ if possible.
          
          // Predict where it will be at defenseLineZ
          const predX = predictXAtZ(bestPuck, defenseLineZ);
          
          // If the puck has already passed defenseLine, fall back to crease edge
          const passedDefense = isBlue ? bestPuck.y > defenseLineZ : bestPuck.y < defenseLineZ;
          
          if (passedDefense) {
              // Emergency blocking at crease edge
              const blockX = predictXAtZ(bestPuck, isBlue ? 7.5 : -7.5);
              const pos = getCreaseEdgePosition(blockX, isBlue);
              targetX = pos.x;
              targetZ = pos.z;
          } else {
              // Meet at defense line
              targetX = predX;
              targetZ = defenseLineZ;
          }
          
          // Strike if close
          if (distToPuck < 2.0) {
               targetX = bestPuck.x;
               targetZ = bestPuck.y; // Smash it
          }
          
      } else {
          // Slow puck in zone. Chase and clear.
          // Aim to hit it towards the SIDE walls (bank) or corners
          targetX = bestPuck.x;
          targetZ = bestPuck.y;
          
          // Micro-adjustment for aiming:
          // If we are "behind" the puck (closer to goal than puck is), push it forward
          // Add slight offset to target to angle the hit
          const aimX = (bestPuck.x > 0) ? -4.5 : 4.5; // Opposite wall corner
          const aimZ = isBlue ? -10 : 10; // Opponent goal
          
          // Just hit it towards opposite goal corner
          // This is "High" AI so we just drive it.
          const aimDirX = aimX - bestPuck.x;
          const aimDirZ = aimZ - bestPuck.y;
          // Push *through* the puck
          targetZ = bestPuck.y - Math.sign(aimDirZ) * 0.5; 
          targetX = bestPuck.x - Math.sign(aimDirX) * 0.1; 
      }
  } else {
      // Puck in opponent half.
      // Defensive posturing.
      // Shadow X, stay at defenseLineZ or crease edge based on speed
      
      if (puckSpeed > 5.0) {
          // Fast puck incoming - retreat to crease
          const predX = predictXAtZ(bestPuck, isBlue ? 7.5 : -7.5);
          const pos = getCreaseEdgePosition(predX, isBlue);
          targetX = pos.x;
          targetZ = pos.z;
      } else {
          // Slower puck - hold forward defense line
          const predX = predictXAtZ(bestPuck, defenseLineZ);
          targetX = Math.max(-3.0, Math.min(3.0, predX));
          targetZ = defenseLineZ;
      }
  }

  // Final clamp to ensure we don't try to enter crease
  const clamped = clampOutsideCrease(targetX, targetZ, isBlue);
  targetX = clamped.x;
  targetZ = clamped.z;

  const dirX = targetX - self.x;
  const dirZ = targetZ - self.y;
  const len = Math.hypot(dirX, dirZ) || 1;
  return { x: dirX / len, z: dirZ / len };
}
