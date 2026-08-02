import { describe, expect, test } from 'bun:test';

import { PathFinder, type NavPoint, type TransportEdgeData, type TransportInfo } from '#/bot/nav/PathFinder.js';
import { matchesTransportLanding } from '#/bot/nav/WalkExecutor.js';
import transports from '#/bot/nav/data/transports.json';

const REPORTED_START = { x: 2924, z: 4849, level: 0 } as const;
const EDGEVILLE = { x: 3096, z: 3494, level: 0 } as const;
const PORTAL = {
    from: { x: 2931, z: 4854, level: 0 },
    to: { x: 3107, z: 9571, level: 0 },
    locName: 'Portal',
    action: 'Use',
    kind: 'portal'
} as const satisfies TransportEdgeData;
// LostCity-derived stands/snap can shift one tile from the old curated pair.
const WIZARD_TOWER_LADDER = {
    from: { x: 3103, z: 9577, level: 0 },
    to: { x: 3105, z: 3162, level: 0 },
    locName: 'Ladder',
    action: 'Climb-up',
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

function essenceExitPack(): Uint8Array {
    const tiles = new Set<string>();
    line(tiles, REPORTED_START, PORTAL.from);
    line(tiles, PORTAL.to, WIZARD_TOWER_LADDER.from);
    line(tiles, WIZARD_TOWER_LADDER.to, EDGEVILLE);

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
    return actual.from.x === expected.from.x && actual.from.z === expected.from.z && actual.from.level === expected.from.level
        && actual.to.x === expected.to.x && actual.to.z === expected.to.z && actual.to.level === expected.to.level
        && actual.locName === expected.locName && actual.action === expected.action && actual.kind === expected.kind;
}

describe('essence mine portal transport', () => {
    const portal = (transports as TransportEdgeData[]).find(edge => sameEdge(edge, PORTAL));
    const ladder = (transports as TransportEdgeData[]).find(edge => sameEdge(edge, WIZARD_TOWER_LADDER));

    test('records all four portal exits', () => {
        expect((transports as TransportEdgeData[]).filter(edge => edge.kind === 'portal').map(edge => edge.from)).toEqual([
            { x: 2886, z: 4849, level: 0 },
            { x: 2890, z: 4814, level: 0 },
            { x: 2931, z: 4854, level: 0 },
            { x: 2932, z: 4816, level: 0 }
        ]);
    });

    test('routes the reported coordinate through the portal and tower ladder', () => {
        expect(portal).toBeDefined();
        expect(ladder).toBeDefined();
        if (!portal || !ladder) return;

        const finder = new PathFinder(essenceExitPack());
        finder.addEdges([], [portal, ladder]);
        const outcome = finder.findPath(REPORTED_START, EDGEVILLE);

        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        const hops = outcome.waypoints.filter(step => step.transport).map(step => ({
            action: step.transport!.action,
            to: step.transport!.toTile,
            anyLanding: step.transport!.acceptAnyLanding,
            locX: step.transport!.locX,
            locZ: step.transport!.locZ
        }));
        expect(hops).toHaveLength(2);
        expect(hops[0]).toMatchObject({
            action: 'Use',
            to: { x: 3107, z: 9571 },
            anyLanding: true
        });
        // Portal clickable tile is near the stand (exact loc after enrichment).
        expect(Math.max(Math.abs(hops[0]!.locX - 2931), Math.abs(hops[0]!.locZ - 4854))).toBeLessThanOrEqual(2);
        expect(hops[1]).toMatchObject({
            action: 'Climb-up',
            to: { x: 3105, z: 3162 },
            anyLanding: undefined
        });
        expect(Math.max(Math.abs(hops[1]!.locX - 3103), Math.abs(hops[1]!.locZ - 9576))).toBeLessThanOrEqual(2);
    });

    test('the mine remains disconnected without a portal edge', () => {
        expect(ladder).toBeDefined();
        if (!ladder) return;
        const finder = new PathFinder(essenceExitPack());
        finder.addEdges([], [ladder]);
        expect(finder.findPath(REPORTED_START, EDGEVILLE).ok).toBe(false);
    });
});

describe('stateful portal landing', () => {
    const info: TransportInfo = {
        locName: 'Portal',
        action: 'Use',
        locX: 2931,
        locZ: 4854,
        toTile: { x: 3107, z: 9571 },
        acceptAnyLanding: true
    };
    const before = { x: 2931, z: 4854, level: 0 };

    test('accepts the default Wizard Tower landing', () => {
        expect(matchesTransportLanding(info, 0, before, { x: 3107, z: 9571, level: 0 })).toBe(true);
    });

    test('accepts a distant Aubury landing', () => {
        expect(matchesTransportLanding(info, 0, before, { x: 3253, z: 3401, level: 0 })).toBe(true);
    });

    test('does not mistake local movement for a completed teleport', () => {
        expect(matchesTransportLanding(info, 0, before, { x: 2930, z: 4854, level: 0 })).toBe(false);
    });
});
