export const id = "chaos-monkey";
export const name = "Chaos Monkey";

const stateById = new Map();

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function getState(id) {
  if (!stateById.has(id)) {
    stateById.set(id, { wobble: Math.random() * Math.PI * 2, timer: 0 });
  }
  return stateById.get(id);
}

export function tick({ self, dt, getNextCheckpoint, getCenterlinePoint, findNearestOpponentAhead }) {
  const st = getState(self.id);
  st.timer += dt;
  st.wobble += dt * 1.7;

  const cp = getNextCheckpoint(0);
  const look = getCenterlinePoint(4) ?? cp;
  const target = st.timer % 4 < 1.3
    ? { x: cp.x + Math.cos(st.wobble) * 0.8, z: cp.z + Math.sin(st.wobble) * 0.8 }
    : look;

  const err = wrapAngle(Math.atan2(target.z - self.z, target.x - self.x) - self.heading);
  const absErr = Math.abs(err);

  const throttle = absErr > 1.0 ? 0.25 : 1;
  const brake = absErr > 0.85 ? 0.55 : 0;
  const steer = clamp(err / 0.6 + Math.sin(st.wobble * 2.3) * 0.18, -1, 1);

  const ahead = findNearestOpponentAhead();
  const useItem = !!self.item && (
    self.item === "boost"
      ? absErr < 0.28
      : self.item === "rocket"
        ? !!ahead
        : st.timer % 2.5 < 0.08
  );

  return { throttle, brake, steer, useItem };
}
