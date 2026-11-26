import { expect, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { readCard } from '#/bot/api/ai/quests/barcrawl/RunBarcrawl.js';
import { BARCRAWL_CARD } from '#/bot/api/ai/quests/barcrawl/BarcrawlLogic.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

test('a completed card answers the first Read without opening a scroll', async () => {
    const card = new InvItem({ id: 1, name: BARCRAWL_CARD, count: 1, slot: 0, comId: 3214, ops: [] });
    let reads = 0;
    const restores = [
        stubProps(reader, { modals: () => ({ main: -1, side: -1, chat: -1 }) }),
        stubProps(Inventory, { first: () => card }),
        stubProps(card, { interact: async () => { reads++; return true; } }),
        stubProps(GameMessages, { sawSince: () => reads > 0 }),
        stubProps(Execution, { delayUntil: async check => check(), delayTicks: async () => {} })
    ];
    try {
        expect(await readCard()).toEqual({ remaining: [], done: true });
        expect(reads).toBe(1);
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});
