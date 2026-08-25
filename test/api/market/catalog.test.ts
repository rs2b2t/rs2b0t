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
    return { id, name, cost: 1, stackable: false, members: false, certlink: -1, certtemplate: -1, ...over };
}

const RECORDS: ObjRecord[] = [
    rec(440, 'Iron ore', { cost: 17 }),
    rec(441, 'Iron ore', { certlink: 440, certtemplate: 799, stackable: true }),
    rec(851, 'Maple longbow', { cost: 320 }),
    rec(852, 'Maple longbow', { certlink: 851, certtemplate: 799, stackable: true }),
    rec(64, 'Maple longbow (u)', { cost: 210 }),
    rec(65, 'Maple longbow (u)', { certlink: 64, certtemplate: 799, stackable: true }),
    rec(995, 'Coins', { stackable: true })
];

const CAT = buildCatalog(RECORDS);

describe('buildCatalog', () => {
    test('items holds only unnoted entries, name-sorted', () => {
        expect(CAT.items.map(r => r.id)).toEqual([995, 440, 851, 64]);
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
        expect(searchCatalog(CAT, 'maple').map(r => r.id)).toEqual([851, 64]);
    });

    test('empty query returns everything up to the limit', () => {
        expect(searchCatalog(CAT, '', 2)).toHaveLength(2);
    });
});

describe('resolveByName', () => {
    test('an exact name wins over a longer substring match', () => {
        expect(resolveByName(CAT, 'maple longbow').map(r => r.id)).toEqual([851]);
    });

    test('a partial name returns every candidate', () => {
        expect(resolveByName(CAT, 'maple').map(r => r.id)).toEqual([851, 64]);
    });

    test('parenthesis-free aliases still reach the unstrung bow', () => {
        expect(resolveByName(CAT, 'maple longbow u').map(r => r.id)).toEqual([64]);
    });

    test('no match returns empty', () => {
        expect(resolveByName(CAT, 'dragon claws')).toEqual([]);
    });

    // Why: two objs can share a display name exactly, so the id is the only handle left.
    test('#id picks one item outright', () => {
        expect(resolveByName(CAT, '#851').map(r => r.id)).toEqual([851]);
        expect(resolveByName(CAT, ' #64 ').map(r => r.id)).toEqual([64]);
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
