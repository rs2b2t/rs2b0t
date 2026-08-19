import { describe, expect, test } from 'bun:test';

import { SM_ID, SM_STAGE } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import {
    ashesShort,
    dosesNeeded,
    logsShort,
    serumDoses,
    serumsShort
} from '#/bot/api/ai/quests/defs/mortton/supplies.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

function pack(invIds: [number, number][] = []): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: new Map(invIds),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 0,
        bank: new Map(),
        bankIds: new Map(),
        bankKnown: true,
        tile: { x: 3490, z: 3290, level: 0 },
        freeSlots: 20
    };
}

describe('serum dose accounting', () => {
    test('a fresh quest owes four conversations', () => {
        expect(dosesNeeded(SM_STAGE.NOT_STARTED)).toBe(4);
        expect(dosesNeeded(SM_STAGE.READ_DIARY)).toBe(4);
    });

    test('each villager paid off drops one dose from the bill', () => {
        expect(dosesNeeded(SM_STAGE.KILL_SHADES)).toBe(3);
        expect(dosesNeeded(SM_STAGE.KILLED_5)).toBe(3);
        expect(dosesNeeded(SM_STAGE.SHADES_TO_RAZMIRE)).toBe(2);
        expect(dosesNeeded(SM_STAGE.ULSQUIRE_TEMPLE)).toBe(1);
        expect(dosesNeeded(SM_STAGE.LIT_PYRE)).toBe(1);
    });

    test('doses are counted across every vial size', () => {
        expect(serumDoses(pack([[SM_ID.SERUM4, 1], [SM_ID.SERUM1, 2]]))).toBe(6);
    });

    test('an empty pack at the start brews two vials, which is what the table funds', () => {
        expect(serumsShort(pack(), SM_STAGE.READ_DIARY)).toBe(2);
    });

    test('one brewed vial still leaves one to brew', () => {
        expect(serumsShort(pack([[SM_ID.SERUM3, 1]]), SM_STAGE.READ_DIARY)).toBe(1);
    });

    test('two brewed vials cover the whole quest', () => {
        expect(serumsShort(pack([[SM_ID.SERUM3, 2]]), SM_STAGE.READ_DIARY)).toBe(0);
    });

    // Why: counting the unfinished potion as a vial stopped the chain on it and left the last conversation unpayable.
    test('an unfinished potion is not a vial yet', () => {
        expect(serumsShort(pack([[SM_ID.SERUM3, 1], [SM_ID.TARROMIN_UNF, 1]]), SM_STAGE.READ_DIARY)).toBe(1);
    });

    test('a sanctified vial pays the last conversation', () => {
        expect(serumsShort(pack([[SM_ID.SERUM_PERM3, 1]]), SM_STAGE.LIT_PYRE)).toBe(0);
    });

    test('a dry pack late in the quest brews one more', () => {
        expect(serumsShort(pack(), SM_STAGE.LIT_PYRE)).toBe(1);
    });
});

describe('ashes and logs', () => {
    test('two serums to brew means two burns', () => {
        expect(ashesShort(pack(), SM_STAGE.READ_DIARY)).toBe(2);
    });

    test('ashes already held retire the burns', () => {
        expect(ashesShort(pack([[SM_ID.ASHES, 2]]), SM_STAGE.READ_DIARY)).toBe(0);
    });

    test('the logs order is one per burn plus the pyre', () => {
        expect(logsShort(pack(), SM_STAGE.READ_DIARY)).toBe(3);
        expect(logsShort(pack([[SM_ID.ASHES, 2]]), SM_STAGE.READ_DIARY)).toBe(1);
        expect(logsShort(pack([[SM_ID.ASHES, 2], [SM_ID.LOGS, 1]]), SM_STAGE.READ_DIARY)).toBe(0);
    });

    test('a made pyre log retires the spare', () => {
        expect(logsShort(pack([[SM_ID.SERUM3, 2], [SM_ID.PYRE_LOGS, 1]]), SM_STAGE.CREATED_PYRE_LOGS)).toBe(0);
    });

    // Why: the log is on the pyre by then, and asking for another sent the bot back across the swamp for it.
    test('a stacked pyre retires the spare too', () => {
        expect(logsShort(pack([[SM_ID.SERUM3, 2]]), SM_STAGE.LOGS_ON_PYRE)).toBe(0);
        expect(logsShort(pack([[SM_ID.SERUM3, 2]]), SM_STAGE.LIT_PYRE)).toBe(0);
    });
});
