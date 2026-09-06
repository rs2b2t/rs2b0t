import Tile from '../../geometry/Tile.js';
import { buyoutCost } from '../../api/shop/shopPrice.js';
import { SEARCH_AREA, SPOT_STANDS, SWEEP, type SpotStand } from './river.js';

export const ROD = 'Fly fishing rod';
export const COINS = 'Coins';
/** Fernahei's feather shelf: 800 at `shop_delta` 20, so a buyout runs to 8,225gp and that is all a trip draws. */
export const FEATHER_STOCK = 800;
export const HUT_SELL_MULTIPLIER = 1000;
export const HUT_DELTA = 20;
export const FEATHER_BUYOUT_GP = buyoutCost(2, FEATHER_STOCK, HUT_SELL_MULTIPLIER, HUT_DELTA);

// Why: the bank is the operator's, not the trip's, so a trip takes what a shelf of feathers costs and leaves the rest banked.
/** Coins to take out of the teller, on top of what is already held. */
export function coinsToDraw(held: number, banked: number): number {
    return held >= FEATHER_BUYOUT_GP ? 0 : Math.max(0, Math.min(banked, FEATHER_BUYOUT_GP - held));
}
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
    /** Inside the village, where the river, the counter and the teller all are. */
    inVillage: boolean;
    /** The teller has been visited since the last catch, so an empty one cannot loop the trip. */
    tellerSeen: boolean;
    /** The teller stop is done and the counter is the other half of the same trip. */
    hutDue: boolean;
}

export type Step =
    | { kind: 'fish' }
    | { kind: 'sell' }
    | { kind: 'gear' }
    | { kind: 'travel' }
    | { kind: 'bank' }
    | { kind: 'stop'; reason: string };

// Why: a trip is the teller then the counter, every time: the catch is banked rather than sold, the coins for the feathers are drawn there and a banked rod is free where the counter's costs coins, and the counter is walked to straight after so every trip ends with the feathers bought out.
/** One step per loop, read off the pack alone so a restart lands on the same choice. */
export function decide(pack: PackState, feathersTarget: number): Step {
    if (feathersTarget > 0 && pack.feathers >= feathersTarget) {
        return { kind: 'stop', reason: `holding ${pack.feathers} feathers, the target was ${feathersTarget}` };
    }
    if (!pack.inVillage) {
        return { kind: 'travel' };
    }
    if (pack.hutDue) {
        return pack.fish > 0 ? { kind: 'sell' } : { kind: 'gear' };
    }
    if (!pack.tellerSeen && (pack.free === 0 || !pack.rod || pack.feathers === 0)) {
        return { kind: 'bank' };
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

// Why: the river, Fernahei's counter and the teller all sit inside this, and a run started anywhere else walks in before it does anything.
/** The village, wide enough to hold the river stretch, the hut and the bank. */
export const VILLAGE = { minX: 2814, maxX: 2884, minZ: 2938, maxZ: 2990 } as const;

/** The tile the walk in aims at: the bank, which is where a rod comes from. */
export const VILLAGE_ARRIVAL = new Tile(2852, 2954, 0);

export function inVillage(t: { x: number; z: number; level: number } | null): boolean {
    return t !== null && t.level === 0
        && t.x >= VILLAGE.minX && t.x <= VILLAGE.maxX
        && t.z >= VILLAGE.minZ && t.z <= VILLAGE.maxZ;
}

export interface SpotLike {
    tile(): { x: number; z: number };
}

/** The village-side bank tile for a spot on one of the known river tiles, or null when it sits where no bank reaches. */
export function standFor(spot: { x: number; z: number }): Tile | null {
    return standEntry(spot)?.stand ?? null;
}

/** The table row for a spot tile, which carries whether its stand is across the water. */
export function standEntry(spot: { x: number; z: number }): SpotStand | null {
    return SPOT_STANDS.find(s => s.spot.x === spot.x && s.spot.z === spot.z) ?? null;
}

const cheb = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

/** True for a tile inside the stretch of river the search covers. */
export function inArea(t: { x: number; z: number }): boolean {
    return t.x >= SEARCH_AREA.minX && t.x <= SEARCH_AREA.maxX && t.z >= SEARCH_AREA.minZ && t.z <= SEARCH_AREA.maxZ;
}

// Why: the walk round to the far bank is 74 to 90 against 14 to 56 along the village one, so any spot on our side beats every spot across the water however close that one looks in a straight line, and an unknown tile is treated as across it.
/** The spot to fish and the tile to stand on: this bank first, then the shortest walk; `fallback` names a stand for a spot tile the table does not know. */
export function nearestFishable<T extends SpotLike>(
    spots: readonly T[],
    here: { x: number; z: number },
    fallback: (spot: T) => Tile | null = () => null
): { spot: T; stand: Tile; far: boolean } | null {
    let best: { spot: T; stand: Tile; far: boolean } | null = null;
    for (const spot of spots) {
        if (!inArea(spot.tile())) {
            continue;
        }
        const known = standEntry(spot.tile());
        const stand = known?.stand ?? fallback(spot);
        if (!stand) {
            continue;
        }
        const far = known ? known.far === true : true;
        const better = !best
            || (best.far !== far ? !far : cheb(stand, here) < cheb(best.stand, here));
        if (better) {
            best = { spot, stand, far };
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
