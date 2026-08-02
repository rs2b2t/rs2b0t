import type { WorldTile } from '../adapter/ClientAdapter.js';

// 3110,9936 is in the room's main walkable component. The visually central
// 3109,9937 is a two-tile collision pocket and cannot be used as a walk target.
export const CHAOS_DRUID_FIELD: WorldTile = { x: 3110, z: 9936, level: 0 };
export const CHAOS_DRUID_FIELD_RADIUS = 14;
export const EDGEVILLE_DUNGEON_BOUNDS = {
    minX: 3072,
    maxX: 3199,
    minZ: 9792,
    maxZ: 10047
} as const;

export interface DungeonBounds {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

// m40_148 (warrior/ledge levels) plus m40_149 (the pit under the ledge)
export const YANILLE_DUNGEON_BOUNDS: DungeonBounds = {
    minX: 2560,
    maxX: 2623,
    minZ: 9472,
    maxZ: 9599
} as const;

export interface DruidSpot {
    npc: string;
    field: WorldTile;
    radius: number;
    bankStand: WorldTile;
    /** underground bbox a trip legitimately occupies; null = surface camp */
    dungeon: DungeonBounds | null;
    requires: { skill: string; level: number } | null;
}

export const DRUID_SPOTS = {
    'Edgeville Dungeon': {
        npc: 'Chaos druid',
        field: CHAOS_DRUID_FIELD,
        radius: CHAOS_DRUID_FIELD_RADIUS,
        bankStand: { x: 3094, z: 3491, level: 0 },
        dungeon: EDGEVILLE_DUNGEON_BOUNDS,
        requires: null
    },
    'Chaos Druid Tower': {
        npc: 'Chaos druid',
        field: { x: 2562, z: 3356, level: 0 },
        radius: 4,
        bankStand: { x: 2616, z: 3332, level: 0 },
        dungeon: null,
        requires: { skill: 'thieving', level: 46 }
    },
    'Yanille Dungeon': {
        npc: 'Chaos druid warrior',
        field: { x: 2580, z: 9501, level: 0 },
        radius: 8,
        bankStand: { x: 2612, z: 3092, level: 0 },
        dungeon: YANILLE_DUNGEON_BOUNDS,
        requires: { skill: 'agility', level: 40 }
    }
} as const satisfies Record<string, DruidSpot>;

export type DruidLocationName = keyof typeof DRUID_SPOTS;
export const DRUID_LOCATION_NAMES = Object.keys(DRUID_SPOTS) as DruidLocationName[];

export type ChaosDruidArea = 'surface' | 'druid-dungeon' | 'other-underground' | 'unknown';

/** The Yanille ledge splits the dungeon into zones the route must treat differently. */
export type YanilleZone = 'north' | 'warrior' | 'pit' | 'outside';

export function yanilleZone(tile: WorldTile): YanilleZone {
    const b = YANILLE_DUNGEON_BOUNDS;
    if (tile.x < b.minX || tile.x > b.maxX || tile.z < b.minZ || tile.z > b.maxZ) {
        return 'outside';
    }
    if (tile.z >= 9536) {
        return 'pit';
    }
    return tile.z >= 9519 ? 'north' : 'warrior';
}

export type ChaosDruidBankReason = 'prepare-trip' | 'loot-full' | 'low-health';

export interface ChaosDruidTripState {
    tripPrepared: boolean;
    inventoryFull: boolean;
    wantedLootVisible: boolean;
    foodCount: number;
    hpFraction: number;
    panicHpFraction: number;
}

/** The three explicit ends to a Chaos-druid trip. */
export function chaosDruidBankReason(state: ChaosDruidTripState): ChaosDruidBankReason | null {
    if (!state.tripPrepared) {
        return 'prepare-trip';
    }
    if (state.inventoryFull && (state.foodCount === 0 || !state.wantedLootVisible)) {
        return 'loot-full';
    }
    if (state.foodCount === 0 && state.hpFraction <= state.panicHpFraction) {
        return 'low-health';
    }
    return null;
}

export function chaosDruidBankRunReady(bankOpen: boolean, reason: ChaosDruidBankReason | null): boolean {
    return bankOpen || reason !== null;
}

export function chaosDruidEatReady(input: {
    bankOpen: boolean;
    hpFraction: number;
    eatHpFraction: number;
    foodCount: number;
}): boolean {
    return !input.bankOpen && input.hpFraction < input.eatHpFraction && input.foodCount > 0;
}

export type LootSpaceAction = 'take' | 'eat-food' | 'drop-food' | 'bank';

/** Decide how to make room for a wanted drop without discarding that drop. */
export function chaosDruidLootSpaceAction(input: {
    inventoryFull: boolean;
    mergesIntoExistingStack?: boolean;
    foodCount: number;
    hp: number;
    maxHp: number;
}): LootSpaceAction {
    if (!input.inventoryFull || input.mergesIntoExistingStack === true) {
        return 'take';
    }
    if (input.foodCount === 0) {
        return 'bank';
    }
    return input.hp < input.maxHp ? 'eat-food' : 'drop-food';
}

/** Law runes are the script's only stackable wanted drop. */
export function chaosDruidDropMerges(
    dropName: string | null | undefined,
    carriedNames: readonly (string | null | undefined)[]
): boolean {
    const wanted = (dropName ?? '').trim().toLowerCase();
    return wanted === 'law rune'
        && carriedNames.some(name => (name ?? '').trim().toLowerCase() === wanted);
}

export function chaosDruidFoodShortfall(configured: number, carried: number): number {
    return Math.max(0, Math.floor(configured) - Math.max(0, Math.floor(carried)));
}

export function isChaosDruidLoot(name: string | null | undefined): boolean {
    const normalized = (name ?? '').trim().toLowerCase();
    return normalized === 'herb' || normalized === 'law rune' || normalized === 'nature rune';
}

export function chaosDruidArea(tile: WorldTile | null, dungeon: DungeonBounds | null = EDGEVILLE_DUNGEON_BOUNDS): ChaosDruidArea {
    if (tile === null) {
        return 'unknown';
    }
    if (dungeon && tile.x >= dungeon.minX && tile.x <= dungeon.maxX && tile.z >= dungeon.minZ && tile.z <= dungeon.maxZ) {
        return 'druid-dungeon';
    }
    return tile.z > 6400 ? 'other-underground' : 'surface';
}

/** Detect a missed death message from the otherwise impossible dungeon-to-surface jump. */
export function chaosDruidRespawned(previous: ChaosDruidArea, current: ChaosDruidArea, tripPrepared: boolean): boolean {
    return tripPrepared && previous === 'druid-dungeon' && current === 'surface';
}

export function inEdgevilleDungeon(tile: WorldTile | null): boolean {
    return chaosDruidArea(tile, EDGEVILLE_DUNGEON_BOUNDS) === 'druid-dungeon';
}

export function inChaosDruidField(tile: WorldTile | null, spot: DruidSpot = DRUID_SPOTS['Edgeville Dungeon']): boolean {
    if (tile === null) {
        return false;
    }
    const area = chaosDruidArea(tile, spot.dungeon);
    if (spot.dungeon ? area !== 'druid-dungeon' : area !== 'surface' || tile.level !== spot.field.level) {
        return false;
    }
    return Math.max(
        Math.abs(tile.x - spot.field.x),
        Math.abs(tile.z - spot.field.z)
    ) <= spot.radius;
}
