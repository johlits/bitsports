export const id = "territory";
export const name = "Territory Builder";

// AI that tries to claim and defend a contiguous territory
let homeBase = null;
let expansionDirection = 0;

export function tick({ self, others, powerups, grid, gridWidth, gridHeight, tileSize, dt }) {
  const halfW = (gridWidth * tileSize) / 2;
  const halfH = (gridHeight * tileSize) / 2;

  const selfGX = Math.floor((self.x + halfW) / tileSize);
  const selfGY = Math.floor((self.z + halfH) / tileSize);

  // Establish home base on first tick
  if (!homeBase) {
    homeBase = { x: self.x, z: self.z };
    // Pick a random expansion direction
    expansionDirection = Math.random() * Math.PI * 2;
  }

  // Priority 1: Grab nearby powerups (especially shields)
  if (powerups.length > 0) {
    let bestPowerup = null;
    let bestScore = Infinity;

    for (const p of powerups) {
      const dx = p.x - self.x;
      const dz = p.z - self.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      let score = dist;
      if (p.type === "shield") score *= 0.5;
      if (p.type === "bomb") score *= 0.6;

      if (score < bestScore && dist < 4) {
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

  // Priority 2: Expand territory in a spiral pattern
  // Find the edge of our territory and expand outward

  // Count our tiles and find boundary
  let myTileCount = 0;
  let boundaryTiles = [];

  for (let gx = 0; gx < gridWidth; gx++) {
    for (let gy = 0; gy < gridHeight; gy++) {
      if (grid[gx][gy] === self.id) {
        myTileCount++;

        // Check if this is a boundary tile (adjacent to non-owned tile)
        const neighbors = [
          [gx - 1, gy],
          [gx + 1, gy],
          [gx, gy - 1],
          [gx, gy + 1],
        ];

        for (const [nx, ny] of neighbors) {
          if (nx >= 0 && nx < gridWidth && ny >= 0 && ny < gridHeight) {
            if (grid[nx][ny] !== self.id) {
              const worldX = nx * tileSize - halfW + tileSize / 2;
              const worldZ = ny * tileSize - halfH + tileSize / 2;
              boundaryTiles.push({ x: worldX, z: worldZ, gx: nx, gy: ny });
              break;
            }
          }
        }
      }
    }
  }

  // If we have boundary tiles, expand to the nearest one in our expansion direction
  if (boundaryTiles.length > 0) {
    let bestTarget = null;
    let bestScore = Infinity;

    for (const tile of boundaryTiles) {
      const dx = tile.x - self.x;
      const dz = tile.z - self.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Prefer tiles in our expansion direction
      const angle = Math.atan2(dz, dx);
      const angleDiff = Math.abs(angle - expansionDirection);
      const normalizedAngleDiff = Math.min(angleDiff, Math.PI * 2 - angleDiff);

      // Score combines distance and direction preference
      const score = dist + normalizedAngleDiff * 2;

      if (score < bestScore) {
        bestScore = score;
        bestTarget = tile;
      }
    }

    if (bestTarget) {
      const dx = bestTarget.x - self.x;
      const dz = bestTarget.z - self.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;

      // Slowly rotate expansion direction
      expansionDirection += dt * 0.3;

      return { x: dx / len, z: dz / len };
    }
  }

  // Priority 3: Find nearest unpainted tile
  let bestTarget = null;
  let bestDist = Infinity;

  for (let radius = 1; radius < Math.max(gridWidth, gridHeight); radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

        const gx = selfGX + dx;
        const gy = selfGY + dy;

        if (gx >= 0 && gx < gridWidth && gy >= 0 && gy < gridHeight) {
          if (grid[gx][gy] === 0) {
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

  // Fallback: move in expansion direction
  return {
    x: Math.cos(expansionDirection),
    z: Math.sin(expansionDirection),
  };
}
