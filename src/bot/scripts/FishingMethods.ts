export interface FishingGearPiece {

    name: string;

    min: number;

    restock: number;
}

export interface FishingMethod {
    name: string;

    op: string;

    pair: string;

    gear: FishingGearPiece[];
}

export const WHIRLPOOL_IDS: Set<number> = new Set([403, 404, 405, 406]);

const tool = (name: string): FishingGearPiece => ({ name, min: 1, restock: 1 });
const bait = (name: string, restock = 100): FishingGearPiece => ({ name, min: 1, restock });

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


        name: 'Oily rod — lava eel',
        op: 'Bait',
        pair: '',
        gear: [tool('Oily fishing rod'), bait('Fishing bait')]
    }
];

export const FISHING_METHOD_OPTIONS = FISHING_METHODS.map(m => m.name);

export const ALL_FISHING_GEAR_NAMES: string[] = [
    ...new Set(FISHING_METHODS.flatMap(m => m.gear.map(g => g.name)))
];

export function resolveFishMethod(name: string): FishingMethod {
    return FISHING_METHODS.find(m => m.name === name) ?? FISHING_METHODS[0];
}

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

export function spotMatchesMethod(actions: readonly string[], method: Pick<FishingMethod, 'op' | 'pair'>): boolean {
    const ops = actions.map(a => a.toLowerCase());
    const primary = method.op.toLowerCase();
    if (!ops.includes(primary)) {
        return false;
    }
    const pair = method.pair.trim().toLowerCase();
    if (!pair || pair === primary) {

        return true;
    }
    return ops.includes(pair);
}
