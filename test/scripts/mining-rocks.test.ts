import { expect, test } from 'bun:test';

import { ROCK_OPTIONS, ROCK_TYPES, resolveRockIds } from '#/bot/scripts/MiningRocks.js';

// The rock loc ids are hand-transcribed from content pack/loc.pack — a typo
// would silently mine the wrong rock, so pin them.
test('every ore type maps to exactly two rock loc ids', () => {
    for (const [name, ids] of Object.entries(ROCK_TYPES)) {
        expect(ids.length, name).toBe(2);
    }
});

test('all rock loc ids are unique across ore types', () => {
    const all = Object.values(ROCK_TYPES).flat();
    expect(new Set(all).size).toBe(all.length);
});

test('rock loc ids are the contiguous 2090..2109 block', () => {
    const all = Object.values(ROCK_TYPES).flat().sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: 20 }, (_, i) => 2090 + i));
});

test('ROCK_OPTIONS lists every ore type', () => {
    expect(ROCK_OPTIONS).toEqual(Object.keys(ROCK_TYPES));
});

test('resolveRockIds maps selected names to their ids (case-insensitive)', () => {
    const ids = resolveRockIds(['iron', 'COAL']);
    expect([...ids].sort((a, b) => a - b)).toEqual([2092, 2093, 2096, 2097]);
});

test('resolveRockIds ignores unknown names and empty input', () => {
    expect(resolveRockIds(['granite', '']).size).toBe(0);
    expect(resolveRockIds([]).size).toBe(0);
});
