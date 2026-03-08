export const id = "smooth-operator";
export const name = "Smooth Operator";

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function tick({ self, getNextCheckpoint, getCenterlinePoint, distanceToNextCheckpoint, opponents, findNearestOpponentAhead }) {
  const near = getNextCheckpoint(0);
  const far = getCenterlinePoint(10) ?? near;
  const blend = distanceToNextCheckpoint() < 5 ? 0.65 : 0.35;
  const target = {
    x: near.x * (1 - blend) + far.x * blend,
    z: near.z * (1 - blend) + far.z * blend,
  };

  const dx = target.x - self.x;
  const dz = target.z - self.z;
  const err = wrapAngle(Math.atan2(dz, dx) - self.heading);
  const absErr = Math.abs(err);

  let throttle = absErr > 0.75 ? 0.45 : absErr > 0.38 ? 0.75 : 1;
  let brake = absErr > 1.05 ? 0.8 : absErr > 0.75 && self.speed > 9 ? 0.35 : 0;
  const steer = clamp(err / 0.9, -0.9, 0.9);

  if (self.offRoad) {
    throttle = 0.6;
    brake = 0.1;
  }

  const ahead = findNearestOpponentAhead();
  const closeBehind = opponents.some((o) => o.progress < self.progress && Math.hypot(o.x - self.x, o.z - self.z) < 3.2);
  const useItem = (
    (self.item === "boost" && absErr < 0.12 && self.speed < 12.5) ||
    (self.item === "oil" && closeBehind) ||
    (self.item === "rocket" && ahead && ahead.distance < 8)
  );

  return { throttle, brake, steer, useItem };
}
