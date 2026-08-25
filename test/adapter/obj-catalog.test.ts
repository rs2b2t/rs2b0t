import { afterEach, describe, expect, test } from 'bun:test';

import { reader, resetObjCatalog } from '#/bot/adapter/ClientAdapter.js';
import ObjType from '#/client/config/ObjType.js';

const realList = ObjType.list;
const realCount = ObjType.numDefinitions;

function stub(entries: Record<number, Partial<ObjType>>): void {
    ObjType.numDefinitions = Math.max(...Object.keys(entries).map(Number)) + 1;
    ObjType.list = ((id: number) => {
        const base = new ObjType();
        base.id = id;
        base.name = null;
        base.cost = 1;
        base.certlink = -1;
        base.certtemplate = -1;
        return Object.assign(base, entries[id] ?? {});
    }) as typeof ObjType.list;
    resetObjCatalog();
}

afterEach(() => {
    ObjType.list = realList;
    ObjType.numDefinitions = realCount;
    resetObjCatalog();
});

describe('reader.objCatalog', () => {
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
