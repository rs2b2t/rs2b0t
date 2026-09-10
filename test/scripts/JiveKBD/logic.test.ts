import { describe, expect, test } from 'bun:test';
import { ANTIPOISON_DOSES, DOSE_MARGIN_TICKS, IMMUNE_TICKS, POISONED, antipoisonPlan, doseDue, doseToDrink } from '#/bot/scripts/JiveKBD/logic.js';

describe('POISONED', () => {
    test('matches the poison_player line whatever the case', () => {
        expect(POISONED.test('You have been poisoned!')).toBe(true);
        expect(POISONED.test('you have been poisoned!')).toBe(true);
    });

    test('ignores the cure and the shield lines', () => {
        expect(POISONED.test('You drink some of your antipoison potion.')).toBe(false);
        expect(POISONED.test("Your shield absorbs most of the dragon's toxic breath!")).toBe(false);
    });
});

describe('doseDue', () => {
    test('owed when nothing has been drunk', () => {
        expect(doseDue(null, 1000)).toBe(true);
    });

    test('not owed inside the immunity window less the margin', () => {
        expect(doseDue(1000, 1000 + IMMUNE_TICKS - DOSE_MARGIN_TICKS - 1)).toBe(false);
    });

    test('owed once the margin is reached', () => {
        expect(doseDue(1000, 1000 + IMMUNE_TICKS - DOSE_MARGIN_TICKS)).toBe(true);
    });
});

describe('doseToDrink', () => {
    test('drinks the smallest flask held first', () => {
        const held: Record<string, number> = { 'Superantipoison(4)': 1, 'Superantipoison(2)': 1 };
        expect(doseToDrink(n => held[n] ?? 0)).toBe('Superantipoison(2)');
    });

    test('null with no dose in the pack', () => {
        expect(doseToDrink(() => 0)).toBeNull();
    });
});

describe('antipoisonPlan', () => {
    test('draws the four-dose flask and counts every dose form', () => {
        const plan = antipoisonPlan(2);
        expect(plan.flask).toBe('Superantipoison(4)');
        expect(plan.doses).toEqual(ANTIPOISON_DOSES);
        expect(plan.want).toBe(2);
        expect(ANTIPOISON_DOSES).toEqual(['Superantipoison(4)', 'Superantipoison(3)', 'Superantipoison(2)', 'Superantipoison(1)']);
    });
});
