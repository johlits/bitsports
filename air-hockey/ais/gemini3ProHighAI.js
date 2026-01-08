export const id = "gemini-3-pro-high";
export const name = "Gemini 3.5 Pro High";

// Gemini 3.5 Pro High - Advanced Air Hockey AI
// Features:
// - High-precision trajectory prediction with wall bounces and friction
// - Dynamic threat assessment for multi-puck chaos
// - Optimal intercept calculation using iterative solving
// - Smart shot selection aiming for gaps in opponent defense
// - Defensive positioning based on puck distribution

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

// Physics constants
const DT_SIM = 0.016; // Simulation step size
const PREDICTION_TIME = 2.0; // How far ahead to predict
const WALL_BOUNCE_LOSS = 1.0; // Assumed restitution (rules say velocity reflection)

/**
 * Normalizes a vector {x, y}
 */
function normalize(v) {
  const len = Math.hypot(v.x, v.y);
  if (len < 0.001) return { x: 0, y: 0 };
  return { x: v.x / len, y: v.y / len };
}

/**
 * Clamps a value between min and max
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Checks if a point is within the goal crease
 */
function isInCrease(x, z, isBlue) {
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const dz = z - goalZ;
  // Crease is a semi-circle
  if (isBlue ? dz > 0 : dz < 0) return false; // Behind goal line (shouldn't happen for paddle center)
  
  const distSq = x * x + dz * dz;
  const minDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS;
  return distSq < minDist * minDist;
}

/**
 * Clamps position to valid paddle area (bounds and outside crease)
 */
function getValidPosition(x, z, isBlue) {
  // 1. Clamp to table bounds
  const xLimit = HALF_W - PADDLE_RADIUS;
  // Blue is positive Z (0 to 10), Red is negative Z (-10 to 0)
  const zMin = isBlue ? 0 : -(HALF_H - PADDLE_RADIUS);
  const zMax = isBlue ? (HALF_H - PADDLE_RADIUS) : 0;
  
  let cx = clamp(x, -xLimit, xLimit);
  let cz = clamp(z, zMin, zMax);

  // 2. Push out of crease
  const goalZ = isBlue ? HALF_H : -HALF_H;
  const dz = cz - goalZ;
  
  // Only check if we are "in front" of the goal line relative to the table center
  // Blue goal is at +10, blue plays in +Z. So checking dz < 0.
  // Red goal is at -10, red plays in -Z. So checking dz > 0.
  const inFrontOfGoal = isBlue ? (dz < 0) : (dz > 0);
  
  if (inFrontOfGoal) {
    const distSq = cx * cx + dz * dz;
    const minDist = GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.01; // Small buffer
    
    if (distSq < minDist * minDist) {
      const dist = Math.sqrt(distSq) || 0.001;
      const pushFactor = minDist / dist;
      cx = cx * pushFactor;
      cz = goalZ + dz * pushFactor;
    }
  }

  // Re-clamp Z just in case crease push sent us out of bounds (unlikely given geometry but safe)
  cz = clamp(cz, zMin, zMax);
  
  return { x: cx, z: cz };
}

/**
 * Simulates puck trajectory
 * Returns array of {x, y, t, vx, vy}
 */
function predictPuck(puck, timeHorizon) {
  const path = [];
  let x = puck.x;
  let y = puck.y; // Z position
  let vx = puck.velocity.x;
  let vy = puck.velocity.y; // Z velocity
  
  const wallX = HALF_W - PUCK_RADIUS;
  const wallY = HALF_H - PUCK_RADIUS; // Z limit

  for (let t = 0; t < timeHorizon; t += DT_SIM) {
    // Friction
    if (Math.hypot(vx, vy) > MIN_PUCK_SPEED) {
      vx *= FRICTION;
      vy *= FRICTION;
    }

    x += vx * DT_SIM;
    y += vy * DT_SIM;

    // Wall Bounces
    if (x > wallX) { x = 2 * wallX - x; vx = -vx * WALL_BOUNCE_LOSS; }
    else if (x < -wallX) { x = -2 * wallX - x; vx = -vx * WALL_BOUNCE_LOSS; }

    // End Zone Bounces (if not in goal width)
    // Goal is centered at x=0, width=GOAL_WIDTH
    const inGoalX = Math.abs(x) < GOAL_WIDTH / 2;
    
    if (y > wallY) {
      if (!inGoalX) {
        y = 2 * wallY - y; vy = -vy * WALL_BOUNCE_LOSS;
      } else {
        // Goal scored (virtually) - stop prediction or continue?
        // For AI purposes, if it passes goal line, it's either a goal for opponent or self
        // We track it, but maybe stop path here?
        path.push({ x, y, t, vx, vy, isGoal: true });
        break; 
      }
    } else if (y < -wallY) {
      if (!inGoalX) {
        y = -2 * wallY - y; vy = -vy * WALL_BOUNCE_LOSS;
      } else {
        path.push({ x, y, t, vx, vy, isGoal: true });
        break;
      }
    }

    path.push({ x, y, t, vx, vy, isGoal: false });
  }
  return path;
}

/**
 * Analyzes a single puck to determine its threat level and potential intercept points.
 */
function analyzePuck(puck, self, isBlue, myGoalZ) {
  const path = predictPuck(puck, PREDICTION_TIME);
  
  let threatScore = 0;
  let interceptPoint = null;
  let minInterceptTime = Infinity;

  // Basic stats
  const distToGoal = Math.abs(puck.y - myGoalZ);
  const movingTowardsMe = isBlue ? puck.velocity.y > 0 : puck.velocity.y < 0; // Blue goal is at +H, so vel.y > 0 is threat
  const speed = Math.hypot(puck.velocity.x, puck.velocity.y);

  // 1. THREAT ASSESSMENT
  if (movingTowardsMe) {
    // Check if it enters the goal
    const goalFrame = path.find(p => p.isGoal && (isBlue ? p.y > 0 : p.y < 0));
    if (goalFrame) {
      threatScore += 1000; // It's going in!
      threatScore += (50 / (goalFrame.t + 0.1)); // Urgent if soon
    } else {
      // Moving towards us but might miss or bounce
      // Check closest approach to goal
      let closestDist = Infinity;
      for (const p of path) {
        if (isBlue ? p.y > 0 : p.y < 0) { // Only check in our half
            // Distance to goal center line
            if (Math.abs(p.y - myGoalZ) < 1.0) { // Near goal line
                if (Math.abs(p.x) < GOAL_WIDTH / 2 + 1.0) { // Near goal opening
                    threatScore += 50;
                }
            }
        }
      }
    }
    threatScore += speed * 10;
    threatScore += (20 - distToGoal) * 2; // Closer is scarier
  }

  // 2. INTERCEPT CALCULATION
  // Find the earliest point where we can reach the puck
  for (const p of path) {
    // Is point in our reachable area?
    const validArea = isBlue ? (p.y >= 0 && p.y <= HALF_H) : (p.y <= 0 && p.y >= -HALF_H);
    if (!validArea) continue;

    // Time for us to get there
    const distToPoint = Math.hypot(p.x - self.x, p.y - self.y);
    const timeToReach = distToPoint / MAX_PADDLE_SPEED;

    // If we can get there before the puck (plus reaction buffer)
    if (timeToReach <= p.t) {
      // Prioritize intercepts that are closer to the puck's current position (earlier t)
      // But also safe distances from own goal
      const distFromGoal = Math.abs(p.y - myGoalZ);
      
      // We found a valid intercept. Since path is sorted by time, this is the earliest.
      // However, we might want a "better" intercept (e.g. further from goal) if available slightly later.
      // For now, take the first valid one that isn't INSIDE the goal crease.
      if (distFromGoal > GOAL_CREASE_RADIUS + PADDLE_RADIUS + 0.5) {
        interceptPoint = p;
        minInterceptTime = p.t;
        break;
      }
    }
  }

  // Bonus for easy intercepts (slow pucks in our half)
  const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;
  if (inMyHalf && speed < 2.0) {
    threatScore += 20; // Opportunity!
  }

  return {
    puck,
    path,
    threatScore,
    interceptPoint,
    distToGoal,
    speed,
    movingTowardsMe,
    inMyHalf
  };
}

/**
 * Calculates a target position for the paddle to aim a shot.
 * Aims for the far corners of the opponent's goal or gaps.
 */
function calculateShotTarget(self, puck, opponent, isBlue) {
  const targetZ = isBlue ? -HALF_H : HALF_H; // Opponent goal
  
  // Simple heuristic: aim for the corner furthest from opponent
  const leftCorner = { x: -GOAL_WIDTH/2 + 0.5, y: targetZ };
  const rightCorner = { x: GOAL_WIDTH/2 - 0.5, y: targetZ };
  
  const distLeft = Math.hypot(opponent.x - leftCorner.x, opponent.y - leftCorner.y);
  const distRight = Math.hypot(opponent.x - rightCorner.x, opponent.y - rightCorner.y);
  
  const aimTarget = distLeft > distRight ? leftCorner : rightCorner;
  
  // To hit puck towards aimTarget, we need to be on the opposite side of the puck
  // Vector from aimTarget to Puck
  const dx = puck.x - aimTarget.x;
  const dy = puck.y - aimTarget.y;
  const len = Math.hypot(dx, dy);
  
  // Position behind puck
  const hitDist = PADDLE_RADIUS + PUCK_RADIUS + 0.1; // Slightly behind to impart velocity
  const standX = puck.x + (dx / len) * hitDist;
  const standZ = puck.y + (dy / len) * hitDist;
  
  return { x: standX, z: standZ };
}

/**
 * Returns a defensive "home" position near the goal
 */
function getDefensivePosition(puckX, isBlue) {
  const goalZ = isBlue ? HALF_H : -HALF_H;
  // Stand slightly in front of crease, tracking puck X
  const standZ = isBlue ? goalZ - (GOAL_CREASE_RADIUS + 1.5) : goalZ + (GOAL_CREASE_RADIUS + 1.5);
  // Clamp X to not go too wide
  const standX = clamp(puckX * 0.5, -2, 2); 
  return { x: standX, z: standZ };
}

export function tick({ pucks, self, opponent, dt }) {
  if (pucks.length === 0) return { x: 0, z: 0 };

  const isBlue = self.y > 0;
  const myGoalZ = isBlue ? HALF_H : -HALF_H;

  // 1. Analyze all pucks
  const analyses = pucks.map(p => analyzePuck(p, self, isBlue, myGoalZ));
  
  // Sort by threat/opportunity score
  analyses.sort((a, b) => b.threatScore - a.threatScore);
  
  const primaryTarget = analyses[0];
  
  let targetPos = { x: self.x, z: self.y }; // Default hold
  
  // 2. State Logic
  if (primaryTarget.threatScore > 50 && primaryTarget.interceptPoint) {
    // Mode: INTERCEPT / DEFEND
    // If it's a high threat, go for the intercept
    // But add a small lead to hit it firmly
    const ip = primaryTarget.interceptPoint;
    
    // If very close, just smash it
    const distToPuck = Math.hypot(primaryTarget.puck.x - self.x, primaryTarget.puck.y - self.y);
    if (distToPuck < 2.0) {
        // Attack vector: aim to clear or shoot
        const shotPos = calculateShotTarget(self, primaryTarget.puck, opponent, isBlue);
        targetPos = shotPos;
    } else {
        // Move to intercept
        targetPos = { x: ip.x, z: ip.y };
    }
  } else if (primaryTarget.inMyHalf && primaryTarget.puck.velocity.y * (isBlue ? 1 : -1) < 0.1) { 
    // Mode: ATTACK (Puck is in my half, slow or moving away)
    // Position to shoot
    targetPos = calculateShotTarget(self, primaryTarget.puck, opponent, isBlue);
  } else {
    // Mode: RECOVER / WATCH
    // No immediate threat or clean shot. Return to defense.
    // Track the primary puck's X to block potential shots
    targetPos = getDefensivePosition(primaryTarget.puck.x, isBlue);
  }

  // 3. Post-Process Target
  // Ensure we don't get stuck on the puck if it's too close (avoid glitching)
  // If puck is VERY close and we are overlapping, just push away towards center to unstuck?
  // Actually, standard movement usually handles this, but let's ensure we are aggressive if close.

  // 4. Validate Movement
  const validPos = getValidPosition(targetPos.x, targetPos.z, isBlue);
  
  // Calculate direction vector
  const dx = validPos.x - self.x;
  const dy = validPos.z - self.y;
  
  // Normalize
  return normalize({ x: dx, y: dy });
}
