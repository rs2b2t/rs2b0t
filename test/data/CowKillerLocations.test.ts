import { describe, expect, test } from 'bun:test';
import { BANK_LOCATIONS } from '#/bot/api/bank/BankLocations.js';
import Tile from '#/bot/geometry/Tile.js';
import {
    ARDOUGNE_EAST_BANK,
    COW_LOCATIONS,
    COW_LOCATION_OPTIONS,
    cowBankDestination,
    isCowFieldLootTile,
    needsTollCoins,
    resolveCowLocation,
    shouldBootstrapTollCoins,
    TOLL_COIN_TARGET
} from '#/bot/data/cowKillerLocations.js';

describe('CowKiller locations', () => {
    test('maps the supported fields to verified cow-spawn centres', () => {
        expect(COW_LOCATIONS.map(location => ({ name: location.name, anchor: location.anchor }))).toEqual([
            { name: 'Lumbridge cow field', anchor: new Tile(3255, 3288, 0) },
            { name: 'North-west of Lumbridge', anchor: new Tile(3168, 3329, 0) },
            { name: 'South of Falador', anchor: new Tile(3033, 3306, 0) },
            { name: 'East Ardougne cow field', anchor: new Tile(2664, 3347, 0) }
        ]);
    });

    test('Auto picks the local supported field from each nearby bank', () => {
        expect(resolveCowLocation('Auto', new Tile(3269, 3167, 0))?.name).toBe('Lumbridge cow field');
        expect(resolveCowLocation('Auto', new Tile(3185, 3440, 0))?.name).toBe('North-west of Lumbridge');
        expect(resolveCowLocation('Auto', new Tile(3013, 3355, 0))?.name).toBe('South of Falador');
        expect(resolveCowLocation('Auto', ARDOUGNE_EAST_BANK)?.name).toBe('East Ardougne cow field');
    });

    test('named locations are case-insensitive and Start tile stays custom', () => {
        expect(resolveCowLocation('south of falador', new Tile(0, 0, 0))?.name).toBe('South of Falador');
        expect(resolveCowLocation('east ardougne cow field', new Tile(0, 0, 0))?.name).toBe('East Ardougne cow field');
        expect(resolveCowLocation('Start tile', new Tile(3255, 3288, 0))).toBeNull();
    });

    test('dropdown contains Auto, every field, and custom start tile', () => {
        expect(COW_LOCATION_OPTIONS).toEqual([
            'Auto',
            'Lumbridge cow field',
            'North-west of Lumbridge',
            'South of Falador',
            'East Ardougne cow field',
            'Start tile'
        ]);
    });

    test('loot stays inside the anchored cow-hunting leash', () => {
        const lumbridge = COW_LOCATIONS[0].anchor;
        expect(isCowFieldLootTile(lumbridge, 18, new Tile(3233, 3298, 0))).toBe(false);
        expect(isCowFieldLootTile(lumbridge, 18, new Tile(3237, 3298, 0))).toBe(true);
        expect(isCowFieldLootTile(lumbridge, 18, new Tile(3255, 3288, 1))).toBe(false);

        const falador = COW_LOCATIONS[2].anchor;
        expect(isCowFieldLootTile(falador, 18, new Tile(3015, 3324, 0))).toBe(true);
        expect(isCowFieldLootTile(falador, 18, new Tile(3014, 3324, 0))).toBe(false);
    });

    // the scouted spawns run x 3154..3182, z 3316..3342 — the default leash must hold them
    test('the north-west field leash covers its scouted cow spawns', () => {
        const northWest = COW_LOCATIONS[1].anchor;
        for (const cow of [new Tile(3154, 3326, 0), new Tile(3182, 3331, 0), new Tile(3159, 3316, 0), new Tile(3157, 3342, 0)]) {
            expect(isCowFieldLootTile(northWest, 18, cow)).toBe(true);
        }
    });

    // Authoritative server map content/maps/m41_52.jm2: all ten npc id 81 placements.
    test('the East Ardougne anchor covers every map-backed cow spawn', () => {
        const eastArdougne = COW_LOCATIONS[3].anchor;
        for (const cow of [
            new Tile(2657, 3341, 0),
            new Tile(2658, 3351, 0),
            new Tile(2660, 3344, 0),
            new Tile(2664, 3341, 0),
            new Tile(2664, 3348, 0),
            new Tile(2664, 3352, 0),
            new Tile(2666, 3344, 0),
            new Tile(2670, 3348, 0),
            new Tile(2671, 3342, 0),
            new Tile(2672, 3354, 0)
        ]) {
            expect(isCowFieldLootTile(eastArdougne, 18, cow), cow.toString()).toBe(true);
        }
    });
});

describe('Al Kharid toll float', () => {
    const lumbridge = COW_LOCATIONS[0];
    const northWest = COW_LOCATIONS[1];
    const falador = COW_LOCATIONS[2];
    const eastArdougne = COW_LOCATIONS[3];

    test('only enabled Lumbridge runs keep toll coins', () => {
        expect(needsTollCoins(lumbridge, true)).toBe(true);
        expect(needsTollCoins(lumbridge, false)).toBe(false);
        expect(needsTollCoins(northWest, true)).toBe(false);
        expect(needsTollCoins(falador, true)).toBe(false);
        expect(needsTollCoins(eastArdougne, true)).toBe(false);
        expect(needsTollCoins(null, true)).toBe(false);
    });

    test('bootstraps below 20 coins when starting around Al Kharid bank', () => {
        expect(shouldBootstrapTollCoins(lumbridge, new Tile(3269, 3167, 0), 0, true)).toBe(true);
        expect(shouldBootstrapTollCoins(lumbridge, new Tile(3269, 3167, 0), TOLL_COIN_TARGET, true)).toBe(false);
        expect(shouldBootstrapTollCoins(falador, new Tile(3269, 3167, 0), 0, true)).toBe(false);
        expect(shouldBootstrapTollCoins(lumbridge, new Tile(3210, 3424, 0), 0, true)).toBe(false);
    });

    test('pins East Ardougne to its east bank without adding a toll or supply requirement', () => {
        const knownBank = BANK_LOCATIONS.find(bank => bank.name === 'Ardougne East');
        expect(knownBank?.tile).toEqual(ARDOUGNE_EAST_BANK);
        expect(cowBankDestination(eastArdougne, true)).toEqual({
            name: 'Ardougne East',
            tile: ARDOUGNE_EAST_BANK
        });
        expect(cowBankDestination(eastArdougne, false)).toEqual({
            name: 'Ardougne East',
            tile: ARDOUGNE_EAST_BANK
        });
        expect(cowBankDestination(COW_LOCATIONS[0], true)).toEqual({
            name: 'Al Kharid',
            tile: new Tile(3269, 3167, 0)
        });
        expect(cowBankDestination(northWest, true)).toBeNull();
    });
});
