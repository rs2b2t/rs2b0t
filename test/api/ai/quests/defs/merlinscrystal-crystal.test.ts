import { expect, test } from 'bun:test';
import { tryBreakCrystal } from '#/bot/api/ai/quests/defs/merlinscrystal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Locs, Loc } from '#/bot/api/locs/Locs.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { stubProps } from '../../../../lib/stubSingletons.js';

for (const outcome of ['delayed shatter', 'already freed', 'protected']) {
    test(`Merlin crystal: ${outcome}`, async () => {
        let used = false;
        let gone = false;
        let closed = false;
        let queried = '';
        const tile = { x: 2767, z: 3494, level: 2 };
        const query = Locs.query();
        const crystal = new Loc({ typecode: 0, id: 62, name: 'Giant crystal', tile, ops: [], distance: 1 });
        const sword = new InvItem({ id: 35, name: 'Excalibur', count: 1, slot: 0, comId: 3214, ops: [] });
        const restores = [
            stubProps(Game, { tile: () => tile }),
            stubProps(Traversal, { walkResilient: async () => true }),
            stubProps(reader, { npcs: () => [] }),
            stubProps(Inventory, { first: () => sword }),
            stubProps(sword, { useOn: async () => { used = true; return true; } }),
            stubProps(Locs, { query: () => query }),
            stubProps(query, {
                name: name => { queried = typeof name === 'string' ? name : ''; return query; },
                action: () => query, within: () => query,
                nearest: () => queried === 'Giant crystal' && gone ? null : crystal
            }),
            stubProps(ChatDialog, {
                texts: () => used && !closed && outcome === 'already freed'
                    ? ['You have already freed Merlin from the crystal.', 'Go and see King Arthur for your reward.'] : [],
                isOpen: () => used && !closed && outcome === 'already freed',
                canContinue: () => used && !closed && outcome === 'already freed',
                continue: async () => { closed = true; return true; }
            }),
            stubProps(Execution, {
                delayTicks: async () => {},
                delayUntil: async check => {
                    if (check()) return true;
                    if (used && outcome === 'delayed shatter') gone = true;
                    return check();
                }
            })
        ];
        try {
            expect(await tryBreakCrystal(() => {})).toBe(outcome === 'protected' ? 'need-summon' : 'broke');
            if (outcome === 'already freed') expect(closed).toBe(true);
        } finally {
            for (const restore of restores.reverse()) restore();
        }
    });
}
