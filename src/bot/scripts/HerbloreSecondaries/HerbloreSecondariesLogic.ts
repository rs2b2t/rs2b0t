/**
 * Pure decisions for Herblore secondary gathering (issue #430).
 * Anchors come from rev-274 map OBJ spawns + shop NPC stands.
 */

import { foodHealAmount as healOf, shouldEatToUseFood } from '../../api/combat/food.js';

export { foodHealAmount } from '../../api/combat/food.js';

export const FOOD_DEFAULT = 'Lobster';
export const FOOD_DEFAULT_COUNT = 10;
/** Cap coins carried on shop runs so a death loses at most this. */
export const SHOP_COIN_CAP = 5000;
export const SHIELD_NAME = 'Dragonfire shield'; // content display name for antidragonbreathshield

type SecondaryId =
    | 'red_spiders_eggs'
    | 'snape_grass'
    | 'eye_of_newt'
    | 'chocolate_dust'
    | 'white_berries'
    | 'toads_legs';

type SecondaryMode = 'loot' | 'buy' | 'buy_grind' | 'loot_process';

interface TileRef {
    x: number;
    z: number;
    level: number;
}

export interface SecondaryDef {
    id: SecondaryId;
    /** Inventory / ground display name. */
    name: string;
    mode: SecondaryMode;
    /** Where to stand / search. */
    anchor: TileRef;
    searchRadius: number;
    bank: TileRef;
    bankName: string;
    /** Dangerous route — withdraw food. */
    takeFood: boolean;
    /** Needs anti-dragon shield equipped or carried. */
    needShield: boolean;
    /** Ground / shop source name when different from product (e.g. Swamp toad → Toad's legs). */
    sourceName?: string;
    shopNpc?: string;
    shopStand?: TileRef;
    /** For buy_grind: pestle shop. */
    toolShopNpc?: string;
    toolShopStand?: TileRef;
    toolName?: string;
    grindFrom?: string;
}

export const SECONDARIES: readonly SecondaryDef[] = [
    {
        id: 'red_spiders_eggs',
        name: "Red spiders' eggs",
        mode: 'loot',
        anchor: { x: 3120, z: 9952, level: 0 },
        searchRadius: 14,
        bank: { x: 3094, z: 3493, level: 0 },
        bankName: 'Edgeville',
        takeFood: true,
        needShield: false
    },
    {
        id: 'snape_grass',
        name: 'Snape grass',
        mode: 'loot',
        // peninsula west of Crafting Guild (map m45_51 spawns)
        anchor: { x: 2908, z: 3294, level: 0 },
        searchRadius: 16,
        bank: { x: 2946, z: 3369, level: 0 },
        bankName: 'Falador West',
        takeFood: true,
        needShield: false
    },
    {
        id: 'eye_of_newt',
        name: 'Eye of newt',
        mode: 'buy',
        anchor: { x: 3012, z: 3259, level: 0 },
        searchRadius: 6,
        bank: { x: 3093, z: 3243, level: 0 },
        bankName: 'Draynor',
        takeFood: false,
        needShield: false,
        shopNpc: 'Betty',
        shopStand: { x: 3012, z: 3259, level: 0 }
    },
    {
        id: 'chocolate_dust',
        name: 'Chocolate dust',
        mode: 'buy_grind',
        anchor: { x: 3014, z: 3204, level: 0 },
        searchRadius: 6,
        bank: { x: 3093, z: 3243, level: 0 },
        bankName: 'Draynor',
        takeFood: false,
        needShield: false,
        shopNpc: 'Wydin',
        shopStand: { x: 3014, z: 3204, level: 0 },
        toolShopNpc: 'Jatix',
        toolShopStand: { x: 2899, z: 3427, level: 0 },
        toolName: 'Pestle and mortar',
        grindFrom: 'Chocolate bar'
    },
    {
        id: 'white_berries',
        name: 'White berries',
        mode: 'loot',
        // red dragon isle (wilderness) — needs dragonfire shield
        anchor: { x: 3216, z: 3812, level: 0 },
        searchRadius: 12,
        bank: { x: 3094, z: 3493, level: 0 },
        bankName: 'Edgeville',
        takeFood: true,
        needShield: true
    },
    {
        id: 'toads_legs',
        name: "Toad's legs",
        mode: 'loot_process',
        // swamp toads in Tree Gnome Stronghold
        anchor: { x: 2415, z: 3514, level: 0 },
        searchRadius: 18,
        bank: { x: 2449, z: 3482, level: 1 },
        bankName: 'Grand Tree',
        takeFood: false,
        needShield: false,
        sourceName: 'Swamp toad'
    }
];

export const SECONDARY_OPTIONS = SECONDARIES.map(s => s.name);

export function secondaryByName(name: string): SecondaryDef | null {
    const want = name.trim().toLowerCase();
    return SECONDARIES.find(s => s.name.toLowerCase() === want || s.id === want) ?? null;
}

export function secondaryById(id: SecondaryId): SecondaryDef {
    const s = SECONDARIES.find(x => x.id === id);
    if (!s) {
        throw new Error(`unknown secondary ${id}`);
    }
    return s;
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
 * Eat when a full heal fits (no overheal waste), HP is at the safety floor, or
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
    if (shouldEatToUseFood(opts)) {
        return true;
    }
    // pack full while still collecting — free a slot
    return opts.foodCount > 0 && opts.collecting && opts.freeSlots === 0;
}

/** @deprecated use foodHealAmount from combat/food — kept for older imports */
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
// Why: the product and source — toad legs, swamp toads, eggs and the rest — are deliberately omitted, since they are the loot being deposited.
// Why: keeping them leaves a full pack after close and spams open/close.

/** What to keep in the pack when banking. */
export function keepOnDeposit(def: SecondaryDef, food: string): string[] {
    const keep: string[] = [];
    // Coins buy stock on shop routes; anywhere else they are random-event pickups.
    if (def.mode === 'buy' || def.mode === 'buy_grind') {
        keep.push('Coins');
    }
    if (def.takeFood) {
        keep.push(food);
    }
    if (def.needShield) {
        keep.push(SHIELD_NAME);
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
    def: SecondaryDef;
    foodCount: number;
    foodWant: number;
    coins: number;
    hasShield: boolean;
    hasTool: boolean;
    packFull: boolean;
}): boolean {
    if (opts.packFull) {
        return true;
    }
    // only restock food when empty — mid-trip eating is fine until zero
    if (opts.def.takeFood && opts.foodWant > 0 && opts.foodCount < 1) {
        return true;
    }
    if (opts.def.needShield && !opts.hasShield) {
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
