import { loadDefaultFinder } from '../../lib/navigation.js';
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { emptyWorldStateData } from '#/bot/event/webwalk/worldStateData.js';
import doors from '#/bot/event/webwalk/data/doors.json';

const FIELD = { x: 2664, z: 3347, level: 0 } as const;
const BANK = { x: 2616, z: 3332, level: 0 } as const;
const GATE_LEAVES = [
    { x: 2675, z: 3349, level: 0, locId: 1553, locName: 'Gate', dir: 'E' },
    { x: 2675, z: 3350, level: 0, locId: 1551, locName: 'Gate', dir: 'E' }
] as const;

const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');
const HAS_COLLISION_PACK = fs.existsSync(PACK_PATH);

describe('CowKiller East Ardougne route', () => {
    test('the map-derived two-leaf pen gate remains in the door graph', () => {
        for (const leaf of GATE_LEAVES) {
            expect(doors).toContainEqual(leaf);
        }
    });

    test.skipIf(!HAS_COLLISION_PACK)('the East Ardougne bank and cow anchor are walkable both ways through the gate', () => {
        const finder = loadDefaultFinder(PACK_PATH);
        const state = emptyWorldStateData(true);

        expect(finder.walkable(FIELD.x, FIELD.z, FIELD.level)).toBe(true);
        expect(finder.walkable(BANK.x, BANK.z, BANK.level)).toBe(true);

        for (const [from, to] of [
            [BANK, FIELD],
            [FIELD, BANK]
        ] as const) {
            const route = finder.findPath(from, to, {
                state,
                useTeleportCatalog: false
            });
            expect(route.ok).toBe(true);
            if (!route.ok) {
                continue;
            }
            expect(route.hops).toHaveLength(1);
            expect(route.hops[0]?.kind).toBe('door');
            expect(route.hops[0]?.locName).toBe('Gate');
            expect(route.waypoints.some(waypoint => waypoint.transport?.locName === 'Gate' && GATE_LEAVES.some(leaf => leaf.locId === waypoint.transport?.locId))).toBe(true);
        }
    });
});
