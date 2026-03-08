export const id = "claude-opus-4-6";
export const name = "Claude Opus 4.6";

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

function blendPt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

function dotN(px, pz, cx, cz, nx, nz) {
  return (px - cx) * nx + (pz - cz) * nz;
}

// Persistent state across ticks (closure-safe per module instance)
let prevLateralOffset = 0;
let smoothCurve = 0;
let tickCount = 0;

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

  tickCount++;
  const roadHalf = track.roadWidth * 0.5;
  const cp0 = getNextCheckpoint(0);
  const cp1 = getNextCheckpoint(1);
  const cp2 = getNextCheckpoint(2);
  const cp3 = getNextCheckpoint(3);

  // === 1. MULTI-HORIZON CURVATURE SAMPLING ===
  const cl = [];
  for (let i = 0; i <= 20; i += 2) {
    cl.push({ ...getCenterlinePoint(i) });
  }

  // Compute curvature at each segment pair
  let curvatures = [];
  for (let i = 0; i < cl.length - 2; i++) {
    const a1 = angleTo(cl[i], cl[i + 1]);
    const a2 = angleTo(cl[i + 1], cl[i + 2]);
    curvatures.push(Math.abs(wrapAngle(a2 - a1)));
  }

  // Peak curvature ahead (worst corner coming up)
  const peakCurve = Math.max(...curvatures);
  // Weighted: near matters more for braking, far for anticipation
  const nearCurve = (curvatures[0] || 0) * 1.3 + (curvatures[1] || 0) * 0.9;
  const midCurve  = (curvatures[2] || 0) * 0.7 + (curvatures[3] || 0) * 0.5;
  const farCurve  = (curvatures[4] || 0) * 0.3 + (curvatures[5] || 0) * 0.2;
  const brakeCurve = nearCurve + midCurve + farCurve;

  // Smoothed curvature for less jitter
  smoothCurve = smoothCurve * 0.7 + brakeCurve * 0.3;

  // Turn direction from near segments
  const turnDir = Math.sign(wrapAngle(angleTo(cl[1], cl[3]) - angleTo(cl[0], cl[2])));

  // === 2. CHECKPOINT-FIRST TARGET WITH PROPORTIONAL LANE CORRECTION ===
  const lateralOffset = dotN(self.x, self.z, cp0.x, cp0.z, cp0.nx, cp0.nz);
  const lateralRate = lateralOffset - prevLateralOffset;
  prevLateralOffset = lateralOffset;

  // PD controller for lane centering
  const laneP = clamp(-lateralOffset * 0.95, -roadHalf * 0.6, roadHalf * 0.6);
  const laneD = clamp(-lateralRate * 2.5, -roadHalf * 0.2, roadHalf * 0.2);
  const laneBias = laneP + laneD;

  const cpTarget = {
    x: cp0.x + cp0.nx * laneBias,
    z: cp0.z + cp0.nz * laneBias,
  };

  // === 3. DYNAMIC LOOKAHEAD ===
  // Higher speed = look further, sharper curve = look closer
  const speedRatio = clamp(self.speed / 13.5, 0, 1);
  const lookahead = clamp(Math.floor(3 + speedRatio * 9 - smoothCurve * 3), 3, 12);
  const clTarget = { ...getCenterlinePoint(lookahead) };

  // Primary target: blend checkpoint anchor with centerline guide
  let target = blendPt(cpTarget, clTarget, 0.36);

  // Secondary far targets for multi-horizon steering
  const farTarget = blendPt(
    { x: cp1.x, z: cp1.z },
    { ...getCenterlinePoint(clamp(lookahead + 6, 7, 18)) },
    0.38
  );
  const vfarTarget = { x: cp2.x, z: cp2.z };

  // === 4. RACING LINE: APEX + EXIT OPTIMIZATION ===
  if (smoothCurve > 0.16 && !self.offRoad) {
    // Apex: cut inside proportional to curve severity
    const apexStr = clamp(smoothCurve * 1.8, 0, roadHalf * 0.58);
    target.x += cp0.nx * turnDir * apexStr;
    target.z += cp0.nz * turnDir * apexStr;

    // Exit: open wide on the far target to maximize corner exit speed
    const exitStr = clamp(smoothCurve * 0.6, 0, roadHalf * 0.3);
    farTarget.x -= cp1.nx * turnDir * exitStr;
    farTarget.z -= cp1.nz * turnDir * exitStr;
  }

  // === 5. ITEM BOX COLLECTION ===
  if (!self.item && !self.offRoad && smoothCurve < 0.3 && self.speed > 4) {
    let bestBox = null;
    let bestScore = -Infinity;
    for (const box of itemBoxes) {
      const d = dist(self, box);
      if (d < 16 && d > 1.5) {
        const ang = Math.abs(wrapAngle(angleTo(self, box) - self.heading));
        const boxLane = Math.abs(dotN(box.x, box.z, cp0.x, cp0.z, cp0.nx, cp0.nz));
        const score = -d * 0.7 - ang * 10 - boxLane * 0.8;
        if (score > bestScore && ang < 0.55) {
          bestScore = score;
          bestBox = box;
        }
      }
    }
    if (bestBox) {
      target = blendPt(target, bestBox, 0.2);
    }
  }

  // === 6. HAZARD AVOIDANCE ===
  for (const haz of hazards) {
    const d = dist(self, haz);
    if (d < 7.5) {
      const ang = wrapAngle(angleTo(self, haz) - self.heading);
      if (Math.abs(ang) < 0.7) {
        const side = ang > 0 ? -1 : 1;
        const str = clamp((7.5 - d) / 7.5, 0, 1) * 2.0;
        target.x += cp0.nx * side * str;
        target.z += cp0.nz * side * str;
      }
    }
  }

  // === 7. PROJECTILE EVASION ===
  for (const proj of projectiles) {
    if (proj.ownerId === self.id) continue;
    // Predict projectile position 0.35s ahead
    const fut = { x: proj.x + proj.vx * 0.35, z: proj.z + proj.vz * 0.35 };
    const d = dist(self, fut);
    if (d < 5.5) {
      const ang = wrapAngle(angleTo(self, fut) - self.heading);
      if (Math.abs(ang) < 0.85) {
        const side = ang > 0 ? -1 : 1;
        const str = clamp((5.5 - d) / 5.5, 0, 1) * 1.6;
        target.x += cp0.nx * side * str;
        target.z += cp0.nz * side * str;
      }
    }
  }

  // === 8. OPPONENT OVERTAKING ===
  const ahead = findNearestOpponentAhead();
  if (ahead && ahead.distance < 8.5 && !self.offRoad && smoothCurve < 0.25) {
    const ang = wrapAngle(angleTo(self, ahead) - self.heading);
    if (Math.abs(ang) < 0.5) {
      const side = ang > 0 ? -1 : 1;
      // Scale pass bias by closeness
      const passBias = clamp((8.5 - ahead.distance) / 8.5, 0, 1) * Math.min(roadHalf * 0.38, 1.3);
      target.x += cp0.nx * side * passBias;
      target.z += cp0.nz * side * passBias;
    }
  }

  // Defensive: if someone is very close behind, weave slightly to block
  const closeBehind = opponents
    .filter((o) => o.progress < self.progress)
    .map((o) => ({ ...o, d: dist(self, o) }))
    .sort((a, b) => a.d - b.d)[0];

  if (closeBehind && closeBehind.d < 4.5 && smoothCurve < 0.2 && !self.offRoad) {
    const blockAng = wrapAngle(angleTo(self, closeBehind) - self.heading);
    if (Math.abs(blockAng) > 0.2 && Math.abs(blockAng) < 1.2) {
      const blockSide = Math.sign(blockAng);
      target.x += cp0.nx * blockSide * 0.4;
      target.z += cp0.nz * blockSide * 0.4;
    }
  }

  // === 9. OFF-ROAD RECOVERY ===
  if (self.offRoad) {
    const recovery = blendPt(cl[0], cl[1], 0.35);
    target = blendPt(target, recovery, 0.9);
  }

  // === 10. MULTI-HORIZON STEERING ===
  const cpErr   = wrapAngle(angleTo(self, cpTarget) - self.heading);
  const tgtErr  = wrapAngle(angleTo(self, target) - self.heading);
  const farErr  = wrapAngle(angleTo(self, farTarget) - self.heading);
  const vfarErr = wrapAngle(angleTo(self, vfarTarget) - self.heading);
  const absErr  = Math.abs(tgtErr);

  const startupMode = self.lap === 0 && self.progress < 1.2 && self.speed < 5;

  let steer = clamp(
    cpErr   * 0.85 +
    tgtErr  * 0.75 +
    farErr  * 0.32 +
    vfarErr * 0.10,
    -1, 1
  );

  // === 11. SPEED CONTROL ===
  let throttle = 1;
  let brake = 0;

  // Anticipatory speed target: accounts for the worst curve coming up
  const desiredSpeed = clamp(
    13.8
      - smoothCurve * 6.2
      - peakCurve * 3.5
      - absErr * 2.5
      - (self.offRoad ? 3.8 : 0),
    self.offRoad ? 4.0 : 6.5,
    13.8
  );

  if (self.speed > desiredSpeed + 1.0) {
    brake = clamp((self.speed - desiredSpeed) / 3.4, 0, 1);
    throttle = clamp(0.85 - brake * 0.85, 0, 1);
  } else if (self.speed > desiredSpeed) {
    throttle = 0.4;
    brake = 0.1;
  }

  // Trail braking: keep light brake into the turn for tighter apex
  if (smoothCurve > 0.35 && self.speed > 8 && absErr < 0.4 && !startupMode) {
    brake = Math.max(brake, 0.18);
    throttle = Math.min(throttle, 0.65);
  }

  if (!startupMode) {
    if (absErr > 0.95) {
      throttle = 0.06;
      brake = Math.max(brake, 0.9);
    } else if (absErr > 0.6) {
      throttle = Math.min(throttle, 0.45);
      brake = Math.max(brake, self.speed > 9.5 ? 0.4 : 0.05);
    }
  }

  // Startup: commit straight with full throttle, minimal steering
  if (startupMode) {
    throttle = 1;
    brake = 0;
    steer = clamp(cpErr / 1.7, -0.16, 0.16);
  }

  // Off-road: recover forward, no braking
  if (self.offRoad) {
    throttle = Math.max(throttle, 0.75);
    brake = 0;
    steer = clamp(tgtErr / 0.65, -0.9, 0.9);
  }

  // === 12. STRATEGIC ITEM USAGE ===
  let useItem = false;
  if (self.item === "boost") {
    const straight = smoothCurve < 0.13 && absErr < 0.14 && peakCurve < 0.2;
    if (straight && !self.offRoad && self.speed > 7) {
      useItem = true;
    }
  } else if (self.item === "oil") {
    if (closeBehind && closeBehind.d < 5.5) {
      const pursuerAng = Math.abs(wrapAngle(angleTo(closeBehind, self) - closeBehind.heading));
      if (pursuerAng < 0.45) {
        useItem = true;
      }
    }
  } else if (self.item === "rocket") {
    if (ahead && ahead.distance < 24 && !self.offRoad) {
      const shotErr = Math.abs(wrapAngle(angleTo(self, ahead) - self.heading));
      // Fire slightly earlier than others for more aggressive play
      if (shotErr < 0.26) {
        useItem = true;
      }
    }
  }

  return { throttle, brake, steer, useItem };
}
