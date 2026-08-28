import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'bun:test';
import { gunzipSync } from 'fflate';

import doors from '#/bot/event/webwalk/data/doors.json';
import stairs from '#/bot/event/webwalk/data/stairEdges.json';
import transports from '#/bot/event/webwalk/data/transports.json';
import { PathFinder, type DoorEdgeData, type NavPoint, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';

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
const rows = stairs as unknown as TransportEdgeData[];

/** trail_clue_easy_vague013, the chest upstairs in the eastern Falador houses. */
const CHEST_CLUE = 3497;
const FALADOR_EAST_BANK: NavPoint = { x: 3013, z: 3355, level: 0 };
/** The spiral staircase that reaches the chest, and the tile the house door opens onto. */
const STAIRS: NavPoint = { x: 3034, z: 3363, level: 0 };
const INSIDE_THE_DOOR: NavPoint = { x: 3038, z: 3362, level: 0 };

// The server accepts a Climb from a tile cardinally beside the loc with no wall between the two.
const SIDES: readonly [number, number, number][] = [
    [0, 1, 1 << 2],
    [1, 0, 1 << 3],
    [0, -1, 1 << 0],
    [-1, 0, 1 << 1]
];

function footprint(p: NavPoint): NavPoint[] {
    if (finder.walkable(p.x, p.z, p.level)) {
        return [];
    }
    const seen = new Set<string>([`${p.x},${p.z}`]);
    const solid = [p];
    const stack = [p];
    while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const [dx, dz] of SIDES) {
            const nx = cur.x + dx;
            const nz = cur.z + dz;
            if (Math.max(Math.abs(nx - p.x), Math.abs(nz - p.z)) > 1) {
                continue;
            }
            if (seen.has(`${nx},${nz}`) || finder.walkable(nx, nz, p.level)) {
                continue;
            }
            seen.add(`${nx},${nz}`);
            const tile = { x: nx, z: nz, level: p.level };
            solid.push(tile);
            stack.push(tile);
        }
    }
    return solid;
}

function operableTiles(p: NavPoint): Set<string> {
    const tiles = new Set<string>();
    for (const solid of footprint(p)) {
        for (const [dx, dz, facingWall] of SIDES) {
            const cx = solid.x + dx;
            const cz = solid.z + dz;
            if (finder.walkable(cx, cz, p.level) && (finder.wallMask(cx, cz, p.level) & facingWall) === 0) {
                tiles.add(`${cx},${cz}`);
            }
        }
    }
    return tiles;
}

const climbsUp = (e: TransportEdgeData): boolean => e.to.level > e.from.level && /-(up)/i.test(e.action);
const isLadder = (e: TransportEdgeData): boolean => /ladder/i.test(e.debugName ?? e.locName);

describe('eastern Falador house staircase', () => {
    test('every climb-up stands inside the house', () => {
        const inside = rows.filter(e => e.locX === STAIRS.x && e.locZ === STAIRS.z && climbsUp(e));
        expect(inside.map(e => `${e.from.x},${e.from.z}`).sort()).toEqual(['3034,3362', '3036,3363']);
    });
});

describe.skipIf(!HAS_COLLISION_PACK)('eastern Falador house routing', () => {
    test('the chest clue routes through the door and climbs from inside', () => {
        const chest = CLUE_DB[CHEST_CLUE]!.coord!;
        expect(chest).toEqual({ x: 3041, z: 3364, level: 1 });

        const route = finder.findPath(FALADOR_EAST_BANK, chest, undefined, 4_000_000);
        expect(route.ok).toBe(true);
        if (!route.ok) {
            return;
        }
        const door = route.hops.find(
            h => h.kind === 'door' && h.to.x === INSIDE_THE_DOOR.x && h.to.z === INSIDE_THE_DOOR.z && h.to.level === INSIDE_THE_DOOR.level
        );
        expect(door).toBeDefined();
        const climb = route.hops.find(h => h.kind === 'stair');
        expect(climb).toBeDefined();
        // Why: the hop's own tile is the tile the walker stands on to click, which is the thing that was wrong.
        expect(operableTiles(STAIRS).has(`${climb!.from.x},${climb!.from.z}`)).toBe(true);
    });

    test('no staircase is anchored on the far side of its own wall', () => {
        const walledOff = rows
            .filter(e => e.kind === 'stair' && !e.disabledReason && !isLadder(e) && e.locX !== undefined && e.locZ !== undefined)
            .filter(e => Math.max(Math.abs(e.locX! - e.from.x), Math.abs(e.locZ! - e.from.z)) <= 2)
            .filter(e => {
                const operable = operableTiles({ x: e.locX!, z: e.locZ!, level: e.from.level });
                return operable.size > 0 && !operable.has(`${e.from.x},${e.from.z}`);
            })
            .map(e => `${e.debugName ?? e.locName} (${e.locX},${e.locZ},L${e.from.level}) climbed from (${e.from.x},${e.from.z})`);
        expect(walledOff).toEqual([]);
    });
});
