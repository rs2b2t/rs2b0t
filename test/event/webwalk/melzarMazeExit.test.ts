import fs from 'node:fs';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import transports from '#/bot/event/webwalk/data/transports.json';
import { specialCrossingForTransport } from '#/bot/event/webwalk/data/specialCrossings.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';

const PACK = 'out/collision.lcnav.gz';
const FROM = { x: 2940, z: 3248, level: 0 };
const TO = { x: 2941, z: 3248, level: 0 };

test('the maze front-door exit uses the reusable key and exact landing', () => {
    const rows = transports.filter(row => row.locId === 2595);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ from: FROM, to: TO, requires: { items: [{ name: 'Maze key', count: 1, consumed: false }] } });
    expect(specialCrossingForTransport({ locX: TO.x, locZ: TO.z, locName: 'Door' }, FROM, TO)).toMatchObject({
        useItem: { id: 1542, name: 'Maze key' },
        exactApproach: true,
        toTile: TO,
        arrivalRadius: 0
    });
});

describe.skipIf(!fs.existsSync(PACK))('banking from the maze entrance hall', () => {
    test.each([true, false])('a route requires the held key: %s', hasKey => {
        const finder = new PathFinder(gunzipSync(fs.readFileSync(PACK)));
        loadDefaultNavEdges(finder);
        const state = emptyWorldStateData();
        if (hasKey) state.items['Maze key'] = 1;
        const route = finder.findPath({ x: 2937, z: 3251, level: 0 }, { x: 2945, z: 3368, level: 0 }, { state });
        expect(route.ok).toBe(hasKey);
        if (route.ok) expect(route.hops.some(hop => hop.locId === 2595)).toBe(true);
    });
});
