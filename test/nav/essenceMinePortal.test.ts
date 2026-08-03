import { describe, expect, test } from 'bun:test';

import { PathFinder, type NavPoint, type TransportEdgeData, type TransportInfo } from '#/bot/nav/PathFinder.js';
import { matchesTransportLanding, multiLandingNeedsRepath } from '#/bot/nav/exec/transportLoc.js';
import {
    ESSENCE_EXIT_PORTALS,
    ESSENCE_EXIT_RETURNS,
    essenceExitEdges,
    essenceReturnIdFromPacked,
    essenceReturnIdFromTile
} from '#/bot/nav/v2/essenceExit.js';
import { packNavPoint } from '#/bot/nav/v2/lcCoord.js';
import { emptyWorldStateData } from '#/bot/nav/v2/worldStateData.js';
import transports from '#/bot/nav/data/transports.json';

const REPORTED_START = { x: 2924, z: 4849, level: 0 } as const;
const EDGEVILLE = { x: 3096, z: 3494, level: 0 } as const;
const SEDRIDOR = ESSENCE_EXIT_RETURNS.sedridor;
const AUBURY = ESSENCE_EXIT_RETURNS.aubury;
// NE portal stand (matches previous hard-coded transports.json row).
const PORTAL_NE = ESSENCE_EXIT_PORTALS.find(p => p.debug === 'ess_exit_ne')!;
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

function essenceExitPack(surfaceTo: NavPoint): Uint8Array {
    const tiles = new Set<string>();
    line(tiles, REPORTED_START, PORTAL_NE.from);
    line(tiles, surfaceTo, WIZARD_TOWER_LADDER.from);
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

describe('essence exit multiloc catalog', () => {
    test('transports.json no longer hard-codes portal→Sedridor exits', () => {
        const portals = (transports as TransportEdgeData[]).filter(
            e => e.kind === 'portal' && e.locId === 2492
        );
        expect(portals).toHaveLength(0);
    });

    test('catalog expands 4 portals × 5 returns', () => {
        const edges = essenceExitEdges();
        expect(edges).toHaveLength(ESSENCE_EXIT_PORTALS.length * Object.keys(ESSENCE_EXIT_RETURNS).length);
        expect(edges.every(e => e.locName === 'Portal' && e.action === 'Use' && e.kind === 'portal')).toBe(true);
        expect(new Set(edges.map(e => e.from.x + ',' + e.from.z)).size).toBe(4);
        expect(new Set(edges.map(e => e.requires?.essenceExitReturn)).size).toBe(5);
    });

    test('packed varp matches return stands', () => {
        expect(essenceReturnIdFromPacked(packNavPoint(SEDRIDOR))).toBe('sedridor');
        expect(essenceReturnIdFromPacked(packNavPoint(AUBURY))).toBe('aubury');
        expect(essenceReturnIdFromPacked(0)).toBeNull();
        expect(essenceReturnIdFromTile({ x: AUBURY.x + 1, z: AUBURY.z - 1, level: 0 })).toBe('aubury');
        expect(essenceReturnIdFromTile({ x: 0, z: 0, level: 0 })).toBeNull();
    });
});

describe('essence mine portal transport', () => {
    const sedridorExit = essenceExitEdges().find(
        e =>
            e.from.x === PORTAL_NE.from.x
            && e.from.z === PORTAL_NE.from.z
            && e.requires?.essenceExitReturn === 'sedridor'
    );
    const ladder = (transports as TransportEdgeData[]).find(
        e =>
            e.from.x === WIZARD_TOWER_LADDER.from.x
            && e.from.z === WIZARD_TOWER_LADDER.from.z
            && e.action === WIZARD_TOWER_LADDER.action
            && e.kind === WIZARD_TOWER_LADDER.kind
    );

    test('records four portal placements in catalog', () => {
        expect(ESSENCE_EXIT_PORTALS.map(p => p.from)).toEqual([
            { x: 2886, z: 4849, level: 0 },
            { x: 2890, z: 4814, level: 0 },
            { x: 2931, z: 4854, level: 0 },
            { x: 2932, z: 4816, level: 0 }
        ]);
    });

    test('with sedridor session state, routes through portal and tower ladder', () => {
        expect(sedridorExit).toBeDefined();
        expect(ladder).toBeDefined();
        if (!sedridorExit || !ladder) return;

        const finder = new PathFinder(essenceExitPack(SEDRIDOR));
        finder.addEdges([], [sedridorExit, ladder]);
        const outcome = finder.findPath(REPORTED_START, EDGEVILLE, {
            state: {
                ...emptyWorldStateData(),
                essenceExitReturn: 'sedridor'
            }
        });

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
            to: { x: SEDRIDOR.x, z: SEDRIDOR.z },
            anyLanding: true
        });
        expect(Math.max(Math.abs(hops[0]!.locX - 2931), Math.abs(hops[0]!.locZ - 4854))).toBeLessThanOrEqual(2);
        expect(hops[1]).toMatchObject({
            action: 'Climb-up',
            to: { x: 3105, z: 3162 },
            anyLanding: undefined
        });
    });

    test('session aubury gates out sedridor-only edges', () => {
        expect(sedridorExit).toBeDefined();
        if (!sedridorExit) return;
        const finder = new PathFinder(essenceExitPack(SEDRIDOR));
        finder.addEdges([], [sedridorExit, ...(ladder ? [ladder] : [])]);
        // Only sedridor edge loaded + aubury state → portal edge filtered → disconnected.
        const outcome = finder.findPath(REPORTED_START, EDGEVILLE, {
            state: { ...emptyWorldStateData(), essenceExitReturn: 'aubury' }
        });
        expect(outcome.ok).toBe(false);
    });

    test('with aubury state, plans exit to Aubury stand', () => {
        const auburyExit = essenceExitEdges().find(
            e =>
                e.from.x === PORTAL_NE.from.x
                && e.from.z === PORTAL_NE.from.z
                && e.requires?.essenceExitReturn === 'aubury'
        );
        expect(auburyExit).toBeDefined();
        if (!auburyExit) return;

        // Mini pack: mine → aubury only (no tower ladder / Edgeville).
        const tiles = new Set<string>();
        line(tiles, REPORTED_START, PORTAL_NE.from);
        tiles.add(key(AUBURY.x, AUBURY.z));
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

        const finder = new PathFinder(bytes);
        finder.addEdges([], [auburyExit]);
        const outcome = finder.findPath(REPORTED_START, AUBURY, {
            state: { ...emptyWorldStateData(), essenceExitReturn: 'aubury' }
        });
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) return;
        const portalHop = outcome.waypoints.find(s => s.transport?.action === 'Use');
        expect(portalHop?.transport?.toTile).toEqual({ x: AUBURY.x, z: AUBURY.z });
    });

    test('the mine remains disconnected without a portal edge', () => {
        expect(ladder).toBeDefined();
        if (!ladder) return;
        const finder = new PathFinder(essenceExitPack(SEDRIDOR));
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
        toTile: { x: SEDRIDOR.x, z: SEDRIDOR.z },
        acceptAnyLanding: true
    };
    const before = { x: 2931, z: 4854, level: 0 };

    test('accepts the default Wizard Tower landing', () => {
        expect(matchesTransportLanding(info, 0, before, { x: SEDRIDOR.x, z: SEDRIDOR.z, level: 0 })).toBe(true);
    });

    test('accepts a distant Aubury landing', () => {
        expect(matchesTransportLanding(info, 0, before, { x: AUBURY.x, z: AUBURY.z, level: 0 })).toBe(true);
    });

    test('does not mistake local movement for a completed teleport', () => {
        expect(matchesTransportLanding(info, 0, before, { x: 2930, z: 4854, level: 0 })).toBe(false);
    });

    test('multiLandingNeedsRepath when live tile is far from planned to', () => {
        expect(multiLandingNeedsRepath(info, 0, { x: AUBURY.x, z: AUBURY.z, level: 0 })).toBe(true);
        expect(multiLandingNeedsRepath(info, 0, { x: SEDRIDOR.x, z: SEDRIDOR.z, level: 0 })).toBe(false);
        expect(multiLandingNeedsRepath(info, 0, { x: SEDRIDOR.x + 2, z: SEDRIDOR.z, level: 0 })).toBe(false);
        expect(multiLandingNeedsRepath(info, 0, { x: SEDRIDOR.x + 4, z: SEDRIDOR.z, level: 0 })).toBe(true);
        // Exact portals without acceptAnyLanding never force repath this way.
        expect(
            multiLandingNeedsRepath(
                { ...info, acceptAnyLanding: undefined },
                0,
                { x: AUBURY.x, z: AUBURY.z, level: 0 }
            )
        ).toBe(false);
    });
});
