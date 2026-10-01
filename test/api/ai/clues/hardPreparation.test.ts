import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import JiveDragons from '#/bot/scripts/JiveDragons/JiveDragons.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { SolveClue, type SolveClueHost } from '#/bot/api/ai/clues/SolveClue.js';
import { ClueExecutor } from '#/bot/api/ai/clues/ClueExecutor.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { InvItem } from '#/bot/api/inventory/Inventory.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import { Prayer } from '#/bot/api/prayer/Prayer.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';
import { Input } from '#/bot/input/Input.js';

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
        const slot = next.slot || 3;
        pack = pack.filter(i => i !== next).concat(worn.filter(i => i.slot === slot));
        worn = worn.filter(i => i.slot !== slot).concat({ ...next, slot }); open = false;
        return true;
    });
    spyOn(Equipment, 'unequip').mockImplementation(async name => {
        if (open || pack.length >= 28) return false;
        pack.push(...worn.filter(i => i.name === name)); worn = worn.filter(i => i.name !== name); return true;
    });
    spyOn(ClueExecutor, 'solveHeldClue').mockResolvedValue('yield');
});
afterEach(() => { mock.restore(); Sustain.set(null); ClueExecutor.retryGuardian(); });

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
    expect(pack.filter(i => i.id === 385).length).toBe(15);
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

test('a resumed hard casket provisions the next guardian and restores the original weapon', async () => {
    pack[0] = item(2724, 'Casket');
    const task = new SolveClue(host);
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementationOnce(async () => {
        expect(Bank.openNearest).not.toHaveBeenCalled();
        pack[0] = clue;
        return 'supplies-needed';
    }).mockImplementation(async () => {
        expect(worn[0].id).toBe(1231);
        expect(pack.filter(i => i.id === 385)).toHaveLength(15);
        pack = pack.filter(i => i.id !== clue.id);
        return 'done';
    });
    await task.execute();
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(2);
    expect(worn[0].id).toBe(bow.id);
    expect(task.validate()).toBe(false);
});

test('a new solver clears a previous session guardian death without retrying the failed session', async () => {
    const task = new SolveClue(host);
    task.noteDeath();
    spyOn(ClueExecutor, 'solveHeldClue').mockRestore();
    spyOn(EventSignal, 'pending').mockReturnValue(true);
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('dead');
    expect(task.validate()).toBe(false);
    new SolveClue(host);
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('yield');
    expect(task.validate()).toBe(false);
});

test.each([
    { runeSlots: 5, stock: 30, food: 15, bankBow: true },
    { runeSlots: 0, stock: 30, food: 15, bankBow: false },
    { runeSlots: 0, stock: 20, food: 15, bankBow: false },
    { runeSlots: 0, stock: 19, food: 15, bankBow: false }
])('preserves restoration and mandatory items when preparing %j', async ({ runeSlots, stock, food, bankBow }) => {
    pack[0] = item(3552, 'Clue scroll (hard)');
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
    pack = pack.filter(i => i.id !== 3552);
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
test.each([0, 23])('banks every equipment slot for Entrana with %s extra inventory items', async extra => {
    pack[0] = { ...clue, id: 3579 };
    pack.push(...Array.from({ length: extra }, () => item(379, 'Lobster')));
    const outfit = [
        { ...bow, slot: 3 }, { ...item(1127, 'Rune platebody'), slot: 4 },
        { ...item(1061, 'Leather boots'), slot: 10 }, { ...item(1033, 'Zamorak robe'), slot: 7 },
        { ...item(1731, 'Amulet of power'), slot: 2 }, { ...item(1635, 'Gold ring'), slot: 12 },
        { ...item(1007, 'Cape'), slot: 1 }, { ...item(882, 'Bronze arrow', 100), slot: 13 }
    ];
    worn = outfit.map(i => ({ ...i }));
    spyOn(Equipment, 'equip').mockImplementation(async name => {
        open = false;
        const next = pack.find(i => i.name === name);
        if (!next) return worn.some(i => i.name === name);
        const slot = outfit.find(i => i.name === name)?.slot ?? 3;
        pack = pack.filter(i => i !== next).concat(worn.filter(i => i.slot === slot));
        worn = worn.filter(i => i.slot !== slot).concat({ ...next, slot });
        return true;
    });
    spyOn(Bank, 'withdrawX').mockImplementation(async (name, count) => {
        const source = bank.find(i => i.name === name && i.count >= count);
        if (!source || pack.length >= 28) return false;
        source.count -= count; pack.push({ ...source, count });
        return true;
    });
    const task = new SolveClue(host);
    let reachedEntrana = false;
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => {
        reachedEntrana = true;
        expect(worn).toEqual([]);
        expect(pack.some(i => i.id === 3579)).toBe(true);
        expect(outfit.every(i => bank.some(b => b.id === i.id && b.count >= i.count))).toBe(true);
        expect(outfit.some(i => pack.some(p => p.id === i.id))).toBe(false);
        pack = pack.filter(i => i.id !== 3579);
        return 'done';
    });
    await task.execute();
    expect(reachedEntrana).toBe(true);
    expect(worn.map(i => [i.name, i.count]).sort()).toEqual(outfit.map(i => [i.name, i.count]).sort());
    expect(task.validate()).toBe(false);
});

test('keeps a full Entrana pack and equipment when deposits fail', async () => {
    pack[0] = { ...clue, id: 3579 };
    pack.push(...Array.from({ length: 23 }, () => item(379, 'Lobster')));
    spyOn(Bank, 'depositAllMatching').mockResolvedValue();
    const task = new SolveClue(host);
    await task.execute();
    expect(pack).toHaveLength(28);
    expect(worn[0].id).toBe(bow.id);
    expect(task.validate()).toBe(true);
    expect(ClueExecutor.solveHeldClue).not.toHaveBeenCalled();
});

test('an Entrana leg requests banking even when only allowed jewellery is equipped', async () => {
    pack[0] = { ...clue, id: 3579 };
    worn = [{ ...item(1635, 'Gold ring'), slot: 12 }];
    let pending = false;
    spyOn(EventSignal, 'pending').mockImplementation(() => pending);
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { pending = true; return false; });
    spyOn(ClueExecutor, 'solveHeldClue').mockRestore();
    expect(await ClueExecutor.solveHeldClue(() => {})).toBe('supplies-needed');
});

test.each(['close', 'remove', 'reopen'])('retries an Entrana %s failure without losing the original equipment', async failure => {
    pack[0] = { ...clue, id: 3579 };
    const task = new SolveClue(host);
    if (failure === 'close') spyOn(Bank, 'close').mockResolvedValueOnce(false);
    if (failure === 'remove') spyOn(Equipment, 'unequip').mockResolvedValueOnce(false);
    if (failure === 'reopen') spyOn(Bank, 'openNearest')
        .mockImplementationOnce(async () => { open = true; return true; }).mockResolvedValueOnce(false);
    await task.execute();
    expect(task.validate()).toBe(true);
    expect(pack.some(i => i.id === 3579)).toBe(true);
    expect(ClueExecutor.solveHeldClue).not.toHaveBeenCalled();
    await task.execute();
    expect(worn).toEqual([]);
    expect(bank.some(i => i.id === bow.id)).toBe(true);
    pack = pack.filter(i => i.id !== 3579);
    await task.execute();
    expect(worn[0].id).toBe(bow.id);
});

test.each([false, true])('restores the Entrana outfit before the next fight, with blocked equip=%s', async blocked => {
    pack[0] = { ...clue, id: 3579 };
    worn = [{ ...item(1305, 'Dragon longsword'), slot: 3 }, { ...item(1127, 'Rune platebody'), slot: 4 }, { ...item(1635, 'Gold ring'), slot: 12 }];
    const task = new SolveClue(host);
    let leg = 0;
    let fought = false;
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async (_log, needsBank) => {
        if (leg++ === 0) {
            expect(worn).toEqual([]);
            pack[0] = clue;
            expect(needsBank?.()).toBe(true);
            if (blocked) spyOn(Equipment, 'equip').mockResolvedValue(false);
            return 'supplies-needed';
        }
        expect(worn.map(i => i.name).sort()).toEqual(['Dragon longsword', 'Gold ring', 'Rune platebody']);
        expect(needsBank?.()).toBe(false);
        fought = true;
        return 'yield';
    });
    await task.execute();
    expect(fought).toBe(!blocked);
    expect(task.validate()).toBe(true);
});

test('keeps restoration pending after a partial ammunition withdrawal', async () => {
    pack[0] = { ...clue, id: 3579 };
    worn.push({ ...item(882, 'Bronze arrow', 100), slot: 13 });
    const task = new SolveClue(host);
    spyOn(Bank, 'withdrawX').mockImplementation(async (name, count) => {
        const source = bank.find(i => i.name === name && i.count > 0);
        if (!source) return false;
        const taken = Math.min(count, 50, source.count);
        source.count -= taken;
        const held = pack.find(i => i.id === source.id);
        if (held) held.count += taken;
        else pack.push({ ...source, count: taken });
        return true;
    });
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => {
        pack = pack.filter(i => i.id !== 3579);
        return 'done';
    });
    await task.execute();
    expect(task.validate()).toBe(true);
    expect(pack.find(i => i.id === 882)?.count).toBe(50);
    await task.execute();
    expect(worn.find(i => i.id === 882)?.count).toBe(100);
    expect(task.validate()).toBe(false);
});

test('the executor stops before travel while the host has gear to restore', async () => {
    let pending = false;
    spyOn(EventSignal, 'pending').mockImplementation(() => pending);
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { pending = true; return false; });
    spyOn(ClueExecutor, 'solveHeldClue').mockRestore();
    expect(await ClueExecutor.solveHeldClue(() => {}, () => true)).toBe('supplies-needed');
    expect(pending).toBe(false);
});

test('a completed Entrana clue retains ownership until a failed armour equip succeeds', async () => {
    pack[0] = { ...clue, id: 3579 };
    worn.push({ ...item(1127, 'Rune platebody'), slot: 4 });
    let blocked = true;
    spyOn(Equipment, 'equip').mockImplementation(async name => {
        if (name === 'Rune platebody' && blocked) return false;
        open = false;
        const next = pack.find(i => i.name === name);
        if (!next) return worn.some(i => i.name === name);
        const slot = next.slot || 3;
        pack = pack.filter(i => i !== next).concat(worn.filter(i => i.slot === slot));
        worn = worn.filter(i => i.slot !== slot).concat({ ...next, slot });
        return true;
    });
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => {
        pack = pack.filter(i => i.id !== 3579);
        return 'done';
    });
    const task = new SolveClue(host);
    await task.execute();
    expect(task.validate()).toBe(true);
    expect(task.ownsEquipment()).toBe(true);
    expect(worn.some(i => i.id === 1127)).toBe(false);
    blocked = false;
    await task.execute();
    expect(worn.some(i => i.id === 1127)).toBe(true);
    expect(task.validate()).toBe(false);
    expect(task.ownsEquipment()).toBe(false);
});

test('gives supply-needed one restock attempt and preserves the held clue', async () => {
    bank = bank.map(i => i.id === 385 ? { ...i, count: 20 } : i);
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

test('a puzzle clue leaves room for its box without reducing the guardian food supply', async () => {
    pack[0] = item(2799, 'Clue scroll (hard)');
    pack.push(item(995, 'Coins', 1000), item(1854, 'Shantay pass'));
    const task = new SolveClue(host);
    task['stockTeleports'] = async () => {
        pack.push(...['Air rune', 'Earth rune', 'Fire rune', 'Law rune', 'Water rune'].map((name, i) => item(550 + i, name, 100)));
    };
    await task.execute();
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(1);
    expect(pack.filter(i => i.id === 385)).toHaveLength(15);
    expect(pack.length).toBeLessThan(28);
    expect(pack.some(i => i.id === 2799)).toBe(true);
});

test('bank preparation preserves a held puzzle box with its clue', async () => {
    pack[0] = item(2799, 'Clue scroll (hard)');
    pack.push(item(2800, 'Puzzle box'));
    await new SolveClue(host).execute();
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(1);
    expect(pack.some(i => i.id === 2800)).toBe(true);
    expect(bank.some(i => i.id === 2800)).toBe(false);
});

test('bank preparation retrieves the current clue puzzle box when it was banked earlier', async () => {
    pack[0] = item(2799, 'Clue scroll (hard)');
    bank.push({ ...item(2795, 'Puzzle box'), ops: ['Withdraw-1'] }, { ...item(2800, 'Puzzle box'), ops: ['Withdraw-1'] });
    spyOn(Input, 'invButton').mockImplementation(id => {
        const source = bank.find(i => i.id === id && i.count > 0);
        if (!source || pack.length >= 28) return false;
        source.count--;
        pack.push({ ...source, count: 1 });
        return true;
    });
    await new SolveClue(host).execute();
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(1);
    expect(pack.some(i => i.id === 2800)).toBe(true);
    expect(pack.some(i => i.id === 2795)).toBe(false);
});

test('reward pickup keeps ownership after the scroll disappears until collection finishes', async () => {
    const task = new SolveClue(host);
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementationOnce(async () => {
        pack = pack.filter(i => i.id !== clue.id);
        ClueExecutor.current = { clueId: clue.id, name: 'hard clue', step: 'reward', leg: 1, attempt: 1, startedAt: 0, target: null, startDist: 0 };
        return 'yield';
    }).mockImplementation(async () => { ClueExecutor.current = null; return 'done'; });
    await task.execute();
    expect(task.validate()).toBe(true);
    expect(task.ownsEquipment()).toBe(true);
    expect(worn[0].id).toBe(1231);
    await task.execute();
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(2);
    expect(worn[0].id).toBe(bow.id);
    expect(task.validate()).toBe(false);
});

test.each([
    { id: 1333, name: 'Rune scimitar', outcome: 'done' as const },
    { id: 1301, name: 'Adamant longsword', outcome: 'done' as const },
    { id: 1333, name: 'Rune scimitar', outcome: 'abandon' as const }
])('a normal trail restores its equipped weapon: %j', async ({ id, name, outcome }) => {
    pack[0] = item(3599, 'Clue scroll (medium)');
    worn = [{ ...item(id, name), slot: 3 }];
    const statuses: string[] = [];
    const task = new SolveClue({ ...host, setStatus: s => statuses.push(s) });
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => {
        bank.push(...worn);
        worn = [];
        if (outcome === 'done') pack = Array.from({ length: 28 }, () => item(379, 'Lobster'));
        return outcome;
    });

    await task.execute();

    expect(worn.map(i => i.id)).toEqual([id]);
    expect(task.ownsEquipment()).toBe(false);
    expect(statuses.includes('clue solved')).toBe(outcome === 'done');
});

test('an ordinary clue keeps restoration pending when the weapon cannot be reclaimed yet', async () => {
    pack[0] = item(3599, 'Clue scroll (medium)');
    worn = [{ ...item(1333, 'Rune scimitar'), slot: 3 }];
    const statuses: string[] = [];
    const task = new SolveClue({ ...host, setStatus: s => statuses.push(s) });
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => {
        bank.push(...worn);
        worn = [];
        pack = [];
        spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
        return 'done';
    });
    await task.execute();
    expect(task.validate()).toBe(true);
    expect(task.ownsEquipment()).toBe(true);
    expect(statuses).not.toContain('clue solved');

    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    await task.execute();
    expect(worn.map(i => i.id)).toEqual([1333]);
    expect(statuses).toContain('clue solved');
    expect(task.validate()).toBe(false);
});

test('each ordinary trail remembers its current weapon rather than the previous trail or host fallback', async () => {
    const task = new SolveClue(host);
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => {
        bank.push(...worn);
        worn = [];
        pack = [];
        return 'done';
    });
    for (const [id, name] of [[1333, 'Rune scimitar'], [1301, 'Adamant longsword'], [1333, 'Rune scimitar']] as const) {
        pack = [item(3599, 'Clue scroll (medium)')];
        worn = [{ ...item(id, name), slot: 3 }];
        await task.execute();
        expect(worn.map(i => i.id)).toEqual([id]);
    }
});

test('a normal restock preserves the starting weapon in the pack ahead of a stale host weapon', async () => {
    pack[0] = item(3599, 'Clue scroll (medium)');
    worn = [{ ...item(1333, 'Rune scimitar'), slot: 3 }];
    const task = new SolveClue(host);
    await task.execute();
    pack.push(...worn, item(995, 'Coins'), item(592, 'Ashes'));
    worn = [];
    pack = pack.filter(i => i.name !== 'Lobster');

    await task.execute();

    expect(pack.some(i => i.id === 1333)).toBe(true);
    expect(bank.some(i => i.id === 1333)).toBe(false);
    expect(bank.some(i => i.id === 592)).toBe(true);
    expect(task.ownsEquipment()).toBe(true);
});

test('a normal trail started unarmed does not require an unavailable host weapon to finish', async () => {
    pack[0] = item(3599, 'Clue scroll (medium)');
    worn = [];
    const statuses: string[] = [];
    const task = new SolveClue({ ...host, setStatus: s => statuses.push(s) });
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => { pack = []; return 'done'; });

    await task.execute();

    expect(statuses).toContain('clue solved');
    expect(task.validate()).toBe(false);
    expect(task.ownsEquipment()).toBe(false);
});


test.each([12, 30])('JiveDragons prepares exactly twelve Sharks with %s banked', async stock => {
    if (stock === 30) pack.push(...Array.from({ length: 20 }, () => item(385, 'Shark')));
    bank = bank.map(i => i.id === 385 ? { ...i, count: stock } : i);
    const bot = new JiveDragons();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ solveClues: true, foodWithdraw: 20 });
    await bot.onStart();

    await bot.solveClue!.execute();

    expect(pack.filter(i => i.id === 385)).toHaveLength(12);
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(1);
});

test('JiveDragons restocks a hard clue to twelve Sharks after supplies run low', async () => {
    const bot = new JiveDragons();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ solveClues: true, foodWithdraw: 20 });
    await bot.onStart();
    const loads: number[] = [];
    spyOn(ClueExecutor, 'solveHeldClue').mockImplementation(async () => {
        loads.push(pack.filter(i => i.id === 385).length);
        if (loads.length === 1) {
            pack = pack.filter(i => i.id !== 385);
            return 'supplies-needed';
        }
        return 'yield';
    });

    await bot.solveClue!.execute();

    expect(loads).toEqual([12, 12]);
});

test('clue prayer restoration walks to the reachable Lumbridge altar', async () => {
    spyOn(Game, 'tile').mockReturnValue(new Tile(3222, 3218, 0));
    spyOn(Prayer, 'max').mockReturnValue(60);
    spyOn(Prayer, 'full').mockReturnValue(false);
    spyOn(Navigator, 'findPath').mockImplementation(async (_from, to) => to.x === 3243
        ? { ok: true, cost: 25, waypoints: [], hops: [], expanded: 0 }
        : { ok: false, reason: 'unreachable', expanded: 0 });
    await new SolveClue({ ...host, restorePrayer: () => true }).execute();
    expect(Traversal.walkResilient).toHaveBeenCalledWith(new Tile(3243, 3205, 0), expect.anything());
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(1);
});

test('an unrelated hard clue leaves Shantay passes in the bank', async () => {
    bank.push(item(1854, 'Shantay pass', 10));
    await new SolveClue(host).execute();
    expect(pack.some(i => i.id === 1854)).toBe(false);
    expect(bank.find(i => i.id === 1854)?.count).toBe(10);
});

test('an unrelated clue deposits a pass left over from an earlier trip', async () => {
    pack.push(item(1854, 'Shantay pass'));
    await new SolveClue(host).execute();
    expect(pack.some(i => i.id === 1854)).toBe(false);
    expect(bank.find(i => i.id === 1854)?.count).toBe(1);
});

test('the desert dig packs a banked Shantay pass', async () => {
    pack[0] = item(3552, 'Clue scroll (hard)');
    bank.push(item(1854, 'Shantay pass', 10));
    await new SolveClue(host).execute();
    expect(pack.filter(i => i.id === 1854)).toHaveLength(1);
    expect(bank.find(i => i.id === 1854)?.count).toBe(9);
});


test('a Kharazi leg banks for its tools after an earlier ordinary leg', async () => {
    spyOn(Quests, 'status').mockReturnValue('complete');
    bank.push(item(975, 'Machete'), item(1351, 'Bronze axe'));
    const task = new SolveClue(host);
    await task.execute();
    pack = pack.map(i => i.id === clue.id ? { ...i, id: 3532 } : i);
    spyOn(ClueExecutor, 'solveHeldClue').mockResolvedValueOnce('supplies-needed').mockImplementation(async () => {
        expect(pack.some(i => i.name === 'Machete')).toBe(true);
        expect(pack.some(i => i.name === 'Bronze axe')).toBe(true);
        return 'yield';
    });
    await task.execute();
    expect(pack.some(i => i.id === 3532)).toBe(true);
    expect(task.validate()).toBe(true);
});

test('missing jungle tools keep the clue and resume when the bank receives the tools', async () => {
    spyOn(Quests, 'status').mockReturnValue('complete');
    pack[0] = { ...clue, id: 3532 };
    const task = new SolveClue(host);
    await task.execute();
    expect(ClueExecutor.solveHeldClue).not.toHaveBeenCalled();
    expect(task.validate()).toBe(false);
    expect(pack.some(i => i.id === 3532)).toBe(true);
    bank.push(item(975, 'Machete'), item(1351, 'Bronze axe'));
    open = true;
    expect(task.validate()).toBe(true);
    await task.execute();
    expect(pack.some(i => i.name === 'Machete')).toBe(true);
    expect(pack.some(i => i.name === 'Bronze axe')).toBe(true);
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(1);
});

test.each([false, true])('retries a stocked jungle-tool withdrawal after interruption=%s', async interrupt => {
    spyOn(Quests, 'status').mockReturnValue('complete');
    pack[0] = { ...clue, id: 3532 };
    bank.push(item(975, 'Machete'), item(1351, 'Bronze axe'));
    let failed = false;
    let pending = false;
    spyOn(EventSignal, 'pending').mockImplementation(() => pending);
    spyOn(Bank, 'withdraw').mockImplementation((name, op) => {
        if (name === 'Machete' && !failed) { failed = true; pending = interrupt; return false; }
        const source = bank.find(i => i.name === name && i.count > 0);
        if (!source) return false;
        const count = Math.min(source.count, op === 'Withdraw-10' ? 10 : op === 'Withdraw-5' ? 5 : 1, 28 - pack.length);
        source.count -= count;
        pack.push(...Array.from({ length: count }, () => ({ ...source, count: 1 })));
        return count > 0;
    });
    const task = new SolveClue(host);
    await task.execute();
    expect(ClueExecutor.solveHeldClue).not.toHaveBeenCalled();
    pending = false;
    expect(task.validate()).toBe(true);
    await task.execute();
    expect(pack.some(i => i.name === 'Machete')).toBe(true);
    expect(pack.some(i => i.name === 'Bronze axe')).toBe(true);
    expect(ClueExecutor.solveHeldClue).toHaveBeenCalledTimes(1);
});
