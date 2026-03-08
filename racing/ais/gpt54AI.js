export const id = "gpt-5-4";
export const name = "GPT-5.4";

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
    getNextCheckpoint,
    getCenterlinePoint,
    findNearestOpponentAhead,
  } = state;

  const roadHalf = track.roadWidth * 0.5;
  const cp0 = getNextCheckpoint(0);
  const cp1 = getNextCheckpoint(1);

  const p0 = { ...getCenterlinePoint(0) };
  const p1 = { ...getCenterlinePoint(3) };
  const p2 = { ...getCenterlinePoint(6) };
  const p3 = { ...getCenterlinePoint(10) };

  const nearAngle = angleTo(p0, p1);
  const midAngle = angleTo(p1, p2);
  const farAngle = angleTo(p2, p3);
  const nearCurve = Math.abs(wrapAngle(midAngle - nearAngle));
  const farCurve = Math.abs(wrapAngle(farAngle - midAngle));
  const curve = nearCurve * 1.15 + farCurve * 0.7;

  const lookahead = clamp(Math.floor(3 + self.speed * 0.45), 3, 9);
  const cpTarget = {
    x: cp0.x + cp0.nx * clamp(-((self.x - cp0.x) * cp0.nx + (self.z - cp0.z) * cp0.nz) * 0.55, -roadHalf * 0.35, roadHalf * 0.35),
    z: cp0.z + cp0.nz * clamp(-((self.x - cp0.x) * cp0.nx + (self.z - cp0.z) * cp0.nz) * 0.55, -roadHalf * 0.35, roadHalf * 0.35),
  };
  let target = blendPoint(cpTarget, { ...getCenterlinePoint(lookahead) }, 0.35);
  const farTarget = blendPoint(cp1, { ...getCenterlinePoint(clamp(lookahead + 4, 5, 14)) }, 0.4);

  const lateralOffset = (self.x - cp0.x) * cp0.nx + (self.z - cp0.z) * cp0.nz;
  const laneCorrection = clamp(-lateralOffset * 0.75, -roadHalf * 0.45, roadHalf * 0.45);
  target = {
    x: target.x + cp0.nx * laneCorrection,
    z: target.z + cp0.nz * laneCorrection,
  };

  if (!self.item && !self.offRoad && curve < 0.28) {
    let bestBox = null;
    let bestScore = -Infinity;
    for (const box of itemBoxes) {
      const d = dist(self, box);
      if (d > 2 && d < 14) {
        const ang = Math.abs(wrapAngle(angleTo(self, box) - self.heading));
        const boxLane = Math.abs((box.x - cp0.x) * cp0.nx + (box.z - cp0.z) * cp0.nz);
        const score = -d - ang * 8 - boxLane;
        if (score > bestScore && ang < 0.5) {
          bestScore = score;
          bestBox = box;
        }
      }
    }
    if (bestBox) {
      target = blendPoint(target, bestBox, 0.18);
    }
  }

  for (const haz of hazards) {
    const d = dist(self, haz);
    if (d < 5.5) {
      const ang = wrapAngle(angleTo(self, haz) - self.heading);
      if (Math.abs(ang) < 0.55) {
        const side = ang > 0 ? -1 : 1;
        target = {
          x: target.x + cp0.nx * side * 0.9,
          z: target.z + cp0.nz * side * 0.9,
        };
      }
    }
  }

  const ahead = findNearestOpponentAhead();
  if (ahead && ahead.distance < 6 && !self.offRoad && curve < 0.35) {
    const ang = wrapAngle(angleTo(self, ahead) - self.heading);
    if (Math.abs(ang) < 0.4) {
      const side = ang > 0 ? -1 : 1;
      target = {
        x: target.x + cp0.nx * side * 0.55,
        z: target.z + cp0.nz * side * 0.55,
      };
    }
  }

  if (self.offRoad) {
    const recovery = blendPoint(p0, p1, 0.35);
    target = blendPoint(target, recovery, 0.82);
  }

  const checkpointAngle = angleTo(self, cpTarget);
  const targetAngle = angleTo(self, target);
  const err = wrapAngle(targetAngle - self.heading);
  const checkpointErr = wrapAngle(checkpointAngle - self.heading);
  const farErr = wrapAngle(angleTo(self, farTarget) - self.heading);
  const absErr = Math.abs(err);
  const startupMode = self.lap === 0 && self.progress < 1.25 && self.speed < 5;

  let steer = clamp(checkpointErr / 0.95 + err / 1.2 + farErr / 2.4, -1, 1);
  let throttle = 1;
  let brake = 0;

  const desiredSpeed = clamp(
    13.2 - curve * 7.5 - absErr * 2.2 - (self.offRoad ? 3.2 : 0),
    self.offRoad ? 4.8 : 6.8,
    13.2
  );

  if (self.speed > desiredSpeed + 1.1) {
    brake = clamp((self.speed - desiredSpeed) / 3.5, 0, 1);
    throttle = clamp(0.75 - brake * 0.8, 0, 1);
  } else if (self.speed > desiredSpeed) {
    throttle = 0.4;
  }

  if (absErr > 0.95 && !startupMode) {
    throttle = Math.min(throttle, 0.16);
    brake = Math.max(brake, 0.7);
  } else if (absErr > 0.6 && !startupMode) {
    throttle = Math.min(throttle, 0.5);
    brake = Math.max(brake, self.speed > 9 ? 0.32 : 0);
  }

  if (startupMode) {
    const launchErr = wrapAngle(checkpointAngle - self.heading);
    throttle = 1;
    brake = 0;
    steer = clamp(launchErr / 1.9, -0.18, 0.18);
  }

  if (self.offRoad) {
    throttle = Math.max(throttle, 0.72);
    brake = 0;
    steer = clamp(err / 0.8, -0.8, 0.8);
  }

  let useItem = false;
  if (self.item === "boost") {
    if (!self.offRoad && curve < 0.16 && absErr < 0.16 && self.speed > 7.5) {
      useItem = true;
    }
  } else if (self.item === "oil") {
    const closeBehind = opponents.some((o) => {
      if (o.progress >= self.progress) return false;
      const d = dist(self, o);
      const ang = Math.abs(wrapAngle(angleTo(o, self) - o.heading));
      return d < 5.5 && ang < 0.45;
    });
    if (closeBehind) {
      useItem = true;
    }
  } else if (self.item === "rocket") {
    if (ahead && ahead.distance < 20) {
      const shotErr = Math.abs(wrapAngle(angleTo(self, ahead) - self.heading));
      if (shotErr < 0.24) {
        useItem = true;
      }
    }
  }

  return { throttle, brake, steer, useItem };
}
