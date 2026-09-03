import type Tile from '../../geometry/Tile.js';
import { SEARCH_AREA, SPOT_STANDS, SWEEP } from './river.js';

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

export interface SpotLike {
    tile(): { x: number; z: number };
}

/** The village-side bank tile for a spot on one of the known river tiles, or null when it sits where no bank reaches. */
export function standFor(spot: { x: number; z: number }): Tile | null {
    return SPOT_STANDS.find(s => s.spot.x === spot.x && s.spot.z === spot.z)?.stand ?? null;
}

const cheb = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** True for a tile inside the stretch of river the search covers. */
export function inArea(t: { x: number; z: number }): boolean {
    return t.x >= SEARCH_AREA.minX && t.x <= SEARCH_AREA.maxX && t.z >= SEARCH_AREA.minZ && t.z <= SEARCH_AREA.maxZ;
}

/** The fishable spot whose stand is the shortest walk from here, with its stand; `fallback` names a stand for a spot tile the table does not know. */
export function nearestFishable<T extends SpotLike>(
    spots: readonly T[],
    here: { x: number; z: number },
    fallback: (spot: T) => Tile | null = () => null
): { spot: T; stand: Tile } | null {
    let best: { spot: T; stand: Tile } | null = null;
    for (const spot of spots) {
        if (!inArea(spot.tile())) {
            continue;
        }
        const stand = standFor(spot.tile()) ?? fallback(spot);
        if (!stand) {
            continue;
        }
        if (!best || cheb(stand, here) < cheb(best.stand, here)) {
            best = { spot, stand };
        }
    }
    return best;
}

// Why: a spot beyond npc view range is invisible to the client, so with none in sight the bank is swept end to end and the sweep turns at both ends, never settling on the two nearest stands.
/** The next sweep stop as an index into SWEEP: the nearest one to begin, then the one after the last in sweep order. */
export function nextScan(here: { x: number; z: number }, last: number | null): number {
    if (last === null) {
        return SWEEP.reduce((best, s, i) => (cheb(s, here) < cheb(SWEEP[best]!, here) ? i : best), 0);
    }
    return (last + 1) % SWEEP.length;
}
