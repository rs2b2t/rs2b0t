import { expect, test } from 'bun:test';
import { realmLeg } from '#/bot/api/ai/quests/defs/holygrail/legs.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../../../lib/stubSingletons.js';
import { DelayedDialogue } from './delayed-dialogue.fixture.js';

for (const mode of ['maiden answers', 'maiden moved away'] as const) {
    test(`Holy Grail bell verifies the castle teleport: ${mode}`, async () => {
        let tile = new Tile(2741, 3235, 0);
        const dialogue = new DelayedDialogue();
        const bell = new InvItem({ id: 17, name: 'Grail bell', count: 1, slot: 0, comId: 3214, ops: ['Ring'] });
        const restores = [
            stubProps(Game, { tile: () => tile }),
            stubProps(Inventory, { contains: name => name === 'Grail bell', first: name => name === 'Grail bell' ? bell : null }),
            stubProps(bell, { interact: async op => { expect(op).toBe('Ring'); dialogue.page = 'ring'; return true; } }),
            stubProps(reader, { npcs: () => [{ index: 1, id: 224, name: 'Grail Maiden', tile: new Tile(2761, 4690, 0), ops: ['Talk-to'], distance: 4, level: 0, size: 1, anim: -1, inCombat: false, health: 1, totalHealth: 1, faceEntity: -1 }] }),
            stubProps(ChatDialog, {
                isOpen: () => !!dialogue.page,
                canContinue: () => !!dialogue.page,
                options: () => [],
                continue: async () => {
                    if (dialogue.page === 'ring' && mode === 'maiden answers') dialogue.pending = 'welcome';
                    if (dialogue.page === 'welcome') tile = new Tile(2761, 4692, 0);
                    dialogue.page = '';
                    return true;
                }
            }),
            stubProps(Modals, { closeIfOpen: async () => {} }),
            dialogue.stubExecution()
        ];
        try {
            await realmLeg(() => {});
            tile = new Tile(2762, 4694, 0);
            expect(await realmLeg(() => {})).toBe(mode === 'maiden answers');
            expect(tile.z).toBe(mode === 'maiden answers' ? 4692 : 4694);
        } finally {
            tile = new Tile(2741, 3235, 0);
            await realmLeg(() => {});
            for (const restore of restores.reverse()) restore();
        }
    });
}
