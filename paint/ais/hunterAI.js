export const id = "hunter";
export const name = "Hunter";

// AI that follows and paints over other players' tiles
export function tick({ self, others, powerups, grid, gridWidth, gridHeight, tileSize, dt }) {
  const halfW = (gridWidth * tileSize) / 2;
  const halfH = (gridHeight * tileSize) / 2;

  // Priority 1: Grab nearby powerups (especially bombs)
  if (powerups.length > 0) {
    let bestPowerup = null;
    let bestScore = Infinity;

    for (const p of powerups) {
      const dx = p.x - self.x;
      const dz = p.z - self.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Prioritize bombs
      let score = dist;
      if (p.type === "bomb") score *= 0.5;
      if (p.type === "speed") score *= 0.7;

      if (score < bestScore && dist < 6) {
        bestScore = score;
        bestPowerup = p;
      }
    }

    if (bestPowerup) {
      const dx = bestPowerup.x - self.x;
      const dz = bestPowerup.z - self.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      return { x: dx / len, z: dz / len };
    }
  }

  // Priority 2: Find the leading player and paint over their tiles
  if (others.length > 0) {
    // Find player with most tiles
    let leader = others[0];
    for (const other of others) {
      if (other.score > leader.score) {
        leader = other;
      }
    }

    // Find nearest tile owned by leader
    const selfGX = Math.floor((self.x + halfW) / tileSize);
    const selfGY = Math.floor((self.z + halfH) / tileSize);

    let bestTarget = null;
    let bestDist = Infinity;

    // Search for leader's tiles
    for (let radius = 1; radius < Math.max(gridWidth, gridHeight); radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

          const gx = selfGX + dx;
          const gy = selfGY + dy;

          if (gx >= 0 && gx < gridWidth && gy >= 0 && gy < gridHeight) {
            // Check if this tile belongs to the leader
            if (grid[gx][gy] === leader.id) {
              const dist = Math.abs(dx) + Math.abs(dy);
              if (dist < bestDist) {
                bestDist = dist;
                const worldX = gx * tileSize - halfW + tileSize / 2;
                const worldZ = gy * tileSize - halfH + tileSize / 2;
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

    // If no leader tiles found, chase the leader directly
    const dx = leader.x - self.x;
    const dz = leader.z - self.z;
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    return { x: dx / len, z: dz / len };
  }

  // Fallback: paint unpainted tiles
  const selfGX = Math.floor((self.x + halfW) / tileSize);
  const selfGY = Math.floor((self.z + halfH) / tileSize);

  for (let radius = 1; radius < 10; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        const gx = selfGX + dx;
        const gy = selfGY + dy;

        if (gx >= 0 && gx < gridWidth && gy >= 0 && gy < gridHeight) {
          if (grid[gx][gy] === 0) {
            const worldX = gx * tileSize - halfW + tileSize / 2;
            const worldZ = gy * tileSize - halfH + tileSize / 2;
            const ddx = worldX - self.x;
            const ddz = worldZ - self.z;
            const len = Math.sqrt(ddx * ddx + ddz * ddz) || 1;
            return { x: ddx / len, z: ddz / len };
          }
        }
      }
    }
  }

  return { x: 0, z: 0 };
}
