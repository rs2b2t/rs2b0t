export interface FishingGearPiece {
    /** Exact inventory / bank item name. */
    name: string;
    /** Minimum count required to start/continue fishing. */
    min: number;
    /**
     * Target count when restocking from the bank.
     * Tools stay at 1; bait/feathers top up to a stack so bank trips are rare.
     */
    restock: number;
}

export interface FishingMethod {
    name: string;
    /** Primary right-click op on the fishing spot. */
    op: string;
    /**
     * The OTHER op on the same spot. Every multi-op fishing spot offers a pair;
     * matching both picks the right spot type when ops collide
     * (Harpoon alone is ambiguous: Cage/Harpoon = tuna/swordfish, Net/Harpoon = sharks).
     * Empty string = primary op only (lava-eel bait spots).
     */
    pair: string;
    /** Tools + consumables kept on deposit and restocked when missing. */
    gear: FishingGearPiece[];
}

/** Whirlpool spot variants (fishing anti-macro). The worked spot is swapped into
 *  one of these for ~60 ticks; re-clicking swallows the fishing equipment. Same
 *  "Fishing spot" name/ops as the real thing — refuse by id. */
export const WHIRLPOOL_IDS: Set<number> = new Set([403, 404, 405, 406]);

const tool = (name: string): FishingGearPiece => ({ name, min: 1, restock: 1 });
const bait = (name: string, restock = 100): FishingGearPiece => ({ name, min: 1, restock });

/**
 * Spot op pairs (2004scape):
 *   Net/Bait     — small net (shrimp/anchovy) or bait rod (sardine/herring)
 *   Lure/Bait    — fly fishing (trout/salmon) or bait rod (pike)
 *   Net/Harpoon  — big net (mackerel/cod/bass) or harpoon (sharks)
 *   Cage/Harpoon — cage (lobster) or harpoon (tuna/swordfish)
 *   Bait only    — oily rod lava eels (Taverley dungeon)
 */
export const FISHING_METHODS: FishingMethod[] = [
    {
        name: 'Small net — shrimp/anchovy',
        op: 'Net',
        pair: 'Bait',
        gear: [tool('Small fishing net')]
    },
    {
        name: 'Bait rod — sardine/herring',
        op: 'Bait',
        pair: 'Net',
        gear: [tool('Fishing rod'), bait('Fishing bait')]
    },
    {
        name: 'Fly fishing — trout/salmon',
        op: 'Lure',
        pair: 'Bait',
        gear: [tool('Fly fishing rod'), bait('Feather')]
    },
    {
        name: 'Bait rod — pike',
        op: 'Bait',
        pair: 'Lure',
        gear: [tool('Fishing rod'), bait('Fishing bait')]
    },
    {
        name: 'Big net — mackerel/cod/bass',
        op: 'Net',
        pair: 'Harpoon',
        gear: [tool('Big fishing net')]
    },
    {
        name: 'Lobster cage — lobster',
        op: 'Cage',
        pair: 'Harpoon',
        gear: [tool('Lobster pot')]
    },
    {
        name: 'Harpoon — tuna/swordfish',
        op: 'Harpoon',
        pair: 'Cage',
        gear: [tool('Harpoon')]
    },
    {
        name: 'Harpoon — sharks',
        op: 'Harpoon',
        pair: 'Net',
        gear: [tool('Harpoon')]
    },
    {
        // Members: Taverley dungeon lava fishing spots. Oily rod is quest-made;
        // still uses Fishing bait. Spots are typically Bait-only (no pair op).
        name: 'Oily rod — lava eel',
        op: 'Bait',
        pair: '',
        gear: [tool('Oily fishing rod'), bait('Fishing bait')]
    }
];

export const FISHING_METHOD_OPTIONS = FISHING_METHODS.map(m => m.name);

/** Canonical tool/consumable names used across methods (for random-event keep lists, etc.). */
export const ALL_FISHING_GEAR_NAMES: string[] = [
    ...new Set(FISHING_METHODS.flatMap(m => m.gear.map(g => g.name)))
];

export function resolveFishMethod(name: string): FishingMethod {
    return FISHING_METHODS.find(m => m.name === name) ?? FISHING_METHODS[0];
}

/** Exact item names to keep when depositing the catch. */
export function gearKeepNames(method: Pick<FishingMethod, 'gear'>): string[] {
    return method.gear.map(g => g.name);
}

export function hasFishingGear(
    method: Pick<FishingMethod, 'gear'>,
    count: (name: string) => number
): boolean {
    return method.gear.every(g => count(g.name) >= g.min);
}

export function missingFishingGear(
    method: Pick<FishingMethod, 'gear'>,
    count: (name: string) => number
): FishingGearPiece[] {
    return method.gear.filter(g => count(g.name) < g.min);
}

export function gearLabel(method: Pick<FishingMethod, 'gear'>): string {
    return method.gear.map(g => g.name).join(' + ');
}

/**
 * What to withdraw after opening the bank so inv meets restock targets.
 * Skips pieces already at target or with nothing in the bank.
 */
export function fishingRestockPlan(
    method: Pick<FishingMethod, 'gear'>,
    invCount: (name: string) => number,
    bankCount: (name: string) => number
): { name: string; qty: number }[] {
    const plan: { name: string; qty: number }[] = [];
    for (const g of method.gear) {
        const have = invCount(g.name);
        const need = g.restock - have;
        if (need <= 0) {
            continue;
        }
        const available = bankCount(g.name);
        if (available <= 0) {
            continue;
        }
        plan.push({ name: g.name, qty: Math.min(need, available) });
    }
    return plan;
}

/** True when a spot's action list matches the method's primary op (+ pair when set). */
export function spotMatchesMethod(actions: readonly string[], method: Pick<FishingMethod, 'op' | 'pair'>): boolean {
    const ops = actions.map(a => a.toLowerCase());
    const primary = method.op.toLowerCase();
    if (!ops.includes(primary)) {
        return false;
    }
    const pair = method.pair.trim().toLowerCase();
    if (!pair || pair === primary) {
        // Bait-only (lava eel) and any future single-op spots.
        return true;
    }
    return ops.includes(pair);
}
