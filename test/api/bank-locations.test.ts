import { expect, test } from 'bun:test';

import { BANK_LOCATIONS, nearestBank } from '#/bot/api/BankLocations.js';

test('bank names are unique', () => {
    const names = BANK_LOCATIONS.map(b => b.name);
    expect(new Set(names).size).toBe(names.length);
});

test('every bank centre is a plausible level-0 world tile', () => {
    for (const b of BANK_LOCATIONS) {
        expect(b.tile.level, b.name).toBe(0);
        expect(b.tile.x, b.name).toBeGreaterThan(2500);
        expect(b.tile.x, b.name).toBeLessThan(3500);
        expect(b.tile.z, b.name).toBeGreaterThan(2900);
        expect(b.tile.z, b.name).toBeLessThan(3600);
    }
});

test('Yanille bank centre matches its bank_zones midpoint', () => {
    const yanille = BANK_LOCATIONS.find(b => b.name === 'Yanille');
    expect(yanille?.tile.x).toBe(2612);
    expect(yanille?.tile.z).toBe(3092);
});

test('nearestBank returns the closest bank on the same level', () => {
    // just outside Yanille bank
    expect(nearestBank({ x: 2605, z: 3085, level: 0 })?.name).toBe('Yanille');
    // right by the Al Kharid bank
    expect(nearestBank({ x: 3270, z: 3168, level: 0 })?.name).toBe('Al Kharid');
    // by Draynor bank
    expect(nearestBank({ x: 3090, z: 3245, level: 0 })?.name).toBe('Draynor');
});

test('nearestBank returns null when no bank is on the tile level', () => {
    expect(nearestBank({ x: 2612, z: 3092, level: 2 })).toBeNull();
});
