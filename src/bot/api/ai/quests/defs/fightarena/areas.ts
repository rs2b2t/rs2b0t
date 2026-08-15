import Tile from '../../../../../geometry/Tile.js';

/** Five npcs render "Khazard Guard" and two render "Jeremy Servil", so everything here is by id. */
export const FA_NPC = {
    GUARD1: 253,
    DRUNK_GUARD: 254,
    KHAZARD: 258,
    BARMAN: 259,
    HENGRAD: 263,
    LADY_SERVIL: 264,
    JEREMY_CELL: 265,
    JEREMY_ARENA: 266,
    JUSTIN: 267,
    BOUNCER: 269,
    OGRE: 270,
    SCORPION: 271
} as const;

export const FA_OBJ = { HELMET: 74, ARMOUR: 75, KEYS: 76, BREW: 77 } as const;

export const FA_ITEM = {
    HELMET: 'Khazard helmet',
    ARMOUR: 'Khazard armour',
    KEYS: 'Khazard cell keys',
    BREW: 'Khali brew'
} as const;

export const FA_LOC = { CHEST: 'Chest', DOOR1: 81, DOOR2: 82, JEREMY_DOOR: 80 } as const;

export const FA_TILE = {
    YANILLE_BANK: new Tile(2612, 3092, 0),
    LADY_SERVIL: new Tile(2566, 3199, 0),
    BARMAN: new Tile(2566, 3140, 0),
    // Why: `arena_guard_chest_shut` is `forceapproach=north` at rotation 0, so north is the only side any op lands from.
    CHEST_STAND: new Tile(2613, 3190, 0),
    DOOR1_OUTSIDE: new Tile(2617, 3172, 0),
    DOOR1_INSIDE: new Tile(2617, 3171, 0),
    DRUNK_GUARD: new Tile(2615, 3141, 0),
    JEREMY_DOOR_STAND: new Tile(2617, 3168, 0),
    DOOR2_OUTSIDE: new Tile(2607, 3151, 0),
    DOOR2_INSIDE: new Tile(2605, 3152, 0),
    ARENA_CENTRE: new Tile(2597, 3160, 0)
};

export interface FaRect { minX: number; maxX: number; minZ: number; maxZ: number }

// Why: these are the bounding boxes of four floods over the baked collision pack with the scripted doors removed, and neither cell rect holds a building tile.
export const FA_AREA: Record<'JEREMY_CELL' | 'PRISON_CELL' | 'ARENA' | 'BUILDING', FaRect> = {
    JEREMY_CELL: { minX: 2614, maxX: 2616, minZ: 3166, maxZ: 3170 },
    PRISON_CELL: { minX: 2597, maxX: 2601, minZ: 3142, maxZ: 3144 },
    ARENA: { minX: 2583, maxX: 2606, minZ: 3152, maxZ: 3170 },
    BUILDING: { minX: 2585, maxX: 2619, minZ: 3139, maxZ: 3171 }
};

export type FaPocket = 'jeremyCell' | 'prisonCell' | 'arena' | 'building' | 'outside';

function inRect(tile: { x: number; z: number }, rect: FaRect): boolean {
    return tile.x >= rect.minX && tile.x <= rect.maxX && tile.z >= rect.minZ && tile.z <= rect.maxZ;
}

// Why: every crossing between these is a server teleport, so a step that assumes the wrong one sends the walker at a tile on the far side of a wall.

/** Which sealed pocket a tile belongs to. Order matters: the cells sit inside the building's box. */
export function pocketOf(tile: { x: number; z: number; level: number } | null | undefined): FaPocket {
    if (!tile || tile.level !== 0) {
        return 'outside';
    }
    if (inRect(tile, FA_AREA.JEREMY_CELL)) {
        return 'jeremyCell';
    }
    if (inRect(tile, FA_AREA.PRISON_CELL)) {
        return 'prisonCell';
    }
    if (inRect(tile, FA_AREA.ARENA)) {
        return 'arena';
    }
    if (inRect(tile, FA_AREA.BUILDING)) {
        return 'building';
    }
    return 'outside';
}
