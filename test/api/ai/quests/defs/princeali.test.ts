import { describe, expect, test } from 'bun:test';

import { PA_ITEM } from '#/bot/api/ai/quests/defs/princeali/areas.js';
import { PRINCE_STAGE } from '#/bot/api/ai/quests/defs/princeali/journal.js';
import { decide, princeali } from '#/bot/api/ai/quests/defs/princeali/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const I = PA_ITEM;
const S = PRINCE_STAGE;
const RICH: [number, number][] = [[I.COINS.id, 2_000_000]];
const PURSE: [number, number][] = [[I.COINS.id, 1000]];
const DISGUISE: [number, number][] = [[I.BLOND_WIG.id, 1], [I.PINK_SKIRT.id, 1], [I.PASTE.id, 1]];

const snap = (
    stage: number | undefined,
    invIds: [number, number][] = [],
    bankIds: [number, number][] = RICH,
    extra: Partial<QuestSnapshot> = {}
): QuestSnapshot => ({
    journal: stage === S.COMPLETE ? 'complete' : 'inProgress',
    inv: new Map(),
    invIds: new Map(invIds),
    worn: new Set(),
    wornIds: new Set(),
    noProgress: 0,
    bankCoins: 0,
    bank: new Map(),
    bankIds: new Map(bankIds),
    bankKnown: true,
    stage,
    progress: stage === undefined ? undefined : { stage, flags: new Set() },
    ...extra
});

/** Everything the quest needs in the pack, so PREP falls through to the stage logic. */
const kitted = (stage: number, extra: [number, number][] = []): QuestSnapshot =>
    snap(stage, [
        ...PURSE,
        ...DISGUISE,
        [I.PRINCE_KEY.id, 1],
        [I.ROPE.id, 2],
        [I.BEER.id, 3],
        [I.JUG_OF_WATER.id, 1],
        ...extra
    ]);

describe('module shape', () => {
    test('declares the Draynor bank at level 0', () => {
        expect(princeali.bank).toMatchObject({ x: 3093, z: 3243, level: 0 });
    });

    test('owns its own inventory and reads progress, with no gather map', () => {
        expect(princeali.ownsInventory).toBe(true);
        expect(princeali.readProgress).toBeDefined();
        expect(princeali.gather).toBeUndefined();
    });

    test('every record item is acquirable, so eligibility never blocks the quest', () => {
        expect(princeali.record.items.length).toBeGreaterThan(0);
        for (const item of princeali.record.items) {
            expect(item.kind).toBe('acquirable');
        }
    });

    test('the record keeps coins, or every dialogue purchase parks', () => {
        expect(princeali.record.items.map(item => item.name.toLowerCase())).toContain('coins');
    });

    test('three quest points', () => {
        expect(princeali.record.questPoints).toBe(3);
    });
});

describe('lifecycle', () => {
    test('an unloaded journal waits — it is not notStarted', () => {
        expect(decide(snap(undefined, [], RICH, { journal: 'unknown' })).kind).toBe('wait');
    });

    test('a loaded journal with no readable stage waits', () => {
        expect(decide(snap(undefined)).kind).toBe('wait');
    });

    test('stage 0 -> Hassan', () => {
        const step = decide(snap(S.NOT_STARTED, PURSE));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Hassan');
    });

    test('stage 10 -> Osman', () => {
        const step = decide(snap(S.STARTED, PURSE));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Osman');
    });

    test('stage 100 -> Hassan for the reward', () => {
        const step = decide(snap(S.SAVED));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Hassan');
    });

    test('stage 110 and a complete journal are both done', () => {
        expect(decide(snap(S.COMPLETE)).kind).toBe('done');
        expect(decide(snap(S.SAVED, [], RICH, { journal: 'complete' })).kind).toBe('done');
    });
});

describe('the purse comes before anything that walks', () => {
    test('an unseen bank is scanned first, even at stage 0', () => {
        const s = snap(S.NOT_STARTED, [], RICH, { bankKnown: false });
        expect(decide(s).kind).toBe('scanBank');
    });

    // Al-Kharid is reachable only through the 10gp toll gate or the Shantay Pass, and
    // the walker pre-avoids a crossing it cannot pay for.
    test('stage 0 with an empty purse withdraws coins before walking to Hassan', () => {
        const step = decide(snap(S.NOT_STARTED));
        expect(step.kind === 'withdraw' && step.items[0].name).toBe('Coins');
    });

    test('stage 10 with an empty purse withdraws coins before walking to Osman', () => {
        const step = decide(snap(S.STARTED));
        expect(step.kind === 'withdraw' && step.items[0].name).toBe('Coins');
    });

    test('stage 100 does not need coins — the gate is free once the prince is out', () => {
        const step = decide(snap(S.SAVED, [], []));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Hassan');
    });

    test('no coins anywhere at stage 20 is an honest wait, never a loop', () => {
        expect(decide(snap(S.SPOKEN_OSMAN, [], [])).kind).toBe('wait');
    });
});

describe('stage 20 route order', () => {
    test('with coins, the first leg is the Al-Kharid bar', () => {
        const step = decide(snap(S.SPOKEN_OSMAN, PURSE));
        expect(step.kind === 'buy' && step.item).toBe('Bronze bar');
        expect(step.kind === 'buy' && step.shop.npc).toBe('Shantay');
    });

    test('then the water, on the same Shantay trip', () => {
        const step = decide(snap(S.SPOKEN_OSMAN, [...PURSE, [I.BRONZE_BAR.id, 1]]));
        expect(step.kind === 'buy' && step.item).toBe('Jug of water');
        expect(step.kind === 'buy' && step.shop.npc).toBe('Shantay');
    });

    test('then Lumbridge, before Varrock and before the west', () => {
        const step = decide(snap(S.SPOKEN_OSMAN, [...PURSE, [I.BRONZE_BAR.id, 1], [I.JUG_OF_WATER.id, 2]]));
        expect(step.kind === 'buy' && step.shop.npc).toBe('Shop keeper');
    });

    test('everything held -> Leela hands the key over and promotes the stage', () => {
        const step = decide(kitted(S.SPOKEN_OSMAN));
        expect(step.kind === 'custom' && step.name).toContain('Leela');
    });
});

describe('stage 20 resumability', () => {
    test('a soft clay in the pack routes to Lady Keli, not back to the mine', () => {
        const step = decide(
            snap(S.SPOKEN_OSMAN, [...PURSE, ...DISGUISE, [I.SOFT_CLAY.id, 1], [I.BRONZE_BAR.id, 1], [I.ROPE.id, 2], [I.BEER.id, 3], [I.JUG_OF_WATER.id, 1]])
        );
        expect(step.kind === 'talk' && step.stop.npc).toBe('Lady Keli');
    });

    test('a print plus a bar routes to the forge-and-collect', () => {
        const step = decide(
            snap(S.SPOKEN_OSMAN, [...PURSE, ...DISGUISE, [I.KEY_PRINT.id, 1], [I.BRONZE_BAR.id, 1], [I.ROPE.id, 2], [I.BEER.id, 3], [I.JUG_OF_WATER.id, 1]])
        );
        expect(step.kind === 'custom' && step.name).toContain('Osman');
    });

    test('a banked key is withdrawn rather than re-forged', () => {
        const step = decide(
            snap(
                S.SPOKEN_OSMAN,
                [...PURSE, ...DISGUISE, [I.ROPE.id, 2], [I.BEER.id, 3], [I.JUG_OF_WATER.id, 1]],
                [...RICH, [I.PRINCE_KEY.id, 1]]
            )
        );
        expect(step.kind === 'withdraw' && step.items.some(item => item.id === I.PRINCE_KEY.id)).toBe(true);
    });

    test('a plain wig plus dye routes to dyeing it, not to Ned for another wig', () => {
        const step = decide(
            snap(S.SPOKEN_OSMAN, [
                ...PURSE,
                [I.BRONZE_BAR.id, 1],
                [I.JUG_OF_WATER.id, 2],
                [I.TINDERBOX.id, 1],
                [I.PINK_SKIRT.id, 1],
                [I.CLAY.id, 1],
                [I.REDBERRIES.id, 1],
                [I.POT_OF_FLOUR.id, 1],
                [I.BEER.id, 3],
                [I.ASHES.id, 1],
                [I.PLAIN_WIG.id, 1],
                [I.YELLOW_DYE.id, 1]
            ])
        );
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toContain('dye');
    });

    // The west cluster is walked before Draynor, so the pickaxe leg has to come
    // before the wig legs even though the wig is what the quest is waiting on.
    test('the route reaches the pickaxe before the Draynor crafting', () => {
        const step = decide(
            snap(S.SPOKEN_OSMAN, [...PURSE, [I.BRONZE_BAR.id, 1], [I.JUG_OF_WATER.id, 2], [I.TINDERBOX.id, 1], [I.PLAIN_WIG.id, 1], [I.YELLOW_DYE.id, 1], [I.PINK_SKIRT.id, 1]])
        );
        expect(step.kind === 'grabGround' && step.item).toBe('Bronze pickaxe');
    });
});

describe('stages 30 through 50', () => {
    test('30 -> Joe', () => {
        const step = decide(kitted(S.PREP_FINISHED));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Joe');
    });

    test('40 -> the break-in', () => {
        const step = decide(kitted(S.GUARD_DRUNK));
        expect(step.kind === 'custom' && step.name).toContain('Keli');
    });

    test('50 -> the break-in', () => {
        const step = decide(kitted(S.TIED_KELI));
        expect(step.kind === 'custom' && step.name).toContain('Keli');
    });

    test('30 short of beer buys more rather than talking to Joe empty-handed', () => {
        const step = decide(snap(S.PREP_FINISHED, [...PURSE, ...DISGUISE, [I.PRINCE_KEY.id, 1], [I.ROPE.id, 1]]));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Bartender');
    });
});

describe('stages 30 through 50 recover a lost disguise instead of parking', () => {
    // Dying at stage 40 drops the non-tradeable quest items. The issue asks for
    // resumability from any point, so the prep legs have to run here too.
    test('a lost paste at stage 40 goes shopping, it does not wait', () => {
        const step = decide(
            snap(S.GUARD_DRUNK, [...PURSE, [I.BLOND_WIG.id, 1], [I.PINK_SKIRT.id, 1], [I.PRINCE_KEY.id, 1], [I.ROPE.id, 1]])
        );
        expect(step.kind).not.toBe('wait');
        expect(step.kind).not.toBe('done');
    });

    test('a lost wig at stage 50 rebuilds it from wool', () => {
        const step = decide(
            snap(S.TIED_KELI, [...PURSE, [I.PINK_SKIRT.id, 1], [I.PASTE.id, 1], [I.PRINCE_KEY.id, 1], [I.ROPE.id, 1]])
        );
        expect(step.kind).not.toBe('wait');
    });

    test('a lost key at stage 40 asks Leela to replace it, never Osman', () => {
        const step = decide(snap(S.GUARD_DRUNK, [...PURSE, ...DISGUISE, [I.ROPE.id, 1]]));
        expect(step.kind === 'custom' && step.name).toContain('Leela');
        expect(step.kind === 'custom' && step.name).not.toContain('Osman');
    });

    test('a lost rope at stage 50 buys another from Ned', () => {
        const step = decide(snap(S.TIED_KELI, [...PURSE, ...DISGUISE, [I.PRINCE_KEY.id, 1]]));
        expect(step.kind === 'talk' && step.stop.npc).toBe('Ned');
    });

    test('no clay is mined at stage 40 — Osman would refuse the print', () => {
        const step = decide(snap(S.GUARD_DRUNK, [...PURSE, ...DISGUISE, [I.PRINCE_KEY.id, 1], [I.ROPE.id, 1], [I.PICKAXE.id, 1]]));
        expect(step.kind).not.toBe('mineRock');
    });
});

describe('every stage produces a step', () => {
    for (const stage of Object.values(S)) {
        test(`stage ${stage} never returns undefined`, () => {
            const step: QuestStep = decide(kitted(stage));
            expect(step.kind).toBeDefined();
        });
    }
});
