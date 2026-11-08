import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import Tile from '#/bot/geometry/Tile.js';
import { Input } from '#/bot/input/Input.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import HerbloreSecondaries from '#/bot/scripts/HerbloreSecondaries/HerbloreSecondaries.js';

afterEach(() => mock.restore());

async function setup(product: 'Chocolate dust' | 'Unicorn horn dust', count: number) {
    const source = product === 'Chocolate dust' ? 'Chocolate bar' : 'Unicorn horn';
    const item = (id: number, name: string, slot: number): InvItemSnapshot => ({ id, name, slot, count: 1, comId: 3214, ops: ['Use', 'Drop'] });
    let pack = [item(233, 'Pestle and mortar', 0), ...Array.from({ length: count }, (_, i) => item(100, source, i + 1))];
    const queued: Array<{ useId: number; useSlot: number; id: number; slot: number }> = [];
    const state = { interrupt: false, dialog: false, bank: false, consume: true, reject: false, afterTick: () => {}, bursts: [] as number[], made: [] as number[] };
    const tick = async () => {
        let made = 0;
        state.bursts.push(queued.length);
        for (const action of queued.splice(0)) {
            if (!state.consume || !pack.some(i => i.slot === action.useSlot && i.id === action.useId) || !pack.some(i => i.slot === action.slot && i.id === action.id)) continue;
            const index = pack.findIndex(i => i.name === source);
            if (index < 0) continue;
            pack[index] = item(200, product, pack[index].slot);
            made++;
        }
        state.made.push(made);
        state.afterTick();
    };
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(new Tile(3093, 3243, 0));
    spyOn(EventSignal, 'pending').mockImplementation(() => state.interrupt);
    spyOn(ChatDialog, 'isOpen').mockImplementation(() => state.dialog);
    spyOn(Bank, 'isOpen').mockImplementation(() => state.bank);
    spyOn(Input, 'useItemOnItem').mockImplementation((useId, useSlot, _useCom, id, slot) => {
        if (state.reject) return false;
        queued.push({ useId, useSlot, id, slot });
        return true;
    });
    spyOn(Execution, 'delayTicks').mockImplementation(tick);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => {
        if (!predicate()) await tick();
        return predicate();
    });
    const bot = new HerbloreSecondaries();
    bot.settings = new SettingsBag({ secondary: product, foodWithdraw: 0 });
    bot.bindLog(() => {});
    await bot.onStart();
    const grind = bot['tasks'].find(task => task.constructor.name === 'Grind')!;
    return { bot, grind, state, removeTool: () => { pack = pack.filter(i => i.id !== 233); } };
}

for (const product of ['Chocolate dust', 'Unicorn horn dust'] as const) {
    test(`${product} grinds a pack five per tick without reusing a consumed slot`, async () => {
        const { bot, grind, state } = await setup(product, 27);
        await grind.execute();
        expect(state.made).toEqual([5, 5, 5, 5, 5, 2]);
        expect(state.bursts).toEqual([5, 5, 5, 5, 5, 2]);
        expect(bot.productCount()).toBe(27);
        expect(bot['gathered']).toBe(27);
        expect(Inventory.contains('Pestle and mortar')).toBe(true);
    });
}

test('a partial pack sends only the remaining ingredients', async () => {
    const { grind, state } = await setup('Unicorn horn dust', 3);
    await grind.execute();
    expect(state.made).toEqual([3]);
    expect(state.bursts).toEqual([3]);
});

for (const interruption of ['interrupt', 'dialog', 'bank'] as const) {
    test(`grinding yields when ${interruption} becomes active`, async () => {
        const { grind, state, bot } = await setup('Chocolate dust', 12);
        state.afterTick = () => { state[interruption] = true; };
        await grind.execute();
        expect(state.made).toEqual([5]);
        expect(bot.grindLeft()).toBe(7);
        expect(bot['gathered']).toBe(5);
    });
}

test('losing the pestle stops further batches', async () => {
    const { grind, state, removeTool } = await setup('Chocolate dust', 12);
    state.afterTick = removeTool;
    await grind.execute();
    expect(state.made).toEqual([5]);
});

test('unacknowledged actions yield after three ticks without counting production', async () => {
    const { grind, state, bot } = await setup('Unicorn horn dust', 12);
    state.consume = false;
    await grind.execute();
    expect(state.bursts).toEqual([5, 5, 5]);
    expect(bot['gathered']).toBe(0);
});

test('rejected input returns without looping or inventing progress', async () => {
    const { grind, state, bot } = await setup('Chocolate dust', 12);
    state.reject = true;
    await grind.execute();
    expect(state.bursts).toEqual([]);
    expect(bot['gathered']).toBe(0);
});
