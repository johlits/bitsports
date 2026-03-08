# Bitsports - Kart Racing (Rules & AI Interface)

Kart Racing is a top-down arcade racing game for competing AI drivers.

## Objective

- Complete the configured number of laps before the other karts
- If time expires, the winner is the kart with the greatest race progress
- Progress is determined by:
  - completed laps
  - checkpoints reached in the current lap
  - distance toward the next checkpoint

## Track

- The race is run on a closed top-down circuit
- Drivers must pass checkpoints in order
- Crossing the finish line only counts if the previous checkpoint sequence was completed
- Leaving the road slows the kart heavily

## Karts

Each kart has:

- position `(x, z)`
- heading angle in radians
- forward speed
- lateral slip
- held item slot

Karts use arcade-style physics:

- steering rotates the heading faster at moderate speed than at standstill
- throttle accelerates forward
- brake reduces speed and helps tighter cornering
- friction and traction reduce drift over time
- karts can bump each other physically

## Items

Item boxes spawn around the track. Picking one up grants one random item if the kart is not already holding one.

Current items:

- **boost**
  - large forward acceleration burst for a short duration
- **oil**
  - drops a slick behind the kart
  - karts touching the slick lose traction briefly
- **rocket**
  - fires a simple homing projectile toward the nearest opponent ahead in race order
  - on hit, the target is slowed briefly

## Match Settings

- Default drivers: 4
- Default laps: 9
- Default time limit: 150 seconds

---

# AI Interface

## Module Structure

Each AI is an ES module exporting:

```js
export const id = "unique-ai-id";
export const name = "Display Name";

export function tick(state) {
  return {
    throttle: 1,
    brake: 0,
    steer: 0,
    useItem: false,
  };
}
```

## `tick(state)` input

### Timing

- `dt` - delta time in seconds
- `timeRemaining` - match time left in seconds

### Self

- `self.id`
- `self.x`
- `self.z`
- `self.heading`
- `self.speed`
- `self.lap`
- `self.maxLaps`
- `self.checkpointIndex`
- `self.progress`
- `self.place`
- `self.item` - `null | "boost" | "oil" | "rocket"`
- `self.offRoad` - boolean
- `self.effects` - effect timers

### Opponents

- `opponents` - array of:
  - `id`, `x`, `z`, `heading`, `speed`, `lap`, `checkpointIndex`, `progress`, `place`, `item`

### Track

- `track.centerline` - ordered points `{x, z}` around the loop
- `track.checkpoints` - ordered checkpoint objects with `x`, `z`, `nx`, `nz`, `halfWidth`
- `track.roadWidth`
- `track.finishLine`

### Items / hazards

- `itemBoxes` - available item boxes with `x`, `z`, `respawn`
- `hazards` - visible hazard list with `type`, `x`, `z`
- `projectiles` - active projectiles with `x`, `z`, `vx`, `vz`, `ownerId`

### Helpers

- `getNextCheckpoint(countAhead = 0)`
- `getCenterlinePoint(offset)`
- `distanceToNextCheckpoint()`
- `findNearestOpponentAhead()`

## `tick(state)` output

Return an object:

```js
{
  throttle?: number, // 0..1
  brake?: number,    // 0..1
  steer?: number,    // -1..1
  useItem?: boolean,
}
```

The engine clamps values automatically.

## Strategy tips

- Brake before sharp turns
- Use boost on straights, not in corners
- Drop oil when someone is behind you
- Save rockets for opponents ahead of you
