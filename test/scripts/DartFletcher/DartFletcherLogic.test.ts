import { describe, expect, test } from 'bun:test';
import {
    DART_ACTIONS_PER_TICK,
    DART_PLANS,
    DARTS_PER_ACTION,
    dartActionsFor,
    dartPlanFor,
    dartXpCeilingPerHour
} from '#/bot/scripts/DartFletcher/DartFletcherLogic.js';

describe('DartFletcher plans', () => {
    test('all six content tiers carry their exact level and XP requirements', () => {
        expect(DART_PLANS).toEqual([
            { tier: 'Bronze', tips: 'Bronze dart tip', product: 'Bronze dart', level: 1, xpPerDart: 1.8 },
            { tier: 'Iron', tips: 'Iron dart tip', product: 'Iron dart', level: 22, xpPerDart: 3.8 },
            { tier: 'Steel', tips: 'Steel dart tip', product: 'Steel dart', level: 37, xpPerDart: 7.5 },
            { tier: 'Mithril', tips: 'Mithril dart tip', product: 'Mithril dart', level: 52, xpPerDart: 11.2 },
            { tier: 'Adamant', tips: 'Adamant dart tip', product: 'Adamant dart', level: 67, xpPerDart: 15 },
            { tier: 'Rune', tips: 'Rune dart tip', product: 'Rune dart', level: 81, xpPerDart: 18.8 }
        ]);
    });

    test('tier lookup is case- and whitespace-insensitive', () => {
        expect(dartPlanFor('  rUnE  ')).toEqual(DART_PLANS[5]);
        expect(dartPlanFor('dragon')).toBeNull();
    });
});

describe('dartActionsFor', () => {
    test('sends only the number of ten-dart actions the remaining stacks need', () => {
        expect(dartActionsFor(0, 100)).toBe(0);
        expect(dartActionsFor(1, 100)).toBe(1);
        expect(dartActionsFor(10, 100)).toBe(1);
        expect(dartActionsFor(11, 100)).toBe(2);
        expect(dartActionsFor(49, 100)).toBe(5);
    });

    test('caps a burst at the engine user-event ceiling', () => {
        expect(DARTS_PER_ACTION).toBe(10);
        expect(DART_ACTIONS_PER_TICK).toBe(5);
        expect(dartActionsFor(1_000_000, 1_000_000)).toBe(5);
    });

    test('the scarcer stack controls the burst and bad counts are harmless', () => {
        expect(dartActionsFor(100, 21)).toBe(3);
        expect(dartActionsFor(-1, 100)).toBe(0);
    });
});

test('Rune ceiling is 5.64m XP/hr at normal 600ms ticks', () => {
    expect(dartXpCeilingPerHour(DART_PLANS[5])).toBe(5_640_000);
    expect(dartXpCeilingPerHour(DART_PLANS[5], 0)).toBe(0);
});
