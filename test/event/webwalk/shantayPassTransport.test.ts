import { describe, expect, test } from 'bun:test';
import { segmentPack } from '../../lib/syntheticCollisionPack.js';

import { PathFinder, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import transports from '#/bot/event/webwalk/data/transports.json';

const REPORTED_START = { x: 3246, z: 3092, level: 0 } as const;
const VARROCK = { x: 3213, z: 3424, level: 0 } as const;
const SHANTAY_EXIT = {
    from: { x: 3304, z: 3114, level: 0 },
    to: { x: 3304, z: 3118, level: 0 },
    locName: 'Shantay pass',
    action: 'Go-through',
    kind: 'dungeon',
    locId: 4031,
    locX: 3302,
    locZ: 3116,
    debugName: 'shantay_pass_henge_doorway',
    options: ['Go-through', 'Look-at']
} as const satisfies TransportEdgeData;

function desertExitPack(): Uint8Array {
    return segmentPack([[REPORTED_START, SHANTAY_EXIT.from], [SHANTAY_EXIT.to, VARROCK]]);
}

function sameEdge(actual: TransportEdgeData, expected: TransportEdgeData): boolean {
    return (
        actual.from.x === expected.from.x &&
        actual.from.z === expected.from.z &&
        actual.from.level === expected.from.level &&
        actual.to.x === expected.to.x &&
        actual.to.z === expected.to.z &&
        actual.to.level === expected.to.level &&
        actual.locName === expected.locName &&
        actual.action === expected.action &&
        actual.kind === expected.kind
    );
}

describe('Shantay Pass desert exit transport', () => {
    const edge = (transports as TransportEdgeData[]).find(candidate => sameEdge(candidate, SHANTAY_EXIT));

    test('records the source-authored free south-to-north crossing', () => {
        expect(edge).toEqual(SHANTAY_EXIT);
    });

    test('routes the reported desert coordinate to Varrock through the pass', () => {
        expect(edge).toBeDefined();
        if (!edge) return;

        const finder = new PathFinder(desertExitPack());
        finder.addEdges([], [edge]);
        const outcome = finder.findPath(REPORTED_START, VARROCK);

        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(
            outcome.waypoints
                .filter(step => step.transport)
                .map(step => ({
                    from: [step.transport!.locX, step.transport!.locZ],
                    action: step.transport!.action,
                    to: step.transport!.toTile
                }))
        ).toEqual([
            {
                from: [SHANTAY_EXIT.locX, SHANTAY_EXIT.locZ],
                action: 'Go-through',
                to: { x: SHANTAY_EXIT.to.x, z: SHANTAY_EXIT.to.z }
            }
        ]);
    });

    test('the collision islands remain disconnected without the curated crossing', () => {
        const finder = new PathFinder(desertExitPack());
        finder.addEdges([], []);
        expect(finder.findPath(REPORTED_START, VARROCK).ok).toBe(false);
    });

    test('does not create a free north-to-south route', () => {
        expect(edge).toBeDefined();
        if (!edge) return;

        const finder = new PathFinder(desertExitPack());
        finder.addEdges([], [edge]);
        expect(finder.findPath(VARROCK, REPORTED_START).ok).toBe(false);
    });
});
