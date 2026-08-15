import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import doors from '#/bot/event/webwalk/data/doors.json';
import stairs from '#/bot/event/webwalk/data/stairEdges.json';
import transports from '#/bot/event/webwalk/data/transports.json';
import { PathFinder, type DoorEdgeData, type NavPoint, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';

// Why: the pack is a build artifact, so CI runs without it and an unguarded read at import throws before any test runs.
const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');
const HAS_COLLISION_PACK = fs.existsSync(PACK_PATH);

function loadFinder(): PathFinder {
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(PACK_PATH));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = gunzipSync(bytes);
    }
    const built = new PathFinder(bytes);
    built.addEdges(doors as DoorEdgeData[], transports as TransportEdgeData[], stairs as TransportEdgeData[]);
    return built;
}

const finder = HAS_COLLISION_PACK ? loadFinder() : (null as unknown as PathFinder);

const RELDO: NavPoint = { x: 3209, z: 3495, level: 0 };

// Why: a staircase with two ground-floor stands is baked as an edge per combination, so up-then-down composes into a same-level teleport the server will not honour.
describe.skipIf(!HAS_COLLISION_PACK)('stair hops never compose into a same-level teleport', () => {
    const kitchenTiles: NavPoint[] = [
        { x: 3222, z: 3492, level: 0 },
        { x: 3223, z: 3493, level: 0 },
        { x: 3221, z: 3494, level: 0 },
        { x: 3222, z: 3494, level: 0 }
    ];

    for (const from of kitchenTiles) {
        test(`(${from.x},${from.z}) reaches Reldo without touching a staircase`, () => {
            const path = finder.findPath(from, RELDO, undefined, 4_000_000);
            expect(path.ok).toBe(true);
            if (!path.ok) {
                return;
            }
            expect(path.hops.map(hop => hop.kind)).not.toContain('stair');
            expect(path.waypoints.every(w => w.level === 0)).toBe(true);
        });
    }

    test('a genuine descent from level 1 is still allowed', () => {
        const path = finder.findPath({ x: 3221, z: 3497, level: 1 }, RELDO, undefined, 4_000_000);
        expect(path.ok).toBe(true);
        if (path.ok) {
            expect(path.hops.some(hop => hop.kind === 'stair')).toBe(true);
        }
    });

    test('no path anywhere climbs and immediately returns to the level it left', () => {
        const routes: [NavPoint, NavPoint][] = [
            [{ x: 3222, z: 3492, level: 0 }, RELDO],
            [{ x: 3253, z: 3420, level: 0 }, RELDO],
            [{ x: 3209, z: 3495, level: 0 }, { x: 3222, z: 3492, level: 0 }]
        ];
        for (const [from, to] of routes) {
            const path = finder.findPath(from, to, undefined, 4_000_000);
            expect(path.ok).toBe(true);
            if (!path.ok) {
                continue;
            }
            for (let i = 1; i < path.hops.length; i++) {
                const prev = path.hops[i - 1];
                const cur = path.hops[i];
                const bounced = prev.kind === 'stair' && cur.kind === 'stair'
                    && prev.from.level === cur.to.level
                    && prev.to.x === cur.from.x && prev.to.z === cur.from.z && prev.to.level === cur.from.level;
                expect(bounced).toBe(false);
            }
        }
    });
});
