import { describe, expect, test } from 'bun:test';

import { meleeWeaponStep, rangedArmourStep } from '#/bot/api/ai/quests/defs/ikov/gear.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

interface Wardrobe {
    inv?: [string, number][];
    bank?: [string, number][];
    worn?: string[];
    bankKnown?: boolean;
}

function snap(where: Wardrobe = {}): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(where.inv ?? []),
        invIds: new Map(),
        worn: new Set(where.worn ?? []),
        wornIds: new Set<number>(),
        noProgress: 0,
        bankCoins: 0,
        stage: 10,
        bank: new Map(where.bank ?? []),
        bankIds: new Map(),
        bankKnown: where.bankKnown ?? true,
        tile: { x: 2677, z: 3406, level: 0 },
        freeSlots: 20
    };
}

function names(step: QuestStep | null): string[] {
    return step?.kind === 'withdraw' ? step.items.map(i => i.name) : [];
}

describe('Temple of Ikov ranged armour', () => {
    test('an unread bank dresses nothing rather than guessing at what is in it', () => {
        expect(rangedArmourStep(snap({ bankKnown: false, bank: [['studded body', 1]] }))).toBeNull();
    });

    test('an empty bank is not a step', () => {
        expect(rangedArmourStep(snap())).toBeNull();
    });

    test('what the bank holds is withdrawn, one piece a slot', () => {
        const step = rangedArmourStep(snap({
            bank: [['coif', 1], ['studded body', 1], ['studded chaps', 1], ['leather gloves', 1]]
        }));
        expect(names(step).sort()).toEqual(['Coif', 'Leather gloves', 'Studded body', 'Studded chaps']);
    });

    // Why: the ladder is what makes this "the best it has" rather than "the first it finds".
    test('a slot takes its best entry and leaves the rest', () => {
        const step = rangedArmourStep(snap({
            bank: [['leather body', 1], ['studded body', 1], ['hardleather body', 1], ['dragonhide body', 1]]
        }));
        expect(names(step)).toEqual(['Dragonhide body']);
    });

    test('leather stands in when nothing better is banked', () => {
        const step = rangedArmourStep(snap({ bank: [['leather body', 1], ['leather chaps', 1]] }));
        expect(names(step)).toEqual(['Leather body', 'Leather chaps']);
    });

    // Why: a mid-run swap costs a bank trip to gain a point of defence, so a dressed slot is left alone.
    test('a slot already worn is not upgraded', () => {
        const step = rangedArmourStep(snap({ worn: ['leather body'], bank: [['studded body', 1]] }));
        expect(step).toBeNull();
    });

    test('pieces already in the pack are worn rather than withdrawn again', () => {
        const step = rangedArmourStep(snap({ inv: [['studded body', 1]], bank: [['studded body', 1]] }));
        expect(step?.kind).toBe('custom');
        expect(step?.kind === 'custom' && step.name).toBe('wear Studded body');
    });

    // Why: the boots of lightness are what the lava bridge is crossed in and the bow is what the Fire Warrior demands, so neither slot is the armour's to fill.
    test('the feet and the weapon are left to the quest', () => {
        const step = rangedArmourStep(snap({
            bank: [['leather boots', 1], ['shortbow', 1], ['studded body', 1]]
        }));
        expect(names(step)).toEqual(['Studded body']);
    });
});

describe('Temple of Ikov melee weapon', () => {
    test('an empty bank arms nothing, and the axe fallback stands', () => {
        expect(meleeWeaponStep(snap())).toBeNull();
    });

    test('the best tier in the bank is the one withdrawn', () => {
        const step = meleeWeaponStep(snap({
            bank: [['bronze sword', 1], ['rune scimitar', 1], ['steel longsword', 1], ['mithril scimitar', 1]]
        }));
        expect(names(step)).toEqual(['Rune scimitar']);
    });

    // Why: a hobgoblin has 1 stab and 1 slash defence, so the faster weapon of a tier wins rather than the heavier one.
    test('within a tier the scimitar beats the longsword', () => {
        const step = meleeWeaponStep(snap({ bank: [['adamant longsword', 1], ['adamant scimitar', 1]] }));
        expect(names(step)).toEqual(['Adamant scimitar']);
    });

    test('a weapon already in the pack is wielded rather than withdrawn again', () => {
        const step = meleeWeaponStep(snap({ inv: [['rune scimitar', 1]], bank: [['rune scimitar', 1]] }));
        expect(step?.kind === 'custom' && step.name).toBe('wield Rune scimitar');
    });

    test('the weapon already worn is left alone', () => {
        expect(meleeWeaponStep(snap({ worn: ['rune scimitar'], bank: [['rune scimitar', 1]] }))).toBeNull();
    });

    test('an unread bank arms nothing rather than guessing', () => {
        expect(meleeWeaponStep(snap({ bankKnown: false, bank: [['rune scimitar', 1]] }))).toBeNull();
    });
});
