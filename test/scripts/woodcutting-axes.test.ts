import { describe, expect, test } from 'bun:test';

import { AXES, bestAxe } from '#/bot/api/Tools.js';

describe('bestAxe', () => {
    const bank = (names: string[]) => (name: string) => names.includes(name);

    test('41 woodcutting takes the rune axe when available', () => {
        expect(bestAxe(41, bank(['Rune axe', 'Adamant axe', 'Bronze axe']))).toBe('Rune axe');
    });

    test('41 woodcutting without rune falls to adamant, then mithril, etc.', () => {
        expect(bestAxe(41, bank(['Adamant axe', 'Mithril axe']))).toBe('Adamant axe');
        expect(bestAxe(41, bank(['Mithril axe', 'Bronze axe']))).toBe('Mithril axe');
        expect(bestAxe(41, bank(['Bronze axe']))).toBe('Bronze axe');
    });

    test('level gates: 40 woodcutting skips rune even when banked', () => {
        expect(bestAxe(40, bank(['Rune axe', 'Adamant axe']))).toBe('Adamant axe');
        expect(bestAxe(20, bank(['Rune axe', 'Adamant axe', 'Mithril axe', 'Steel axe']))).toBe('Steel axe');
        expect(bestAxe(5, bank(['Steel axe', 'Iron axe']))).toBe('Iron axe');
    });

    test('empty bank → null', () => {
        expect(bestAxe(99, bank([]))).toBe(null);
    });

    test('tiers are best-first and level-descending', () => {
        for (let i = 1; i < AXES.length; i++) {
            expect(AXES[i - 1].level).toBeGreaterThanOrEqual(AXES[i].level);
        }
    });
});
