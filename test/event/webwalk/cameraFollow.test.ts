import { describe, expect, test } from 'bun:test';
import {
    easeYaw,
    lookAheadTile,
    pathFacingYaw,
    stepYaw,
    yawDelta,
    yawTowardDelta,
    yawTowardTiles
} from '#/bot/event/webwalk/cameraFollow.js';

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
    test('shortest yaw delta wraps around 0/2048', () => {
        expect(yawDelta(10, 2040)).toBe(-18);
        expect(yawDelta(2040, 10)).toBe(18);
    });

    test('stepYaw clamps max step', () => {
        expect(stepYaw(0, 200, 32)).toBe(32);
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

describe('easeYaw (frame smoothing)', () => {
    test('reduces absolute error each frame without overshooting past target on small steps', () => {
        let yaw = 0;
        let velocity = 0;
        const target = 200;
        let prevErr = Math.abs(yawDelta(yaw, target));
        for (let i = 0; i < 40; i++) {
            const next = easeYaw(yaw, target, velocity);
            yaw = next.yaw;
            velocity = next.velocity;
            const err = Math.abs(yawDelta(yaw, target));
            // Monotonic approach (allow plateaus near deadzone)
            expect(err).toBeLessThanOrEqual(prevErr + 1);
            prevErr = err;
        }
        expect(Math.abs(yawDelta(yaw, target))).toBeLessThan(40);
    });

    test('settles near target with velocity → 0', () => {
        let yaw = 100;
        let velocity = 0;
        const target = 100;
        for (let i = 0; i < 10; i++) {
            const next = easeYaw(yaw, target, velocity);
            yaw = next.yaw;
            velocity = next.velocity;
        }
        expect(yaw).toBe(100);
        expect(velocity).toBe(0);
    });

    test('handles wrap-around (near 0/2048 boundary)', () => {
        let yaw = 10;
        let velocity = 0;
        const target = 2030; // short path is leftward across wrap
        for (let i = 0; i < 60; i++) {
            const next = easeYaw(yaw, target, velocity);
            yaw = next.yaw;
            velocity = next.velocity;
        }
        expect(Math.abs(yawDelta(yaw, target))).toBeLessThan(50);
    });
});

describe('lookAheadTile / pathFacingYaw', () => {
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

    test('pathFacingYaw averages ahead of the player', () => {
        const y = pathFacingYaw(path[0]!, path, 0, 4);
        expect(y).not.toBeNull();
        // Sum of (tile - me) for pathIdx+1 .. pathIdx+4: dx=1+5+10+10, dz=0+0+0+10
        expect(y).toBe(yawTowardDelta(26, 10));
    });

    test('pathFacingYaw stops before same-plane dungeon landing', () => {
        // Mining Guild-style: local east approach then z+6400 landing on level 0.
        const dungeonPath = [
            { x: 3010, z: 3339, level: 0 },
            { x: 3015, z: 3339, level: 0 },
            { x: 3020, z: 3339, level: 0 },
            { x: 3020, z: 9739, level: 0 } // landing — must not dominate yaw
        ];
        const y = pathFacingYaw(dungeonPath[0]!, dungeonPath, 0, 12);
        expect(y).not.toBeNull();
        // Local samples only: eastbound, not north toward dungeon coords.
        expect(y).toBe(yawTowardDelta(15, 0)); // (5+10, 0+0) from me at 3010
    });

    test('pathFacingYaw stops at transport metadata waypoint', () => {
        const withTransport = [
            { x: 3200, z: 3200, level: 0 },
            { x: 3205, z: 3200, level: 0 },
            {
                x: 3210,
                z: 3200,
                level: 0,
                transport: { locName: 'Ladder', action: 'Climb', locX: 3210, locZ: 3200 }
            },
            { x: 3210, z: 3200, level: 1 }
        ];
        const y = pathFacingYaw(withTransport[0]!, withTransport, 0, 12);
        expect(y).not.toBeNull();
        // Only first non-transport sample (3205): east
        expect(y).toBe(yawTowardDelta(5, 0));
    });
});
