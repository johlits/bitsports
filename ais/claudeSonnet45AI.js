export const id = "claude-sonnet-4-5";
export const name = "Claude Sonnet 4.5";

// Elite AI: Advanced multi-puck threat assessment, adaptive positioning, and strategic offense
// Optimized for 10x20 board with 4.0 goal width

/**
 * Predict puck position at target Z with multi-bounce wall reflection
 */
function predictXAtZ(puck, targetZ, tableWidth) {
  const vz = puck.velocity.y;
  if (Math.abs(vz) < 0.001) return puck.x;

  const t = (targetZ - puck.y) / vz;
  if (t <= 0) return puck.x;

  let x = puck.x + puck.velocity.x * t;
  const halfW = tableWidth / 2 - 0.25;

  // Triangle wave folding for wall bounces
  let bounces = 0;
  while ((x > halfW || x < -halfW) && bounces < 10) {
    if (x > halfW) {
      x = 2 * halfW - x;
    } else if (x < -halfW) {
      x = 2 * (-halfW) - x;
    }
    bounces++;
  }
  return Math.max(-halfW, Math.min(halfW, x));
}

/**
 * Advanced threat scoring for multi-puck scenarios
 */
function assessThreats(pucks, isBlue) {
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
      // Time-to-goal is critical
      const timeToGoal = distToGoal / speedZ;
      threatScore += 50 / (timeToGoal + 0.05); // Exponential urgency

      // Fast pucks are more dangerous
      threatScore += totalSpeed * 2;

      // Pucks close to goal are critical
      if (distToGoal < 4.0) threatScore += 20;
      if (distToGoal < 2.0) threatScore += 30;
    } else {
      // Not moving toward me
      if (inMyHalf) {
        // Sitting in my zone - moderate threat
        threatScore += 8 - distToGoal * 0.5;
      } else {
        // In opponent zone, moving away - low priority
        threatScore -= 5;
      }
    }

    // Bonus for being in my half
    if (inMyHalf) threatScore += 6;

    threats.push({ puck: p, score: threatScore });
  }

  // Sort by threat score descending
  threats.sort((a, b) => b.score - a.score);
  return threats;
}

/**
 * Calculate optimal intercept point considering paddle speed and puck trajectory
 */
function calculateInterceptPoint(puck, self, isBlue, tableWidth) {
  const defenseZ = isBlue ? 6.0 : -6.0;
  const homeZ = isBlue ? 8.5 : -8.5;
  
  const vz = puck.velocity.y;
  if (Math.abs(vz) < 0.1) {
    // Slow or stationary - just go to it
    return { x: puck.x, z: puck.y };
  }

  // Try to intercept at defense line
  const tDefense = (defenseZ - puck.y) / vz;
  
  if (tDefense > 0 && tDefense < 1.5) {
    const predX = predictXAtZ(puck, defenseZ, tableWidth);
    return { x: predX, z: defenseZ };
  }

  // Fallback: intercept at home line
  const tHome = (homeZ - puck.y) / vz;
  if (tHome > 0 && tHome < 3.0) {
    const predX = predictXAtZ(puck, homeZ, tableWidth);
    return { x: predX, z: homeZ };
  }

  // Emergency: just shadow the puck
  return { x: puck.x, z: Math.max(-2.0, Math.min(2.0, puck.y)) };
}

export function tick({ pucks, self, opponent, dt }) {
  if (!pucks || pucks.length === 0) return { x: 0, z: 0 };

  const isBlue = self.y > 0;
  const goalZ = isBlue ? 10.0 : -10.0;
  const homeZ = isBlue ? 8.5 : -8.5;
  const defenseZ = isBlue ? 6.0 : -6.0;
  const tableWidth = 10;

  // Assess all threats
  const threats = assessThreats(pucks, isBlue);
  const primaryThreat = threats[0];
  
  if (!primaryThreat || primaryThreat.score < -3) {
    // No real threats - return to defensive home position
    const dirX = 0 - self.x;
    const dirZ = homeZ - self.y;
    const len = Math.hypot(dirX, dirZ) || 1;
    return { x: dirX / len, z: dirZ / len };
  }

  const puck = primaryThreat.puck;
  const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;
  const movingTowardsMe = isBlue ? puck.velocity.y > 0 : puck.velocity.y < 0;
  const speed = Math.hypot(puck.velocity.x, puck.velocity.y);
  const distToPuck = Math.hypot(puck.x - self.x, puck.y - self.y);

  let targetX = self.x;
  let targetZ = self.y;

  // DECISION TREE
  if (inMyHalf && movingTowardsMe && speed > 0.5) {
    // HIGH THREAT: Intercept aggressively
    const intercept = calculateInterceptPoint(puck, self, isBlue, tableWidth);
    targetX = intercept.x;
    targetZ = intercept.z;

    // If very close, drive through the puck
    if (distToPuck < 1.2) {
      const pushZ = isBlue ? -1.5 : 1.5;
      targetX = puck.x;
      targetZ = puck.y + pushZ;
    }

  } else if (inMyHalf && speed > 0.2) {
    // MEDIUM THREAT: Clear with precision
    // Position to hit puck toward opponent's weak corner
    const opponentGoalZ = isBlue ? -10.0 : 10.0;
    
    // Aim for corner opposite to puck's current X
    const targetCornerX = puck.x > 0 ? -4.0 : 4.0;
    
    // Vector from puck to target corner
    const aimX = targetCornerX - puck.x;
    const aimZ = opponentGoalZ - puck.y;
    const aimLen = Math.hypot(aimX, aimZ);
    
    // Position behind puck along aim vector
    const behindDist = 0.8;
    targetX = puck.x - (aimX / aimLen) * behindDist;
    targetZ = puck.y - (aimZ / aimLen) * behindDist;

  } else if (inMyHalf) {
    // LOW THREAT: Chase and clear
    targetX = puck.x;
    targetZ = puck.y;

  } else {
    // DEFENSIVE POSITIONING: Puck in opponent half
    // Choose guard depth based on overall threat level
    const guardZ = primaryThreat.score > 15 ? homeZ : defenseZ;
    
    // Predict where puck will cross our guard line
    const predX = predictXAtZ(puck, guardZ, tableWidth);
    
    // Clamp to protect goal width
    targetX = Math.max(-3.0, Math.min(3.0, predX));
    targetZ = guardZ;
  }

  // Execute movement
  const dirX = targetX - self.x;
  const dirZ = targetZ - self.y;
  const len = Math.hypot(dirX, dirZ) || 1;
  
  return { x: dirX / len, z: dirZ / len };
}
