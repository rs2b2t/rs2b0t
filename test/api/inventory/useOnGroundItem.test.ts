import { afterAll, expect, test } from 'bun:test';

import { reader } from '#/bot/adapter/ClientAdapter.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { GroundItem } from '#/bot/api/grounditems/GroundItems.js';
import { Input } from '#/bot/input/Input.js';
import { stubProps } from '../../lib/stubSingletons.js';

interface Call {
    useObjId: number;
    useSlot: number;
    useComId: number;
    targetObjId: number;
    lx: number;
    lz: number;
}

let calls: Call[] = [];

const restoreInput = stubProps(Input, {
    useItemOnObj: (useObjId: number, useSlot: number, useComId: number, targetObjId: number, lx: number, lz: number): boolean => {
        calls.push({ useObjId, useSlot, useComId, targetObjId, lx, lz });
        return true;
    }
});
const restoreReader = stubProps(reader, { toLocal: (x: number, z: number) => ({ lx: x - 2560, lz: z - 9600 }) });
afterAll(() => { restoreInput(); restoreReader(); });

const water = new InvItem({ id: 1929, slot: 3, comId: 3214, name: 'Bucket of water', count: 1, ops: ['Use'] } as never);
const cog = new GroundItem({
    id: 21,
    count: 1,
    name: 'Cog',
    tile: { x: 2613, z: 9639, level: 0 },
    distance: 1,
    ops: ['Take']
} as never);

test('uses a carried item on a ground item, which is the only way to reach an opobju handler', async () => {
    calls = [];

    expect(await water.useOn(cog)).toBe(true);
    expect(calls).toEqual([{ useObjId: 1929, useSlot: 3, useComId: 3214, targetObjId: 21, lx: 53, lz: 39 }]);
});
