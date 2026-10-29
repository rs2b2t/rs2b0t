import { describe, expect, test } from 'bun:test';

import { SHOP_DB } from '#/bot/data/shopdb.js';
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

describe('breadPlan', () => {
    test('buys Bread from a shop that restocks it', () => {
        const step = breadPlan(snap(100), 40, 0);
        expect(step.kind).toBe('buy');
        expect((step as { item: string }).item).toBe('Bread');
        expect((step as { shop: { npc: string } }).shop.npc).toBe('Baker');
        if (step.kind !== 'buy') throw new Error('expected a bread purchase');
        const shop = Object.values(SHOP_DB).find(shop => shop.keepers.includes(step.shop.npc));
        expect(shop?.items.find(item => item.name === 'Bread')?.baseline).toBeGreaterThan(0);
    });

    test('parks when broke (buyOrWait), never loops a bare buy', () => {
        const step = breadPlan(snap(0), 1, 0);
        expect(step.kind).toBe('wait');
    });
});
