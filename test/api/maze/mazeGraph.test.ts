import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseJm2Locs, MAZE_ORIGIN, DOOR_DIRS } from '#/bot/api/maze/mazeGraph.js';
import { buildMaze, edgeKey, doorPassable } from '#/bot/api/maze/mazeGraph.js';

const MAP = '/Users/elliottriplett/code/rs2b2t-content/maps/m45_71.jm2';

describe('parseJm2Locs', () => {
    test('parses "level lx lz: id shape angle" with defaults', () => {
        const locs = parseJm2Locs('==== LOC ====\n0 8 43: 3628 0 2\n0 31 31: 3634 10\n1 0 0: 9999 0 0\n');
        expect(locs).toEqual([
            { lx: 8, lz: 43, id: 3628, shape: 0, angle: 2 },
            { lx: 31, lz: 31, id: 3634, shape: 10, angle: 0 }
        ]); // level-1 loc dropped
    });

    test('ignores the MAP height section', () => {
        expect(parseJm2Locs('==== MAP ====\n0 0 0: h30\n==== LOC ====\n0 1 2: 3626 0 0\n')).toHaveLength(1);
    });

    test('real map: expected maze loc population', () => {
        const locs = parseJm2Locs(readFileSync(MAP, 'utf8'));
        const count = (id: number): number => locs.filter(l => l.id === id).length;
        expect(count(3626)).toBe(1459); // walls
        expect(count(3628)).toBe(45);   // dir-0 doors
        expect(Object.keys(DOOR_DIRS).reduce((n, id) => n + count(Number(id)), 0)).toBe(49); // all doors
        expect(count(3634)).toBe(1);    // shrine
        expect(MAZE_ORIGIN).toEqual({ x: 2880, z: 4544 });
    });
});

describe('buildMaze edge model', () => {
    // world tile for local (lx,lz): (2880+lx, 4544+lz)
    test('wall_straight blocks its one cardinal edge (angle EAST=2)', () => {
        const g = buildMaze([{ lx: 10, lz: 10, id: 3626, shape: 0, angle: 2 }]);
        // EAST edge of (2890,4554): between (2890,4554) and (2891,4554)
        expect(g.wallEdge.has(edgeKey(2890, 4554, 2891, 4554))).toBe(true);
        expect(g.wallEdge.has(edgeKey(2890, 4554, 2889, 4554))).toBe(false);
    });

    test('wall_L (shape 2, angle WEST=0) blocks NORTH and WEST edges', () => {
        const g = buildMaze([{ lx: 10, lz: 10, id: 3626, shape: 2, angle: 0 }]);
        expect(g.wallEdge.has(edgeKey(2890, 4554, 2890, 4555))).toBe(true); // north
        expect(g.wallEdge.has(edgeKey(2890, 4554, 2889, 4554))).toBe(true); // west
        expect(g.wallEdge.has(edgeKey(2890, 4554, 2891, 4554))).toBe(false); // east open
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
    // dir-1 door, angle EAST (2): check_axis true iff fromX == door.x
    const d1 = { tile: { x: 2890, z: 4554 }, id: 3629, angle: 2 };
    test('dir-1 opens from axis-aligned side only', () => {
        expect(doorPassable(d1, 2890, 4554)).toBe(true);  // fromX == door.x -> axisTrue
        expect(doorPassable(d1, 2891, 4554)).toBe(false); // other side
    });
    // dir-2 door, angle NORTH (1): check_axis true iff fromZ == door.z
    const d2 = { tile: { x: 2890, z: 4554 }, id: 3630, angle: 1 };
    test('dir-2 opens from off-axis side only', () => {
        expect(doorPassable(d2, 2890, 4554)).toBe(false); // fromZ == door.z -> axisTrue -> blocked for dir2
        expect(doorPassable(d2, 2890, 4555)).toBe(true);  // off-axis -> open
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
