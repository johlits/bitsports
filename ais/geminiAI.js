export const id = "gemini-3-pro-low";
export const name = "Gemini 3 Pro (low)";

// Advanced AI with predictive interception and defensive positioning
export function tick({ pucks, self, opponent, dt }) {
  const isBlue = self.y > 0; // Assuming blue is positive Z (top)
  
  // Find best puck to target
  let puck = pucks[0];
  let minScore = Infinity;
  
  for (const p of pucks) {
    const distSq = (p.x - self.x)**2 + (p.y - self.y)**2;
    const movingTowardsMe = isBlue ? p.velocity.y > 0 : p.velocity.y < 0;
    
    let score = distSq;
    if (movingTowardsMe) score *= 0.5; 
    
    if (score < minScore) {
        minScore = score;
        puck = p;
    }
  }
  
  if (!puck) return { x: 0, z: 0 }; // Should not happen if pucks > 0

  const homeZ = isBlue ? 8.5 : -8.5; // Default defensive spot near goal
  const attackLineZ = isBlue ? 6.0 : -6.0; // Forward defense line
  
  // 1. Determine state
  const movingTowardsMe = isBlue ? puck.velocity.y > 0 : puck.velocity.y < 0;
  const puckSpeed = Math.hypot(puck.velocity.x, puck.velocity.y);
  
  let targetX = puck.x;
  let targetZ = homeZ;

  // 2. Attack / Intercept Logic
  if (movingTowardsMe && puckSpeed > 0.1) {
    // Simple linear prediction: where will the puck cross my paddle line?
    // We want to intercept slightly ahead of the puck to hit it forward.
    
    // Time to reach paddle Z plane?
    // self.y is roughly where our paddle is. 
    // Let's try to meet it at a dynamic Z point between home and the puck.
    
    // Ideally, we intercept it when it enters our zone.
    // Intercept zone is between homeZ (8.5) and attackLineZ (6.0) approx
    const interceptZ = isBlue ? Math.min(self.y, 9.0) : Math.max(self.y, -9.0);
    
    // Time to reach intercept Z
    const timeToIntercept = (interceptZ - puck.y) / puck.velocity.y;
    
    if (timeToIntercept > 0 && timeToIntercept < 1.5) {
      // Predict X at that time
      let predictedX = puck.x + puck.velocity.x * timeToIntercept;
      
      // Handle wall bounces (simple approximation)
      const tableHalfWidth = 5.0; // table width is 10
      const effectiveWidth = tableHalfWidth - 0.25; // minus puck radius roughly
      
      // If X is out of bounds, reflect it
      // Simple triangle wave folding
      while (predictedX > effectiveWidth || predictedX < -effectiveWidth) {
        if (predictedX > effectiveWidth) {
            const overshoot = predictedX - effectiveWidth;
            predictedX = effectiveWidth - overshoot;
        } else if (predictedX < -effectiveWidth) {
            const overshoot = -effectiveWidth - predictedX;
            predictedX = -effectiveWidth + overshoot;
        }
      }
      
      targetX = predictedX;
      targetZ = interceptZ;
      
      // Aggression: If the puck is close and we are aligned, strike through it!
      const distToPuck = Math.hypot(puck.x - self.x, puck.y - self.y);
      if (distToPuck < 1.0 && Math.abs(self.x - puck.x) < 0.5) {
         // Move Z towards opponent to hit it
         targetZ = isBlue ? puck.y - 1.0 : puck.y + 1.0; 
      }
    } else {
      // Puck is moving towards us but far away or slow, track X but stay defensive
      targetX = puck.x;
      targetZ = homeZ;
    }
  } else {
    // 3. Defensive / Idle Logic
    // Puck moving away or stopped.
    // If it's in our half, go get it (chase), otherwise return home.
    const inMyHalf = isBlue ? puck.y > 0 : puck.y < 0;
    
    if (inMyHalf) {
      targetX = puck.x;
      targetZ = puck.y;
    } else {
      // Return to center-ish of goal
      targetX = puck.x * 0.3; // Shadow the puck slightly X-wise
      targetZ = homeZ;
    }
  }

  // 4. Move Execution
  const dirX = targetX - self.x;
  const dirZ = targetZ - self.y;
  const len = Math.hypot(dirX, dirZ) || 1;
  
  return { x: dirX / len, z: dirZ / len };
}
