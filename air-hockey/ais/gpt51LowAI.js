export const id = "gpt-5-1-low-priority";
export const name = "GPT 5.1 (low, priority)";

// GPT 5.1 (low, priority)
// Strong defensive AI focused on protecting the enlarged goal and handling multi-puck chaos.
// Strategy:
// - Evaluate all pucks and choose the most urgent threat (soonest to reach our goal line).
// - Intercept dangerous pucks early at a forward defense line.
// - Fall back to home line for last-second saves.
// - When safe, clear pucks out of our half with simple forward hits.

function pickMostThreateningPuck({ pucks, self }) {
  const isBlue = self.y > 0;
  const goalZ = isBlue ? 10.0 : -10.0;

  let best = null;
  let bestScore = -Infinity; // higher is more threatening

  for (const p of pucks) {
    const movingTowardsMe = isBlue ? p.velocity.y > 0 : p.velocity.y < 0;
    const distToGoal = Math.abs(goalZ - p.y);
    const speedTowardsMe = movingTowardsMe ? Math.abs(p.velocity.y) : 0;

    // Base threat: closer to goal is worse
    let score = -distToGoal;

    // Moving towards me increases threat strongly
    if (movingTowardsMe) {
      score += speedTowardsMe * 6; // emphasize approach speed
    } else {
      // Moving away: low threat unless very close
      if (distToGoal < 3.0) score -= 2.0;
      else score -= 8.0;
    }

    // Slight bonus if already in my half
    const inMyHalf = isBlue ? p.y > 0 : p.y < 0;
    if (inMyHalf) score += 4.0;

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
  const goalZ = isBlue ? 10.0 : -10.0;
  const homeZ = isBlue ? 8.5 : -8.5;       // sit near goal line
  const defenseLineZ = isBlue ? 6.0 : -6.0; // forward defense line

  const targetPuck = pickMostThreateningPuck({ pucks, self });
  if (!targetPuck) {
    // No clear threat, drift to home center
    const dirX = 0 - self.x;
    const dirZ = homeZ - self.y;
    const len = Math.hypot(dirX, dirZ) || 1;
    return { x: dirX / len, z: dirZ / len };
  }

  const dx = targetPuck.x - self.x;
  const dz = targetPuck.y - self.y;
  const distToPuck = Math.hypot(dx, dz);

  const movingTowardsMe = isBlue
    ? targetPuck.velocity.y > 0
    : targetPuck.velocity.y < 0;
  const speed = Math.hypot(targetPuck.velocity.x, targetPuck.velocity.y);
  const inMyHalf = isBlue ? targetPuck.y > 0 : targetPuck.y < 0;

  let targetX = self.x;
  let targetZ = self.y;

  if (inMyHalf && movingTowardsMe && speed > 0.3) {
    // INTERCEPT MODE: meet it at the defense line before it reaches home
    const interceptZ = defenseLineZ;

    const vz = targetPuck.velocity.y;
    if (Math.abs(vz) > 0.001) {
      const t = (interceptZ - targetPuck.y) / vz;
      if (t > 0 && t < 2.0) {
        let predX = targetPuck.x + targetPuck.velocity.x * t;

        // Clamp inside table width
        const halfW = 5.0 - 0.3; // tableWidth/2 minus margin
        predX = Math.max(-halfW, Math.min(halfW, predX));

        targetX = predX;
        targetZ = interceptZ;
      } else {
        // If intercept time is weird, just track X from home
        targetX = Math.max(-2.0, Math.min(2.0, targetPuck.x));
        targetZ = homeZ;
      }
    } else {
      // Almost vertical or stopped: stand between puck and goal
      targetX = Math.max(-2.0, Math.min(2.0, targetPuck.x));
      targetZ = defenseLineZ;
    }

    // If already close to the puck, go right to it to ensure contact
    if (distToPuck < 1.5) {
      targetX = targetPuck.x;
      targetZ = targetPuck.y;
    }
  } else if (inMyHalf) {
    // CLEARING MODE: puck is in my half but not a direct fast threat
    targetX = targetPuck.x;
    targetZ = targetPuck.y;
  } else {
    // DEFENSIVE IDLE: puck is on the other side or moving away
    // Shadow its X but stay near homeZ
    targetX = Math.max(-2.5, Math.min(2.5, targetPuck.x));
    targetZ = homeZ;
  }

  const dirX = targetX - self.x;
  const dirZ = targetZ - self.y;
  const len = Math.hypot(dirX, dirZ) || 1;
  return { x: dirX / len, z: dirZ / len };
}
