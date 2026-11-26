import { foodHealAmount as healOf, shouldEatToUseFood } from '../../api/combat/food.js';
import { DRAGONFIRE_SHIELD, SECONDARY_SOURCES, type SecondarySource } from '../../data/herbloreSecondarySources.js';

export type { WorldTile as TileRef } from '../../adapter/ClientAdapter.js';
export {
    DRAGONFIRE_SHIELD as SHIELD_NAME,
    SECONDARY_SOURCES as SECONDARIES,
    secondarySourceById as secondaryById,
    secondarySourceByName as secondaryByName,
    type SecondarySource as SecondaryDef
} from '../../data/herbloreSecondarySources.js';
export { foodHealAmount } from '../../api/combat/food.js';

export const FOOD_DEFAULT = 'Lobster';
export const FOOD_DEFAULT_COUNT = 10;
/** Cap coins carried on shop runs so a death loses at most this. */
export const SHOP_COIN_CAP = 5000;
export const SECONDARY_OPTIONS = SECONDARY_SOURCES.map(s => s.name);

export function grinds(def: SecondarySource): boolean {
    return def.mode === 'buy_grind' || def.mode === 'bank_grind';
}

/** Coins to withdraw for a shop trip (never above SHOP_COIN_CAP). */
export function shopCoinsToWithdraw(inPack: number, banked: number, want = SHOP_COIN_CAP): number {
    const target = Math.min(SHOP_COIN_CAP, want);
    if (inPack >= target) {
        return 0;
    }
    return Math.min(target - inPack, Math.max(0, banked));
}

/**
 * Eat when a full heal fits, HP reaches the 60% safety floor, or
 * the pack is full and eating frees a slot for more loot.
 */
export function shouldEat(opts: {
    hp: number;
    maxHp: number;
    heal: number;
    foodCount: number;
    freeSlots: number;
    collecting: boolean;
}): boolean {
    const minHp = Math.max(5, Math.min(opts.maxHp - 1, Math.ceil(opts.maxHp * 0.6)));
    if (shouldEatToUseFood({ ...opts, minHp })) {
        return true;
    }
    // pack full while still collecting, free a slot
    return opts.foodCount > 0 && opts.collecting && opts.freeSlots === 0;
}

/** @deprecated use foodHealAmount from combat/food, kept for older imports */
export const FOOD_HEAL: Record<string, number> = {
    lobster: healOf('Lobster'),
    swordfish: healOf('Swordfish'),
    tuna: healOf('Tuna'),
    salmon: healOf('Salmon'),
    trout: healOf('Trout'),
    pike: healOf('Pike'),
    bass: healOf('Bass'),
    'cooked meat': healOf('Cooked meat'),
    bread: healOf('Bread'),
    shrimp: healOf('Shrimps'),
    shrimps: healOf('Shrimps')
};

// Why: everything not kept is deposited, including random-event loot such as coins, runes and arrows that would otherwise ride along.
// Why: the product and source, toad legs, swamp toads, eggs and the rest, are deliberately omitted, since they are the loot being deposited.
// Why: keeping them leaves a full pack after close and spams open/close.

/** What to keep in the pack when banking. */
export function keepOnDeposit(def: SecondarySource, food: string): string[] {
    const keep: string[] = [];
    // Coins buy stock on shop routes; anywhere else they are random-event pickups.
    if (def.mode === 'buy' || def.mode === 'buy_grind') {
        keep.push('Coins');
    }
    if (def.takeFood) {
        keep.push(food);
    }
    if (def.needShield) {
        keep.push(DRAGONFIRE_SHIELD);
    }
    if (def.keyName) {
        keep.push(def.keyName);
    }
    if (def.toolName) {
        keep.push(def.toolName);
    }
    // Bars mid-grind stay so we can finish dust after restocking; finished dust deposits.
    if (def.grindFrom) {
        keep.push(def.grindFrom);
    }
    return keep;
}

export function needsRestock(opts: {
    def: SecondarySource;
    foodCount: number;
    foodWant: number;
    coins: number;
    hasShield: boolean;
    hasKey?: boolean;
    hasTool: boolean;
    packFull: boolean;
    grindLeft: number;
}): boolean {
    const midGrind = grinds(opts.def) && opts.grindLeft > 0;
    if (opts.packFull && !midGrind) {
        return true;
    }
    if (opts.def.mode === 'bank_grind' && opts.grindLeft === 0) {
        return true;
    }
    // only restock food when empty, mid-trip eating is fine until zero
    if (opts.def.takeFood && opts.foodWant > 0 && opts.foodCount < 1) {
        return true;
    }
    if (opts.def.needShield && !opts.hasShield) {
        return true;
    }
    if (opts.def.keyName && !opts.hasKey) {
        return true;
    }
    if (opts.def.mode === 'buy' || opts.def.mode === 'buy_grind') {
        if (opts.coins < 50) {
            return true;
        }
    }
    // missing pestle is BuyTool's job (shop), not a bank loop
    return false;
}
