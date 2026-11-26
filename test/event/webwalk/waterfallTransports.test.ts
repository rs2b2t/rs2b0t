import { describe, expect, test } from 'bun:test';
import { segmentPack } from '../../lib/syntheticCollisionPack.js';
import { PathFinder, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import transports from '#/bot/event/webwalk/data/transports.json';

const EXPECTED = [
    {
        from: { x: 2604, z: 9901, level: 0 },
        to: { x: 2566, z: 9901, level: 0 },
        locName: 'Door',
        action: 'Open',
        kind: 'dungeon',
        locId: 2002,
        locX: 2604,
        locZ: 9900,
        debugName: 'baxtorian_door_2_waterfall_quest',
        options: ['Open']
    },
    {
        from: { x: 2575, z: 9861, level: 0 },
        to: { x: 2511, z: 3463, level: 0 },
        locName: 'Door',
        action: 'Open',
        kind: 'dungeon',
        locId: 2000,
        locX: 2575,
        locZ: 9861,
        debugName: 'baxtorian_door_waterfall_quest',
        options: ['Open']
    },
    {
        from: { x: 2511, z: 3463, level: 0 },
        to: { x: 2527, z: 3413, level: 0 },
        locName: 'Barrel',
        action: 'Get in',
        kind: 'dungeon',
        locId: 2022,
        locX: 2512,
        locZ: 3463,
        debugName: 'barrel_waterfall_quest',
        options: ['Get in']
    }
] as const satisfies readonly TransportEdgeData[];

function waterfallExitPack(): Uint8Array {
    return segmentPack([
        [{ x: 2603, z: 9913 }, { x: 2604, z: 9913 }],
        [{ x: 2604, z: 9913 }, EXPECTED[0].from],
        [EXPECTED[0].to, { x: 2567, z: 9861 }],
        [{ x: 2567, z: 9861 }, EXPECTED[1].from],
        [EXPECTED[1].to],
        [EXPECTED[2].to, { x: 2530, z: 3413 }]
    ]);
}

function sameEdge(actual: TransportEdgeData, expected: TransportEdgeData): boolean {
    return actual.from.x === expected.from.x
        && actual.from.z === expected.from.z
        && actual.from.level === expected.from.level
        && actual.to.x === expected.to.x
        && actual.to.z === expected.to.z
        && actual.to.level === expected.to.level
        && actual.locName === expected.locName
        && actual.action === expected.action
        && actual.kind === expected.kind;
}

describe('Waterfall instance exit transports', () => {
    const curated = EXPECTED.map(expected =>
        (transports as TransportEdgeData[]).find(actual => sameEdge(actual, expected))
    );

    test('records the raised-room, dungeon-exit, and barrel teleports', () => {
        expect(curated).toEqual([...EXPECTED]);
    });

    test('routes the completed-quest exit through both doors and the barrel', () => {
        const finder = new PathFinder(waterfallExitPack());
        finder.addEdges([], curated as TransportEdgeData[]);

        const outcome = finder.findPath(
            { x: 2603, z: 9913, level: 0 },
            { x: 2530, z: 3413, level: 0 }
        );

        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.waypoints.filter(step => step.transport).map(step => ({
            from: [step.transport!.locX, step.transport!.locZ],
            action: step.transport!.action,
            to: step.transport!.toTile
        }))).toEqual([
            { from: [2604, 9900], action: 'Open', to: { x: 2566, z: 9901 } },
            { from: [2575, 9861], action: 'Open', to: { x: 2511, z: 3463 } },
            { from: [2512, 3463], action: 'Get in', to: { x: 2527, z: 3413 } }
        ]);
    });

    test.each([0, 1, 2])('completed-quest exit remains unreachable when transport %d is missing', missing => {
        const finder = new PathFinder(waterfallExitPack());
        finder.addEdges([], curated.filter((_, index) => index !== missing) as TransportEdgeData[]);
        expect(finder.findPath(
            { x: 2603, z: 9913, level: 0 },
            { x: 2530, z: 3413, level: 0 }
        ).ok).toBe(false);
    });
});
