import { expect, test } from 'bun:test';

import { WALK_DESTINATIONS, WALK_OPTIONS, resolveDestination } from '#/bot/scripts/WalkDestinations.js';

test('has all 11 named destinations with unique names', () => {
    expect(WALK_DESTINATIONS.length).toBe(11);
    const names = WALK_DESTINATIONS.map(d => d.name);
    expect(new Set(names).size).toBe(names.length);
});

test('every destination is a plausible level-0 world tile', () => {
    for (const d of WALK_DESTINATIONS) {
        expect(d.tile.level, d.name).toBe(0);
        expect(d.tile.x, d.name).toBeGreaterThan(2500);
        expect(d.tile.x, d.name).toBeLessThan(3400);
        expect(d.tile.z, d.name).toBeGreaterThan(3050);
        expect(d.tile.z, d.name).toBeLessThan(3700);
    }
});

test('canonical coords match their source (teleport landings + banks)', () => {
    const at = (n: string) => resolveDestination(n)?.tile;
    expect(at('Varrock')).toMatchObject({ x: 3213, z: 3424 });
    expect(at('Lumbridge')).toMatchObject({ x: 3221, z: 3218 });
    expect(at('Falador')).toMatchObject({ x: 2965, z: 3378 });
    expect(at('Yanille')).toMatchObject({ x: 2612, z: 3092 });
    expect(at("Seers' Village")).toMatchObject({ x: 2725, z: 3491 });
});

test('resolveDestination is case-insensitive and rejects unknowns', () => {
    expect(resolveDestination('yanille')?.name).toBe('Yanille');
    expect(resolveDestination('  AL KHARID ')?.name).toBe('Al Kharid');
    expect(resolveDestination('Atlantis')).toBeNull();
    expect(resolveDestination('')).toBeNull();
});

test('WALK_OPTIONS lists every destination name in order', () => {
    expect(WALK_OPTIONS).toEqual(WALK_DESTINATIONS.map(d => d.name));
});
