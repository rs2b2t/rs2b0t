import { expect, spyOn, test } from 'bun:test';
import AccountLeveler from '#/bot/scripts/AccountLeveler/AccountLeveler.js';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { BotHost } from '#/bot/runtime/BotHost.js';
import { ScriptContext } from '#/bot/runtime/ScriptContext.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';

test('controller observes bank changes and training while a delegated loop is pending', async () => {
    let now = 1000;
    let bankOpen = true;
    let training = false;
    let frame: () => void = () => {};
    let removed = false;
    let entered = false;
    let finish: () => void = () => {};
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const previous = ScriptRunner.ctx;
    ScriptRunner.ctx = new ScriptContext();
    const patches = [
        spyOn(Date, 'now').mockImplementation(() => now),
        spyOn(Execution, 'delayUntil').mockImplementation(async cond => cond()),
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Game, 'tile').mockReturnValue({ x: 3253, z: 3420, level: 0 }),
        spyOn(Game, 'inCombat').mockImplementation(() => training),
        spyOn(Game, 'animating').mockImplementation(() => training),
        spyOn(Skills, 'level').mockReturnValue(1),
        spyOn(Skills, 'xp').mockReturnValue(0),
        spyOn(Inventory, 'items').mockReturnValue([]),
        spyOn(Equipment, 'items').mockReturnValue([]),
        spyOn(Bank, 'isOpen').mockImplementation(() => bankOpen),
        spyOn(Bank, 'ready').mockImplementation(() => bankOpen),
        spyOn(Bank, 'items').mockImplementation(() => bankOpen ? [{ id: 1511, name: 'Logs', count: 28, slot: 0, comId: 5382, ops: [] }] : []),
        spyOn(BotHost, 'addFrameListener').mockImplementation(callback => { frame = callback; return () => { removed = true; }; })
    ];
    const bot = new AccountLeveler();
    try {
        await bot.onStart();
        frame();
        bankOpen = false;
        frame();
        bot['session'].start({ id: 'burn', label: 'burn logs', script: 'Firemaker', objective: 'firemaking', settings: {}, needs: [{ item: 'Logs', count: 28 }] }, now, () => 0);
        bot['phase'] = 'train';
        await bot['activity'].start({ name: 'pending', description: '', create: () => new class extends LoopingBot {
            async loop() { entered = true; await pending; }
        }() }, {});
        frame();
        const loop = bot.loop();
        await Promise.resolve();
        expect(entered).toBe(true);
        training = true;
        for (now = 1600; now <= 61000; now += 600) frame();
        expect(bot['session'].remainingMs).toBe(540000);
        ScriptRunner.ctx!.state = 'paused';
        bot.onPause();
        now += 30000;
        frame();
        expect(bot['session'].remainingMs).toBe(540000);
        ScriptRunner.ctx!.state = 'running';
        bot.onResume();
        now += 600;
        frame();
        expect(bot['session'].remainingMs).toBe(539400);
        finish();
        await loop;
        expect(bot['session'].plan?.id).toBe('burn');
        expect(bot['session'].memory.cooldowns).toEqual({});
    } finally {
        finish();
        bot.onStop();
        bot.disposeSubscriptions();
        ScriptRunner.ctx = previous;
        for (const patch of patches) patch.mockRestore();
    }
    expect(removed).toBe(true);
});

test('a failed optional stock-up is recorded and yields to normal planning on retry', async () => {
    const bot=new AccountLeveler();
    const patches=[
        spyOn(Game,'sceneReady').mockReturnValue(true),
        spyOn(Game,'myName').mockReturnValue(null),
        spyOn(Game,'tile').mockReturnValue({x:3093,z:3244,level:0}),
        spyOn(Skills,'level').mockReturnValue(1),
        spyOn(Bank,'ready').mockReturnValue(true),
        spyOn(Bank,'items').mockReturnValue([{id:995,name:'Coins',count:100000,slot:0,comId:5382,ops:[]}]),
        spyOn(Inventory,'items').mockReturnValue([]),
        spyOn(Equipment,'items').mockReturnValue([]),
        spyOn(bot['supplies'],'bank').mockResolvedValue(true),
        spyOn(bot['supplies'],'deposit').mockRejectedValue(new Error('bank busy'))
    ];
    try {
        await bot.loop();
        expect(bot['shoppingChecked']).toBe(true);
        expect(bot['session'].plan).toBeNull();
        expect(bot['actions'].items.some(item=>item.state==='failed')).toBe(true);
        expect(bot['actions'].history.at(-1)?.message).toContain('resetting at the nearest bank');
        expect(bot['waitingUntil']).toBeGreaterThan(Date.now());
    } finally {bot.onStop();for(const patch of patches)patch.mockRestore();}
});

test('a sold-out tool returns to the bank and excludes the missing tier from replanning', async () => {
    const { SupplyUnavailableError } = await import('#/bot/scripts/AccountLeveler/supplies.js');
    const bot = new AccountLeveler();
    const patches = [
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Game, 'tile').mockReturnValue({ x: 2997, z: 9844, level: 0 }),
        spyOn(bot['supplies'], 'bank').mockRejectedValue(new SupplyUnavailableError('No mithril pickaxes in stock', ['Mithril pickaxe']))
    ];
    try {
        bot['session'].start({ id: 'mine-copper', objective: 'mining', label: 'Mine copper', script: 'Miner', needs: [], settings: {} }, Date.now(), () => 0);
        await bot.loop();
        expect(bot['unavailableItems'].has('mithril pickaxe')).toBe(true);
        expect(bot['session'].plan).toBeNull();
        expect(bot['retry']).toBeNull();
        expect(bot['phase']).toBe('bank');
        expect(bot['actions'].current).toContain('checking available alternatives');
    } finally { bot.onStop(); for (const patch of patches) patch.mockRestore(); }
});

test('optional market procurement is World 1 only, capped, banked and attempted once', async () => {
    const bot = new AccountLeveler();
    const oldLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    const setWorld = (world: number) => Object.defineProperty(globalThis, 'location', { configurable: true, value: { host: 'localhost:8081', search: `?world=${world}` } });
    const deposit = spyOn(bot['supplies'], 'deposit').mockResolvedValue();
    const withdraw = spyOn(bot['supplies'], 'withdraw').mockResolvedValue(true);
    const close = spyOn(bot['supplies'], 'closeBank').mockResolvedValue(true);
    const bank = spyOn(bot['supplies'], 'bank').mockResolvedValue(true);
    const buy = spyOn(bot['marketBuyer'], 'buy').mockResolvedValue(true);
    const name = spyOn(Game, 'myName').mockReturnValue(null);
    const snapshot = { levels: {}, stock: { coins: 50000 }, bankReady: true, quests: {}, target: 40, wilderness: false, now: 1 };
    try {
        setWorld(2);
        expect(await bot['tryMarketAxe'](snapshot)).toBe(false);
        expect(buy).not.toHaveBeenCalled();
        setWorld(1);
        expect(await bot['tryMarketAxe'](snapshot)).toBe(true);
        expect(withdraw).toHaveBeenCalledWith('Coins', 5200);
        expect(buy.mock.calls[0][0]).toMatchObject({ item: 'Rune axe', maxPrice: 5000, world: 1 });
        expect(deposit).toHaveBeenCalledTimes(2);
        expect(bank).toHaveBeenCalledTimes(1);
        expect(await bot['tryMarketAxe'](snapshot)).toBe(false);
        expect(buy).toHaveBeenCalledTimes(1);
    } finally {
        if (oldLocation) Object.defineProperty(globalThis, 'location', oldLocation);
        else Reflect.deleteProperty(globalThis, 'location');
        bot.onStop();
        for (const patch of [deposit, withdraw, close, bank, buy, name]) patch.mockRestore();
    }
});
