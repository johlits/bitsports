export const id = "swe-1-5";
export const name = "SWE-1.5";

// Game constants (matching engine)
const TABLE_WIDTH = 10;
const TABLE_HEIGHT = 20;
const GOAL_WIDTH = 4.0;
const GOAL_CREASE_RADIUS = 2.5;
const PADDLE_RADIUS = 0.35;
const PUCK_RADIUS = 0.25;
const MIN_PUCK_SPEED = 0.5;
const MAX_PUCK_SPEED = 15;

const HALF_W = TABLE_WIDTH / 2;
const HALF_H = TABLE_HEIGHT / 2;
const PADDLE_X_LIMIT = HALF_W - PADDLE_RADIUS;

// Advanced AI parameters
const PREDICTION_TIME = 0.8; // How far ahead to predict puck movement
const DEFENSIVE_LINE_FACTOR = 0.25; // How far back to play defense
const OFFENSIVE_AGGRESSIVENESS = 0.7; // How aggressively to pursue offense
const REACTION_TIME = 0.1; // Simulated human reaction delay

// Memory for strategic decisions
let memory = {
    lastTargetPuck: null,
    lastShotTime: 0,
    opponentPattern: null,
    defensivePosition: { x: 0, z: 0 },
    lastMoveTime: 0,
    predictedPuckPath: []
};

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

// Predict puck position given current velocity and time
function predictPuckPosition(puck, time) {
    const friction = 0.997; // Match engine friction
    let vx = puck.velocity.x;
    let vz = puck.velocity.y;
    let x = puck.x;
    let z = puck.y;
    
    // Simulate physics for prediction time
    const dt = 0.016; // ~60fps timestep
    const steps = Math.floor(time / dt);
    
    for (let i = 0; i < steps; i++) {
        x += vx * dt;
        z += vz * dt;
        
        // Apply friction
        vx *= friction;
        vz *= friction;
        
        // Bounce off walls (simplified)
        if (Math.abs(x) > HALF_W - 0.25) {
            vx *= -0.9;
            x = Math.sign(x) * (HALF_W - 0.25);
        }
        if (Math.abs(z) > HALF_H - 0.25) {
            vz *= -0.9;
            z = Math.sign(z) * (HALF_H - 0.25);
        }
        
        // Stop if speed is too low
        const speed = Math.sqrt(vx * vx + vz * vz);
        if (speed < MIN_PUCK_SPEED) break;
    }
    
    return { x, z, vx, vz };
}

// Calculate best defensive position
function getDefensivePosition(isBlue, opponentPos) {
    const baseZ = isBlue ? 
        HALF_H * DEFENSIVE_LINE_FACTOR : 
        -HALF_H * DEFENSIVE_LINE_FACTOR;
    
    // Position between goal and opponent, but favor center
    const targetX = opponentPos.x * 0.3; // Partially mirror opponent
    
    return { x: targetX, z: baseZ };
}

// Calculate optimal shot angle for scoring
function calculateShotAngle(puckPos, isBlue) {
    const goalZ = isBlue ? HALF_H : -HALF_H;
    const goalLeft = -GOAL_WIDTH / 2;
    const goalRight = GOAL_WIDTH / 2;
    
    // Aim for center of goal initially
    let targetX = 0;
    
    // Adjust based on puck position for better angles
    if (Math.abs(puckPos.x) > 1) {
        // If puck is to the side, aim for opposite corner
        targetX = -puckPos.x * 0.3;
    }
    
    // Clamp to goal bounds
    targetX = clamp(targetX, goalLeft, goalRight);
    
    const dx = targetX - puckPos.x;
    const dz = goalZ - puckPos.y;
    
    return { x: dx, z: dz };
}

// Detect if puck is in scoring position
function isScoringOpportunity(puck, isBlue) {
    const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;
    const movingTowardsGoal = isBlue ? puck.velocity.y > 0 : puck.velocity.y < 0;
    const hasGoodSpeed = puck.velocity.length() > 2;
    
    return inMyHalf && movingTowardsGoal && hasGoodSpeed;
}

// Find the most threatening puck
function findMostThreateningPuck(pucks, isBlue, selfPos) {
    let bestPuck = null;
    let highestThreat = -Infinity;
    
    for (const puck of pucks) {
        let threat = 0;
        
        // Distance threat (closer = more threatening if in our half)
        const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;
        const dist = Math.hypot(puck.x - selfPos.x, puck.y - selfPos.y);
        
        if (inMyHalf) {
            threat += 10 / (dist + 0.1);
        }
        
        // Velocity threat (moving towards our goal)
        const movingTowardsGoal = isBlue ? puck.velocity.y > 0 : puck.velocity.y < 0;
        if (movingTowardsGoal) {
            threat += puck.velocity.length() * 2;
        }
        
        // Speed threat (fast pucks are more dangerous)
        threat += puck.velocity.length();
        
        // Position threat (pucks in scoring position)
        if (isScoringOpportunity(puck, isBlue)) {
            threat += 15;
        }
        
        if (threat > highestThreat) {
            highestThreat = threat;
            bestPuck = puck;
        }
    }
    
    return bestPuck;
}

// Calculate bank shot possibility
function calculateBankShot(puckPos, isBlue) {
    // Check if bank shot off side walls is viable
    const wallX = Math.sign(puckPos.x) * (HALF_W - 0.3);
    const goalZ = isBlue ? HALF_H : -HALF_H;
    
    // Simple bank shot calculation
    const toWallX = wallX - puckPos.x;
    const toWallZ = 0; // Aim straight for wall
    const toGoalX = 0 - wallX;
    const toGoalZ = goalZ - 0;
    
    // Check if angles work for bank shot
    const angleToWall = Math.atan2(toWallZ, toWallX);
    const angleToGoal = Math.atan2(toGoalZ, toGoalX);
    
    // If angles are roughly opposite, bank shot might work
    if (Math.abs(angleToWall - angleToGoal) > Math.PI * 0.7) {
        return { x: toWallX, z: toWallZ };
    }
    
    return null;
}

// Advanced tactical decision making
export function tick({ pucks, self, opponent, dt }) {
    const isBlue = self.y > 0;
    
    // Update reaction time (simulated human delay)
    memory.lastMoveTime += dt;
    if (memory.lastMoveTime < REACTION_TIME) {
        return { x: 0, z: 0 };
    }
    memory.lastMoveTime = 0;

    // Find most threatening puck
    const targetPuck = findMostThreateningPuck(pucks, isBlue, self);
    if (!targetPuck) {
        // Fall back to defensive position
        const defPos = getDefensivePosition(isBlue, opponent);
        const clamped = clampToHalfAndWalls(defPos.x, defPos.z, isBlue);
        const finalPos = clampOutsideCrease(clamped.x, clamped.z, isBlue);
        
        const dx = finalPos.x - self.x;
        const dz = finalPos.z - self.y;
        const dist = Math.hypot(dx, dz);
        
        return dist > 0.1 ? { x: dx / dist, z: dz / dist } : { x: 0, z: 0 };
    }

    // Predict puck path
    const predictedPos = predictPuckPosition(targetPuck, PREDICTION_TIME);
    memory.predictedPuckPath = [predictedPos];

    // Decision tree based on game state
    const inMyHalf = isBlue ? targetPuck.y > 0 : targetPuck.y < 0;
    const movingTowardsMyGoal = isBlue ? targetPuck.velocity.y > 0 : targetPuck.velocity.y < 0;
    const distToPuck = Math.hypot(predictedPos.x - self.x, predictedPos.z - self.y);

    // DEFENSIVE MODE: Puck in our half or moving toward our goal
    if (inMyHalf || movingTowardsMyGoal) {
        // Intercept the puck
        const dx = predictedPos.x - self.x;
        const dz = predictedPos.z - self.y;
        const dist = Math.hypot(dx, dz);
        
        if (dist > 0.1) {
            return { x: dx / dist, z: dz / dist };
        }
    }

    // OFFENSIVE MODE: Puck in opponent's half and we have good position
    if (!inMyHalf && !movingTowardsMyGoal && distToPuck < 3) {
        // Calculate best shot
        const shotAngle = calculateShotAngle(targetPuck, isBlue);
        
        // Check for bank shot opportunities
        const bankShot = calculateBankShot(targetPuck, isBlue);
        if (bankShot && Math.random() < 0.3) { // 30% chance to attempt bank shot
            return bankShot;
        }
        
        return shotAngle;
    }

    // TRANSITION MODE: Move toward puck but maintain defensive awareness
    const moveToPuckX = predictedPos.x - self.x;
    const moveToPuckZ = predictedPos.z - self.y;
    const moveDist = Math.hypot(moveToPuckX, moveToPuckZ);
    
    if (moveDist > 0.1) {
        // Blend offensive and defensive positioning
        const defPos = getDefensivePosition(isBlue, opponent);
        const toDefX = defPos.x - self.x;
        const toDefZ = defPos.z - self.y;
        
        // Weight based on distance and game situation
        const offensiveWeight = Math.max(0, 1 - moveDist / 5);
        const defensiveWeight = 1 - offensiveWeight * OFFENSIVE_AGGRESSIVENESS;
        
        const blendedX = moveToPuckX * offensiveWeight + toDefX * defensiveWeight;
        const blendedZ = moveToPuckZ * offensiveWeight + toDefZ * defensiveWeight;
        
        const blendDist = Math.hypot(blendedX, blendedZ);
        return blendDist > 0.1 ? { x: blendedX / blendDist, z: blendedZ / blendDist } : { x: 0, z: 0 };
    }

    // Default: hold position
    return { x: 0, z: 0 };
}
