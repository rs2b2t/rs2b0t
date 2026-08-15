import { describe, expect, test } from 'bun:test';
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

function key(x: number, z: number): string {
    return `${x}|${z}`;
}

function line(tiles: Set<string>, from: Point, to: Point): void {
    let [x, z] = from;
    tiles.add(key(x, z));
    while (x !== to[0] || z !== to[1]) {
        x += Math.sign(to[0] - x);
        z += Math.sign(to[1] - z);
        tiles.add(key(x, z));
    }
}

/**
 * A tiny collision pack with four disconnected islands matching the live exit
 * topology. Only the curated instance transports can connect those islands.
 */
function waterfallExitPack(): Uint8Array {
    const tiles = new Set<string>();
    line(tiles, [2603, 9913], [2604, 9913]);
    line(tiles, [2604, 9913], [2604, 9901]);
    line(tiles, [2566, 9901], [2567, 9861]);
    line(tiles, [2567, 9861], [2575, 9861]);
    tiles.add(key(2511, 3463));
    line(tiles, [2527, 3413], [2530, 3413]);

    const bySquare = new Map<string, Point[]>();
    for (const tile of tiles) {
        const [x, z] = tile.split('|').map(Number);
        const squareKey = key(x >> 6, z >> 6);
        const square = bySquare.get(squareKey) ?? [];
        square.push([x, z]);
        bySquare.set(squareKey, square);
    }

    const perSquare = 3 + 4096 + 512;
    const bytes = new Uint8Array(10 + bySquare.size * perSquare);
    bytes.set([0x4c, 0x43, 0x4e, 0x56, 1, 1]);
    new DataView(bytes.buffer).setUint16(8, bySquare.size, true);

    let pos = 10;
    for (const [squareKey, squareTiles] of bySquare) {
        const [mx, mz] = squareKey.split('|').map(Number);
        bytes[pos++] = mx;
        bytes[pos++] = mz;
        bytes[pos++] = 1;
        const exits = bytes.subarray(pos, pos + 4096);
        pos += 4096;
        const walk = bytes.subarray(pos, pos + 512);
        pos += 512;

        for (const [x, z] of squareTiles) {
            const index = (x & 63) * 64 + (z & 63);
            walk[index >> 3] |= 1 << (index & 7);
            for (let direction = 0; direction < DIRS.length; direction++) {
                const [dx, dz] = DIRS[direction];
                if (tiles.has(key(x + dx, z + dz))) {
                    exits[index] |= 1 << direction;
                }
            }
        }
    }
    return bytes;
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
