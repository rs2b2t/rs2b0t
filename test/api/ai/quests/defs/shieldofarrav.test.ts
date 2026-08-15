import { afterEach, describe, expect, test } from 'bun:test';

import { QUESTS } from '#/bot/api/ai/quests/data/quests.js';
import { QUEST_DEFS, defById } from '#/bot/api/ai/quests/defs/index.js';
import { SOA_ID } from '#/bot/api/ai/quests/defs/shieldofarrav/areas.js';
import { ArravConfig } from '#/bot/api/ai/quests/defs/shieldofarrav/config.js';
import { decide, resetGangCache, shieldofarrav } from '#/bot/api/ai/quests/defs/shieldofarrav/index.js';
import { SOA_STAGE } from '#/bot/api/ai/quests/defs/shieldofarrav/journal.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const VARROCK = { x: 3210, z: 3490, level: 0 };

function snap(over: Partial<QuestSnapshot> = {}): QuestSnapshot {
    const stage = over.stage ?? SOA_STAGE.NOT_STARTED;
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: new Map(),
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
        progress: { stage, flags: new Set() },
        ...over
    };
}

function withGang(gang: 'phoenix' | 'blackarm'): void {
    ArravConfig.gang = gang;
    resetGangCache();
}

afterEach(() => {
    ArravConfig.gang = 'random';
    ArravConfig.partner = '';
    ArravConfig.certTarget = 2;
    resetGangCache();
});

describe('shield of arrav decide', () => {
    test('an unloaded journal waits rather than restarting a finished quest', () => {
        expect(decide(snap({ journal: 'unknown' }))).toMatchObject({ kind: 'wait' });
    });

    test('a green journal is done', () => {
        expect(decide(snap({ journal: 'complete' }))).toMatchObject({ kind: 'done' });
    });

    test('an unreadable stage waits', () => {
        expect(decide(snap({ stage: undefined, progress: undefined }))).toMatchObject({ kind: 'wait' });
    });

    // Why: ownsInventory skips the engine's provisioning, so nothing else opens a booth and a banked certificate or key stays invisible.
    test('an unread bank is scanned before anything else is decided', () => {
        withGang('phoenix');
        expect(decide(snap({ bankKnown: false }))).toMatchObject({ kind: 'scanBank' });
    });

    test('the scan happens once — a read bank falls straight through to the quest', () => {
        withGang('phoenix');
        expect(decide(snap({ bankKnown: true })).kind).not.toBe('scanBank');
    });

    test('a held certificate outranks every gang leg', () => {
        withGang('phoenix');
        const s = snap({
            stage: SOA_STAGE.PHOENIX_JOINED,
            progress: { stage: SOA_STAGE.PHOENIX_JOINED, flags: new Set() },
            invIds: new Map([[SOA_ID.CERTIFICATE, 1]])
        });
        expect(decide(s)).toMatchObject({ kind: 'custom' });
    });

    test('both halves outrank a partner handoff', () => {
        withGang('phoenix');
        ArravConfig.partner = 'Someone';
        const s = snap({
            stage: SOA_STAGE.PHOENIX_JOINED,
            progress: { stage: SOA_STAGE.PHOENIX_JOINED, flags: new Set() },
            invIds: new Map([[SOA_ID.SHIELD_PHOENIX, 1], [SOA_ID.SHIELD_BLACKARM, 1]])
        });
        expect(decide(s)).toMatchObject({ kind: 'custom' });
    });

    test('a handoff outranks the gang leg', () => {
        withGang('phoenix');
        ArravConfig.partner = 'Someone';
        const s = snap({
            stage: SOA_STAGE.PHOENIX_JOINED,
            progress: { stage: SOA_STAGE.PHOENIX_JOINED, flags: new Set() },
            invIds: new Map([[SOA_ID.STORE_KEY, 1]])
        });
        expect(decide(s)).toMatchObject({ kind: 'custom' });
    });

    test('the phoenix setting runs the phoenix leg', () => {
        withGang('phoenix');
        expect(decide(snap())).toMatchObject({ kind: 'custom' });
    });

    test('the black arm setting runs the black arm leg', () => {
        withGang('blackarm');
        expect(decide(snap())).toMatchObject({ kind: 'custom' });
    });

    test('the module is registered and reachable by id', () => {
        expect(QUEST_DEFS).toContain(shieldofarrav);
        expect(defById('blackarmgang')).toBe(shieldofarrav);
    });

    test('the record it claims is the one in the data table', () => {
        expect(shieldofarrav.record).toBe(QUESTS.find(r => r.id === 'blackarmgang')!);
        expect(shieldofarrav.record.name).toBe('Shield of Arrav');
        expect(shieldofarrav.record.questPoints).toBe(1);
    });

    test('the module owns its inventory and keeps coins for the bribe', () => {
        expect(shieldofarrav.ownsInventory).toBe(true);
        expect(shieldofarrav.tools).toContain('coins');
    });

    test('every acquirable record item has a gather entry', () => {
        for (const item of shieldofarrav.record.items) {
            if (item.kind === 'acquirable') {
                expect(shieldofarrav.gather?.[item.name.toLowerCase()]).toBeDefined();
            }
        }
    });

    test('a partnerless account is warned before it starts, not after it parks', () => {
        ArravConfig.partner = '';
        expect(shieldofarrav.warnReadiness?.()).toContain('partner');
        ArravConfig.partner = 'Someone';
        expect(shieldofarrav.warnReadiness?.()).toBeNull();
    });

    test('the hops cover the hideout, which nothing walks into', () => {
        expect(shieldofarrav.hops?.length).toBeGreaterThan(0);
        expect(shieldofarrav.hops?.some(h => h.arrive.z > 6400)).toBe(true);
        expect(shieldofarrav.hops?.some(h => h.stand.z > 6400)).toBe(true);
    });
});
