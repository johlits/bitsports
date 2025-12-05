export const id = "random";
export const name = "Random Walker";

let currentDirection = { x: 0, z: 0 };
let changeTimer = 0;

export function tick({ self, dt }) {
  changeTimer -= dt;

  // Change direction every 0.5-1.5 seconds
  if (changeTimer <= 0) {
    const angle = Math.random() * Math.PI * 2;
    currentDirection = {
      x: Math.cos(angle),
      z: Math.sin(angle),
    };
    changeTimer = 0.5 + Math.random();
  }

  return currentDirection;
}
