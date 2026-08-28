import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import { PathFinder, type NavPoint } from '#/bot/event/webwalk/PathFinder.js';
import { loadDefaultNavEdges } from '#/bot/event/webwalk/loadTransportGraph.js';

const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');
const HAS_COLLISION_PACK = fs.existsSync(PACK_PATH);

function loadFinder(): PathFinder {
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(PACK_PATH));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = new Uint8Array(gunzipSync(bytes));
    }
    const finder = new PathFinder(bytes);
    loadDefaultNavEdges(finder);
    return finder;
}

/** The 2x2 tree the Seers gathering run chops; loc 1276 sits at (2722,3481) and covers (2723,3482). */
const SEERS_TREE: NavPoint = { x: 2722, z: 3481, level: 0 };
/** Its own body to the north and east, the oak to the west, another tree to the south. */
const SEERS_TREE_BODY: readonly NavPoint[] = [
    { x: 2722, z: 3481, level: 0 },
    { x: 2723, z: 3481, level: 0 },
    { x: 2722, z: 3482, level: 0 },
    { x: 2723, z: 3482, level: 0 }
];

const cheb = (a: NavPoint, b: NavPoint): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));

const besideTree = (t: NavPoint): boolean =>
    SEERS_TREE_BODY.some(b => Math.abs(b.x - t.x) + Math.abs(b.z - t.z) === 1);

// Why: a loc wider than one tile blocks its own neighbours, so the four squares beside the placement can all
// Why: be solid. That left the search with no goal, and the radius-5 fallback then called any walkable tile
// Why: within five "arrived", which the walker refused and logged as "unreachable beyond".
describe.skipIf(!HAS_COLLISION_PACK)('approaching a loc bigger than one tile', () => {
    const finder = HAS_COLLISION_PACK ? loadFinder() : (null as unknown as PathFinder);

    test("the Seers tree's own square and its neighbours are all solid", () => {
        for (const b of SEERS_TREE_BODY) {
            expect(finder.walkable(b.x, b.z, b.level), `${b.x},${b.z}`).toBe(false);
        }
        // The four beside the placement itself: two are the tree, two are the oak and the tree south of it.
        for (const n of [{ x: 2721, z: 3481 }, { x: 2723, z: 3481 }, { x: 2722, z: 3480 }, { x: 2722, z: 3482 }]) {
            expect(finder.walkable(n.x, n.z, 0), `${n.x},${n.z}`).toBe(false);
        }
    });

    test('a walk to it ends on a tile beside the tree, from every side', () => {
        const starts: NavPoint[] = [
            { x: 2723, z: 3478, level: 0 },
            { x: 2725, z: 3486, level: 0 },
            { x: 2757, z: 3477, level: 0 }
        ];
        for (const from of starts) {
            const route = finder.findPath(from, SEERS_TREE, { useTeleportCatalog: false });
            expect(route.ok, `${from.x},${from.z}`).toBe(true);
            if (!route.ok) {
                continue;
            }
            const terminal = route.waypoints[route.waypoints.length - 1]!;
            expect(besideTree(terminal), `${from.x},${from.z} ended at ${terminal.x},${terminal.z}`).toBe(true);
        }
    }, 60_000);

    // Why: standing three tiles off and being told the walk was over is the shape of the original failure.
    test('a start already inside the old five-tile fallback still walks in', () => {
        const from: NavPoint = { x: 2723, z: 3478, level: 0 };
        expect(cheb(from, SEERS_TREE)).toBe(3);
        const route = finder.findPath(from, SEERS_TREE, { useTeleportCatalog: false });
        expect(route.ok).toBe(true);
        if (route.ok) {
            expect(route.waypoints.length).toBeGreaterThan(1);
        }
    });

    // Why: the single-tile trees either side already had a free square and must keep the approach they had.
    test('the neighbouring trees are untouched', () => {
        for (const tree of [{ x: 2725, z: 3482, level: 0 }, { x: 2719, z: 3481, level: 0 }] as NavPoint[]) {
            const route = finder.findPath({ x: 2757, z: 3477, level: 0 }, tree, { useTeleportCatalog: false });
            expect(route.ok, `${tree.x},${tree.z}`).toBe(true);
            if (route.ok) {
                const terminal = route.waypoints[route.waypoints.length - 1]!;
                expect(cheb(terminal, tree), `${tree.x},${tree.z}`).toBeLessThanOrEqual(2);
            }
        }
    }, 60_000);
});
