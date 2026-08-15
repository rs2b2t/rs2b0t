import { describe, expect, test } from 'bun:test';

import { SOA_ID } from '#/bot/api/ai/quests/defs/shieldofarrav/areas.js';
import { blackarmStep } from '#/bot/api/ai/quests/defs/shieldofarrav/blackarm.js';
import { SOA_STAGE } from '#/bot/api/ai/quests/defs/shieldofarrav/journal.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const ALLEY = { x: 3208, z: 3391, level: 0 };
/** Inside the weapon store's ground-floor pocket, which only the store door leaves. */
const STORE_GROUND = { x: 3251, z: 3384, level: 0 };
/** The store's upper floor, where the crossbows spawn. */
const STORE_UPPER = { x: 3251, z: 3384, level: 1 };

function at(
    stage: number,
    flags: string[] = [],
    ids: [number, number][] = [],
    bankIds: [number, number][] = [],
    bankKnown = true
): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: new Map(ids),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 2_000_000,
        bank: new Map(),
        bankIds: new Map(bankIds),
        bankKnown,
        tile: ALLEY as QuestSnapshot['tile'],
        freeSlots: 20,
        stage,
        progress: { stage, flags: new Set(flags) }
    };
}

describe('black arm leg', () => {
    test('an unstarted quest talks to the Tramp', () => {
        expect(blackarmStep(at(SOA_STAGE.NOT_STARTED)))
            .toMatchObject({ kind: 'custom', name: 'ask the Tramp about the alley' });
    });

    test('after the Tramp, Katrine is approached', () => {
        expect(blackarmStep(at(SOA_STAGE.TRAMP_TOLD)))
            .toMatchObject({ kind: 'custom', name: 'ask Katrine to join the Black Arm Gang' });
    });

    // Why: the regression — decide() preferred the hand-in the moment the crossbows landed, and the raid step was the only thing that ever tried to leave, so a failed crossing read "no path to Katrine: unreachable" forever.
    test('crossbows held inside the store pocket leave before the hand-in', () => {
        const snap = at(SOA_STAGE.KATRINE_TASK, [], [[SOA_ID.CROSSBOW, 2]]);
        snap.tile = STORE_GROUND as QuestSnapshot['tile'];
        expect(blackarmStep(snap)).toMatchObject({ kind: 'custom', name: 'leave the weapon store' });
    });

    test('crossbows held upstairs in the store leave before the hand-in', () => {
        const snap = at(SOA_STAGE.KATRINE_TASK, [], [[SOA_ID.CROSSBOW, 2]]);
        snap.tile = STORE_UPPER as QuestSnapshot['tile'];
        expect(blackarmStep(snap)).toMatchObject({ kind: 'custom', name: 'leave the weapon store' });
    });

    // Why: the escape must not re-select once out, or the leg loops on a step that succeeds instantly.
    test('crossbows held outside the store hand in rather than leaving again', () => {
        expect(blackarmStep(at(SOA_STAGE.KATRINE_TASK, [], [[SOA_ID.CROSSBOW, 2]])))
            .toMatchObject({ name: 'hand the crossbows to Katrine' });
    });

    test('without the store key the leg waits rather than walking at a locked door', () => {
        const step = blackarmStep(at(SOA_STAGE.KATRINE_TASK));
        expect(step.kind).toBe('wait');
        expect((step as { reason: string }).reason).toContain('key');
    });

    test('a banked key is withdrawn rather than waited on', () => {
        const step = blackarmStep(at(SOA_STAGE.KATRINE_TASK, [], [], [[SOA_ID.STORE_KEY, 1]]));
        expect(step).toMatchObject({ kind: 'withdraw' });
        expect((step as { items: { id: number }[] }).items[0].id).toBe(SOA_ID.STORE_KEY);
    });

    test('an unread bank does not count as a banked key', () => {
        const step = blackarmStep(at(SOA_STAGE.KATRINE_TASK, [], [], [[SOA_ID.STORE_KEY, 1]], false));
        expect(step.kind).toBe('wait');
    });

    test('a held key outranks a banked one', () => {
        const step = blackarmStep(at(SOA_STAGE.KATRINE_TASK, [], [[SOA_ID.STORE_KEY, 1]], [[SOA_ID.STORE_KEY, 1]]));
        expect(step).toMatchObject({ kind: 'custom' });
    });

    test('with the store key the weapon store is raided', () => {
        expect(blackarmStep(at(SOA_STAGE.KATRINE_TASK, ['key-held'], [[SOA_ID.STORE_KEY, 1]])))
            .toMatchObject({ kind: 'custom' });
    });

    test('two crossbows go back to Katrine', () => {
        expect(blackarmStep(at(SOA_STAGE.KATRINE_TASK, ['crossbows-held'], [[SOA_ID.CROSSBOW, 2]])))
            .toMatchObject({ kind: 'custom', name: 'hand the crossbows to Katrine' });
    });

    test('one crossbow is not two — the raid continues', () => {
        const half = at(SOA_STAGE.KATRINE_TASK, ['key-held'], [[SOA_ID.STORE_KEY, 1], [SOA_ID.CROSSBOW, 1]]);
        expect(blackarmStep(half)).toMatchObject({ kind: 'custom' });
    });

    test('crossbows outrank the key: a hand-in never re-enters the store', () => {
        const both = at(SOA_STAGE.KATRINE_TASK, [], [[SOA_ID.STORE_KEY, 1], [SOA_ID.CROSSBOW, 2]]);
        expect(blackarmStep(both)).toMatchObject({ kind: 'custom', name: 'hand the crossbows to Katrine' });
    });

    test('a joined member without the half searches the cupboard', () => {
        expect(blackarmStep(at(SOA_STAGE.BLACKARM_JOINED))).toMatchObject({ kind: 'custom' });
    });

    test('a joined member holding the half asks for nothing more from this leg', () => {
        const step = blackarmStep(at(SOA_STAGE.BLACKARM_JOINED, ['own-half-only'], [[SOA_ID.SHIELD_BLACKARM, 1]]));
        expect(step.kind).toBe('wait');
    });

    test('a phoenix stage is not this leg and says so', () => {
        const step = blackarmStep(at(SOA_STAGE.KILL_JONNY));
        expect(step.kind).toBe('wait');
        expect((step as { reason: string }).reason).toContain('black arm leg');
    });
});
