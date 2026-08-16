import { describe, expect, test } from 'bun:test';

import {
    BLANKET_OBJ,
    MF_STAGE,
    decide,
    monksfriend,
    parseMonksFriendJournal
} from '#/bot/api/ai/quests/defs/monksfriend.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

// Pages built from content/scripts/quests/quest_drunkmonk/scripts/drunkmonk_journal.rs2.
const NOT_STARTED =
    '@dbl@I can start this quest by speaking to @dre@Brother Omad@dbl@ in the|@dre@Monastery@dbl@ south of @dre@Ardougne';

const SPOKEN_TO_OMAD =
    "@dre@Brother Omad@dbl@ asked me to recover a @dre@child's blanket@dbl@.|"
    + 'I need to find a @dre@secret cave@dbl@ that is hidden under a @dre@ring of'
    + '|@dre@stones@dbl@ in the @dre@forest@dbl@ south of @dre@Ardougne';

const BLANKET_LINE =
    "@str@Brother Omad asked me to recover a child's blanket.|@str@I found the secret cave and gave back the blanket.";

const RETRIEVED_BLANKET = BLANKET_LINE;

const LOOKING_CEDRIC =
    BLANKET_LINE + '||@dbl@I agreed to find @dre@Brother Cedric@dbl@. He is somewhere in the|@dre@forest@dbl@ south of @dre@Ardougne';

const FINDING_WATER =
    BLANKET_LINE + '||@str@I found Brother Cedric in the forest south of Ardougne.|@dbl@I need to take him a @dre@jug of water';

const MENDING_CART =
    BLANKET_LINE
    + '||@str@I found Brother Cedric in the forest south of Ardougne. I|@str@sobered him up.|'
    + '@dbl@He needs some @dre@wood@dbl@ for his cart';

const FIXED_CART =
    BLANKET_LINE
    + '||@str@I found Brother Cedric in the forest south of Ardougne. I|@str@sobered him up and I helped him fix his cart.|'
    + '@dre@Brother Cedric@dbl@ said that I should tell @dre@Brother Omad@dbl@ that|he is on the way.';

const COMPLETE =
    BLANKET_LINE
    + '||@str@I found Brother Cedric in the forest south of Ardougne. I|@str@sobered him up and I helped him fix his cart.||'
    + '@str@I had a party with the Monks. There were party balloons|@str@and we danced the night away!||@red@QUEST COMPLETE!';

interface SnapshotOptions {
    journal?: QuestSnapshot['journal'];
    stage?: number | undefined;
    inv?: string[];
    invIds?: number[];
    bank?: string[];
    bankKnown?: boolean;
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
    const stage = 'stage' in options ? options.stage : MF_STAGE.NOT_STARTED;
    return {
        journal: options.journal ?? 'inProgress',
        inv: counts(options.inv ?? []),
        invIds: idCounts(options.invIds ?? []),
        worn: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage,
        progress: stage === undefined ? undefined : { stage, flags: new Set() },
        bank: counts(options.bank ?? []),
        bankKnown: options.bankKnown ?? true,
        freeSlots: 28
    };
}

function customName(step: QuestStep): string | null {
    return step.kind === 'custom' ? step.name : null;
}

function talkTo(step: QuestStep): string | null {
    return step.kind === 'talk' ? step.stop.npc : null;
}

describe("Monk's Friend journal parsing", () => {
    test('reads the not-started page as stage 0', () => {
        expect(parseMonksFriendJournal(NOT_STARTED)).toBe(MF_STAGE.NOT_STARTED);
    });

    test('reads the blanket hunt as spoken-to-Omad', () => {
        expect(parseMonksFriendJournal(SPOKEN_TO_OMAD)).toBe(MF_STAGE.SPOKEN_TO_OMAD);
    });

    test('reads the returned blanket as stage 20', () => {
        expect(parseMonksFriendJournal(RETRIEVED_BLANKET)).toBe(MF_STAGE.RETRIEVED_BLANKET);
    });

    test('separates the Cedric search from the blanket page they share', () => {
        expect(parseMonksFriendJournal(LOOKING_CEDRIC)).toBe(MF_STAGE.LOOKING_CEDRIC);
    });

    test('reads the water errand as stage 40', () => {
        expect(parseMonksFriendJournal(FINDING_WATER)).toBe(MF_STAGE.FINDING_WATER);
    });

    test('reads the wood errand as the mending-cart stage', () => {
        expect(parseMonksFriendJournal(MENDING_CART)).toBe(MF_STAGE.MENDING_CART);
    });

    test('reads the fixed cart as stage 70', () => {
        expect(parseMonksFriendJournal(FIXED_CART)).toBe(MF_STAGE.FIXED_CART);
    });

    test('reads the finished page as complete', () => {
        expect(parseMonksFriendJournal(COMPLETE)).toBe(MF_STAGE.COMPLETE);
    });

    test('returns undefined for a page it cannot place', () => {
        expect(parseMonksFriendJournal('some other quest entirely')).toBeUndefined();
    });
});

describe("Monk's Friend decide", () => {
    test('waits while the quest list is still loading', () => {
        expect(decide(snap({ journal: 'unknown' }))).toEqual({ kind: 'wait', reason: 'quest journal not loaded' });
    });

    test('is done once the quest list turns green', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('waits rather than guessing when the journal stage is unavailable', () => {
        expect(decide(snap({ stage: undefined })).kind).toBe('wait');
    });

    test('opens with Brother Omad when the quest has not started', () => {
        const step = decide(snap({ journal: 'notStarted' }));

        expect(talkTo(step)).toBe('Brother Omad');
        expect(step.kind === 'talk' && step.stop.prefer).toContain('Can I help at all?');
    });

    test('goes down the hidden ladder for the blanket once Omad has asked', () => {
        expect(customName(decide(snap({ stage: MF_STAGE.SPOKEN_TO_OMAD })))).toBe("fetch the child's blanket");
    });

    test('hands a carried blanket back, since the journal still says to find the cave', () => {
        const step = decide(snap({ stage: MF_STAGE.SPOKEN_TO_OMAD, inv: ["Child's blanket"], invIds: [BLANKET_OBJ] }));

        expect(talkTo(step)).toBe('Brother Omad');
    });

    test('asks Omad where to look once the blanket is returned', () => {
        const step = decide(snap({ stage: MF_STAGE.RETRIEVED_BLANKET }));

        expect(talkTo(step)).toBe('Brother Omad');
        expect(step.kind === 'talk' && step.stop.prefer).toContain('Where should I look?');
    });

    test('finds Cedric in the forest once Omad names him', () => {
        expect(talkTo(decide(snap({ stage: MF_STAGE.LOOKING_CEDRIC })))).toBe('Brother Cedric');
    });

    test('reads the bank before believing it has no jug', () => {
        expect(decide(snap({ stage: MF_STAGE.FINDING_WATER, bankKnown: false })).kind).toBe('scanBank');
    });

    test('takes a banked jug of water rather than buying another', () => {
        const step = decide(snap({ stage: MF_STAGE.FINDING_WATER, bank: ['Jug of water'] }));

        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0].name).toBe('Jug of water');
    });

    test('buys a jug at Port Khazard when nothing is banked', () => {
        const step = decide(snap({ stage: MF_STAGE.FINDING_WATER }));

        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe('Jug');
        expect(step.kind === 'buy' && step.shop.npc).toBe('Shop keeper');
    });

    test('fills an empty jug at the guardhouse sink', () => {
        expect(customName(decide(snap({ stage: MF_STAGE.FINDING_WATER, inv: ['Jug'] })))).toBe('fill the jug at the guardhouse sink');
    });

    test('sobers Cedric up once the water is carried', () => {
        expect(talkTo(decide(snap({ stage: MF_STAGE.FINDING_WATER, inv: ['Jug of water'] })))).toBe('Brother Cedric');
    });

    test('takes a banked axe rather than buying one', () => {
        const step = decide(snap({ stage: MF_STAGE.MENDING_CART, bank: ['Rune axe'] }));

        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0].name).toBe('Rune axe');
    });

    test('buys an iron axe in East Ardougne when none is banked', () => {
        const step = decide(snap({ stage: MF_STAGE.MENDING_CART }));

        expect(step.kind).toBe('buy');
        expect(step.kind === 'buy' && step.item).toBe('Iron axe');
    });

    test('chops a forest tree once an axe is in the pack', () => {
        expect(customName(decide(snap({ stage: MF_STAGE.MENDING_CART, inv: ['Iron axe'] })))).toBe('chop logs for the cart');
    });

    test('does not mistake a pickaxe for a woodcutting axe', () => {
        const step = decide(snap({ stage: MF_STAGE.MENDING_CART, inv: ['Bronze pickaxe'] }));

        expect(step.kind).toBe('buy');
    });

    test('hands the logs over once they are cut', () => {
        expect(talkTo(decide(snap({ stage: MF_STAGE.MENDING_CART, inv: ['Logs'] })))).toBe('Brother Cedric');
    });

    test('reports back to Omad once the cart is fixed', () => {
        expect(customName(decide(snap({ stage: MF_STAGE.FIXED_CART })))).toBe('tell Omad that Cedric is on his way');
    });
});

describe("Monk's Friend module", () => {
    test('lists no required items, since the jug, axe and logs are all sourced mid-quest', () => {
        expect(monksfriend.record.items).toEqual([]);
    });

    test('is standalone — no quest or skill gates', () => {
        expect(monksfriend.record.requirements).toEqual({});
    });

    test('keeps every quest consumable off the deposit list', () => {
        for (const tool of ["child's blanket", 'jug', 'logs', 'axe', 'coins']) {
            expect(monksfriend.tools).toContain(tool);
        }
    });

    test('hops name the ring of stones and the cave ladder back out', () => {
        const stands = (monksfriend.hops ?? []).map(h => `${h.stand.x},${h.stand.z}`);

        expect(stands.sort()).toEqual(['2561,9622', '2562,3222']);
    });
});
