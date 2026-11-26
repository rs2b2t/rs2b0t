import { expect, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import { WalkExecutor } from '#/bot/event/webwalk/WalkExecutor.js';
import { Input } from '#/bot/input/Input.js';
import { stubProps } from '../../lib/stubSingletons.js';

test('walking hands off on the arrival tick without issuing another click', async () => {
    const tiles = [0, 1, 2].map(dx => ({ x: 3200 + dx, z: 3200, level: 0 }));
    const dest = tiles[2];
    let here = tiles[0];
    let ticks = 0;
    let clicks = 0;
    const restore = [
        stubProps(reader, { worldTile: () => here, toLocal: () => ({ lx: 50, lz: 50 }) }),
        stubProps(Reachability, { canReach: () => true }),
        stubProps(Input, { walk: () => { clicks++; return true; } }),
        stubProps(Execution, { delayTicks: async n => { ticks += n; here = dest; } })
    ];
    try {
        const result = await WalkExecutor['followPath'](tiles, dest, 0, performance.now() + 1000, () => {});
        expect(result).toBe('arrived');
        expect(clicks).toBe(1);
        expect(ticks).toBe(1);
    } finally {
        for (const undo of restore.reverse()) undo();
    }
});
