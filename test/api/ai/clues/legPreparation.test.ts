import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import * as Tools from '#/bot/api/ai/clues/AcquireTools.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';

const item = (id: number, name: string, count = 1): InvItemSnapshot => ({ id, name, count, slot: 0, comId: 3214, ops: ['Dig'] });
let pack: InvItemSnapshot[];
let pending: boolean;
beforeEach(() => {
    ClueExecutor.resetSession();
    Sustain.set(null);
    pending = false;
    pack = [];
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'equipment').mockReturnValue([{ ...item(1305, 'Dragon longsword'), slot: 3 }]);
    spyOn(Skills, 'level').mockReturnValue(75);
    spyOn(Skills, 'effective').mockReturnValue(75);
    spyOn(Quests, 'status').mockReturnValue('complete');
    spyOn(Game, 'tile').mockReturnValue(new Tile(2987, 3963, 0));
    spyOn(EventSignal, 'pending').mockImplementation(() => pending);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    spyOn(reader, 'countDialogOpen').mockReturnValue(false);
    spyOn(Execution, 'delayUntil').mockImplementation(async fn => fn());
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async fn => fn());
    spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
});
afterEach(() => { mock.restore(); Sustain.set(null); ClueExecutor.resetSession(); });

test.each([3532, 3534, 3536])('Kharazi clue %s requests a bank stop for tools instead of abandoning', async id => {
    pack = [item(id, 'Clue scroll'), item(952, 'Spade'), item(2574, 'Sextant'), item(2575, 'Watch'), item(2576, 'Chart'), item(2448, 'Superantipoison(4)'), item(385, 'Shark', 15)];
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('supplies-needed');
    expect(pack.some(i => i.id === id)).toBe(true);
});

test('a later leg gets its own tool-acquisition attempts', async () => {
    const ids = [2713, 2716, 2719];
    pack = [item(ids[0], 'Clue scroll')];
    let digs = 0;
    spyOn(Tools, 'ensureSpade').mockImplementation(async () => { pack.push(item(952, 'Spade')); return true; });
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, op: string) {
        if (this.id !== 952 || op !== 'Dig') return false;
        digs++;
        pack = digs < ids.length ? [item(ids[digs], 'Clue scroll')] : [];
        if (digs === ids.length) pending = true;
        return true;
    });
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(digs).toBe(3);
});
