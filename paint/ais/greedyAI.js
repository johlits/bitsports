export const id = "greedy";
export const name = "Greedy Painter";

// AI that seeks out unpainted tiles and powerups
export function tick({ self, others, powerups, grid, gridWidth, gridHeight, tileSize, dt }) {
  const halfW = (gridWidth * tileSize) / 2;
  const halfH = (gridHeight * tileSize) / 2;

  // Priority 1: Go for nearby powerups
  if (powerups.length > 0) {
    let closestPowerup = null;
    let closestDist = Infinity;

    for (const p of powerups) {
      const dx = p.x - self.x;
      const dz = p.z - self.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < closestDist && dist < 5) {
        closestDist = dist;
        closestPowerup = p;
      }
    }

    if (closestPowerup) {
      const dx = closestPowerup.x - self.x;
      const dz = closestPowerup.z - self.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      return { x: dx / len, z: dz / len };
    }
  }

  // Priority 2: Find nearest unpainted tile
  let bestTarget = null;
  let bestDist = Infinity;

  // Convert world position to grid
  const selfGX = Math.floor((self.x + halfW) / tileSize);
  const selfGY = Math.floor((self.z + halfH) / tileSize);

  // Search in expanding squares
  for (let radius = 1; radius < Math.max(gridWidth, gridHeight); radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

        const gx = selfGX + dx;
        const gy = selfGY + dy;

        if (gx >= 0 && gx < gridWidth && gy >= 0 && gy < gridHeight) {
          if (grid[gx][gy] === 0) {
            // Convert back to world coords
            const worldX = gx * tileSize - halfW + tileSize / 2;
            const worldZ = gy * tileSize - halfH + tileSize / 2;
            const dist = Math.abs(dx) + Math.abs(dy);

            if (dist < bestDist) {
              bestDist = dist;
              bestTarget = { x: worldX, z: worldZ };
            }
          }
        }
      }
    }

    if (bestTarget) break;
  }

  if (bestTarget) {
    const dx = bestTarget.x - self.x;
    const dz = bestTarget.z - self.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  // Fallback: move randomly
  const angle = Math.random() * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle) };
}
