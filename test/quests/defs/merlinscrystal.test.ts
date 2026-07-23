import { describe, expect, test } from 'bun:test';

import { breadPlan } from '#/bot/quests/defs/merlinscrystal.js';
import type { QuestSnapshot } from '#/bot/quests/engine/types.js';

function snap(coins: number): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(coins > 0 ? [['coins', coins]] : []),
        worn: new Set(),
        noProgress: 0,
        bankCoins: 0
    };
}

describe('breadPlan priority: steal before buy', () => {
    test('thieving 5+ with passes left -> steal from the stall', () => {
        const step = breadPlan(snap(100), 5, 0);
        expect(step.kind).toBe('custom');
        expect((step as { name: string }).name).toContain("steal Bread from the Baker's stall");
    });

    test('thieving too low -> falls through to the Wydin buy', () => {
        const step = breadPlan(snap(100), 1, 0);
        expect(step.kind).toBe('buy');
        expect((step as { item: string }).item).toBe('Bread');
        expect((step as { shop: { npc: string } }).shop.npc).toBe('Wydin');
    });

    test('steal passes exhausted -> concedes to the buy', () => {
        const step = breadPlan(snap(100), 40, 3);
        expect(step.kind).toBe('buy');
    });

    test('buy fallback on a broke account parks (buyOrWait), never loops a bare buy', () => {
        const step = breadPlan(snap(0), 1, 0);
        expect(step.kind).toBe('wait');
    });
});
