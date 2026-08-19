import { describe, expect, test } from 'bun:test';

import { HERO_STAGE } from '#/bot/api/ai/quests/defs/heroquest/journal.js';
import {
    LURE_RETRIES_BEFORE_REFETCH,
    decideHeroHandoff,
    shouldFetchKey,
    type HeroHandoffInput
} from '#/bot/api/ai/quests/defs/heroquest/partner.js';

function input(over: Partial<HeroHandoffInput> = {}): HeroHandoffInput {
    return {
        gang: 'blackarm',
        stage: HERO_STAGE.STARTED,
        hasKey: false,
        candlesticks: 0,
        partnerConfigured: true,
        ready: true,
        ...over
    };
}

describe('decideHeroHandoff', () => {
    test('nothing is owed while no partner is configured', () => {
        expect(decideHeroHandoff(input({
            partnerConfigured: false,
            stage: HERO_STAGE.BLACKARM_PAPERS_GIVEN,
            hasKey: true
        }))).toBeNull();
    });

    // Why: `open_and_close_door` teleports the actor and re-shuts in three ticks, so the Black Arm bot
    // cannot hold the side door open — the tradeable spare key is the only way the rival gets in.
    test('the Black Arm bot gives the spare key the moment Grip issues it', () => {
        expect(decideHeroHandoff(input({
            stage: HERO_STAGE.BLACKARM_PAPERS_GIVEN,
            hasKey: true
        }))).toBe('give-key');
    });

    test('it does not give a key it has not been handed', () => {
        expect(decideHeroHandoff(input({ stage: HERO_STAGE.BLACKARM_PAPERS_GIVEN }))).toBeNull();
    });

    test('it does not give the key before Grip has taken the papers', () => {
        expect(decideHeroHandoff(input({ stage: HERO_STAGE.BLACKARM_MANSION, hasKey: true }))).toBeNull();
    });

    // Why: the chest hands over two, one of which is the rival's payment for the kill.
    test('two candlesticks owes the rival one', () => {
        expect(decideHeroHandoff(input({
            stage: HERO_STAGE.BLACKARM_LOOTED,
            candlesticks: 2
        }))).toBe('give-candlestick');
    });

    test('the last candlestick is Katrine’s, not the rival’s', () => {
        expect(decideHeroHandoff(input({
            stage: HERO_STAGE.BLACKARM_LOOTED,
            candlesticks: 1
        }))).toBeNull();
    });

    // Why: the key is only useful with a bow worn, and fetching one afterwards starts in Brimhaven,
    // where the nearest bank is Ardougne across a fare each way.
    test('a Phoenix bot without its bow fetches that first', () => {
        expect(decideHeroHandoff(input({
            gang: 'phoenix',
            stage: HERO_STAGE.PHOENIX_CHARLIE,
            ready: false
        }))).toBeNull();
    });

    test('the Phoenix bot asks for the key once Charlie has shown the door', () => {
        expect(decideHeroHandoff(input({
            gang: 'phoenix',
            stage: HERO_STAGE.PHOENIX_CHARLIE
        }))).toBe('take-key');
    });

    test('it stops asking once it holds one', () => {
        expect(decideHeroHandoff(input({
            gang: 'phoenix',
            stage: HERO_STAGE.PHOENIX_CHARLIE,
            hasKey: true
        }))).toBeNull();
    });

    test('after the kill the Phoenix bot waits on its candlestick', () => {
        expect(decideHeroHandoff(input({
            gang: 'phoenix',
            stage: HERO_STAGE.PHOENIX_KILLED_GRIP
        }))).toBe('take-candlestick');
    });

    test('and stops once it has one', () => {
        expect(decideHeroHandoff(input({
            gang: 'phoenix',
            stage: HERO_STAGE.PHOENIX_KILLED_GRIP,
            candlesticks: 1
        }))).toBeNull();
    });

    test('an armbanded bot on either side owes nothing', () => {
        expect(decideHeroHandoff(input({
            stage: HERO_STAGE.BLACKARM_ARMBAND,
            hasKey: true,
            candlesticks: 2
        }))).toBeNull();
        expect(decideHeroHandoff(input({
            gang: 'phoenix',
            stage: HERO_STAGE.PHOENIX_ARMBAND,
            candlesticks: 0
        }))).toBeNull();
    });
});

// Why: Grip re-issues the spare whenever the bot holds none, so a Black Arm bot that fetches after
// every trade swaps keys with its rival forever instead of luring him onto the arrow slit.
describe('shouldFetchKey', () => {
    test('the first key is always fetched', () => {
        expect(shouldFetchKey({ gaveKey: false, lureFailures: 0 })).toBe(true);
    });

    test('a bot that has already handed one over lures instead', () => {
        expect(shouldFetchKey({ gaveKey: true, lureFailures: 0 })).toBe(false);
        expect(shouldFetchKey({ gaveKey: true, lureFailures: LURE_RETRIES_BEFORE_REFETCH - 1 })).toBe(false);
    });

    // Why: a rival that died holding the key needs a second one, and only an empty-handed bot can ask.
    test('a run of fruitless lures re-opens the fetch', () => {
        expect(shouldFetchKey({ gaveKey: true, lureFailures: LURE_RETRIES_BEFORE_REFETCH })).toBe(true);
    });
});
