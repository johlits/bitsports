export const id = "human";
export const name = "Human (Keyboard)";

// Track keyboard state
const keys = { up: false, down: false, left: false, right: false };

let initialized = false;

function initInput() {
  if (initialized) return;
  initialized = true;

  window.addEventListener("keydown", (e) => {
    switch (e.key) {
      case "ArrowUp":
      case "w":
      case "W":
        keys.up = true;
        break;
      case "ArrowDown":
      case "s":
      case "S":
        keys.down = true;
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        keys.left = true;
        break;
      case "ArrowRight":
      case "d":
      case "D":
        keys.right = true;
        break;
    }
  });

  window.addEventListener("keyup", (e) => {
    switch (e.key) {
      case "ArrowUp":
      case "w":
      case "W":
        keys.up = false;
        break;
      case "ArrowDown":
      case "s":
      case "S":
        keys.down = false;
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        keys.left = false;
        break;
      case "ArrowRight":
      case "d":
      case "D":
        keys.right = false;
        break;
    }
  });

  window.addEventListener("blur", () => {
    keys.up = false;
    keys.down = false;
    keys.left = false;
    keys.right = false;
  });
}

export function tick({ self, dt }) {
  initInput();

  let dx = 0;
  let dz = 0;

  if (keys.up) dz -= 1;
  if (keys.down) dz += 1;
  if (keys.left) dx -= 1;
  if (keys.right) dx += 1;

  const len = Math.sqrt(dx * dx + dz * dz);
  if (len > 0) {
    return { x: dx / len, z: dz / len };
  }

  return { x: 0, z: 0 };
}
