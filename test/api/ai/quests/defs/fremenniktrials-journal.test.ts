import { describe, expect, test } from 'bun:test';

import { FT_STAGE, parseFremennikJournal, resetFremennikJournalCache } from '#/bot/api/ai/quests/defs/fremenniktrials/journal.js';

/** The header `viking_journal.rs2` writes for every in-progress page. */
const HEADER =
    '@str@I spoke to Brundt the Fremennik chieftan, and he told me|@str@that I could join their tribe if I could pass some trials|'
    + '@str@and get seven of the twelve council members votes.|';

const VOTES: Record<number, string> = {
    0: "@dbl@I don't have any votes yet|@dbl@I should try and find some of the @dre@council members|",
    1: '@dbl@I have @dre@one@dbl@ vote so far|',
    2: '@dbl@I have @dre@two@dbl@ votes so far|',
    3: '@dbl@I have @dre@three@dbl@ votes so far|',
    6: '@dbl@I have @dre@six@dbl@ votes so far|',
    7: '@dbl@I have @dre@seven votes@dbl@! I should go speak to @dre@Brundt@dbl@ again|'
};

const STARTED: Record<string, string> = {
    navigator: '@dbl@The @dre@Navigator@dbl@ will vote for me if I can pass his trial|@dbl@I need to get from one end of his @dre@maze@dbl@ to the other|',
    merchant: '@dbl@The @dre@Merchant@dbl@ will vote for me if I can pass his trial.|@dbl@Someone in this town has a @dre@rare flower@dbl@ that he wants.|',
    hunter: '@dbl@The @dre@Hunter@dbl@ will vote for me if I can pass his trial.|@dbl@I need to @dre@track and defeat@dbl@ a creature called the @dre@Draugen|',
    seer: '@dbl@The @dre@Seer@dbl@ will vote for me if I can pass his trial|@dbl@I need to get from @dre@one side@dbl@ of his house to @dre@the other|',
    warrior: '@dbl@The @dre@Warrior@dbl@ will vote for me if I can pass his trial|@dbl@I need to fight @dre@Koschei@dbl@ to the @dre@death@dbl@ in @dre@unarmed combat|',
    reveller: '@dbl@The @dre@Reveller@dbl@ will vote for me if I can pass his trial|@dbl@I need to defeat him in a @dre@drinking contest@dbl@ somehow!|',
    bard: '@dbl@The @dre@Bard@dbl@ will vote for me if I can pass his trial|@dbl@I must make myself @dre@a lyre@dbl@ and play it in the @dre@longhall|'
};

const DONE: Record<string, string> = {
    navigator: "@str@I now have the Navigator's vote at the council.|",
    merchant: "@str@I now have the Merchant's vote at the council.|",
    hunter: "@str@I now have the Hunter's vote at the council.|",
    seer: "@str@I now have the Seer's vote at the council|",
    warrior: "@str@I now have the Warrior's vote at the council|",
    reveller: "@str@I now have the Reveller's vote at the council|",
    bard: "@str@I now have the Bard's vote at the council.|"
};

/** The eleven lines that name where the flower trade has got to. */
const MERCHANT_STEP: Record<string, string> = {
    olaf: '@dbl@The @dre@bard@dbl@ is looking for some @dre@new boots@dbl@...||',
    yrsa: '@dbl@The @dre@shopkeeper@dbl@ is looking for a @dre@tax reduction@dbl@...||',
    chief: '|@dbl@The @dre@chieftan@dbl@ wants a @dre@map of new hunting grounds@dbl@...||',
    sigli: '|@dbl@The @dre@hunter@dbl@ is looking for a @dre@custom bowstring@dbl@...||',
    skul: '|@dbl@The @dre@armourer@dbl@ is looking for a @dre@rare inedible fish@dbl@...||',
    fisherman: '|@dbl@The @dre@fisherman@dbl@ is looking for a @dre@map of fishing spots@dbl@...||',
    swensen: '|@dbl@The @dre@navigator@dbl@ is looking for a @dre@weather forecast@dbl@...||',
    seer: '|@dbl@The @dre@seer@dbl@ is looking for a @dre@warrior to be his bodyguard@dbl@...||',
    thorvald: '|@dbl@The @dre@warrior@dbl@ is looking for a @dre@champions token@dbl@...||',
    manni: '|@dbl@The @dre@reveller@dbl@ is looking for a @dre@legendary cocktail@dbl@...||',
    thora: '|@dbl@All @dre@Askeladden@dbl@ wants is @dre@some money@dbl@!||'
};

const COMPLETE =
    '@str@I made my way to the far north of Kandarin and found the|@str@Barbarian hometown of Rellekka. The tribe that live there|'
    + '@str@call themselves the Fremennik, and offered me the chance|@str@to join them if I could pass their trials.|'
    + '@str@I managed to persuade seven of the twelve council of|@str@elders to vote for me at their next meeting, and became|'
    + '@str@an honorary member of the Fremennik.||@red@QUEST COMPLETE!|@dbl@They also gave me a new name:|@dre@Sigvald';

interface PageOptions {
    votes?: number;
    started?: string[];
    done?: string[];
    merchantAt?: string;
}

function page(options: PageOptions = {}): string {
    const started = options.started ?? [];
    const done = options.done ?? [];
    const line = (trial: string): string =>
        done.includes(trial) ? DONE[trial]! : started.includes(trial) ? STARTED[trial]! : '|';
    return HEADER
        + (VOTES[options.votes ?? 0] ?? VOTES[0]!)
        + line('navigator')
        + line('merchant')
        + (options.merchantAt ? MERCHANT_STEP[options.merchantAt]! : '|')
        + line('hunter')
        + line('seer')
        + line('warrior')
        + line('reveller')
        + line('bard');
}

describe('The Fremennik Trials journal parsing', () => {
    test('reads the completed page', () => {
        expect(parseFremennikJournal(COMPLETE)?.stage).toBe(FT_STAGE.COMPLETE);
    });

    test('reads a fresh page as no votes and no flags', () => {
        const progress = parseFremennikJournal(page());

        expect(progress?.stage).toBe(0);
        expect([...(progress?.flags ?? [])]).toEqual([]);
    });

    for (const votes of [1, 2, 3, 6, 7] as const) {
        test(`reads ${votes} vote(s) off the page`, () => {
            expect(parseFremennikJournal(page({ votes }))?.stage).toBe(votes);
        });
    }

    test('separates a started trial from a won one', () => {
        const progress = parseFremennikJournal(page({ votes: 1, done: ['reveller'], started: ['bard', 'hunter'] }));

        expect(progress?.flags.has('reveller-done')).toBe(true);
        expect(progress?.flags.has('bard-started')).toBe(true);
        expect(progress?.flags.has('hunter-started')).toBe(true);
        expect(progress?.flags.has('bard-done')).toBe(false);
        expect(progress?.flags.has('navigator-started')).toBe(false);
    });

    for (const step of Object.keys(MERCHANT_STEP)) {
        test(`names the flower trade at '${step}'`, () => {
            const progress = parseFremennikJournal(page({ started: ['merchant'], merchantAt: step }));

            expect(progress?.flags.has(`merchant-at:${step}`)).toBe(true);
            expect(progress?.flags.has('merchant-started')).toBe(true);
        });
    }

    test('a started merchant trial with no step line carries no position', () => {
        const flags = parseFremennikJournal(page({ started: ['merchant'] }))?.flags ?? new Set<string>();

        expect([...flags].some(f => f.startsWith('merchant-at:'))).toBe(false);
    });

    test('an empty page is unreadable rather than zero votes', () => {
        resetFremennikJournalCache();

        expect(parseFremennikJournal('')).toBeUndefined();
        expect(parseFremennikJournal('@dbl@Some unrelated scroll')).toBeUndefined();
    });
});
