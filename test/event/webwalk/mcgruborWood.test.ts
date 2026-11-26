import { describe, expect, test } from 'bun:test';
import { collisionPack } from '../../lib/syntheticCollisionPack.js';

import doors from '#/bot/event/webwalk/data/doors.json';
import transports from '#/bot/event/webwalk/data/transports.json';
import { PathFinder, type DoorEdgeData, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';

const OUTSIDE = { x: 2661, z: 3500, level: 0 } as const;
const INSIDE = { x: 2662, z: 3500, level: 0 } as const;
const GATE_LEAVES = [
    { x: 2649, z: 3469, level: 0 },
    { x: 2650, z: 3469, level: 0 }
] as const;

function railingPack(): Uint8Array {
    return collisionPack(
        [{ x: 2659, z: 3500 }, { x: 2660, z: 3500 }, OUTSIDE],
        [INSIDE, { x: 2663, z: 3500 }, { x: 2664, z: 3500 }]
    );
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
