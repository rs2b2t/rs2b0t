import { describe, expect, test } from 'bun:test';

import { BANK_LOCATIONS, nearestBank, nearestUsableBank } from '#/bot/api/BankLocations.js';
import type { BankLocation } from '#/bot/api/BankLocations.js';

test('bank names are unique', () => {
    const names = BANK_LOCATIONS.map(b => b.name);
    expect(new Set(names).size).toBe(names.length);
});

test('every bank centre is a plausible world tile', () => {
    for (const b of BANK_LOCATIONS) {
        expect(b.tile.level, b.name).toBeGreaterThanOrEqual(0);
        expect(b.tile.level, b.name).toBeLessThanOrEqual(3);
        expect(b.tile.x, b.name).toBeGreaterThan(2300);
        expect(b.tile.x, b.name).toBeLessThan(3600);
        expect(b.tile.z, b.name).toBeGreaterThan(2900);
        expect(b.tile.z, b.name).toBeLessThan(3600);
    }
});

test('Grand Tree bank is 1F at booths (no quest gate)', () => {
    const gt = BANK_LOCATIONS.find(b => b.name === 'Grand Tree');
    // Field-wise, like the Yanille case below: a Tile carries methods an object literal
    // does not, so toEqual against a bare literal does not typecheck.
    expect(gt?.tile.x).toBe(2449);
    expect(gt?.tile.z).toBe(3482);
    expect(gt?.tile.level).toBe(1);
    expect(gt?.requires).toBeUndefined();
});

test('Yanille bank centre matches its bank_zones midpoint', () => {
    const yanille = BANK_LOCATIONS.find(b => b.name === 'Yanille');
    expect(yanille?.tile.x).toBe(2612);
    expect(yanille?.tile.z).toBe(3092);
});

test('Duel Arena opens its chest before using the bank action', () => {
    const duelArena = BANK_LOCATIONS.find(b => b.name === 'Duel Arena');
    expect(duelArena?.access).toEqual({
        name: 'Open chest',
        op: 'Bank',
        openFirst: { name: 'Closed chest', op: 'Open' }
    });
    expect(BANK_LOCATIONS.filter(bank => bank.access).map(bank => bank.name)).toEqual(['Duel Arena']);
});

test('nearestBank returns the closest bank on the same level', () => {
    expect(nearestBank({ x: 2605, z: 3085, level: 0 })?.name).toBe('Yanille');
    expect(nearestBank({ x: 3270, z: 3168, level: 0 })?.name).toBe('Al Kharid');
    expect(nearestBank({ x: 3090, z: 3245, level: 0 })?.name).toBe('Draynor');
});

test('Barbarian Village tin/coal banks at Edgeville (not Falador East)', () => {
    // Chebyshev wrongly picks Falador East; Euclidean walk is shorter to Edgeville.
    expect(nearestBank({ x: 3080, z: 3420, level: 0 })?.name).toBe('Edgeville');
    expect(nearestBank({ x: 3078, z: 3415, level: 0 })?.name).toBe('Edgeville');
});

test('nearestBank returns null when no bank is on the tile level', () => {
    expect(nearestBank({ x: 2612, z: 3092, level: 2 })).toBeNull();
});

test('nearestBank on Grand Tree 1F picks Grand Tree (ungated)', () => {
    expect(nearestBank({ x: 2449, z: 3482, level: 1 })?.name).toBe('Grand Tree');
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

    test('Grand Tree bank is ungated (mine still needs the quest)', () => {
        const gt = BANK_LOCATIONS.find(b => b.name === 'Grand Tree')!;
        expect(gt.requires).toBeUndefined();
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

    test('level filter still applies (no level-2 banks)', () => {
        expect(nearestUsableBank({ x: 2600, z: 3420, level: 2 }, all)).toBeNull();
    });

    test('on Grand Tree 1F, banks at Grand Tree without a quest gate', () => {
        expect(nearestUsableBank({ x: 2449, z: 3482, level: 1 }, openOnly)?.name).toBe('Grand Tree');
        expect(nearestUsableBank({ x: 2449, z: 3482, level: 1 }, all)?.name).toBe('Grand Tree');
    });
});
