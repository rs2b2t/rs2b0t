import { describe, expect, test } from 'bun:test';
import {
    BAR_OPTIONS,
    NATURES_MIN,
    SUPERHEAT_SLOTS,
    barsPerTrip,
    barsSmeltable,
    oresPerBar,
    primaryOre,
    recipeForBar,
    withdrawSet
} from '#/bot/scripts/SuperheaterLogic.js';

describe('barsPerTrip — 27 ore slots (28-pack minus the nature-rune slot)', () => {
    test('single-ore bars make a full 27', () => {
        expect(barsPerTrip(recipeForBar('Iron')!)).toBe(27);
        expect(barsPerTrip(recipeForBar('Silver')!)).toBe(27);
        expect(barsPerTrip(recipeForBar('Gold')!)).toBe(27);
        expect(barsPerTrip(recipeForBar('Blurite')!)).toBe(27);
    });

    test('the coal ladder 2-4-6-8 maps to 13/9/5/3/3', () => {
        expect(barsPerTrip(recipeForBar('Bronze')!)).toBe(13);
        expect(barsPerTrip(recipeForBar('Steel')!)).toBe(9);
        expect(barsPerTrip(recipeForBar('Mithril')!)).toBe(5);
        expect(barsPerTrip(recipeForBar('Adamant')!)).toBe(3);
        expect(barsPerTrip(recipeForBar('Rune')!)).toBe(3);
    });
});

describe('withdrawSet — every recipe fits the 27 ore slots', () => {
    const cases: [string, Record<string, number>][] = [
        ['Bronze', { 'Copper ore': 13, 'Tin ore': 13 }],
        ['Iron', { 'Iron ore': 27 }],
        ['Steel', { 'Iron ore': 9, Coal: 18 }],
        ['Silver', { 'Silver ore': 27 }],
        ['Gold', { 'Gold ore': 27 }],
        ['Mithril', { 'Mithril ore': 5, Coal: 20 }],
        ['Adamant', { 'Adamantite ore': 3, Coal: 18 }],
        ['Rune', { 'Runite ore': 3, Coal: 24 }],
        ['Blurite', { 'Blurite ore': 27 }]
    ];

    for (const [bar, expected] of cases) {
        test(`${bar} → ${JSON.stringify(expected)}`, () => {
            expect(withdrawSet(recipeForBar(bar)!)).toEqual(expected);
        });
    }

    test('every withdraw set sums to at most SUPERHEAT_SLOTS ores', () => {
        for (const bar of BAR_OPTIONS) {
            const set = withdrawSet(recipeForBar(bar)!);
            const total = Object.values(set).reduce((n, count) => n + count, 0);
            expect(total, `${bar} totals ${total} > ${SUPERHEAT_SLOTS}`).toBeLessThanOrEqual(SUPERHEAT_SLOTS);
        }
    });
});

describe('recipe table', () => {
    test('oresPerBar matches the coal ladder', () => {
        expect(oresPerBar(recipeForBar('Steel')!)).toBe(3);
        expect(oresPerBar(recipeForBar('Mithril')!)).toBe(5);
        expect(oresPerBar(recipeForBar('Adamant')!)).toBe(7);
        expect(oresPerBar(recipeForBar('Rune')!)).toBe(9);
        expect(oresPerBar(recipeForBar('Iron')!)).toBe(1);
    });

    test('primary ore is the first ingredient (the cast target)', () => {
        expect(primaryOre(recipeForBar('Steel')!)).toBe('Iron ore');
        expect(primaryOre(recipeForBar('Mithril')!)).toBe('Mithril ore');
        expect(primaryOre(recipeForBar('Rune')!)).toBe('Runite ore');
    });

    test('level gating values are sane', () => {
        expect(recipeForBar('Iron')!.level).toBe(15);
        expect(recipeForBar('Steel')!.level).toBe(30);
        expect(recipeForBar('Rune')!.level).toBe(85);
    });

    test('case-insensitive lookup and unknowns are undefined', () => {
        expect(recipeForBar('steel')!.bar).toBe('Steel');
        expect(recipeForBar('not a bar')).toBeUndefined();
    });

    test('BAR_OPTIONS lists every recipe including Blurite', () => {
        expect(BAR_OPTIONS).toContain('Bronze');
        expect(BAR_OPTIONS).toContain('Rune');
        expect(BAR_OPTIONS).toContain('Blurite');
    });
});

describe('barsSmeltable — bars left from remaining ores', () => {
    test('steel is min(iron, coal/2)', () => {
        const steel = recipeForBar('Steel')!;
        const count = (ore: string) => ({ 'Iron ore': 4, Coal: 8 }[ore] ?? 0);
        expect(barsSmeltable(steel, count)).toBe(4);
    });

    test('coal is the limiting factor', () => {
        const steel = recipeForBar('Steel')!;
        const count = (ore: string) => ({ 'Iron ore': 10, Coal: 6 }[ore] ?? 0);
        expect(barsSmeltable(steel, count)).toBe(3);
    });

    test('single-ore bars floor by their own count', () => {
        const iron = recipeForBar('Iron')!;
        expect(barsSmeltable(iron, ore => (ore === 'Iron ore' ? 5 : 0))).toBe(5);
    });

    test('nothing smeltable when any ingredient is missing', () => {
        const steel = recipeForBar('Steel')!;
        const count = (ore: string) => ({ 'Iron ore': 4, Coal: 0 }[ore] ?? 0);
        expect(barsSmeltable(steel, count)).toBe(0);
    });
});

describe('constants', () => {
    test('SUPERHEAT_SLOTS is the 27 ore slots', () => {
        expect(SUPERHEAT_SLOTS).toBe(27);
    });

    test('NATURES_MIN sits above a full trip', () => {
        expect(NATURES_MIN).toBeGreaterThan(27);
    });
});
