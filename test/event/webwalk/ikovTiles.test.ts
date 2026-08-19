import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import doors from '#/bot/event/webwalk/data/doors.json';
import stairs from '#/bot/event/webwalk/data/stairEdges.json';
import transports from '#/bot/event/webwalk/data/transports.json';
import { PathFinder, type DoorEdgeData, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import { specialCrossingAt } from '#/bot/event/webwalk/data/specialCrossings.js';
import { GUARDIAN_STOP, ICE_CHESTS, IKOV_TILE, LUCIEN_START, WINELDA_STOP } from '#/bot/api/ai/quests/defs/ikov/areas.js';

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
    ...Object.entries(IKOV_TILE),
    ['Lucien anchor', LUCIEN_START.anchor],
    ['Winelda anchor', WINELDA_STOP.anchor],
    ['Guardian anchor', GUARDIAN_STOP.anchor]
];

/** Tiles the module walks to before an op; every one of them has to be routable from the temple ladder. */
const ROUTED: [string, { x: number; z: number; level: number }][] = [
    ['dungeon entrance', IKOV_TILE.ENTRANCE],
    ['Door of Fear, south side', IKOV_TILE.FEAR_GATE_SOUTH],
    ['south gate, north side', IKOV_TILE.SOUTH_GATE_NORTH],
    ['lever bracket', IKOV_TILE.LEVER_BRACKET],
    ['dark stairs down', IKOV_TILE.DARK_STAIRS_DOWN],
    ['trap lever', IKOV_TILE.TRAP_LEVER],
    ['east bank of the lava bridge', IKOV_TILE.BRIDGE_EAST],
    ['fire warrior door', IKOV_TILE.FIRE_DOOR_SOUTH],
    ['Winelda', IKOV_TILE.WINELDA]
];

// Why: each is entered by a script the graph cannot express, so a route appearing here is the bug, not the absence of one.
const SEALED: [string, { x: number; z: number; level: number }][] = [
    ['boots room', IKOV_TILE.DARK_LANDING],
    ['west of the lava bridge', IKOV_TILE.BRIDGE_WEST],
    ['Lever spawn', IKOV_TILE.IKOV_LEVER_SPAWN],
    ["guardians' temple", IKOV_TILE.GUARDIANS],
    ['secret wall, inner side', IKOV_TILE.SECRET_WALL_INSIDE]
];

describe.skipIf(!HAS_COLLISION_PACK)('Temple of Ikov stand tiles', () => {
    // Why: a stand tile beside an unwalkable loc is the classic silent failure — the op is dropped with no refusal and no movement.
    test('every named tile and anchor is walkable', () => {
        const blocked = STANDS
            .filter(([, t]) => !finder.walkable(t.x, t.z, t.level))
            .map(([name, t]) => `${name} (${t.x},${t.z},${t.level})`);
        expect(blocked).toEqual([]);
    });

    test('every leg the baked graph owns routes from the temple ladder', () => {
        const unreachable = ROUTED
            .filter(([, to]) => !finder.findPath(IKOV_TILE.TEMPLE_LADDER, to, undefined, 4_000_000).ok)
            .map(([name]) => name);
        expect(unreachable).toEqual([]);
    });

    test('every chest stand is walkable and routes from the temple ladder', () => {
        for (const { stand } of ICE_CHESTS) {
            expect(finder.walkable(stand.x, stand.z, stand.level)).toBe(true);
            const route = finder.findPath(IKOV_TILE.TEMPLE_LADDER, { x: stand.x, z: stand.z, level: stand.level }, undefined, 4_000_000);
            expect(route.ok).toBe(true);
        }
    });

    test('the scripted pockets stay sealed', () => {
        const routed = SEALED
            .filter(([, to]) => finder.findPath(IKOV_TILE.TEMPLE_LADDER, to, undefined, 4_000_000).ok)
            .map(([name]) => name);
        expect(routed).toEqual([]);
    });

    // Why: Winelda's teleport is the way in and the shiny key door is the way out, so both sides are the module's problem, not the walker's.
    test("Winelda's landing reaches the shiny key and the secret wall", () => {
        for (const to of [IKOV_TILE.SHINY_KEY_SPAWN, IKOV_TILE.SECRET_WALL, IKOV_TILE.MCGRUBOR_LADDER]) {
            expect(finder.findPath(IKOV_TILE.WINELDA_LANDING, to, undefined, 4_000_000).ok).toBe(true);
        }
    });
});

describe('Temple of Ikov shiny key door', () => {
    test('the McGrubor door is a keyed special crossing', () => {
        const crossing = specialCrossingAt(2657, 3496, 0);
        expect(crossing).not.toBeNull();
        expect(crossing?.requires).toEqual({ item: 'Shiny key', count: 1 });
    });

    // Why: without the pruning a keyless bot plans through a door that answers "The door is locked." and loops at it.
    test('the door is still a baked edge, so the key makes it usable rather than adding it', () => {
        const baked = (doors as DoorEdgeData[]).some(d => d.x === 2657 && d.z === 3496 && d.level === 0);
        expect(baked).toBe(true);
    });
});
