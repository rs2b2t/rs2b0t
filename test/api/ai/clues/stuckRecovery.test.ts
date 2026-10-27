import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';

const item = (id: number): InvItemSnapshot => ({ id, name: id === 952 ? 'Spade' : 'Clue scroll', count: 1, slot: 0, comId: 3214, ops: ['Dig'] });
let pack: InvItemSnapshot[];
let blocked: boolean;
let pending: boolean;
let resets: number;
let walks: number;
let logs: string[];
const log = (s: string): void => { logs.push(s); };

beforeEach(() => {
    ClueExecutor.resetSession();
    blocked = true; pending = false; resets = 0; walks = 0; logs = [];
    pack = [item(2713), item(952)];
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'groundItems').mockReturnValue([]);
    spyOn(reader, 'modals').mockImplementation(() => ({ main: blocked ? 1 : -1, chat: -1, side: -1 }));
    spyOn(reader, 'worldTile').mockReturnValue({ x: 3000, z: 3000, level: 0 });
    spyOn(reader, 'countDialogOpen').mockReturnValue(false);
    spyOn(Game, 'tile').mockReturnValue(new Tile(3000, 3000, 0));
    spyOn(Quests, 'status').mockReturnValue('complete');
    spyOn(EventSignal, 'pending').mockImplementation(() => pending);
    spyOn(Sustain, 'run').mockResolvedValue();
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    spyOn(Execution, 'delayUntil').mockImplementation(async fn => fn());
    spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { walks++; return !blocked; });
    spyOn(Traversal, 'requestRepath');
    spyOn(actions, 'closeModal').mockImplementation(() => { resets++; blocked = false; return true; });
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem) {
        if (this.id === 952) pack = [item(952)];
        return true;
    });
    spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { mock.restore(); ClueExecutor.resetSession(); });

test('a stalled clue closes the blocking interface and completes after one reset', async () => {
    expect(await ClueExecutor.solveHeldClue(log)).toBe('reset-needed');
    expect(pack.some(i => i.id === 2713)).toBe(true);
    expect(await ClueExecutor.solveHeldClue(log)).toBe('done');
    expect(resets).toBe(1);
    expect(walks).toBe(5);
    expect(Traversal.requestRepath).toHaveBeenCalledTimes(1);
    expect(pack.map(i => i.id)).toEqual([952]);
    expect(logs.some(l => l.includes('resetting'))).toBe(true);
});

test('a second stalled attempt abandons instead of resetting forever', async () => {
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { walks++; return false; });
    expect(await ClueExecutor.solveHeldClue(log)).toBe('reset-needed');
    expect(await ClueExecutor.solveHeldClue(log)).toBe('abandon');
    expect(resets).toBe(1);
    expect(walks).toBe(8);
    expect(pack.some(i => i.id === 2713)).toBe(true);
});

test('an event yield does not renew the reset budget for the same clue', async () => {
    spyOn(actions, 'closeModal').mockImplementation(() => { resets++; pending = true; return true; });
    expect(await ClueExecutor.solveHeldClue(log)).toBe('reset-needed');
    expect(await ClueExecutor.solveHeldClue(log)).toBe('yield');
    pending = false;
    expect(await ClueExecutor.solveHeldClue(log)).toBe('abandon');
    expect(resets).toBe(1);
    expect(walks).toBe(8);
});

test('the next clue leg receives its own reset allowance', async () => {
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem) {
        if (this.id !== 952) return false;
        if (pack.some(i => i.id === 2713)) { pack = [item(2716), item(952)]; blocked = true; }
        else pack = [item(952)];
        return true;
    });
    expect(await ClueExecutor.solveHeldClue(log)).toBe('reset-needed');
    expect(await ClueExecutor.solveHeldClue(log)).toBe('reset-needed');
    expect(await ClueExecutor.solveHeldClue(log)).toBe('done');
    expect(resets).toBe(2);
    expect(walks).toBe(10);
});

test('an unmet quest requirement does not trigger navigation recovery', async () => {
    pack = [item(3564)];
    spyOn(Quests, 'status').mockReturnValue('notStarted');
    expect(await ClueExecutor.solveHeldClue(log)).toBe('abandon');
    expect(resets).toBe(0);
    expect(walks).toBe(0);
});
