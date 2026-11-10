import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { QuestEngine, type QuestHost } from '#/bot/api/ai/quests/engine/QuestEngine.js';
import { QuestBankReset, type QuestBankResetPort, type RecoveryItem } from '#/bot/api/ai/quests/engine/recovery.js';
import { runemysteries } from '#/bot/api/ai/quests/defs/runemysteries.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Modals } from '#/bot/api/ui/widgets/Modals.js';

const originals = { food: runemysteries.food, items: runemysteries.record.items };
afterEach(() => { mock.restore(); runemysteries.food = originals.food; runemysteries.record.items = originals.items; });
const inv = (id: number, name: string, count: number) => new InvItem({ id, name, count, slot: 0, comId: 3214, ops: [] });

function fixture() {
    const state = {
        restart: false, skip: false, bank: false, finished: '', questActions: 0, preparations: 0,
        coins: 0, trout: 0, bankCoins: 10000, bankTrout: 8, withdrawals: [] as string[], status: '', active: null as string | null
    };
    const inventory = () => [...(state.coins ? [inv(995, 'Coins', state.coins)] : []), ...(state.trout ? [inv(333, 'Trout', state.trout)] : [])];
    const host: QuestHost = {
        log: () => {}, verbose: () => false, foodItem: () => 'Trout', pickedIds: () => new Set(['runemysteries', 'doric']),
        automaticRecovery: () => true,
        skipPending: () => state.skip,
        consumeSkip: () => { const value = state.skip; state.skip = false; return value; },
        consumeRestart: () => { const value = state.restart; state.restart = false; return value; },
        consumeDeath: () => false,
        prepare: async () => { state.preparations++; return 'ready'; },
        noteState: (_rows, id, status) => { state.active = id; state.status = status; },
        finish: reason => { state.finished = reason; }
    };
    spyOn(reader, 'modals').mockReturnValue({ main: -1, side: -1, chat: -1 });
    spyOn(Game, 'tile').mockReturnValue({ x: 3093, z: 3243, level: 0 });
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(Skills, 'effective').mockReturnValue(99);
    spyOn(Skills, 'xp').mockReturnValue(10000);
    spyOn(Equipment, 'items').mockReturnValue([]);
    spyOn(Inventory, 'items').mockImplementation(inventory);
    spyOn(Inventory, 'count').mockImplementation(name => inventory().filter(item => item.name?.toLowerCase() === name.toLowerCase()).reduce((sum, item) => sum + item.count, 0));
    spyOn(Inventory, 'used').mockImplementation(() => inventory().length);
    spyOn(Inventory, 'free').mockImplementation(() => 28 - inventory().length);
    spyOn(Bank, 'isOpen').mockImplementation(() => state.bank);
    spyOn(Bank, 'ready').mockReturnValue(true);
    spyOn(Bank, 'loaded').mockReturnValue(true);
    spyOn(Bank, 'items').mockImplementation(() => [inv(995, 'Coins', state.bankCoins).snap, inv(333, 'Trout', state.bankTrout).snap]);
    spyOn(Bank, 'close').mockImplementation(async () => { state.bank = false; return true; });
    spyOn(Banking, 'open').mockImplementation(async () => { state.bank = true; return true; });
    spyOn(Bank, 'withdrawX').mockImplementation(async (name, qty) => {
        state.withdrawals.push(name);
        if (name === 'Coins') { state.coins += qty; state.bankCoins -= qty; }
        else if (name === 'Trout') { state.trout += qty; state.bankTrout -= qty; }
        else return false;
        return true;
    });
    spyOn(Modals, 'close').mockImplementation(async () => { state.bank = false; return true; });
    spyOn(Modals, 'closeIfOpen').mockImplementation(async () => { state.bank = false; });
    spyOn(Quests, 'status').mockReturnValue('inProgress');
    spyOn(Quests, 'points').mockReturnValue(200);
    spyOn(runemysteries, 'readStage').mockImplementation(async () => 4);
    spyOn(runemysteries, 'decide').mockImplementation(() => ({ kind: 'custom', name: 'continue current quest stage', run: async () => { state.questActions++; return true; } }));
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    const engine = new QuestEngine(host);
    engine['runningId'] = 'runemysteries';
    engine['provisioned'].add('runemysteries');
    engine['coinsDrawn'].add('runemysteries');
    engine['foodDrawn'].add('runemysteries');
    engine['potionsDrawn'].add('runemysteries');
    engine['prepared'].add('runemysteries');
    engine['deposited'].add('runemysteries');
    engine['freshened'].add('runemysteries');
    return { engine, state, host };
}

function pendingPreparation(engine: QuestEngine): void {
    engine['preparation'] = { id: 'runemysteries', request: { food: { item: 'Trout', count: 8 } },
        reset: new QuestBankReset('Trout'), phase: 'bank', tries: 0 };
}

test('another Restart during partial recovery preserves and restores the original loadout', async () => {
    const { engine, state } = fixture();
    let pack: RecoveryItem[] = [{ id: 1438, name: 'Air talisman', count: 1 }];
    let worn: RecoveryItem[] = [{ id: 1333, name: 'Rune scimitar', count: 1 }];
    const bank: RecoveryItem[] = [];
    let refuse = true;
    const port: QuestBankResetPort = {
        inventory: () => pack, equipment: () => worn, tile: () => ({ x: 3093, z: 3243, level: 0 }), inCombat: () => false,
        openBank: async () => true, closeBank: async () => true, bankInventory: async () => pack,
        depositAll: async () => { bank.push(...pack); pack = []; },
        unequip: async id => { pack.push(...worn.filter(item => item.id === id)); worn = worn.filter(item => item.id !== id); return true; },
        withdraw: async id => {
            if (refuse) return false;
            const index = bank.findIndex(item => item.id === id);
            if (index < 0) return false;
            pack.push(...bank.splice(index, 1));
            return true;
        },
        equip: async id => { worn.push(...pack.filter(item => item.id === id)); pack = pack.filter(item => item.id !== id); return true; },
        runStep: async () => true
    };
    const reset = new QuestBankReset(null, port);
    engine['recovery'] = { id: 'runemysteries', mode: 'bank', reset, tries: 0 };
    await engine.execute();
    expect(worn).toEqual([]);
    expect(reset.pending).toBe(true);
    refuse = false;
    state.restart = true;
    await engine.execute();
    expect(worn).toEqual([{ id: 1333, name: 'Rune scimitar', count: 1 }]);
    expect(pack).toEqual([{ id: 1438, name: 'Air talisman', count: 1 }]);
    expect(reset.pending).toBe(false);
    expect(state.finished).toBe('');
});

test('Skip before the preparation bank succeeds stops safely instead of changing quests', async () => {
    const { engine, state } = fixture();
    pendingPreparation(engine);
    spyOn(QuestBankReset.prototype, 'prepare').mockImplementation(async function (this: QuestBankReset) { this.reason = 'deliver the Karamja rum before a bank reset'; return false; });
    await engine.execute();
    state.skip = true;
    await engine.execute();
    await engine.execute();
    expect(state.finished).toContain('cannot safely prepare');
    expect(state.active).toBe('runemysteries');
    expect(state.questActions).toBe(0);
    expect(state.preparations).toBe(0);
});

test('an exit error before the preparation snapshot cannot advance to another quest', async () => {
    const { engine, state } = fixture();
    pendingPreparation(engine);
    spyOn(QuestBankReset.prototype, 'prepare').mockRejectedValue(new Error('quest exit failed'));
    for (let tick = 0; tick < 3; tick++) await engine.execute();
    expect(state.finished).toContain('cannot safely finish preparation');
    expect(state.active).toBe('runemysteries');
    expect(state.questActions).toBe(0);
    expect(state.preparations).toBe(0);
});

for (const mode of ['preparation', 'recovery'] as const) {
    test(`${mode} re-enables food and coin withdrawals without gathering consumed start items again`, async () => {
        const { engine, state } = fixture();
        runemysteries.food = 8;
        runemysteries.record.items = [{ name: 'Already consumed quest ingredient', qty: 1, kind: 'mustHave' }];
        spyOn(QuestBankReset.prototype, 'prepare').mockImplementation(async () => { state.bank = true; return true; });
        spyOn(QuestBankReset.prototype, 'tick').mockResolvedValue(true);
        if (mode === 'preparation') pendingPreparation(engine);
        else state.restart = true;
        for (let tick = 0; tick < 12 && !state.questActions && !state.finished; tick++) await engine.execute();
        expect(state.finished).toBe('');
        expect(state.trout).toBe(8);
        expect(state.coins).toBe(1000);
        expect(state.withdrawals).toEqual(['Coins', 'Trout']);
        expect(state.questActions).toBe(1);
        expect(state.active).toBe('runemysteries');
    });
}

for (const reason of ['skip', 'restart', 'failure'] as const) {
    test(`${reason} during preparation leaves the activity area before restoring the quest pack`, async () => {
        const { engine, state, host } = fixture();
        pendingPreparation(engine);
        const task = engine['preparation']!;
        task.phase = 'work';
        Object.defineProperty(task.reset, 'pending', { get: () => true });
        const order: string[] = [];
        host.stopPreparation = () => { order.push('stop'); };
        host.exitPreparation = async () => { order.push('exit'); };
        spyOn(task.reset, 'restore').mockImplementation(async () => { order.push('restore'); return true; });
        if (reason === 'failure') host.prepare = async () => { throw new Error('Arena activity failed'); };
        else state[reason] = true;
        await engine.execute();
        if (reason === 'failure') await engine.execute();
        expect(order).toEqual(['stop', 'exit', 'restore']);
        expect(state.finished).toBe('');
    });
}

test('a failed activity exit retains the quest pack snapshot and stops after bounded retries', async () => {
    const { engine, state, host } = fixture();
    pendingPreparation(engine);
    const task = engine['preparation']!;
    task.phase = 'restore';
    Object.defineProperty(task.reset, 'pending', { get: () => true });
    const restore = spyOn(task.reset, 'restore').mockResolvedValue(true);
    host.exitPreparation = async () => { throw new Error('Arena exit failed'); };
    for (let tick = 0; tick < 3; tick++) await engine.execute();
    expect(restore).not.toHaveBeenCalled();
    expect(engine['preparation']).toBe(task);
    expect(state.finished).toContain('Arena exit failed');
});
