import { reader, type ObjRecord } from '../../adapter/ClientAdapter.js';
import { UNTRADEABLE_IDS } from '../../data/untradeable.js';
import { ITEM_ALIASES, NAME_SYNONYMS } from '../../data/itemAliases.js';
import { NAME_COLLISIONS } from '../../data/nameCollisions.js';
import type { ItemAlias } from './aliasTypes.js';

export interface Catalog {
    byId: Map<number, ObjRecord>;
    /** unnoted id -> noted id */
    notedOf: Map<number, number>;
    /** noted id -> unnoted id */
    unnotedOf: Map<number, number>;
    /** unnoted entries only, name-sorted */
    items: ObjRecord[];
    /** id -> the words that separate it from its same-named siblings, and the name to say back */
    aliases: Map<number, ItemAlias>;
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

function titled(name: string, word: string): string {
    return `${word.slice(0, 1).toUpperCase()}${word.slice(1)} ${name.toLowerCase()}`;
}

/** The derived words joined to the hand-written ones, hand-written winning. */
// Why: the debugname supplies blue, red and black for free; green, loop and tooth appear in no file, so they are written down.
function buildAliases(): Map<number, ItemAlias> {
    const out = new Map<number, ItemAlias>();
    for (const group of NAME_COLLISIONS) {
        for (const member of group.objs) {
            if (member.words.length > 0) {
                out.set(member.id, { words: member.words, label: titled(group.name, member.words[0]!) });
            }
        }
    }
    for (const [id, alias] of Object.entries(ITEM_ALIASES)) {
        out.set(Number(id), alias);
    }
    return out;
}

const ALIASES = buildAliases();
/** key(label) -> the ids answering to it. */
const BY_LABEL = new Map<string, number[]>();
/** Every word that narrows a repeated name to one obj. */
const ALIAS_WORDS = new Set<string>();
for (const [id, alias] of ALIASES) {
    const k = key(alias.label);
    BY_LABEL.set(k, [...(BY_LABEL.get(k) ?? []), id]);
    for (const word of alias.words) {
        ALIAS_WORDS.add(key(word));
    }
}
/** key(shorthand) -> key(display name). */
const SYNONYMS = new Map<string, string>(
    Object.entries(NAME_SYNONYMS).flatMap(([name, shorts]) => shorts.map(s => [key(s), key(name)] as const))
);

/** What the shop calls an obj, which is the plain name until the content repeats it. */
export function displayName(cat: Catalog, id: number): string {
    return cat.aliases.get(id)?.label ?? cat.byId.get(id)?.name ?? `item ${id}`;
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
    return { byId, notedOf, unnotedOf, items, aliases: ALIASES };
}

export function unnotedId(cat: Catalog, id: number): number {
    return cat.unnotedOf.get(id) ?? id;
}

export function notedId(cat: Catalog, id: number): number | null {
    return cat.notedOf.get(id) ?? null;
}

/** Whether the words name this obj, by its own name or by what the shop calls it. */
function named(cat: Catalog, r: ObjRecord, q: string): boolean {
    return key(r.name).includes(q) || key(displayName(cat, r.id)).includes(q);
}

export function searchCatalog(cat: Catalog, query: string, limit = 50): ObjRecord[] {
    const q = expandSynonyms(key(query));
    const hits = q.length === 0 ? cat.items : cat.items.filter(r => named(cat, r, q));
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

/** Swap "dhide" and the like for the display name they stand in for. */
function expandSynonyms(q: string): string {
    let out = q;
    for (const [short, full] of SYNONYMS) {
        const padded = ` ${out} `;
        const at = padded.indexOf(` ${short} `);
        if (at >= 0) {
            out = `${padded.slice(0, at)} ${full} ${padded.slice(at + short.length + 2)}`.replace(/\s+/g, ' ').trim();
        }
    }
    return out;
}

function withIds(cat: Catalog, ids: readonly number[]): ObjRecord[] {
    const want = new Set(ids);
    return cat.items.filter(r => want.has(r.id));
}

/** The name the shop would say back, spoken to it. */
function byLabel(cat: Catalog, q: string): ObjRecord[] {
    const direct = withIds(cat, BY_LABEL.get(q) ?? []);
    if (direct.length > 0 || !q.endsWith('s')) {
        return direct;
    }
    return withIds(cat, BY_LABEL.get(q.slice(0, -1)) ?? []);
}

/** Narrow a repeated name with the words the customer supplied. */
// Why: four objs are called "Dragonhide" and two are "Half of a key", so the colour or the half is the only thing separating them, and it never appears in the name.
function resolveAliased(cat: Catalog, q: string): ObjRecord[] {
    const spoken = byLabel(cat, q);
    if (spoken.length > 0) {
        return spoken;
    }

    const tokens = q.split(' ').filter(Boolean);
    const words = tokens.filter(t => ALIAS_WORDS.has(t));
    const rest = expandSynonyms(tokens.filter(t => !ALIAS_WORDS.has(t)).join(' '));
    if (rest.length === 0 || (words.length === 0 && rest === q)) {
        return [];
    }

    const base = exactish(cat, rest);
    if (base.length === 0 || words.length === 0) {
        return base;
    }
    return base.filter(r => {
        const alias = cat.aliases.get(r.id);
        return alias !== undefined && words.every(w => alias.words.some(x => key(x) === w));
    });
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

    // Why: the plain name is tried first, so "guam leaf" stays a herb rather than being read as the alias word "guam".
    const exact = exactish(cat, q);
    if (exact.length > 0) {
        return preferWorn(exact, false);
    }

    const aliased = resolveAliased(cat, q);
    if (aliased.length > 0) {
        return aliased;
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
    return preferWorn(cat.items.filter(r => named(cat, r, expandSynonyms(q))), false);
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
