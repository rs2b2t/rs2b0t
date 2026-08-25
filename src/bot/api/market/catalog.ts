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

// Why: the strung and unstrung maple longbow are both named "Maple longbow" with nothing else to tell them apart, so `#62` is the only handle a player can type.
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
    return exact.length > 0 ? exact : cat.items.filter(r => key(r.name).includes(q));
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
