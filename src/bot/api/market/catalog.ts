import { reader, type ObjRecord } from '../../adapter/ClientAdapter.js';
import { UNTRADEABLE_IDS } from '../../data/untradeable.js';

export interface Catalog {
    byId: Map<number, ObjRecord>;
    /** unnoted id -> noted id */
    notedOf: Map<number, number>;
    /** noted id -> unnoted id */
    unnotedOf: Map<number, number>;
    /** unnoted entries only, name-sorted */
    items: ObjRecord[];
}

// Why: players type "maple longbow u", so punctuation cannot separate them from "Maple longbow (u)".
function key(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const UNTRADEABLE = new Set(UNTRADEABLE_IDS);

/** Whether the content lets this obj cross a trade window at all. */
export function tradeable(id: number): boolean {
    return !UNTRADEABLE.has(id);
}

// Why: every piece of ammunition has a poisoned twin, and fire arrows are a lighting step rather than stock,
// Why: so listing them multiplies the shelf with rows nobody trades in bulk. Poisoned MELEE weapons are not in
// Why: this, because a dragon dagger(p) is an item people buy on purpose rather than a variant of one.
const SIDE_VARIANT = /(arrow|bolt|dart|javelin|knife)s?\(p\)$|fire arrows?$|^(un)?lit arrows?$/i;

/** Whether an item is one a shop would carry, rather than a variant of one it already does. */
export function worthStocking(name: string): boolean {
    return !SIDE_VARIANT.test(name.trim());
}

export function buildCatalog(records: readonly ObjRecord[]): Catalog {
    const byId = new Map<number, ObjRecord>();
    const notedOf = new Map<number, number>();
    const unnotedOf = new Map<number, number>();
    const items: ObjRecord[] = [];

    for (const r of records) {
        byId.set(r.id, r);
        if (r.certtemplate !== -1 && r.certlink !== -1) {
            notedOf.set(r.certlink, r.id);
            unnotedOf.set(r.id, r.certlink);
        } else if (r.stackVariant !== true && tradeable(r.id) && worthStocking(r.name)) {
            // Why: pile-size models and anything the content will not let through a trade window stay reachable
            // Why: by id, they are not offered as items to put in a book.
            items.push(r);
        }
    }

    items.sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
    return { byId, notedOf, unnotedOf, items };
}

export function unnotedId(cat: Catalog, id: number): number {
    return cat.unnotedOf.get(id) ?? id;
}

export function notedId(cat: Catalog, id: number): number | null {
    return cat.notedOf.get(id) ?? null;
}

export function searchCatalog(cat: Catalog, query: string, limit = 50): ObjRecord[] {
    const q = key(query);
    const hits = q.length === 0 ? cat.items : cat.items.filter(r => key(r.name).includes(q));
    return hits.slice(0, limit);
}

/** Narrow a name collision to the strung or the unstrung half. */
// Why: every bow shares its display name with its unstrung twin, and the only thing separating them in the client's data is that the strung one can be worn.
function preferWorn(matches: readonly ObjRecord[], unstrung: boolean): ObjRecord[] {
    if (matches.length < 2) {
        return [...matches];
    }
    const wanted = matches.filter(r => r.equippable !== unstrung);
    return wanted.length === 1 ? wanted : [...matches];
}

/** Exact match, forgiving a plural. */
// Why: people ask for "1k maple longbows", and the item is called "Maple longbow".
function exactish(cat: Catalog, q: string): ObjRecord[] {
    const hit = cat.items.filter(r => key(r.name) === q);
    if (hit.length > 0 || !q.endsWith('s')) {
        return hit;
    }
    const singular = q.slice(0, -1);
    return cat.items.filter(r => key(r.name) === singular);
}

export function resolveByName(cat: Catalog, query: string, opts: { exactOnly?: boolean } = {}): ObjRecord[] {
    const byId = /^#(\d+)$/.exec(query.trim());
    if (byId) {
        const hit = cat.items.find(r => r.id === Number(byId[1]));
        return hit ? [hit] : [];
    }

    const q = key(query);
    if (q.length === 0) {
        return [];
    }

    const exact = exactish(cat, q);
    if (exact.length > 0) {
        return preferWorn(exact, false);
    }

    // "maple longbow u" is the unstrung "Maple longbow".
    const trailingU = /^(.+) u$/.exec(q);
    if (trailingU) {
        const base = exactish(cat, trailingU[1]);
        if (base.length > 0) {
            return preferWorn(base, true);
        }
    }

    if (opts.exactOnly) {
        return [];
    }
    return preferWorn(cat.items.filter(r => key(r.name).includes(q)), false);
}

let live: Catalog | null = null;

/** Built once per session from the adapter scan. */
export function liveCatalog(): Catalog {
    if (live === null || live.items.length === 0) {
        live = buildCatalog(reader.objCatalog());
    }
    return live;
}

/** Test seam, and a relogin onto a different world. */
export function resetLiveCatalog(): void {
    live = null;
}
