import { afterEach, describe, expect, test } from 'bun:test';

import { reader, resetObjCatalog } from '#/bot/adapter/ClientAdapter.js';
import ObjType from '#/client/config/ObjType.js';
import { installObjTypeTable } from '../fixtures/obj-type-table.js';

const realList = ObjType.list;
const realCount = ObjType.numDefinitions;

function stub(entries: Record<number, Partial<ObjType>>): void {
    installObjTypeTable(entries);
    resetObjCatalog();
}

afterEach(() => {
    ObjType.list = realList;
    ObjType.numDefinitions = realCount;
    resetObjCatalog();
});

describe('reader.objCatalog', () => {
    // Why: a stackable's model changes with the size of the pile, and each of those models is its own obj
    // Why: sharing the base item's name. Left in, "Bronze arrow" turns up five times in one book.
    test('flags the stack-size models so they are not mistaken for separate items', () => {
        stub({
            882: { name: 'Bronze arrow', stackable: true, countobj: Uint16Array.from([883, 884, 0, 0, 0, 0, 0, 0, 0, 0]) },
            883: { name: 'Bronze arrow', stackable: true },
            884: { name: 'Bronze arrow', stackable: true },
            886: { name: 'Steel arrow', stackable: true }
        });

        const cat = reader.objCatalog();
        const flagged = new Map(cat.map(r => [r.id, r.stackVariant === true]));
        expect(flagged.get(882)).toBe(false);
        expect(flagged.get(883)).toBe(true);
        expect(flagged.get(884)).toBe(true);
        expect(flagged.get(886)).toBe(false);
    });

    // Why: the scan runs against whatever the client has decoded, so before the obj config is unpacked it
    // Why: comes back empty. Caching that empties every name and every search for the rest of the session.
    test('an empty scan is not cached, so a later call still gets the real table', () => {
        ObjType.numDefinitions = 0;
        ObjType.list = ((): ObjType => {
            throw new Error('config not unpacked');
        }) as typeof ObjType.list;
        resetObjCatalog();

        expect(reader.objCatalog()).toEqual([]);

        installObjTypeTable({ 561: { name: 'Nature rune', cost: 180, stackable: true } });
        expect(reader.objCatalog().map(r => r.name)).toEqual(['Nature rune']);
    });

    test('a filled scan is cached, so the table is walked once', () => {
        stub({ 561: { name: 'Nature rune' } });
        expect(reader.objCatalog()).toHaveLength(1);

        ObjType.list = (() => {
            throw new Error('should not be walked again');
        }) as typeof ObjType.list;
        expect(reader.objCatalog()).toHaveLength(1);
    });

    test('skips unnamed objs and keeps the cert fields', () => {
        stub({
            440: { name: 'Iron ore', cost: 17, stackable: false },
            441: { name: 'Iron ore', cost: 17, stackable: true, certlink: 440, certtemplate: 799 },
            442: { name: null }
        });

        const cat = reader.objCatalog();

        expect(cat.map(r => r.id)).toEqual([440, 441]);
        expect(cat[0]).toMatchObject({ id: 440, name: 'Iron ore', cost: 17, certlink: -1, certtemplate: -1 });
        expect(cat[1]).toMatchObject({ id: 441, certlink: 440, certtemplate: 799, stackable: true });
    });

    test('scans once and memoises', () => {
        stub({ 440: { name: 'Iron ore' } });
        const stubbed = ObjType.list;
        let calls = 0;
        ObjType.list = ((id: number) => {
            calls++;
            return stubbed(id);
        }) as typeof ObjType.list;
        resetObjCatalog();

        reader.objCatalog();
        const after = calls;
        reader.objCatalog();

        expect(after).toBeGreaterThan(0);
        expect(calls).toBe(after);
    });

    test('returns empty when the cache is not initialised', () => {
        ObjType.numDefinitions = 0;
        resetObjCatalog();
        expect(reader.objCatalog()).toEqual([]);
    });
});
