export interface FishingMethod {
    name: string;
    /** Primary right-click op on the fishing spot. */
    op: string;
    /**
     * The OTHER op on the same spot. Every fishing spot offers a pair of ops;
     * matching both is how we pick the right spot type when ops collide
     * (Harpoon alone is ambiguous: Cage/Harpoon = tuna/swordfish, Net/Harpoon = sharks).
     */
    pair: string;
    gear: string[];
}

/** Whirlpool spot variants (fishing anti-macro). The worked spot is swapped into
 *  one of these for ~60 ticks; re-clicking swallows the fishing equipment. Same
 *  "Fishing spot" name/ops as the real thing — refuse by id. */
export const WHIRLPOOL_IDS: Set<number> = new Set([403, 404, 405, 406]);

/**
 * Spot op pairs (2004scape):
 *   Net/Bait     — small net (shrimp/anchovy) or bait rod (sardine/herring)
 *   Lure/Bait    — fly fishing (trout/salmon) or bait rod (pike)
 *   Net/Harpoon  — big net (mackerel/cod/bass) or harpoon (sharks)
 *   Cage/Harpoon — cage (lobster) or harpoon (tuna/swordfish)
 */
export const FISHING_METHODS: FishingMethod[] = [
    { name: 'Small net — shrimp/anchovy', op: 'Net', pair: 'Bait', gear: ['Small fishing net'] },
    { name: 'Bait rod — sardine/herring', op: 'Bait', pair: 'Net', gear: ['Fishing rod', 'Fishing bait'] },
    { name: 'Fly fishing — trout/salmon', op: 'Lure', pair: 'Bait', gear: ['Fly fishing rod', 'Feather'] },
    { name: 'Bait rod — pike', op: 'Bait', pair: 'Lure', gear: ['Fishing rod', 'Fishing bait'] },
    { name: 'Big net — mackerel/cod/bass', op: 'Net', pair: 'Harpoon', gear: ['Big fishing net'] },
    { name: 'Lobster cage — lobster', op: 'Cage', pair: 'Harpoon', gear: ['Lobster pot'] },
    { name: 'Harpoon — tuna/swordfish', op: 'Harpoon', pair: 'Cage', gear: ['Harpoon'] },
    { name: 'Harpoon — sharks', op: 'Harpoon', pair: 'Net', gear: ['Harpoon'] }
];

export const FISHING_METHOD_OPTIONS = FISHING_METHODS.map(m => m.name);

export function resolveFishMethod(name: string): FishingMethod {
    return FISHING_METHODS.find(m => m.name === name) ?? FISHING_METHODS[0];
}

/** True when a spot's action list matches the method's primary op + pair op. */
export function spotMatchesMethod(actions: readonly string[], method: Pick<FishingMethod, 'op' | 'pair'>): boolean {
    const ops = actions.map(a => a.toLowerCase());
    return ops.includes(method.op.toLowerCase()) && ops.includes(method.pair.toLowerCase());
}
