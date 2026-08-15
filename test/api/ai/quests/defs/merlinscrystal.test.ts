import { describe, expect, test } from 'bun:test';

import { breadPlan } from '#/bot/api/ai/quests/defs/merlinscrystal.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';

function snap(coins: number): QuestSnapshot {
    return {
        journal: 'inProgress',
        inv: new Map(coins > 0 ? [['coins', coins]] : []),
        worn: new Set(),
        noProgress: 0,
        bankCoins: 0
    };
}

describe('breadPlan: Wydin buy (baker stall has no bread in rev 274)', () => {
    test('buys Bread from Wydin when funded', () => {
        const step = breadPlan(snap(100), 40, 0);
        expect(step.kind).toBe('buy');
        expect((step as { item: string }).item).toBe('Bread');
        expect((step as { shop: { npc: string } }).shop.npc).toBe('Wydin');
    });

    test('parks when broke (buyOrWait), never loops a bare buy', () => {
        const step = breadPlan(snap(0), 1, 0);
        expect(step.kind).toBe('wait');
    });
});
