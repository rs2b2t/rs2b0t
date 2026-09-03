export const ROD = 'Fly fishing rod';
export const FEATHER = 'Feather';
export const KEEPER = 'Fernahei';
export const SPOT = 'Fishing spot';
export const CAST = 'Lure';
/** What a fly rod pulls out of the Shilo river, and the two lines Fernahei's hut buys. */
export const FISH = ['Raw trout', 'Raw salmon'] as const;
export const FLY_LEVEL = 20;

export interface PackState {
    rod: boolean;
    feathers: number;
    fish: number;
    coins: number;
    free: number;
}

export type Step =
    | { kind: 'fish' }
    | { kind: 'sell' }
    | { kind: 'gear' }
    | { kind: 'stop'; reason: string };

// Why: a full pack or an empty feather stack with fish aboard both end at the counter, and the same visit buys the rod or the feathers, so one trip kind covers every reason to leave the river.
/** One step per loop, read off the pack alone so a restart lands on the same choice. */
export function decide(pack: PackState, feathersTarget: number): Step {
    if (feathersTarget > 0 && pack.feathers >= feathersTarget) {
        return { kind: 'stop', reason: `holding ${pack.feathers} feathers, the target was ${feathersTarget}` };
    }
    if (pack.fish > 0 && (pack.free === 0 || pack.feathers === 0 || !pack.rod)) {
        return { kind: 'sell' };
    }
    if (!pack.rod || pack.feathers === 0) {
        if (pack.coins > 0) {
            return { kind: 'gear' };
        }
        return { kind: 'stop', reason: `${pack.rod ? 'no feathers' : 'no fly fishing rod'}, no fish to sell and no coins to buy with` };
    }
    if (pack.free === 0) {
        return { kind: 'stop', reason: 'the pack is full of things that are not fish, so nothing can be sold to make room' };
    }
    return { kind: 'fish' };
}

/** The fish stacks in the pack, in the order the counter takes them. */
export function sellPlan(count: (name: string) => number): { name: string; count: number }[] {
    return FISH.map(name => ({ name, count: count(name) })).filter(f => f.count > 0);
}

/** Feathers a visit should ask for: every one in stock, since the shop sells only what the coins cover. */
export function featherAsk(stock: number, coins: number): number {
    if (coins <= 0) {
        return 0;
    }
    return Math.max(0, stock);
}

/** The trip line the log carries. */
export function tripLine(sold: { name: string; count: number }[], earned: number, feathers: number, spent: number, holding: number): string {
    const fish = sold.length === 0 ? 'nothing' : sold.map(s => `${s.count} ${s.name.replace(/^Raw /, '').toLowerCase()}`).join(' + ');
    return `sold ${fish} for ${earned}gp, bought ${feathers} feathers for ${spent}gp (holding ${holding})`;
}
