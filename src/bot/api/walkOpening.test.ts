import { expect, test, describe } from 'bun:test';
import { isOpenableObstacle, openOp } from './walkOpening.js';

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
