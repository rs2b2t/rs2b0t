import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { PuzzleBox } from '#/bot/api/ai/clues/PuzzleBox.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Reach } from '#/bot/api/walking/Reach.js';
import Tile from '#/bot/geometry/Tile.js';

let pack: InvItemSnapshot[];
let pending: boolean;
const item = (id: number, slot: number): InvItemSnapshot => ({ id, name: id === 2799 ? 'Clue scroll (hard)' : 'Item', slot, count: 1, comId: 3214, ops: [] });

beforeEach(() => {
    pack = [item(2799, 0), ...Array.from({ length: 27 }, (_, i) => item(385, i + 1))];
    pending = false;
    ClueExecutor.retryGuardian();
    Sustain.set(null);
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'countDialogOpen').mockReturnValue(false);
    spyOn(EventSignal, 'pending').mockImplementation(() => pending);
    spyOn(Game, 'tile').mockReturnValue(new Tile(2957, 3511, 0));
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Reach, 'npcDialog').mockImplementation(async () => { pending = true; return 'retry'; });
});

afterEach(() => { mock.restore(); Sustain.set(null); ClueExecutor.current = null; ClueExecutor.retryGuardian(); });

test('a full pack asks for bank preparation before requesting a puzzle box', async () => {
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('supplies-needed');
    expect(Reach.npcDialog).not.toHaveBeenCalled();
    expect(pack.some(i => i.id === 2799)).toBe(true);
});

test('a free slot allows the puzzle conversation', async () => {
    pack.pop();
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(Reach.npcDialog).toHaveBeenCalledTimes(1);
});

test('a box already held can be solved with a full pack', async () => {
    pack[1] = item(2800, 1);
    spyOn(PuzzleBox, 'solveHeld').mockResolvedValue(true);
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(PuzzleBox.solveHeld).toHaveBeenCalledWith(2800, expect.any(Function));
    expect(Reach.npcDialog).toHaveBeenCalledTimes(1);
});
