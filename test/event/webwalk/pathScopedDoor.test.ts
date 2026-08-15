import { describe, expect, test } from 'bun:test';

import {
    barrierBannable,
    DOOR_AVOID_STRIKES,
    DOOR_SESSION_STRIKES,
    noteFailedDoor,
    pickNearbyDoorTile
} from '#/bot/event/webwalk/exec/doorCrossing.js';

describe('path-scoped nearby door pick (multiloc placement)', () => {
    const me = { x: 100, z: 100, level: 0 };
    // Path east along z=100 (door placement must equal a path tile by default).
    const path = {
        tiles: [
            { x: 100, z: 100, level: 0 },
            { x: 101, z: 100, level: 0 },
            { x: 102, z: 100, level: 0 },
            { x: 103, z: 100, level: 0 },
            { x: 104, z: 100, level: 0 }
        ],
        pathIdx: 0,
        window: 8
    };

    test('prefers door on a path tile over nearer street-front door', () => {
        // Lateral house door — d=1 from path, must NOT count as on-route.
        const streetFront = { x: 100, z: 99, level: 0 };
        // Exact path tile (edge endpoint / door placement).
        const onPath = { x: 102, z: 100, level: 0 };
        const pick = pickNearbyDoorTile([streetFront, onPath], me, path);
        expect(pick).toEqual(onPath);
    });

    test('with path: never opens street-front / off-path doors', () => {
        // Only house doors adjacent to the street path — repath, do not tour.
        const offPath = { x: 100, z: 99, level: 0 };
        const offPath2 = { x: 101, z: 99, level: 0 };
        expect(pickNearbyDoorTile([offPath, offPath2], me, path)).toBeNull();
    });

    test('prefers planned hop placement over path-tile door', () => {
        const pathTileDoor = { x: 101, z: 100, level: 0 };
        const hopDoor = { x: 103, z: 100, level: 0 };
        const withHops = { ...path, hopDoors: [{ x: 103, z: 100 }] };
        expect(pickNearbyDoorTile([pathTileDoor, hopDoor], me, withHops)).toEqual(hopDoor);
    });

    test('hop placement still wins when door is not on a walkable path tile list', () => {
        // Some placements sit on the wall cell; hop list is authoritative.
        const hopOnly = { x: 150, z: 150, level: 0 };
        const withHops = { ...path, hopDoors: [{ x: 150, z: 150 }] };
        expect(pickNearbyDoorTile([hopOnly], me, withHops)).toEqual(hopOnly);
    });

    test('falls back to nearest when no path hint', () => {
        const near = { x: 100, z: 99, level: 0 };
        const far = { x: 103, z: 100, level: 0 };
        expect(pickNearbyDoorTile([far, near], me, null)).toEqual(near);
        expect(pickNearbyDoorTile([far, near], me, undefined)).toEqual(near);
    });

    test('with path: ignores other-level doors even if only candidates', () => {
        const onPathL1 = { x: 102, z: 100, level: 1 };
        expect(pickNearbyDoorTile([onPathL1], me, path)).toBeNull();
    });

    test('empty candidates → null', () => {
        expect(pickNearbyDoorTile([], me, path)).toBeNull();
    });
});

// Why: `resetAvoids` clears the per-walk avoid list, so without a session escalation the next `walkResilient` pass plans straight back through an uncrossable door.
describe('failed door strikes escalate past one walk', () => {
    const hop = {
        x: 3405,
        z: 3894,
        level: 0,
        transport: { locX: 3405, locZ: 3895, locName: 'Gate', action: 'Open', kind: 'door' }
    } as never as Parameters<typeof noteFailedDoor>[0];

    test('second strike avoids it for this walk, third bans it for the run', () => {
        const strikes = new Map<string, number>();
        const avoid: { x: number; z: number }[] = [];
        expect(noteFailedDoor(hop, strikes, avoid)).toBe(1);
        expect(avoid).toEqual([]);
        expect(noteFailedDoor(hop, strikes, avoid)).toBe(DOOR_AVOID_STRIKES);
        expect(avoid).toEqual([{ x: 3405, z: 3895 }]);
        expect(noteFailedDoor(hop, strikes, avoid)).toBe(DOOR_SESSION_STRIKES);
    });

    test('the session threshold is past the per-walk one, or it never fires', () => {
        expect(DOOR_SESSION_STRIKES).toBeGreaterThan(DOOR_AVOID_STRIKES);
    });
});

// Only openable barriers may be banned for the run.
// Why: a `Gangplank` refusing three times is a scene that has not caught up, and banning it maroons a bot on the ship deck.
describe('what may be banned for the run', () => {
    test('doors and gates', () => {
        expect(barrierBannable('door', 'Door')).toBe(true);
        expect(barrierBannable('gate', 'Gate')).toBe(true);
        expect(barrierBannable(undefined, 'Large door')).toBe(true);
    });

    test('never a boarding plank, ladder or ship', () => {
        expect(barrierBannable('gangplank', 'Gangplank')).toBe(false);
        expect(barrierBannable('stair', 'Ladder')).toBe(false);
        expect(barrierBannable('ship', 'Ship')).toBe(false);
        expect(barrierBannable('shortcut', 'Balancing ledge')).toBe(false);
    });
});
