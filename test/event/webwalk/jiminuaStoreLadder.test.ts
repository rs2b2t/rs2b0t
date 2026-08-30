import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import doors from '#/bot/event/webwalk/data/doors.json';
import stairs from '#/bot/event/webwalk/data/stairEdges.json';
import transports from '#/bot/event/webwalk/data/transports.json';
import { PathFinder, type DoorEdgeData, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import Tile from '#/bot/geometry/Tile.js';

const PACK_PATH = path.join(process.cwd(), 'out/collision.lcnav.gz');
const HAS_COLLISION_PACK = fs.existsSync(PACK_PATH);

function loadFinder(): PathFinder {
    let bytes: Uint8Array = new Uint8Array(fs.readFileSync(PACK_PATH));
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
        bytes = gunzipSync(bytes);
    }
    const built = new PathFinder(bytes);
    built.addEdges(doors as DoorEdgeData[], transports as TransportEdgeData[], stairs as TransportEdgeData[]);
    return built;
}

const finder = HAS_COLLISION_PACK ? loadFinder() : (null as unknown as PathFinder);
const STORE = { x: 2767, z: 3122, level: 0 };
const UPSTAIRS = { x: 2766, z: 3122, level: 1 };

describe('Jiminua store ladder', () => {
    test('upstairs is not "at" the counter on xz radius', () => {
        expect(new Tile(2766, 3122, 1).distanceTo(new Tile(2767, 3122, 0))).toBeGreaterThan(3);
    });
});

describe.skipIf(!HAS_COLLISION_PACK)('Jiminua store ladder pack', () => {
    test('ground walks to the counter never climb the lookout ladder', () => {
        const from = { x: 2790, z: 3094, level: 0 };
        const path = finder.findPath(from, STORE, undefined, 4_000_000);
        expect(path.ok).toBe(true);
        if (!path.ok) {
            return;
        }
        expect(path.hops.map(h => h.kind)).not.toContain('stair');
        expect(path.waypoints.every(w => w.level === 0)).toBe(true);
    });

    test('stranded upstairs climbs down to the counter', () => {
        const path = finder.findPath(UPSTAIRS, STORE, undefined, 4_000_000);
        expect(path.ok).toBe(true);
        if (!path.ok) {
            return;
        }
        expect(path.hops.some(h => h.kind === 'stair' && h.action === 'Climb-down')).toBe(true);
        expect(path.waypoints.at(-1)?.level).toBe(0);
    });
});
