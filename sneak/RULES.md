# Bitsports - Sneak (Rules & AI Interface)

Sneak is a top-down stealth game with two teams competing on a grid-based map.

## Teams

- **Guards** (blue) - Defenders who patrol and catch infiltrators
- **Infiltrators** (red) - Attackers who steal gold and return it to base

## Objective

- **Infiltrators** win by scoring more points than guards
- **Guards** win by catching infiltrators and preventing gold theft

## Map

- **Grid size**: 48 x 32 tiles (24 x 16 world units)
- **Tile size**: 0.5 world units
- **Coordinate system**: Center is (0, 0). X increases to the right, Z increases downward.
- **Guard base**: Located at x = -10, z = 0 (left side)
- **Infiltrator base**: Located at x = 10, z = 0 (right side)
- **Walls**: Block movement and line-of-sight

## Scoring

| Event | Points |
|-------|--------|
| Infiltrator deposits gold at their base | **Infiltrators +1** |
| Guard catches an infiltrator | **Guards +1** |

## Catching Mechanics

A guard catches an infiltrator when ALL conditions are met:

1. The infiltrator is **visible** to the guard team (within vision range, FOV, and line-of-sight)
2. A guard is within **1.8 world units** of the infiltrator
3. At least **1.5 seconds** have passed since the last catch (cooldown)

When caught:
- The infiltrator is **teleported back to spawn**
- If carrying gold, the gold is **dropped at the catch location**
- Guards score +1 point

## Vision System

Each team has different vision capabilities:

| Team | Vision Range | Field of View |
|------|--------------|---------------|
| Guards | 3.5 units | 80° |
| Infiltrators | 4.5 units | 120° |

Vision requires:
- Target within range
- Target within FOV cone (based on agent's heading direction)
- Clear line-of-sight (walls block vision)

**Team vision is shared** - if any teammate sees something, all teammates know about it.

## Gold

- **Pickup radius**: 0.28 units (infiltrator must be this close to pick up)
- **Spawn**: Gold spawns at random locations across the map
- **Carrying**: Only infiltrators can carry gold. One gold per infiltrator.
- **Depositing**: Infiltrator must reach their base (within 0.55 units) while carrying gold
- **Respawn**: After deposit, gold respawns at a new random location
- **Dropped gold**: If an infiltrator is caught while carrying gold, it drops at their location

## Spawn Protection

- Guards **cannot enter** a 2.5 unit radius around the infiltrator base
- This prevents spawn camping

## Movement

- **Max speed**: 3.2 units/second
- **Agent radius**: 0.18 units (for collision)
- Movement is continuous (not grid-locked)
- Walls block movement with collision detection

## Match Settings

- **Default match time**: 120 seconds
- **Default gold count**: 5
- **Default team size**: 2 guards vs 2 infiltrators

---

# AI Interface

## Module Structure

Each AI must be a JavaScript ES module exporting:

```js
export const id = "unique-ai-id";
export const name = "Display Name";

export function tick(state) {
  // Return movement direction
  return { x: 0, z: 0 };
}
```

## tick(state) - Input

The `state` object contains:

### Timing
- `dt` - Delta time in seconds since last tick (~0.016 at 60fps)
- `timeRemaining` - Seconds remaining in match

### Scores
- `scores.guards` - Current guard score
- `scores.infiltrators` - Current infiltrator score

### Map Information
- `map.gridWidth` - Grid width in tiles (48)
- `map.gridHeight` - Grid height in tiles (32)
- `map.tileSize` - Size of each tile in world units (0.5)
- `map.walls` - 2D boolean array `walls[x][y]` where true = wall
- `map.bases` - Object with guard and infiltrator base positions

### Self Information
- `self.id` - Agent's unique ID (e.g., "g1", "i2")
- `self.team` - "guards" or "infiltrators"
- `self.role` - "guard" or "infiltrator"
- `self.x` - Current X position in world coordinates
- `self.z` - Current Z position in world coordinates
- `self.heading` - `{ x, z }` normalized direction agent is facing
- `self.carryingGoldId` - ID of carried gold, or null

### Teammates
- `teammates` - Array of teammate info:
  - `id`, `x`, `z`, `heading`, `carryingGoldId`

### Vision (Shared Team Vision)
- `visibleEnemies` - Array of visible enemies:
  - `{ id, team, x, z, carryingGold }`
- `visibleGold` - Array of visible gold:
  - `{ id, x, z }`
- `teamVision.visibleCells` - Set of visible grid cells as "x,y" strings

### Base Locations
- `myBase` - `{ x, z }` of your team's base
- `enemyBase` - `{ x, z }` of enemy team's base

### Pathfinding Helpers
- `findPath(goalX, goalZ)` - Returns array of waypoints `[{x, z}, ...]` or null
- `getDirectionToward(goalX, goalZ)` - Returns `{ x, z }` direction to move, or null if no path

## tick(state) - Output

Return a movement direction vector:

```js
{ x: number, z: number }
```

- The engine **normalizes** this vector and applies speed
- Return `{ x: 0, z: 0 }` to stand still
- Return `null` or `undefined` to stand still

## Example AI

```js
export const id = "simple-guard";
export const name = "Simple Guard";

export function tick({ self, visibleEnemies, visibleGold, getDirectionToward, myBase }) {
  // Chase visible enemies
  if (visibleEnemies.length > 0) {
    const target = visibleEnemies[0];
    return getDirectionToward(target.x, target.z);
  }
  
  // Patrol around base
  const patrolX = myBase.x + Math.cos(Date.now() / 1000) * 3;
  const patrolZ = myBase.z + Math.sin(Date.now() / 1000) * 3;
  return getDirectionToward(patrolX, patrolZ);
}
```

```js
export const id = "simple-infiltrator";
export const name = "Simple Infiltrator";

export function tick({ self, visibleGold, visibleEnemies, getDirectionToward, myBase }) {
  // If carrying gold, go home
  if (self.carryingGoldId) {
    return getDirectionToward(myBase.x, myBase.z);
  }
  
  // Avoid nearby enemies
  if (visibleEnemies.length > 0) {
    const enemy = visibleEnemies[0];
    const dist = Math.hypot(enemy.x - self.x, enemy.z - self.z);
    if (dist < 3) {
      // Run away
      const dx = self.x - enemy.x;
      const dz = self.z - enemy.z;
      return { x: dx, z: dz };
    }
  }
  
  // Go for visible gold
  if (visibleGold.length > 0) {
    const gold = visibleGold[0];
    return getDirectionToward(gold.x, gold.z);
  }
  
  // Explore toward center
  return getDirectionToward(0, 0);
}
```

## Tips for AI Development

### For Guards
- Use `getDirectionToward()` for pathfinding around walls
- Prioritize chasing infiltrators carrying gold (`enemy.carryingGold`)
- Coordinate with teammates to cover different areas
- Remember you have shorter vision range but enemies are visible to all teammates

### For Infiltrators
- Use your wider FOV to spot guards early
- Avoid guards - you can see them before they see you
- When carrying gold, take safe routes back to base
- Gold respawns randomly, so explore the map
- The spawn protection zone is your safe haven

### General
- The `getDirectionToward()` helper handles pathfinding - use it!
- Store per-agent state using a Map keyed by `self.id`
- Check `self.carryingGoldId` to know if you're carrying gold
- Use `visibleEnemies` and `visibleGold` which are pre-filtered by team vision
