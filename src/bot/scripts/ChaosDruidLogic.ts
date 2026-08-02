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

export type ChaosDruidArea = 'surface' | 'edgeville-dungeon' | 'other-underground' | 'unknown';

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
    return normalized === 'herb' || normalized === 'law rune';
}

export function chaosDruidArea(tile: WorldTile | null): ChaosDruidArea {
    if (tile === null) {
        return 'unknown';
    }
    const bounds = EDGEVILLE_DUNGEON_BOUNDS;
    if (tile.x >= bounds.minX && tile.x <= bounds.maxX && tile.z >= bounds.minZ && tile.z <= bounds.maxZ) {
        return 'edgeville-dungeon';
    }
    return tile.z > 6400 ? 'other-underground' : 'surface';
}

/** Detect a missed death message from the otherwise impossible dungeon-to-surface jump. */
export function chaosDruidRespawned(previous: ChaosDruidArea, current: ChaosDruidArea, tripPrepared: boolean): boolean {
    return tripPrepared && previous === 'edgeville-dungeon' && current === 'surface';
}

export function inEdgevilleDungeon(tile: WorldTile | null): boolean {
    return chaosDruidArea(tile) === 'edgeville-dungeon';
}

export function inChaosDruidField(tile: WorldTile | null): boolean {
    if (tile === null || !inEdgevilleDungeon(tile)) {
        return false;
    }
    return Math.max(
        Math.abs(tile.x - CHAOS_DRUID_FIELD.x),
        Math.abs(tile.z - CHAOS_DRUID_FIELD.z)
    ) <= CHAOS_DRUID_FIELD_RADIUS;
}
