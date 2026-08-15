import { describe, expect, test } from 'bun:test';
import {
    resolveConsumeAction,
    resolveSustainPolicy,
    selectSustainConsumable
} from '#/bot/scripts/AIOQuester/AIOQuesterLogic.js';

interface FoodStub {
    name: string | null;
    actions(): string[];
}

function food(name: string | null, ops: string[] = ['Eat']): FoodStub {
    return { name, actions: () => ops };
}

describe('resolveConsumeAction', () => {
    test('uses the exact offered Eat or Drink operation', () => {
        expect(resolveConsumeAction(['Use', 'Eat', 'Drop'])).toBe('Eat');
        expect(resolveConsumeAction(['drink', 'Drop'])).toBe('drink');
    });

    test('fails closed when the item is not consumable', () => {
        expect(resolveConsumeAction(['Use', 'Drop'])).toBeNull();
    });
});

describe('selectSustainConsumable', () => {
    test('a Lobster in the first slot cannot veto any later Cake form that exactly fits', () => {
        const policy = resolveSustainPolicy('Lobster');
        for (const name of ['Cake', '2/3 cake', 'Slice of cake']) {
            const lobster = food('Lobster');
            const cake = food(name);
            expect(selectSustainConsumable([lobster, cake], policy.foods, 6, 10)).toEqual({
                item: cake,
                action: 'Eat'
            });
        }
    });

    test('uses the inclusive no-overheal boundary for the selected Cake form', () => {
        const lobster = food('Lobster');
        const cake = food('Cake');
        expect(selectSustainConsumable([lobster, cake], ['lobster'], 6, 10)).toEqual({
            item: cake,
            action: 'Eat'
        });
        expect(selectSustainConsumable([lobster, cake], ['lobster'], 7, 10)).toBeNull();
    });

    test('prefers a fitting Cake over the emergency-floor Lobster fallback', () => {
        const lobster = food('Lobster');
        const cake = food('Slice of cake');
        expect(selectSustainConsumable([lobster, cake], ['lobster', 'slice of cake'], 5, 10)).toEqual({
            item: cake,
            action: 'Eat'
        });
        expect(selectSustainConsumable([lobster], ['lobster'], 5, 10)).toEqual({
            item: lobster,
            action: 'Eat'
        });

        const cakeFirst = food('Cake');
        expect(selectSustainConsumable([cakeFirst, lobster], ['lobster'], 5, 8)).toEqual({
            item: lobster,
            action: 'Eat'
        });
    });

    test('returns the chosen item and its actual operation while ignoring unusable matches', () => {
        const unusableCake = food('Cake', ['Use', 'Drop']);
        const cakeSlice = food('Slice of cake', ['eat', 'Drop']);
        expect(selectSustainConsumable(
            [unusableCake, cakeSlice],
            ['cake', 'slice of cake'],
            6,
            10
        )).toEqual({ item: cakeSlice, action: 'eat' });
    });

    test('implicitly permits only the plain Cake chain outside the active policy', () => {
        expect(selectSustainConsumable([food('Cake')], ['lobster'], 6, 10)?.item.name)
            .toBe('Cake');
        expect(selectSustainConsumable([food('2/3 cake')], ['lobster'], 6, 10)?.item.name)
            .toBe('2/3 cake');
        expect(selectSustainConsumable([food('Slice of cake')], ['lobster'], 6, 10)?.item.name)
            .toBe('Slice of cake');
        expect(selectSustainConsumable([food('Bread')], ['lobster'], 5, 10)).toBeNull();
        expect(selectSustainConsumable([food('Chocolate cake')], ['lobster'], 5, 10)).toBeNull();
        expect(selectSustainConsumable([food('Rock cake')], ['lobster'], 5, 10)).toBeNull();
    });

    test('does not apply the emergency overfill floor to an implicit Cake', () => {
        expect(selectSustainConsumable([food('Cake')], ['lobster'], 5, 8)).toBeNull();
        expect(selectSustainConsumable([food('Cake')], ['cake'], 5, 8)?.item.name)
            .toBe('Cake');
    });
});

describe('resolveSustainPolicy', () => {
    test('uses the configured food when no quest policy is active', () => {
        expect(resolveSustainPolicy('Trout')).toEqual({
            foods: ['trout']
        });
    });

    test('adds active quest foods ahead of the configured food', () => {
        expect(resolveSustainPolicy('Trout', {
            foods: ['Bread'],
            eatBelowHp: 0.95
        })).toEqual({
            foods: ['bread', 'trout']
        });
    });

    test('trims, ignores empty names, and de-duplicates foods case-insensitively', () => {
        expect(resolveSustainPolicy(' BREAD ', {
            foods: ['Bread', '', ' bread ', 'Tuna'],
            eatBelowHp: 0.75
        })).toEqual({
            foods: ['bread', 'tuna']
        });
    });

    test('allows quest food when the configured food is blank', () => {
        expect(resolveSustainPolicy(null, {
            foods: ['Bread'],
            eatBelowHp: 0.95
        })).toEqual({
            foods: ['bread']
        });
    });

    test('keeps eating a cake once it has been bitten', () => {
        expect(resolveSustainPolicy('Cake').foods).toEqual(['cake', '2/3 cake', 'slice of cake']);
    });

    test('covers the half-eaten form of every multi-bite food it is given', () => {
        expect(resolveSustainPolicy('Meat pie').foods).toEqual(['meat pie', 'half a meat pie']);
        expect(resolveSustainPolicy('Chocolate cake').foods)
            .toEqual(['chocolate cake', '2/3 chocolate cake', 'chocolate slice']);
    });

    test('de-duplicates when a quest food and the configured food share a chain', () => {
        expect(resolveSustainPolicy('Cake', {
            foods: ['Cake'],
            eatBelowHp: 0.5
        }).foods).toEqual(['cake', '2/3 cake', 'slice of cake']);
    });

    test('leaves single-stage food alone', () => {
        expect(resolveSustainPolicy(' Shark ').foods).toEqual(['shark']);
    });
});
