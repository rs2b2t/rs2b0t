import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseJm2Locs, MAZE_ORIGIN, DOOR_DIRS } from '#/bot/api/maze/mazeGraph.js';
import { buildMaze, edgeKey, doorPassable } from '#/bot/api/maze/mazeGraph.js';
import { solveRoute, MAZE_SHRINE, MAZE_SPAWNS } from '#/bot/api/maze/mazeGraph.js';

const MAP = new URL('./fixtures/m45_71.jm2', import.meta.url).pathname;

describe('parseJm2Locs', () => {
    test('parses "level lx lz: id shape angle" with defaults', () => {
        const locs = parseJm2Locs('==== LOC ====\n0 8 43: 3628 0 2\n0 31 31: 3634 10\n1 0 0: 9999 0 0\n');
        expect(locs).toEqual([
            { lx: 8, lz: 43, id: 3628, shape: 0, angle: 2 },
            { lx: 31, lz: 31, id: 3634, shape: 10, angle: 0 }
        ]);
    });

    test('ignores the MAP height section', () => {
        expect(parseJm2Locs('==== MAP ====\n0 0 0: h30\n==== LOC ====\n0 1 2: 3626 0 0\n')).toHaveLength(1);
    });

    test('real map: expected maze loc population', () => {
        const locs = parseJm2Locs(readFileSync(MAP, 'utf8'));
        const count = (id: number): number => locs.filter(l => l.id === id).length;
        expect(count(3626)).toBe(1459);
        expect(count(3628)).toBe(45);
        expect(Object.keys(DOOR_DIRS).reduce((n, id) => n + count(Number(id)), 0)).toBe(49);
        expect(count(3634)).toBe(1);
        expect(MAZE_ORIGIN).toEqual({ x: 2880, z: 4544 });
    });
});

describe('buildMaze edge model', () => {
    test('wall_straight blocks its one cardinal edge (angle EAST=2)', () => {
        const g = buildMaze([{ lx: 10, lz: 10, id: 3626, shape: 0, angle: 2 }]);
        expect(g.wallEdge.has(edgeKey(2890, 4554, 2891, 4554))).toBe(true);
        expect(g.wallEdge.has(edgeKey(2890, 4554, 2889, 4554))).toBe(false);
    });

    test('wall_L (shape 2, angle WEST=0) blocks NORTH and WEST edges', () => {
        const g = buildMaze([{ lx: 10, lz: 10, id: 3626, shape: 2, angle: 0 }]);
        expect(g.wallEdge.has(edgeKey(2890, 4554, 2890, 4555))).toBe(true);
        expect(g.wallEdge.has(edgeKey(2890, 4554, 2889, 4554))).toBe(true);
        expect(g.wallEdge.has(edgeKey(2890, 4554, 2891, 4554))).toBe(false);
    });

    test('square_corner (shape 3) contributes no cardinal wall', () => {
        expect(buildMaze([{ lx: 10, lz: 10, id: 3626, shape: 3, angle: 0 }]).wallEdge.size).toBe(0);
    });

    test('door recorded on its edge with tile/id/angle', () => {
        const g = buildMaze([{ lx: 10, lz: 10, id: 3628, shape: 0, angle: 2 }]);
        const info = g.door.get(edgeKey(2890, 4554, 2891, 4554));
        expect(info).toEqual({ tile: { x: 2890, z: 4554 }, id: 3628, angle: 2 });
    });
});

describe('doorPassable gating', () => {
    const d1 = { tile: { x: 2890, z: 4554 }, id: 3629, angle: 2 };
    test('dir-1 opens from axis-aligned side only', () => {
        expect(doorPassable(d1, 2890, 4554)).toBe(true);
        expect(doorPassable(d1, 2891, 4554)).toBe(false);
    });
    const d2 = { tile: { x: 2890, z: 4554 }, id: 3630, angle: 1 };
    test('dir-2 opens from off-axis side only', () => {
        expect(doorPassable(d2, 2890, 4554)).toBe(false);
        expect(doorPassable(d2, 2890, 4555)).toBe(true);
    });
    test('dir-0 opens from either side', () => {
        const d0 = { tile: { x: 2890, z: 4554 }, id: 3628, angle: 2 };
        expect(doorPassable(d0, 2890, 4554)).toBe(true);
        expect(doorPassable(d0, 2891, 4554)).toBe(true);
    });
});

describe('buildMaze on real map', () => {
    test('49 doors, non-empty walls, bounds inside the region', () => {
        const g = buildMaze(parseJm2Locs(readFileSync(MAP, 'utf8')));
        expect(g.door.size).toBe(49);
        expect(g.wallEdge.size).toBeGreaterThan(1000);
        expect(g.minx).toBeGreaterThanOrEqual(2880);
        expect(g.maxx).toBeLessThanOrEqual(2943);
    });
});

describe('solveRoute (synthetic 1-D corridor)', () => {
    function corridor(): ReturnType<typeof buildMaze> {
        const g = buildMaze([]);
        for (let z = 4570; z <= 4575; z++) {
            g.wallEdge.add(edgeKey(2900, z, 2899, z));
            g.wallEdge.add(edgeKey(2900, z, 2901, z));
        }
        g.door.set(edgeKey(2900, 4572, 2900, 4573), { tile: { x: 2900, z: 4572 }, id: 3628, angle: 1 });
        return g;
    }
    test('returns the single door between spawn and shrine', () => {
        const route = solveRoute(corridor(), { x: 2900, z: 4570 }, { x: 2900, z: 4575 });
        expect(route).toEqual([{ x: 2900, z: 4572 }]);
    });
    test('gated door blocks the wrong-side approach (empty route)', () => {
        const g = corridor();
        g.door.set(edgeKey(2900, 4572, 2900, 4573), { tile: { x: 2900, z: 4572 }, id: 3630, angle: 1 });
        expect(solveRoute(g, { x: 2900, z: 4570 }, { x: 2900, z: 4575 })).toEqual([]);
    });
});

describe('solveRoute on real map', () => {
    const g = buildMaze(parseJm2Locs(readFileSync(MAP, 'utf8')));
    const routes = MAZE_SPAWNS.map(s => solveRoute(g, s));
    test('every spawn yields a non-empty route ending adjacent to the shrine', () => {
        for (const r of routes) {
            expect(r.length).toBeGreaterThan(0);
            const last = r[r.length - 1];
            expect(Math.abs(last.x - MAZE_SHRINE.x) + Math.abs(last.z - MAZE_SHRINE.z)).toBeLessThanOrEqual(4);
        }
    });
    test('all four routes share a common tail (convergence onto the final path)', () => {
        const tailKey = (r: { x: number; z: number }[]): string => {
            const t = r[r.length - 1];
            return `${t.x},${t.z}`;
        };
        const tails = new Set(routes.map(tailKey));
        expect(tails.size).toBe(1);
    });
});
