import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import doors from '#/bot/event/webwalk/data/doors.json';
import stairs from '#/bot/event/webwalk/data/stairEdges.json';
import transports from '#/bot/event/webwalk/data/transports.json';
import { PathFinder, type DoorEdgeData, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import {
    BARAEK, CURATOR, KATRINE_JOIN, RELDO, ROALD, SOA_TILE, STRAVEN_JOIN, TRAMP
} from '#/bot/api/ai/quests/defs/shieldofarrav/areas.js';

// The pack is a build artifact, not a committed file, so CI runs without it.
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

const STANDS: [string, { x: number; z: number; level: number }][] = [
    ...Object.entries(SOA_TILE),
    ['RELDO anchor', RELDO.anchor],
    ['BARAEK anchor', BARAEK.anchor],
    ['TRAMP anchor', TRAMP.anchor],
    ['STRAVEN anchor', STRAVEN_JOIN.anchor],
    ['KATRINE anchor', KATRINE_JOIN.anchor],
    ['CURATOR anchor', CURATOR.anchor],
    ['ROALD anchor', ROALD.anchor]
];

describe.skipIf(!HAS_COLLISION_PACK)('shield of arrav stand tiles', () => {
    // Why: a stand tile beside an unwalkable loc is the classic silent failure — the op is dropped with no refusal and no movement.
    test('every named tile and anchor is walkable', () => {
        const blocked = STANDS
            .filter(([, t]) => !finder.walkable(t.x, t.z, t.level))
            .map(([name, t]) => `${name} (${t.x},${t.z},${t.level})`);
        expect(blocked).toEqual([]);
    });

    test('the weapon store upper floor reaches both crossbow spawns from the ladder landing', () => {
        for (const spawn of [SOA_TILE.CROSSBOW_WEST, SOA_TILE.CROSSBOW_EAST]) {
            const route = finder.findPath(SOA_TILE.STORE_LADDER_TOP, spawn, undefined, 4_000_000);
            expect(route.ok).toBe(true);
        }
    });

    test('the Black Arm upper floor reaches the cupboard from the stairs landing', () => {
        const route = finder.findPath(SOA_TILE.BLACKARM_STAIRS_TOP, SOA_TILE.CUPBOARD_STAND, undefined, 4_000_000);
        expect(route.ok).toBe(true);
    });

    test('the hideout reaches the chest from the door\'s inner side', () => {
        const route = finder.findPath(SOA_TILE.PHOENIX_DOOR_INNER, SOA_TILE.CHEST_STAND, undefined, 4_000_000);
        expect(route.ok).toBe(true);
    });

    // Why: the door is the hideout's only crossing and it teleports rather than steps, so a leg that merely walks at the chest never arrives.
    test('the chest is unreachable from the ladder landing without driving the door', () => {
        for (const from of [SOA_TILE.HQ_LADDER, SOA_TILE.PHOENIX_DOOR]) {
            expect(finder.findPath(from, SOA_TILE.CHEST_STAND, undefined, 4_000_000).ok).toBe(false);
        }
    });
});
