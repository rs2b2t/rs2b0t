import { describe, expect, test } from 'bun:test';

import { GAS_ROCK_IDS, PICKAXES, ROCK_OPTIONS, ROCK_TYPES, bestPickaxe, resolveRockIds } from '#/bot/scripts/MiningRocks.js';

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

describe('bestPickaxe', () => {
    const bank = (names: string[]) => (name: string) => names.includes(name);

    test('41 mining takes the rune pickaxe when the bank has one', () => {
        expect(bestPickaxe(41, bank(['Rune pickaxe', 'Adamant pickaxe', 'Bronze pickaxe']))).toBe('Rune pickaxe');
    });

    test('41 mining without a rune pick falls to adamant, then mithril, etc.', () => {
        expect(bestPickaxe(41, bank(['Adamant pickaxe', 'Mithril pickaxe']))).toBe('Adamant pickaxe');
        expect(bestPickaxe(41, bank(['Mithril pickaxe', 'Bronze pickaxe']))).toBe('Mithril pickaxe');
        expect(bestPickaxe(41, bank(['Bronze pickaxe']))).toBe('Bronze pickaxe');
    });

    test('level gates: 40 mining skips rune even when banked', () => {
        expect(bestPickaxe(40, bank(['Rune pickaxe', 'Adamant pickaxe']))).toBe('Adamant pickaxe');
        expect(bestPickaxe(20, bank(['Rune pickaxe', 'Adamant pickaxe', 'Mithril pickaxe', 'Steel pickaxe']))).toBe('Steel pickaxe');
        expect(bestPickaxe(5, bank(['Steel pickaxe', 'Iron pickaxe']))).toBe('Iron pickaxe');
    });

    test('empty bank → null', () => {
        expect(bestPickaxe(99, bank([]))).toBe(null);
    });

    test('ladder is best-first and level-descending', () => {
        for (let i = 1; i < PICKAXES.length; i++) {
            expect(PICKAXES[i - 1].level).toBeGreaterThanOrEqual(PICKAXES[i].level);
        }
    });
});

describe('GAS_ROCK_IDS', () => {
    test('gas variants never overlap the real ore rock ids', () => {
        for (const ids of Object.values(ROCK_TYPES)) {
            for (const id of ids) {
                expect(GAS_ROCK_IDS.has(id)).toBe(false);
            }
        }
    });
});
