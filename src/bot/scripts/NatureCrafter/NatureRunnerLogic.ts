import Tile from '../../geometry/Tile.js';

export const TRADE_CAP = 25; // max essence offered per trade; the store-visit target
export const TRADE_ADJACENT = 2; // runner is "here"; the master still only clicks Trade at TRADE_NO_WALK
export const TRADE_NO_WALK = 1; // OPPLAYER4 walks if farther, and walking cancels the open trade
export const RUNNER_ASK_MS = 1800; // ~3 ticks: re-ask so a cancelled request is replaced before the master moves on
/** After the master clicks Trade-with, do not click again. A second click cancels the window. */
export const MASTER_HANDSHAKE_MS = 3000;
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
    ruins: Tile; // the Mysterious ruins, altar entrance for the master, trade spot for both
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

const ESSENCE_NAME = 'rune essence';
const COINS_NAME = 'coins';
/** Inventory puzzles RandomEvents Open/Rub. They have no Drop. DropLitter must not touch them. */
const EVENT_HELD = new Set(['strange box', 'lamp']);

/** Coins, noted/unnoted essence, talisman; master also keeps the rune it crafts. Nameless slots are litter. */
export function keepNames(talisman: string, productRune: string | null): string[] {
    const keep = [ESSENCE_NAME, COINS_NAME, talisman.toLowerCase()];
    if (productRune) {
        keep.push(productRune.toLowerCase());
    }
    return keep;
}

export function isEventHeld(name: string | null): boolean {
    return name != null && EVENT_HELD.has(name.toLowerCase());
}

export function isLitter(name: string | null, keep: readonly string[]): boolean {
    if (isEventHeld(name)) {
        return false;
    }
    if (name == null || name.trim() === '') {
        return true;
    }
    const n = name.toLowerCase();
    return !keep.some(k => k === n);
}

export function isDroppableLitter(name: string | null, keep: readonly string[], actions: readonly string[]): boolean {
    return isLitter(name, keep) && actions.some(a => a.toLowerCase() === 'drop');
}

/** Jungle-spider-safe hop between Jiminua and the nature ruins (#730). */
export const SPIDER_SAFE = new Tile(2790, 3094, 0);

export function isNear(a: { x: number; z: number }, b: { x: number; z: number }, radius: number): boolean {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z)) <= radius;
}

/**
 * Whether a nature-route walk to the store or ruins should stop at SPIDER_SAFE first.
 * Why: the direct Karamja line walks through Jungle Spiders (#730).
 */
export function spiderSafeVia(
    here: { x: number; z: number } | null,
    dest: { x: number; z: number },
    store: { x: number; z: number },
    ruins: { x: number; z: number }
): boolean {
    if (isNear(dest, store, 3) === false && isNear(dest, ruins, 3) === false) {
        return false;
    }
    if (here !== null && isNear(here, dest, 3)) {
        return false;
    }
    return here === null || !isNear(here, SPIDER_SAFE, 3);
}

/** True once unnoted essence has left the pack after a trade confirm (#730). */
export function tradeDelivered(beforeUnnoted: number, nowUnnoted: number): boolean {
    return nowUnnoted < beforeUnnoted;
}

/**
 * Walk to the ruins/altar only until the master is in sight.
 * Why: walkTo(ruins) after a missed trade pulls the runner off the master while essence is still in the pack.
 */
export type MasterOfferAction = 'wait' | 'accept' | 'decline';

/**
 * Master first-screen policy.
 * Why: declining a blank "Trading With" header after 8 ticks cancelled real runner offers (~6s close in the wall logs).
 */
export function masterOfferDecision(opts: {
    who: string | null;
    isPartner: boolean;
    theirEssence: number;
    runnerWaiting: boolean;
}): MasterOfferAction {
    if (opts.who !== null && !opts.isPartner) {
        return 'decline';
    }
    if (opts.theirEssence > 0 && (opts.isPartner || opts.runnerWaiting)) {
        return 'accept';
    }
    return 'wait';
}

/** True when the open trade header is the player we just clicked (blank header is still that click). */
export function tradeWindowIsFor(partnerHeader: string | null, clicked: string): boolean {
    if (partnerHeader === null || partnerHeader.length === 0) {
        return true;
    }
    return partnerHeader.toLowerCase() === clicked.toLowerCase();
}

/** Why: a second Trade-with click closes the window; only an ask after the last accept is still live. */
export function masterPickTradeTarget(opts: {
    asked: string | null;
    askedAt: number;
    lastAcceptAt: number;
    askedInRange: boolean;
    holdUntil: number;
    now: number;
}): string | null {
    if (opts.now < opts.holdUntil) {
        return null;
    }
    if (!opts.asked || !opts.askedInRange) {
        return null;
    }
    if (opts.askedAt <= opts.lastAcceptAt) {
        return null;
    }
    return opts.asked;
}

/** Runners re-ask on an interval; clicking every tick cancels the open window and every other runner's request. */
export function runnerShouldRequestTrade(tradeActive: boolean, lastRequestAt: number, now: number): boolean {
    if (tradeActive) {
        return false;
    }
    return now - lastRequestAt >= RUNNER_ASK_MS;
}

export function runnerMayLeaveAltar(tradeActive: boolean, unnoted: number): boolean {
    return !tradeActive && unnoted === 0;
}

export function runnerShouldWalkToMeet(
    masterVisible: boolean,
    alreadyMeeting: boolean,
    inTemple: boolean,
    stayInAltar: boolean
): boolean {
    if (stayInAltar && !inTemple) {
        return true;
    }
    if (masterVisible || alreadyMeeting) {
        return false;
    }
    return !inTemple;
}

export function masterShouldExitTemple(inTemple: boolean, ess: number, stayInAltar: boolean, bankDue: boolean): boolean {
    if (!inTemple || ess > 0) {
        return false;
    }
    return !stayInAltar || bankDue;
}

export function masterShouldEnterAltar(inTemple: boolean, ess: number, stayInAltar: boolean, bankDue: boolean): boolean {
    if (inTemple) {
        return false;
    }
    if (ess > 0) {
        return true;
    }
    // Why: stay-in-altar + bankDue used to portal out then talisman straight back in, never reaching the bank.
    return stayInAltar && !bankDue;
}

// Short route only. A trade window moves at most TRADE_CAP, so anything carried beyond it
// buys the master a second altar round trip for the remainder, cap it however big withdrawEss is.
export function shortRouteWithdraw(perSetting: number, banked: number, room: number): number {
    const want = perSetting > 0 ? Math.min(perSetting, TRADE_CAP) : TRADE_CAP;
    return Math.max(0, Math.min(want, banked, room > 0 ? room : TRADE_CAP));
}
