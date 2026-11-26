import { expect, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import { Input } from '#/bot/input/Input.js';
import { stubProps } from '../../lib/stubSingletons.js';

test('walking hands off on the arrival tick without issuing another click', async () => {
    const tiles = [0, 1, 2].map(dx => ({ x: 3200 + dx, z: 3200, level: 0 }));
    const dest = tiles[2];
    let here = tiles[0];
    let next = here;
    let ticks = 0;
    const clicks: number[][] = [];
    const restore = [
        stubProps(reader, {
            worldTile: () => here,
            toLocal: (x, z) => ({ lx: x - tiles[0].x, lz: z - tiles[0].z }),
            collisionFlags: (lx, lz) => lz === 0 && lx >= 0 && lx < tiles.length ? 0 : null
        }),
        stubProps(Input, { walk: (lx, lz) => {
            clicks.push([lx, lz]);
            next = tiles[lx];
            return true;
        } }),
        stubProps(Execution, { delayTicks: async n => { ticks += n; here = next; } })
    ];
    try {
        const result = await WalkExecutor['followPath'](tiles, dest, 0, performance.now() + 1000, () => {});
        expect(result).toBe('arrived');
        expect(clicks).toEqual([[2, 0]]);
        expect(ticks).toBe(1);
    } finally {
        for (const undo of restore.reverse()) undo();
    }
});
