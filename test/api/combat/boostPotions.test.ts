import { describe, expect, test } from 'bun:test';

import {
    BOOST_FLOOR,
    BOOST_POTIONS,
    EMPTY_VIAL,
    SUPER_ATTACK,
    SUPER_STRENGTH,
    boostFaded,
    plannedPotions,
    potionToSip,
    type BoostPotion,
    type PotionPlan,
    type SipState
} from '#/bot/api/combat/boostPotions.js';

const plan = (potion: BoostPotion = SUPER_ATTACK, over: Partial<PotionPlan> = {}): PotionPlan => ({
    potion,
    flask: potion.flask,
    want: 1,
    ...over
});

describe('boostFaded', () => {
    test('an unboosted skill is faded — the first sip of a fight is due', () => {
        expect(boostFaded(70, 70)).toBe(true);
    });

    test('a boost sitting exactly on a tenth of the base is still faded', () => {
        expect(boostFaded(70, 77)).toBe(true);
    });

    test('one level above the tenth is not', () => {
        expect(boostFaded(70, 78)).toBe(false);
    });

    test('a fresh super potion on a level 70 skill is not faded', () => {
        expect(boostFaded(70, 85)).toBe(false);
    });

    test('level 1 fades at any boost, since a tenth of one rounds to nothing', () => {
        expect(boostFaded(1, 1)).toBe(true);
        expect(boostFaded(1, 2)).toBe(false);
    });

    test('an unread skill never asks for a dose', () => {
        expect(boostFaded(0, 0)).toBe(false);
    });

    test('a drained skill is not a faded boost — food and time fix that, not a super potion', () => {
        expect(boostFaded(70, 60)).toBe(false);
    });
});

describe('potionToSip', () => {
    const held = (n: number): SipState['held'] => () => n;
    const levels = (base: number, effective: number): SipState['levels'] => () => ({ base, effective });

    test('names the potion whose boost has faded', () => {
        const chosen = potionToSip({
            plans: [plan(SUPER_ATTACK), plan(SUPER_STRENGTH)],
            held: held(1),
            levels: name => (name === 'strength' ? { base: 70, effective: 70 } : { base: 70, effective: 85 })
        });
        expect(chosen?.potion).toBe(SUPER_STRENGTH);
    });

    test('names nothing while both boosts hold', () => {
        expect(potionToSip({ plans: [plan(SUPER_ATTACK), plan(SUPER_STRENGTH)], held: held(1), levels: levels(70, 85) })).toBeNull();
    });

    test('names nothing when the pack is out of that flask', () => {
        expect(potionToSip({ plans: [plan(SUPER_ATTACK)], held: held(0), levels: levels(70, 70) })).toBeNull();
    });

    test('takes one potion per call, attack before strength, so a tick buys one op', () => {
        const chosen = potionToSip({ plans: [plan(SUPER_ATTACK), plan(SUPER_STRENGTH)], held: held(1), levels: levels(70, 70) });
        expect(chosen?.potion).toBe(SUPER_ATTACK);
    });

    test('an empty plan list sips nothing', () => {
        expect(potionToSip({ plans: [], held: held(9), levels: levels(70, 70) })).toBeNull();
    });
});

describe('plannedPotions', () => {
    test('falls back to one three-dose flask of each when the loadout names no potion', () => {
        expect(plannedPotions([])).toEqual([
            { potion: SUPER_ATTACK, flask: 'Super attack(3)', want: 1 },
            { potion: SUPER_STRENGTH, flask: 'Super strength(3)', want: 1 }
        ]);
    });

    test('a carry entry sets both the dose form to withdraw and the count', () => {
        expect(plannedPotions([{ item: 'Super attack(4)', qty: 3 }])[0]).toEqual({
            potion: SUPER_ATTACK,
            flask: 'Super attack(4)',
            want: 3
        });
    });

    test('the loadout naming only one potion leaves the other on its fallback', () => {
        const plans = plannedPotions([{ item: 'Super strength(4)', qty: 2 }]);
        expect(plans[0]).toEqual({ potion: SUPER_ATTACK, flask: 'Super attack(3)', want: 1 });
        expect(plans[1]).toEqual({ potion: SUPER_STRENGTH, flask: 'Super strength(4)', want: 2 });
    });

    test('food and prayer potions in the same carry list are ignored', () => {
        expect(plannedPotions([{ item: 'Lobster', qty: 20 }, { item: 'Prayer potion(4)', qty: 2 }])).toEqual(plannedPotions([]));
    });

    test('matching is case-insensitive, since a hand-edited loadout is free text', () => {
        expect(plannedPotions([{ item: 'super ATTACK(2)', qty: 5 }])[0]).toEqual({
            potion: SUPER_ATTACK,
            flask: 'Super attack(2)',
            want: 5
        });
    });
});

describe('the potion table', () => {
    test('every dose form of both potions is listed, so a part-used flask still counts', () => {
        expect(SUPER_ATTACK.doses).toEqual(['Super attack(4)', 'Super attack(3)', 'Super attack(2)', 'Super attack(1)']);
        expect(SUPER_STRENGTH.doses).toEqual(['Super strength(4)', 'Super strength(3)', 'Super strength(2)', 'Super strength(1)']);
    });

    test('attack comes before strength, fixing the order a tick is spent in', () => {
        expect(BOOST_POTIONS).toEqual([SUPER_ATTACK, SUPER_STRENGTH]);
    });

    test('the floor is the tenth of base level the design asks for', () => {
        expect(BOOST_FLOOR).toBe(0.1);
    });

    test('the drained flask is named as the game names it', () => {
        expect(EMPTY_VIAL).toBe('Vial');
    });

    test('each potion carries a paint label short enough for a three-column row', () => {
        expect(SUPER_ATTACK.short).toBe('Att');
        expect(SUPER_STRENGTH.short).toBe('Str');
    });
});
