import { describe, expect, test } from 'bun:test';

import { PathFinder, type TransportEdgeData } from '#/bot/nav/PathFinder.js';
import transports from '#/bot/nav/data/transports.json';

const INSIDE = { x: 2465, z: 3493, level: 0 } as const;
const OUTSIDE = { x: 2465, z: 3491, level: 0 } as const;
const EXIT = {
    from: INSIDE,
    to: OUTSIDE,
    locName: 'Tree Door',
    action: 'Open',
    kind: 'door'
} as const satisfies TransportEdgeData;
const ENTER = {
    from: OUTSIDE,
    to: INSIDE,
    locName: 'Tree Door',
    action: 'Open',
    kind: 'door'
} as const satisfies TransportEdgeData;

function twoSidesPack(): Uint8Array {
    const bytes = new Uint8Array(10 + 3 + 4096 + 512);
    bytes.set([0x4c, 0x43, 0x4e, 0x56, 1, 1]);
    new DataView(bytes.buffer).setUint16(8, 1, true);
    bytes[10] = INSIDE.x >> 6;
    bytes[11] = INSIDE.z >> 6;
    bytes[12] = 1;
    const walk = bytes.subarray(13 + 4096);
    for (const tile of [INSIDE, OUTSIDE]) {
        const index = (tile.x & 63) * 64 + (tile.z & 63);
        walk[index >> 3] |= 1 << (index & 7);
    }
    return bytes;
}

function sameEdge(actual: TransportEdgeData, expected: TransportEdgeData): boolean {
    return actual.from.x === expected.from.x && actual.from.z === expected.from.z && actual.from.level === expected.from.level
        && actual.to.x === expected.to.x && actual.to.z === expected.to.z && actual.to.level === expected.to.level
        && actual.locName === expected.locName && actual.action === expected.action && actual.kind === expected.kind;
}

describe('Grand Tree main doors', () => {
    const exit = (transports as TransportEdgeData[]).find(edge => sameEdge(edge, EXIT));
    const enter = (transports as TransportEdgeData[]).find(edge => sameEdge(edge, ENTER));

    function expectRoute(from: typeof INSIDE | typeof OUTSIDE, to: typeof INSIDE | typeof OUTSIDE, edge: TransportEdgeData | undefined): void {
        expect(edge).toBeDefined();
        if (!edge) return;
        const finder = new PathFinder(twoSidesPack());
        finder.addEdges([], [edge]);
        const outcome = finder.findPath(from, to);
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        expect(outcome.waypoints.at(-1)?.transport).toMatchObject({
            locName: 'Tree Door',
            action: 'Open',
            locX: 2465,
            locZ: 3492
        });
        expect(outcome.waypoints.at(-1)?.transport?.toTile).toBeUndefined();
    }

    test('records both scripted Tree Door crossings', () => {
        expect(exit).toEqual(EXIT);
        expect(enter).toEqual(ENTER);
    });

    test('uses the multi-tile door executor for the short crossing', () => {
        for (const edge of [exit, enter]) {
            expect(edge?.kind).toBe('door');
            expect(Math.max(
                Math.abs((edge?.from.x ?? 0) - (edge?.to.x ?? 0)),
                Math.abs((edge?.from.z ?? 0) - (edge?.to.z ?? 0))
            )).toBeLessThanOrEqual(3);
        }
    });

    test('routes outside through the otherwise sealed trunk', () => {
        expectRoute(INSIDE, OUTSIDE, exit);
    });

    test('routes inside through the otherwise sealed trunk', () => {
        expectRoute(OUTSIDE, INSIDE, enter);
    });

    test('the two collision sides remain disconnected without the crossing', () => {
        const finder = new PathFinder(twoSidesPack());
        finder.addEdges([], []);
        expect(finder.findPath(INSIDE, OUTSIDE).ok).toBe(false);
    });
});
