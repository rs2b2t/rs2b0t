import { expect, test } from 'bun:test';
import { readScroll } from '#/bot/api/ai/quests/defs/shilo/ahzarhoon.js';
import { SV_ITEM } from '#/bot/api/ai/quests/defs/shilo/areas.js';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

for (const item of [SV_ITEM.TATTERED_SCROLL, SV_ITEM.CRUMPLED_SCROLL]) {
    for (const mode of ['delayed choice', 'refused read', 'dropped first read', 'pending journal close'] as const) {
        test(`Shilo ${item.name}: ${mode}`, async () => {
            let page = '';
            let dispatches = 0;
            let gap = 0;
            let main = -1;
            let read = false;
            let now = 0;
            const scroll = new InvItem({ id: item.id, name: item.name, count: 1, slot: 0, comId: 3214, ops: ['Read'] });
            const restores = [
                stubProps(performance, { now: () => now }),
                stubProps(Inventory, { items: () => [scroll] }),
                stubProps(scroll, { interact: async op => { expect(op).toBe('Read'); if (mode === 'pending journal close' && now > 0 || mode === 'delayed choice' || mode === 'dropped first read' && ++dispatches > 1) page = 'intro'; return true; } }),
                stubProps(reader, { modals: () => ({ main, chat: page ? 1 : -1, side: -1 }) }),
                stubProps(actions, { closeModal: () => { main = -1; return true; } }),
                stubProps(ChatDialog, {
                    isOpen: () => !!page,
                    canContinue: () => page === 'intro',
                    options: () => page === 'choice' ? ['Yes please.', 'No thanks.'] : [],
                    continue: async () => { page = ''; gap = 2; return true; },
                    chooseOption: async option => {
                        if (option === 'Yes please.') { read = true; main = 2200; }
                        page = '';
                        return true;
                    }
                }),
                stubProps(Execution, {
                    delayTicks: async ticks => { now += ticks * 600; if (gap > 0 && --gap === 0) page = 'choice'; },
                    delayUntil: async check => check()
                })
            ];
            try {
                expect(await readScroll(item.id)(() => {})).toBe(mode !== 'refused read');
                expect(read).toBe(mode !== 'refused read');
                expect(main).toBe(-1);
            } finally {
                for (const restore of restores.reverse()) restore();
            }
        });
    }
}
