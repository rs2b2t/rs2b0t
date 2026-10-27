import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { nearestAltar } from '#/bot/api/altar/Altars.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';

const lumbridge = { x: 3243, z: 3205, level: 0 };
const sarim = { x: 2991, z: 3177, level: 0 };

afterEach(() => mock.restore());

function routes(cost: (to: { x: number; z: number; level: number }) => number | null): void {
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(Navigator, 'findPath').mockImplementation(async (_from, to) => {
        const value = cost(to);
        return value === null ? { ok: false, reason: 'unreachable', expanded: 0 }
            : { ok: true, cost: value, hops: [], waypoints: [], expanded: 0 };
    });
}

test('Lumbridge prayer uses the Lumbridge church', async () => {
    routes(to => to.x === lumbridge.x ? 25 : 250);
    const altar = await nearestAltar({ x: 3222, z: 3218, level: 0 });
    expect(altar?.name).toBe('Lumbridge church');
    expect(altar?.tile).toMatchObject(lumbridge);
});

test('a shorter reachable route wins over straight-line proximity to Port Sarim', async () => {
    routes(to => to.x === lumbridge.x ? 80 : to.x === sarim.x ? 150 : null);
    expect((await nearestAltar({ x: 3080, z: 3180, level: 0 }))?.tile).toMatchObject(lumbridge);
});

test('an unreachable altar cannot win on distance', async () => {
    routes(to => to.x === sarim.x ? 300 : null);
    expect((await nearestAltar(lumbridge))?.tile).toMatchObject(sarim);
});

test('no reachable altar skips the detour', async () => {
    routes(() => null);
    expect(await nearestAltar(lumbridge)).toBeNull();
});

test('the upstairs monastery is excluded below 31 prayer', async () => {
    routes(to => to.level === 1 ? 1 : to.x === 3253 ? 150 : null);
    spyOn(Skills, 'level').mockReturnValue(30);
    expect((await nearestAltar({ x: 3051, z: 3498, level: 0 }))?.name).toBe('Varrock church');
    expect(Navigator.findPath).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ level: 1 }), expect.anything());
});

test.skipIf(!existsSync('out/collision.lcnav.gz'))('the baked map routes Lumbridge Castle prayer to Lumbridge church', async () => {
    const finder = new PathFinder(gunzipSync(new Uint8Array(readFileSync('out/collision.lcnav.gz'))));
    loadDefaultNavEdges(finder);
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(Navigator, 'findPath').mockImplementation(async (from, to, opts) => finder.findPath(from, to, {
        useTeleportCatalog: opts?.useTeleportCatalog, maxExpansions: opts?.maxExpansions
    }));
    expect((await nearestAltar({ x: 3222, z: 3218, level: 0 }))?.tile).toMatchObject(lumbridge);
}, 30_000);

test('a queued worker does not time out the nearby altar behind unrelated searches', async () => {
    spyOn(Skills, 'level').mockReturnValue(60);
    let queued = 0;
    spyOn(Navigator, 'findPath').mockImplementation(async (_from, to) => {
        const wait = queued++;
        await Promise.resolve();
        queued--;
        return wait === 0 && to.x === lumbridge.x
            ? { ok: true, cost: 25, waypoints: [], hops: [], expanded: 0 }
            : { ok: false, reason: 'path request timed out', expanded: 0 };
    });
    expect((await nearestAltar({ x: 3222, z: 3218, level: 0 }))?.tile).toMatchObject(lumbridge);
});
