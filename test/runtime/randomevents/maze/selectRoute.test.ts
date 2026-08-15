import { describe, expect, test } from 'bun:test';

import { selectRoute } from '#/bot/runtime/randomevents/maze/selectRoute.js';
import { MAZE_SPAWNS } from '#/bot/runtime/randomevents/maze/mazeGraph.js';

// Why: the event spawns off the four corners, so a nearest-corner lookup hands a route whose first door is walled off from where the bot stands.
const REAL_STUCK_SPAWNS = [
    { x: 2905, z: 4566 },
    { x: 2900, z: 4567 }
];

const WALLED_OFF_FIRST_DOOR = { x: 2903, z: 4554 };

describe('selectRoute', () => {
    test('still solves the four corner spawns', () => {
        for (const spawn of MAZE_SPAWNS) {
            const route = selectRoute(spawn);
            expect(route).not.toBeNull();
            expect(route!.doors.length).toBeGreaterThan(0);
        }
    });

    test('solves from a spawn that is not a known corner', () => {
        for (const spawn of REAL_STUCK_SPAWNS) {
            const route = selectRoute(spawn);
            expect(route).not.toBeNull();
            expect(route!.doors.length).toBeGreaterThan(0);
        }
    });

    test('routes from where the player actually is, not the nearest corner', () => {
        for (const spawn of REAL_STUCK_SPAWNS) {
            const route = selectRoute(spawn)!;
            expect(route.spawn).toEqual(spawn);
            // the exact door both bots died on, inherited from the wrong corner
            expect(route.doors[0]).not.toEqual(WALLED_OFF_FIRST_DOOR);
        }
    });

    test('a non-corner spawn gets a shorter route than the corner it was misrouted to', () => {
        const corner = selectRoute({ x: 2891, z: 4555 })!;
        for (const spawn of REAL_STUCK_SPAWNS) {
            // both sit well inside the maze, so the live route must beat the corner's
            expect(selectRoute(spawn)!.doors.length).toBeLessThan(corner.doors.length);
        }
    });

    test('returns null rather than someone else\'s route when nothing is solvable', () => {
        // far outside the maze map square: no route exists, and inventing one is
        // the failure this replaced
        expect(selectRoute({ x: 3200, z: 3200 })).toBeNull();
    });
});
