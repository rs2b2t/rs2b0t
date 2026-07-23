export interface FishingMethod {
    name: string;
    op: string;
    pair?: string;
    gear: string[];
    spotIds?: number[];
}

export const SHARK_SPOT_IDS: number[] = [313, 322, 334, 1191, 1333];

export const WHIRLPOOL_IDS: Set<number> = new Set([403, 404, 405, 406]);

export const FISHING_METHODS: FishingMethod[] = [
    { name: 'Small net — shrimp/anchovy', op: 'Net', pair: 'Bait', gear: ['Small fishing net'] },
    { name: 'Bait rod — sardine/herring', op: 'Bait', pair: 'Net', gear: ['Fishing rod', 'Fishing bait'] },
    { name: 'Fly fishing — trout/salmon', op: 'Lure', pair: 'Bait', gear: ['Fly fishing rod', 'Feather'] },
    { name: 'Bait rod — pike', op: 'Bait', pair: 'Lure', gear: ['Fishing rod', 'Fishing bait'] },
    { name: 'Big net — mackerel/cod/bass', op: 'Net', pair: 'Harpoon', gear: ['Big fishing net'] },
    { name: 'Lobster cage — lobster', op: 'Cage', pair: 'Harpoon', gear: ['Lobster pot'] },
    { name: 'Harpoon — tuna/swordfish', op: 'Harpoon', gear: ['Harpoon'] },
    { name: 'Harpoon — sharks', op: 'Harpoon', pair: 'Net', gear: ['Harpoon'], spotIds: SHARK_SPOT_IDS }
];

export const FISHING_METHOD_OPTIONS = FISHING_METHODS.map(m => m.name);

export function resolveFishMethod(name: string): FishingMethod {
    return FISHING_METHODS.find(m => m.name === name) ?? FISHING_METHODS[0];
}
