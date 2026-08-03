/**
 * Approximate wilderness level from world coordinates (2004 / LostCity map).
 *
 * Standard spell teleports block above level 20; glory jewellery above 30.
 * Formula matches common RSC/OSRS strip north of the Edgeville ditch:
 *   z < 3520 → 0; else floor((z − 3520) / 8) + 1, clipped to free-world x band.
 */

export interface WildTile {
    x: number;
    z: number;
    level?: number;
}

/** Edgeville ditch / wildy south edge (z). */
export const WILDERNESS_SOUTH_Z = 3520;

/** Rough free-world wilderness x span (excludes deep members-only strips for plan). */
const WILD_X_MIN = 2944;
const WILD_X_MAX = 3392;

/**
 * Wilderness combat level at a tile, or 0 if not in wilderness.
 * Multi-level (dungeons) treated as non-wild for originless spell/jewellery.
 */
export function wildernessLevelAt(tile: WildTile): number {
    if ((tile.level ?? 0) !== 0) {
        return 0;
    }
    if (tile.z < WILDERNESS_SOUTH_Z) {
        return 0;
    }
    if (tile.x < WILD_X_MIN || tile.x > WILD_X_MAX) {
        return 0;
    }
    return Math.floor((tile.z - WILDERNESS_SOUTH_Z) / 8) + 1;
}

/** Standard spellbook teleports (and most jewellery) refuse above this wildy level. */
export const SPELL_MAX_WILDERNESS = 20;

/** Amulet of glory teleports refuse above this wildy level. */
export const GLORY_MAX_WILDERNESS = 30;
