import { describe, expect, test } from 'bun:test';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import Tile from '#/bot/geometry/Tile.js';
import {
    FISHING_LOCATIONS,
    FISHING_LOCATION_OPTIONS,
    LOCATION_OPTIONS,
    resolveFishingLocation,
    resolveLocation
} from '#/bot/data/fishingLocations.js';

const bankTiles = new Set(BANK_LOCATIONS.map(b => `${b.tile.x},${b.tile.z},${b.tile.level}`));

describe('Shilo Village camp', () => {
    test('resolves the river camp and existing quest-gated teller', () => {
        const shilo = resolveFishingLocation('Shilo Village', new Tile(2841, 2970, 0));
        expect(shilo?.spot).toEqual(new Tile(2841, 2970, 0));
        expect(shilo?.bankStand).toEqual(new Tile(2852, 2954, 0));
        expect(shilo?.boothName).toBeUndefined();
        expect(shilo?.boothOp).toBeUndefined();
        const teller = BANK_LOCATIONS.find(bank => bank.name === 'Shilo Village');
        expect(teller?.tile).toEqual(shilo?.bankStand);
        expect(teller?.npcAccess?.op).toBe('Bank');
        expect(teller?.requires?.quest).toBe('Shilo Village');
    });
    test('uses Fernahei only at Shilo, leaving every other camp without a vendor', () => {
        const shilo = FISHING_LOCATIONS.find(location => location.name === 'Shilo Village');
        expect(shilo?.baitVendor).toEqual({ keeper: 'Fernahei', stand: new Tile(2870, 2971, 0), price: 2, item: 'Feather' });
        expect(FISHING_LOCATIONS.filter(location => location.baitVendor).map(location => location.name)).toEqual(['Shilo Village']);
    });
    test('avoids far-bank spots and sweeps only the village side inside the camp', () => {
        const shilo = FISHING_LOCATIONS.find(location => location.name === 'Shilo Village');
        expect(shilo?.avoidSpots?.map(tile => [tile.x, tile.z])).toEqual([[2850, 2976], [2855, 2977], [2860, 2976], [2869, 2977]]);
        expect(shilo?.sweep?.map(tile => [tile.x, tile.z])).toEqual([[2862, 2971], [2856, 2972], [2841, 2970], [2836, 2970], [2822, 2968]]);
        for (const stop of shilo?.sweep ?? []) {
            expect(shilo?.spot.distanceTo(stop)).toBeLessThanOrEqual(shilo?.campRadius ?? 0);
            expect(shilo?.avoidSpots?.some(tile => tile.equals(stop))).toBe(false);
        }
    });
});

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

    test('Auto freeform from Lumbridge (outside Draynor map square)', () => {
        // Lumbridge 3222,3218 is map square (50,50); Draynor fish 3086,3231 is (48,50).
        expect(resolveFishingLocation('Auto', new Tile(3222, 3218, 0))).toBeNull();
    });

    test('Auto freeform on other level even when xz matches a camp', () => {
        // sameMapSquare requires level match, level 1 at Draynor coords is freeform.
        expect(resolveFishingLocation('Auto', new Tile(3086, 3231, 1))).toBeNull();
    });

    test('Auto freeform at Ardougne river fly (outside every fishing camp chunk)', () => {
        expect(resolveFishingLocation('Auto', new Tile(2566, 3374, 0))).toBeNull();
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

    test('core catalog entries are verified; tick-manip camps may be provisional', () => {
        const provisional = new Set(['Gnome Stronghold (fishing)', 'Shilo Village']);
        for (const loc of FISHING_LOCATIONS) {
            if (provisional.has(loc.name)) {
                expect(loc.verified, loc.name).toBe(false);
            } else {
                expect(loc.verified, loc.name).toBe(true);
            }
        }
    });

    test('includes Gnome Stronghold fishing camp (#160)', () => {
        expect(FISHING_LOCATIONS.some(l => l.name === 'Gnome Stronghold (fishing)')).toBe(true);
    });

    test('Karamja banks at Draynor (no local bank)', () => {
        const musa = FISHING_LOCATIONS.find(l => l.name === 'Karamja (Musa Point)');
        expect(musa?.bankStand).toEqual(new Tile(3093, 3243, 0));
    });
});
