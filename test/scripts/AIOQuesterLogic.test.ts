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
            foods: ['trout'],
            eatBelowHp: 0.5
        });
    });

    test('adds active quest foods and raises the threshold', () => {
        expect(resolveSustainPolicy('Trout', 0.5, {
            foods: ['Bread'],
            eatBelowHp: 0.95
        })).toEqual({
            foods: ['bread', 'trout'],
            eatBelowHp: 0.95
        });
    });

    test('preserves a stricter user threshold', () => {
        expect(resolveSustainPolicy('Shark', 0.99, {
            foods: ['Bread'],
            eatBelowHp: 0.95
        })).toEqual({
            foods: ['bread', 'shark'],
            eatBelowHp: 0.99
        });
    });

    test('trims, ignores empty names, and de-duplicates foods case-insensitively', () => {
        expect(resolveSustainPolicy(' BREAD ', 0.5, {
            foods: ['Bread', '', ' bread ', 'Tuna'],
            eatBelowHp: 0.75
        })).toEqual({
            foods: ['bread', 'tuna'],
            eatBelowHp: 0.75
        });
    });

    test('allows quest food when the configured food is blank', () => {
        expect(resolveSustainPolicy(null, 0.5, {
            foods: ['Bread'],
            eatBelowHp: 0.95
        })).toEqual({
            foods: ['bread'],
            eatBelowHp: 0.95
        });
    });

    test('keeps eating a cake once it has been bitten', () => {
        expect(resolveSustainPolicy('Cake', 0.5).foods).toEqual(['cake', '2/3 cake', 'slice of cake']);
    });

    test('covers the half-eaten form of every multi-bite food it is given', () => {
        expect(resolveSustainPolicy('Meat pie', 0.5).foods).toEqual(['meat pie', 'half a meat pie']);
        expect(resolveSustainPolicy('Chocolate cake', 0.5).foods)
            .toEqual(['chocolate cake', '2/3 chocolate cake', 'chocolate slice']);
    });

    test('de-duplicates when a quest food and the configured food share a chain', () => {
        expect(resolveSustainPolicy('Cake', 0.5, {
            foods: ['Cake'],
            eatBelowHp: 0.5
        }).foods).toEqual(['cake', '2/3 cake', 'slice of cake']);
    });

    test('leaves single-stage food alone', () => {
        expect(resolveSustainPolicy(' Shark ', 0.5).foods).toEqual(['shark']);
    });
});
