import { describe, expect, test } from 'bun:test';

import {
    FLUFFS_OBJ,
    FLUFFS_STAGE,
    decide,
    gertrudescat,
    parseGertrudesCatJournal
} from '#/bot/api/ai/quests/defs/gertrudescat.js';
import type { QuestProgress, QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

const ACCEPTED = "@str@I accepted the challenge of finding Gertrude's lost cat.";
const SPOKE = "@str@I spoke to Shilop, Gertrude's Son.";
const FOUND = "@str@I found the lost cat but it won't come back.";
const FED = '@str@I gave the cat milk and sardines.';

const JOURNAL: Record<number, string> = {
    [FLUFFS_STAGE.NOT_STARTED]:
        '@dbl@I can start this quest by talking to @dre@Gertrude@dbl@. She can be found in a house south of the road leading|@dre@west out of Varrock@dbl@.',
    [FLUFFS_STAGE.STARTED]:
        `${ACCEPTED}||@dbl@I need to @dre@speak to Shilop and Wilough@dbl@ at the @dre@marketplace@dbl@.`,
    [FLUFFS_STAGE.PAID_BOY]:
        `${ACCEPTED}|${SPOKE}||@dbl@I need to @dre@go to their play area@dbl@ and @dre@find the lost cat and return it to Gertrude@dbl@.`,
    [FLUFFS_STAGE.GAVE_MILK]:
        `${ACCEPTED}|${SPOKE}|${FOUND}||@dbl@I still need to @dre@get her to follow me home@dbl@.`,
    [FLUFFS_STAGE.GAVE_SARDINE]:
        `${ACCEPTED}|${SPOKE}|${FOUND}|${FED}||@dbl@I still need to @dre@get her to follow me home@dbl@.`,
    [FLUFFS_STAGE.RESCUED]:
        `${ACCEPTED}|${SPOKE}|@str@The cat didn't follow me back.|${FED}|@str@I gave Fluffs her kitten back.||@dbl@She ran off home.`,
    [FLUFFS_STAGE.COMPLETE]:
        '@str@I helped Gertrude to find her lost cat,|@str@I fed it and returned her missing kitten,|@str@Gertrude gave me my very own pet for a reward.||@red@QUEST COMPLETE!'
};

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    inv?: string[];
    invIds?: number[];
    coins?: number;
    progress?: QuestProgress | undefined;
}

function counts(names: string[]): Map<string, number> {
    const result = new Map<string, number>();
    for (const name of names) {
        const key = name.toLowerCase();
        result.set(key, (result.get(key) ?? 0) + 1);
    }
    return result;
}

function idCounts(ids: number[]): Map<number, number> {
    const result = new Map<number, number>();
    for (const id of ids) {
        result.set(id, (result.get(id) ?? 0) + 1);
    }
    return result;
}

function snap(options: SnapshotOptions = {}): QuestSnapshot {
    const progress =
        'progress' in options ? options.progress : { stage: options.stage ?? FLUFFS_STAGE.STARTED, flags: new Set<string>() };
    const inv = counts(options.inv ?? []);
    inv.set('coins', options.coins ?? 1000);
    return {
        journal: options.journal ?? 'inProgress',
        inv,
        invIds: idCounts(options.invIds ?? []),
        worn: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: progress?.stage,
        progress,
        bank: new Map(),
        bankKnown: true,
        freeSlots: 28
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

describe("Gertrude's Cat journal parsing", () => {
    for (const [stage, text] of Object.entries(JOURNAL)) {
        test(`reads the stage ${stage} page`, () => {
            expect(parseGertrudesCatJournal(text)?.stage).toBe(Number(stage));
        });
    }

    test('keeps the cumulative pages apart, newest sentence first', () => {
        expect(parseGertrudesCatJournal(JOURNAL[FLUFFS_STAGE.GAVE_SARDINE])?.stage).not.toBe(FLUFFS_STAGE.GAVE_MILK);
        expect(parseGertrudesCatJournal(JOURNAL[FLUFFS_STAGE.RESCUED])?.stage).not.toBe(FLUFFS_STAGE.GAVE_SARDINE);
    });

    test('returns undefined for a page it cannot place', () => {
        expect(parseGertrudesCatJournal('some other quest entirely')).toBeUndefined();
    });
});

describe("Gertrude's Cat decide", () => {
    test('waits while the quest list is still loading', () => {
        expect(decide(snap({ journal: 'unknown' }))).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('is done once the quest list turns green', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('opens with Gertrude when the quest has not started', () => {
        const step = decide(snap({ journal: 'notStarted' }));

        expect(step.kind).toBe('talk');
        expect(step.kind === 'talk' && step.stop.npc).toBe('Gertrude');
    });

    test('waits rather than guessing when the journal stage is unavailable', () => {
        expect(decide(snap({ progress: undefined })).kind).toBe('wait');
    });

    test('tops up coins before walking to the market, since the boy wants 100', () => {
        const step = decide(snap({ stage: FLUFFS_STAGE.STARTED, coins: 20 }));

        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0].name).toBe('Coins');
    });

    test('pays the brothers once the coins are in the pack', () => {
        expect(customName(decide(snap({ stage: FLUFFS_STAGE.STARTED })))).toBe('buy the play area out of Shilop');
    });

    test('picks the doogle leaves before the walk to Port Sarim', () => {
        const step = decide(snap({ stage: FLUFFS_STAGE.PAID_BOY }));

        expect(step.kind).toBe('grabGround');
        expect(step.kind === 'grabGround' && step.item).toBe('Doogle leaves');
    });

    test('buys the raw sardine once the leaves are held', () => {
        const step = decide(snap({ stage: FLUFFS_STAGE.PAID_BOY, invIds: [FLUFFS_OBJ.doogleLeaves] }));

        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.shop.npc).toBe('Gerrant');
    });

    test('seasons the sardine as soon as both halves are in the pack', () => {
        const step = decide(snap({
            stage: FLUFFS_STAGE.PAID_BOY,
            invIds: [FLUFFS_OBJ.doogleLeaves, FLUFFS_OBJ.rawSardine],
            inv: ['Doogle leaves', 'Raw sardine']
        }));

        expect(customName(step)).toBe('season the sardine with doogle leaves');
    });

    // Why: the milk is used first, but its cow is a detour off the Port Sarim road, so the sardine is bought on the way past rather than fetched on a second lap.
    test('fetches the milk only after the sardine is seasoned', () => {
        const step = decide(snap({ stage: FLUFFS_STAGE.PAID_BOY, invIds: [FLUFFS_OBJ.seasonedSardine] }));

        expect(step.kind).toBe('grabGround');
        expect(step.kind === 'grabGround' && step.item).toBe('Bucket');
    });

    test('milks a cow once it carries a bucket', () => {
        const step = decide(snap({
            stage: FLUFFS_STAGE.PAID_BOY,
            invIds: [FLUFFS_OBJ.seasonedSardine],
            inv: ['Bucket']
        }));

        expect(step.kind).toBe('useOn');
        expect(step.kind === 'useOn' && step.target).toBe('Cow');
    });

    test('climbs to Fluffs with the milk once both are ready', () => {
        const step = decide(snap({
            stage: FLUFFS_STAGE.PAID_BOY,
            invIds: [FLUFFS_OBJ.seasonedSardine, FLUFFS_OBJ.bucketOfMilk],
            inv: ['Bucket of milk']
        }));

        expect(customName(step)).toBe('give Fluffs the milk');
    });

    test('re-sources the sardine after a death that ate it', () => {
        const step = decide(snap({ stage: FLUFFS_STAGE.GAVE_MILK }));

        expect(step.kind).toBe('grabGround');
        expect(step.kind === 'grabGround' && step.item).toBe('Doogle leaves');
    });

    test('feeds the doogle sardine once the milk is drunk', () => {
        expect(customName(decide(snap({ stage: FLUFFS_STAGE.GAVE_MILK, invIds: [FLUFFS_OBJ.seasonedSardine] }))))
            .toBe('give Fluffs the doogle sardine');
    });

    test('searches the crates once Fluffs has eaten', () => {
        expect(customName(decide(snap({ stage: FLUFFS_STAGE.GAVE_SARDINE })))).toBe('search the crates for the kitten');
    });

    test('returns the kitten rather than searching on once it is found', () => {
        expect(customName(decide(snap({ stage: FLUFFS_STAGE.GAVE_SARDINE, invIds: [FLUFFS_OBJ.kitten] }))))
            .toBe('give Fluffs her kitten');
    });

    test('claims the reward from Gertrude once Fluffs has run home', () => {
        expect(customName(decide(snap({ stage: FLUFFS_STAGE.RESCUED })))).toBe('take the news back to Gertrude');
    });
});

describe("Gertrude's Cat module", () => {
    test('leaves every consumable off the record, so a resume past a stage refetches nothing', () => {
        expect(gertrudescat.record.items).toEqual([]);
    });

    test('keeps the coins and all four quest items off the deposit list', () => {
        for (const tool of ['coins', 'bucket', 'doogle leaves', 'sardine', "fluffs' kitten"]) {
            expect(gertrudescat.tools).toContain(tool);
        }
    });

    test('banks in Varrock West, the closest booth to Gertrude and the market', () => {
        expect(gertrudescat.bank).toEqual(expect.objectContaining({ x: 3185, z: 3440, level: 0 }));
    });
});
