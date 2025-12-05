# Bitsports - Air Hockey Game Rules & Specifications

This document contains all the rules and technical specifications needed to create an AI for Bitsports.

## Game Overview

Bitsports is a 2D air hockey game rendered in 3D. Two players (Blue and Red) control paddles to hit pucks into the opponent's goal.

## Coordinate System

- **X-axis**: Left (-) to Right (+)
- **Z-axis**: Blue's side (+) to Red's side (-)
- **Origin (0, 0)**: Center of the table

## Table Dimensions

| Property | Value | Notes |
|----------|-------|-------|
| Table Width | 10 units | X: -5 to +5 |
| Table Height | 20 units | Z: -10 to +10 |
| Corner Radius | 1.0 unit | Rounded corners |

## Goals

| Property | Value | Notes |
|----------|-------|-------|
| Goal Width | 4.0 units | Centered at X=0 |
| Blue Goal Position | Z = +10 | Bottom of table |
| Red Goal Position | Z = -10 | Top of table |

Scoring: When a puck crosses the goal line within the goal width, the opposing player scores.

## Goal Crease (No-Go Zone)

| Property | Value |
|----------|-------|
| Crease Radius | 2.5 units |
| Shape | Half-circle in front of each goal |

Paddles are automatically pushed out if they enter the crease zone. This prevents goalkeeping directly in front of the goal.

## Paddles

| Property | Value |
|----------|-------|
| Paddle Radius | 0.35 units |
| Max Speed | 6 units/second |

### Movement Restrictions

- **Blue paddle**: Can only move in Z range [0, +9.65] (own half + to wall minus paddle radius)
- **Red paddle**: Can only move in Z range [-9.65, 0] (own half)
- **Both paddles**: X range [-4.65, +4.65] (wall minus paddle radius)
- Paddles cannot enter the rounded corners or goal creases

## Pucks

| Property | Value |
|----------|-------|
| Puck Radius | 0.25 units |
| Initial Speed | 3 units/second |
| Friction | 0.997 (multiplied per frame) |
| Minimum Speed | 0.5 units/second |
| Max Pucks | 10 |
| Spawn Interval | 15 seconds |

**Important**: Pucks never fully stop. When friction would slow a puck below the minimum speed (0.5 units/second), the puck is boosted back to minimum speed while maintaining its direction. If a puck ever reaches exactly zero velocity, it receives a random direction at minimum speed.

### Puck Spawning

- First puck spawns at center (0, 0) when game starts
- Additional pucks spawn every 15 seconds at center
- New pucks launch in a random direction within ±30° of the target half
- After a goal, a new puck spawns toward the scoring player

## Collision Physics

### Wall Collisions
- Pucks bounce off walls with velocity reflection
- Rounded corners reflect based on the surface normal at the contact point

### Paddle-Puck Collisions
- Collision occurs when distance between centers < paddle radius + puck radius
- Puck velocity is reflected off the paddle surface
- Paddle velocity influences puck speed (faster paddle hits = faster puck)
- Minimum puck speed after hit: 0.5 units/second
- Maximum puck speed after hit: 15 units/second

### Puck-Puck Collisions
- Elastic collision when pucks touch (distance < 2 × puck radius)
- Equal mass assumed, so velocities are exchanged along collision normal
- Newly spawned pucks briefly ignore puck-puck collisions until clear of overlap

## AI Interface

Your AI must export:

```javascript
export const id = "your-ai-id";
export const name = "Your AI Name";

export function tick({ pucks, self, opponent, dt }) {
  // Return movement direction
  return { x: 0, z: 0 };
}
```

### Input Parameters

```javascript
{
  pucks: [
    {
      x: number,      // Puck X position
      y: number,      // Puck Z position (note: named 'y' but represents Z)
      velocity: {
        x: number,    // Puck X velocity
        y: number     // Puck Z velocity
      }
    },
    // ... more pucks
  ],
  self: {
    x: number,        // Your paddle X position
    y: number         // Your paddle Z position
  },
  opponent: {
    x: number,        // Opponent paddle X position
    y: number         // Opponent paddle Z position
  },
  dt: number          // Delta time in seconds since last frame
}
```

### Output

Return a normalized direction vector:

```javascript
{
  x: number,  // -1 to 1, left/right movement
  z: number   // -1 to 1, forward/backward movement
}
```

The engine will:
1. Normalize your direction vector
2. Multiply by `maxPaddleSpeed * dt`
3. Apply the movement
4. Clamp to valid boundaries

### Tips for AI Development

1. **Predict puck trajectory**: Use velocity to predict where pucks will be
2. **Prioritize threats**: Focus on pucks moving toward your goal
3. **Stay centered**: Good defensive position is near center of your half
4. **Use paddle velocity**: Moving into the puck adds power to your shots
5. **Watch multiple pucks**: As the game progresses, more pucks spawn
6. **Respect boundaries**: Don't waste movement trying to go out of bounds

## Game Flow

1. Game starts with one puck at center
2. Every 15 seconds, a new puck spawns (up to 10 max)
3. When a goal is scored:
   - The scoring puck is removed
   - If no pucks remain, a new one spawns toward the scorer
4. Game continues indefinitely (no win condition)

## File Structure

Place your AI in `ais/yourAI.js` and register it in `ais/registry.js`:

```javascript
import * as yourAI from "./yourAI.js";

export const allAIs = [
  // ... other AIs
  yourAI,
];
```
