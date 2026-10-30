import fs from 'node:fs';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import transports from '#/bot/event/webwalk/data/transports.json';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';

const PACK = 'out/collision.lcnav.gz';
const EXIT = {
    from: { x: 2716, z: 9888, level: 0 },
    to: { x: 2709, z: 3497, level: 0 },
    locName: 'Staircase',
    action: 'Climb-up',
    kind: 'dungeon',
    locId: 3416,
    locX: 2714,
    locZ: 9887
};

test('Elemental Workshop has an unconditional exit at the scripted landing', () => {
    const exit = transports.find(row => row.locId === EXIT.locId);
    expect(exit).toMatchObject(EXIT);
    expect(exit?.requires).toBeUndefined();
});

test('the odd wall only offers the free outward crossing', () => {
    const walls = transports.filter(row => [3390, 3391].includes(row.locId ?? -1));
    expect(walls).toHaveLength(1);
    expect(walls[0]).toMatchObject({
        from: { x: 2709, z: 3496, level: 0 },
        to: { x: 2709, z: 3495, level: 0 },
        locName: 'Odd looking wall',
        action: 'Push',
        locId: 3391,
        locX: 2709,
        locZ: 3495
    });
    expect(walls[0]?.requires).toBeUndefined();
});

describe.skipIf(!fs.existsSync(PACK))('Elemental Workshop banking route', () => {
    test('a character left inside can climb out and reach Seers bank', () => {
        const finder = new PathFinder(gunzipSync(fs.readFileSync(PACK)));
        loadDefaultNavEdges(finder);
        const route = finder.findPath({ x: 2715, z: 9889, level: 0 }, { x: 2725, z: 3491, level: 0 });
        expect(route.ok).toBe(true);
        if (!route.ok) return;
        expect(route.hops.some(hop => hop.from.x === EXIT.from.x && hop.from.z === EXIT.from.z && hop.to.z === EXIT.to.z)).toBe(true);
        expect(route.hops.some(hop => hop.locId === 3391 && hop.action === 'Push')).toBe(true);
    });
});
