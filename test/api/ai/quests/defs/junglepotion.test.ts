import { describe, expect, test } from 'bun:test';
import {
    JP_STAGE,
    JUNGLE_HERBS,
    decide,
    herbForStage,
    junglepotion,
    parseJungleJournal
} from '#/bot/api/ai/quests/defs/junglepotion.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

function snapshot(o: Partial<QuestSnapshot> = {}): QuestSnapshot {
    return {
        journal: o.journal ?? 'inProgress',
        inv: o.inv ?? new Map(),
        invIds: o.invIds ?? new Map(),
        worn: o.worn ?? new Set(),
        wornIds: o.wornIds ?? new Set(),
        noProgress: 0,
        bankCoins: o.bankCoins ?? 0,
        stage: o.stage ?? o.progress?.stage,
        progress: o.progress,
        bank: o.bank ?? new Map(),
        bankIds: o.bankIds ?? new Map(),
        bankKnown: o.bankKnown ?? true,
        tile: o.tile === undefined ? { x: 2809, z: 3086, level: 0 } : o.tile,
        freeSlots: o.freeSlots ?? 28
    };
}

describe('jungle potion herbs', () => {
    test('every unidentified herb shares one display name, so ids are the only key', () => {
        expect(new Set(JUNGLE_HERBS.map(h => h.unidId)).size).toBe(5);
        expect(new Set(JUNGLE_HERBS.map(h => h.id)).size).toBe(5);
    });

    test('both stages of a herb map to the same herb', () => {
        expect(herbForStage(JP_STAGE.GET_SNAKE_WEED)?.key).toBe('snake weed');
        expect(herbForStage(JP_STAGE.FOUND_SNAKE_WEED)?.key).toBe('snake weed');
        expect(herbForStage(JP_STAGE.GET_ARDRIGAL)?.key).toBe('ardrigal');
        expect(herbForStage(JP_STAGE.FOUND_SITO_FOIL)?.key).toBe('sito foil');
        expect(herbForStage(JP_STAGE.GET_VOLENCIA_MOSS)?.key).toBe('volencia moss');
        expect(herbForStage(JP_STAGE.FOUND_ROGUES_PURSE)?.key).toBe('rogues purse');
    });

    test('stages outside the herb run have no herb', () => {
        expect(herbForStage(JP_STAGE.NOT_STARTED)).toBeNull();
        expect(herbForStage(JP_STAGE.FOUND_ALL_HERBS)).toBeNull();
        expect(herbForStage(JP_STAGE.COMPLETE)).toBeNull();
    });

    test('only the rogues purse is underground', () => {
        expect(JUNGLE_HERBS.filter(h => h.underground).map(h => h.key)).toEqual(['rogues purse']);
    });
});

describe('parseJungleJournal', () => {
    test('not started', () => {
        const p = parseJungleJournal('@dbl@I can start this quest by speaking to @dre@Trufitus Shakaya|');
        expect(p?.stage).toBe(JP_STAGE.NOT_STARTED);
    });

    test('complete', () => {
        expect(parseJungleJournal('@str@As a reward he showed me some herblore techniques.||@red@QUEST COMPLETE!')?.stage)
            .toBe(JP_STAGE.COMPLETE);
    });

    test('asked for a herb but not yet holding it', () => {
        const p = parseJungleJournal([
            '@str@I spoke to Trufitus, he needs to commune with the|',
            "@str@gods, he's asked me to help him by collecting herbs.||",
            '@dbl@I need to pick some fresh @dre@Snakeweed@dbl@ for @dre@Trufitus@dbl@.'
        ]);
        expect(p?.stage).toBe(JP_STAGE.GET_SNAKE_WEED);
    });

    test('picked it: the "give" line outranks the "pick" line', () => {
        const p = parseJungleJournal([
            '@str@I picked some fresh Snakeweed for Trufitus.||',
            '@dbl@I need to give the @dre@Snake Weed@dbl@ to @dre@Trufitus@dbl@.'
        ]);
        expect(p?.stage).toBe(JP_STAGE.FOUND_SNAKE_WEED);
    });

    test('a later herb outranks the history of an earlier one', () => {
        const p = parseJungleJournal([
            "@str@I've given Snakeweed, Ardrigal and Sito Foil|",
            '@str@to Trufitus.||',
            '@dbl@I need to pick some fresh @dre@Volencia Moss@dbl@ for @dre@Trufitus@dbl@.'
        ]);
        expect(p?.stage).toBe(JP_STAGE.GET_VOLENCIA_MOSS);
    });

    test('the rogues purse "give" line is singular in the engine text', () => {
        const p = parseJungleJournal([
            "@str@I've given Snakeweed, Ardrigal, Sito Foil|",
            '@str@and Volencia Moss to Trufitus.||',
            '@dbl@I need to give the @dre@Rogue Purse@dbl@ to @dre@Trufitus@dbl@.'
        ]);
        expect(p?.stage).toBe(JP_STAGE.FOUND_ROGUES_PURSE);
    });

    test('all five delivered', () => {
        const p = parseJungleJournal([
            '@str@I have given Trufitus Snakeweed, Ardrigal,|',
            '@str@Sito Foil,Volencia moss and Rogues purse.||',
            '@str@Trufitus needs to commune with the gods.||',
            '@dbl@I should speak to @dre@Trufitus@dbl@.'
        ]);
        expect(p?.stage).toBe(JP_STAGE.FOUND_ALL_HERBS);
    });

    test('unrecognised text yields nothing rather than a guess', () => {
        expect(parseJungleJournal('some other quest entirely')).toBeUndefined();
    });
});

describe('junglepotion decide', () => {
    test('a complete journal is done', () => {
        expect(decide(snapshot({ journal: 'complete' })).kind).toBe('done');
    });

    test('an unloaded journal waits — it is not notStarted', () => {
        expect(decide(snapshot({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('a missing stage waits rather than guessing', () => {
        expect(decide(snapshot({ stage: undefined })).kind).toBe('wait');
    });

    test('not started asks Trufitus for the job', () => {
        const step = decide(snapshot({ journal: 'notStarted', stage: JP_STAGE.NOT_STARTED }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toContain('Trufitus');
    });

    test('a get_ stage picks even while an identified herb is already held', () => {
        // Only picking advances get_ to found_, and only found_ accepts a hand-in.
        const step = decide(snapshot({
            stage: JP_STAGE.GET_ARDRIGAL,
            invIds: new Map([[1528, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toBe('pick Ardrigal');
    });

    test('a carried unid is identified whatever the journal says', () => {
        // At found_snake_weed with the unid held the journal writes no line at all,
        // and every other found_ stage writes the previous "go and pick it" line.
        const found = decide(snapshot({ stage: JP_STAGE.FOUND_ARDRIGAL, invIds: new Map([[1527, 1]]) }));
        expect(found.kind === 'custom' && found.name).toBe('identify the Ardrigal');

        const noStage = decide(snapshot({ stage: undefined, invIds: new Map([[1525, 1]]) }));
        expect(noStage.kind === 'custom' && noStage.name).toBe('identify the Snake weed');

        const wrongStage = decide(snapshot({ stage: JP_STAGE.GET_SITO_FOIL, invIds: new Map([[1529, 1]]) }));
        expect(wrongStage.kind === 'custom' && wrongStage.name).toBe('identify the Sito foil');
    });

    test('a found_ stage with a clean herb hands it over', () => {
        const step = decide(snapshot({
            stage: JP_STAGE.FOUND_ARDRIGAL,
            invIds: new Map([[1528, 1]])
        }));
        expect(step.kind === 'custom' && step.name).toContain('give the Ardrigal');
    });

    test('a found_ stage with nothing held re-picks', () => {
        const step = decide(snapshot({ stage: JP_STAGE.FOUND_SITO_FOIL }));
        expect(step.kind === 'custom' && step.name).toBe('pick Sito foil');
    });

    test('all five delivered goes back to Trufitus', () => {
        const step = decide(snapshot({ stage: JP_STAGE.FOUND_ALL_HERBS }));
        expect(step.kind === 'custom' && step.name).toContain('commune');
    });
});

describe('junglepotion module', () => {
    test('it owns its inventory — Karamja has no bank', () => {
        expect(junglepotion.ownsInventory).toBe(true);
    });

    test('the record carries the Druidic Ritual prerequisite the engine enforces', () => {
        expect(junglepotion.record.requirements.quests).toEqual(['druid']);
    });
});
