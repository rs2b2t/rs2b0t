import { describe, expect, test } from 'bun:test';
import type { TransportInfo } from '#/bot/event/webwalk/PathFinder.js';
import { matchesTransportLanding } from '#/bot/event/webwalk/exec/transportLoc.js';

const stile: TransportInfo = {
    locName: 'Stile',
    action: 'Climb-over',
    locX: 2817,
    locZ: 3562,
    kind: 'shortcut',
    toTile: { x: 2817, z: 3564 }
};
const before = { x: 2817, z: 3561, level: 0 };

describe('short crossings', () => {
    test('the far side counts as landed', () => {
        expect(matchesTransportLanding(stile, 0, before, { x: 2817, z: 3564, level: 0 })).toBe(true);
    });

    test('the animation midpoint does not — a short hop lands exactly or not at all', () => {
        expect(matchesTransportLanding(stile, 0, before, { x: 2817, z: 3563, level: 0 })).toBe(false);
    });

    test('standing on the obstacle mid-animation does not', () => {
        expect(matchesTransportLanding(stile, 0, before, { x: 2817, z: 3562, level: 0 })).toBe(false);
    });

    test('never having moved does not', () => {
        expect(matchesTransportLanding(stile, 0, before, before)).toBe(false);
    });

    test('the troll rocks behave the same over their two-tile span', () => {
        const rocks: TransportInfo = {
            locName: 'Rocks',
            action: 'Climb',
            locX: 2856,
            locZ: 3612,
            kind: 'shortcut',
            toTile: { x: 2856, z: 3613 }
        };
        const south = { x: 2856, z: 3611, level: 0 };
        expect(matchesTransportLanding(rocks, 0, south, { x: 2856, z: 3613, level: 0 })).toBe(true);
        expect(matchesTransportLanding(rocks, 0, south, { x: 2856, z: 3612, level: 0 })).toBe(false);
        expect(matchesTransportLanding(rocks, 0, south, south)).toBe(false);
    });

    test('a long hop still lands when the origin is unknown', () => {
        expect(matchesTransportLanding(stile, 0, null, { x: 2817, z: 3564, level: 0 })).toBe(true);
    });
});
