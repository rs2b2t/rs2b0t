import { afterEach, expect, test, describe } from 'bun:test';
import { decide, GOBLIN_DIPLOMACY_COIN_TARGET, GOBLIN_DIPLOMACY_QUEST_COIN_RESERVE, GOBLIN_MAIL_FOOD_RESTOCK_FLOOR, GOBLIN_MAIL_FOOD_TARGET, goblindiplomacy, goblinMailGatherStep } from '#/bot/api/ai/quests/defs/goblindiplomacy.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';

const snap = (journal: string, inv: [string, number][] = []): QuestSnapshot => ({
    journal: journal as QuestSnapshot['journal'],
    inv: new Map(inv),
    worn: new Set(),
    noProgress: 0,
    bankCoins: 0
});

const npcOf = (s: ReturnType<typeof decide>): string => (s.kind === 'talk' ? s.stop.npc : `<${s.kind}>`);
const useProduct = (s: ReturnType<typeof decide>): string => (s.kind === 'useOn' ? (s.product ?? '') : `<${s.kind}>`);
const customName = (s: ReturnType<typeof goblinMailGatherStep>): string => (s.kind === 'custom' ? s.name : `<${s.kind}>`);

afterEach(() => {
    QuestFood.name = null;
});

describe('goblindiplomacy decide', () => {
    test('journal branches', () => {
        expect(decide(snap('complete')).kind).toBe('done');
        expect(decide(snap('unknown')).kind).toBe('wait');
        expect(npcOf(decide(snap('notStarted')))).toBe('Bartender');
    });

    test('provisioned start (3 mail + both dyes) dyes orange first', () => {
        const s = decide(snap('inProgress', [['goblin mail', 3], ['orange dye', 1], ['blue dye', 1]]));
        expect(useProduct(s)).toBe('Orange goblin mail');
    });

    test('after orange made, blue is dyed while 2 plain remain (keeps 1 for brown)', () => {
        const s = decide(snap('inProgress', [['goblin mail', 2], ['orange goblin mail', 1], ['blue dye', 1]]));
        expect(useProduct(s)).toBe('Blue goblin mail');
    });

    test('blue dye is NOT applied with only 1 plain mail left (reserved for brown)', () => {
        const s = decide(snap('inProgress', [['goblin mail', 1], ['blue dye', 1]]));
        expect(npcOf(s)).toBe('General Wartface');
    });

    test('both armours made -> hand in at the generals', () => {
        const s = decide(snap('inProgress', [['goblin mail', 1], ['orange goblin mail', 1], ['blue goblin mail', 1]]));
        expect(npcOf(s)).toBe('General Wartface');
    });

    test('order-independent: blue-first start still keeps a plain for brown', () => {
        const s = decide(snap('inProgress', [['goblin mail', 3], ['blue dye', 1]]));
        expect(useProduct(s)).toBe('Blue goblin mail');
    });

    test('bare in-progress re-entry falls back to the generals (total)', () => {
        expect(npcOf(decide(snap('inProgress')))).toBe('General Wartface');
    });
});

describe('goblindiplomacy goblin-mail survival', () => {
    test('owns a batch food policy and eats fallback Kebabs before low-level combat becomes lethal', () => {
        expect(goblindiplomacy.food).toBeUndefined();
        expect(goblindiplomacy.sustain).toEqual({ foods: ['Kebab'], eatBelowHp: 0.6 });
        expect(goblindiplomacy.tools).toContain('kebab');
    });

    test('preserves the configured quest food during spillover banking', () => {
        QuestFood.name = 'Trout';
        expect(goblindiplomacy.tools).toContain('trout');
        const step = goblinMailGatherStep({
            ...snap('inProgress', [['trout', 20], ['bronze dagger', 1]]),
            bankKnown: true,
            freeSlots: 0
        });
        expect(step.kind === 'deposit' && step.keep).toContain('trout');
    });

    test('checks the bank before assuming a fresh account has no food or cash', () => {
        const step = goblinMailGatherStep(snap('inProgress'));
        expect(step.kind).toBe('scanBank');
    });

    test('withdraws the AIO-selected food before buying a fallback', () => {
        QuestFood.name = 'Trout';
        const step = goblinMailGatherStep({
            ...snap('inProgress'),
            bankKnown: true,
            bank: new Map([['trout', 6]])
        });
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Trout', qty: 6 }]);
    });

    test('tops up a partial carried stack instead of fighting with one food', () => {
        QuestFood.name = 'Trout';
        const step = goblinMailGatherStep({
            ...snap('inProgress', [['trout', 1]]),
            bankKnown: true,
            bank: new Map([['trout', 19]])
        });
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Trout', qty: 19 }]);
    });

    test('combines partial selected food with banked fallback food', () => {
        QuestFood.name = 'Trout';
        const step = goblinMailGatherStep({
            ...snap('inProgress', [['trout', 6]]),
            bankKnown: true,
            bank: new Map([['kebab', 14]])
        });
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Kebab', qty: 14 }]);
    });

    test('withdraws banked fallback Kebabs when the selected food is unavailable', () => {
        QuestFood.name = 'Trout';
        const step = goblinMailGatherStep({
            ...snap('inProgress'),
            bankKnown: true,
            bank: new Map([['kebab', 20]])
        });
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Kebab', qty: GOBLIN_MAIL_FOOD_TARGET }]);
    });

    test('uses banked cash before asking a level-three account to self-fund', () => {
        const step = goblinMailGatherStep({
            ...snap('inProgress'),
            bankKnown: true,
            bankCoins: 125,
            bank: new Map([['coins', 125]])
        });
        expect(step.kind === 'withdraw' && step.items).toEqual([{ name: 'Coins', qty: 125 }]);
    });

    test('earns a safe quest purse and buys food when the account is completely empty', () => {
        const step = goblinMailGatherStep({ ...snap('inProgress'), bankKnown: true, bank: new Map() });
        expect(customName(step)).toBe(`earn ${GOBLIN_DIPLOMACY_COIN_TARGET} gp and buy combat food`);
    });

    test('buys food directly once the safe quest purse is carried', () => {
        const step = goblinMailGatherStep({
            ...snap('inProgress', [['coins', GOBLIN_DIPLOMACY_COIN_TARGET]]),
            bankKnown: true,
            bank: new Map()
        });
        expect(customName(step)).toBe(`buy ${GOBLIN_MAIL_FOOD_TARGET} combat Kebabs`);
    });

    test('requires a full batch before travelling to Goblin Village', () => {
        QuestFood.name = 'Trout';
        const short = goblinMailGatherStep({
            ...snap('inProgress', [
                ['trout', GOBLIN_MAIL_FOOD_TARGET - 1],
                ['coins', GOBLIN_DIPLOMACY_COIN_TARGET]
            ]),
            bankKnown: true,
            bank: new Map()
        });
        const ready = goblinMailGatherStep({
            ...snap('inProgress', [
                ['trout', GOBLIN_MAIL_FOOD_TARGET],
                ['coins', GOBLIN_DIPLOMACY_QUEST_COIN_RESERVE]
            ]),
            bankKnown: true
        });
        expect(customName(short)).toBe('buy 1 combat Kebabs');
        expect(customName(ready)).toBe('farm goblin mail');
    });

    test('farms in one batch and restocks before the last foods become lethal', () => {
        const field = { x: 2958, z: 3507, level: 0 };
        const stillSafe = goblinMailGatherStep({
            ...snap('inProgress', [
                ['kebab', GOBLIN_MAIL_FOOD_RESTOCK_FLOOR + 1],
                ['coins', GOBLIN_DIPLOMACY_QUEST_COIN_RESERVE]
            ]),
            bankKnown: true,
            tile: field
        });
        const atFloor = goblinMailGatherStep({
            ...snap('inProgress', [
                ['kebab', GOBLIN_MAIL_FOOD_RESTOCK_FLOOR],
                ['coins', GOBLIN_DIPLOMACY_COIN_TARGET]
            ]),
            bankKnown: true,
            bank: new Map(),
            tile: field
        });
        const afterOneMeal = goblinMailGatherStep({
            ...snap('inProgress', [
                ['kebab', GOBLIN_MAIL_FOOD_TARGET - 1],
                ['coins', GOBLIN_DIPLOMACY_QUEST_COIN_RESERVE]
            ]),
            bankKnown: true,
            tile: field
        });
        expect(customName(stillSafe)).toBe('farm goblin mail');
        expect(customName(atFloor)).toBe(`buy ${GOBLIN_MAIL_FOOD_TARGET - GOBLIN_MAIL_FOOD_RESTOCK_FLOOR} combat Kebabs`);
        expect(customName(afterOneMeal)).toBe('farm goblin mail');
    });

    test('banks spillover before acquiring food into a full restart pack', () => {
        const step = goblinMailGatherStep(
            {
                ...snap('inProgress', [['bronze dagger', 1]]),
                bankKnown: true,
                bank: new Map([['kebab', GOBLIN_MAIL_FOOD_TARGET]]),
                freeSlots: 0
            },
            3
        );
        expect(step).toMatchObject({
            kind: 'deposit',
            keep: ['coins', 'goblin mail', 'orange goblin mail', 'blue goblin mail', 'kebab'],
            exactKeep: true
        });
    });

    test('rebuilds an oversized all-food pack so three mail slots remain free', () => {
        const oversized = goblinMailGatherStep(
            {
                ...snap('inProgress', [['kebab', 28]]),
                bankKnown: true,
                freeSlots: 0
            },
            3
        );
        const cleanBatch = goblinMailGatherStep(
            {
                ...snap('inProgress', [
                    ['kebab', GOBLIN_MAIL_FOOD_TARGET],
                    ['coins', GOBLIN_DIPLOMACY_QUEST_COIN_RESERVE]
                ]),
                bankKnown: true,
                freeSlots: 8
            },
            3
        );
        expect(oversized).toMatchObject({
            kind: 'deposit',
            keep: ['coins', 'goblin mail', 'orange goblin mail', 'blue goblin mail'],
            exactKeep: true
        });
        expect(customName(cleanBatch)).toBe('farm goblin mail');
    });

    test('self-funds the quest reserve even when combat food is already full', () => {
        const noCash = goblinMailGatherStep(
            {
                ...snap('inProgress', [['kebab', GOBLIN_MAIL_FOOD_TARGET]]),
                bankKnown: true,
                bank: new Map(),
                freeSlots: 8
            },
            3
        );
        const funded = goblinMailGatherStep(
            {
                ...snap('inProgress', [
                    ['kebab', GOBLIN_MAIL_FOOD_TARGET],
                    ['coins', GOBLIN_DIPLOMACY_QUEST_COIN_RESERVE]
                ]),
                bankKnown: true,
                bank: new Map(),
                freeSlots: 7
            },
            3
        );
        expect(customName(noCash)).toBe(`earn ${GOBLIN_DIPLOMACY_COIN_TARGET} gp and buy combat food`);
        expect(customName(funded)).toBe('farm goblin mail');
    });
});
