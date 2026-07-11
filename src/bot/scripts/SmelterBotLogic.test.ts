import { describe, expect, test } from 'bun:test';
import {
    RECIPES,
    BAR_OPTIONS,
    recipeForBar,
    primaryOre,
    setsPerTrip,
    withdrawPlan,
    countPrimary,
    lastPrimaryIndex,
    type PackItem
} from './SmelterBotLogic.js';

const pack = (...names: (string | null)[]): PackItem[] => names.map(name => ({ name }));

describe('RECIPES table', () => {
    test('covers the eight bars, Bronze first (the default)', () => {
        expect(BAR_OPTIONS).toEqual(['Bronze', 'Iron', 'Silver', 'Steel', 'Gold', 'Mithril', 'Adamant', 'Rune']);
        expect(BAR_OPTIONS[0]).toBe('Bronze');
        expect(RECIPES.length).toBe(8);
    });

    test('recipeForBar is case-insensitive and returns undefined for junk', () => {
        expect(recipeForBar('bronze')?.bar).toBe('Bronze');
        expect(recipeForBar('  RUNE ')?.bar).toBe('Rune');
        expect(recipeForBar('platinum')).toBeUndefined();
    });

    test('bronze is two 1:1 primary ores, no coal', () => {
        const bronze = recipeForBar('Bronze')!;
        expect(bronze.ingredients).toEqual([
            { ore: 'Copper ore', perBar: 1 },
            { ore: 'Tin ore', perBar: 1 }
        ]);
        expect(primaryOre(bronze)).toBe('Copper ore');
        expect(bronze.level).toBe(1);
    });

    test('steel is iron + 2 coal', () => {
        const steel = recipeForBar('Steel')!;
        expect(steel.ingredients).toEqual([
            { ore: 'Iron ore', perBar: 1 },
            { ore: 'Coal', perBar: 2 }
        ]);
        expect(primaryOre(steel)).toBe('Iron ore');
        expect(steel.level).toBe(30);
    });

    test('coal-ratio bars carry the right coal per bar', () => {
        const coalPer = (bar: string) => recipeForBar(bar)!.ingredients.find(i => i.ore === 'Coal')?.perBar ?? 0;
        expect(coalPer('Mithril')).toBe(4);
        expect(coalPer('Adamant')).toBe(6);
        expect(coalPer('Rune')).toBe(8);
        // single-ore bars carry no coal
        expect(coalPer('Iron')).toBe(0);
        expect(coalPer('Gold')).toBe(0);
        expect(coalPer('Silver')).toBe(0);
    });
});

describe('setsPerTrip', () => {
    const sets = (bar: string) => setsPerTrip(recipeForBar(bar)!);
    test('matches the spec recipe table', () => {
        expect(sets('Bronze')).toBe(14);
        expect(sets('Iron')).toBe(28);
        expect(sets('Silver')).toBe(28);
        expect(sets('Steel')).toBe(9);
        expect(sets('Gold')).toBe(28);
        expect(sets('Mithril')).toBe(5);
        expect(sets('Adamant')).toBe(4);
        expect(sets('Rune')).toBe(3);
    });
});

describe('withdrawPlan', () => {
    test('every plan fits a 28-slot pack', () => {
        for (const r of RECIPES) {
            const total = withdrawPlan(r).reduce((sum, p) => sum + p.count, 0);
            expect(total).toBeLessThanOrEqual(28);
            expect(total).toBeGreaterThan(0);
        }
    });

    test('bronze withdraws 14 copper + 14 tin', () => {
        expect(withdrawPlan(recipeForBar('Bronze')!)).toEqual([
            { ore: 'Copper ore', count: 14 },
            { ore: 'Tin ore', count: 14 }
        ]);
    });

    test('steel withdraws 9 iron + 18 coal', () => {
        expect(withdrawPlan(recipeForBar('Steel')!)).toEqual([
            { ore: 'Iron ore', count: 9 },
            { ore: 'Coal', count: 18 }
        ]);
    });

    test('single-ore bars withdraw a full 28', () => {
        expect(withdrawPlan(recipeForBar('Iron')!)).toEqual([{ ore: 'Iron ore', count: 28 }]);
        expect(withdrawPlan(recipeForBar('Gold')!)).toEqual([{ ore: 'Gold ore', count: 28 }]);
    });

    test('rune withdraws 3 runite + 24 coal', () => {
        expect(withdrawPlan(recipeForBar('Rune')!)).toEqual([
            { ore: 'Runite ore', count: 3 },
            { ore: 'Coal', count: 24 }
        ]);
    });
});

describe('countPrimary / lastPrimaryIndex', () => {
    test('counts only the primary ore, ignoring coal + tin + bars', () => {
        const steel = recipeForBar('Steel')!;
        const items = pack('Iron ore', 'Coal', 'Coal', 'Iron ore', 'Steel bar', null);
        // iron is primary; coal, the produced steel bar, and empty slots don't count
        expect(countPrimary(items, steel)).toBe(2);
    });

    test('bronze counts copper (the primary), not tin', () => {
        const bronze = recipeForBar('Bronze')!;
        const items = pack('Copper ore', 'Tin ore', 'Copper ore', 'Tin ore', 'Bronze bar');
        expect(countPrimary(items, bronze)).toBe(2);
    });

    test('lastPrimaryIndex points at the last primary-ore slot', () => {
        const steel = recipeForBar('Steel')!;
        const items = pack('Iron ore', 'Coal', 'Iron ore', 'Coal', 'Coal');
        expect(lastPrimaryIndex(items, steel)).toBe(2);
    });

    test('lastPrimaryIndex is -1 when the primary ore is exhausted', () => {
        const steel = recipeForBar('Steel')!;
        const items = pack('Steel bar', 'Coal', 'Coal');
        expect(lastPrimaryIndex(items, steel)).toBe(-1);
        expect(countPrimary(items, steel)).toBe(0);
    });
});
