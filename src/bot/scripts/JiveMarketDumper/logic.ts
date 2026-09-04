import { clientName, displayName, notedId, tradeable, unnotedId, type Catalog } from '../../api/market/catalog.js';

export const COINS = 995;
export const PACK = 28;

export interface Dumpable {
    /** The unnoted obj id, which is how a bank row and a trade slot are matched. */
    id: number;
    /** The client's own name, what a withdraw or an offer clicks by. */
    name: string;
    /** The name the maker speaks, for the log and the paint. */
    displayName: string;
    notedId: number | null;
    count: number;
}

// Why: no price book and no valuation, the maker prices what it sees and whatever it will not pay for rides along; the only things held back are coins and what the engine refuses to trade.
/** Everything in these items a trade window can carry, noted rows folded onto their item, in name order. */
export function dumpables(items: readonly { id: number; count: number }[], cat: Catalog): Dumpable[] {
    const counts = new Map<number, number>();
    for (const item of items) {
        const id = unnotedId(cat, item.id);
        if (id === COINS || !tradeable(id)) {
            continue;
        }
        counts.set(id, (counts.get(id) ?? 0) + Math.max(1, item.count));
    }
    const out: Dumpable[] = [];
    for (const [id, count] of counts) {
        const name = clientName(cat, id);
        if (name === undefined) {
            continue;
        }
        out.push({ id, name, displayName: displayName(cat, id), notedId: notedId(cat, id), count });
    }
    return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

// Why: a noted stack is one slot however deep, so most banks go in a trip or two; an item with no noted form costs a slot a unit and is cut to what is left.
/** The lines one trip carries, filling `slots` pack slots from the top of the list. */
export function planPile(list: readonly Dumpable[], slots = PACK): Dumpable[] {
    const out: Dumpable[] = [];
    let room = slots;
    for (const d of list) {
        if (room < 1) {
            break;
        }
        if (d.notedId === null) {
            const n = Math.min(d.count, room);
            out.push({ ...d, count: n });
            room -= n;
            continue;
        }
        out.push({ ...d });
        room -= 1;
    }
    return out;
}

export type Step = { kind: 'trade' } | { kind: 'approach' } | { kind: 'bank' };

/** One step per loop: an open window is owned first, a loaded pack goes to the maker, an empty one goes to the bank. */
export function decide(state: { tradeActive: boolean; pile: number }): Step {
    if (state.tradeActive) {
        return { kind: 'trade' };
    }
    return state.pile > 0 ? { kind: 'approach' } : { kind: 'bank' };
}

export type AcceptAction = 'accept' | 'wait' | 'done';

// Why: the offer screen shuts a tick before the confirm opens, so a single read of "no window" is the handover rather than the end, and treating it as the end leaves the confirm unaccepted and the goods staked.
/** What to do with a trade being accepted, from the screens up and how long neither has been. */
export function acceptAction(view: { onOffer: boolean; onConfirm: boolean; deadTicks: number }, graceTicks = 3): AcceptAction {
    if (view.onOffer || view.onConfirm) {
        return 'accept';
    }
    return view.deadTicks > graceTicks ? 'done' : 'wait';
}

// Why: an offered item leaves the pack view, so a pile read from the pack alone reads as empty mid-window; the two sides together are what is still ours to sell.
/** The customer's own goods during a window: the pack plus what is already staked. */
export function heldWithOffer(
    pack: readonly { id: number; count: number }[],
    offer: readonly { id: number; count: number }[]
): { id: number; count: number }[] {
    const total = new Map<number, number>();
    for (const item of [...pack, ...offer]) {
        total.set(item.id, (total.get(item.id) ?? 0) + Math.max(1, item.count));
    }
    return [...total].map(([id, count]) => ({ id, count }));
}
