import { describe, expect, test } from 'bun:test';

import { NS_ID, NS_STAGE } from '#/bot/api/ai/quests/defs/druidspirit/areas.js';
import { amulet, sickleStep } from '#/bot/api/ai/quests/defs/druidspirit/supplies.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

const MAX_MINING = 99;
const BRONZE_PICKAXE = 1265;

function snap(options: {
    invIds?: [number, number][];
    bankIds?: [number, number][];
    bankKnown?: boolean;
    wornIds?: number[];
} = {}): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(),
        invIds: new Map(options.invIds ?? []),
        worn: new Set(),
        wornIds: new Set(options.wornIds ?? []),
        noProgress: 0,
        bankCoins: 2_000_000,
        stage: NS_STAGE.STARTED,
        progress: { stage: NS_STAGE.STARTED, flags: new Set() },
        bank: new Map(),
        bankIds: new Map(options.bankIds ?? []),
        bankKnown: options.bankKnown ?? true,
        tile: { x: 3253, z: 3420, level: 0 },
        freeSlots: 20
    };
}

describe('nature spirit amulet', () => {
    test('a worn amulet needs nothing', () => {
        expect(amulet(snap({ wornIds: [NS_ID.GHOSTSPEAK] }))).toBeNull();
    });

    test('a held amulet is equipped rather than fetched', () => {
        expect(amulet(snap({ invIds: [[NS_ID.GHOSTSPEAK, 1]] }))).toEqual({ kind: 'equip', item: 'Ghostspeak amulet' });
    });

    test('a banked amulet is withdrawn before Urhney is walked to', () => {
        expect(amulet(snap({ bankIds: [[NS_ID.GHOSTSPEAK, 1]] })))
            .toEqual({ kind: 'withdraw', items: [{ name: 'Ghostspeak amulet', qty: 1, id: NS_ID.GHOSTSPEAK }] });
    });

    test('an unread bank is scanned before concluding the amulet is gone', () => {
        expect(amulet(snap({ bankKnown: false }))).toEqual({ kind: 'scanBank' });
    });

    test('with no amulet anywhere, Urhney re-issues one', () => {
        const step = amulet(snap());
        expect(step?.kind).toBe('talk');
        expect(step?.kind === 'talk' && step.stop.npc).toBe('Father Urhney');
    });
});

describe('nature spirit sickle chain', () => {
    test('a blessed sickle ends the chain', () => {
        expect(sickleStep(snap({ invIds: [[NS_ID.SICKLE_BLESSED, 1]] }), MAX_MINING)).toBeNull();
    });

    test('a plain sickle ends the chain too — the grotto blesses it', () => {
        expect(sickleStep(snap({ invIds: [[NS_ID.SICKLE, 1]] }), MAX_MINING)).toBeNull();
    });

    test('an unread bank is scanned first', () => {
        expect(sickleStep(snap({ bankKnown: false }), MAX_MINING)).toEqual({ kind: 'scanBank' });
    });

    test('a banked sickle beats buying a mould', () => {
        expect(sickleStep(snap({ bankIds: [[NS_ID.SICKLE, 1]] }), MAX_MINING))
            .toEqual({ kind: 'withdraw', items: [{ name: 'Silver sickle', qty: 1, id: NS_ID.SICKLE }] });
    });

    test('no mould held sends the bot to Dommik', () => {
        const step = sickleStep(snap(), MAX_MINING);
        expect(step?.kind).toBe('buy');
        expect(step?.kind === 'buy' && step.shop.npc).toBe('Dommik');
    });

    test('a banked mould is withdrawn rather than bought again', () => {
        expect(sickleStep(snap({ bankIds: [[NS_ID.MOULD, 1]] }), MAX_MINING))
            .toEqual({ kind: 'withdraw', items: [{ name: 'Sickle mould', qty: 1, id: NS_ID.MOULD }] });
    });

    test('a mould and no silver buys a pickaxe from Bob rather than walking to Rimmington', () => {
        const step = sickleStep(snap({ invIds: [[NS_ID.MOULD, 1]] }), MAX_MINING);
        expect(step?.kind).toBe('buy');
        expect(step?.kind === 'buy' && step.shop.npc).toBe('Bob');
        expect(step?.kind === 'buy' && step.item).toBe('Bronze pickaxe');
    });

    test('a banked pickaxe beats buying one', () => {
        const step = sickleStep(snap({ invIds: [[NS_ID.MOULD, 1]], bankIds: [[BRONZE_PICKAXE, 1]] }), MAX_MINING);
        expect(step?.kind).toBe('withdraw');
    });

    test('a mould and a pickaxe mine silver', () => {
        const step = sickleStep(snap({ invIds: [[NS_ID.MOULD, 1], [BRONZE_PICKAXE, 1]] }), MAX_MINING);
        expect(step?.kind).toBe('mineRock');
        expect(step?.kind === 'mineRock' && step.rock).toBe('Silver');
    });

    test('mould and ore smelt a bar', () => {
        const step = sickleStep(snap({ invIds: [[NS_ID.MOULD, 1], [NS_ID.SILVER_ORE, 1]] }), MAX_MINING);
        expect(step?.kind).toBe('custom');
        expect(step?.kind === 'custom' && step.name).toBe('smelt a silver bar');
    });

    test('mould and bar cast the sickle', () => {
        const step = sickleStep(snap({ invIds: [[NS_ID.MOULD, 1], [NS_ID.SILVER_BAR, 1]] }), MAX_MINING);
        expect(step?.kind).toBe('custom');
        expect(step?.kind === 'custom' && step.name).toBe('cast the silver sickle');
    });

    test('a banked bar is withdrawn rather than mined for', () => {
        expect(sickleStep(snap({ invIds: [[NS_ID.MOULD, 1]], bankIds: [[NS_ID.SILVER_BAR, 1]] }), MAX_MINING))
            .toEqual({ kind: 'withdraw', items: [{ name: 'Silver bar', qty: 1, id: NS_ID.SILVER_BAR }] });
    });
});
