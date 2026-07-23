import { expect, test } from 'bun:test';

import Tile from '#/bot/api/Tile.js';
import { awayFromCourse, classifyAttempt, inPit, inRegion, insideCourseProper, parseObstacles } from '#/bot/scripts/WildyAgility.js';

test('parseObstacles trims, lowercases and drops empties', () => {
    expect(parseObstacles('  Obstacle pipe , Ropeswing ,, Rocks ')).toEqual(['obstacle pipe', 'ropeswing', 'rocks']);
    expect(parseObstacles('')).toEqual([]);
    expect(parseObstacles(' , , ')).toEqual([]);
});

test('the default lap is the five wilderness obstacles in order', () => {
    expect(parseObstacles('Obstacle pipe,Ropeswing,Stepping stone,Log balance,Rocks')).toEqual([
        'obstacle pipe',
        'ropeswing',
        'stepping stone',
        'log balance',
        'rocks'
    ]);
});

test('inRegion is Chebyshev distance on the same level', () => {
    const centre = new Tile(2998, 3945, 0);
    expect(inRegion(new Tile(2998, 3945, 0), centre, 25)).toBe(true);
    expect(inRegion(new Tile(3023, 3970, 0), centre, 25)).toBe(true);
    expect(inRegion(new Tile(3024, 3945, 0), centre, 25)).toBe(false);
    expect(inRegion(new Tile(2998, 3971, 0), centre, 25)).toBe(false);
    expect(inRegion(new Tile(2998, 3945, 1), centre, 25)).toBe(false);
});

test('the ridge hop crosses from the entrance region into the course region', () => {
    const centre = new Tile(2998, 3945, 0);
    const entrance = new Tile(2998, 3924, 0);
    const postRidge = new Tile(2998, 3937, 0);
    const ENTRY_RADIUS = 10;
    const COURSE_RADIUS = 25;

    expect(inRegion(entrance, entrance, ENTRY_RADIUS)).toBe(true);
    expect(inRegion(entrance, centre, COURSE_RADIUS)).toBe(true);

    expect(inRegion(postRidge, entrance, ENTRY_RADIUS)).toBe(false);
    expect(inRegion(postRidge, centre, COURSE_RADIUS)).toBe(true);
});

test('awayFromCourse: travel only when outside BOTH the course and entrance regions', () => {
    const centre = new Tile(2998, 3945, 0);
    const entrance = new Tile(2998, 3924, 0);

    expect(awayFromCourse(new Tile(2998, 3950, 0), centre, 25, entrance, 10)).toBe(false);
    expect(awayFromCourse(new Tile(2998, 3924, 0), centre, 5, entrance, 10)).toBe(false);
    expect(awayFromCourse(new Tile(3094, 3493, 0), centre, 25, entrance, 10)).toBe(true);
    expect(awayFromCourse(new Tile(2998, 3945, 1), centre, 25, entrance, 10)).toBe(true);
});

test('insideCourseProper: in the course but past the entrance region (the lap zone)', () => {
    const centre = new Tile(2998, 3945, 0);
    const entrance = new Tile(2998, 3924, 0);
    expect(insideCourseProper(new Tile(2998, 3937, 0), centre, 25, entrance, 10)).toBe(true);
    expect(insideCourseProper(new Tile(2998, 3924, 0), centre, 25, entrance, 10)).toBe(false);
    expect(insideCourseProper(new Tile(3094, 3493, 0), centre, 25, entrance, 10)).toBe(false);
});

test('classifyAttempt: xp -> cleared; damage-without-xp -> failed (retry fast); nothing -> noop', () => {
    expect(classifyAttempt(true, false)).toBe('cleared');
    expect(classifyAttempt(true, true)).toBe('cleared');
    expect(classifyAttempt(false, true)).toBe('failed');
    expect(classifyAttempt(false, false)).toBe('noop');
});

test('inPit: the wolf pit sits far above the course in world-z', () => {
    const centre = new Tile(2998, 3945, 0);
    expect(inPit(new Tile(2998, 10346, 0), centre, 2000)).toBe(true);
    expect(inPit(new Tile(3004, 10357, 0), centre, 2000)).toBe(true);
    expect(inPit(new Tile(2998, 3945, 0), centre, 2000)).toBe(false);
    expect(inPit(new Tile(3094, 3493, 0), centre, 2000)).toBe(false);
    expect(inPit(new Tile(2998, 4736, 0), centre, 2000)).toBe(false);
});
