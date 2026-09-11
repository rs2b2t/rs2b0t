import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { SolveClue, type SolveClueHost } from '#/bot/api/ai/clues/SolveClue.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';

function item(id: number, name: string, count = 1): InvItemSnapshot {
    return { id, name, count, slot: 0, comId: 1, ops: ['Wield', 'Eat', 'Drink'] };
}
const clue = item(2723, 'Clue scroll (hard)');
const bow = item(861, 'Magic shortbow');
let pack: InvItemSnapshot[];
let bank: InvItemSnapshot[];
let worn: InvItemSnapshot[];
let open: boolean;
let equips: string[];
const host: SolveClueHost = {
    log: () => {}, setStatus: () => {}, isFood: n => n === 'Lobster', foodName: () => 'Lobster',
    foodWithdraw: () => 10, weaponName: () => 'Magic shortbow', useTeleports: () => false,
    restorePrayer: () => false, prepareInitialBank: async () => true
};

beforeEach(() => {
    pack = [clue, item(952, 'Spade'), item(2574, 'Sextant'), item(2575, 'Watch'), item(2576, 'Chart')];
    bank = [item(1231, 'Dragon dagger(p)'), item(2448, 'Superantipoison(4)'), item(385, 'Shark', 30)];
    worn = [{ ...bow, slot: 3 }]; open = false; equips = [];
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'bankSideItems').mockImplementation(() => pack);
    spyOn(reader, 'equipment').mockImplementation(() => worn);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankComId').mockImplementation(() => open ? 1 : -1);
    spyOn(reader, 'bankSnapshotReady').mockReturnValue(true);
    spyOn(reader, 'bankItems').mockImplementation(() => bank);
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(Skills, 'effective').mockReturnValue(60);
    spyOn(Quests, 'status').mockImplementation(name => name === 'Lost City' ? 'complete' : 'unknown');
    spyOn(Game, 'tile').mockReturnValue(new Tile(2946, 3369, 0));
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue();
    spyOn(Bank, 'openNearest').mockImplementation(async () => { open = true; return true; });
    spyOn(Bank, 'close').mockImplementation(async () => { open = false; return true; });
    spyOn(Bank, 'depositAllMatching').mockImplementation(async predicate => {
        bank.push(...pack.filter(i => predicate(i.name ?? '', i.id)));
        pack = pack.filter(i => !predicate(i.name ?? '', i.id));
    });
    spyOn(Bank, 'withdraw').mockImplementation((name, op) => {
        const source = bank.find(i => i.name === name && i.count > 0);
        if (!source) return false;
        const count = Math.min(source.count, op === 'Withdraw-10' ? 10 : op === 'Withdraw-5' ? 5 : 1, 28 - pack.length);
        source.count -= count;
        pack.push(...Array.from({ length: count }, () => ({ ...source, count: 1 })));
        return count > 0;
    });
    spyOn(Bank, 'withdrawX').mockResolvedValue(false);
    spyOn(Equipment, 'equip').mockImplementation(async name => {
        equips.push(name);
        const next = pack.find(i => i.name === name);
        if (!next) return worn.some(i => i.name === name);
        pack = pack.filter(i => i !== next); pack.push(...worn);
        worn = [{ ...next, slot: 3 }]; open = false;
        return true;
    });
    spyOn(Equipment, 'unequip').mockImplementation(async name => {
        pack.push(...worn.filter(i => i.name === name)); worn = worn.filter(i => i.name !== name); return true;
    });
    spyOn(ClueExecutor, 'solveHeldClue').mockResolvedValue('yield');
});
afterEach(() => { mock.restore(); Sustain.set(null); });

test.each([1231, 2448, 385])('keeps the clue and suppresses retries when the READY bank lacks %s', async id => {
    bank = bank.filter(i => i.id !== id);
    const task = new SolveClue(host);
    await task.execute();
    expect(ClueExecutor.solveHeldClue).not.toHaveBeenCalled();
    expect(pack.some(i => i.id === clue.id)).toBe(true);
    expect(task.validate()).toBe(false);
});
test('blocks fourteen Sharks', async () => {
    bank = bank.map(i => i.id === 385 ? { ...i, count: 14 } : i);
    await new SolveClue(host).execute();
    expect(ClueExecutor.solveHeldClue).not.toHaveBeenCalled();
});
test('stocks a bank-only kit and equips DDS before the executor', async () => {
    await new SolveClue(host).execute();
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(1);
    expect(worn[0].id).toBe(1231);
    expect(pack.filter(i => i.id === 385).length).toBe(20);
    expect(pack.some(i => i.id === 2448)).toBe(true);
    expect(pack.some(i => i.id === bow.id)).toBe(true);
});
test('blocks an equip failure even when ownership and requirements pass', async () => {
    spyOn(Equipment, 'equip').mockResolvedValue(false);
    await new SolveClue(host).execute();
    expect(ClueExecutor.solveHeldClue).not.toHaveBeenCalled();
});
test('does not confuse an unknown bank with a confirmed shortage', async () => {
    spyOn(reader, 'bankSnapshotReady').mockReturnValue(false); bank = [];
    const task = new SolveClue(host);
    await task.execute();
    expect(ClueExecutor.solveHeldClue).not.toHaveBeenCalled();
    expect(task.validate()).toBe(true);
});
test('restoration remains runnable after the clue disappears', async () => {
    const task = new SolveClue(host);
    await task.execute();
    pack = pack.filter(i => i.id !== clue.id);
    expect(task.validate()).toBe(true);
    await task.execute();
    expect(worn[0].id).toBe(bow.id);
    expect(task.validate()).toBe(false);
});
test('casket-only execution needs no hard kit', async () => {
    pack = [item(2724, 'Casket')]; bank = [];
    await new SolveClue(host).execute();
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(1);
    expect(Bank.openNearest).not.toHaveBeenCalled();
});

test.each([
    { runeSlots: 5, stock: 30, food: 15, bankBow: true },
    { runeSlots: 0, stock: 30, food: 20, bankBow: true },
    { runeSlots: 0, stock: 20, food: 20, bankBow: true },
    { runeSlots: 0, stock: 19, food: 19, bankBow: false }
])('preserves restoration and mandatory items when preparing %j', async ({ runeSlots, stock, food, bankBow }) => {
    pack.push(item(995, 'Coins', 1000), item(1854, 'Shantay pass'));
    bank = bank.map(i => i.id === 385 ? { ...i, count: stock } : i);
    const required = [...pack, item(2448, 'Superantipoison(4)')];
    const runes = ['Air rune', 'Earth rune', 'Fire rune', 'Law rune', 'Water rune'].slice(0, runeSlots);
    const task = new SolveClue(host);
    task['stockTeleports'] = async () => {
        pack.push(...runes.map((name, i) => item(550 + i, name, 100)));
    };
    await task.execute();
    expect(pack.filter(i => i.id === 385)).toHaveLength(food);
    expect(required.every(requiredItem => pack.some(i => i.id === requiredItem.id))).toBe(true);
    expect(runes.every(name => pack.some(i => i.name === name))).toBe(true);
    expect(pack.some(i => i.id === bow.id)).toBe(!bankBow);
    expect(bank.some(i => i.id === bow.id)).toBe(bankBow);
    expect(worn[0].id).toBe(1231);
    pack = pack.filter(i => i.id !== clue.id);
    await task.execute();
    expect(worn[0].id).toBe(bow.id);
});
test('allows an Entrana strip and equips again for a later guardian', async () => {
    pack[0] = { ...clue, id: 3579 };
    const task = new SolveClue(host);
    await task.execute();
    expect(worn).toEqual([]);
    expect(pack.some(i => i.id === 1231)).toBe(false);
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(1);
    pack[0] = clue;
    spyOn(ClueExecutor, 'solveHeldClue').mockClear().mockResolvedValueOnce('supplies-needed').mockResolvedValue('yield');
    await task.execute();
    expect(worn[0].id).toBe(1231);
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(2);
});
test('gives supply-needed one restock attempt and preserves the held clue', async () => {
    const task = new SolveClue(host);
    await task.execute();
    pack = pack.filter(i => i.id !== 385);
    spyOn(ClueExecutor, 'solveHeldClue').mockResolvedValue('supplies-needed');
    await task.execute();
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(2);
    expect(pack.some(i => i.id === clue.id)).toBe(true);
    expect(task.validate()).toBe(false);
});
test('death stops retries even if the kit is still present', async () => {
    const task = new SolveClue(host);
    spyOn(ClueExecutor, 'solveHeldClue').mockResolvedValue('dead');
    await task.execute();
    expect(task.validate()).toBe(false);
    await task.execute();
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(1);
    task.retry();
    expect(task.validate()).toBe(true);
});
test('hard upkeep eats Sharks despite the host selecting Lobster', async () => {
    spyOn(Skills, 'effective').mockImplementation(name => name === 'hitpoints' ? 25 : 60);
    const eaten: number[] = [];
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, op: string) {
        if (op === 'Eat') { eaten.push(this.id); pack.splice(pack.findIndex(i => i.id === this.id), 1); }
        return true;
    });
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => { await Sustain.run(); return 'yield'; });
    await new SolveClue(host).execute();
    expect(eaten).toEqual([385]);
});

test('a confirmed shortage stays suppressed across bank reopen until kit contents change', async () => {
    bank = bank.filter(i => i.id !== 1231);
    spyOn(reader, 'bankSnapshotReady').mockImplementation(() => open);
    const task = new SolveClue(host);
    await task.execute();
    expect(task.validate()).toBe(false);
    open = true;
    expect(task.validate()).toBe(false);
    bank.push(item(1231, 'Dragon dagger(p)'));
    expect(task.validate()).toBe(true);
});

test('does not mistake the temporary DDS for original gear after a mid-trail Entrana strip', async () => {
    const task = new SolveClue(host);
    await task.execute();
    pack = pack.map(i => i.id === clue.id ? { ...i, id: 3579 } : i);
    spyOn(ClueExecutor, 'solveHeldClue').mockResolvedValueOnce('supplies-needed').mockImplementation(async () => {
        pack = pack.filter(i => i.id !== 3579);
        return 'done';
    });
    await task.execute();
    expect(worn[0].id).toBe(bow.id);
    expect(task.validate()).toBe(false);
});

test('a failed retreat remains runnable rather than releasing the host into a live guardian', async () => {
    const task = new SolveClue(host);
    await task.execute();
    spyOn(Game, 'tile').mockReturnValue(null);
    spyOn(ClueExecutor, 'solveHeldClue').mockResolvedValue('guardian-lost');
    await task.execute();
    expect(task.validate()).toBe(true);
    spyOn(Game, 'tile').mockReturnValue(new Tile(2946, 3369, 0));
    await task.execute();
    expect(worn[0].id).toBe(bow.id);
    expect(task.validate()).toBe(false);
});

test('a failed mid-trail bank trip does not repeat the caller initial-bank hook', async () => {
    let initialTrips = 0;
    const task = new SolveClue({ ...host, prepareInitialBank: async () => { initialTrips++; return true; } });
    await task.execute();
    spyOn(ClueExecutor, 'solveHeldClue').mockResolvedValue('supplies-needed');
    spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    await task.execute();
    await task.execute();
    expect(initialTrips).toBe(1);
});
