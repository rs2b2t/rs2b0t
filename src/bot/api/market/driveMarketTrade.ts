import { unnotedId, type Catalog } from './catalog.js';
import type { OfferItem } from './quote.js';

/** Merge a trade side onto unnoted ids, so noted and unnoted of one row count together. */
export function normaliseOffer(cat: Catalog, items: readonly OfferItem[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const item of items) {
        const id = unnotedId(cat, item.id);
        out.set(id, (out.get(id) ?? 0) + Math.max(1, item.count));
    }
    return out;
}

/** Exact by id and count, with nothing extra on either side. */
// Why: the confirm screen is checked against what was accepted, so "close enough" is how a swapped offer gets through.
export function offersMatch(actual: ReadonlyMap<number, number>, expected: ReadonlyMap<number, number>): boolean {
    if (actual.size !== expected.size) {
        return false;
    }
    for (const [id, count] of expected) {
        if (actual.get(id) !== count) {
            return false;
        }
    }
    return true;
}
