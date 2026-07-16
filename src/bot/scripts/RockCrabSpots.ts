import Tile from '../api/Tile.js';

/**
 * Pure RockCrab field knowledge — no client imports so it runs under plain
 * `bun test` (ArdyThieverLogic pattern). The dormant "Rocks" spawn table and
 * the preset stand spots derived from it live here so the data invariants
 * stay test-pinned.
 */

// Dormant "Rocks" spawn tiles on the Rellekka north shore, decoded from the
// engine's packed map (maps/m42_58.jm2, npcs 1266/1268). They have
// wanderrange 0 — a dormant rock sits EXACTLY on its spawn tile — and
// huntrange 1: a player within Chebyshev 1 wakes it into an attacking
// "Rock Crab".
export const ROCKS_SPAWNS: readonly Tile[] = [
    new Tile(2694, 3724, 0),
    new Tile(2700, 3718, 0),
    new Tile(2701, 3728, 0),
    new Tile(2702, 3720, 0),
    new Tile(2703, 3716, 0),
    new Tile(2704, 3727, 0),
    new Tile(2705, 3725, 0),
    new Tile(2708, 3719, 0),
    new Tile(2711, 3715, 0),
    new Tile(2712, 3719, 0),
    new Tile(2712, 3725, 0),
    new Tile(2715, 3729, 0),
    new Tile(2716, 3721, 0),
    new Tile(2719, 3719, 0)
];

// Preset stand spots (the loc1-5 defaults): pack-walkable tiles, never ON a
// spawn, whose 3x3 square touches 2-3 spawns (spawn within Chebyshev 2 —
// inside or adjacent to the square), one per spawn cluster (pairwise > 4
// apart so rotating between spots works different respawn groups). Ranked by
// stand-wake count first — spawns within Chebyshev 1 re-aggro the instant
// they respawn while the bot just stands there (huntrange 1) — then by 3x3
// touch count.
export const DEFAULT_SPOTS: readonly Tile[] = [
    new Tile(2704, 3726, 0), // wakes 2 standing still
    new Tile(2701, 3719, 0), // wakes 2 standing still
    new Tile(2717, 3720, 0), // wakes 1, 3x3 touches 2
    new Tile(2710, 3717, 0), // 3x3 touches 3
    new Tile(2713, 3727, 0) // 3x3 touches 2
];

/** How many spawns sit within `ring` (Chebyshev) of `spot`. */
export function spawnsWithin(spot: Tile, ring: number, spawns: readonly Tile[] = ROCKS_SPAWNS): number {
    return spawns.filter(s => s.distanceTo(spot) <= ring).length;
}
