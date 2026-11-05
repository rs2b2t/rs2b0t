import type Tile from '../../geometry/Tile.js';

/** Ore object id for the dropped/kept product. Iron only in v1. */
export const ORE_NAME = 'Iron ore';
export const IRON_ORE_IDS: ReadonlySet<number> = new Set([440, 441]);

/** Live iron rock loc ids (`ironrock1` / `ironrock2`). */
export const IRON_ROCK_IDS: ReadonlySet<number> = new Set([2092, 2093]);

/** Gas-rock variants of iron must never be targeted (random-event risk). */
export const IRON_GAS_IDS: ReadonlySet<number> = new Set([2121, 2122]);

/** Depleted rock stage ids (`rocks1` / `rocks2`). The loc is still named Rocks with op1=Mine. */
export const DEPLETED_ROCK_IDS: ReadonlySet<number> = new Set([450, 452]);

export const MINE_OP = 'Mine';

/** Extra power-mining refuse: random-event food and the mining gem-table drops. */
export const EXTRA_DROP_IDS: ReadonlySet<number> = new Set([
    464,  // Strange fruit
    1617, // Uncut diamond
    1619, // Uncut ruby
    1621, // Uncut emerald
    1623, // Uncut sapphire
    1917, // Beer
    1971  // Kebab
]);

export const tileKey = (tile: { x: number; z: number }): string => `${tile.x},${tile.z}`;

/** Chebyshev distance between a player tile and a rock tile (level mismatch is far). */
export function near(here: Tile | null, tile: Tile, max: number): boolean {
    return here !== null && here.distanceTo(tile) <= max;
}
