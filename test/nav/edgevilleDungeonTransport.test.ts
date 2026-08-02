import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';

import { PathFinder, type TransportEdgeData } from '#/bot/nav/PathFinder.js';
import doorsJson from '#/bot/nav/data/doors.json';
import stairsJson from '#/bot/nav/data/stairEdges.json';
import transports from '#/bot/nav/data/transports.json';

/** Chaos Druid field (Edgeville dungeon) → surface Falador centre. Issue #285. */
const DUNGEON_FIELD = { x: 3111, z: 9937, level: 0 } as const;
const FALADOR = { x: 2965, z: 3378, level: 0 } as const;
const TRAPDOOR_SURFACE = { x: 3096, z: 3468, level: 0 } as const;
const LADDER_UNDER = { x: 3096, z: 9868, level: 0 } as const;

const EDGEVILLE_PAIR = [
    {
        from: TRAPDOOR_SURFACE,
        to: LADDER_UNDER,
        locName: 'Trapdoor',
        action: 'Climb-down',
        kind: 'dungeon'
    },
    {
        from: LADDER_UNDER,
        to: TRAPDOOR_SURFACE,
        locName: 'Ladder',
        action: 'Climb-up',
        kind: 'dungeon'
    }
] as const satisfies readonly TransportEdgeData[];

function loadPack(): PathFinder | null {
    const packPath = path.join(process.cwd(), 'out/collision.lcnav.gz');
    if (!fs.existsSync(packPath)) {
        return null;
    }
    let bytes = new Uint8Array(fs.readFileSync(packPath));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = gunzipSync(bytes);
    }
    const finder = new PathFinder(bytes);
    finder.addEdges(doorsJson as never, transports as never, stairsJson as never);
    return finder;
}

describe('Edgeville dungeon transports (#285)', () => {
    test('transports.json includes trapdoor ↔ ladder stands used by ChaosDruidKiller', () => {
        for (const edge of EDGEVILLE_PAIR) {
            const hit = (transports as TransportEdgeData[]).find(
                t =>
                    t.from.x === edge.from.x
                    && t.from.z === edge.from.z
                    && t.from.level === edge.from.level
                    && t.to.x === edge.to.x
                    && t.to.z === edge.to.z
                    && t.locName === edge.locName
                    && t.action === edge.action
                    && t.kind === edge.kind
            );
            expect(hit).toBeDefined();
        }
    });

    test('pack path: Chaos field → Falador climbs the Edgeville ladder', () => {
        const finder = loadPack();
        if (!finder) {
            // CI without a built collision pack still validates the transport rows above.
            return;
        }
        expect(finder.walkable(TRAPDOOR_SURFACE.x, TRAPDOOR_SURFACE.z, 0)).toBe(true);
        expect(finder.walkable(LADDER_UNDER.x, LADDER_UNDER.z, 0)).toBe(true);

        const route = finder.findPath(DUNGEON_FIELD, FALADOR);
        expect(route.ok).toBe(true);
        const hops = route.waypoints.filter(w => w.transport);
        const climb = hops.find(
            w =>
                w.transport?.locName === 'Ladder'
                && w.transport?.action === 'Climb-up'
                && w.transport?.locX === LADDER_UNDER.x
                && w.transport?.locZ === LADDER_UNDER.z
        );
        expect(climb).toBeDefined();
    });
});
