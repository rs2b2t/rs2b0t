import { expect, test } from 'bun:test';

import Tile from '#/bot/api/Tile.js';
import {
    COURSE_OBSTACLES,
    COURSE_X_RADIUS,
    GATE_TILE,
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
    nearCourseEntry,
    onCourse,
    reactionMs,
    southOfRidge
} from '#/bot/scripts/WildyAgilityLogic.js';

test('the default lap is the five wilderness obstacles in order', () => {
    expect([...COURSE_OBSTACLES]).toEqual([
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

test('onCourse is everything north of the Gate within the lateral band', () => {
    expect(GATE_TILE.z).toBe(3931);
    expect(COURSE_X_RADIUS).toBeGreaterThanOrEqual(16);

    // Lap-zone tiles (obstacles / pit ladder exits)
    expect(onCourse(new Tile(2998, 3932, 0))).toBe(true); // just north of gate
    expect(onCourse(new Tile(2998, 3937, 0))).toBe(true); // post-ridge / rocks area
    expect(onCourse(new Tile(3004, 3937, 0))).toBe(true); // pipe start
    expect(onCourse(new Tile(3005, 3952, 0))).toBe(true); // ropeswing
    expect(onCourse(new Tile(3002, 3960, 0))).toBe(true); // stepping stone
    expect(onCourse(new Tile(3002, 3945, 0))).toBe(true); // log balance
    expect(onCourse(new Tile(2994, 3937, 0))).toBe(true); // rocks
    // Far-north pit ladder exits that a tight radius=16 would miss
    expect(onCourse(new Tile(3005, 3963, 0))).toBe(true);
    expect(onCourse(new Tile(3010, 3960, 0))).toBe(true);

    // Gate tile itself and everything south of it are NOT on course
    expect(onCourse(new Tile(2998, 3931, 0))).toBe(false); // gate
    expect(onCourse(new Tile(2998, 3924, 0))).toBe(false); // ridge corridor
    expect(onCourse(new Tile(2998, 3917, 0))).toBe(false); // ridge door
    expect(onCourse(new Tile(2998, 3916, 0))).toBe(false); // approach / wolf pit side
    expect(onCourse(new Tile(3094, 3493, 0))).toBe(false); // bank
    expect(onCourse(new Tile(2998, 3945, 1))).toBe(false); // wrong plane

    // Lateral band keeps random wilderness out
    expect(onCourse(new Tile(2998 + COURSE_X_RADIUS + 1, 3950, 0))).toBe(false);
});

test('nearCourseEntry covers the ridge→gate corridor only', () => {
    expect(nearCourseEntry(new Tile(2998, 3916, 0))).toBe(true);
    expect(nearCourseEntry(new Tile(2998, 3917, 0))).toBe(true);
    expect(nearCourseEntry(new Tile(2998, 3924, 0))).toBe(true);
    expect(nearCourseEntry(new Tile(2998, 3931, 0))).toBe(true); // on the gate
    expect(nearCourseEntry(new Tile(2998, 3932, 0))).toBe(false); // north of gate = on course
    expect(nearCourseEntry(new Tile(3094, 3493, 0))).toBe(false);
    expect(nearCourseEntry(new Tile(2998, 3900, 0))).toBe(false); // too far south
});

test('awayFromCourse: travel only when outside BOTH lap zone and entry corridor', () => {
    expect(awayFromCourse(new Tile(2998, 3950, 0))).toBe(false); // on course
    expect(awayFromCourse(new Tile(2998, 3924, 0))).toBe(false); // entry corridor
    expect(awayFromCourse(new Tile(2998, 3916, 0))).toBe(false); // approach
    expect(awayFromCourse(new Tile(3094, 3493, 0))).toBe(true); // bank
    expect(awayFromCourse(new Tile(2998, 3945, 1))).toBe(true); // wrong plane
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

test('ridge approach is south of the Door; corridor north of the Door is not approach', () => {
    expect(RIDGE_APPROACH.z).toBeLessThan(RIDGE_DOOR.z);
    expect(RIDGE_DOOR.z).toBe(3917);
    // A tile north of the door (e.g. 3924) is not approach — walking there from
    // the south makes the pathfinder Open the Door as a transport.
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
            inPit: true,
            cantReach: false,
            wrongSide: false,
            pitFallMessage: true,
            interrupted: false,
            lowHp: false,
            settled: true
        })
    ).toBe('pit');

    expect(
        classifyObstacle({
            xpGained: false,
            inPit: false,
            cantReach: false,
            wrongSide: false,
            pitFallMessage: false,
            interrupted: true,
            lowHp: true,
            settled: true
        })
    ).toBe('interrupted');

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
