import { clientName, displayName, notedId, tradeable, unnotedId, type Catalog } from '../../api/market/catalog.js';
import { rowOf, type PriceBook } from '../../api/market/priceBook.js';
import { resolvePrices, rowValid } from '../../api/market/prices.js';

export const COINS = 995;
export const PACK = 28;

export interface Sellable {
    /** The unnoted obj id, the book's key. */
    id: number;
    /** The client's own name, what a withdraw or an offer clicks by. */
    name: string;
    /** The name the maker speaks, what its chat lines are matched against. */
    displayName: string;
    notedId: number | null;
    count: number;
    /** What the maker pays a unit. */
    each: number;
}

/** The items the maker's book buys among these, noted stacks folded onto their row, most valuable line first. */
export function sellables(items: readonly { id: number; count: number }[], book: PriceBook, cat: Catalog): Sellable[] {
    const counts = new Map<number, number>();
    for (const item of items) {
        const id = unnotedId(cat, item.id);
        if (id === COINS || !tradeable(id)) {
            continue;
        }
        counts.set(id, (counts.get(id) ?? 0) + Math.max(1, item.count));
    }
    const out: Sellable[] = [];
    for (const [id, count] of counts) {
        const row = rowOf(book, id);
        const name = clientName(cat, id);
        if (!row || !row.buying || !rowValid(book, row) || name === undefined) {
            continue;
        }
        out.push({ id, name, displayName: displayName(cat, id), notedId: notedId(cat, id), count, each: resolvePrices(book, row).buy });
    }
    return out.sort((a, b) => b.count * b.each - a.count * a.each);
}

export type PileLine = Sellable;

// Why: a noted stack is one slot whatever its size and an unnotable item is a slot a unit, and the maker bids its ceiling for a pile worth more than it, so the pile stops at the cap and the free slots, whichever comes first.
/** The lines a trip carries, sized under `cap` gp and `slots` pack slots. */
export function planPile(list: readonly Sellable[], cap: number, slots = PACK): PileLine[] {
    const out: PileLine[] = [];
    let gp = cap;
    let room = slots;
    for (const s of list) {
        if (room < 1 || gp < 1) {
            break;
        }
        let n = Math.min(s.count, Math.floor(gp / s.each));
        if (s.notedId === null) {
            n = Math.min(n, room);
        }
        if (n < 1) {
            continue;
        }
        out.push({ ...s, count: n });
        gp -= n * s.each;
        room -= s.notedId === null ? n : 1;
    }
    return out;
}

export function pileValue(lines: readonly PileLine[]): number {
    return lines.reduce((sum, l) => sum + l.count * l.each, 0);
}

export type MakerNote = { kind: 'ceiling'; gp: number } | { kind: 'ignored'; count: number; name: string };

/** What a public line from the maker says about the pile, or null for anything else it says. */
export function parseMakerLine(text: string): MakerNote | null {
    const ceiling = /^max I can offer is ([\d,]+)gp per trade/i.exec(text);
    if (ceiling) {
        return { kind: 'ceiling', gp: Number(ceiling[1]!.replace(/,/g, '')) };
    }
    const ignored = /^(\d+) (.+?): not counted, keep them\.?$/i.exec(text);
    if (ignored) {
        return { kind: 'ignored', count: Number(ignored[1]), name: ignored[2]! };
    }
    return null;
}

export type Step = { kind: 'trade' } | { kind: 'approach' } | { kind: 'bank' };

/** One step per loop: an open window is owned first, a priced pile goes to the maker, an empty pack goes to the bank. */
export function decide(state: { tradeActive: boolean; pileValue: number }): Step {
    if (state.tradeActive) {
        return { kind: 'trade' };
    }
    return state.pileValue > 0 ? { kind: 'approach' } : { kind: 'bank' };
}

export interface Adaptation {
    cap: number;
    /** Display names the maker will not count, to drop from the pile. */
    drop: string[];
    /** The maker counted nothing and said nothing, so every line of the pile goes. */
    dropAll: boolean;
}

/** How the next pile changes after the maker offered less than the pile is worth. */
export function adapt(opts: { cap: number; offered: number; notes: readonly MakerNote[] }): Adaptation {
    const drop = opts.notes.filter((n): n is Extract<MakerNote, { kind: 'ignored' }> => n.kind === 'ignored').map(n => n.name);
    const ceiling = opts.notes.find((n): n is Extract<MakerNote, { kind: 'ceiling' }> => n.kind === 'ceiling');
    if (ceiling) {
        return { cap: Math.min(opts.cap, ceiling.gp), drop, dropAll: false };
    }
    if (drop.length > 0) {
        return { cap: opts.cap, drop, dropAll: false };
    }
    if (opts.offered > 0) {
        return { cap: Math.min(opts.cap, opts.offered), drop, dropAll: false };
    }
    return { cap: opts.cap, drop, dropAll: true };
}

export type AcceptAction = 'accept' | 'wait' | 'done';

// Why: the offer screen shuts a tick before the confirm opens, so a single read of "no window" is the handover rather than the end, and treating it as the end leaves the confirm screen unaccepted and the goods staked.
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
