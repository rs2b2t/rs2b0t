// Why: wilderness level from world coordinates matches LostCity `~wilderness_level` (wilderness_levels.rs2 + wilderness_zones.dbrow).
// Why: the surface zone runs 0_46_55_0_0 → 3_52_99_63_63 (x 2944–3391, z 3520–6399, levels 0–3).
// Why: the underground zone runs 0_46_155_0_0 → 0_52_199_63_63 (x 2944–3391, z 9920–12799, level 0).
// Why: level = floor((z − zoneSouthZ) / 8) + 1 inside a zone, else 0.
// Why: spell teleports block above level 20 and glory above level 30.

export interface WildTile {
    x: number;
    z: number;
    level?: number;
}

/** Surface wilderness south edge (z). */
const WILDERNESS_SOUTH_Z = 3520;
/** Edgeville dungeon / underground wildy south edge (z). */
const WILDERNESS_UNDERGROUND_SOUTH_Z = 9920;

const WILD_X_MIN = 2944;
const WILD_X_MAX = 3391;
const SURFACE_Z_MAX = 99 * 64 + 63; // 6399
const UNDER_Z_MAX = 199 * 64 + 63; // 12799

/** Standard spellbook + duel ring / games neck: blocked when wildy > 20. */
export const SPELL_MAX_WILDERNESS = 20;

/** Amulet of glory: blocked when wildy > 30. */
export const GLORY_MAX_WILDERNESS = 30;

/**
 * Wilderness combat level at a tile, or 0 outside wild zones.
 */
export function wildernessLevelAt(tile: WildTile): number {
    const level = tile.level ?? 0;
    const { x, z } = tile;
    if (x < WILD_X_MIN || x > WILD_X_MAX) {
        return 0;
    }
    // Surface strip (levels 0–3).
    if (level >= 0 && level <= 3 && z >= WILDERNESS_SOUTH_Z && z <= SURFACE_Z_MAX) {
        return Math.floor((z - WILDERNESS_SOUTH_Z) / 8) + 1;
    }
    // Underground wilderness (level 0 only in content zone pair).
    if (level === 0 && z >= WILDERNESS_UNDERGROUND_SOUTH_Z && z <= UNDER_Z_MAX) {
        return Math.floor((z - WILDERNESS_UNDERGROUND_SOUTH_Z) / 8) + 1;
    }
    return 0;
}
