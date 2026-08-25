import { reader, type ObjRecord } from '../../adapter/ClientAdapter.js';

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
        } else {
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

export function resolveByName(cat: Catalog, query: string): ObjRecord[] {
    const byId = /^#(\d+)$/.exec(query.trim());
    if (byId) {
        const hit = cat.items.find(r => r.id === Number(byId[1]));
        return hit ? [hit] : [];
    }

    const q = key(query);
    if (q.length === 0) {
        return [];
    }

    const exact = cat.items.filter(r => key(r.name) === q);
    if (exact.length > 0) {
        return preferWorn(exact, false);
    }

    // "maple longbow u" is the unstrung "Maple longbow".
    const trailingU = /^(.+) u$/.exec(q);
    if (trailingU) {
        const base = cat.items.filter(r => key(r.name) === trailingU[1]);
        if (base.length > 0) {
            return preferWorn(base, true);
        }
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
