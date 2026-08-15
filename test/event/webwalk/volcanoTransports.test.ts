import { describe, expect, test } from 'bun:test';

import type { TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import transports from '#/bot/event/webwalk/data/transports.json';

// `[oploc1,volcano_entrance]` and `[oploc1,climbing_rope2]` carry no conditions; the Crandor secret wall next door is gated on Dragon Slayer both ways.
// Why: both hops are scripted teleports and neither is derivable, so they are curated.
const DOWN = {
    from: { x: 2856, z: 3167, level: 0 },
    to: { x: 2856, z: 9567, level: 0 },
    locName: 'Rocks',
    action: 'Climb-down',
    kind: 'dungeon'
} as const satisfies TransportEdgeData;

const UP = {
    from: { x: 2856, z: 9570, level: 0 },
    to: { x: 2856, z: 3166, level: 0 },
    locName: 'Climbing rope',
    action: 'Climb',
    kind: 'dungeon'
} as const satisfies TransportEdgeData;

const edges = transports as TransportEdgeData[];
const find = (e: TransportEdgeData): TransportEdgeData | undefined =>
    edges.find(t => t.from.x === e.from.x && t.from.z === e.from.z && t.from.level === e.from.level);

describe('Karamja volcano transports', () => {
    test('both hops are curated, with the tiles the engine actually uses', () => {
        // Why: Climb-down telejumps 6400 south of the stand, so the stand fixes the landing; the rope names its coordinate outright.
        expect(find(DOWN)).toMatchObject(DOWN);
        expect(find(UP)).toMatchObject(UP);
        expect(DOWN.from.z + 6400).toBe(DOWN.to.z);
    });

    test('the rope is taken from beside it, never from its own tile', () => {
        // Why: addEdges silently drops an edge whose endpoints are not both walkable, and the rope loc blocks (2856,9569).
        expect(UP.from).not.toMatchObject({ x: 2856, z: 9569 });
        expect(Math.abs(UP.from.z - 9569) + Math.abs(UP.from.x - 2856)).toBe(1);
    });

    test('the volcano is the only ungated way in — the wall is Dragon Slayer both ways', () => {
        // Why: the wall refuses anyone who has not opened it from the Crandor side, so an ungated edge — or one gated on a single direction — routes a bot into a dungeon it cannot leave.
        const wall = edges.filter(e => e.from.z === 9599 || e.to.z === 9599);
        expect(wall.length).toBeGreaterThan(0);
        for (const e of wall) {
            expect(e.requires?.quests).toEqual([{ quest: 'Dragon Slayer', minStatus: 'complete' }]);
        }
        // Both directions exist, so the wall can never strand a bot behind it.
        expect(wall.some(e => e.from.z === 9599 && e.to.z === 9601)).toBe(true);
        expect(wall.some(e => e.from.z === 9601 && e.to.z === 9599)).toBe(true);
    });
});
