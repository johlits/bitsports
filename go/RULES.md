# Rules of Go (Baduk / Weiqi)

Go is one of the oldest board games in the world, originating in China over 2,500 years ago. Two players compete to control the most territory on a 19×19 grid.

---

## The Board

- The board is a **19×19 grid** of lines, producing **361 intersections**.
- Stones are placed on **intersections**, not inside squares.
- Nine intersections are marked with dots called **star points** (hoshi), used as visual reference points.

---

## Players and Stones

- **Black** plays first.
- Players alternate turns — Black, then White, then Black, and so on.
- Once placed, stones are **never moved**.

---

## Placing a Stone

On your turn you must do one of the following:
1. **Place a stone** on any empty intersection (subject to the rules below).
2. **Pass** your turn.

---

## Liberties

A **liberty** is an empty intersection directly adjacent (up, down, left, right — not diagonal) to a stone or group of connected stones.

- A single stone on the edge of the board has 2–3 liberties.
- A single stone in the centre has 4 liberties.
- Stones of the same colour that are adjacent form a **group** and share their liberties.

---

## Capture

If a move **removes the last liberty** of one or more opponent groups, those groups are **captured** and removed from the board. Captured stones are kept as **prisoners** and count against the captured player at scoring.

Captures are resolved **before** checking whether the placed stone's own group has liberties.

---

## Forbidden Moves

### 1. Suicide (Self-capture)
You may **not** place a stone that would leave your own group with zero liberties — **unless** doing so simultaneously captures one or more opponent groups (which would restore liberties).

### 2. Ko
You may **not** make a move that recreates the exact board position from your **immediately preceding turn** (simple ko rule). This prevents infinite loops of single-stone captures.

This implementation also enforces **superko**: any board position that has occurred in the last several moves may not be recreated, preventing all repetition cycles.

---

## Passing

A player may **pass** instead of placing a stone. Passing does not forfeit the game.

When **both players pass consecutively**, the game ends and scoring begins.

---

## Resignation

A player may **resign** at any time, conceding the game to their opponent immediately.

---

## Scoring (Area Scoring — Tromp-Taylor Rules)

At the end of the game, each player's score is calculated as:

> **Score = Stones on the board + Empty intersections surrounded**

An empty region counts as **territory** for a player if it is completely surrounded by that player's stones (and the board edge). Neutral empty points touching both colours (**dame**) are not counted for either player.

### Komi

Because Black has the advantage of moving first, **White receives 6.5 points of compensation** (komi) added to their final score. The 0.5 ensures there can be no tie.

### Winner

The player with the **higher final score wins**. If Black's score equals White's score + 6.5, White wins.

---

## Example Scores

| Situation | Black | White (+ 6.5 komi) | Winner |
|---|---|---|---|
| B: 180 pts, W: 175 pts | 180 | 181.5 | White |
| B: 195 pts, W: 160 pts | 195 | 166.5 | Black |

---

## AI Opponents

This implementation includes three AI difficulty levels:

| AI | Strategy |
|---|---|
| **Random** | Plays a random valid move each turn. |
| **Greedy** | Prioritises captures and putting opponent groups in atari (1 liberty). Falls back to random when no tactical moves are available. |
| **Heuristic** | Evaluates each candidate move by captures, atari threats, group liberties, connectivity, star point influence, and edge avoidance. Filters candidates near existing stones for speed on the 19×19 board. |

---

## Quick Reference

| Rule | Detail |
|---|---|
| Board size | 19×19 (361 intersections) |
| First move | Black |
| Capture | Remove groups with 0 liberties |
| Suicide | Forbidden (unless capturing) |
| Ko | Cannot recreate immediate previous position |
| Superko | Cannot recreate any recent position |
| Game end | Two consecutive passes or resignation |
| Scoring | Area scoring (stones + territory) |
| Komi | 6.5 points to White |
