import { describe, expect, test } from 'bun:test';

import { SOA_ID } from '#/bot/api/ai/quests/defs/shieldofarrav/areas.js';
import { SOA_STAGE } from '#/bot/api/ai/quests/defs/shieldofarrav/journal.js';
import { phoenixStep } from '#/bot/api/ai/quests/defs/shieldofarrav/phoenix.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const VARROCK = { x: 3210, z: 3490, level: 0 };

function at(stage: number, flags: string[] = [], ids: [number, number][] = []): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: new Map(ids),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(),
        bankIds: new Map(),
        bankKnown: true,
        tile: VARROCK as QuestSnapshot['tile'],
        freeSlots: 20,
        stage,
        progress: { stage, flags: new Set(flags) }
    };
}

describe('phoenix leg', () => {
    test('an unstarted quest talks to Reldo', () => {
        expect(phoenixStep(at(SOA_STAGE.NOT_STARTED))).toMatchObject({ kind: 'custom', name: 'ask Reldo for a quest' });
    });

    test('the book is checked out of the quest bookcase', () => {
        expect(phoenixStep(at(SOA_STAGE.TOLD_OF_BOOK))).toMatchObject({ kind: 'custom' });
    });

    test('a held book is read rather than re-taken', () => {
        expect(phoenixStep(at(SOA_STAGE.TOLD_OF_BOOK, [], [[SOA_ID.BOOK, 1]]))).toMatchObject({ kind: 'custom' });
    });

    test('after reading, Reldo names Baraek', () => {
        expect(phoenixStep(at(SOA_STAGE.READ_BOOK))).toMatchObject({ kind: 'custom', name: 'ask Reldo for a quest' });
    });

    test('the bribe is funded before Baraek is approached', () => {
        expect(phoenixStep(at(SOA_STAGE.SENT_TO_BARAEK))).toMatchObject({ kind: 'withdraw' });
    });

    test('nineteen coins is not twenty', () => {
        expect(phoenixStep(at(SOA_STAGE.SENT_TO_BARAEK, [], [[SOA_ID.COINS, 19]]))).toMatchObject({ kind: 'withdraw' });
    });

    test('with the bribe in the pack Baraek is approached', () => {
        expect(phoenixStep(at(SOA_STAGE.SENT_TO_BARAEK, [], [[SOA_ID.COINS, 500]])))
            .toMatchObject({ kind: 'custom', name: 'bribe Baraek for the hideout' });
    });

    test('the located hideout sends the bot to Straven', () => {
        expect(phoenixStep(at(SOA_STAGE.FIND_STRAVEN, [], [[SOA_ID.COINS, 480]])))
            .toMatchObject({ kind: 'custom', name: 'offer Straven your services' });
    });

    test('the mission stage kills Jonny while no report is held', () => {
        expect(phoenixStep(at(SOA_STAGE.KILL_JONNY))).toMatchObject({ kind: 'custom' });
    });

    test('a held report is handed to Straven', () => {
        expect(phoenixStep(at(SOA_STAGE.KILL_JONNY, [], [[SOA_ID.REPORT, 1]])))
            .toMatchObject({ kind: 'custom', name: 'hand the report to Straven' });
    });

    test('the journal flag alone is enough to hand in, before the pack has synced', () => {
        expect(phoenixStep(at(SOA_STAGE.KILL_JONNY, ['report-held'])))
            .toMatchObject({ kind: 'custom', name: 'hand the report to Straven' });
    });

    test('a joined member without the half searches the chest', () => {
        expect(phoenixStep(at(SOA_STAGE.PHOENIX_JOINED))).toMatchObject({ kind: 'custom' });
    });

    test('a joined member holding the half asks for nothing more from this leg', () => {
        const step = phoenixStep(at(SOA_STAGE.PHOENIX_JOINED, ['own-half-only'], [[SOA_ID.SHIELD_PHOENIX, 1]]));
        expect(step.kind).toBe('wait');
    });

    test('a black arm stage is not this leg and says so', () => {
        const step = phoenixStep(at(SOA_STAGE.KATRINE_TASK));
        expect(step.kind).toBe('wait');
        expect((step as { reason: string }).reason).toContain('phoenix leg');
    });
});
