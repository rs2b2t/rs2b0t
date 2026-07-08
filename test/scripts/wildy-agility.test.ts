import { expect, test } from 'bun:test';

import Tile from '#/bot/api/Tile.js';
import { awayFromCourse, inRegion, parseObstacles } from '#/bot/scripts/WildyAgility.js';

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
    expect(inRegion(new Tile(2998, 3945, 0), centre, 25)).toBe(true); // dead centre
    expect(inRegion(new Tile(3023, 3970, 0), centre, 25)).toBe(true); // exactly r on both axes (corner)
    expect(inRegion(new Tile(3024, 3945, 0), centre, 25)).toBe(false); // one tile past r in x
    expect(inRegion(new Tile(2998, 3971, 0), centre, 25)).toBe(false); // one tile past r in z
    expect(inRegion(new Tile(2998, 3945, 1), centre, 25)).toBe(false); // wrong level
});

// Locks the fragile ridge geometry: the entrance (z3924) and the course south
// edge sit ~1 tile apart, so a single centre-radius can't separate them. Instead
// EnterCourse uses an entrance region and RunLap a centre region; the ~13-tile
// ridge hop must land us OUT of the entrance region but INSIDE the course region
// so control passes cleanly from EnterCourse to RunLap.
test('the ridge hop crosses from the entrance region into the course region', () => {
    const centre = new Tile(2998, 3945, 0);
    const entrance = new Tile(2998, 3924, 0);
    const postRidge = new Tile(2998, 3937, 0); // ~13 tiles north of the entrance
    const ENTRY_RADIUS = 10;
    const COURSE_RADIUS = 25;

    // at the entrance: EnterCourse fires, RunLap's region also covers it (overlap
    // resolved by EnterCourse's higher task priority)
    expect(inRegion(entrance, entrance, ENTRY_RADIUS)).toBe(true);
    expect(inRegion(entrance, centre, COURSE_RADIUS)).toBe(true);

    // after the hop: clear of the entrance region, inside the course region
    expect(inRegion(postRidge, entrance, ENTRY_RADIUS)).toBe(false);
    expect(inRegion(postRidge, centre, COURSE_RADIUS)).toBe(true);
});

test('awayFromCourse: travel only when outside BOTH the course and entrance regions', () => {
    const centre = new Tile(2998, 3945, 0);
    const entrance = new Tile(2998, 3924, 0);

    // inside the course region -> already there, do not travel
    expect(awayFromCourse(new Tile(2998, 3950, 0), centre, 25, entrance, 10)).toBe(false);
    // near the entrance but outside a (deliberately tiny) course region -> the
    // entrance clause still says "not away", so EnterCourse handles it
    expect(awayFromCourse(new Tile(2998, 3924, 0), centre, 5, entrance, 10)).toBe(false);
    // far away (Edgeville) -> travel
    expect(awayFromCourse(new Tile(3094, 3493, 0), centre, 25, entrance, 10)).toBe(true);
    // right level matters: same x/z on another plane is away
    expect(awayFromCourse(new Tile(2998, 3945, 1), centre, 25, entrance, 10)).toBe(true);
});
