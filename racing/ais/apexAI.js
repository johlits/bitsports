export const id = "apex";
export const name = "Apex Hunter";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function tick({ self, opponents, getNextCheckpoint, getCenterlinePoint, distanceToNextCheckpoint, findNearestOpponentAhead }) {
  const cp = getNextCheckpoint(0);
  const look = getCenterlinePoint(6) ?? cp;
  const target = distanceToNextCheckpoint() < 3.5 ? look : cp;
  const dx = target.x - self.x;
  const dz = target.z - self.z;
  const targetAngle = Math.atan2(dz, dx);
  const err = wrapAngle(targetAngle - self.heading);

  const absErr = Math.abs(err);
  const steer = clamp(err / 0.7, -1, 1);
  let throttle = 1;
  let brake = 0;

  if (absErr > 0.9) {
    throttle = 0.3;
    brake = 0.7;
  } else if (absErr > 0.45) {
    throttle = 0.6;
    brake = self.speed > 10 ? 0.25 : 0;
  } else if (self.offRoad) {
    throttle = 0.75;
  }

  const ahead = findNearestOpponentAhead();
  const useItem = (
    (self.item === "boost" && absErr < 0.18 && self.speed < 13) ||
    (self.item === "rocket" && ahead && ahead.distance < 10) ||
    (self.item === "oil" && opponents.some((o) => o.progress < self.progress && Math.hypot(o.x - self.x, o.z - self.z) < 4.5))
  );

  return { throttle, brake, steer, useItem };
}
