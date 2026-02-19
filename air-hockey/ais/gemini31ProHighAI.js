export const id = "gemini-3-1-pro-high";
export const name = "Gemini 3.1 Pro High";

// Constants defining table dimensions and game rules
const TABLE_WIDTH = 10;
const TABLE_HALF_WIDTH = TABLE_WIDTH / 2;
const TABLE_HEIGHT = 20;
const TABLE_HALF_HEIGHT = TABLE_HEIGHT / 2;
const GOAL_WIDTH = 4.0;
const GOAL_HALF_WIDTH = GOAL_WIDTH / 2;
const PADDLE_RADIUS = 0.35;
const PUCK_RADIUS = 0.25;
const CREASE_RADIUS = 2.5;
const MAX_PADDLE_SPEED = 6.0;

// Internal AI tuning parameters
const DEFENSE_Z_OFFSET = 1.5; // How far in front of goal to sit
const OFFENSE_Z_LIMIT = 8.0; // How far forward we're willing to go
const PUCK_DANGER_TIME = 1.5; // Seconds until a puck reaches our baseline to be considered imminent threat
const PREDICTION_STEPS = 60; // How far ahead to simulate puck trajectories
const PREDICTION_DT = 0.05; // Time step for simulation
const FRICTION = 0.997; // Per step friction (rough estimate for continuous math: vel *= Math.pow(0.997, dt*60))

// State tracking between ticks
let state = {
    isBlue: true, // blue defends +Z, red defends -Z
    myGoalZ: 0,
    oppGoalZ: 0,
    myMinZ: 0,
    myMaxZ: 0,
    initialized: false
};

function init(self) {
    state.isBlue = self.y > 0;
    state.myGoalZ = state.isBlue ? TABLE_HALF_HEIGHT : -TABLE_HALF_HEIGHT;
    state.oppGoalZ = state.isBlue ? -TABLE_HALF_HEIGHT : TABLE_HALF_HEIGHT;
    
    // Y represents Z axis in the engine data structure
    if (state.isBlue) {
        state.myMinZ = 0;
        state.myMaxZ = TABLE_HALF_HEIGHT - PADDLE_RADIUS;
    } else {
        state.myMinZ = -TABLE_HALF_HEIGHT + PADDLE_RADIUS;
        state.myMaxZ = 0;
    }
    state.initialized = true;
}

// Distance helper
function dist(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
}

function normalize(v) {
    const len = Math.sqrt(v.x * v.x + v.z * v.z);
    if (len === 0) return { x: 0, z: 0 };
    return { x: v.x / len, z: v.z / len };
}

// Clamp to allowed half
function clampToHalf(z) {
    return Math.max(state.myMinZ, Math.min(state.myMaxZ, z));
}

// Predict puck trajectory (simple raycast ignoring complex bounces for speed, 
// but handles basic wall bounces)
function predictPuck(puck, timeAhead) {
    let px = puck.x;
    let pz = puck.y;
    let vx = puck.velocity.x;
    let vz = puck.velocity.y;
    
    // Fast continuous approximation
    let t = 0;
    while (t < timeAhead) {
        // Apply friction
        const speed = Math.hypot(vx, vz);
        if (speed > 0.5) {
            const f = Math.pow(FRICTION, PREDICTION_DT * 60);
            vx *= f;
            vz *= f;
        }

        px += vx * PREDICTION_DT;
        pz += vz * PREDICTION_DT;
        
        // Wall bounces
        const maxRx = TABLE_HALF_WIDTH - PUCK_RADIUS;
        if (px > maxRx) { px = maxRx - (px - maxRx); vx = -vx; }
        else if (px < -maxRx) { px = -maxRx + (-maxRx - px); vx = -vx; }
        
        // Back wall bounces (ignoring goals for simple intercept prediction)
        const maxRz = TABLE_HALF_HEIGHT - PUCK_RADIUS;
        if (pz > maxRz) { pz = maxRz - (pz - maxRz); vz = -vz; }
        else if (pz < -maxRz) { pz = -maxRz + (-maxRz - pz); vz = -vz; }
        
        t += PREDICTION_DT;
    }
    
    return { x: px, z: pz };
}

// Calculate danger score for a puck
function evaluateThreat(puck, self) {
    // If puck is moving away from our goal, low threat
    const vzRelative = state.isBlue ? puck.velocity.y : -puck.velocity.y;
    if (vzRelative <= 0.1) return 0;
    
    // Distance to our baseline
    const zDist = Math.abs(puck.y - state.myGoalZ);
    // Time to reach our baseline
    const timeToBaseline = zDist / Math.abs(puck.velocity.y);
    
    // If it's going to take too long, low threat
    if (timeToBaseline > PUCK_DANGER_TIME * 2) return 0;
    
    // Predict where it crosses our baseline
    const interceptX = puck.x + puck.velocity.x * timeToBaseline;
    
    // Is it on target for the goal?
    const isGoalBound = Math.abs(interceptX) < GOAL_HALF_WIDTH + PUCK_RADIUS * 2;
    
    let score = 100 / (timeToBaseline + 0.1);
    if (isGoalBound) score *= 5; // massive priority to actual shots
    
    // Bonus if it's currently very close to us
    const d = dist(self.x, self.y, puck.x, puck.y);
    score += 50 / (d + 1);
    
    return score;
}

export function tick({ pucks, self, opponent, dt }) {
    if (!state.initialized || (self.y > 0) !== state.isBlue) {
        init(self);
    }

    if (!pucks || pucks.length === 0) {
        // Return to home position
        const homeX = 0;
        const homeZ = state.isBlue ? state.myMaxZ - DEFENSE_Z_OFFSET : state.myMinZ + DEFENSE_Z_OFFSET;
        return normalize({ x: homeX - self.x, z: homeZ - self.y });
    }

    // 1. Analyze threats
    let mostDangerousPuck = null;
    let highestThreat = -1;
    
    // Also track the best offensive opportunity
    let bestOffensePuck = null;
    let bestOffenseScore = -1;

    for (const puck of pucks) {
        // Check defensive threat
        const threat = evaluateThreat(puck, self);
        if (threat > highestThreat) {
            highestThreat = threat;
            mostDangerousPuck = puck;
        }

        // Check offensive opportunity (puck is slow, in our half, or moving toward opp)
        const isOurHalf = state.isBlue ? puck.y > 0 : puck.y < 0;
        const speed = Math.hypot(puck.velocity.x, puck.velocity.y);
        
        if (isOurHalf) {
            const d = dist(self.x, self.y, puck.x, puck.y);
            // Time to intercept
            const tti = d / MAX_PADDLE_SPEED;
            // Predict puck position when we arrive
            const futurePuck = predictPuck(puck, tti);
            
            // Still in our half?
            const futureInOurHalf = state.isBlue ? futurePuck.z > 0 : futurePuck.z < 0;
            if (futureInOurHalf) {
                // Good target
                const oppScore = 100 / (d + 1) + (10 - speed);
                if (oppScore > bestOffenseScore) {
                    bestOffenseScore = oppScore;
                    bestOffensePuck = puck;
                }
            }
        }
    }

    // 2. Decide Strategy
    let target = null;
    let isDefending = false;

    // If we have an imminent threat, defend at all costs
    if (highestThreat > 20 && mostDangerousPuck) {
        isDefending = true;
        
        // Predict where to block
        const zDist = Math.abs(mostDangerousPuck.y - self.y);
        const tti = zDist / Math.max(1, Math.abs(mostDangerousPuck.velocity.y));
        const futureX = mostDangerousPuck.x + mostDangerousPuck.velocity.x * Math.min(tti, 0.5);
        
        // Block position: between puck and goal
        const defZ = state.isBlue ? 
            Math.max(self.y - 1.0, state.myMaxZ - DEFENSE_Z_OFFSET) : 
            Math.min(self.y + 1.0, state.myMinZ + DEFENSE_Z_OFFSET);
            
        // Stay within goal width if puck is outside, to protect angles
        const blockX = Math.max(-GOAL_HALF_WIDTH + 0.5, Math.min(GOAL_HALF_WIDTH - 0.5, futureX));
        
        target = { x: blockX, z: defZ };
        
        // If it's super close, swing at it to clear
        const d = dist(self.x, self.y, mostDangerousPuck.x, mostDangerousPuck.y);
        if (d < 2.0) {
            // Swing forward/outward
            const swingZ = state.isBlue ? -1 : 1;
            const swingX = mostDangerousPuck.x > 0 ? 1 : -1;
            return normalize({ x: mostDangerousPuck.x - self.x + swingX, z: mostDangerousPuck.y - self.y + swingZ });
        }

    } 
    // Otherwise, play offense on best available puck
    else if (bestOffensePuck) {
        const d = dist(self.x, self.y, bestOffensePuck.x, bestOffensePuck.y);
        const tti = d / MAX_PADDLE_SPEED;
        const futurePuck = predictPuck(bestOffensePuck, tti * 0.8); // slightly aggressive lead
        
        // Aim to hit the puck toward opponent's goal
        // We want our paddle to be slightly *behind* the puck relative to the target
        const attackVecX = 0 - futurePuck.x; // Aim for center of goal
        const attackVecZ = state.oppGoalZ - futurePuck.z;
        const attackLen = Math.hypot(attackVecX, attackVecZ);
        
        // Position ourselves behind the puck
        const behindOffset = PADDLE_RADIUS + PUCK_RADIUS + 0.1;
        const interceptX = futurePuck.x - (attackVecX / attackLen) * behindOffset;
        const interceptZ = futurePuck.z - (attackVecZ / attackLen) * behindOffset;
        
        target = { x: interceptX, z: interceptZ };
        
        // If we are very close to intercept point, swing *through* the puck
        const distToIntercept = dist(self.x, self.y, interceptX, interceptZ);
        if (distToIntercept < 0.5) {
            target = { 
                x: futurePuck.x + (attackVecX / attackLen) * 2, 
                z: futurePuck.z + (attackVecZ / attackLen) * 2 
            };
        }
    } 
    // Fallback: Default defense position
    else {
        const homeX = 0;
        const homeZ = state.isBlue ? state.myMaxZ - DEFENSE_Z_OFFSET : state.myMinZ + DEFENSE_Z_OFFSET;
        target = { x: homeX, z: homeZ };
    }

    // 3. Navigate to target, avoiding crease
    // Crease avoidance
    const creaseCenterX = 0;
    const creaseCenterZ = state.myGoalZ;
    const distToCreaseTarget = dist(target.x, target.z, creaseCenterX, creaseCenterZ);
    
    // If target is inside crease, push it out
    if (distToCreaseTarget < CREASE_RADIUS + PADDLE_RADIUS) {
        const dirX = target.x - creaseCenterX;
        const dirZ = target.z - creaseCenterZ;
        const dirLen = Math.hypot(dirX, dirZ);
        if (dirLen > 0.001) {
            const pushOut = CREASE_RADIUS + PADDLE_RADIUS + 0.1;
            target.x = creaseCenterX + (dirX / dirLen) * pushOut;
            target.z = creaseCenterZ + (dirZ / dirLen) * pushOut;
        } else {
            // Dead center? Push sideways
            target.x = CREASE_RADIUS + PADDLE_RADIUS + 0.1;
        }
    }
    
    // Constrain target Z to our half
    target.z = clampToHalf(target.z);

    // Compute final movement vector
    return normalize({ x: target.x - self.x, z: target.z - self.y });
}
