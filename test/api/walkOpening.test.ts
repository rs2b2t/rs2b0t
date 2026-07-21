import { expect, test, describe } from 'bun:test';
import { isOpenableObstacle, openOp, towardDest } from '#/bot/api/walkOpening.js';

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
    // Seers Village flax-spinner geometry: walkTo strands the bot at (2720,3474)
    // outside the shut spinning house (dest = ladder inside at 2715,3470). The
    // house door (2716,3472) blocks the way in; the neighbour house's door
    // (2713,3483) is also within the 10-tile hunt radius but leads nowhere.
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
