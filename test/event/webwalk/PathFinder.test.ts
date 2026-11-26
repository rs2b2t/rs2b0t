import { describe, expect, test } from 'bun:test';
import { PathFinder, type TransportEdgeData } from '#/bot/event/webwalk/PathFinder.js';
import { twoLevelCollisionPack } from '../../fixtures/two-level-collision-pack.js';
import { isolatedLandingFinder } from '../../lib/navCollision.js';

for (const version of [1, 2]) {
    test(`LCNV v${version} indexes tile masks by level and enumerates squares in numeric order`, () => {
        const perLevel = 4096 + 512 + (version === 2 ? 2048 : 0);
        const bytes = new Uint8Array(10 + 6 + 3 * perLevel);
        bytes.set([0x4c, 0x43, 0x4e, 0x56, version, 1, 0, 0, 2, 0]);
        bytes.set([50, 49, 0b1001], 10);
        const high = 13 + perLevel;
        bytes[high] = 8;
        bytes[high + 4096] = 2;
        if (version === 2) bytes[high + 4096 + 512] = 0x73;
        bytes.set([1, 2, 1], high + perLevel);
        const finder = new PathFinder(bytes);

        expect(finder.populatedSquares()).toEqual([
            { level: 0, mx: 1, mz: 2 },
            { level: 0, mx: 50, mz: 49 },
            { level: 3, mx: 50, mz: 49 }
        ]);
        const masks = (x: number, z: number, level: number) => [
            finder.walkable(x, z, level), finder.exitMask(x, z, level), finder.wallMask(x, z, level)
        ];
        expect(masks(3200, 3136, 3)).toEqual([false, 8, version === 2 ? 3 : 0]);
        expect(masks(3200, 3137, 3)).toEqual([true, 0, version === 2 ? 7 : 0]);
        expect(masks(3200, 3136, 0)).toEqual([false, 0, 0]);
        expect(masks(3200, 3137, 1)).toEqual([false, 0, 0]);
        expect(masks(3264, 3137, 3)).toEqual([false, 0, 0]);
    });
}

describe('PathFinder A* heuristic with transport shortcuts (#335)', () => {
    test('prefers a cheap long-range transport over pure walk', () => {
        // start (0,0) → goal (60,0); portal (0,10)→(59,0) costs ticksToCost(10)=20.
        // Optimal is walk 10 + hop 20 + walk 1 = 31 against 60 for a pure walk.
        const finder = new PathFinder(twoLevelCollisionPack([[0, 0]]));
        const hop: TransportEdgeData = {
            from: { x: 0, z: 10, level: 0 },
            to: { x: 59, z: 0, level: 0 },
            locName: 'Portal',
            action: 'Enter',
            kind: 'portal'
        };
        finder.addEdges([], [hop], []);
        const out = finder.findPath(
            { x: 0, z: 0, level: 0 },
            { x: 60, z: 0, level: 0 },
            { maxExpansions: 50_000 }
        );
        expect(out.ok).toBe(true);
        if (!out.ok) {
            return;
        }
        expect(out.cost).toBe(31);
        expect(out.waypoints.some(w => w.transport?.kind === 'portal')).toBe(true);
    });

    test('walk-only still returns Chebyshev-optimal cost', () => {
        const finder = new PathFinder(twoLevelCollisionPack([[0, 0]]));
        // No edges added → pure walk. Pack is fully walkable in a small region.
        const out = finder.findPath(
            { x: 0, z: 0, level: 0 },
            { x: 5, z: 0, level: 0 }
        );
        expect(out.ok).toBe(true);
        if (out.ok) {
            expect(out.cost).toBe(5);
        }
    });

    test('follows chained shortcuts when the first landing is farther from the goal', () => {
        const finder = new PathFinder(twoLevelCollisionPack([[0, 0]]));
        const from = { x: 5, z: 5, level: 0 };
        const to = { x: 55, z: 5, level: 0 };
        const landing = { x: 4, z: 50, level: 0 };
        const tunnel = { locName: 'Tunnel', action: 'Enter', kind: 'shortcut' };
        finder.addEdges([], [
            { ...tunnel, from: { ...from, x: 6 }, to: landing },
            { ...tunnel, from: { ...landing, z: 51 }, to }
        ]);
        expect(finder.findPath(from, to, { maxExpansions: 10 })).toMatchObject({ ok: true, cost: 22 });
    });

    test('accounts for the far doorway on a long route and a new landing inside it', () => {
        const room = v2Pack();
        for (let i = 27; i <= 37; i++) {
            room.blockTile(27, i);
            room.blockTile(37, i);
            room.blockTile(i, 27);
            if (i !== 32) room.blockTile(i, 37);
        }
        const remote = v2Pack(2, 0).bytes;
        const pack = new Uint8Array(room.bytes.length + remote.length - 10);
        pack.set(room.bytes);
        pack.set(remote.subarray(10), room.bytes.length);
        pack[8] = 2;
        const finder = new PathFinder(pack);
        const start = { x: 140, z: 16, level: 0 };
        const landing = { x: 32, z: 16, level: 0 };
        const goal = { ...landing, z: 32 };
        const tunnel = { kind: 'shortcut', locName: 'Tunnel', action: 'Enter' };
        finder.addEdges([], [{ ...tunnel, from: start, to: landing }]);
        expect(finder.findPath(start, goal, { maxExpansions: 500 })).toMatchObject({ ok: true, cost: 42 });

        finder.addEdges([], [{ ...tunnel, from: { ...landing, x: 33 }, to: { ...goal, z: 33 } }]);
        expect(finder.findPath(start, goal)).toMatchObject({ ok: true, cost: 22 });
    });

    const caster = {
        members: true, skills: { magic: 25 }, quests: {}, freeSlots: 25,
        items: { 'Law rune': 1, 'Fire rune': 1, 'Air rune': 3 }
    };

    test('only skips casts for a legal two-step walk', () => {
        const from = { x: 3211, z: 3424, level: 0 };
        const to = { ...from, x: 3213 };
        const pack = twoLevelCollisionPack([[50, 53]], 0);
        const startExit = 13 + (from.x & 63) * 64 + (from.z & 63);
        pack[startExit] = 2;
        pack[startExit + 64] = 2;
        const finder = new PathFinder(pack);
        const opts = { state: caster, useTeleportCatalog: true };
        expect(finder.findPath(from, to, { ...opts, maxExpansions: 2 })).toEqual({
            ok: true, cost: 2, expanded: 2, waypoints: [from, to], hops: []
        });
        expect(finder.findPath(from, to, { ...opts, maxExpansions: 1 })).toMatchObject({ ok: false, expanded: 2 });
        const spell = { ok: true, cost: 10, hops: [{ kind: 'teleport' }] };
        const avoidZones = [{ minX: 3212, maxX: 3212, minZ: from.z, maxZ: from.z }];
        expect(finder.findPath(from, to, { ...opts, avoidZones })).toMatchObject(spell);
        pack[startExit + 64] = 0;
        expect(new PathFinder(pack).findPath(from, to, opts)).toMatchObject(spell);
    });

    test('can return to the start and cast after an essence entry changes the available exit', () => {
        const from = { x: 3201, z: 3430, level: 0 };
        const entry = { ...from, x: 3202 };
        const varrock = { x: 3213, z: 3424, level: 0 };
        const goal = { ...varrock, x: 3243 };
        const pack = twoLevelCollisionPack([[50, 53]], 0);
        pack[13 + (entry.x & 63) * 64 + (entry.z & 63)] = 1 << 3;
        const finder = new PathFinder(pack);
        const tunnel = { kind: 'dungeon', locName: 'Tunnel', action: 'Enter' };
        finder.addEdges([], [
            { ...tunnel, from, to: entry, requires: { essenceEntrySetsReturn: 'sedridor' } },
            { ...tunnel, from: varrock, to: goal, requires: { essenceExitReturn: 'sedridor' } }
        ]);
        expect(finder.findPath(from, goal, {
            useTeleportCatalog: true, state: { ...caster, essenceExitReturn: 'aubury' }
        })).toMatchObject({ ok: true, cost: 27, hops: [{ kind: 'dungeon' }, { kind: 'teleport' }, { kind: 'dungeon' }] });
    });

    test.each([
        { useShortcuts: true, maxExpansions: 100, cost: 11, transport: { kind: 'shortcut' } },
        { useShortcuts: true, maxExpansions: 10, cost: 11, transport: { kind: 'shortcut' } },
        { useShortcuts: false, maxExpansions: 100, cost: 40, transport: { teleportId: 'varrock' } }
    ])('chooses the cheapest route with Varrock teleport available at budget $maxExpansions and useShortcuts=$useShortcuts', opts => {
        const finder = new PathFinder(v2Pack(50, 53).bytes);
        const from = { x: 3201, z: 3430, level: 0 };
        const to = { x: 3243, z: 3424, level: 0 };
        finder.addEdges([], [{ from: { ...from, x: 3202 }, to, locName: 'Tunnel', action: 'Enter', kind: 'shortcut' }]);
        const out = finder.findPath(from, to, {
            policy: { useShortcuts: opts.useShortcuts, useTeleports: true },
            state: caster,
            maxExpansions: opts.maxExpansions
        });
        expect(out).toMatchObject({ ok: true, cost: opts.cost });
        if (out.ok) {
            expect(out.waypoints.find(w => w.transport)?.transport).toMatchObject(opts.transport);
        }
    });
});

describe('PathFinder level-change avoidance', () => {
    const from = { x: 10, z: 10, level: 0 };
    const to = { x: 10, z: 12, level: 1 };
    const stair: TransportEdgeData = { from, to, locName: 'Test Staircase', action: 'Climb-up', kind: 'stair' };

    test("opening a door and returning cannot reverse the Wizards' Tower staircase", () => {
        const start = { x: 3103, z: 3161, level: 1 };
        const ground = { x: 3105, z: 3160, level: 0 };
        const landing = { x: 3103, z: 3158, level: 1 };
        const besideDoor = { ...ground, z: ground.z + 1 };
        const finder = isolatedLandingFinder([start, ground, landing, besideDoor]);
        finder.addEdges([{ ...ground, dir: 'N', locId: 1, locName: 'Door' }], []);
        expect(finder.findPath(start, besideDoor)).toMatchObject({ ok: true, cost: 10 });
        expect(finder.findPath(ground, landing)).toMatchObject({ ok: true, cost: 6 });
        expect(finder.findPath(start, landing)).toMatchObject({ ok: false, reason: 'unreachable' });
    });

    test('level-change transport is used when its key is NOT avoided', () => {
        const finder = new PathFinder(twoLevelCollisionPack([[0, 0]]));
        finder.addEdges([], [], [stair]);
        const out = finder.findPath(from, to);
        expect(out.ok).toBe(true);
    });

    test('level-change transport is EXCLUDED when its from-tile key is avoided', () => {
        const finder = new PathFinder(twoLevelCollisionPack([[0, 0]]));
        finder.addEdges([], [], [stair]);
        const out = finder.findPath(from, to, new Set([`${from.x}|${from.z}`]));
        expect(out.ok).toBe(false);
    });
});

describe('PathFinder transport loc metadata', () => {
    const from = { x: 10, z: 10, level: 0 };
    const to = { x: 10, z: 12, level: 1 };

    test('propagates the exact clickable loc rather than the stand tile', () => {
        const finder = new PathFinder(twoLevelCollisionPack([[0, 0]]));
        const stair: TransportEdgeData = {
            from,
            to,
            locName: 'Ladder',
            action: 'Climb-up',
            kind: 'stair',
            locId: 1747,
            locX: 11,
            locZ: 10,
            debugName: 'ladder',
            options: ['Climb-up']
        };
        finder.addEdges([], [], [stair]);

        const out = finder.findPath(from, to);
        expect(out.ok).toBe(true);
        if (out.ok) {
            const transport = out.waypoints.find(waypoint => waypoint.transport)?.transport;
            expect(transport).toMatchObject({ locId: 1747, locX: 11, locZ: 10 });
        }
    });

    test('retains the stand-tile fallback for legacy edges', () => {
        const finder = new PathFinder(twoLevelCollisionPack([[0, 0]]));
        const stair: TransportEdgeData = { from, to, locName: 'Ladder', action: 'Climb-up', kind: 'stair' };
        finder.addEdges([], [], [stair]);

        const out = finder.findPath(from, to);
        expect(out.ok).toBe(true);
        if (out.ok) {
            const transport = out.waypoints.find(waypoint => waypoint.transport)?.transport;
            expect(transport).toMatchObject({ locX: from.x, locZ: from.z });
            expect(transport?.locId).toBeUndefined();
        }
    });

    test('does not compile a documented disabled edge', () => {
        const finder = new PathFinder(twoLevelCollisionPack([[0, 0]]));
        const stair: TransportEdgeData = {
            from,
            to,
            locName: 'Ladder',
            action: 'Climb-down',
            kind: 'stair',
            disabledReason: 'The destination has no Climb-down loc.'
        };
        finder.addEdges([], [], [stair]);

        expect(finder.transportEdges).toBe(0);
        expect(finder.findPath(from, to).ok).toBe(false);
    });
});

const DX8 = [0, 1, 0, -1, 1, 1, -1, -1];
const DZ8 = [1, 0, -1, 0, 1, -1, -1, 1];

function v2Pack(mx = 0, mz = 0): { bytes: Uint8Array; blockTile(x: number, z: number): void } {
    const perLevel = 4096 + 512 + 2048;
    const bytes = new Uint8Array(10 + 3 + perLevel);
    bytes[0] = 0x4c;
    bytes[1] = 0x43;
    bytes[2] = 0x4e;
    bytes[3] = 0x56;
    bytes[4] = 2;
    bytes[5] = 0;
    bytes[8] = 1;
    bytes[10] = mx;
    bytes[11] = mz;
    bytes[12] = 0b0001;
    const exitBase = 13;
    const walkBase = exitBase + 4096;
    bytes.fill(0xff, exitBase, exitBase + 4096);
    bytes.fill(0xff, walkBase, walkBase + 512);
    const idx = (x: number, z: number) => (x & 63) * 64 + (z & 63);
    const blockTile = (x: number, z: number): void => {
        const i = idx(x, z);
        bytes[walkBase + (i >> 3)] &= ~(1 << (i & 7));
        for (let d = 0; d < 8; d++) {
            const nx = x - DX8[d];
            const nz = z - DZ8[d];
            if (nx < 0 || nz < 0 || nx > 63 || nz > 63) continue;
            bytes[exitBase + idx(nx, nz)] &= ~(1 << d);
        }
    };
    return { bytes, blockTile };
}

describe('wall-aware goal candidates (W4)', () => {
    function roomPack(): Uint8Array {
        const { bytes, blockTile } = v2Pack();
        for (let x = 7; x <= 13; x++) {
            for (let z = 7; z <= 13; z++) {
                const onRing = x === 7 || x === 13 || z === 7 || z === 13;
                if (onRing) blockTile(x, z);
            }
        }
        blockTile(10, 10);
        return bytes;
    }

    test('outside → interior target: NO wall-blind ring goal (honest unreachable)', () => {
        const finder = new PathFinder(roomPack());
        finder.addEdges([], [], []);
        const out = finder.findPath({ x: 2, z: 10, level: 0 }, { x: 10, z: 10, level: 0 });
        expect(out.ok).toBe(false);
    });

    test('inside → interior target: terminates cardinally beside it', () => {
        const finder = new PathFinder(roomPack());
        finder.addEdges([], [], []);
        const out = finder.findPath({ x: 9, z: 9, level: 0 }, { x: 10, z: 10, level: 0 });
        expect(out.ok).toBe(true);
        if (out.ok) {
            const t = out.waypoints[out.waypoints.length - 1];
            const cardinal = Math.abs(t.x - 10) + Math.abs(t.z - 10) === 1;
            expect(cardinal).toBe(true);
        }
    });

    test('sealed enclave target in the open: ring fallback keeps it harmless', () => {
        const { bytes, blockTile } = v2Pack();
        blockTile(30, 30);
        blockTile(29, 30);
        blockTile(31, 30);
        blockTile(30, 29);
        blockTile(30, 31);
        const finder = new PathFinder(bytes);
        finder.addEdges([], [], []);
        const out = finder.findPath({ x: 2, z: 30, level: 0 }, { x: 30, z: 30, level: 0 });
        expect(out.ok).toBe(true);
    });
});
