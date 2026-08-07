import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';

import { PathFinder, type TransportEdgeData } from '#/bot/nav/PathFinder.js';
import { matchesTransportLoc } from '#/bot/nav/WalkExecutor.js';
import doorsJson from '#/bot/nav/data/doors.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import transports from '#/bot/nav/data/transports.json';

/** Edgeville dungeon surface trapdoor (#285). */
const EDGEVILLE_TRAP = {
    from: { x: 3096, z: 3468, level: 0 },
    to: { x: 3096, z: 9868, level: 0 },
    locName: 'Trapdoor',
    action: 'Climb-down',
    kind: 'dungeon'
} as const;

/** Falador party-room trapdoor into the Dwarven Mine (surface hop used by mining seeds). */
const DWARVEN_TRAP = {
    from: { x: 3019, z: 3449, level: 0 },
    to: { x: 3019, z: 9849, level: 0 },
    locName: 'Trapdoor',
    action: 'Climb-down',
    kind: 'dungeon'
} as const;

function findEdge(expected: typeof EDGEVILLE_TRAP | typeof DWARVEN_TRAP): TransportEdgeData | undefined {
    return (transports as TransportEdgeData[]).find(
        t =>
            t.from.x === expected.from.x
            && t.from.z === expected.from.z
            && t.from.level === expected.from.level
            && t.to.x === expected.to.x
            && t.to.z === expected.to.z
            && t.locName === expected.locName
            && t.action === expected.action
            && t.kind === expected.kind
    );
}

const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');
/** Pack is gitignored — pack-dependent tests must skip, never silent-pass (#341). */
const HAS_COLLISION_PACK = fs.existsSync(PACK_PATH);

function loadPack(): PathFinder {
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(PACK_PATH));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = new Uint8Array(gunzipSync(bytes));
    }
    const finder = new PathFinder(bytes as Uint8Array);
    finder.addEdges(doorsJson as never, transports as never, stairsJson as never);
    return finder;
}

describe('Trapdoor closed/open metadata', () => {
    test('Edgeville and Dwarven Mine trapdoors pair closed locId with openLocId', () => {
        for (const expected of [EDGEVILLE_TRAP, DWARVEN_TRAP]) {
            const edge = findEdge(expected);
            expect(edge, JSON.stringify(expected.from)).toBeDefined();
            expect(edge!.locId).toBeDefined();
            expect(edge!.openLocId).toBeDefined();
            expect(edge!.locId).not.toBe(edge!.openLocId);
            // Conventional pair for generic trapdoor
            expect(edge!.locId).toBe(1568);
            expect(edge!.openLocId).toBe(1570);
            expect(edge!.locX).toBeDefined();
            expect(edge!.locZ).toBeDefined();
        }
    });

    test('matchesTransportLoc accepts closed placement and open transform', () => {
        const edge = findEdge(EDGEVILLE_TRAP)!;
        const transport = {
            locName: edge.locName,
            action: edge.action,
            locX: edge.locX!,
            locZ: edge.locZ!,
            locId: edge.locId,
            openLocId: edge.openLocId
        };
        const closed = {
            id: edge.locId!,
            tile: () => ({ x: edge.locX!, z: edge.locZ! })
        };
        const open = {
            id: edge.openLocId!,
            tile: () => ({ x: edge.locX! - 1, z: edge.locZ! }) // open may shift one tile
        };
        expect(matchesTransportLoc(transport, closed)).toBe(true);
        expect(matchesTransportLoc(transport, open)).toBe(true);
    });
});

describe('Dwarven Mine + Edgeville trapdoor paths', () => {
    test.skipIf(!HAS_COLLISION_PACK)('pack: surface near Dwarven trapdoor reaches underground landing', () => {
        const finder = loadPack();
        const edge = findEdge(DWARVEN_TRAP);
        expect(edge).toBeDefined();
        expect(finder.walkable(DWARVEN_TRAP.from.x, DWARVEN_TRAP.from.z, 0)).toBe(true);
        expect(finder.walkable(DWARVEN_TRAP.to.x, DWARVEN_TRAP.to.z, 0)).toBe(true);

        const start = { x: 3015, z: 3449, level: 0 };
        const dest = { x: 3019, z: 9849, level: 0 };
        const route = finder.findPath(start, dest);
        expect(route.ok).toBe(true);
        if (!route.ok) {
            return;
        }
        const hop = route.waypoints.find(
            w => w.transport?.locName === 'Trapdoor' && w.transport?.action === 'Climb-down'
        );
        expect(hop).toBeDefined();
        expect(hop!.transport!.openLocId ?? hop!.transport!.locId).toBeDefined();
    });

    test.skipIf(!HAS_COLLISION_PACK)('pack: Edgeville dungeon field still exits via ladder after trapdoor metadata', () => {
        const finder = loadPack();
        const field = { x: 3111, z: 9937, level: 0 };
        const falador = { x: 2965, z: 3378, level: 0 };
        const route = finder.findPath(field, falador);
        expect(route.ok).toBe(true);
        if (!route.ok) {
            return;
        }
        const climb = route.waypoints.find(
            w => w.transport?.locName === 'Ladder' && w.transport?.action === 'Climb-up'
        );
        expect(climb).toBeDefined();
    });
});
