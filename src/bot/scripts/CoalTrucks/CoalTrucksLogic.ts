import Tile from '../../geometry/Tile.js';

export const COAL = 'Coal';
export const TRUCK_LOC = 'Coal Truck';
export const REMOVE_OP = 'Remove-coal';
export const ROCK_LOC = 'Rocks';
export const MINE_OP = 'Mine';

export const TRUCK_MAX = 120;
export const COAL_MINING_LEVEL = 30;
export const COAL_ROCK_IDS: readonly number[] = [2096, 2097];

/** The truck line runs east across the river; the far-bank trucks are a 245-cost detour. */
export const TRUCK_LEASH = 4;

/** Anything inside this of the anchor counts as the working area: rocks, truck stand, walk slop. */
export const MINE_AREA = 20;

// Why: a 120 truck drains in 4 full packs plus a ~12 remainder, and that last 102-tile round trip for 12 coal is poor value.
// Why: the remainder is not lost — it stays in the truck and the miner tops it up next cycle.
// Why: measured per cycle, 4 pulls banks 135 over 720 tiles and 5 pulls banks 147 over 822.

/** Pulls per haul before heading back. */
export const MAX_PULLS_PER_HAUL = 4;

export const MINE_ANCHOR = new Tile(2582, 3481, 0);
export const MINE_TRUCK = new Tile(2574, 3487, 0);
export const MINE_TRUCK_STAND = new Tile(2575, 3486, 0);
export const SEERS_TRUCK = new Tile(2696, 3504, 0);
export const SEERS_TRUCK_STAND = new Tile(2695, 3503, 0);
export const SEERS_BANK = new Tile(2725, 3491, 0);

/** Click-to-swing only. The server starts the animation within a tick or two. */
export const MINE_START_MS = 3000;

/** Backstop for a swing that neither yields nor ends. Never the normal path. */
export const MINE_STALL_MS = 20_000;

export type Phase = 'fill' | 'run' | 'drain';

// Why: the swing has not begun yet on the tick the wait starts, so it takes two stages.

/** Stage of a mining swing wait. */
type MineStage = 'start' | 'sustain';

export interface MineView {
    gained: boolean;
    packFull: boolean;
    animating: boolean;
    /** Random event pending or a dialog open — either way, stop mining and yield. */
    interrupted: boolean;
}

export function mineWaitDone(stage: MineStage, view: MineView): boolean {
    if (view.gained || view.packFull || view.interrupted) {
        return true;
    }
    return stage === 'start' ? view.animating : !view.animating;
}

export type DepositResult = 'all' | 'partial' | 'full' | 'wrong-item' | 'none';
export type RemoveResult = 'all' | 'partial' | 'empty' | 'no-space' | 'none';

export type Action =
    | { kind: 'mine' }
    | { kind: 'await-rocks' }
    | { kind: 'deposit' }
    | { kind: 'travel-to-seers' }
    | { kind: 'remove' }
    | { kind: 'bank' }
    | { kind: 'travel-to-mine' };

export interface WorldView {
    phase: Phase;
    packFull: boolean;
    coalHeld: number;
    rockAvailable: boolean;
    truckEmpty: boolean;
    truckFull: boolean;
    pullsThisHaul: number;
    hasPickaxe: boolean;
    atMine: boolean;
}

const DEPOSIT_PATTERNS: readonly [RegExp, DepositResult][] = [
    [/^you put some of the coal in the truck/i, 'partial'],
    [/^you put the coal in the truck/i, 'all'],
    [/^the coal truck is full/i, 'full'],
    [/isn't meant to transport/i, 'wrong-item']
];

const REMOVE_PATTERNS: readonly [RegExp, RemoveResult][] = [
    [/^you remove some of the coal from the truck/i, 'partial'],
    [/^you remove the coal from the truck/i, 'all'],
    [/^there is no coal left in the truck/i, 'empty'],
    [/enough inventory space/i, 'no-space']
];

function classify<T>(lines: readonly string[], patterns: readonly [RegExp, T][], none: T): T {
    for (const line of lines) {
        for (const [pattern, result] of patterns) {
            if (pattern.test(line.trim())) {
                return result;
            }
        }
    }

    return none;
}

export function classifyDeposit(lines: readonly string[]): DepositResult {
    return classify(lines, DEPOSIT_PATTERNS, 'none');
}

export function classifyRemove(lines: readonly string[]): RemoveResult {
    return classify(lines, REMOVE_PATTERNS, 'none');
}

export function truckFullAfterDeposit(result: DepositResult): boolean {
    return result === 'partial' || result === 'full';
}

export function truckEmptyAfterRemove(result: RemoveResult): boolean {
    return result === 'all' || result === 'empty';
}

export function decide(view: WorldView): Action {
    // Mining without a pickaxe fails silently — no message, no xp — so this outranks
    // every phase. The bank is the only place to fix it.
    if (!view.hasPickaxe) {
        return { kind: 'bank' };
    }

    // Why: the truck is capped when the run starts, so the carried pack cannot go into it.
    // Why: banking on the way in beats touching the truck first and doubling back — mine->bank is 156, mine->truck->bank is 196.
    if (view.phase === 'run') {
        return view.coalHeld > 0 ? { kind: 'bank' } : { kind: 'travel-to-seers' };
    }

    if (view.phase === 'drain') {
        if (view.coalHeld > 0) {
            return { kind: 'bank' };
        }
        const spent = view.truckEmpty || view.pullsThisHaul >= MAX_PULLS_PER_HAUL;
        return spent ? { kind: 'travel-to-mine' } : { kind: 'remove' };
    }

    // A capped truck does not mean leave immediately: the haul costs the same six bank
    // hops whether the pack holds 17 or 27, so top it up first and the extra coal is free.
    if (view.truckFull) {
        if (view.atMine && !view.packFull && view.rockAvailable) {
            return { kind: 'mine' };
        }
        // Same reason as the run phase: the truck is capped, so what we carry cannot go
        // into it. Head for the bank, not the truck, or the walk in doubles back.
        return view.coalHeld > 0 ? { kind: 'bank' } : { kind: 'travel-to-seers' };
    }

    if (!view.atMine) {
        return { kind: 'travel-to-mine' };
    }

    if (view.packFull) {
        return { kind: 'deposit' };
    }

    return view.rockAvailable ? { kind: 'mine' } : { kind: 'await-rocks' };
}
