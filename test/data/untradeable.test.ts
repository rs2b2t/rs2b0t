import { describe, expect, test } from 'bun:test';

import { buildCatalog, tradeable, worthStocking } from '#/bot/api/market/catalog.js';
import { UNTRADEABLE_IDS } from '#/bot/data/untradeable.js';
import type { ObjRecord } from '#/bot/adapter/ClientAdapter.js';

function rec(id: number, name: string, over: Partial<ObjRecord> = {}): ObjRecord {
    return { id, name, cost: 1, stackable: false, members: false, equippable: false, certlink: -1, certtemplate: -1, ...over };
}

describe('untradeable objs', () => {
    test('the list is sorted and has no repeats, so a lookup is decidable', () => {
        const sorted = [...UNTRADEABLE_IDS].sort((a, b) => a - b);
        expect([...UNTRADEABLE_IDS]).toEqual(sorted);
        expect(new Set(UNTRADEABLE_IDS).size).toBe(UNTRADEABLE_IDS.length);
    });

    test('the stock the shop actually trades is tradeable', () => {
        for (const id of [440, 453, 561, 1515, 1333, 995]) {
            expect(tradeable(id)).toBe(true);
        }
    });

    // Why: a book that offers something no trade window will carry quotes a price it can never honour.
    test('an untradeable obj is left out of the list, and still reachable by id', () => {
        const blocked = UNTRADEABLE_IDS[0]!;
        const cat = buildCatalog([rec(blocked, 'Quest thing'), rec(440, 'Iron ore')]);

        expect(cat.items.map(r => r.id)).toEqual([440]);
        expect(cat.byId.get(blocked)?.name).toBe('Quest thing');
    });
});


describe('variants nobody stocks in bulk', () => {
    test('poisoned ammunition is left off, whatever it is fired from', () => {
        for (const name of ['Bronze arrow(p)', 'Rune dart(p)', 'Bolts(p)', 'Adamant javelin(p)', 'Rune knife(p)']) {
            expect(worthStocking(name)).toBe(false);
        }
    });

    // Why: a poisoned melee weapon is its own item people buy on purpose, and the dragon dagger most of all.
    test('poisoned melee weapons stay, since they are traded in their own right', () => {
        for (const name of ['Dragon dagger(p)', 'Rune dagger(p)', 'Dragon spear(p)', 'Black dagger(p)']) {
            expect(worthStocking(name)).toBe(true);
        }
    });

    test('fire arrows and the lighting step are left off', () => {
        for (const name of ['Iron fire arrows', 'Adamnt fire arrows', 'Lit arrows', 'Unlit arrows']) {
            expect(worthStocking(name)).toBe(false);
        }
    });

    test('the plain ammunition stays', () => {
        for (const name of ['Bronze arrow', 'Rune arrow', 'Bronze dart', 'Opal bolts', 'Bronze arrowtips', 'Arrow shaft']) {
            expect(worthStocking(name)).toBe(true);
        }
    });

    test('they are off the list and still reachable by id', () => {
        const cat = buildCatalog([rec(882, 'Bronze arrow'), rec(883, 'Bronze arrow(p)')]);
        expect(cat.items.map(r => r.id)).toEqual([882]);
        expect(cat.byId.get(883)?.name).toBe('Bronze arrow(p)');
    });
});
