import { describe, expect, test } from 'bun:test';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import Tile from '#/bot/geometry/Tile.js';
import {
    WOODCUTTING_LOCATIONS,
    WOODCUTTING_LOCATION_OPTIONS,
    resolveWoodcuttingLocation
} from '#/bot/data/woodcuttingLocations.js';

const bankTiles = new Set(BANK_LOCATIONS.map(b => `${b.tile.x},${b.tile.z},${b.tile.level}`));

describe('resolveWoodcuttingLocation', () => {
    test('Use Start Position and Use Custom Position are freeform (null)', () => {
        expect(resolveWoodcuttingLocation('Use Start Position', new Tile(3087, 3234, 0))).toBeNull();
        expect(resolveWoodcuttingLocation('Use Custom Position', new Tile(3087, 3234, 0))).toBeNull();
    });

    test('Use Closest near Draynor willows', () => {
        expect(resolveWoodcuttingLocation('Use Closest', new Tile(3087, 3234, 0))?.name).toBe(
            'Draynor Willows'
        );
    });

    test('Use Closest near Seers maples', () => {
        expect(resolveWoodcuttingLocation('Use Closest', new Tile(2728, 3501, 0))?.name).toBe('Seers Maples');
    });

    test('Use Closest still snaps even NW of Crafting Guild (no chunk gate)', () => {
        // 2910,3328, not same 64x64 as Crafting Guild mine or any WC preset, now nearest not freeform.
        expect(resolveWoodcuttingLocation('Use Closest', new Tile(2910, 3328, 0))).not.toBeNull();
    });

    test('named match is case-insensitive', () => {
        expect(resolveWoodcuttingLocation('edgeville yews', new Tile(0, 0, 0))?.name).toBe(
            'Edgeville Yews'
        );
    });
});

describe('WOODCUTTING_LOCATIONS table', () => {
    test('dropdown is Use Closest + Use Start Position + Use Custom Position + camps', () => {
        expect(WOODCUTTING_LOCATION_OPTIONS).toEqual([
            'Use Closest',
            'Use Start Position',
            'Use Custom Position',
            ...WOODCUTTING_LOCATIONS.map(l => l.name)
        ]);
    });

    test('every bankStand is a known BANK_LOCATIONS tile', () => {
        for (const loc of WOODCUTTING_LOCATIONS) {
            const key = `${loc.bankStand.x},${loc.bankStand.z},${loc.bankStand.level}`;
            expect(bankTiles.has(key), `${loc.name} bank ${key}`).toBe(true);
        }
    });

    test('core catalog entries are verified; tick-manip camps may be provisional', () => {
        const provisional = new Set([
            'S Falador Oaks',
            'Lumbridge Farmer Willows',
            'Lumbridge Castle Willows'
        ]);
        for (const loc of WOODCUTTING_LOCATIONS) {
            if (provisional.has(loc.name)) {
                expect(loc.verified, loc.name).toBe(false);
            } else {
                expect(loc.verified, loc.name).toBe(true);
            }
        }
    });

    test('includes tick-manip WC camps (#160)', () => {
        const names = new Set(WOODCUTTING_LOCATIONS.map(l => l.name));
        expect(names.has('S Falador Oaks')).toBe(true);
        expect(names.has('Lumbridge Farmer Willows')).toBe(true);
        expect(names.has('Lumbridge Castle Willows')).toBe(true);
    });

    test('fire spots are not mixed into chop camps', () => {
        // Burn strips live in FiremakingLogic, chop table is trees + bank only.
        for (const loc of WOODCUTTING_LOCATIONS) {
            expect('rangeStand' in loc).toBe(false);
            expect(loc.spot).toBeDefined();
            expect(loc.bankStand).toBeDefined();
        }
    });
});
