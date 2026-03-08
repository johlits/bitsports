export const id = "claude-sonnet-4-6";
export const name = "Claude Sonnet 4.6";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function angleTo(from, to) {
  return Math.atan2(to.z - from.z, to.x - from.x);
}

function blendPoint(a, b, t) {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function tick(state) {
  const {
    self,
    opponents,
    track,
    itemBoxes,
    hazards,
    projectiles,
    getNextCheckpoint,
    getCenterlinePoint,
    findNearestOpponentAhead,
  } = state;

  const roadHalf = track.roadWidth * 0.5;
  const cp0 = getNextCheckpoint(0);
  const cp1 = getNextCheckpoint(1);
  const cp2 = getNextCheckpoint(2);

  // --- 1. CURVATURE ANALYSIS ---
  // Sample multiple lookahead distances to estimate near/far curvature
  const cl0 = { ...getCenterlinePoint(0) };
  const cl2 = { ...getCenterlinePoint(2) };
  const cl5 = { ...getCenterlinePoint(5) };
  const cl9 = { ...getCenterlinePoint(9) };
  const cl14 = { ...getCenterlinePoint(14) };

  const nearCurve = Math.abs(wrapAngle(angleTo(cl0, cl5) - angleTo(cl0, cl2)));
  const midCurve  = Math.abs(wrapAngle(angleTo(cl2, cl9) - angleTo(cl2, cl5)));
  const farCurve  = Math.abs(wrapAngle(angleTo(cl5, cl14) - angleTo(cl5, cl9)));

  // Weighted curvature: tighter corners ahead matter more for braking
  const brakeCurve = nearCurve * 1.4 + midCurve * 0.8 + farCurve * 0.35;
  const steerCurve = nearCurve * 1.0 + midCurve * 0.5;

  // Turn direction sign (+1 = left, -1 = right in angle space)
  const turnDir = Math.sign(wrapAngle(angleTo(cl2, cl9) - angleTo(cl0, cl5)));

  // --- 2. CHECKPOINT-FIRST TARGET ---
  // Compute lateral offset from next checkpoint plane
  const lateralOffset = (self.x - cp0.x) * cp0.nx + (self.z - cp0.z) * cp0.nz;
  const laneCorrection = clamp(-lateralOffset * 0.9, -roadHalf * 0.55, roadHalf * 0.55);

  const cpTarget = {
    x: cp0.x + cp0.nx * laneCorrection,
    z: cp0.z + cp0.nz * laneCorrection,
  };

  // Blend with dynamic speed-scaled centerline lookahead
  const lookahead = clamp(Math.floor(3 + self.speed * 0.55), 3, 11);
  const clTarget = { ...getCenterlinePoint(lookahead) };
  let target = blendPoint(cpTarget, clTarget, 0.38);

  // Far target for stable heading feed-forward
  const farTarget = blendPoint(
    { x: cp1.x, z: cp1.z },
    { ...getCenterlinePoint(clamp(lookahead + 6, 7, 18)) },
    0.4
  );

  // Far-far target for very early corner anticipation
  const vfarTarget = { x: cp2.x, z: cp2.z };

  // --- 3. RACING LINE: APEX CUTTING ---
  // Push target toward inside of curve when meaningful curvature exists
  if (steerCurve > 0.18 && !self.offRoad) {
    const apexBias = clamp(steerCurve * 1.6, 0, roadHalf * 0.55);
    // Shift toward inside of the upcoming turn
    target.x += cp0.nx * turnDir * apexBias;
    target.z += cp0.nz * turnDir * apexBias;
    // Also pre-open: shift far target to the outside of the upcoming curve
    // so we exit wide and carry more speed
    const exitBias = clamp(steerCurve * 0.7, 0, roadHalf * 0.3);
    farTarget.x -= cp1.nx * turnDir * exitBias;
    farTarget.z -= cp1.nz * turnDir * exitBias;
  }

  // --- 4. ITEM BOX COLLECTION ---
  if (!self.item && !self.offRoad && steerCurve < 0.32) {
    let bestBox = null;
    let bestScore = -Infinity;
    for (const box of itemBoxes) {
      const d = dist(self, box);
      if (d > 2 && d < 16) {
        const ang = Math.abs(wrapAngle(angleTo(self, box) - self.heading));
        const boxLane = Math.abs((box.x - cp0.x) * cp0.nx + (box.z - cp0.z) * cp0.nz);
        // Prefer boxes ahead, on the current lane, and roughly in our direction
        const score = -d * 0.8 - ang * 9 - boxLane * 0.6;
        if (score > bestScore && ang < 0.55 && self.speed > 3.5) {
          bestScore = score;
          bestBox = box;
        }
      }
    }
    if (bestBox) {
      target = blendPoint(target, bestBox, 0.22);
    }
  }

  // --- 5. HAZARD AVOIDANCE ---
  for (const haz of hazards) {
    const d = dist(self, haz);
    if (d < 7.0) {
      const ang = wrapAngle(angleTo(self, haz) - self.heading);
      if (Math.abs(ang) < 0.65) {
        const side = ang > 0 ? -1 : 1;
        const strength = clamp((7.0 - d) / 7.0, 0, 1) * 1.8;
        target.x += cp0.nx * side * strength;
        target.z += cp0.nz * side * strength;
      }
    }
  }

  // --- 6. INCOMING PROJECTILE DODGE ---
  for (const proj of projectiles) {
    if (proj.ownerId === self.id) continue;
    const future = { x: proj.x + proj.vx * 0.4, z: proj.z + proj.vz * 0.4 };
    const d = dist(self, future);
    if (d < 5.0) {
      const ang = wrapAngle(angleTo(self, future) - self.heading);
      if (Math.abs(ang) < 0.8) {
        const side = ang > 0 ? -1 : 1;
        const strength = clamp((5.0 - d) / 5.0, 0, 1) * 1.5;
        target.x += cp0.nx * side * strength;
        target.z += cp0.nz * side * strength;
      }
    }
  }

  // --- 7. OPPONENT OVERTAKING ---
  const ahead = findNearestOpponentAhead();
  if (ahead && ahead.distance < 8 && !self.offRoad && steerCurve < 0.28) {
    const ang = wrapAngle(angleTo(self, ahead) - self.heading);
    if (Math.abs(ang) < 0.5) {
      // Pass on the side with more space from the lane boundary
      const side = ang > 0 ? -1 : 1;
      const passBias = clamp((8 - ahead.distance) / 8, 0, 1) * Math.min(roadHalf * 0.35, 1.2);
      target.x += cp0.nx * side * passBias;
      target.z += cp0.nz * side * passBias;
    }
  }

  // --- 8. OFF-ROAD RECOVERY ---
  if (self.offRoad) {
    const recovery = blendPoint(cl0, cl2, 0.4);
    target = blendPoint(target, recovery, 0.88);
  }

  // --- 9. STEERING ---
  const cpErr  = wrapAngle(angleTo(self, cpTarget) - self.heading);
  const tgtErr = wrapAngle(angleTo(self, target) - self.heading);
  const farErr = wrapAngle(angleTo(self, farTarget) - self.heading);
  const vfarErr = wrapAngle(angleTo(self, vfarTarget) - self.heading);
  const absErr = Math.abs(tgtErr);

  const startupMode = self.lap === 0 && self.progress < 1.2 && self.speed < 5.0;

  // Weighted multi-horizon steering: checkpoint error anchors us to the road,
  // target blends in fine corrections, far targets help project the ideal exit
  let steer = clamp(
    cpErr  * 0.90 +
    tgtErr * 0.70 +
    farErr * 0.30 +
    vfarErr * 0.12,
    -1, 1
  );

  // --- 10. SPEED CONTROL ---
  let throttle = 1;
  let brake = 0;

  // Target speed drops with sharpness of upcoming corners and heading error
  const desiredSpeed = clamp(
    13.6 - brakeCurve * 6.8 - absErr * 2.8 - (self.offRoad ? 3.5 : 0),
    self.offRoad ? 4.2 : 6.8,
    13.6
  );

  if (self.speed > desiredSpeed + 1.0) {
    brake = clamp((self.speed - desiredSpeed) / 3.6, 0, 1);
    throttle = clamp(0.85 - brake * 0.9, 0, 1);
  } else if (self.speed > desiredSpeed) {
    throttle = 0.42;
    brake = 0.08;
  }

  // Heavy correction if pointed badly wrong (but not during startup)
  if (!startupMode) {
    if (absErr > 0.95) {
      throttle = 0.08;
      brake = Math.max(brake, 0.85);
    } else if (absErr > 0.62) {
      throttle = Math.min(throttle, 0.48);
      brake = Math.max(brake, self.speed > 9 ? 0.38 : 0);
    }
  }

  // Startup: commit straight forward along the checkpoint tangent
  if (startupMode) {
    throttle = 1;
    brake = 0;
    steer = clamp(cpErr / 1.6, -0.18, 0.18);
  }

  // Off-road: just get back on track, don't brake
  if (self.offRoad) {
    throttle = Math.max(throttle, 0.72);
    brake = 0;
    steer = clamp(tgtErr / 0.7, -0.88, 0.88);
  }

  // --- 11. ITEM USAGE ---
  let useItem = false;
  if (self.item === "boost") {
    // Only boost on clear straights at decent speed
    const straight = brakeCurve < 0.15 && absErr < 0.15;
    if (straight && !self.offRoad && self.speed > 7.5) {
      useItem = true;
    }
  } else if (self.item === "oil") {
    // Drop when a close pursuer is lined up behind us
    const closePursuer = opponents.some((o) => {
      if (o.progress >= self.progress) return false;
      const d = dist(self, o);
      const ang = Math.abs(wrapAngle(angleTo(o, self) - o.heading));
      return d < 6.5 && ang < 0.45;
    });
    if (closePursuer) {
      useItem = true;
    }
  } else if (self.item === "rocket") {
    // Fire when we have a clean forward shot
    if (ahead && ahead.distance < 22) {
      const shotErr = Math.abs(wrapAngle(angleTo(self, ahead) - self.heading));
      if (shotErr < 0.22 && !self.offRoad) {
        useItem = true;
      }
    }
  }

  return { throttle, brake, steer, useItem };
}
