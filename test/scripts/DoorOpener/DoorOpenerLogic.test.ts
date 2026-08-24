import { describe, expect, test } from 'bun:test';
import { nearestShutDoor, obstacleList, isShutDoor } from '#/bot/scripts/DoorOpener/DoorOpenerLogic.js';

describe('obstacleList', () => {
    test('splits comma-separated names and drops empties', () => {
        expect(obstacleList('door, gate')).toEqual(['door', 'gate']);
        expect(obstacleList(' Door,  GATE , ')).toEqual(['door', 'gate']);
        expect(obstacleList('')).toEqual([]);
    });
});

describe('isShutDoor', () => {
    test('a Door offering Open is shut', () => {
        expect(isShutDoor('Door', ['Open', 'Examine'], ['door', 'gate'])).toBe(true);
    });
    test('a Door offering Close is already open', () => {
        expect(isShutDoor('Door', ['Close'], ['door'])).toBe(false);
    });
    test('a booth is not a door', () => {
        expect(isShutDoor('Bank booth', ['Open'], ['door', 'gate'])).toBe(false);
    });
    test('Trapdoor is not a Door', () => {
        expect(isShutDoor('Trapdoor', ['Open'], ['door', 'gate'])).toBe(false);
        expect(isShutDoor('Large door', ['Open'], ['door'])).toBe(true);
    });
});

describe('nearestShutDoor', () => {
    const shut = { name: 'Door', ops: ['Open'], distance: 3 };
    const farther = { name: 'Gate', ops: ['Open'], distance: 5 };
    const open = { name: 'Door', ops: ['Close'], distance: 1 };
    const booth = { name: 'Bank booth', ops: ['Open'], distance: 0 };

    test('picks the closest shut door, ignoring open doors and unrelated locs', () => {
        expect(nearestShutDoor([open, farther, booth, shut], ['door', 'gate'])).toBe(shut);
    });
    test('null when nothing is shut', () => {
        expect(nearestShutDoor([open, booth], ['door', 'gate'])).toBeNull();
        expect(nearestShutDoor([], ['door'])).toBeNull();
    });
});
