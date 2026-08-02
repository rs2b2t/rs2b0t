import { describe, expect, test } from 'bun:test';

import doors from '#/bot/nav/data/doors.json';
import transports from '#/bot/nav/data/transports.json';
import { PathFinder, type DoorEdgeData, type TransportEdgeData } from '#/bot/nav/PathFinder.js';

const OUTSIDE = { x: 2661, z: 3500, level: 0 } as const;
const INSIDE = { x: 2662, z: 3500, level: 0 } as const;
const GATE_LEAVES = [
    { x: 2649, z: 3469, level: 0 },
    { x: 2650, z: 3469, level: 0 }
] as const;

const DIRS = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1]
] as const;

type Point = readonly [x: number, z: number];

/**
 * The wood's east fence, cut down to the two tiles either side of the Loose
 * Railing. Neither island touches the other, so only a curated edge joins them.
 */
function railingPack(): Uint8Array {
    const islands: Point[][] = [
        [
            [2659, 3500],
            [2660, 3500],
            [2661, 3500]
        ],
        [
            [2662, 3500],
            [2663, 3500],
            [2664, 3500]
        ]
    ];

    const bytes = new Uint8Array(10 + (3 + 4096 + 512));
    bytes.set([0x4c, 0x43, 0x4e, 0x56, 1, 1]);
    new DataView(bytes.buffer).setUint16(8, 1, true);
    bytes[10] = 2661 >> 6;
    bytes[11] = 3500 >> 6;
    bytes[12] = 1;
    const exits = bytes.subarray(13, 13 + 4096);
    const walk = bytes.subarray(13 + 4096, 13 + 4096 + 512);

    for (const island of islands) {
        const tiles = new Set(island.map(([x, z]) => `${x}|${z}`));
        for (const [x, z] of island) {
            const index = (x & 63) * 64 + (z & 63);
            walk[index >> 3] |= 1 << (index & 7);
            for (let direction = 0; direction < DIRS.length; direction++) {
                const [dx, dz] = DIRS[direction];
                if (tiles.has(`${x + dx}|${z + dz}`)) {
                    exits[index] |= 1 << direction;
                }
            }
        }
    }
    return bytes;
}

describe("McGrubor's Wood gate", () => {
    test('neither leaf is baked as a door edge', () => {
        // Both leaves refuse in both directions: locked from inside the wood, and
        // the Forester turns you away from outside it.
        for (const leaf of GATE_LEAVES) {
            const baked = (doors as DoorEdgeData[]).filter(d => d.x === leaf.x && d.z === leaf.z && d.level === leaf.level);
            expect(baked, `(${leaf.x},${leaf.z}) is baked as an openable door`).toEqual([]);
        }
    });
});

describe("McGrubor's Wood loose railing", () => {
    const curated = (transports as TransportEdgeData[]).filter(t => t.locName === 'Loose Railing' && t.from.z === OUTSIDE.z);

    test('a Squeeze-through edge each way across the fence', () => {
        expect(curated).toHaveLength(2);
        expect(curated).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    from: OUTSIDE,
                    to: INSIDE,
                    locName: 'Loose Railing',
                    action: 'Squeeze-through',
                    kind: 'gate'
                }),
                expect.objectContaining({
                    from: INSIDE,
                    to: OUTSIDE,
                    locName: 'Loose Railing',
                    action: 'Squeeze-through',
                    kind: 'gate'
                })
            ])
        );
    });

    test('routes both ways through the railing', () => {
        const finder = new PathFinder(railingPack());
        finder.addEdges([], curated);

        for (const [from, to] of [
            [{ x: 2659, z: 3500, level: 0 }, { x: 2664, z: 3500, level: 0 }],
            [{ x: 2664, z: 3500, level: 0 }, { x: 2659, z: 3500, level: 0 }]
        ]) {
            const outcome = finder.findPath(from, to);
            expect(outcome.ok).toBe(true);
            if (!outcome.ok) {
                return;
            }
            expect(outcome.waypoints.filter(step => step.transport).map(step => step.transport!.action)).toEqual(['Squeeze-through']);
        }
    });

    test('the wood is sealed without the railing edges', () => {
        const finder = new PathFinder(railingPack());
        finder.addEdges([], []);
        expect(finder.findPath({ x: 2659, z: 3500, level: 0 }, { x: 2664, z: 3500, level: 0 }).ok).toBe(false);
    });
});
