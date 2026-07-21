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
    });

    test('unknown names resolve to null', () => {
        expect(resolveLocation('Karamja', new Tile(3086, 3231, 0))).toBeNull();
    });
});

describe('FISHING_LOCATIONS table', () => {
    test('every region contains its own spot and bank stand', () => {
        for (const loc of FISHING_LOCATIONS) {
            expect(loc.region.contains(loc.spot)).toBe(true);
            expect(loc.region.contains(loc.bankStand)).toBe(true);
        }
    });

    test('dropdown options are Auto + every location + None', () => {
        expect(LOCATION_OPTIONS).toEqual(['Auto', 'Draynor Village', 'Catherby', 'Fishing Guild', 'None']);
    });
});
