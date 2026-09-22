import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Input } from '#/bot/input/Input.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import GatheringBot from '#/bot/scripts/GatheringBot/GatheringBot.js';
import { BankCatch, DropProduct } from '#/bot/scripts/GatheringBot/GatheringBotTasks.js';
import { wcTickManipProfile } from '#/bot/scripts/GatheringBot/TickManipLogic.js';
import '#/bot/scripts/index.js';

afterEach(() => mock.restore());

function fixture(names: string[]) {
    const bot = ScriptRegistry.get('Miner')?.create();
    expect(bot).toBeInstanceOf(GatheringBot);
    if (!(bot instanceof GatheringBot)) throw new Error('Miner missing');
    bot['productKeywords'] = ['iron', 'coal'];
    bot['rockIds'] = new Set([2092, 2096]);
    bot['powerMode'] = true;
    const state = {
        items: names.map((name, slot): InvItemSnapshot => ({
            name, slot, id: name === 'Iron ore' ? 440 : 1000 + slot,
            count: 1, comId: 3214, ops: [null, null, null, null, 'Drop']
        })),
        pending: new Set<number>(),
        batches: new Array<number[]>(),
        accept: (slot: number) => { state.pending.add(slot); },
        confirm: () => { state.items = state.items.filter(i => !state.pending.has(i.slot)); }
    };
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'inventory').mockImplementation(() => state.items);
    spyOn(Input, 'heldOp').mockImplementation((id, slot, com, op) => {
        expect(state.items.find(i => i.slot === slot)?.id).toBe(id);
        expect([com, op]).toEqual([3214, 5]);
        state.accept(slot);
        return true;
    });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => {
        state.batches.push([...state.pending]);
        state.confirm();
        state.pending.clear();
        return condition();
    });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => {
        state.batches.push([...state.pending]);
        state.confirm();
        state.pending.clear();
        return condition();
    });
    return { bot, state, task: new DropProduct(bot) };
}

test('clears 27 ore in one confirmation and keeps an iron pickaxe', async () => {
    const { task, state } = fixture(['Iron pickaxe', ...Array<string>(27).fill('Iron ore')]);
    expect(task.validate()).toBe(true);
    await task.execute();
    expect(state.items.map(i => i.name)).toEqual(['Iron pickaxe']);
    expect(state.batches.map(batch => batch.length)).toEqual([27]);
});

test('waits for the five-actions-per-tick server queue before retrying', async () => {
    const { task, state } = fixture(['Iron pickaxe', ...Array<string>(27).fill('Iron ore')]);
    spyOn(Execution, 'delayUntil').mockImplementation(async (condition, timeout = 6000) => {
        state.batches.push([...state.pending]);
        for (let elapsed = 600; elapsed <= timeout && !condition(); elapsed += 600) {
            for (const slot of [...state.pending].slice(0, 5)) {
                state.items = state.items.filter(item => item.slot !== slot);
                state.pending.delete(slot);
            }
        }
        return condition();
    });
    await task.execute();
    expect(state.items.map(item => item.name)).toEqual(['Iron pickaxe']);
    expect(state.batches.map(batch => batch.length)).toEqual([27]);
});

test.each([
    ['Clay', 'Clay'], ['Copper', 'Copper ore'], ['Tin', 'Tin ore'], ['Iron', 'Iron ore'],
    ['Silver', 'Silver ore'], ['Coal', 'Coal'], ['Gold', 'Gold ore'], ['Mithril', 'Mithril ore'],
    ['Adamantite', 'Adamantite ore'], ['Runite', 'Runite ore']
])('drops %s while preserving other items', async (selection, ore) => {
    const { bot, task, state } = fixture(['Rune pickaxe', ore, 'Lobster', 'Coins']);
    bot['productKeywords'] = [selection.toLowerCase()];
    await task.execute();
    expect(state.items.map(item => item.name)).toEqual(['Rune pickaxe', 'Lobster', 'Coins']);
});

test('keeps supplies and unselected ore when dropping a mixed haul', async () => {
    const { task, state } = fixture(['Iron pickaxe', 'Iron ore', 'Coal', 'Gold ore', 'Lobster', 'Coins', 'Uncut sapphire']);
    await task.execute();
    expect(state.items.map(i => i.name)).toEqual(['Iron pickaxe', 'Gold ore', 'Lobster', 'Coins', 'Uncut sapphire']);
    expect(state.batches).toEqual([[1, 2]]);
});

test('retries only the ore left after a partially accepted batch', async () => {
    const { task, state } = fixture(['Iron pickaxe', 'Iron ore', 'Coal']);
    let first = true;
    state.confirm = () => {
        state.items = state.items.filter(i => first ? i.slot !== 1 : !state.pending.has(i.slot));
        first = false;
    };
    await task.execute();
    expect(state.items.map(i => i.name)).toEqual(['Iron pickaxe']);
    expect(state.batches).toEqual([[1, 2], [2]]);
});

test('stops after bounded retries when the server never confirms drops', async () => {
    const { task, state } = fixture(['Iron pickaxe', 'Iron ore']);
    state.confirm = () => {};
    await expect(task.execute()).rejects.toThrow('could not clear');
    expect(state.batches).toEqual([[1], [1], [1]]);
    expect(state.items.map(i => i.name)).toEqual(['Iron pickaxe', 'Iron ore']);
});

test('keeps configured food and drops a full haul instead of banking', () => {
    const { bot, task } = fixture(['Iron pickaxe', 'Lobster', 'Lobster', ...Array<string>(25).fill('Iron ore')]);
    bot['minerFood'] = { name: 'Lobster', target: 2 };
    spyOn(Skills, 'effective').mockReturnValue(99);
    spyOn(Skills, 'level').mockReturnValue(99);
    expect(bot.shouldEatMinerFood()).toBe(false);
    expect(new BankCatch(bot).validate()).toBe(false);
    expect(task.validate()).toBe(true);
});

test('still eats for missing HP and restocks exhausted food', () => {
    const { bot, state } = fixture(['Iron pickaxe', 'Lobster', ...Array<string>(26).fill('Iron ore')]);
    bot['minerFood'] = { name: 'Lobster', target: 2 };
    spyOn(Skills, 'effective').mockReturnValue(80);
    spyOn(Skills, 'level').mockReturnValue(99);
    expect(bot.shouldEatMinerFood()).toBe(true);
    state.items = state.items.filter(item => item.name !== 'Lobster');
    expect(new BankCatch(bot).validate()).toBe(true);
});

test('a full ore inventory does not start a desert camp bank trip', () => {
    const { bot } = fixture(['Iron pickaxe', 'Lobster', 'Lobster', ...Array<string>(25).fill('Iron ore')]);
    bot['minerFood'] = { name: 'Lobster', target: 2 };
    expect(bot['desertCampDirection']()).toBe('enter');
    expect(bot.desertCampBankCatchNeeded()).toBe(false);
});

test('bank mode still sends a full ore inventory to the bank', () => {
    const { bot } = fixture(['Rune pickaxe', ...Array<string>(27).fill('Iron ore')]);
    bot['powerMode'] = false;
    expect(new BankCatch(bot).validate()).toBe(true);
});

test('a power miner with no ore space enters supply handling instead of stalling', () => {
    const { bot, task } = fixture(['Rune pickaxe', ...Array<string>(27).fill('Lobster')]);
    bot['minerFood'] = { name: 'Lobster', target: 27 };
    spyOn(Skills, 'effective').mockReturnValue(99);
    spyOn(Skills, 'level').mockReturnValue(99);
    expect(bot.shouldEatMinerFood()).toBe(false);
    expect(task.validate()).toBe(false);
    expect(new BankCatch(bot).validate()).toBe(true);
});

test('drops raw fish in one batch and keeps cooked food and fishing gear', async () => {
    const { bot, state } = fixture(['Fly fishing rod', 'Feather', 'Raw trout', 'Raw salmon', 'Trout', 'Lobster']);
    bot['rockIds'] = new Set();
    bot['productKeywords'] = ['raw'];
    await bot.dropProducts();
    expect(state.items.map(item => item.name)).toEqual(['Fly fishing rod', 'Feather', 'Trout', 'Lobster']);
    expect(state.batches).toEqual([[2, 3]]);
});

test('drops logs in one batch and keeps the axe', async () => {
    const { bot, state } = fixture(['Rune axe', 'Logs', 'Oak logs', 'Willow logs']);
    bot['rockIds'] = new Set();
    bot['productKeywords'] = ['log'];
    await bot.dropProducts();
    expect(state.items.map(item => item.name)).toEqual(['Rune axe']);
    expect(state.batches).toEqual([[1, 2, 3]]);
});

test('keeps one fletchable log during knife delay and confirms the rest together', async () => {
    const { bot, state } = fixture(['Rune axe', 'Knife', 'Logs', 'Logs', 'Logs']);
    bot['rockIds'] = new Set();
    bot['productKeywords'] = ['log'];
    bot['tickManip'] = wcTickManipProfile('knife-delay');
    await bot.dropProducts();
    expect(state.items.map(item => item.name)).toEqual(['Rune axe', 'Knife', 'Logs']);
    expect(state.batches.map(batch => batch.length)).toEqual([2]);
    await bot.dropProducts();
    expect(state.batches.map(batch => batch.length)).toEqual([2]);
});
