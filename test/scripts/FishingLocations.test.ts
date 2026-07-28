import { describe, expect, test } from 'bun:test';
import { BANK_LOCATIONS } from '#/bot/api/BankLocations.js';
import Tile from '#/bot/api/Tile.js';
import {
    FISHING_LOCATIONS,
    FISHING_LOCATION_OPTIONS,
    LOCATION_OPTIONS,
    resolveFishingLocation,
    resolveLocation
} from '#/bot/scripts/FishingLocations.js';

const bankTiles = new Set(BANK_LOCATIONS.map(b => `${b.tile.x},${b.tile.z},${b.tile.level}`));

describe('resolveFishingLocation', () => {
    test('None resolves to no location', () => {
        expect(resolveFishingLocation('None', new Tile(3086, 3231, 0))).toBeNull();
    });

    test('Auto detects Draynor from the fishing spots', () => {
        expect(resolveFishingLocation('Auto', new Tile(3086, 3231, 0))?.name).toBe('Draynor Village');
    });

    test('Auto detects Draynor from inside the bank', () => {
        expect(resolveFishingLocation('Auto', new Tile(3092, 3243, 0))?.name).toBe('Draynor Village');
    });

    test('Auto picks Euclidean-nearest camp from Lumbridge (Draynor)', () => {
        // No radius cutoff — always pick a camp.
        expect(resolveFishingLocation('Auto', new Tile(3222, 3218, 0))?.name).toBe('Draynor Village');
    });

    test('Auto prefers same level', () => {
        // No level-1 camps — falls back to ground pool.
        expect(resolveFishingLocation('Auto', new Tile(3086, 3231, 1))?.name).toBe('Draynor Village');
    });

    test('named locations resolve case-insensitively', () => {
        expect(resolveFishingLocation('draynor village', new Tile(3222, 3218, 0))?.name).toBe(
            'Draynor Village'
        );
        expect(resolveFishingLocation('Catherby', new Tile(0, 0, 0))?.name).toBe('Catherby');
        expect(resolveFishingLocation('Fishing Guild', new Tile(0, 0, 0))?.name).toBe('Fishing Guild');
        expect(resolveFishingLocation('Karamja (Musa Point)', new Tile(0, 0, 0))?.name).toBe(
            'Karamja (Musa Point)'
        );
        expect(resolveFishingLocation('Taverley Dungeon (lava eels)', new Tile(0, 0, 0))?.name).toBe(
            'Taverley Dungeon (lava eels)'
        );
    });

    test('unknown names resolve to null', () => {
        expect(resolveFishingLocation('Atlantis', new Tile(3086, 3231, 0))).toBeNull();
    });

    test('deprecated resolveLocation alias still works', () => {
        expect(resolveLocation('Auto', new Tile(3086, 3231, 0))?.name).toBe('Draynor Village');
    });
});

describe('FISHING_LOCATIONS table', () => {
    test('dropdown options are Auto + every location + None', () => {
        expect(FISHING_LOCATION_OPTIONS).toEqual([
            'Auto',
            ...FISHING_LOCATIONS.map(l => l.name),
            'None'
        ]);
        expect(LOCATION_OPTIONS).toEqual(FISHING_LOCATION_OPTIONS);
    });

    test('every bankStand is a known BANK_LOCATIONS tile', () => {
        for (const loc of FISHING_LOCATIONS) {
            const key = `${loc.bankStand.x},${loc.bankStand.z},${loc.bankStand.level}`;
            expect(bankTiles.has(key), `${loc.name} bank ${key}`).toBe(true);
        }
    });

    test('Catherby has a range stand for cook-after-fish', () => {
        const catherby = FISHING_LOCATIONS.find(l => l.name === 'Catherby');
        expect(catherby?.rangeStand).toEqual(new Tile(2817, 3443, 0));
        expect(catherby?.rangeName).toBe('Range');
        expect(catherby?.obstacles).toContain('door');
    });

    test('catalog entries are verified', () => {
        expect(FISHING_LOCATIONS.every(l => l.verified === true)).toBe(true);
    });

    test('Karamja banks at Draynor (no local bank)', () => {
        const musa = FISHING_LOCATIONS.find(l => l.name === 'Karamja (Musa Point)');
        expect(musa?.bankStand).toEqual(new Tile(3093, 3243, 0));
    });
});
