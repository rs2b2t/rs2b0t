import { describe, expect, test } from 'bun:test';
import { resolveConsumeAction, resolveSustainPolicy } from '#/bot/scripts/AIOQuesterLogic.js';

describe('resolveConsumeAction', () => {
    test('uses the exact offered Eat or Drink operation', () => {
        expect(resolveConsumeAction(['Use', 'Eat', 'Drop'])).toBe('Eat');
        expect(resolveConsumeAction(['drink', 'Drop'])).toBe('drink');
    });

    test('fails closed when the item is not consumable', () => {
        expect(resolveConsumeAction(['Use', 'Drop'])).toBeNull();
    });
});

describe('resolveSustainPolicy', () => {
    test('uses the configured food and threshold when no quest policy is active', () => {
        expect(resolveSustainPolicy('Trout', 0.5)).toEqual({
            foods: ['Trout'],
            eatBelowHp: 0.5
        });
    });

    test('adds active quest foods and raises the threshold', () => {
        expect(resolveSustainPolicy('Trout', 0.5, {
            foods: ['Bread'],
            eatBelowHp: 0.95
        })).toEqual({
            foods: ['Bread', 'Trout'],
            eatBelowHp: 0.95
        });
    });

    test('preserves a stricter user threshold', () => {
        expect(resolveSustainPolicy('Shark', 0.99, {
            foods: ['Bread'],
            eatBelowHp: 0.95
        })).toEqual({
            foods: ['Bread', 'Shark'],
            eatBelowHp: 0.99
        });
    });

    test('trims, ignores empty names, and de-duplicates foods case-insensitively', () => {
        expect(resolveSustainPolicy(' BREAD ', 0.5, {
            foods: ['Bread', '', ' bread ', 'Cake'],
            eatBelowHp: 0.75
        })).toEqual({
            foods: ['Bread', 'Cake'],
            eatBelowHp: 0.75
        });
    });

    test('allows quest food when the configured food is blank', () => {
        expect(resolveSustainPolicy(null, 0.5, {
            foods: ['Bread'],
            eatBelowHp: 0.95
        })).toEqual({
            foods: ['Bread'],
            eatBelowHp: 0.95
        });
    });
});
