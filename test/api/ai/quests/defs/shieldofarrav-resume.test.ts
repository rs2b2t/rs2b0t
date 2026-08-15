import { afterEach, describe, expect, test } from 'bun:test';

import { SOA_ID } from '#/bot/api/ai/quests/defs/shieldofarrav/areas.js';
import { ArravConfig } from '#/bot/api/ai/quests/defs/shieldofarrav/config.js';
import { decide, resetGangCache } from '#/bot/api/ai/quests/defs/shieldofarrav/index.js';
import { SOA_STAGE } from '#/bot/api/ai/quests/defs/shieldofarrav/journal.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const VARROCK = { x: 3210, z: 3490, level: 0 };

type State = [label: string, stage: number, flags: string[], ids: [number, number][]];

/** Every state the Phoenix path can be interrupted in, from the journal's own branches. */
const PHOENIX_STATES: State[] = [
    ['not started', SOA_STAGE.NOT_STARTED, [], []],
    ['told of the book', SOA_STAGE.TOLD_OF_BOOK, [], []],
    ['book in the pack', SOA_STAGE.TOLD_OF_BOOK, [], [[SOA_ID.BOOK, 1]]],
    ['book read', SOA_STAGE.READ_BOOK, [], [[SOA_ID.BOOK, 1]]],
    ['sent to Baraek, broke', SOA_STAGE.SENT_TO_BARAEK, [], []],
    ['sent to Baraek, funded', SOA_STAGE.SENT_TO_BARAEK, [], [[SOA_ID.COINS, 500]]],
    ['hideout located', SOA_STAGE.FIND_STRAVEN, [], [[SOA_ID.COINS, 480]]],
    ['mission set, no report', SOA_STAGE.KILL_JONNY, [], []],
    ['report held', SOA_STAGE.KILL_JONNY, ['report-held'], [[SOA_ID.REPORT, 1]]],
    ['joined, empty handed', SOA_STAGE.PHOENIX_JOINED, [], [[SOA_ID.STORE_KEY, 1]]],
    ['joined, own half', SOA_STAGE.PHOENIX_JOINED, ['own-half-only'], [[SOA_ID.SHIELD_PHOENIX, 1]]],
    ['joined, both halves', SOA_STAGE.PHOENIX_JOINED, ['both-halves'], [[SOA_ID.SHIELD_PHOENIX, 1], [SOA_ID.SHIELD_BLACKARM, 1]]],
    ['joined, two certificates', SOA_STAGE.PHOENIX_JOINED, ['two-certificates'], [[SOA_ID.CERTIFICATE, 2]]],
    ['joined, one certificate', SOA_STAGE.PHOENIX_JOINED, ['certificate'], [[SOA_ID.CERTIFICATE, 1]]]
];

const BLACKARM_STATES: State[] = [
    ['not started', SOA_STAGE.NOT_STARTED, [], []],
    ['tramp told', SOA_STAGE.TRAMP_TOLD, [], []],
    ['task set, key held', SOA_STAGE.KATRINE_TASK, ['key-held'], [[SOA_ID.STORE_KEY, 1]]],
    ['task set, one crossbow', SOA_STAGE.KATRINE_TASK, ['key-held'], [[SOA_ID.STORE_KEY, 1], [SOA_ID.CROSSBOW, 1]]],
    ['task set, both crossbows', SOA_STAGE.KATRINE_TASK, ['crossbows-held'], [[SOA_ID.CROSSBOW, 2]]],
    ['joined, empty handed', SOA_STAGE.BLACKARM_JOINED, [], []],
    ['joined, own half', SOA_STAGE.BLACKARM_JOINED, ['own-half-only'], [[SOA_ID.SHIELD_BLACKARM, 1]]],
    ['joined, one certificate', SOA_STAGE.BLACKARM_JOINED, ['certificate'], [[SOA_ID.CERTIFICATE, 1]]]
];

function snap(stage: number, flags: string[], ids: [number, number][]): QuestSnapshot {
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

function stalled(states: State[]): string[] {
    return states
        .filter(([, stage, flags, ids]) => decide(snap(stage, flags, ids)).kind === 'wait')
        .map(([label]) => label);
}

afterEach(() => {
    ArravConfig.gang = 'random';
    ArravConfig.partner = '';
    ArravConfig.certTarget = 2;
    resetGangCache();
});

describe('shield of arrav resumes from every reachable state', () => {
    test('the phoenix path never stalls when a partner is configured', () => {
        ArravConfig.gang = 'phoenix';
        ArravConfig.partner = 'Partner';
        resetGangCache();
        expect(stalled(PHOENIX_STATES)).toEqual([]);
    });

    test('the black arm path never stalls when a partner is configured', () => {
        ArravConfig.gang = 'blackarm';
        ArravConfig.partner = 'Partner';
        resetGangCache();
        expect(stalled(BLACKARM_STATES)).toEqual([]);
    });

    test('a partnerless phoenix bot runs its whole path unaided, up to holding its own half', () => {
        ArravConfig.gang = 'phoenix';
        ArravConfig.partner = '';
        resetGangCache();
        const upToOwnHalf = PHOENIX_STATES.filter(([label]) => label !== 'joined, own half');
        expect(stalled(upToOwnHalf)).toEqual([]);
    });

    // Why: the other half exists only in the rival gang's hideout, which this character can never enter.
    test('a partnerless phoenix bot holding its own half says what it is missing', () => {
        ArravConfig.gang = 'phoenix';
        ArravConfig.partner = '';
        resetGangCache();
        const step = decide(snap(SOA_STAGE.PHOENIX_JOINED, ['own-half-only'], [[SOA_ID.SHIELD_PHOENIX, 1]]));
        expect(step.kind).toBe('wait');
        expect((step as { reason: string }).reason).toContain('half');
    });

    // Why: this is the one honest dead end — the crossbows sit behind a door only Straven's key opens, and joining Phoenix makes Katrine refuse you.
    test('a partnerless black arm bot on the crossbow task says why it is stuck', () => {
        ArravConfig.gang = 'blackarm';
        ArravConfig.partner = '';
        resetGangCache();
        const step = decide(snap(SOA_STAGE.KATRINE_TASK, [], []));
        expect(step.kind).toBe('wait');
        expect((step as { reason: string }).reason).toContain('key');
    });

    test('a banked certificate lets a partnerless bot finish', () => {
        ArravConfig.gang = 'phoenix';
        ArravConfig.partner = '';
        resetGangCache();
        const s = snap(SOA_STAGE.PHOENIX_JOINED, [], []);
        s.bankIds = new Map([[SOA_ID.CERTIFICATE, 2]]);
        expect(decide(s)).toMatchObject({ kind: 'withdraw' });
    });

    test('a complete journal is done from any inventory', () => {
        ArravConfig.gang = 'phoenix';
        resetGangCache();
        for (const [, stage, flags, ids] of PHOENIX_STATES) {
            const s = snap(stage, flags, ids);
            s.journal = 'complete';
            expect(decide(s)).toMatchObject({ kind: 'done' });
        }
    });

    test('a random gang is stable across every state in one run', () => {
        ArravConfig.gang = 'random';
        ArravConfig.partner = 'Partner';
        resetGangCache();
        const first = decide(snap(SOA_STAGE.NOT_STARTED, [], []));
        for (let i = 0; i < 10; i++) {
            expect(decide(snap(SOA_STAGE.NOT_STARTED, [], []))).toMatchObject({ kind: first.kind });
        }
    });
});
