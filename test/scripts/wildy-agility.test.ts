import { expect, test } from 'bun:test';

import Tile from '#/bot/api/Tile.js';
import {
    RIDGE_APPROACH,
    RIDGE_DOOR,
    RIDGE_FAIL,
    RIDGE_SUCCESS,
    PIT_FALL,
    WRONG_SIDE,
    atRidgeApproach,
    awayFromCourse,
    classifyObstacle,
    classifyRidge,
    inPit,
    inRegion,
    insideCourseProper,
    parseObstacles,
    reactionMs,
    southOfRidge
} from '#/bot/scripts/WildyAgility.js';

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

test('inPit: obstacle pits sit far above the course in world-z (not ridge wolf pit)', () => {
    const centre = new Tile(2998, 3945, 0);
    // ropeswing / log balance obstacle pits
    expect(inPit(new Tile(2998, 10346, 0), centre, 2000)).toBe(true);
    expect(inPit(new Tile(3004, 10357, 0), centre, 2000)).toBe(true);
    // same-scene tiles around the ridge are NOT obstacle pits
    expect(inPit(new Tile(2998, 3945, 0), centre, 2000)).toBe(false);
    expect(inPit(new Tile(2998, 3916, 0), centre, 2000)).toBe(false);
    expect(inPit(new Tile(2998, 3917, 0), centre, 2000)).toBe(false);
    expect(inPit(new Tile(3094, 3493, 0), centre, 2000)).toBe(false);
    expect(inPit(new Tile(2998, 4736, 0), centre, 2000)).toBe(false);
});

test('ridge approach is south of the Door; COURSE_ENTRANCE is north', () => {
    expect(RIDGE_APPROACH.z).toBeLessThan(RIDGE_DOOR.z);
    expect(RIDGE_DOOR.z).toBe(3917);
    // COURSE_ENTRANCE (3924) is north of the door — walking there from the south
    // makes the pathfinder Open the Door as a transport.
    expect(new Tile(2998, 3924, 0).z).toBeGreaterThan(RIDGE_DOOR.z);

    expect(southOfRidge(new Tile(2998, 3916, 0))).toBe(true);
    expect(southOfRidge(new Tile(2998, 3917, 0))).toBe(true);
    expect(southOfRidge(new Tile(2998, 3918, 0))).toBe(false);
    expect(southOfRidge(new Tile(2998, 3924, 0))).toBe(false);

    expect(atRidgeApproach(new Tile(2998, 3916, 0))).toBe(true);
    expect(atRidgeApproach(new Tile(2998, 3915, 0))).toBe(true);
    expect(atRidgeApproach(new Tile(2998, 3924, 0))).toBe(false);
    expect(atRidgeApproach(new Tile(2998, 3918, 0))).toBe(false);
});

test('RIDGE_SUCCESS matches the live server success line', () => {
    expect(RIDGE_SUCCESS.test('You skillfully balance across the ridge...')).toBe(true);
    expect(RIDGE_SUCCESS.test('You skillfully balance across the ridge.')).toBe(true);
    expect(RIDGE_SUCCESS.test('you reach the top')).toBe(false);
});

test('RIDGE_FAIL matches the live server wolf-pit line', () => {
    expect(RIDGE_FAIL.test('You lose your footing and fall into the wolf pit.')).toBe(true);
    expect(RIDGE_FAIL.test('You lose your footing and fall into the lava.')).toBe(false);
});

test('PIT_FALL and WRONG_SIDE still match course obstacle lines', () => {
    expect(PIT_FALL.test('You slip and fall into the pit below.')).toBe(true);
    expect(PIT_FALL.test('You lose your footing and fall into the lava.')).toBe(true);
    expect(WRONG_SIDE.test('You cannot do that from here.')).toBe(true);
    expect(WRONG_SIDE.test("You can't enter the pipe from this side.")).toBe(true);
});

test('classifyRidge prefers fail chat over residual success, and fail over timeout', () => {
    expect(
        classifyRidge({
            xpGained: false,
            successMessage: true,
            failMessage: false,
            inWolfPit: false,
            interrupted: false,
            settled: true
        })
    ).toBe('success');

    expect(
        classifyRidge({
            xpGained: true,
            successMessage: false,
            failMessage: false,
            inWolfPit: false,
            interrupted: false,
            settled: true
        })
    ).toBe('success');

    expect(
        classifyRidge({
            xpGained: false,
            successMessage: false,
            failMessage: true,
            inWolfPit: false,
            interrupted: false,
            settled: true
        })
    ).toBe('fail');

    expect(
        classifyRidge({
            xpGained: false,
            successMessage: false,
            failMessage: false,
            inWolfPit: true,
            interrupted: false,
            settled: true
        })
    ).toBe('fail');

    // Fresh fail must win over a leftover success line in the ring buffer.
    expect(
        classifyRidge({
            xpGained: false,
            successMessage: true,
            failMessage: true,
            inWolfPit: false,
            interrupted: false,
            settled: true
        })
    ).toBe('fail');

    expect(
        classifyRidge({
            xpGained: false,
            successMessage: false,
            failMessage: false,
            inWolfPit: false,
            interrupted: true,
            settled: true
        })
    ).toBe('interrupted');

    expect(
        classifyRidge({
            xpGained: false,
            successMessage: false,
            failMessage: false,
            inWolfPit: false,
            interrupted: false,
            settled: true
        })
    ).toBe('timeout');
});

test('classifyObstacle priority matches RunLap branch order', () => {
    expect(
        classifyObstacle({
            xpGained: true,
            inPit: true,
            cantReach: true,
            wrongSide: true,
            pitFallMessage: true,
            interrupted: true,
            lowHp: true,
            settled: true
        })
    ).toBe('xp');

    expect(
        classifyObstacle({
            xpGained: false,
            inPit: false,
            cantReach: false,
            wrongSide: true,
            pitFallMessage: true,
            interrupted: false,
            lowHp: false,
            settled: true
        })
    ).toBe('wrong_side');

    expect(
        classifyObstacle({
            xpGained: false,
            inPit: false,
            cantReach: true,
            wrongSide: false,
            pitFallMessage: false,
            interrupted: false,
            lowHp: false,
            settled: true
        })
    ).toBe('cant_reach');

    expect(
        classifyObstacle({
            xpGained: false,
            inPit: false,
            cantReach: false,
            wrongSide: false,
            pitFallMessage: true,
            interrupted: false,
            lowHp: false,
            settled: true
        })
    ).toBe('pit_fall_msg');
});

test('reactionMs stays within the humanized settle window', () => {
    const short = reactionMs(() => 0.5);
    expect(short).toBeGreaterThanOrEqual(600);
    expect(short).toBeLessThanOrEqual(1500);

    let call = 0;
    const long = reactionMs(() => (call++ === 0 ? 0.05 : 0.5));
    expect(long).toBeGreaterThanOrEqual(1200);
    expect(long).toBeLessThanOrEqual(3000);
});
