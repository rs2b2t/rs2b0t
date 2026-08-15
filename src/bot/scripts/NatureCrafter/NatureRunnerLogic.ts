import Tile from '../../geometry/Tile.js';

export const TRADE_CAP = 25; // max essence offered per trade; the store-visit target
export const BUY_ONLY_STOCK = 30; // shop stock above which the runner only buys (drain mode)
export const LOW_COINS = 1000; // coin floor: below it, bank instead of shopping
export const PICKUP_RANGE = 20; // max tiles to chase a dropped noted stack
export const STORE_PASSES = 6; // bound on plan/act passes per store visit

// a restock must leave enough over the floor to pay the fares + a buy-back, or the runner
// drops back under LOW_COINS on the way out and ping-pongs between bank and boat
export const MIN_COIN_TARGET = 3000;

export interface RuneType {
    talisman: string;
    rune: string;
    level: number;
    ruins: Tile; // the Mysterious ruins — altar entrance for the master, trade spot for both
    runnerBank: Tile;
    masterBank: Tile;
    // set when the bank is too far to carry unnoted: the runner banks a NOTE and un-notes here.
    // null = short bank<->altar hop, so it carries unnoted essence (no store, no fares, no ship)
    unnote: { npc: string; tile: Tile } | null;
}

export const RUNES: Record<string, RuneType> = {
    'Nature runes': {
        talisman: 'Nature talisman', rune: 'Nature rune', level: 44,
        ruins: new Tile(2865, 3022, 0),
        runnerBank: new Tile(2655, 3283, 0), // Ardougne East, by Captain Barnaby's pier
        masterBank: new Tile(2852, 2954, 0), // Shilo Village (needs the Shilo Village quest)
        unnote: { npc: 'Jiminua', tile: new Tile(2767, 3122, 0) } // Jiminua's Jungle Store, Karamja
    },
    'Air runes': {
        talisman: 'Air talisman', rune: 'Air rune', level: 1,
        ruins: new Tile(2983, 3288, 0), // south of Falador
        runnerBank: new Tile(3013, 3355, 0), // Falador East
        masterBank: new Tile(3013, 3355, 0),
        unnote: null
    }
};
export const RUNE_OPTIONS = Object.keys(RUNES);
export const DEFAULT_RUNE = 'Nature runes';

type StoreStep = { op: 'buy' | 'sell'; n: number } | { op: 'done' };

export function coinTargetFor(setting: number): number {
    return Math.max(MIN_COIN_TARGET, Math.floor(setting) || 0);
}

export function planStoreStep(stock: number, noted: number, unnoted: number): StoreStep {
    const need = TRADE_CAP - unnoted;
    if (need <= 0) {
        return { op: 'done' };
    }
    if (stock > BUY_ONLY_STOCK) {
        return { op: 'buy', n: need };
    }
    const toSell = Math.min(noted, Math.max(0, need - stock));
    if (toSell > 0) {
        return { op: 'sell', n: toSell };
    }
    if (stock > 0) {
        return { op: 'buy', n: Math.min(need, stock) };
    }
    return { op: 'done' };
}

export function offerCount(unnoted: number): number {
    return Math.max(0, Math.min(TRADE_CAP, unnoted));
}

// Short route only. A trade window moves at most TRADE_CAP, so anything carried beyond it
// buys the master a second altar round trip for the remainder — cap it however big withdrawEss is.
export function shortRouteWithdraw(perSetting: number, banked: number, room: number): number {
    const want = perSetting > 0 ? Math.min(perSetting, TRADE_CAP) : TRADE_CAP;
    return Math.max(0, Math.min(want, banked, room > 0 ? room : TRADE_CAP));
}
