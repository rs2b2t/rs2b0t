import { expect, test } from 'bun:test';
import { gambleWithHarold } from '#/bot/api/ai/quests/defs/deathplateau/harold.js';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

test('never submits a stake without confirming the second drink', async () => {
    let stakes = 0;
    const restores = [
        stubProps(Game, { tile: () => ({ x: 2905, z: 3539, level: 1 }) }),
        stubProps(Inventory, { items: () => [], count: () => 500 }),
        stubProps(ChatDialog, { isOpen: () => true }),
        stubProps(reader, { countDialogOpen: () => true, modals: () => ({ main: -1, chat: -1, side: -1 }) }),
        stubProps(actions, { answerCountDialog: () => { stakes++; return false; } })
    ];
    try {
        expect(await gambleWithHarold(() => {})).toBe(false);
        expect(stakes).toBe(0);
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});

for (const id of [2028, 2064]) {
    test(`confirms consumption of cocktail ${id}`, async () => {
        const { giveBlurberryToHarold } = await import('#/bot/api/ai/quests/defs/deathplateau/harold.js');
        const { Execution } = await import('#/bot/api/execution/Execution.js');
        const { InvItem } = await import('#/bot/api/inventory/Inventory.js');
        let phase = 'menu';
        let held = true;
        let box = false;
        const item = new InvItem({ id, count: 1, name: 'Blurberry special', slot: 0, comId: 3214, ops: [] });
        const restores = [
            stubProps(Game, { tile: () => ({ x: 2905, z: 3539, level: 1 }) }),
            stubProps(Inventory, { items: () => held ? [item] : [] }),
            stubProps(ChatDialog, {
                isOpen: () => phase !== 'closed' && phase !== 'box', canContinue: () => phase === 'confirm' || phase === 'drunk',
                options: () => phase === 'menu' ? ['Can I buy you a drink?'] : [], texts: () => phase === 'drunk' ? ['Now THAT hit the spot!'] : [],
                chooseOption: async () => { phase = 'confirm'; return true; },
                continue: async () => { if (phase === 'confirm') { held = false; box = true; phase = 'box'; } else phase = 'closed'; return true; }
            }),
            stubProps(Modals, { isOpen: () => box, close: async () => { box = false; phase = 'drunk'; return true; } }),
            stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => check() })
        ];
        try {
            expect(await giveBlurberryToHarold(() => {})).toBe(true);
            expect(held).toBe(false);
            expect(box).toBe(false);
        } finally {
            for (const restore of restores.reverse()) restore();
        }
    });
}

test('recognizes an already drunk Harold after a restarted run', async () => {
    const { giveBlurberryToHarold } = await import('#/bot/api/ai/quests/defs/deathplateau/harold.js');
    const { Execution } = await import('#/bot/api/execution/Execution.js');
    const { InvItem } = await import('#/bot/api/inventory/Inventory.js');
    let open = true;
    const item = new InvItem({ id: 2028, count: 1, name: 'Blurberry special', slot: 0, comId: 3214, ops: [] });
    const restores = [
        stubProps(Game, { tile: () => ({ x: 2905, z: 3539, level: 1 }) }),
        stubProps(Inventory, { items: () => [item] }),
        stubProps(ChatDialog, {
            isOpen: () => open, canContinue: () => open, options: () => [],
            texts: () => open ? ["I fink I've had enough!"] : [],
            continue: async () => { open = false; return true; }
        }),
        stubProps(Modals, { isOpen: () => false }),
        stubProps(Execution, { delayTicks: async () => {}, delayUntil: async check => check() })
    ];
    try {
        expect(await giveBlurberryToHarold(() => {})).toBe(true);
        expect(open).toBe(false);
    } finally {
        for (const restore of restores.reverse()) restore();
    }
});
