# Bitsports - Paint Battle Game Rules & Specifications

This document contains all the rules and technical specifications needed to create an AI for Paint Battle.

## Game Overview

Paint Battle is a top-down tile painting game. Multiple players (2-8) compete to paint the most tiles on a grid within a time limit. Players move continuously and paint tiles by moving over them.

## Coordinate System

- **X-axis**: Left (-) to Right (+)
- **Z-axis**: Top (-) to Bottom (+)
- **Origin (0, 0)**: Center of the grid
- **Grid coordinates**: (gx, gy) where gx is column, gy is row (0-indexed)

## Grid Dimensions

| Property | Value | Notes |
|----------|-------|-------|
| Grid Width | 40 tiles | gx: 0 to 39 |
| Grid Height | 40 tiles | gy: 0 to 39 |
| Tile Size | 0.5 world units | Total world size: 20 × 20 units |
| World X Range | -10 to +10 | |
| World Z Range | -10 to +10 | |

### Coordinate Conversion

```javascript
// World to Grid
gx = Math.floor((worldX + 10) / 0.5)
gy = Math.floor((worldZ + 10) / 0.5)

// Grid to World (tile center)
worldX = gx * 0.5 - 10 + 0.25
worldZ = gy * 0.5 - 10 + 0.25
```

## Players

| Property | Value |
|----------|-------|
| Player Radius | 0.3 world units |
| Max Speed | 8 units/second |
| Player Count | 2-8 players |

### Player Colors (in order)

1. Blue (`#38bdf8`)
2. Red (`#f97373`)
3. Green (`#4ade80`)
4. Yellow (`#fbbf24`)
5. Purple (`#a78bfa`)
6. Pink (`#fb7185`)
7. Teal (`#2dd4bf`)
8. Orange (`#fb923c`)

### Spawn Positions

Players spawn at predefined positions around the grid edges:
1. Bottom-left corner
2. Top-right corner
3. Bottom-right corner
4. Top-left corner
5. Bottom center
6. Top center
7. Left center
8. Right center

## Painting Mechanics

- Moving over a tile paints it with your color
- You can paint over any tile, including opponents' tiles
- Each tile stores only the most recent painter (player ID)
- Painting is O(1) - happens instantly when you move over a tile
- Unpainted tiles have ID = 0

## Timer & Win Condition

| Property | Default Value |
|----------|---------------|
| Match Duration | 60 seconds |
| Configurable Range | 10-300 seconds |

**Win Condition**: When time expires, the player with the most painted tiles wins.

## Powerups

Powerups spawn randomly on unpainted tiles every 5 seconds (max 5 on field).

### Powerup Types

| Type | Visual | Color | Effect | Duration |
|------|--------|-------|--------|----------|
| Speed Boost | Cone | Yellow (`#fbbf24`) | 1.5× movement speed | 3 seconds |
| Paint Bomb | Sphere | Red (`#ef4444`) | Instantly paints 3×3 area around player | Instant |
| Shield | Cube | Blue (`#38bdf8`) | Your tiles cannot be painted over | 5 seconds |

### Powerup Collection

- Collect by moving within 0.2 + playerRadius units of powerup center
- Powerups are single-use
- Multiple powerups can be active simultaneously

## Collisions

- Players do **not** block each other
- Players can pass through each other freely
- Players are clamped to grid boundaries (cannot leave the play area)

## AI Interface

Your AI must export:

```javascript
export const id = "your-ai-id";
export const name = "Your AI Name";

export function tick(state) {
  // Return movement direction
  return { x: 0, z: 0 };
}
```

### Input Parameters

```javascript
{
  self: {
    x: number,           // Your world X position
    z: number,           // Your world Z position
    gridX: number,       // Your grid X coordinate (0-39)
    gridY: number,       // Your grid Y coordinate (0-39)
    score: number,       // Your current tile count
    powerups: {
      speedBoost: number,  // Seconds remaining (0 if inactive)
      shield: number       // Seconds remaining (0 if inactive)
    }
  },
  others: [
    {
      x: number,         // Opponent world X position
      z: number,         // Opponent world Z position
      id: number,        // Opponent player ID (1-8)
      color: number,     // Opponent color (hex)
      score: number      // Opponent tile count
    },
    // ... more opponents
  ],
  powerups: [
    {
      x: number,         // Powerup world X position
      z: number,         // Powerup world Z position
      type: string       // "speed", "bomb", or "shield"
    },
    // ... more powerups
  ],
  grid: number[][],      // grid[x][y] = player ID (0 = unpainted)
  gridWidth: 40,
  gridHeight: 40,
  tileSize: 0.5,
  timeRemaining: number, // Seconds left in match
  dt: number             // Delta time in seconds since last frame
}
```

### Output

Return a direction vector:

```javascript
{
  x: number,  // -1 to 1, left/right movement
  z: number   // -1 to 1, up/down movement
}
```

The engine will:
1. Normalize your direction vector
2. Apply speed boost multiplier if active (1.5×)
3. Multiply by `maxPlayerSpeed * dt`
4. Apply the movement
5. Clamp to grid boundaries

### Grid Access Examples

```javascript
// Check if a tile is unpainted
if (state.grid[gx][gy] === 0) { /* unpainted */ }

// Check if a tile belongs to you
if (state.grid[gx][gy] === myPlayerId) { /* your tile */ }

// Count unpainted tiles in a region
let count = 0;
for (let x = startX; x < endX; x++) {
  for (let y = startY; y < endY; y++) {
    if (state.grid[x][y] === 0) count++;
  }
}
```

## Strategy Tips

1. **Claim territory early**: Paint unpainted tiles first - they're free points
2. **Prioritize powerups**: Speed boosts help cover more ground, bombs give instant 9 tiles
3. **Target the leader**: If behind, paint over the leading player's tiles
4. **Defend with shields**: Use shields when you have a large territory to protect
5. **Efficient pathing**: Move in patterns that minimize backtracking
6. **Watch the clock**: Adjust strategy based on time remaining
7. **Predict opponents**: Track where others are heading to avoid wasted effort

## Game Flow

1. All players spawn at their designated positions
2. Timer starts counting down
3. Players move and paint tiles continuously
4. Powerups spawn every 5 seconds
5. When timer reaches 0:
   - Game ends
   - Final scores are calculated
   - Winner is announced

## File Structure

Place your AI in `ais/yourAI.js` and register it in `ais/registry.js`:

```javascript
import * as yourAI from "./yourAI.js";

export const allAIs = [
  // ... other AIs
  yourAI,
];
```

## Example AI

```javascript
export const id = "example";
export const name = "Example AI";

export function tick({ self, others, powerups, grid, gridWidth, gridHeight, tileSize, dt }) {
  const halfW = (gridWidth * tileSize) / 2;
  const halfH = (gridHeight * tileSize) / 2;

  // Priority 1: Go for nearby powerups
  for (const p of powerups) {
    const dx = p.x - self.x;
    const dz = p.z - self.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 3) {
      return { x: dx / dist, z: dz / dist };
    }
  }

  // Priority 2: Find nearest unpainted tile
  const selfGX = Math.floor((self.x + halfW) / tileSize);
  const selfGY = Math.floor((self.z + halfH) / tileSize);

  for (let radius = 1; radius < 20; radius++) {
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
```
