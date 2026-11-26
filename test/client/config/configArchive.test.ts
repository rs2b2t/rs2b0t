import { afterEach, expect, spyOn, test } from 'bun:test';
import FloType from '#/client/config/FloType.js';
import IdkType from '#/client/config/IdkType.js';
import LocType from '#/client/config/LocType.js';
import NpcType from '#/client/config/NpcType.js';
import ObjType from '#/client/config/ObjType.js';
import SeqType from '#/client/config/SeqType.js';
import SpotType from '#/client/config/SpotType.js';
import VarBitType from '#/client/config/VarBitType.js';
import VarpType from '#/client/config/VarpType.js';
import JagFile from '#/client/io/JagFile.js';
import { stubProps } from '../../lib/stubSingletons.js';

const restore: (() => void)[] = [];
afterEach(() => {
    for (const undo of restore.splice(0).reverse()) undo();
});

function archive(files: Record<string, number[]>): JagFile {
    const config = new JagFile(new Uint8Array(8));
    config.read = name => files[name] ? Uint8Array.from(files[name]) : null;
    return config;
}

function indexed(name: string, records: number[][]): JagFile {
    return archive({
        [name + '.dat']: [0, records.length, ...records.flat()],
        [name + '.idx']: [0, records.length, ...records.flatMap(row => [0, row.length])]
    });
}

test('floor and identity-kit records read consecutive entries from their own files', () => {
    restore.push(stubProps(FloType, { numDefinitions: 0, list: [] }), stubProps(IdkType, { numDefinitions: 0, list: [] }));
    const config = archive({ 'flo.dat': [0, 2, 2, 8, 0, 0], 'idk.dat': [0, 2, 1, 3, 0, 3, 0] });
    FloType.init(config);
    IdkType.init(config);
    expect(FloType.list.map(floor => floor.texture)).toEqual([8, -1]);
    expect(IdkType.list.map(kit => [kit.part, kit.disable])).toEqual([[3, false], [-1, true]]);
});

test('sequence IDs and spot animation links survive a reload with fewer entries', () => {
    restore.push(stubProps(SeqType, { numDefinitions: 0, list: [] }), stubProps(SpotType, { numDefinitions: 0, list: [] }));
    SeqType.init(archive({ 'seq.dat': [0, 2, 0, 2, 0, 7, 0] }));
    SpotType.init(archive({ 'spotanim.dat': [0, 2, 0, 2, 0, 1, 0] }));
    const old = SeqType.list[1];
    expect(old).toMatchObject({ id: 1, loops: 7 });
    expect(SpotType.list[1].id).toBe(1);
    expect(SpotType.list[1].seq).toBe(old);
    SeqType.init(archive({ 'seq.dat': [0, 1, 0] }));
    SpotType.init(archive({ 'spotanim.dat': [0, 1, 2, 0, 0, 0] }));
    expect(SeqType.numDefinitions).toBe(1);
    expect(SeqType.list).toHaveLength(1);
    expect(SpotType.list[0].seq).toBe(SeqType.list[0]);
});

test('trailing bytes keep the per-file varp and varbit diagnostics', () => {
    restore.push(stubProps(VarpType, { numDefinitions: 0, list: [] }), stubProps(VarBitType, { numDefinitions: 0, list: [] }));
    const log = spyOn(console, 'log').mockImplementation(() => {});
    restore.push(() => log.mockRestore());
    VarpType.init(archive({ 'varp.dat': [0, 1, 5, 1, 2, 0, 42] }));
    VarBitType.init(archive({ 'varbit.dat': [0, 1, 1, 0, 10, 3, 5, 0, 42] }));
    expect(VarpType.list[0].clientcode).toBe(258);
    expect(VarBitType.list[0]).toMatchObject({ basevar: 10, startbit: 3, endbit: 5 });
    expect(log.mock.calls).toEqual([['varptype load mismatch'], ['varbit load mismatch']]);
});

for (const [name, Type, capacity] of [['loc', LocType, 10], ['obj', ObjType, 10], ['npc', NpcType, 20]] as const) {
    test(name + ' indexed lookup preserves cache hits, eviction and reload', () => {
        restore.push(stubProps(Type, { dat: null, idx: null, numDefinitions: 0, recent: null, recentPos: 0 }));
        if (Type === ObjType) restore.push(stubProps(ObjType, { memServer: true }));
        const records = Array.from({ length: capacity + 1 }, (_, id) => id % 2 === 0 ? [2, 65 + id, 10, 0] : [0]);
        records[capacity] = [0];
        const config = indexed(name, records);
        Type.init(config, true);
        const first = Type.list(0);
        expect(first.name).toBe('A');
        expect(Type.list(0)).toBe(first);
        expect(Type.recentPos).toBe(1);
        for (let id = 1; id < capacity; id++) expect(Type.list(id).name).toBe(id % 2 === 0 ? String.fromCharCode(65 + id) : null);
        const next = Type.list(capacity);
        expect(next.name).toBeNull();
        expect(next === first).toBe(Type !== NpcType);
        expect(first.name).toBe(Type === NpcType ? 'A' : null);
        Type.init(indexed(name, [[2, 90, 10, 0]]), true);
        expect(Type.numDefinitions).toBe(1);
        expect(Type.recentPos).toBe(1);
        expect(Type.list(0).name).toBe('Z');
        expect(Type.list(0)).not.toBe(first);
    });
}

test('certificate resolution can read template and item before applying members mode', () => {
    restore.push(stubProps(ObjType, { dat: null, idx: null, numDefinitions: 0, recent: null, recentPos: 0, memServer: true }));
    const config = indexed('obj', [[97, 0, 1, 98, 0, 2, 0], [2, 69, 103, 103, 10, 16, 0], [1, 1, 10, 0]]);
    ObjType.init(config, true);
    expect(ObjType.list(0)).toMatchObject({ name: 'Egg', desc: 'Swap this note at any bank for an Egg.', model: 266, stackable: true });
    ObjType.init(config, false);
    expect(ObjType.list(0)).toMatchObject({ name: 'Members Object', model: 266, stackable: true });
});
