import { describe, expect, test } from 'bun:test';

import {
    TB_ARMOUR,
    TB_ID,
    TB_LUBUFU,
    TB_MAIN,
    TB_NAME,
    TB_POTIONS,
    TB_SPEARS,
    TB_TAMAYU,
    TB_TINSAY
} from '#/bot/api/ai/quests/defs/tbwt/areas.js';
import { TB_FLAG } from '#/bot/api/ai/quests/defs/tbwt/journal.js';
import {
    arrowChoice,
    bowChoice,
    dosesWanted,
    outstandingSupplies,
    potionsInBank,
    prepare,
    spearInBank,
    spearWanted,
    TB_KEEP_IDS
} from '#/bot/api/ai/quests/defs/tbwt/supplies.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const KARAMJA = { x: 2780, z: 3087, level: 0 };

const IRON = TB_SPEARS[0]!;
const STEEL = TB_SPEARS[1]!;
const RUNE = TB_SPEARS[4]!;
const DOSE4 = TB_POTIONS[0]!;
const DOSE2 = TB_POTIONS[2]!;
const DOSE1 = TB_POTIONS[3]!;

/** The kit a 70-ranged account with a stocked bank ends up in. */
const KIT = ['Maple shortbow', 'Adamant arrow', ...TB_ARMOUR];

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
    ranged?: number;
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
        freeSlots: options.freeSlots ?? 14,
        ranged: options.ranged ?? 70
    };
}

const names = (options: Options = {}): string[] => outstandingSupplies(snap(options)).map(s => s.name);

/** Worn kit, food and coin, so only the quest supplies are under test. */
const DRESSED: Options = {
    worn: KIT,
    inv: [['coins', 500], ['lobster', 6]]
};

describe('tbwt supplies', () => {
    test('a fresh quest wants the whole kit', () => {
        expect(names()).toEqual([
            TB_NAME.NET,
            TB_NAME.KNIFE,
            TB_NAME.PESTLE,
            TB_NAME.TINDERBOX,
            TB_NAME.SEAWEED
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
});

describe('tbwt spear choice', () => {
    test('any tier in the pack satisfies the leg, poisoned or bare', () => {
        expect(spearWanted(snap({ invIds: [[RUNE.id, 1]] }))).toBe(false);
        expect(spearWanted(snap({ invIds: [[STEEL.kpId, 1]] }))).toBe(false);
        expect(spearWanted(snap({ spear: true }))).toBe(false);
        expect(spearWanted(snap({ tamayu: TB_TAMAYU.COMPLETE }))).toBe(false);
    });

    // Why: the paste is the poison, not the shaft, a pack that lost the spear still has to replace it.
    test('paste alone does not count as a spear', () => {
        expect(spearWanted(snap({ invIds: [[TB_ID.KARAMBWAN_POISON_PASTE, 1]] }))).toBe(true);
    });

    // Why: `inv_del(inv, $spear, 1)` means Tamayu keeps it, so the bank gives up its cheapest one.
    test('the cheapest spear in the bank is the one drawn', () => {
        expect(spearInBank(snap({ bankIds: [[RUNE.id, 1], [IRON.id, 1]] }))?.name).toBe(IRON.name);
        expect(spearInBank(snap({ bankIds: [[RUNE.id, 1]] }))?.name).toBe(RUNE.name);
    });

    test('a ready-poisoned spear is taken when the bank holds no bare one', () => {
        expect(spearInBank(snap({ bankIds: [[STEEL.kpId, 1]] }))?.name).toBe(STEEL.kpName);
    });

    // Why: bronze sets neither flag Tamayu checks, and a dragon spear is worth more than the quest.
    test('bronze and dragon are never drawn', () => {
        expect(spearInBank(snap({ bankIds: [[1237, 1], [1249, 1], [3170, 1], [3176, 1]] }))).toBeNull();
    });

    // Why: an empty bank is not a dead end, the Jogres on this quest's own route drop spears.
    test('a bank with no spear parks nothing, so the hunt can run', () => {
        const step = prepare(snap({
            ...DRESSED,
            invIds: [
                [TB_ID.NET, 1], [TB_ID.KNIFE, 1], [TB_ID.PESTLE, 1], [TB_ID.TINDERBOX, 1],
                [TB_ID.SEAWEED, 1], [DOSE4.id, 1]
            ]
        }));
        expect(step).toBeNull();
    });
});

describe('tbwt agility doses', () => {
    test('four doses in any mix satisfy him', () => {
        expect(dosesWanted(snap({ invIds: [[DOSE1.id, 1]] }))).toBe(false);
        expect(dosesWanted(snap({ agility: true }))).toBe(false);
        expect(dosesWanted(snap({ tamayu: TB_TAMAYU.COMPLETE }))).toBe(false);
        expect(dosesWanted(snap())).toBe(true);
    });

    test('bottles are drawn fullest first, up to four doses', () => {
        expect(potionsInBank(snap({ bankIds: [[DOSE4.id, 3]] })))
            .toEqual([{ name: DOSE4.name, qty: 1, id: DOSE4.id }]);
        expect(potionsInBank(snap({ bankIds: [[DOSE2.id, 5]] })))
            .toEqual([{ name: DOSE2.name, qty: 2, id: DOSE2.id }]);
        expect(potionsInBank(snap({ bankIds: [[DOSE2.id, 1], [DOSE1.id, 4]] })))
            .toEqual([
                { name: DOSE2.name, qty: 1, id: DOSE2.id },
                { name: DOSE1.name, qty: 2, id: DOSE1.id }
            ]);
        expect(potionsInBank(snap())).toEqual([]);
    });

    // Why: no shop on the island sells one and no leg of this quest brews one.
    test('a bank with no agility potion parks with a reason', () => {
        const step = prepare(snap({
            ...DRESSED,
            invIds: [
                [TB_ID.NET, 1], [TB_ID.KNIFE, 1], [TB_ID.PESTLE, 1], [TB_ID.TINDERBOX, 1],
                [TB_ID.SEAWEED, 1], [IRON.id, 1]
            ]
        }));
        expect(step?.kind).toBe('wait');
        expect(step?.kind === 'wait' && step.reason).toContain('agility potion');
    });
});

describe('tbwt ranged kit', () => {
    const bows: [string, number][] = [['Magic shortbow', 1], ['Yew shortbow', 1], ['Maple shortbow', 1]];

    test('the best bow the account can draw wins', () => {
        expect(bowChoice(snap({ bank: bows, ranged: 70 }))).toBe('Magic shortbow');
        expect(bowChoice(snap({ bank: bows, ranged: 45 }))).toBe('Yew shortbow');
        expect(bowChoice(snap({ bank: bows, ranged: 31 }))).toBe('Maple shortbow');
    });

    test('a bow already worn is the one used, whatever the bank holds', () => {
        expect(bowChoice(snap({ bank: bows, worn: ['Willow longbow'] }))).toBe('Willow longbow');
    });

    test('nothing wieldable reads as no bow at all', () => {
        expect(bowChoice(snap({ bank: [['Magic shortbow', 1]], ranged: 20 }))).toBeNull();
        expect(bowChoice(snap())).toBeNull();
    });

    test('arrows fall back down the tiers', () => {
        expect(arrowChoice(snap({ bank: [['Rune arrow', 500], ['Adamant arrow', 500]] }))).toBe('Adamant arrow');
        expect(arrowChoice(snap({ bank: [['Rune arrow', 500]] }))).toBe('Rune arrow');
        expect(arrowChoice(snap({ bank: [['Bronze arrow', 500]] }))).toBe('Bronze arrow');
        expect(arrowChoice(snap())).toBeNull();
    });

    test('an empty quiver rack parks with a reason naming the level', () => {
        const step = prepare(snap({ ranged: 20, bank: [['Magic shortbow', 1]], inv: [['lobster', 6], ['coins', 500]] }));
        expect(step?.kind).toBe('wait');
        expect(step?.kind === 'wait' && step.reason).toContain('Ranged 20');
    });
});

describe('tbwt prepare', () => {
    const stocked: [string, number][] = [
        [TB_NAME.COINS, 2_000_000],
        ['Lobster', 60],
        ...KIT.map(n => [n, 200] as [string, number])
    ];
    const stockedIds: [number, number][] = [
        [TB_ID.NET, 1], [TB_ID.KNIFE, 1], [TB_ID.PESTLE, 1], [TB_ID.TINDERBOX, 1],
        [TB_ID.SEAWEED, 2], [IRON.id, 1], [DOSE4.id, 1]
    ];

    test('an unread bank is scanned before anything is judged missing', () => {
        expect(prepare(snap({ bankKnown: false, worn: KIT }))?.kind).toBe('scanBank');
    });

    test('a stocked bank is withdrawn from', () => {
        const step = prepare(snap({ bank: stocked, bankIds: stockedIds, worn: KIT, inv: [['lobster', 6], ['coins', 500]] }));
        expect(step?.kind).toBe('withdraw');
    });

    test('the spear and the potion ride out on the same withdrawal', () => {
        const step = prepare(snap({ ...DRESSED, bank: stocked, bankIds: stockedIds }));
        expect(step?.kind).toBe('withdraw');
        const drawn = step?.kind === 'withdraw' ? step.items.map(i => i.name) : [];
        expect(drawn).toContain(IRON.name);
        expect(drawn).toContain(DOSE4.name);
    });

    test('gear already in the pack is worn without a bank trip', () => {
        const carried = KIT.map(n => [n.toLowerCase(), 1] as [string, number]);
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
        const shopBought: [number, number][] = [
            [TB_ID.KNIFE, 1], [TB_ID.PESTLE, 1], [TB_ID.TINDERBOX, 1], [IRON.id, 1], [DOSE4.id, 1]
        ];
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

    // Why: a deposit that misses a tier drops the spear this leg was built around.
    test('every spear tier and every dose survives a deposit', () => {
        for (const spear of TB_SPEARS) {
            expect(TB_KEEP_IDS).toContain(spear.id);
            expect(TB_KEEP_IDS).toContain(spear.kpId);
        }
        for (const potion of TB_POTIONS) {
            expect(TB_KEEP_IDS).toContain(potion.id);
        }
    });
});
