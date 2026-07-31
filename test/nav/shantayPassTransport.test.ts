import { describe, expect, test } from 'bun:test';

import { PathFinder, type NavPoint, type TransportEdgeData } from '#/bot/nav/PathFinder.js';
import transports from '#/bot/nav/data/transports.json';

const REPORTED_START = { x: 3246, z: 3092, level: 0 } as const;
const VARROCK = { x: 3213, z: 3424, level: 0 } as const;
const SHANTAY_EXIT = {
    from: { x: 3304, z: 3114, level: 0 },
    to: { x: 3304, z: 3118, level: 0 },
    locName: 'Shantay pass',
    action: 'Go-through',
    kind: 'dungeon'
} as const satisfies TransportEdgeData;

const DX = [0, 1, 0, -1, 1, 1, -1, -1] as const;
const DZ = [1, 0, -1, 0, 1, -1, -1, 1] as const;

function key(x: number, z: number): string {
    return `${x}|${z}`;
}

function line(tiles: Set<string>, from: NavPoint, to: NavPoint): void {
    let { x, z } = from;
    tiles.add(key(x, z));
    while (x !== to.x || z !== to.z) {
        x += Math.sign(to.x - x);
        z += Math.sign(to.z - z);
        tiles.add(key(x, z));
    }
}

/** Two collision islands separated by the real four-tile-wide Shantay doorway. */
function desertExitPack(): Uint8Array {
    const tiles = new Set<string>();
    line(tiles, REPORTED_START, SHANTAY_EXIT.from);
    line(tiles, SHANTAY_EXIT.to, VARROCK);

    const bySquare = new Map<string, [number, number][]>();
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
            for (let direction = 0; direction < DX.length; direction++) {
                if (tiles.has(key(x + DX[direction], z + DZ[direction]))) {
                    exits[index] |= 1 << direction;
                }
            }
        }
    }
    return bytes;
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
                from: [SHANTAY_EXIT.from.x, SHANTAY_EXIT.from.z],
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
