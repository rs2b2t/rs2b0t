import Tile from '../api/Tile.js';

export const FLAX_FIELD = new Tile(2741, 3444, 0);
export const FLAX_GATE = new Tile(2736, 3443, 0);
export const SPINNING_WHEEL_AREA = new Tile(2711, 3471, 1);
export const BANK_ENTRANCE = new Tile(2726, 3487, 0);
export const BANK_STAND = new Tile(2725, 3493, 0);
/** Walkable stand tile inside the wheel house beside the ladder. */
export const LADDER_TILE = new Tile(2714, 3471, 0);
/**
 * Runner↔Spinner handoff tile — outside the wheel house, a few tiles east of the
 * east-wall door at (2716,3472). Meeting inside meant a closed door left partners
 * "at meet" (LEASH) but unable to trade or path through.
 */
export const MEET_TILE = new Tile(2719, 3471, 0);

export const TRADE_RANGE = 2;

/** Min delay between Trade.request attempts (game ticks). */
export const TRADE_REQUEST_COOLDOWN_TICKS = 9;

/** After a trade closes with no flax moved, back off longer before re-requesting. */
export const TRADE_FAIL_COOLDOWN_TICKS = 14;

/** @deprecated Prefer {@link TRADE_REQUEST_COOLDOWN_TICKS}. */
export const TRADE_REQUEST_COOLDOWN_MS = TRADE_REQUEST_COOLDOWN_TICKS * 600;

/** @deprecated Prefer {@link TRADE_FAIL_COOLDOWN_TICKS}. */
export const TRADE_FAIL_COOLDOWN_MS = TRADE_FAIL_COOLDOWN_TICKS * 600;

export const FLAX = 'Flax';

/** Configured partner name matches trade-header / player display name (case-insensitive). */
export function partnerNameMatches(configured: string, seen: string | null | undefined): boolean {
    if (!configured || !seen) {
        return false;
    }
    return configured.trim().toLowerCase() === seen.trim().toLowerCase();
}

/** Total flax units on a trade offer side (stacks use count). */
export function flaxUnitsInOffer(items: readonly { name: string | null; count: number }[]): number {
    let n = 0;
    for (const o of items) {
        if ((o.name ?? '').toLowerCase() === FLAX.toLowerCase()) {
            n += Math.max(1, o.count);
        }
    }
    return n;
}

/**
 * Spinner must bank before handoff when the pack is not empty of non-flax
 * (bow strings, random-event junk). A full runner pack cannot land if the
 * spinner only has a few free slots — trade fails and both sides re-request.
 */
export function spinnerNeedsClearPack(flaxHeld: number, slotsUsed: number): boolean {
    return flaxHeld === 0 && slotsUsed > 0;
}

/** True if free inventory slots can hold `units` of offered flax (1 slot per stack item in trade). */
export function canReceiveFlaxOffer(freeSlots: number, offeredFlaxUnits: number): boolean {
    // Flax stacks in trade still need one free slot per offered stack line; a full
    // runner pack is typically one stack ≤28. Require freeSlots >= 1 when any flax
    // is offered, and freeSlots >= offered units when they would not stack (we
    // treat needed slots as min(offered, free needed for one stack) = 1 if free>0
    // for a single stack). Safest for 2004 one-stack offers: need freeSlots >= 1
    // for a stack that merges into empty inv, but if inv has partial flax stack
    // free can be 0 and still receive into existing stack — spinner should be
    // empty of flax at handoff (flaxHeld===0), so one free slot receives one stack.
    if (offeredFlaxUnits <= 0) {
        return true;
    }
    return freeSlots >= 1;
}

export const BOW_STRING = 'Bow string';
export const SPINNING_WHEEL = 'Spinning wheel';
export const SPIN_OP = 'Spin';
export const PICK_OP = 'Pick';
export const BOOTH_NAME = 'Bank booth';
export const LADDER_NAME = 'Ladder';
export const CLIMB_UP = 'Climb-up';
export const CLIMB_DOWN = 'Climb-down';

export const FIELD_SCOPE = 12;
export const FIELD_ARRIVE = 3;

/** Prefer flax within this Chebyshev distance before considering farther plants. */
export const LOCAL_PICK_RADIUS = 4;
/** Reachable-tile BFS cap when detecting a flax enclosure. */
export const POCKET_CAP = 40;
/** Flax to drop so we can pick a path through solid plants. */
export const CARVE_DROP = 5;
