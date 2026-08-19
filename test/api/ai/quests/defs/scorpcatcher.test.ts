import { describe, expect, test } from 'bun:test';

import { BARCRAWL_GP } from '#/bot/api/ai/quests/barcrawl/BarcrawlLogic.js';
import {
    ANTIPOISON_DOSES, ANTIPOISON_GP, CAGE_ID, SC_STAGE
} from '#/bot/api/ai/quests/defs/scorpcatcher/areas.js';
import { decide, scorpcatcher } from '#/bot/api/ai/quests/defs/scorpcatcher/index.js';
import type { QuestSnapshot, QuestStep } from '#/bot/api/ai/quests/engine/types.js';

interface Options {
    journal?: QuestSnapshot['journal'];
    stage?: number;
    noProgress?: boolean;
    invIds?: number[];
    bankIds?: number[];
    bankKnown?: boolean;
}

function idCounts(ids: number[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const id of ids) {
        out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
}

function snap(options: Options = {}): QuestSnapshot {
    return {
        journal: options.journal ?? 'inProgress',
        inv: new Map(),
        invIds: idCounts(options.invIds ?? []),
        worn: new Set(),
        wornIds: new Set(),
        noProgress: 0,
        bankCoins: 5000,
        progress: options.noProgress ? undefined : { stage: options.stage ?? SC_STAGE.FIRST_HINT, flags: new Set() },
        bank: new Map(),
        bankIds: idCounts(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        freeSlots: 20
    };
}

function talkTarget(step: QuestStep): string {
    return step.kind === 'talk' ? step.stop.npc : `(${step.kind})`;
}

describe('Scorpion Catcher decide', () => {
    test('a green journal is done', () => {
        expect(decide(snap({ journal: 'complete' })).kind).toBe('done');
    });

    test('an unloaded journal waits', () => {
        expect(decide(snap({ journal: 'unknown' })).kind).toBe('wait');
    });

    test('an unstarted quest walks to Thormac', () => {
        expect(talkTarget(decide(snap({ journal: 'notStarted' })))).toBe('Thormac');
    });

    test('an unread bank is scanned before the cage is called lost', () => {
        expect(decide(snap({ bankKnown: false })).kind).toBe('scanBank');
    });

    // Why: the engine banks spillover on the first pass of every quest, and a cage left in the bank is the caught scorpions left in the bank with it.
    test('a banked cage is withdrawn by its exact id', () => {
        const step = decide(snap({ bankIds: [CAGE_ID.AB] }));
        expect(step.kind).toBe('withdraw');
        expect(step.kind === 'withdraw' && step.items[0]?.id).toBe(CAGE_ID.AB);
    });

    test('no cage anywhere goes back to Thormac for another', () => {
        expect(talkTarget(decide(snap()))).toBe('Thormac');
    });

    test('a full cage is handed in to Thormac', () => {
        expect(talkTarget(decide(snap({ invIds: [CAGE_ID.FULL], stage: SC_STAGE.SECOND_HINT })))).toBe('Thormac');
    });

    // Why: the Seer's own leg drives the conversation, because `seer_looking_glass` shuts the chat and spends three `p_delay(3)` lines before reopening it.
    test('an empty cage before the first hint walks to the Seer', () => {
        const step = decide(snap({ invIds: [CAGE_ID.EMPTY], stage: SC_STAGE.STARTED }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toContain('Seer');
    });

    test('a missing journal stage waits rather than guessing', () => {
        expect(decide(snap({ invIds: [CAGE_ID.EMPTY], noProgress: true })).kind).toBe('wait');
    });

    test('an empty cage after the first hint catches the outpost scorpion first', () => {
        const step = decide(snap({ invIds: [CAGE_ID.EMPTY] }));
        expect(step.kind).toBe('custom');
        expect(step.kind === 'custom' && step.name).toContain('Barbarian Outpost');
    });

    test('a cage holding the outpost scorpion moves on to Taverley', () => {
        const step = decide(snap({ invIds: [CAGE_ID.B] }));
        expect(step.kind === 'custom' && step.name).toContain('Taverley');
    });

    test('a cage holding two moves on to the monastery', () => {
        const step = decide(snap({ invIds: [CAGE_ID.AB], stage: SC_STAGE.SECOND_HINT }));
        expect(step.kind === 'custom' && step.name).toContain('monastery');
    });

    // Why: a run that catches Taverley's scorpion first is legal — the cage's switch table takes them in any order — so the leg picker has to read the cage rather than a counter.
    test('a cage holding Taverley and the monastery goes back for the outpost', () => {
        const step = decide(snap({ invIds: [CAGE_ID.AC], stage: SC_STAGE.SECOND_HINT }));
        expect(step.kind === 'custom' && step.name).toContain('Barbarian Outpost');
    });
});

describe('Scorpion Catcher module', () => {
    test('it is the scorpcatcher record', () => {
        expect(scorpcatcher.record.id).toBe('scorpcatcher');
        expect(scorpcatcher.record.name).toBe('Scorpion Catcher');
    });

    // Why: the engine banks everything outside this list before the first step, and a deposited cage takes the caught scorpions with it.
    test('the cage and both keys survive the spillover deposit', () => {
        const tools = (scorpcatcher.tools ?? []).map(t => t.toLowerCase());
        expect(tools).toContain('scorpion cage');
        expect(tools).toContain('dusty key');
        expect(tools).toContain('jail key');
    });

    test('it carries food for the dragons between the gate and the coffins', () => {
        expect(scorpcatcher.food ?? 0).toBeGreaterThan(0);
    });

    // Why: a drink turns (3) into (2), so a keep-list naming only the bought dose banks the rest of the potion on the next spillover.
    test('every antipoison dose survives the spillover deposit', () => {
        const tools = (scorpcatcher.tools ?? []).map(t => t.toLowerCase());
        for (const dose of ANTIPOISON_DOSES) {
            expect(tools).toContain(dose.toLowerCase());
        }
    });

    test('the coin float covers the barcrawl and the Karamja trip together', () => {
        expect(scorpcatcher.coinFloat ?? 0).toBeGreaterThanOrEqual(BARCRAWL_GP + ANTIPOISON_GP);
    });
});
