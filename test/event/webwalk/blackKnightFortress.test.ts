import fs from 'node:fs';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import stairs from '#/bot/event/webwalk/data/stairEdges.json';
import { specialCrossingForTransport } from '#/bot/event/webwalk/data/specialCrossings.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';
import { PathFinder } from '#/bot/event/webwalk/PathFinder.js';
import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';

const PACK = 'out/collision.lcnav.gz';
const OUTSIDE = { x: 3016, z: 3513, level: 0 };
const HOLE = { x: 3031, z: 3508, level: 1 };

test('the banquet-hall ladder preserves the required southern approach on both floors', () => {
    const edges = stairs.filter(edge => edge.locX === 3022 && edge.locZ === 3518);
    expect(edges).toHaveLength(2);
    for (const edge of edges) {
        expect(edge.from).toMatchObject({ x: 3022, z: 3517 });
        expect(edge.to).toMatchObject({ x: 3022, z: 3517 });
        expect(Math.abs(edge.from.level - edge.to.level)).toBe(1);
    }
});

test('the banquet door answers the guard warning', () => {
    expect(specialCrossingForTransport(
        { locX: 3020, locZ: 3515, locName: 'Door' },
        { x: 3019, z: 3515, level: 0 },
        { x: 3020, z: 3515, level: 0 }
    )).toMatchObject({ dialogue: { choose: ["I don't care. I'm going in anyway."] } });
});

describe.skipIf(!fs.existsSync(PACK))('Black Knight fortress route', () => {
    test('Amik can reach the grill tile through the eastern ladder landing and leave again', () => {
        const finder = new PathFinder(gunzipSync(fs.readFileSync(PACK)));
        loadDefaultNavEdges(finder);
        const amik = { x: 2962, z: 3338, level: 2 };
        const grill = { x: 3025, z: 3507, level: 0 };
        for (const [from, to] of [[amik, grill], [grill, amik]]) {
            const route = finder.findPath(from!, to!, { state: emptyWorldStateData() });
            expect(route.ok).toBe(true);
            if (!route.ok) continue;
            const ladder = route.waypoints.find(point => point.transport?.locX === 3021 && point.transport.locZ === 3510);
            expect(ladder).toBeDefined();
            expect(ladder).toMatchObject({ x: 3022, z: 3510 });
            const approach = { x: 3022, z: 3510, level: 1 - ladder!.level };
            expect(specialCrossingForTransport(ladder!.transport!, approach, ladder!)).toMatchObject({
                exactApproach: true, arrivalRadius: 0, toTile: { x: 3022, z: 3510, level: ladder!.level }
            });
        }
    });

    test('the hole and return route use the banquet ladder and secret wall', () => {
        const finder = new PathFinder(gunzipSync(fs.readFileSync(PACK)));
        loadDefaultNavEdges(finder);
        for (const [from, to] of [[OUTSIDE, HOLE], [HOLE, OUTSIDE]]) {
            const route = finder.findPath(from!, to!, { state: emptyWorldStateData() });
            expect(route.ok).toBe(true);
            if (!route.ok) continue;
            expect(route.hops.some(hop => hop.locId === 2338)).toBe(true);
            expect(route.hops.some(hop => hop.from.x === 3022 && hop.from.z === 3517 && hop.to.level !== hop.from.level)).toBe(true);
            expect(route.hops.some(hop => hop.locId === 2341 && hop.from.level === 1)).toBe(true);
        }
    });
});
