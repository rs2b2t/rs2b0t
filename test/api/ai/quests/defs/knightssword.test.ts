import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { KS_ID, KS_STAGE } from '#/bot/api/ai/quests/defs/knightssword/areas.js';
import { decideAt, knightssword } from '#/bot/api/ai/quests/defs/knightssword/index.js';
import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const COINS = 995;
const BRONZE_PICKAXE = 1265;
const MAX_MINING = 70;

// QuestFood is a live module-level object several quest defs read, so restore it
// or this file silently changes whichever test file bun runs next.
const originalFood = QuestFood.name;
beforeAll(() => { QuestFood.name = 'Lobster'; });
afterAll(() => { QuestFood.name = originalFood; });

/** Kitted out by default, so every case exercises the branch it names. */
function snap(options: {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    invIds?: [number, number][];
    bankIds?: [number, number][];
    wornIds?: number[];
    bankKnown?: boolean;
    food?: number;
    tile?: QuestSnapshot['tile'];
} = {}): QuestSnapshot {
    const stage = options.stage ?? KS_STAGE.NOT_STARTED;
    const inv = new Map<string, number>([['lobster', options.food ?? 14]]);
    return {
        journal: options.journal ?? (stage === KS_STAGE.NOT_STARTED ? 'notStarted' : 'inProgress'),
        inv,
        invIds: new Map([[COINS, 1000], ...(options.invIds ?? [])]),
        worn: new Set(),
        wornIds: new Set(options.wornIds ?? []),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: { stage, flags: new Set() },
        bank: new Map(),
        bankIds: new Map(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: options.tile ?? { x: 2946, z: 3369, level: 0 },
        freeSlots: 20
    };
}

const decide = (options: Parameters<typeof snap>[0] = {}): QuestStep =>
    decideAt(snap(options), MAX_MINING);

const talkTo = (step: QuestStep): string | undefined =>
    step.kind === 'talk' ? step.stop.npc : undefined;

describe("The Knight's Sword decide()", () => {
    test('waits while the journal is unknown', () => {
        // 'unknown' is not 'notStarted': the quest list is blank for a moment
        // after login, and restarting a finished quest is the worst outcome.
        expect(decide({ journal: 'unknown' }).kind).toBe('wait');
    });

    test('is done when complete', () => {
        expect(decide({ journal: 'complete', stage: KS_STAGE.COMPLETE }).kind).toBe('done');
    });

    test('waits when the stage is unreadable', () => {
        const blind = { ...snap({ journal: 'inProgress' }), stage: undefined, progress: undefined };
        expect(decideAt(blind, MAX_MINING).kind).toBe('wait');
    });

    test('starts with the Squire', () => {
        expect(talkTo(decide())).toBe('Squire');
    });

    test('grabs the pie dish on the way to Reldo', () => {
        expect(decide({ stage: KS_STAGE.STARTED })).toMatchObject({ kind: 'grabGround', item: 'Pie dish' });
    });

    test('talks to Reldo once the dish is held', () => {
        expect(talkTo(decide({ stage: KS_STAGE.STARTED, invIds: [[KS_ID.PIE_DISH, 1]] }))).toBe('Reldo');
    });

    test('a banked dish is enough to move on to Reldo', () => {
        const step = decide({ stage: KS_STAGE.STARTED, bankIds: [[KS_ID.PIE_DISH, 1]] });
        expect(talkTo(step)).toBe('Reldo');
    });

    test('builds a pie after Reldo', () => {
        const step = decide({ stage: KS_STAGE.SPOKEN_RELDO, invIds: [[KS_ID.PIE_DISH, 1]] });
        expect(step.kind).not.toBe('talk');
    });

    test('takes a held pie to Thurgo', () => {
        const step = decide({ stage: KS_STAGE.SPOKEN_RELDO, invIds: [[KS_ID.REDBERRY_PIE, 1]] });
        expect(talkTo(step)).toBe('Thurgo');
    });

    test('returns to Thurgo after the pie is eaten', () => {
        expect(talkTo(decide({ stage: KS_STAGE.GIVEN_PIE }))).toBe('Thurgo');
    });

    test('reports back to the Squire for the portrait lead', () => {
        // The cupboard is gated on %squire >= 5, which only squire_status_report
        // sets, so the portrait cannot be fetched early.
        expect(talkTo(decide({ stage: KS_STAGE.SPOKEN_THURGO }))).toBe('Squire');
    });

    test('fetches the portrait at stage 5', () => {
        expect(decide({ stage: KS_STAGE.LOOKING_PORTRAIT }))
            .toMatchObject({ kind: 'custom', name: 'take the portrait' });
    });

    test('takes a held portrait to Thurgo', () => {
        const step = decide({ stage: KS_STAGE.LOOKING_PORTRAIT, invIds: [[KS_ID.PORTRAIT, 1]] });
        expect(talkTo(step)).toBe('Thurgo');
    });

    test('never banks the portrait', () => {
        // search_cupboard refuses while one is in the bank, so a banked portrait
        // is an unrecoverable wedge. Nothing may ever produce that step.
        for (const stage of Object.values(KS_STAGE)) {
            const step = decide({ stage, invIds: [[KS_ID.PORTRAIT, 1]] });
            const banking = step.kind === 'deposit';
            expect(banking).toBe(false);
        }
    });
});

describe('stage 6, the materials and the sword', () => {
    const at6 = (options: Parameters<typeof snap>[0] = {}) =>
        decide({ ...options, stage: KS_STAGE.LOOKING_BLURITE });

    test('unequips a worn sword before handing it over', () => {
        // squire_status_report answers "So can you un-equip it and hand it over"
        // to a worn sword; only the pack counts.
        expect(at6({ wornIds: [KS_ID.BLURITE_SWORD] })).toMatchObject({ kind: 'equip' });
    });

    test('withdraws a banked sword', () => {
        expect(at6({ bankIds: [[KS_ID.BLURITE_SWORD, 1]] }).kind).toBe('withdraw');
    });

    test('hands a held sword to the Squire', () => {
        expect(talkTo(at6({ invIds: [[KS_ID.BLURITE_SWORD, 1]] }))).toBe('Squire');
    });

    test('gets iron bars before blurite', () => {
        expect(at6({ invIds: [[BRONZE_PICKAXE, 1]] })).toMatchObject({ kind: 'mineRock', rock: 'Iron' });
    });

    test('mines blurite once the bars are in the pack', () => {
        const step = at6({ invIds: [[KS_ID.IRON_BAR, 2], [BRONZE_PICKAXE, 1]] });
        expect(step).toMatchObject({ kind: 'custom', name: 'mine blurite' });
    });

    test('takes the full set to Thurgo', () => {
        const step = at6({ invIds: [[KS_ID.IRON_BAR, 2], [KS_ID.BLURITE_ORE, 1], [BRONZE_PICKAXE, 1]] });
        expect(talkTo(step)).toBe('Thurgo');
    });

    test('stocks food before going underground', () => {
        const step = at6({ invIds: [[KS_ID.IRON_BAR, 2], [BRONZE_PICKAXE, 1]], food: 0 });
        expect(step).toMatchObject({ kind: 'withdraw' });
    });

    test('does not walk back out of the dungeon to re-bank', () => {
        const step = at6({
            invIds: [[KS_ID.IRON_BAR, 2], [BRONZE_PICKAXE, 1]],
            food: 0,
            tile: { x: 3049, z: 9566, level: 0 }
        });
        expect(step).toMatchObject({ kind: 'custom', name: 'mine blurite' });
    });

    test('tops the coin float up before anything else', () => {
        const bare = snap({ stage: KS_STAGE.SPOKEN_RELDO });
        bare.invIds = new Map([[COINS, 1]]);
        const step = decideAt(bare, MAX_MINING);
        expect(step.kind === 'withdraw' && step.items.some(i => i.id === COINS)).toBe(true);
    });
});

describe('the module', () => {
    test('is registered in the queue', () => {
        expect(QUEST_DEFS).toContain(knightssword);
        expect(knightssword.record.id).toBe('squire');
    });

    test('owns its inventory, because acquisition is just-in-time', () => {
        // The engine's provisioning block force-gathers record.items before
        // decide() ever runs; ownsInventory is what hands the loadout back.
        expect(knightssword.ownsInventory).toBe(true);
    });

    test('keeps coins in tools, or every purchase parks on "need gp"', () => {
        expect(knightssword.tools).toContain('coins');
    });

    test('pins no bank, because the quest crosses four towns', () => {
        expect(knightssword.bank).toBe('nearest');
    });
});
