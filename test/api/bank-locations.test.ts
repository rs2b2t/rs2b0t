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

// nearestBank must never route a character to a bank it cannot ENTER: the
// Fishing Guild needs Fishing 68 and Shilo Village needs its quest — pure
// geometry stranded sub-68 characters at the guild door (live 2026-07-17,
// re-hit 2026-07-21). Selection is tested PURE via an injected usability
// predicate; the live nearestBank() wrapper is one branch reading
// Skills/Quests with the standard idiom (mocking those modules globally
// would poison sibling suites — the bun mock.module gotcha).
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

    test('every other bank is ungated', () => {
        const gated = BANK_LOCATIONS.filter(b => b.requires !== undefined).map(b => b.name).sort();
        expect(gated).toEqual(['Fishing Guild', 'Shilo Village']);
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

    test('level filter still applies', () => {
        expect(nearestUsableBank({ x: 2600, z: 3420, level: 1 }, all)).toBeNull();
    });
});
