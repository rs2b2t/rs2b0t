import { describe, expect, test } from 'bun:test';

import { NEARBY_BANK_RADIUS, resolveBankOpenRoute } from '#/bot/api/Banking.js';
import type { BankLocation } from '#/bot/api/BankLocations.js';
import Tile from '#/bot/api/Tile.js';

const draynor = { x: 3093, z: 3243, level: 0 };
const edgeville = { x: 3094, z: 3493, level: 0 };
const catherby = { x: 2809, z: 3441, level: 0 };
const varrockWest = { x: 3185, z: 3440, level: 0 };

const nearestDraynor: BankLocation = {
    name: 'Draynor',
    tile: new Tile(draynor.x, draynor.z, draynor.level)
};
const nearestCatherby: BankLocation = {
    name: 'Catherby',
    tile: new Tile(catherby.x, catherby.z, catherby.level)
};

describe('NEARBY_BANK_RADIUS', () => {
    test('is wide enough for booth-underfoot / local stand snap', () => {
        expect(NEARBY_BANK_RADIUS).toBe(14);
    });
});

describe('resolveBankOpenRoute', () => {
    test('already-open wins over every other signal', () => {
        expect(
            resolveBankOpenRoute({
                bankOpen: true,
                here: draynor,
                stand: edgeville,
                nearbyBoothDist: 2,
                nearest: nearestDraynor
            })
        ).toBe('already-open');
    });

    test('usable booth within radius → scene-booth (skip distant preset)', () => {
        // Barb fly restock: camp bank Edgeville, player at Draynor with booth in scene.
        expect(
            resolveBankOpenRoute({
                bankOpen: false,
                here: draynor,
                stand: edgeville,
                nearbyBoothDist: 3,
                nearest: nearestDraynor,
                preferNearby: true
            })
        ).toBe('scene-booth');
        expect(
            resolveBankOpenRoute({
                bankOpen: false,
                here: draynor,
                stand: edgeville,
                nearbyBoothDist: NEARBY_BANK_RADIUS,
                nearest: nearestDraynor
            })
        ).toBe('scene-booth');
    });

    test('booth just outside radius does not force scene-booth', () => {
        expect(
            resolveBankOpenRoute({
                bankOpen: false,
                here: draynor,
                stand: edgeville,
                nearbyBoothDist: NEARBY_BANK_RADIUS + 1,
                nearest: nearestDraynor,
                preferNearby: true
            })
        ).not.toBe('scene-booth');
    });

    test('preferNearby false ignores nearby booth and uses preset stand', () => {
        expect(
            resolveBankOpenRoute({
                bankOpen: false,
                here: draynor,
                stand: edgeville,
                nearbyBoothDist: 2,
                nearest: nearestDraynor,
                preferNearby: false
            })
        ).toBe('preset-stand');
    });

    test('local known bank beats distant preset when no booth in scene', () => {
        // Smith at Varrock West while camp table still says Draynor.
        expect(
            resolveBankOpenRoute({
                bankOpen: false,
                here: varrockWest,
                stand: draynor,
                nearbyBoothDist: null,
                nearest: {
                    name: 'Varrock West',
                    tile: new Tile(varrockWest.x, varrockWest.z, 0)
                },
                preferNearby: true
            })
        ).toBe('local-bank');
    });

    test('preset stand when stand is also local (same bank area)', () => {
        // Already at Catherby and camp bank is Catherby — walk the stand is fine.
        expect(
            resolveBankOpenRoute({
                bankOpen: false,
                here: catherby,
                stand: catherby,
                nearbyBoothDist: null,
                nearest: nearestCatherby,
                preferNearby: true
            })
        ).toBe('preset-stand');
    });

    test('preset-stand when nothing nearby and stand is set', () => {
        expect(
            resolveBankOpenRoute({
                bankOpen: false,
                here: { x: 3000, z: 3300, level: 0 },
                stand: edgeville,
                nearbyBoothDist: null,
                nearest: null
            })
        ).toBe('preset-stand');
    });

    test('nearest-fallback when no stand and player is not already at a local bank', () => {
        // Far from every known bank — open() will web-walk nearestBank.
        expect(
            resolveBankOpenRoute({
                bankOpen: false,
                here: { x: 2500, z: 3200, level: 0 },
                stand: null,
                nearbyBoothDist: null,
                nearest: nearestDraynor
            })
        ).toBe('nearest-fallback');
        // No stand + already at a known bank still snaps local (preferNearby).
        expect(
            resolveBankOpenRoute({
                bankOpen: false,
                here: draynor,
                stand: null,
                nearbyBoothDist: null,
                nearest: nearestDraynor
            })
        ).toBe('local-bank');
    });

    test('custom nearbyRadius tightens the booth snap', () => {
        expect(
            resolveBankOpenRoute({
                bankOpen: false,
                here: draynor,
                stand: edgeville,
                nearbyBoothDist: 10,
                nearest: nearestDraynor,
                nearbyRadius: 8
            })
        ).not.toBe('scene-booth');
        expect(
            resolveBankOpenRoute({
                bankOpen: false,
                here: draynor,
                stand: edgeville,
                nearbyBoothDist: 10,
                nearest: nearestDraynor,
                nearbyRadius: 12
            })
        ).toBe('scene-booth');
    });
});
