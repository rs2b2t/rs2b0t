import { describe, expect, test } from 'bun:test';
import Tile from '#/bot/api/Tile.js';
import {
    COW_LOCATIONS,
    COW_LOCATION_OPTIONS,
    isCowFieldLootTile,
    needsTollCoins,
    resolveCowLocation,
    shouldBootstrapTollCoins,
    TOLL_COIN_TARGET
} from '#/bot/api/CowKillerLocations.js';

describe('CowKiller locations', () => {
    test('maps the two supported fields to verified cow-spawn centres', () => {
        expect(COW_LOCATIONS.map(location => ({ name: location.name, anchor: location.anchor }))).toEqual([
            { name: 'Lumbridge cow field', anchor: new Tile(3255, 3288, 0) },
            { name: 'South of Falador', anchor: new Tile(3033, 3306, 0) }
        ]);
    });

    test('Auto picks Lumbridge from Al Kharid and Falador from Falador', () => {
        expect(resolveCowLocation('Auto', new Tile(3269, 3167, 0))?.name).toBe('Lumbridge cow field');
        expect(resolveCowLocation('Auto', new Tile(3013, 3355, 0))?.name).toBe('South of Falador');
    });

    test('named locations are case-insensitive and Start tile stays custom', () => {
        expect(resolveCowLocation('south of falador', new Tile(0, 0, 0))?.name).toBe('South of Falador');
        expect(resolveCowLocation('Start tile', new Tile(3255, 3288, 0))).toBeNull();
    });

    test('dropdown contains Auto, both fields, and custom start tile', () => {
        expect(COW_LOCATION_OPTIONS).toEqual(['Auto', 'Lumbridge cow field', 'South of Falador', 'Start tile']);
    });

    test('loot stays inside the anchored cow-hunting leash', () => {
        const lumbridge = COW_LOCATIONS[0].anchor;
        expect(isCowFieldLootTile(lumbridge, 18, new Tile(3233, 3298, 0))).toBe(false);
        expect(isCowFieldLootTile(lumbridge, 18, new Tile(3237, 3298, 0))).toBe(true);
        expect(isCowFieldLootTile(lumbridge, 18, new Tile(3255, 3288, 1))).toBe(false);

        const falador = COW_LOCATIONS[1].anchor;
        expect(isCowFieldLootTile(falador, 18, new Tile(3015, 3324, 0))).toBe(true);
        expect(isCowFieldLootTile(falador, 18, new Tile(3014, 3324, 0))).toBe(false);
    });
});

describe('Al Kharid toll float', () => {
    const lumbridge = COW_LOCATIONS[0];
    const falador = COW_LOCATIONS[1];

    test('only enabled Lumbridge runs keep toll coins', () => {
        expect(needsTollCoins(lumbridge, true)).toBe(true);
        expect(needsTollCoins(lumbridge, false)).toBe(false);
        expect(needsTollCoins(falador, true)).toBe(false);
        expect(needsTollCoins(null, true)).toBe(false);
    });

    test('bootstraps below 20 coins when starting around Al Kharid bank', () => {
        expect(shouldBootstrapTollCoins(lumbridge, new Tile(3269, 3167, 0), 0, true)).toBe(true);
        expect(shouldBootstrapTollCoins(lumbridge, new Tile(3269, 3167, 0), TOLL_COIN_TARGET, true)).toBe(false);
        expect(shouldBootstrapTollCoins(falador, new Tile(3269, 3167, 0), 0, true)).toBe(false);
        expect(shouldBootstrapTollCoins(lumbridge, new Tile(3210, 3424, 0), 0, true)).toBe(false);
    });
});
