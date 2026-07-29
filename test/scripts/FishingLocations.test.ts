import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/api/Tile.js';
import { FISHING_LOCATIONS, LOCATION_OPTIONS, resolveLocation } from '#/bot/scripts/FishingLocations.js';

describe('resolveLocation', () => {
    test('None resolves to no location', () => {
        expect(resolveLocation('None', new Tile(3086, 3231, 0))).toBeNull();
    });

    test('Auto detects Draynor from the fishing spots', () => {
        expect(resolveLocation('Auto', new Tile(3086, 3231, 0))?.name).toBe('Draynor Village');
    });

    test('Auto detects Draynor from inside the bank', () => {
        expect(resolveLocation('Auto', new Tile(3092, 3243, 0))?.name).toBe('Draynor Village');
    });

    test('Auto detects Barbarian Village from the fishing spot', () => {
        expect(resolveLocation('Auto', new Tile(3104, 3430, 0))?.name).toBe('Barbarian Village');
    });

    test('Auto detects Barbarian Village from Edgeville bank', () => {
        expect(resolveLocation('Auto', new Tile(3094, 3494, 0))?.name).toBe('Barbarian Village');
    });

    test('Auto resolves to null away from every location (Lumbridge)', () => {
        expect(resolveLocation('Auto', new Tile(3222, 3218, 0))).toBeNull();
    });

    test('Auto ignores other levels', () => {
        expect(resolveLocation('Auto', new Tile(3086, 3231, 1))).toBeNull();
    });

    test('named locations resolve case-insensitively', () => {
        expect(resolveLocation('draynor village', new Tile(3222, 3218, 0))?.name).toBe('Draynor Village');
        expect(resolveLocation('Catherby', new Tile(0, 0, 0))?.name).toBe('Catherby');
        expect(resolveLocation('Fishing Guild', new Tile(0, 0, 0))?.name).toBe('Fishing Guild');
        expect(resolveLocation('Taverley Dungeon (lava eels)', new Tile(0, 0, 0))?.name).toBe(
            'Taverley Dungeon (lava eels)'
        );
    });

    test('unknown names resolve to null', () => {
        expect(resolveLocation('Karamja', new Tile(3086, 3231, 0))).toBeNull();
    });
});

describe('FISHING_LOCATIONS table', () => {
    test('every region contains its own spot; bank is local except Taverley (Falador west)', () => {
        for (const loc of FISHING_LOCATIONS) {
            expect(loc.region.contains(loc.spot), loc.name).toBe(true);
            if (loc.name.startsWith('Taverley')) {
                // Surface bank is intentionally outside the dungeon region.
                expect(loc.region.contains(loc.bankStand), loc.name).toBe(false);
                expect(loc.bankStand).toEqual(new Tile(2946, 3368, 0));
            } else {
                expect(loc.region.contains(loc.bankStand), loc.name).toBe(true);
            }
        }
    });

    test('dropdown options are Auto + every location + None', () => {
        expect(LOCATION_OPTIONS).toEqual([
            'Auto',
            'Draynor Village',
            'Barbarian Village',
            'Catherby',
            'Fishing Guild',
            'Taverley Dungeon (lava eels)',
            'None'
        ]);
    });

    test('Catherby has a range stand for cook-after-fish', () => {
        const catherby = FISHING_LOCATIONS.find(l => l.name === 'Catherby');
        expect(catherby?.rangeStand).toEqual(new Tile(2817, 3443, 0));
        expect(catherby?.rangeName).toBe('Range');
        expect(catherby?.obstacles).toContain('door');
        expect(catherby?.region.contains(catherby.rangeStand!)).toBe(true);
    });
});
