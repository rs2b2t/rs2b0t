import { expect, test } from 'bun:test';
import { decide } from '#/bot/api/ai/quests/defs/merlinscrystal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Loc, Locs } from '#/bot/api/locs/Locs.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../../../lib/stubSingletons.js';
import { DelayedDialogue } from './delayed-dialogue.fixture.js';

for (const mode of ['first test', 'beggar respawn', 'no sword option', 'delayed Lady test'] as const) {
    test(`Merlin Excalibur: ${mode}`, async () => {
        let tile = new Tile(2924, 3405, 0);
        const dialogue = new DelayedDialogue();
        let accepted = false;
        let beggar = false;
        let sword = false;
        let doorOpened = false;
        const door = new Loc({ typecode: 0, id: 59, name: 'Door', tile: new Tile(3016, 3246, 0), ops: ['Open'], distance: 1 });
        const query = Locs.query();
        const restores = [
            stubProps(Game, { tile: () => tile }),
            stubProps(Inventory, { contains: name => name === 'Excalibur' ? sword : name === 'Bread' }),
            stubProps(reader, { npcs: () => [
                { index: 1, id: 250, name: 'The Lady of the Lake', tile: new Tile(2924, 3405, 0), ops: ['Talk-to'], distance: 1, level: 0, size: 1, anim: -1, inCombat: false, health: 100, totalHealth: 100, faceEntity: -1 },
                ...(beggar ? [{ index: 2, id: 252, name: 'Beggar', tile, ops: ['Talk-to'], distance: 1, level: 0, size: 1, anim: -1, inCombat: false, health: 100, totalHealth: 100, faceEntity: -1 }] : [])
            ] }),
            stubProps(Reach, { entityOp: async options => {
                dialogue.page = options.what === 'Beggar' ? 'beggar' : mode === 'delayed Lady test' ? 'greeting' : 'lady';
                return 'done';
            } }),
            stubProps(Traversal, { walkResilient: async dest => { tile = Tile.from(dest); return true; } }),
            stubProps(Locs, { query: () => query }),
            stubProps(query, { name: () => query, action: () => query, within: () => query, nearest: () => door }),
            stubProps(door, { interact: async () => {
                doorOpened = true;
                beggar = accepted;
                dialogue.page = accepted && mode !== 'beggar respawn' ? 'beggar' : '';
                return true;
            } }),
            stubProps(ChatDialog, {
                isOpen: () => !!dialogue.page,
                canContinue: () => dialogue.page === 'greeting',
                continue: async () => { dialogue.page = ''; dialogue.pending = 'lady'; return true; },
                options: () => dialogue.page === 'lady'
                    ? mode === 'no sword option' ? ['Who are you?', 'Good day.'] : ['I seek the sword Excalibur.']
                    : dialogue.page === 'beggar' ? ['Yes certainly.', "No I don't have any bread with me."] : [],
                chooseOption: async option => {
                    if (dialogue.page === 'lady' && option === 'I seek the sword Excalibur.') accepted = true;
                    if (dialogue.page === 'beggar' && option === 'Yes certainly.') sword = true;
                    dialogue.page = '';
                    return true;
                }
            }),
            dialogue.stubExecution()
        ];
        try {
            const step = decide({ journal: 'inProgress', stage: 4, inv: new Map([['lit black candle', 1], ['bat bones', 1], ['bread', 1]]), worn: new Set(), bankKnown: true, bank: new Map(), bankCoins: 0, noProgress: 0 });
            if (step.kind !== 'custom') throw new Error('expected Excalibur step');
            expect(await step.run(() => {})).toBe(mode !== 'no sword option');
            expect(sword).toBe(mode !== 'no sword option');
            expect(doorOpened).toBe(mode !== 'no sword option');
        } finally {
            for (const restore of restores.reverse()) restore();
        }
    });
}
