import { afterEach, expect, test, describe } from 'bun:test';
import { decide, GOBLIN_DIPLOMACY_COIN_TARGET, GOBLIN_DIPLOMACY_QUEST_COIN_RESERVE, goblindiplomacy, goblinMailGatherStep } from '#/bot/api/ai/quests/defs/goblindiplomacy.js';
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

    // Why: this is a free quest and the mail comes off goblins, so nothing is withdrawn or bought to eat; the coins stay, since they buy Aggie's dyes.
    test('never withdraws food, whatever the bank holds', () => {
        QuestFood.name = 'Trout';
        const withSelected = goblinMailGatherStep({
            ...snap('inProgress'),
            bankKnown: true,
            bank: new Map([['trout', 20]])
        });
        expect(withSelected.kind).not.toBe('withdraw');

        const withFallback = goblinMailGatherStep({
            ...snap('inProgress'),
            bankKnown: true,
            bank: new Map([['kebab', 20]])
        });
        expect(withFallback.kind).not.toBe('withdraw');
    });

    test('goes for the mail on coins alone, with no food in the pack', () => {
        const step = goblinMailGatherStep({
            ...snap('inProgress', [['coins', 500]]),
            bankKnown: true,
            freeSlots: 10
        });
        expect(step.kind === 'custom' && step.name).toBe('farm goblin mail');
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

    test('earns the quest purse when the account is completely empty', () => {
        const step = goblinMailGatherStep({ ...snap('inProgress'), bankKnown: true, bank: new Map() });
        expect(customName(step)).toBe(`earn ${GOBLIN_DIPLOMACY_COIN_TARGET} gp`);
    });

    test('travels to Goblin Village on the purse alone, with no batch of food to gather first', () => {
        const step = goblinMailGatherStep({
            ...snap('inProgress', [['coins', GOBLIN_DIPLOMACY_QUEST_COIN_RESERVE]]),
            bankKnown: true
        });
        expect(customName(step)).toBe('farm goblin mail');
    });

    // Why: the restock ladder went with the food; the run now goes on whatever coins it has and eats only what it happens to carry.
    test('self-funds the quest reserve when the purse is short', () => {
        const step = goblinMailGatherStep({
            ...snap('inProgress', [['coins', 1]]),
            bankKnown: true,
            bank: new Map()
        });
        expect(customName(step)).toBe(`earn ${GOBLIN_DIPLOMACY_COIN_TARGET} gp`);
    });

});
