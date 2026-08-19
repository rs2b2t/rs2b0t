import { describe, expect, test } from 'bun:test';

import { HERO_ID, HERO_NAMED } from '#/bot/api/ai/quests/defs/heroquest/areas.js';
import { disguiseOwned, disguiseStep } from '#/bot/api/ai/quests/defs/heroquest/blackarm.js';
import { eelStep } from '#/bot/api/ai/quests/defs/heroquest/eel.js';
import { combatKitStep, featherStep } from '#/bot/api/ai/quests/defs/heroquest/feather.js';
import { snipeKitOwned, snipeKitStep } from '#/bot/api/ai/quests/defs/heroquest/phoenix.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

function snap(over: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: new Map(),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(),
        bankIds: new Map(),
        bankKnown: true,
        tile: { x: 3210, z: 3490, level: 0 } as QuestSnapshot['tile'],
        freeSlots: 20,
        ...over
    };
}

function name(step: QuestStep | null): string {
    return JSON.stringify(step ?? {});
}

describe('the Black Arm disguise', () => {
    test('an empty pack buys the platebody first', () => {
        expect(name(disguiseStep(snap()))).toContain(HERO_NAMED.BLACK_PLATEBODY);
    });

    test('a bought piece is worn rather than bought again', () => {
        expect(disguiseStep(snap({ invIds: new Map([[HERO_ID.BLACK_PLATEBODY, 1]]) })))
            .toMatchObject({ kind: 'equip', item: HERO_NAMED.BLACK_PLATEBODY });
    });

    test('a banked piece is withdrawn', () => {
        expect(disguiseStep(snap({ bankIds: new Map([[HERO_ID.BLACK_PLATEBODY, 1]]) })))
            .toMatchObject({ kind: 'withdraw' });
    });

    test('all three worn is nothing left to do', () => {
        const worn = new Set([HERO_ID.BLACK_PLATEBODY, HERO_ID.BLACK_PLATELEGS, HERO_ID.BLACK_FULL_HELM]);
        expect(disguiseStep(snap({ wornIds: worn }))).toBeNull();
        expect(disguiseOwned(snap({ wornIds: worn }))).toBe(true);
    });
});

// Why: `World.restock` skips a null slot, so a shared shop that sells its last unit is a one-shot
// source — the legs list both stockists and the buy leg falls through to the second.
describe('the Black Arm platelegs', () => {
    test('the legs name both stockists', () => {
        const step = disguiseStep(snap({ wornIds: new Set([HERO_ID.BLACK_PLATEBODY]) }));
        expect(name(step)).toContain(HERO_NAMED.BLACK_PLATELEGS);
        expect(step).toMatchObject({ kind: 'custom' });
    });
});

describe('the Phoenix snipe kit', () => {
    test('an empty pack buys the bow first', () => {
        expect(name(snipeKitStep(snap()))).toContain(HERO_NAMED.OAK_LONGBOW);
    });

    test('a worn bow moves on to the arrows', () => {
        expect(name(snipeKitStep(snap({ wornIds: new Set([HERO_ID.OAK_LONGBOW]) }))))
            .toContain(HERO_NAMED.STEEL_ARROW);
    });

    test('bow and arrows worn is nothing left to do', () => {
        const worn = new Set([HERO_ID.OAK_LONGBOW, HERO_ID.STEEL_ARROW]);
        expect(snipeKitStep(snap({ wornIds: worn }))).toBeNull();
        expect(snipeKitOwned(snap({ wornIds: worn }))).toBe(true);
    });
});

// Why: each branch reads what is carried, so a restart anywhere in the chain picks it up where it
// stopped rather than starting the herb grind again.
describe('the lava eel chain', () => {
    test('a cooked eel anywhere ends the chain', () => {
        expect(eelStep(snap({ bankIds: new Map([[HERO_ID.LAVA_EEL, 1]]) }))).toBeNull();
    });

    test('a raw eel is cooked', () => {
        expect(name(eelStep(snap({ invIds: new Map([[HERO_ID.RAW_LAVA_EEL, 1]]) })))).toContain('cook');
    });

    test('an oiled rod with no bait buys bait', () => {
        expect(eelStep(snap({ invIds: new Map([[HERO_ID.OILY_ROD, 1]]) })))
            .toMatchObject({ kind: 'buy', item: HERO_NAMED.FISHING_BAIT });
    });

    // Why: the lava spots are behind `deepdungeondoor`, which opens only to the dusty key.
    test('an oiled rod with bait and no keys goes for the Jailer', () => {
        const step = eelStep(snap({ invIds: new Map([[HERO_ID.OILY_ROD, 1], [HERO_ID.FISHING_BAIT, 40]]) }));
        expect(name(step)).toContain('Jailer');
    });

    test('the jail key frees Velrak', () => {
        const step = eelStep(snap({
            invIds: new Map([[HERO_ID.OILY_ROD, 1], [HERO_ID.FISHING_BAIT, 40], [HERO_ID.JAIL_KEY, 1]])
        }));
        expect(name(step)).toContain('Velrak');
    });

    test('a banked dusty key is withdrawn rather than re-earned', () => {
        expect(eelStep(snap({
            invIds: new Map([[HERO_ID.OILY_ROD, 1], [HERO_ID.FISHING_BAIT, 40]]),
            bankIds: new Map([[HERO_ID.DUSTY_KEY, 1]])
        }))).toMatchObject({ kind: 'withdraw' });
    });

    test('an oiled rod with bait and the dusty key fishes', () => {
        const step = eelStep(snap({
            invIds: new Map([[HERO_ID.OILY_ROD, 1], [HERO_ID.FISHING_BAIT, 40], [HERO_ID.DUSTY_KEY, 1]])
        }));
        expect(name(step)).toContain('fish a lava eel');
    });

    test('oil plus a rod makes the oiled rod', () => {
        const step = eelStep(snap({ invIds: new Map([[HERO_ID.BLAMISH_OIL, 1], [HERO_ID.FISHING_ROD, 1]]) }));
        expect(name(step)).toContain('rub the blamish oil');
    });

    test('oil with no rod buys a rod', () => {
        expect(eelStep(snap({ invIds: new Map([[HERO_ID.BLAMISH_OIL, 1]]) })))
            .toMatchObject({ kind: 'buy', item: HERO_NAMED.FISHING_ROD });
    });

    test('an unfinished potion with no slime asks Gerrant for one', () => {
        expect(name(eelStep(snap({ invIds: new Map([[HERO_ID.HARRALANDER_VIAL, 1]]) })))).toContain('Gerrant');
    });

    test('an unfinished potion and slime makes the oil', () => {
        const step = eelStep(snap({ invIds: new Map([[HERO_ID.HARRALANDER_VIAL, 1], [HERO_ID.SLIME, 1]]) }));
        expect(name(step)).toContain('mix the slime');
    });

    test('a clean harralander with no vial buys one', () => {
        expect(eelStep(snap({ invIds: new Map([[HERO_ID.HARRALANDER, 1]]) })))
            .toMatchObject({ kind: 'buy', item: HERO_NAMED.VIAL_WATER });
    });

    test('a grimy herb is identified', () => {
        expect(name(eelStep(snap({ invIds: new Map([[HERO_ID.UNID_HARRALANDER, 1]]) })))).toContain('identify');
    });

    // Why: twenty-five level-13 druids add up with no food in the pack.
    test('an empty pack withdraws food before the druids', () => {
        QuestFood.name = 'Lobster';
        expect(eelStep(snap())).toMatchObject({ kind: 'withdraw' });
    });

    // Why: nothing sells harralander and it has no ground spawn, so the druids are the only source.
    test('a fed pack farms chaos druids', () => {
        QuestFood.name = 'Lobster';
        expect(name(eelStep(snap({ inv: new Map([['lobster', 16]]) })))).toContain('chaos druids');
    });
});

describe('the firebird feather chain', () => {
    test('a feather anywhere ends the chain', () => {
        expect(featherStep(snap({ bankIds: new Map([[HERO_ID.FEATHER, 1]]) }))).toBeNull();
    });

    test('without gloves it buys the Ice Queen kit first', () => {
        expect(name(featherStep(snap()))).toContain('Rune chainbody');
    });

    test('banked gloves are withdrawn rather than fought for', () => {
        expect(featherStep(snap({ bankIds: new Map([[HERO_ID.ICE_GLOVES, 1]]) })))
            .toMatchObject({ kind: 'withdraw' });
    });

    test('kitted and fed, it goes for the Ice Queen', () => {
        QuestFood.name = 'Lobster';
        const step = featherStep(snap({
            wornIds: new Set([1113, 1079, 1303]),
            inv: new Map([['lobster', 12]])
        }));
        expect(name(step)).toContain('Ice Queen');
    });

    // Why: Entrana's monks refuse every `armour_*` and `weapon_*` category; the gloves carry none.
    test('holding the gloves, a full pack is banked before the ferry', () => {
        expect(featherStep(snap({
            invIds: new Map([[HERO_ID.ICE_GLOVES, 1]]),
            inv: new Map([['ice gloves', 1], ['rune longsword', 1]])
        }))).toMatchObject({ kind: 'deposit' });
    });

    test('a stripped pack sails', () => {
        const step = featherStep(snap({
            invIds: new Map([[HERO_ID.ICE_GLOVES, 1]]),
            inv: new Map([['ice gloves', 1], ['coins', 1000]])
        }));
        expect(name(step)).toContain('Entrana');
    });

    // Why: the engine lower-cases `worn`, so a display-cased comparison strips forever.
    test('the gloves alone are not something to strip', () => {
        const step = featherStep(snap({
            invIds: new Map([[HERO_ID.ICE_GLOVES, 1]]),
            inv: new Map([['ice gloves', 1]]),
            worn: new Set(['ice gloves']),
            wornIds: new Set([HERO_ID.ICE_GLOVES])
        }));
        expect(name(step)).toContain('Entrana');
    });

    test('worn armour is stripped before the ferry', () => {
        const step = featherStep(snap({
            invIds: new Map([[HERO_ID.ICE_GLOVES, 1]]),
            inv: new Map([['ice gloves', 1]]),
            worn: new Set(['rune platelegs']),
            wornIds: new Set([1079])
        }));
        expect(name(step)).toContain('strip');
    });

    test('on the island it takes the feather', () => {
        const step = featherStep(snap({
            invIds: new Map([[HERO_ID.ICE_GLOVES, 1]]),
            inv: new Map([['ice gloves', 1]]),
            tile: { x: 2847, z: 3387, level: 0 } as QuestSnapshot['tile']
        }));
        expect(name(step)).toContain('feather');
    });

    test('holding the feather on the island, it sails home', () => {
        const step = featherStep(snap({
            invIds: new Map([[HERO_ID.FEATHER, 1]]),
            tile: { x: 2847, z: 3387, level: 0 } as QuestSnapshot['tile']
        }));
        expect(name(step)).toContain('sail back');
    });

    test('the combat kit is bought once and worn after', () => {
        expect(name(combatKitStep(snap()))).toContain('buy');
        expect(combatKitStep(snap({ wornIds: new Set([1113, 1079, 1303]) }))).toBeNull();
    });
});
