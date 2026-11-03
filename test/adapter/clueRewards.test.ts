import { afterEach, expect, test } from 'bun:test';
import { attach, detach, reader } from '#/bot/adapter/ClientAdapter.js';
import IfType, { ComponentType } from '#/client/config/IfType.js';
import ObjType from '#/client/config/ObjType.js';

const originalInterfaces = IfType.list;
const originalObjects = ObjType.list;
afterEach(() => { detach(); IfType.list = originalInterfaces; ObjType.list = originalObjects; });

test('reward snapshot exposes only a populated, active reward interface and its packet generation', () => {
    const inv = new IfType();
    inv.id = 6963;
    inv.type = ComponentType.TYPE_INV;
    inv.linkObjType = Int32Array.from([996, 100000]);
    inv.linkObjNumber = Int32Array.from([50, 1]);
    IfType.list = [];
    IfType.list[6963] = inv;
    ObjType.list = ((id: number) => { const item = new ObjType(); item.id = id; item.name = `Item ${id}`; return item; }) as typeof ObjType.list;
    const client = { statSessionGeneration: 0, mainModalId: 6960,
        invUpdateState: new Map([[6963, { generation: 4, fullGeneration: 4, transmitting: true }]]) };
    attach(client as never);
    expect(reader.clueRewardSnapshot().items.map(i => ({ id: i.id, count: i.count }))).toEqual([{ id: 995, count: 50 }, { id: 99999, count: 1 }]);
    expect(reader.clueRewardSnapshot().generation).toBe(4);
    client.mainModalId = -1;
    expect(reader.clueRewardSnapshot()).toEqual({ generation: 4, items: [] });
    client.mainModalId = 6960;
    client.invUpdateState.clear();
    expect(reader.clueRewardSnapshot()).toEqual({ generation: 0, items: [] });
});
