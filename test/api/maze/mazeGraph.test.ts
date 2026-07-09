import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parseJm2Locs, MAZE_ORIGIN, DOOR_DIRS } from '#/bot/api/maze/mazeGraph.js';

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
