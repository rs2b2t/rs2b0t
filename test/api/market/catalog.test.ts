import { describe, expect, test } from 'bun:test';

import {
    buildCatalog,
    notedId,
    resolveByName,
    searchCatalog,
    unnotedId
} from '#/bot/api/market/catalog.js';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';

function rec(id: number, name: string, over: Partial<ObjRecord> = {}): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, equippable: false, certlink: -1, certtemplate: -1, ...over };
}

const RECORDS: ObjRecord[] = [
    rec(440, 'Iron ore', { cost: 17 }),
    rec(441, 'Iron ore', { certlink: 440, certtemplate: 799, stackable: true }),
    rec(851, 'Maple longbow', { cost: 640, equippable: true }),
    rec(852, 'Maple longbow', { certlink: 851, certtemplate: 799, stackable: true }),
    rec(62, 'Maple longbow', { cost: 320 }),
    rec(63, 'Maple longbow', { certlink: 62, certtemplate: 799, stackable: true }),
    rec(995, 'Coins', { stackable: true })
];

const CAT = buildCatalog(RECORDS);

describe('buildCatalog', () => {
    test('items holds only unnoted entries, name-sorted', () => {
        expect(CAT.items.map(r => r.id)).toEqual([995, 440, 62, 851]);
    });

    test('maps both directions', () => {
        expect(CAT.notedOf.get(440)).toBe(441);
        expect(CAT.unnotedOf.get(441)).toBe(440);
    });

    test('byId keeps noted entries too', () => {
        expect(CAT.byId.get(441)?.stackable).toBe(true);
    });
});

describe('unnotedId / notedId', () => {
    test('unnotedId collapses a note onto its item', () => {
        expect(unnotedId(CAT, 441)).toBe(440);
        expect(unnotedId(CAT, 440)).toBe(440);
    });

    test('unnotedId passes an unknown id through', () => {
        expect(unnotedId(CAT, 9999)).toBe(9999);
    });

    test('notedId returns null for an item with no note form', () => {
        expect(notedId(CAT, 440)).toBe(441);
        expect(notedId(CAT, 995)).toBeNull();
    });
});

describe('searchCatalog', () => {
    test('substring match, case-insensitive, unnoted only', () => {
        expect(searchCatalog(CAT, 'maple').map(r => r.id).sort((a, b) => a - b)).toEqual([62, 851]);
    });

    test('empty query returns everything up to the limit', () => {
        expect(searchCatalog(CAT, '', 2)).toHaveLength(2);
    });
});

describe('resolveByName', () => {
    // Why: every bow shares its display name with its unstrung twin, and only the strung one can be worn.
    test('a bare bow name is the strung one', () => {
        expect(resolveByName(CAT, 'maple longbow').map(r => r.id)).toEqual([851]);
    });

    test('a trailing u is the unstrung one', () => {
        expect(resolveByName(CAT, 'maple longbow u').map(r => r.id)).toEqual([62]);
        expect(resolveByName(CAT, 'Maple Longbow U').map(r => r.id)).toEqual([62]);
    });

    test('a name written with (u) reaches the unstrung one too', () => {
        expect(resolveByName(CAT, 'maple longbow (u)').map(r => r.id)).toEqual([62]);
    });

    test('a partial name still narrows to the strung one', () => {
        expect(resolveByName(CAT, 'maple').map(r => r.id)).toEqual([851]);
    });

    test('a name with no collision is unaffected by the rule', () => {
        expect(resolveByName(CAT, 'iron ore').map(r => r.id)).toEqual([440]);
    });

    // Why: the suffix narrows a pair, so where there is no pair there is nothing to narrow and a typo still finds the item.
    test('a trailing u on an item with no unstrung twin still finds it', () => {
        expect(resolveByName(CAT, 'iron ore u').map(r => r.id)).toEqual([440]);
    });

    test('no match returns empty', () => {
        expect(resolveByName(CAT, 'dragon claws')).toEqual([]);
    });

    // Why: the id stays as an escape hatch for collisions the wear rule cannot split.
    test('#id picks one item outright', () => {
        expect(resolveByName(CAT, '#851').map(r => r.id)).toEqual([851]);
        expect(resolveByName(CAT, ' #62 ').map(r => r.id)).toEqual([62]);
    });

    test('#id for something not in the catalog returns empty', () => {
        expect(resolveByName(CAT, '#99999')).toEqual([]);
    });

    test('a noted id is not addressable, since rows key on the unnoted one', () => {
        expect(resolveByName(CAT, '#441')).toEqual([]);
    });

    test('an empty query matches nothing', () => {
        expect(resolveByName(CAT, '  ')).toEqual([]);
    });
});
