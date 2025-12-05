Top-Down Tile Painting Game — Specification

Camera & View:

Top-down, orthographic view.

Playfield is a 2D grid of tiles (e.g., 40×40).

Each tile has a state: unpainted or painted by Player X.

Players:

any number of players. 

Each player has a unique color.

Player is represented as a small moving unit (circle or square).

Movement is continuous in the four cardinal directions.

Painting Mechanic:

When a player moves over a tile, that tile becomes painted with the player’s color.

Players can paint over each other's tiles at any time.

A tile stores only the most recent painter.

Powerups (optional):
Powerups spawn randomly on empty tiles. Examples:

Speed Boost: temporary movement speed increase.

Paint Bomb: paints a 3×3 area around the player.

Shield: prevents tile overwrite for 5 seconds.
Powerups are single-use when picked up.

Collisions:

Players do not block each other.

Running through another player has no effect unless special powerups modify this.

Timer:

Match length is fixed (e.g., 60 seconds).

When the timer reaches zero, the match ends.

Win Condition:

Count all tiles painted by each player.

Player with the highest number of painted tiles wins.

Controls:

Keyboard or gamepad: up/down/left/right.

No attacks or buttons required.

Performance Expectations:

Grid updates must be efficient (ideally using a 2D array or int32 buffer).

Painting should be O(1) per movement frame.

Data Structures:

Grid: grid[x][y] stores player_id or 0 for unpainted.

Player: position, velocity, color, active powerups, score.