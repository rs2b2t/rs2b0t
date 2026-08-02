import { describe, expect, test } from 'bun:test';
import {
    lookAheadTile,
    stepYaw,
    yawDelta,
    yawTowardDelta,
    yawTowardTiles
} from '#/bot/nav/cameraFollow.js';

describe('yawTowardDelta', () => {
    test('north (+z) is a stable yaw', () => {
        const y = yawTowardDelta(0, 10);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(2048);
    });

    test('east (+x) differs from north', () => {
        expect(yawTowardDelta(10, 0)).not.toBe(yawTowardDelta(0, 10));
    });

    test('zero delta is 0', () => {
        expect(yawTowardDelta(0, 0)).toBe(0);
    });
});

describe('yawDelta / stepYaw', () => {
    test('shortest path wraps around 0/2048', () => {
        expect(yawDelta(10, 2040)).toBe(-18);
        expect(yawDelta(2040, 10)).toBe(18);
    });

    test('stepYaw clamps max step', () => {
        expect(stepYaw(0, 200, 32)).toBe(32);
        expect(stepYaw(0, 200, 32)).not.toBe(200);
        expect(stepYaw(0, 20, 32)).toBe(20);
    });

    test('stepYaw reaches target over multiple steps', () => {
        let y = 0;
        for (let i = 0; i < 20; i++) {
            y = stepYaw(y, 400, 32);
        }
        expect(y).toBe(400);
    });
});

describe('lookAheadTile / yawTowardTiles', () => {
    const path = [
        { x: 3200, z: 3200, level: 0 },
        { x: 3201, z: 3200, level: 0 },
        { x: 3205, z: 3200, level: 0 },
        { x: 3210, z: 3200, level: 0 },
        { x: 3210, z: 3210, level: 0 }
    ];

    test('lookAhead prefers pathIdx + lookAhead, clamped', () => {
        expect(lookAheadTile(path, 0, 2)?.x).toBe(3205);
        expect(lookAheadTile(path, 3, 8)?.x).toBe(3210);
        expect(lookAheadTile([], 0)).toBeNull();
    });

    test('yawTowardTiles returns null for same tile or level hop', () => {
        expect(yawTowardTiles(path[0]!, path[0]!)).toBeNull();
        expect(yawTowardTiles({ x: 1, z: 1, level: 0 }, { x: 2, z: 2, level: 1 })).toBeNull();
    });

    test('yawTowardTiles faces along the path', () => {
        const y = yawTowardTiles(path[0]!, path[3]!);
        expect(y).not.toBeNull();
        expect(y).toBe(yawTowardDelta(10, 0));
    });
});
