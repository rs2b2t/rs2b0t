import { describe, expect, test } from 'bun:test';

import { TB_GEAR, TB_ID, TB_LUBUFU, TB_MAIN, TB_NAME, TB_TAMAYU, TB_TINSAY } from '#/bot/api/ai/quests/defs/tbwt/areas.js';
import { TB_FLAG } from '#/bot/api/ai/quests/defs/tbwt/journal.js';
import { outstandingSupplies, prepare, TB_KEEP_IDS } from '#/bot/api/ai/quests/defs/tbwt/supplies.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const KARAMJA = { x: 2780, z: 3087, level: 0 };

interface Options {
    lubufu?: number;
    tamayu?: number;
    tinsay?: number;
    agility?: boolean;
    spear?: boolean;
    invIds?: [number, number][];
    inv?: [string, number][];
    bank?: [string, number][];
    bankIds?: [number, number][];
    bankKnown?: boolean;
    worn?: string[];
    freeSlots?: number;
}

function snap(options: Options = {}): QuestSnapshot {
    const flags = new Set<string>([
        `${TB_FLAG.LUBUFU}:${options.lubufu ?? TB_LUBUFU.UNKNOWN}`,
        `${TB_FLAG.TAMAYU}:${options.tamayu ?? TB_TAMAYU.UNKNOWN}`,
        `${TB_FLAG.TINSAY}:${options.tinsay ?? TB_TINSAY.UNKNOWN}`
    ]);
    if (options.agility) {
        flags.add(TB_FLAG.AGILITY);
    }
    if (options.spear) {
        flags.add(TB_FLAG.SPEAR);
    }
    return {
        journal: 'inProgress',
        inv: new Map(options.inv ?? []),
        invIds: new Map(options.invIds ?? []),
        worn: new Set((options.worn ?? []).map(n => n.toLowerCase())),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: TB_MAIN.STARTED,
        progress: { stage: TB_MAIN.STARTED, flags },
        bank: new Map((options.bank ?? []).map(([n, q]) => [n.toLowerCase(), q])),
        bankIds: new Map(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: KARAMJA,
        freeSlots: options.freeSlots ?? 14
    };
}

const names = (options: Options = {}): string[] => outstandingSupplies(snap(options)).map(s => s.name);

/** Worn kit, food and coin, so only the quest supplies are under test. */
const DRESSED: Options = {
    worn: [...TB_GEAR],
    inv: [['coins', 500], ['lobster', 6]]
};

describe('tbwt supplies', () => {
    test('a fresh quest wants the whole kit', () => {
        expect(names()).toEqual([
            TB_NAME.NET,
            TB_NAME.KNIFE,
            TB_NAME.PESTLE,
            TB_NAME.TINDERBOX,
            TB_NAME.SEAWEED,
            TB_NAME.IRON_SPEAR,
            TB_NAME.AGILITY_POTION_4
        ]);
    });

    // Why: each of these is consumed by one leg, and a supply left on the list after its leg drags the bot back across the ferry for it.
    test('a supply drops off the list the moment its leg is behind us', () => {
        expect(names({ tinsay: TB_TINSAY.GIVEN_RUM })).not.toContain(TB_NAME.KNIFE);
        expect(names({ tinsay: TB_TINSAY.GIVEN_SANDWICH })).not.toContain(TB_NAME.SEAWEED);
        expect(names({ tamayu: TB_TAMAYU.COMPLETE, tinsay: TB_TINSAY.COMPLETE, lubufu: TB_LUBUFU.COMPLETE }))
            .toEqual([]);
    });

    test('a made sandwich retires the seaweed before Tinsay has eaten it', () => {
        expect(names({ tinsay: TB_TINSAY.FETCH_SANDWICH, invIds: [[TB_ID.SANDWICH, 1]] }))
            .not.toContain(TB_NAME.SEAWEED);
    });

    test('the spear is not re-fetched once it is poisoned, or once Tamayu holds it', () => {
        expect(names({ invIds: [[TB_ID.SPEAR_KP, 1]] })).not.toContain(TB_NAME.IRON_SPEAR);
        expect(names({ spear: true })).not.toContain(TB_NAME.IRON_SPEAR);
    });

    // Why: the paste is the poison, not the shaft — a pack that lost the spear still has to replace it.
    test('paste alone does not count as a spear', () => {
        expect(names({ invIds: [[TB_ID.KARAMBWAN_POISON_PASTE, 1]] })).toContain(TB_NAME.IRON_SPEAR);
    });

    test('the agility potion is not re-fetched once Tamayu has drunk it', () => {
        expect(names({ agility: true })).not.toContain(TB_NAME.AGILITY_POTION_4);
    });
});

describe('tbwt prepare', () => {
    const stocked: [string, number][] = [
        [TB_NAME.COINS, 2_000_000],
        ['Lobster', 60],
        ...TB_GEAR.map(n => [n, 200] as [string, number])
    ];
    const stockedIds: [number, number][] = [
        [TB_ID.NET, 1], [TB_ID.KNIFE, 1], [TB_ID.PESTLE, 1], [TB_ID.TINDERBOX, 1],
        [TB_ID.SEAWEED, 2], [TB_ID.IRON_SPEAR, 1], [TB_ID.AGILITY_POTION_4, 1]
    ];

    test('an unread bank is scanned before anything is judged missing', () => {
        expect(prepare(snap({ bankKnown: false, worn: [...TB_GEAR] }))?.kind).toBe('scanBank');
    });

    test('a stocked bank is withdrawn from', () => {
        const step = prepare(snap({ bank: stocked, bankIds: stockedIds, worn: [...TB_GEAR], inv: [['lobster', 6], ['coins', 500]] }));
        expect(step?.kind).toBe('withdraw');
    });

    test('gear already in the pack is worn without a bank trip', () => {
        const carried = TB_GEAR.map(n => [n.toLowerCase(), 1] as [string, number]);
        const step = prepare(snap({ ...DRESSED, worn: [], inv: [...(DRESSED.inv ?? []), ...carried] }));
        expect(step?.kind).toBe('custom');
        expect(step?.kind === 'custom' && step.name).toContain('wear');
    });

    // Why: Jiminua's counter is inside the quest area and the bank is a 30gp ferry away.
    test('a knife the bank does not stock is bought in the village', () => {
        const step = prepare(snap({
            ...DRESSED,
            bank: stocked,
            bankIds: stockedIds.filter(([id]) => id !== TB_ID.KNIFE),
            invIds: stockedIds.filter(([id]) => id !== TB_ID.KNIFE)
        }));
        expect(step?.kind).toBe('buy');
        expect(step?.kind === 'buy' && step.item).toBe(TB_NAME.KNIFE);
    });

    // Why: nothing else stocks a small fishing net on Karamja, so a bank without one is a dead end that has to say so.
    test('a bank with none of it parks with a reason rather than looping', () => {
        const shopBought: [number, number][] = [[TB_ID.KNIFE, 1], [TB_ID.PESTLE, 1], [TB_ID.TINDERBOX, 1]];
        const step = prepare(snap({ ...DRESSED, invIds: shopBought }));
        expect(step?.kind).toBe('wait');
        expect(step?.kind === 'wait' && step.reason).toContain(TB_NAME.NET);
    });

    test('nothing is outstanding once the pack is right', () => {
        expect(prepare(snap({ ...DRESSED, invIds: stockedIds }))).toBeNull();
    });

    // Why: the three "Karambwan vessel"s and three "Karamjan rum"s are only separable by id.
    test('every quest object is kept by id through a deposit', () => {
        expect(TB_KEEP_IDS).toContain(TB_ID.VESSEL);
        expect(TB_KEEP_IDS).toContain(TB_ID.VESSEL_LOADED);
        expect(TB_KEEP_IDS).toContain(TB_ID.RUM);
        expect(TB_KEEP_IDS).toContain(TB_ID.RUM_SLICED);
        expect(TB_KEEP_IDS).toContain(TB_ID.KARAMBWAN_POISON_PASTE);
    });
});
