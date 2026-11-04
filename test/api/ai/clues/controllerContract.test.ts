import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, actions, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { SolveClue } from '#/bot/api/ai/clues/SolveClue.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Game } from '#/bot/api/game/Game.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { CLUE_DB } from '#/bot/api/ai/clues/data/cluedb.js';
import { wildernessLevelAt } from '#/bot/event/webwalk/wilderness.js';
import Tile from '#/bot/geometry/Tile.js';

let pack: InvItemSnapshot[];
const item = (id: number, count = 1): InvItemSnapshot => ({ id, count, name: 'Loot', slot: 0, comId: 1, ops: ['Open'] });
const host = { log: () => {}, setStatus: () => {}, isFood: () => false, foodName: () => '', foodWithdraw: () => 0 };

beforeEach(() => {
    pack = [];
    ClueExecutor.resetSession();
    Sustain.set(null);
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'equipment').mockReturnValue([]);
    spyOn(reader, 'groundItems').mockReturnValue([]);
    spyOn(reader, 'worldTile').mockReturnValue({ x: 3253, z: 3420, level: 0 });
    spyOn(reader, 'modals').mockReturnValue({ main: -1, chat: -1, side: -1 });
    spyOn(reader, 'countDialogOpen').mockReturnValue(false);
    spyOn(Game, 'tile').mockReturnValue(new Tile(3253, 3420, 0));
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Execution, 'delayUntil').mockImplementation(async fn => fn());
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async fn => fn());
    spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    spyOn(actions, 'closeModal').mockReturnValue(true);
});
afterEach(() => { mock.restore(); Sustain.set(null); ClueExecutor.resetSession(); });

test('controller upkeep remains the only effective survival owner during solving', async () => {
    const hazards: string[] = [];
    const task = new SolveClue({ ...host, sustain: async hazard => { hazards.push(hazard.phase); } });
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => { await Sustain.run(); return 'yield'; });
    await task.execute();
    expect(hazards).toEqual(['travel']);
});

test('controller survival errors propagate without classifying a clue as unsupported', async () => {
    const failure = new Error('Prayer drink did not land');
    const task = new SolveClue({ ...host, sustain: async () => { throw failure; } });
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => { await Sustain.run(); return 'yield'; });
    await expect(task.execute()).rejects.toBe(failure);
    expect(task.result).toBeNull();
});

test('Wilderness refusal happens before travel or acquiring tools', async () => {
    const row = Object.values(CLUE_DB).find(r => r.obj.includes('_hard_') && r.coord && wildernessLevelAt(r.coord) > 0)!;
    pack = [item(row.id)];
    const task = new SolveClue({ ...host, allowWilderness: () => false });
    task['bankedThisSolve'] = true;
    const walk = spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    await task.execute();
    expect(task.result?.kind).toBe('unsupported');
    expect(task.result?.reason).toContain('Wilderness');
    expect(walk).not.toHaveBeenCalled();
    expect(Inventory.countById(row.id)).toBe(1);
});

test('missing casket without observed rewards cannot complete a controller trail', async () => {
    pack = [item(3549)];
    const task = new SolveClue({ ...host, verifyRewards: true });
    spyOn(InvItem.prototype, 'interact').mockImplementation(() => { pack = []; return true; });
    await task.execute();
    expect(task.result?.kind).toBe('transient-failure');
    expect(task.result?.reason).toContain('reward');
});

test('Stop prevents a subsequent solver invocation', async () => {
    const task = new SolveClue(host);
    const solve = spyOn(ClueExecutor, 'solveHeldClue').mockResolvedValue('done');
    task.stop();
    await task.execute();
    expect(solve).not.toHaveBeenCalled();
    expect(task.result?.kind).toBe('stopped');
});

test('controller completion retains every item from the verified reward inventory', async () => {
    pack = [item(3549), item(995, 200)];
    let reward = { generation: 0, items: [] as InvItemSnapshot[] };
    spyOn(reader, 'clueRewardSnapshot').mockImplementation(() => reward);
    const task = new SolveClue({ ...host, verifyRewards: true });
    spyOn(InvItem.prototype, 'interact').mockImplementation(() => {
        reward = { generation: 1, items: [item(995, 50), item(99999, 1)] };
        pack = [item(995, 250), item(99999, 1)];
        return true;
    });
    await task.execute();
    expect(task.result).toMatchObject({ kind: 'completed', rewards: [{ id: 995, count: 50 }, { id: 99999, count: 1 }] });
    expect(pack.map(i => i.id)).toEqual([995, 99999]);
});

test('partially delivered rewards remain unverified even when the casket is gone', async () => {
    pack = [item(3549)];
    let reward = { generation: 0, items: [] as InvItemSnapshot[] };
    spyOn(reader, 'clueRewardSnapshot').mockImplementation(() => reward);
    const task = new SolveClue({ ...host, verifyRewards: true });
    spyOn(InvItem.prototype, 'interact').mockImplementation(() => {
        reward = { generation: 1, items: [item(995, 50), item(99999, 1)] };
        pack = [item(995, 50)];
        return true;
    });
    await task.execute();
    expect(task.result?.kind).toBe('transient-failure');
    expect(task.result?.reason).toContain('incomplete');
});

test('a previous reward modal cannot certify a new missing casket', async () => {
    pack = [item(3549)];
    spyOn(reader, 'clueRewardSnapshot').mockReturnValue({ generation: 3, items: [item(995, 50)] });
    const task = new SolveClue({ ...host, verifyRewards: true });
    spyOn(InvItem.prototype, 'interact').mockImplementation(() => { pack = [item(995, 50)]; return true; });
    await task.execute();
    expect(task.result?.kind).toBe('transient-failure');
});

test('reward bank preparation must succeed before opening a casket', async () => {
    pack = [item(3549)];
    const task = new SolveClue({ ...host, verifyRewards: true, prepareRewards: async () => false });
    const open = spyOn(InvItem.prototype, 'interact').mockReturnValue(true);
    task['bankFirst'] = async () => false;
    await task.execute();
    expect(open).not.toHaveBeenCalled();
    expect(task.result?.kind).toBe('resupply');
    expect(pack[0].id).toBe(3549);
});

test('dangerous steps wait for the controller to verify the current kit', async () => {
    pack = [item(3549)];
    const task = new SolveClue({ ...host, beforeStep: async () => false });
    const open = spyOn(InvItem.prototype, 'interact').mockReturnValue(true);
    task['bankFirst'] = async () => false;
    await task.execute();
    expect(open).not.toHaveBeenCalled();
    expect(task.result?.kind).toBe('resupply');
});

test('a completed receipt cannot be credited a second time without another trail', async () => {
    pack = [item(3549)];
    let reward = { generation: 0, items: [] as InvItemSnapshot[] };
    spyOn(reader, 'clueRewardSnapshot').mockImplementation(() => reward);
    const task = new SolveClue({ ...host, verifyRewards: true });
    spyOn(InvItem.prototype, 'interact').mockImplementation(() => {
        reward = { generation: 1, items: [item(995, 50)] };
        pack = [item(995, 50)];
        return true;
    });
    await task.execute();
    expect(task.result?.kind).toBe('completed');
    await task.execute();
    expect(task.result?.kind).toBe('transient-failure');
});


test('prayer packing uses existing partial bottles to meet a dose target', async () => {
    const stock = new Map([[2434, 1], [139, 1], [143, 1]]);
    spyOn(Bank, 'countById').mockImplementation(id => stock.get(id) ?? 0);
    spyOn(Bank, 'withdrawById').mockImplementation(id => {
        stock.set(id, (stock.get(id) ?? 0) - 1);
        pack.push(item(id));
        return true;
    });
    spyOn(Inventory, 'isFull').mockReturnValue(false);
    const task = new SolveClue({ ...host, prayerDoseTarget: 8 });
    expect(await task['stockPrayer']()).toBe(true);
    expect(pack.map(i => i.id)).toEqual([2434, 139, 143]);
});

test('escape preparation packs reserved and travel casts using only configured rune stacks', async () => {
    spyOn(Bank, 'withdrawById').mockImplementation(id => {
        const held = pack.find(i => i.id === id);
        if (held) held.count++;
        else pack.push(item(id));
        return true;
    });
    const task = new SolveClue({ ...host, escapeReserve: [{ id: 556, count: 3 }, { id: 555, count: 1 }, { id: 563, count: 1 }] });
    await task['stockTeleports']({ runes: [], usable: [], jewelleryPrefixes: [] });
    expect(pack.map(i => [i.id, i.count])).toEqual([[556, 6], [555, 2], [563, 2]]);
});

test('Stop during solving cannot reinstall the previous survival hook', async () => {
    const previous = async (): Promise<void> => {};
    Sustain.set(previous);
    const task = new SolveClue(host);
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => { task.stop(); Sustain.set(null); return 'yield'; });
    await task.execute();
    expect(Sustain.hook).toBeNull();
    expect(task.result?.kind).toBe('stopped');
});

test('a successful internal restock clears stale resupply when the next step yields', async () => {
    const task = new SolveClue(host);
    task['bankFirst'] = async () => true;
    let attempts = 0;
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => ++attempts === 1 ? 'supplies-needed' : 'yield');
    await task.execute();
    expect(attempts).toBe(2);
    expect(task.result).toBeNull();
});
