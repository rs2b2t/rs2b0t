import { describe, expect, test } from 'bun:test';
import { BANK_LOCATIONS } from '#/bot/api/BankLocations.js';
import Tile from '#/bot/api/Tile.js';
import {
    MINING_LOCATIONS,
    MINING_LOCATION_OPTIONS,
    resolveMiningLocation
} from '#/bot/scripts/MiningLocations.js';

const bankTiles = new Set(BANK_LOCATIONS.map(b => `${b.tile.x},${b.tile.z},${b.tile.level}`));

describe('resolveMiningLocation', () => {
    test('None → null', () => {
        expect(resolveMiningLocation('None', new Tile(3181, 3371, 0))).toBeNull();
    });

    test('Auto near SW Varrock mine', () => {
        expect(resolveMiningLocation('Auto', new Tile(3181, 3371, 0))?.name).toBe(
            'Southwest Varrock Mine'
        );
    });

    test('Auto near Barbarian Village prefers Barb over distant mines', () => {
        expect(resolveMiningLocation('Auto', new Tile(3080, 3420, 0))?.name).toBe('Barbarian Village');
    });

    test('named match is case-insensitive', () => {
        expect(resolveMiningLocation('rimmington mine', new Tile(0, 0, 0))?.name).toBe('Rimmington Mine');
    });
});

describe('MINING_LOCATIONS table', () => {
    test('dropdown is Auto + camps + None', () => {
        expect(MINING_LOCATION_OPTIONS[0]).toBe('Auto');
        expect(MINING_LOCATION_OPTIONS.at(-1)).toBe('None');
        expect(MINING_LOCATION_OPTIONS).toHaveLength(MINING_LOCATIONS.length + 2);
        for (const loc of MINING_LOCATIONS) {
            expect(MINING_LOCATION_OPTIONS).toContain(loc.name);
        }
    });

    test('every bankStand is a known BANK_LOCATIONS tile', () => {
        for (const loc of MINING_LOCATIONS) {
            const key = `${loc.bankStand.x},${loc.bankStand.z},${loc.bankStand.level}`;
            expect(bankTiles.has(key), `${loc.name} bank ${key}`).toBe(true);
        }
    });

    test('catalog entries are verified', () => {
        expect(MINING_LOCATIONS.every(l => l.verified === true)).toBe(true);
    });

    test('has CSV core camps', () => {
        const names = new Set(MINING_LOCATIONS.map(l => l.name));
        for (const n of [
            'Southwest Varrock Mine',
            'Rimmington Mine',
            'Al Kharid Mine',
            'Mining Guild',
            'Lava Maze Runite Mine'
        ]) {
            expect(names.has(n), n).toBe(true);
        }
    });
});
