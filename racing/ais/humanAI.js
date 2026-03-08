export const id = "human";
export const name = "Human (Keyboard)";

const keys = {
  up: false,
  down: false,
  left: false,
  right: false,
  space: false,
};

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
      case " ":
        keys.space = true;
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
      case " ":
        keys.space = false;
        break;
    }
  });

  window.addEventListener("blur", () => {
    keys.up = false;
    keys.down = false;
    keys.left = false;
    keys.right = false;
    keys.space = false;
  });
}

export function tick() {
  initInput();
  return {
    throttle: keys.up ? 1 : 0,
    brake: keys.down ? 1 : 0,
    steer: (keys.left ? -1 : 0) + (keys.right ? 1 : 0),
    useItem: keys.space,
  };
}
