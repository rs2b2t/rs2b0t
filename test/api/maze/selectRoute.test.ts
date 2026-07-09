import { describe, expect, test } from 'bun:test';
import { selectRoute } from '#/bot/api/maze/selectRoute.js';
import type { MazeRoute } from '#/bot/api/maze/mazeRoutes.js';

const R: MazeRoute[] = [
    { spawn: { x: 2891, z: 4597 }, doors: [{ x: 1, z: 1 }] }, // NW
    { spawn: { x: 2933, z: 4597 }, doors: [{ x: 2, z: 2 }] }, // NE
    { spawn: { x: 2933, z: 4555 }, doors: [{ x: 3, z: 3 }] }, // SE
    { spawn: { x: 2891, z: 4555 }, doors: [{ x: 4, z: 4 }] }  // SW
];

describe('selectRoute', () => {
    test('exact spawn match', () => {
        expect(selectRoute({ x: 2933, z: 4555 }, R).spawn).toEqual({ x: 2933, z: 4555 });
    });
    test('nearest when spawned a couple tiles off the corner', () => {
        expect(selectRoute({ x: 2890, z: 4595 }, R).spawn).toEqual({ x: 2891, z: 4597 });
    });
});
