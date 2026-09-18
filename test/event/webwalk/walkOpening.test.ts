import { expect, test, describe } from 'bun:test';
import { faceSteps, farSide, isOpenableObstacle, openOp, openedNeighbour, towardDest } from '#/bot/event/webwalk/walkOpening.js';

describe('isOpenableObstacle', () => {
    test('matches a shut door/gate by name + an Open op', () => {
        expect(isOpenableObstacle('Door', ['Open'], ['door', 'gate'])).toBe(true);
        expect(isOpenableObstacle('Large door', ['Open'], ['door'])).toBe(true);
        expect(isOpenableObstacle('Wooden gate', ['Open'], ['door', 'gate'])).toBe(true);
    });

    test('rejects an OPEN door (it offers Close, not Open)', () => {
        expect(isOpenableObstacle('Door', ['Close'], ['door'])).toBe(false);
    });

    test('rejects names that do not match any obstacle keyword', () => {
        expect(isOpenableObstacle('Bank booth', ['Open'], ['door', 'gate'])).toBe(false);
        expect(isOpenableObstacle(null, ['Open'], ['door'])).toBe(false);
    });
});

describe('towardDest', () => {
    const dest = { x: 2715, z: 3470, level: 0 };
    const stall = { x: 2720, z: 3474, level: 0 };

    test('keeps the door between us and the destination', () => {
        expect(towardDest({ x: 2716, z: 3472, level: 0 }, stall, dest)).toBe(true);
    });

    test("rejects a neighbouring house's door that leads away from the destination", () => {
        expect(towardDest({ x: 2713, z: 3483, level: 0 }, stall, dest)).toBe(false);
    });

    test('allows a slightly-backward exit door (escaping a shop we are shut inside)', () => {
        expect(towardDest({ x: 8, z: 10, level: 0 }, { x: 10, z: 10, level: 0 }, { x: 20, z: 10, level: 0 })).toBe(true);
    });

    test('rejects a door far behind us', () => {
        expect(towardDest({ x: 3, z: 10, level: 0 }, { x: 10, z: 10, level: 0 }, { x: 20, z: 10, level: 0 })).toBe(false);
    });
});

describe('openOp', () => {
    test('returns the first Open-style op, skipping others', () => {
        expect(openOp(['Close', 'Open'])).toBe('Open');
        expect(openOp(['Open-quietly'])).toBe('Open-quietly');
    });

    test('null when no Open op is present', () => {
        expect(openOp(['Close'])).toBeNull();
        expect(openOp([])).toBeNull();
    });
});

describe('openedNeighbour', () => {
    const door = { x: 2949, z: 3450, level: 0 };

    test('is the tile across the one face the open swung free', () => {
        const before = [true, true, false, true];
        const after = [true, true, true, true];
        expect(openedNeighbour(door, before, after)).toEqual({ x: 2950, z: 3450, level: 0 });
    });

    test('is null while every face reads as it did before the click', () => {
        const before = [true, true, false, true];
        expect(openedNeighbour(door, before, before)).toBeNull();
    });

    test('ignores a face that was already open', () => {
        const before = [true, false, false, false];
        const after = [true, false, false, true];
        expect(openedNeighbour(door, before, after)).toEqual({ x: 2949, z: 3449, level: 0 });
    });
});

describe('faceSteps', () => {
    test('asks about west, north, east and south in that order', () => {
        const asked: string[] = [];
        faceSteps({ x: 5, z: 5, level: 0 }, (_from, to) => {
            asked.push(`${to.x},${to.z}`);
            return false;
        });
        expect(asked).toEqual(['4,5', '5,6', '6,5', '5,4']);
    });
});

describe('farSide', () => {
    const door = { x: 2949, z: 3450, level: 0 };
    const across = { x: 2950, z: 3450, level: 0 };

    test('steps inward from the door tile', () => {
        expect(farSide(door, across, door)).toEqual(across);
    });

    test('steps outward from the inside tile', () => {
        expect(farSide(door, across, across)).toEqual(door);
    });

    test('picks the tile further away when standing beside the passage', () => {
        expect(farSide(door, across, { x: 2948, z: 3451, level: 0 })).toEqual(across);
        expect(farSide(door, across, { x: 2951, z: 3449, level: 0 })).toEqual(door);
    });
});
