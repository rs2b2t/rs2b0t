import { describe, expect, test } from 'bun:test';

import { BANK_LOCATIONS, nearestBank, nearestUsableBank } from '#/bot/api/BankLocations.js';
import type { BankLocation } from '#/bot/api/BankLocations.js';

test('bank names are unique', () => {
    const names = BANK_LOCATIONS.map(b => b.name);
    expect(new Set(names).size).toBe(names.length);
});

test('every bank centre is a plausible level-0 world tile', () => {
    for (const b of BANK_LOCATIONS) {
        expect(b.tile.level, b.name).toBe(0);
        expect(b.tile.x, b.name).toBeGreaterThan(2500);
        expect(b.tile.x, b.name).toBeLessThan(3600);
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
    expect(nearestBank({ x: 2605, z: 3085, level: 0 })?.name).toBe('Yanille');
    expect(nearestBank({ x: 3270, z: 3168, level: 0 })?.name).toBe('Al Kharid');
    expect(nearestBank({ x: 3090, z: 3245, level: 0 })?.name).toBe('Draynor');
});

test('nearestBank returns null when no bank is on the tile level', () => {
    expect(nearestBank({ x: 2612, z: 3092, level: 2 })).toBeNull();
});

const openOnly = (b: BankLocation): boolean => b.requires === undefined;
const all = (): boolean => true;

describe('bank entry gates', () => {
    test('Fishing Guild carries the Fishing 68 gate', () => {
        const guild = BANK_LOCATIONS.find(b => b.name === 'Fishing Guild')!;
        expect(guild.requires?.skill).toEqual({ name: 'fishing', level: 68 });
    });

    test('Shilo Village carries its quest gate', () => {
        const shilo = BANK_LOCATIONS.find(b => b.name === 'Shilo Village')!;
        expect(shilo.requires?.quest).toBe('Shilo Village');
    });

    test('Canifis carries its Priest in Peril gate', () => {
        const canifis = BANK_LOCATIONS.find(b => b.name === 'Canifis')!;
        expect(canifis.requires?.quest).toBe('Priest in Peril');
    });

    test('every other bank is ungated', () => {
        const gated = BANK_LOCATIONS.filter(b => b.requires !== undefined).map(b => b.name).sort();
        expect(gated).toEqual(['Canifis', 'Fishing Guild', 'Shilo Village']);
    });
});

describe('nearestUsableBank', () => {
    test('near Hemenster, a gated-out character routes past the Fishing Guild to Ardougne West', () => {
        const picked = nearestUsableBank({ x: 2600, z: 3420, level: 0 }, openOnly);
        expect(picked?.name).toBe('Ardougne West');
    });

    test('near Hemenster, a 68+ fisher still gets the Fishing Guild', () => {
        const picked = nearestUsableBank({ x: 2600, z: 3420, level: 0 }, all);
        expect(picked?.name).toBe('Fishing Guild');
    });

    test('near Shilo without the quest, routes to Yanille instead', () => {
        const picked = nearestUsableBank({ x: 2850, z: 2950, level: 0 }, openOnly);
        expect(picked?.name).toBe('Yanille');
    });

    test('in Canifis, a Priest-in-Peril character banks at Canifis', () => {
        const picked = nearestUsableBank({ x: 3510, z: 3481, level: 0 }, all);
        expect(picked?.name).toBe('Canifis');
    });

    test('level filter still applies', () => {
        expect(nearestUsableBank({ x: 2600, z: 3420, level: 1 }, all)).toBeNull();
    });
});
