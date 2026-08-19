import { describe, expect, test } from 'bun:test';

import { SH_STAGE, parseSheepHerderJournal } from '#/bot/api/ai/quests/defs/sheepherder/journal.js';

const NOT_STARTED =
    '@dbl@I can start this quest by speaking to @dre@Councillor Halgrive @dbl@near to the @dre@Zoo @dbl@in @dre@East Ardougne@dbl@.';

const PREAMBLE =
    '@str@Councillor Halgrive asked me to dispose of four|@str@plague-bearing sheep just north of Ardougne|@str@and I accepted.|'
    + '@str@He gave me some poisoned sheep feed to do this.|';

const NEED_SUIT =
    PREAMBLE
    + '|@dbl@I need to get some protective clothing from @dre@Dr Orbon @dbl@who is in the church just north of @dre@Ardougne Zoo';

const BOUGHT_SUIT =
    PREAMBLE
    + '|@str@I bought some protective clothing from Dr Orbon in the|@str@chapel north of Ardougne Zoo. I could now kill the sheep.|';

const ORDINAL = ['first', 'second', 'third', 'fourth'];

type SheepState = 'none' | 'herded' | 'killed' | 'burnt';

function line(ordinal: string, state: SheepState): string {
    switch (state) {
        case 'burnt':
            return `|@str@I have killed the ${ordinal} sheep and incinerated its bones.|`;
        case 'killed':
            return `|@dbl@I have killed the ${ordinal} sheep. Now I must incinerate its @dre@bones@dbl@.|`;
        case 'herded':
            return `|@dbl@I have herded the ${ordinal} sheep to the pen. Now I must kill it safely.|`;
        default:
            return `|@dbl@I must find the ${ordinal} sheep and herd it to the pen.|`;
    }
}

function disposing(states: SheepState[]): string {
    return BOUGHT_SUIT + ORDINAL.map((ordinal, i) => line(ordinal, states[i])).join('');
}

const ALL_BURNT =
    BOUGHT_SUIT
    + '|@str@I equipped a prod and then I used it to herd the diseased|@str@sheep to a pen where I could safely kill them and|@str@incinerate their bones.|'
    + '|@dbl@I should return to @dre@Councillor Halgrive @dbl@to collect the reward he has promised me for my hard work.';

const COMPLETE =
    BOUGHT_SUIT
    + '|@str@I returned to let Councillor Halgrive know that the plagued|@str@sheep were no more and claimed my reward.|'
    + '@red@QUEST COMPLETE!';

describe('Sheep Herder journal parsing', () => {
    test('reads the not-started page as stage 0', () => {
        const progress = parseSheepHerderJournal(NOT_STARTED);

        expect(progress?.stage).toBe(SH_STAGE.NOT_STARTED);
        expect([...(progress?.flags ?? [])]).toEqual([]);
    });

    test('reads the pre-suit page as the stage that still owes Doctor Orbon a visit', () => {
        expect(parseSheepHerderJournal(NEED_SUIT)?.stage).toBe(SH_STAGE.NEED_SUIT);
    });

    test('reads a page with no sheep dealt with as disposing and no flags', () => {
        const progress = parseSheepHerderJournal(disposing(['none', 'none', 'none', 'none']));

        expect(progress?.stage).toBe(SH_STAGE.DISPOSING);
        expect([...(progress?.flags ?? [])]).toEqual([]);
    });

    test('separates herded, killed and incinerated per sheep', () => {
        const progress = parseSheepHerderJournal(disposing(['burnt', 'killed', 'herded', 'none']));

        expect([...(progress?.flags ?? [])].sort()).toEqual([
            'burnt-1',
            'herded-1',
            'herded-2',
            'herded-3',
            'killed-1',
            'killed-2'
        ]);
    });

    test('reads the killed line, whose colour tag sits between "its" and "bones"', () => {
        const progress = parseSheepHerderJournal(disposing(['none', 'none', 'none', 'killed']));

        expect(progress?.flags.has('killed-4')).toBe(true);
        expect(progress?.flags.has('burnt-4')).toBe(false);
    });

    test('treats the reward page as all four burnt, since it drops the per-sheep lines', () => {
        const progress = parseSheepHerderJournal(ALL_BURNT);

        expect(progress?.stage).toBe(SH_STAGE.DISPOSING);
        expect([...(progress?.flags ?? [])].sort()).toEqual(['burnt-1', 'burnt-2', 'burnt-3', 'burnt-4']);
    });

    test('reads the finished page as complete', () => {
        expect(parseSheepHerderJournal(COMPLETE)?.stage).toBe(SH_STAGE.COMPLETE);
    });

    test('returns undefined for a page it cannot place', () => {
        expect(parseSheepHerderJournal('some other quest entirely')).toBeUndefined();
    });
});
