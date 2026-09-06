import { describe, expect, test } from 'bun:test';

import {
    buildCatalog,
    clientName,
    displayName,
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

    // Why: people ask for "1k maple longbows", and the item is called "Maple longbow".
    test('a plural still finds the item', () => {
        expect(resolveByName(CAT, 'maple longbows').map(r => r.id)).toEqual([851]);
        expect(resolveByName(CAT, 'maple longbows u').map(r => r.id)).toEqual([62]);
        expect(resolveByName(CAT, 'iron ores').map(r => r.id)).toEqual([440]);
    });

    test('a name that genuinely ends in s is not stripped', () => {
        expect(resolveByName(CAT, 'coins').map(r => r.id)).toEqual([995]);
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

// Why: the live client only sees display names, so these ids are taken from the content pack.
const ALIASED: ObjRecord[] = [
    rec(985, 'Half of a key'),
    rec(987, 'Half of a key'),
    rec(1747, 'Dragonhide'),
    rec(1749, 'Dragonhide'),
    rec(1751, 'Dragonhide'),
    rec(1753, 'Dragonhide'),
    rec(1135, 'Dragonhide body', { equippable: true }),
    rec(2499, 'Dragonhide body', { equippable: true }),
    rec(2501, 'Dragonhide body', { equippable: true }),
    rec(2503, 'Dragonhide body', { equippable: true }),
    rec(1007, 'Cape', { equippable: true }),
    rec(1021, 'Cape', { equippable: true }),
    rec(1675, 'Sapphire amulet'),
    rec(1694, 'Sapphire amulet', { equippable: true }),
    rec(249, 'Guam leaf'),
    rec(199, 'Herb'),
    rec(201, 'Herb'),
    ...RECORDS
];

const ALIAS_CAT = buildCatalog(ALIASED);
const ids = (query: string): number[] => resolveByName(ALIAS_CAT, query).map(r => r.id);

describe('displayName', () => {
    test('a name the content repeats gets the word that separates it', () => {
        expect(displayName(ALIAS_CAT, 1753)).toBe('Green dragonhide');
        expect(displayName(ALIAS_CAT, 1751)).toBe('Blue dragonhide');
        expect(displayName(ALIAS_CAT, 987)).toBe('Loop half of key');
        expect(displayName(ALIAS_CAT, 985)).toBe('Tooth half of key');
        expect(displayName(ALIAS_CAT, 62)).toBe('Maple longbow (u)');
    });

    test('a name nothing shares is left alone', () => {
        expect(displayName(ALIAS_CAT, 440)).toBe('Iron ore');
        expect(displayName(ALIAS_CAT, 851)).toBe('Maple longbow');
    });

    test('an id the catalog has never heard of still reads as something', () => {
        expect(displayName(ALIAS_CAT, 9999)).toBe('item 9999');
    });
});

describe('resolveByName with aliases', () => {
    test('the key halves answer to their halves', () => {
        expect(ids('loop half of key')).toEqual([987]);
        expect(ids('tooth half of key')).toEqual([985]);
        // Why: the display name carries an "a" the player's own words for it do not.
        expect(ids('loop half of a key')).toEqual([987]);
        expect(ids('tooth half of a key')).toEqual([985]);
    });

    test('the bare key name stays ambiguous, so the shop can ask which', () => {
        expect(ids('half of a key').sort((a, b) => a - b)).toEqual([985, 987]);
    });

    test('dragonhide answers to a colour', () => {
        expect(ids('green dragonhide')).toEqual([1753]);
        expect(ids('blue dragonhide')).toEqual([1751]);
        expect(ids('red dragonhide')).toEqual([1749]);
        expect(ids('black dragonhide')).toEqual([1747]);
    });

    test('bare dragonhide is ambiguous across every colour', () => {
        expect(ids('dragonhide').sort((a, b) => a - b)).toEqual([1747, 1749, 1751, 1753]);
    });

    test('green is the bare member of the body family and still answers to green', () => {
        expect(ids('green dragonhide body')).toEqual([1135]);
        expect(ids('black dragonhide body')).toEqual([2503]);
    });

    test('shorthand stands in for the display name', () => {
        expect(ids('blue dhide')).toEqual([1751]);
        expect(ids('black d hide')).toEqual([1747]);
        expect(ids('green dhide body')).toEqual([1135]);
        expect(ids('red d body')).toEqual([2501]);
    });

    test('capes answer to their colour', () => {
        expect(ids('red cape')).toEqual([1007]);
        expect(ids('blue cape')).toEqual([1021]);
    });

    test('bows answer to unstrung as well as the u suffix', () => {
        expect(ids('maple longbow unstrung')).toEqual([62]);
        expect(ids('maple longbow (u)')).toEqual([62]);
        expect(ids('maple longbow')).toEqual([851]);
    });

    test('amulets split on strung and unstrung', () => {
        expect(ids('sapphire amulet u')).toEqual([1675]);
        expect(ids('strung sapphire amulet')).toEqual([1694]);
    });

    // Why: guam is an alias word inside the "Herb" group, and a plain name has to beat it or the leaf disappears.
    test('a plain name wins over an alias word inside it', () => {
        expect(ids('guam leaf')).toEqual([249]);
        expect(ids('guam herb')).toEqual([199]);
    });

    test('a colour on its own names nothing', () => {
        expect(resolveByName(ALIAS_CAT, 'green', { exactOnly: true })).toEqual([]);
        expect(resolveByName(ALIAS_CAT, 'blue', { exactOnly: true })).toEqual([]);
    });

    test('an alias label is searchable from the panel', () => {
        expect(searchCatalog(ALIAS_CAT, 'loop half').map(r => r.id)).toEqual([987]);
        expect(searchCatalog(ALIAS_CAT, 'dhide body').map(r => r.id).sort((a, b) => a - b)).toEqual([1135, 2499, 2501, 2503]);
    });
});

// Why: Trade.offer and every other click-by-name path filters the client's own pack on its own name, so
// Why: handing it the shop's label finds no slot at all and the bot silently owes goods it cannot put up.
describe('clientName', () => {
    test('is what the client calls the obj, whatever the shop calls it', () => {
        expect(clientName(ALIAS_CAT, 1751)).toBe('Dragonhide');
        expect(displayName(ALIAS_CAT, 1751)).toBe('Blue dragonhide');
        expect(clientName(ALIAS_CAT, 987)).toBe('Half of a key');
        expect(displayName(ALIAS_CAT, 987)).toBe('Loop half of key');
    });

    test('is undefined for an id the client never sent, so a caller refuses rather than clicks', () => {
        expect(clientName(ALIAS_CAT, 9999)).toBeUndefined();
    });

    test('an unaliased obj reads the same either way', () => {
        expect(clientName(ALIAS_CAT, 440)).toBe('Iron ore');
        expect(displayName(ALIAS_CAT, 440)).toBe('Iron ore');
    });
});
