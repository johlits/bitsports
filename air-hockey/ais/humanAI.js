export const id = "human";
export const name = "Human (Mouse)";

// Track mouse position in world coordinates
const mouse = { x: 0, z: 0, active: false };

let initialized = false;

function initInput() {
  if (initialized) return;
  initialized = true;

  // Get canvas and compute world coordinates from mouse position
  const updateMouseWorld = (clientX, clientY) => {
    const canvas = document.querySelector("#canvas-container canvas");
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    
    // Normalize to -1 to 1
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

    // Approximate world coords based on camera setup (top-down at y=25, looking at origin)
    // Table is 10 wide (x: -5 to 5) and 20 tall (z: -10 to 10)
    // Camera FOV is 45deg, so visible area depends on height
    const visibleHeight = 25 * Math.tan((45 / 2) * Math.PI / 180) * 2;
    const aspect = rect.width / rect.height;
    const visibleWidth = visibleHeight * aspect;

    mouse.x = ndcX * (visibleWidth / 2);
    mouse.z = -ndcY * (visibleHeight / 2); // Flip Y to Z
    mouse.active = true;
  };

  window.addEventListener("mousemove", (e) => {
    updateMouseWorld(e.clientX, e.clientY);
  });

  window.addEventListener("touchmove", (e) => {
    if (e.touches.length > 0) {
      updateMouseWorld(e.touches[0].clientX, e.touches[0].clientY);
      e.preventDefault();
    }
  }, { passive: false });

  window.addEventListener("touchstart", (e) => {
    if (e.touches.length > 0) {
      updateMouseWorld(e.touches[0].clientX, e.touches[0].clientY);
    }
  });

  window.addEventListener("blur", () => {
    mouse.active = false;
  });
}

export function tick({ pucks, self, opponent, dt }) {
  initInput();

  if (!mouse.active) {
    return { x: 0, z: 0 };
  }

  // Move towards mouse position
  const dx = mouse.x - self.x;
  const dz = mouse.z - self.y; // self.y is actually Z in world coords

  const len = Math.hypot(dx, dz);
  if (len < 0.1) {
    return { x: 0, z: 0 };
  }

  return { x: dx / len, z: dz / len };
}
