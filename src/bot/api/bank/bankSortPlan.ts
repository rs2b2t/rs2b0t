import { CATEGORY_ORDER, categoryOf, isUnmatched, type BankCategory, type SortableItem } from './bankSortRules.js';

export type BankSortMode = 'swap' | 'insert';

export interface PlanOptions {
    overrides?: ReadonlyMap<number, BankCategory>;
    force?: BankSortMode;
}

export interface BankMove {
    from: number;
    to: number;
}

export interface BankSortPlan {
    mode: BankSortMode;
    moves: BankMove[];
    layout: number[];
    unmatched: number[];
}

export function longestIncreasingSubsequence(values: readonly number[]): number[] {
    if (values.length === 0) {
        return [];
    }

    const tails: number[] = [];
    const prev = new Array<number>(values.length).fill(-1);
    for (let i = 0; i < values.length; i++) {
        let lo = 0;
        let hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (values[tails[mid]] < values[i]) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        if (lo > 0) {
            prev[i] = tails[lo - 1];
        }
        tails[lo] = i;
    }

    const out: number[] = [];
    for (let i = tails[tails.length - 1]; i !== -1; i = prev[i]) {
        out.push(values[i]);
    }
    return out.reverse();
}

/** Insert takes the post-removal index, which is what `@insert_bank` produces in both directions. */
export function applyMove(order: readonly number[], move: BankMove, mode: BankSortMode): number[] {
    const next = [...order];
    if (mode === 'swap') {
        [next[move.from], next[move.to]] = [next[move.to], next[move.from]];
        return next;
    }

    const [item] = next.splice(move.from, 1);
    next.splice(move.to, 0, item);
    return next;
}

function planSwaps(targetOf: readonly number[]): BankMove[] {
    const moves: BankMove[] = [];
    const at = [...targetOf];
    const slotOf = new Array<number>(at.length);
    at.forEach((target, slot) => {
        slotOf[target] = slot;
    });

    for (let want = 0; want < at.length; want++) {
        if (at[want] === want) {
            continue;
        }
        const from = slotOf[want];
        const displaced = at[want];
        moves.push({ from, to: want });
        at[want] = want;
        at[from] = displaced;
        slotOf[want] = want;
        slotOf[displaced] = from;
    }

    return moves;
}

function planInserts(targetOf: readonly number[]): BankMove[] {
    const anchors = new Set(longestIncreasingSubsequence(targetOf));
    const settled = new Set(anchors);
    const moves: BankMove[] = [];
    let order = [...targetOf];

    for (let want = 0; want < targetOf.length; want++) {
        if (anchors.has(want)) {
            continue;
        }

        const from = order.indexOf(want);
        const rest = order.filter((_, i) => i !== from);
        let to = 0;
        rest.forEach((value, i) => {
            if (settled.has(value) && value < want) {
                to = i + 1;
            }
        });

        if (to !== from) {
            moves.push({ from, to });
        }
        rest.splice(to, 0, want);
        order = rest;
        settled.add(want);
    }

    return moves;
}

/** Requires dense slots 0..n-1, which the server guarantees by compacting the bank on open. */
export function planBankSort(items: readonly SortableItem[], opts: PlanOptions = {}): BankSortPlan {
    const rankOf = (item: SortableItem): number =>
        CATEGORY_ORDER.indexOf(opts.overrides?.get(item.id) ?? categoryOf(item));

    const compare = (a: SortableItem, b: SortableItem): number => {
        const byCategory = rankOf(a) - rankOf(b);
        if (byCategory !== 0) {
            return byCategory;
        }
        if (a.cost !== b.cost) {
            return b.cost - a.cost;
        }
        return a.id - b.id;
    };

    const current = [...items].sort((a, b) => a.slot - b.slot);
    if (!current.every((item, i) => item.slot === i)) {
        return { mode: 'swap', moves: [], layout: current.map(i => i.id), unmatched: [] };
    }

    const ranked = [...current].sort(compare);
    const targetIndex = new Map<number, number>();
    ranked.forEach((item, index) => targetIndex.set(item.slot, index));
    const targetOf = current.map(item => targetIndex.get(item.slot)!);

    const swaps = planSwaps(targetOf);
    const inserts = planInserts(targetOf);
    const useInsert = opts.force ? opts.force === 'insert' : inserts.length < swaps.length;

    return {
        mode: useInsert ? 'insert' : 'swap',
        moves: useInsert ? inserts : swaps,
        layout: ranked.map(item => item.id),
        unmatched: current.filter(item => !opts.overrides?.has(item.id) && isUnmatched(item)).map(item => item.id)
    };
}
