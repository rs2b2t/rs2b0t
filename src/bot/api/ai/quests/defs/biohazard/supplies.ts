import type { QuestSnapshot, QuestStep } from '../../engine/types.js';
import { BIO_ITEM, BIO_TILE, banked, held, owned, type BioItem } from './areas.js';

/** Slots free before Elena's four-item hand-back is safe; she drops nothing that will not fit. */
export const HANDBACK_SLOTS = 6;

/** How much food the module carries into West Ardougne when the bank has any. */
export const FOOD_CARRY = 5;

export const FOOD = { id: 379, name: 'Lobster' } as const satisfies BioItem;

const KEEP_IDS: readonly number[] = [
    ...Object.values(BIO_ITEM).map(item => item.id),
    FOOD.id
];

export function scanBank(): QuestStep {
    return { kind: 'scanBank' };
}

export function withdraw(items: { name: string; id: number; qty: number }[]): QuestStep {
    return { kind: 'withdraw', items };
}

// Why: the cupboard, the crate and the chemist all gate their re-issue on `obj_gettotal`, which
// counts the bank — so a banked copy has to come out rather than be fetched again.

/** Withdraw a quest item the bank is holding, or null when it is not banked. */
export function reclaim(snap: QuestSnapshot, item: BioItem, qty = 1): QuestStep | null {
    if (held(snap, item) >= qty) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const stock = banked(snap, item);
    if (stock <= 0) {
        return null;
    }
    return withdraw([{ name: item.name, id: item.id, qty: Math.min(qty - held(snap, item), stock) }]);
}

// Why: the float is drawn beside the Ardougne booth on the distraction leg, so the walk from Rimmington to Thessalia is one leg rather than a detour to whichever bank is nearest Rimmington.
// Why: a draw is much larger than the trigger, or the sixty coins spent on the way to the chemist put the purse back under the threshold and buy a second bank trip.

/** What a draw takes out; the suit itself is ten. */
const PURSE = 1000;

/** Coins for Thessalia. `blocking` waits when the bank has none; otherwise it lets the leg run on. */
export function sourceCoins(snap: QuestSnapshot, floor: number, blocking = true): QuestStep | null {
    if (held(snap, BIO_ITEM.COINS) >= floor) {
        return null;
    }
    if (!snap.bankKnown) {
        return scanBank();
    }
    const available = banked(snap, BIO_ITEM.COINS);
    if (available <= 0) {
        return blocking ? { kind: 'wait', reason: 'no coins banked for the priest gown' } : null;
    }
    return withdraw([{ name: BIO_ITEM.COINS.name, id: BIO_ITEM.COINS.id, qty: Math.min(PURSE, available) }]);
}

/** A few lobsters for the mourner, when the bank has them. Never blocks. */
export function sourceFood(snap: QuestSnapshot): QuestStep | null {
    if (held(snap, FOOD) > 0 || !snap.bankKnown || banked(snap, FOOD) <= 0) {
        return null;
    }
    return withdraw([{ name: FOOD.name, id: FOOD.id, qty: Math.min(FOOD_CARRY, banked(snap, FOOD)) }]);
}

/** Bank everything this quest does not need, so Elena's hand-back has somewhere to land. */
export function tidy(snap: QuestSnapshot, floor: number): QuestStep | null {
    if ((snap.freeSlots ?? 28) >= floor) {
        return null;
    }
    return { kind: 'deposit', keep: [], keepIds: KEEP_IDS, bank: BIO_TILE.ARDOUGNE_BANK };
}

export function ownsAll(snap: QuestSnapshot, items: readonly BioItem[]): boolean {
    return items.every(item => owned(snap, item) > 0);
}
