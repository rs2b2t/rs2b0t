import { expect, spyOn, test } from 'bun:test';
import AccountLeveler from '#/bot/scripts/AccountLeveler/AccountLeveler.js';
import { planNext } from '#/bot/scripts/AccountLeveler/planner.js';
import { LoopingBot } from '#/bot/api/bot/Bot.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { BotHost } from '#/bot/runtime/BotHost.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { ScriptAborted, ScriptContext } from '#/bot/runtime/ScriptContext.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';

test('a pending bank operation reports its action and position without claiming progress', async () => {
    let now = 1000;
    let frame: () => void = () => {};
    let finish: (opened: boolean) => void = () => {};
    const pending = new Promise<boolean>(resolve => { finish = resolve; });
    const previous = ScriptRunner.ctx;
    ScriptRunner.ctx = new ScriptContext();
    const patches = [
        spyOn(Date, 'now').mockImplementation(() => now),
        spyOn(Execution, 'delayUntil').mockImplementation(async cond => cond()),
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Game, 'tile').mockReturnValue({ x: 2595, z: 3419, level: 0 }),
        spyOn(Bank, 'items').mockReturnValue([]),
        spyOn(Bank, 'ready').mockReturnValue(false),
        spyOn(BotHost, 'addFrameListener').mockImplementation(callback => { frame = callback; return () => {}; })
    ];
    const bot = new AccountLeveler();
    const logs: string[] = [];
    bot.bindLog(message => logs.push(message));
    patches.push(spyOn(bot['supplies'], 'bank').mockImplementation(() => pending));
    let loop: Promise<void> | undefined;
    try {
        await bot.onStart();
        loop = bot.loop();
        const before = logs.length;
        now += 29000;
        frame();
        expect(logs.length).toBe(before);
        const progress = ScriptRunner.ctx!.lastReportedProgressAt;
        now += 1000;
        frame();
        expect(logs.length).toBe(before + 1);
        expect(logs.at(-1)).toContain('nearest bank');
        expect(logs.at(-1)).toContain('2595,3419,0');
        expect(ScriptRunner.ctx!.lastReportedProgressAt).toBe(progress);
        frame();
        expect(logs.length).toBe(before + 1);
    } finally {
        finish(false);
        await loop;
        bot.onStop();
        bot.disposeSubscriptions();
        ScriptRunner.ctx = previous;
        for (const patch of patches) patch.mockRestore();
    }
});

test('reaching combat 15 finishes the current fight then banks for food without resuming the death walk', async () => {
    const bot = new AccountLeveler();
    let fighting = true;
    const plan = { id: 'lumbridge-chickens', objective: 'attack', label: 'Chickens (death walk)', script: 'AutoFighter', deathWalk: true, combat: true, needs: [], settings: {} };
    const patches = [
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Game, 'tile').mockReturnValue({ x: 3230, z: 3298, level: 0 }),
        spyOn(Game, 'inCombat').mockImplementation(() => fighting),
        spyOn(Skills, 'level').mockImplementation(skill => skill === 'hitpoints' ? 17 : ['attack', 'strength', 'defence'].includes(String(skill)) ? 12 : 1),
        spyOn(Skills, 'xp').mockReturnValue(0),
        spyOn(Bank, 'ready').mockReturnValue(false),
        spyOn(Bank, 'items').mockReturnValue([]),
        spyOn(Inventory, 'items').mockReturnValue([]),
        spyOn(Equipment, 'items').mockReturnValue([])
    ];
    try {
        bot['phase'] = 'train';
        bot['session'].start(plan, Date.now(), () => 0);
        bot['pendingPlans'] = [plan];
        await bot.loop();
        expect(bot['session'].plan).toBe(plan);
        fighting = false;
        await bot.loop();
        expect(String(bot['phase'])).toBe('bank');
        expect(bot['session'].plan).toBeNull();
        expect(bot['retry']).toBeNull();
        expect(bot['pendingPlans']).toEqual([]);
        expect(bot['session'].memory.cooldowns).toEqual({});
        expect(bot['status']).toContain('food');
    } finally { bot.onStop(); for (const patch of patches) patch.mockRestore(); }
});

test.each(['retry', 'pendingPlans'] as const)('combat 15 replaces a stale death walk from %s with food preparation', async source => {
    const bot = new AccountLeveler();
    const plan = { id: 'lumbridge-chickens', objective: 'attack', label: 'Chickens (death walk)', script: 'AutoFighter', deathWalk: true, combat: true, needs: [], settings: {} };
    const patches = [
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Skills, 'level').mockImplementation(skill => skill === 'hitpoints' ? 17 : ['attack', 'strength', 'defence'].includes(String(skill)) ? 12 : 1),
        spyOn(Bank, 'ready').mockReturnValue(true),
        spyOn(Bank, 'items').mockReturnValue([{ id: 995, name: 'Coins', count: 100000, slot: 0, comId: 5382, ops: [] }]),
        spyOn(Inventory, 'items').mockReturnValue([]),
        spyOn(Equipment, 'items').mockReturnValue([]),
        spyOn(bot['supplies'], 'bank').mockResolvedValue(true),
        spyOn(bot['supplies'], 'deposit').mockRejectedValue(new Error('test bank failure')),
        spyOn(ScriptRegistry, 'get').mockReturnValue({ name: 'Fisher', description: '', create: () => bot })
    ];
    try {
        bot['shoppingChecked'] = true;
        if (source === 'retry') bot['retry'] = plan;
        else bot['pendingPlans'] = [plan];
        await expect(bot['selectAndStart']()).rejects.toThrow('test bank failure');
        expect(bot['session'].plan?.script).toBe('Fisher');
        expect(bot['pendingPlans'].map(next => next.script)).toEqual(['CookBot', 'AutoFighter']);
        expect(bot['pendingPlans'].at(-1)?.deathWalk).toBe(false);
    } finally { bot.onStop(); for (const patch of patches) patch.mockRestore(); }
});

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
        expect(String(bot['phase'])).toBe('bank');
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
    const tile = spyOn(Game, 'tile').mockReturnValue({ x: 2725, z: 3491, level: 0 });
    const snapshot = { levels: {}, stock: { coins: 50000 }, bankReady: true, quests: {}, target: 40, wilderness: false, now: 1 };
    try {
        setWorld(2);
        expect(await bot['tryMarketAxe'](snapshot)).toBe(false);
        expect(buy).not.toHaveBeenCalled();
        setWorld(1);
        for (const here of [null, { x: 3092, z: 3245, level: 0 }, { x: 2725, z: 3491, level: 1 }, { x: 2725, z: 3620, level: 0 }]) {
            tile.mockReturnValue(here);
            expect(await bot['tryMarketAxe'](snapshot)).toBe(false);
            expect(bot['marketChecked']).toBe(false);
            expect(deposit).not.toHaveBeenCalled();
            expect(buy).not.toHaveBeenCalled();
        }
        tile.mockReturnValue({ x: 2809, z: 3440, level: 0 });
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
        for (const patch of [deposit, withdraw, close, bank, buy, name, tile]) patch.mockRestore();
    }
});

test('supply shopping walks avoid White Wolf Mountain when returning east', async () => {
    const bot = new AccountLeveler();
    const destination = { x: 3231, z: 3203, level: 0 };
    const walk = spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    try {
        expect(await bot['supplies'].walk(destination)).toBe(true);
        expect(walk.mock.calls[0][0]).toEqual(destination);
        expect(walk.mock.calls[0][1]).toMatchObject({ avoidZones: ['white-wolf-mountain'] });
    } finally { walk.mockRestore(); }
});

test.each([0, 200])('parent travel avoids White Wolf Mountain with fare %i and refuses unfunded crossings', async coins => {
    const bot = new AccountLeveler();
    const travel = { x: 2809, z: 3440, level: 0 };
    const walk = spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    const start = spyOn(bot['activity'], 'start').mockImplementation(async () => {
        expect(walk).toHaveBeenCalledTimes(1);
    });
    const patches = [
        walk, start,
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Game, 'tile').mockReturnValue({ x: 3092, z: 3245, level: 0 }),
        spyOn(Skills, 'level').mockImplementation(skill => skill === 'cooking' ? 20 : 40),
        spyOn(Skills, 'xp').mockReturnValue(0),
        spyOn(Bank, 'ready').mockReturnValue(true),
        spyOn(Bank, 'items').mockReturnValue([]),
        spyOn(Inventory, 'items').mockReturnValue([]),
        spyOn(Equipment, 'items').mockReturnValue([]),
        spyOn(bot['supplies'], 'bank').mockResolvedValue(true),
        spyOn(bot['supplies'], 'deposit').mockResolvedValue(),
        spyOn(bot['supplies'], 'closeBank').mockResolvedValue(true),
        spyOn(Inventory, 'count').mockImplementation(item => item === 'Coins' ? coins : 0),
        spyOn(ScriptRegistry, 'get').mockReturnValue({ name: 'CookBot', description: '', create: () => bot })
    ];
    try {
        bot['shoppingChecked'] = true;
        bot['retry'] = { id: 'cook-catherby', label: 'Catherby cooking', script: 'CookBot', objective: 'cooking', settings: {}, needs: [], travel };
        if (!coins) {
            await expect(bot['selectAndStart']()).rejects.toThrow('60 Coins for the coastal boat route');
            expect(walk).not.toHaveBeenCalled();
            expect(start).not.toHaveBeenCalled();
            return;
        }
        await bot['selectAndStart']();
        expect(walk.mock.calls[0][0]).toEqual(travel);
        expect(walk.mock.calls[0][1]).toMatchObject({ avoidZones: ['white-wolf-mountain'] });
        expect(start).toHaveBeenCalledTimes(1);
        expect(String(bot['phase'])).toBe('train');
    } finally { bot.onStop(); for (const patch of patches) patch.mockRestore(); }
});

test.each([true, false])('exhausted route replans without stopping and cools down only combat camps: %s', async combat => {
    const bot = new AccountLeveler();
    const now = 1000000;
    const objective = combat ? 'attack' : 'cooking';
    const plan = { id: combat ? 'lumbridge-chickens' : 'cook-shrimps', label: 'unreachable site', script: combat ? 'AutoFighter' : 'CookBot', objective, settings: {}, needs: [], combat, travel: { x: 3230, z: 3298, level: 0 } };
    const walk = spyOn(Traversal, 'walkResilient').mockResolvedValue(false);
    const finish = spyOn(bot, 'requestFinish').mockImplementation(() => {});
    const start = spyOn(bot['activity'], 'start').mockResolvedValue();
    const patches = [
        walk, finish, start,
        spyOn(Date, 'now').mockReturnValue(now),
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Game, 'tile').mockReturnValue({ x: 3092, z: 3245, level: 0 }),
        spyOn(Skills, 'level').mockImplementation(skill => skill === objective ? 1 : 40),
        spyOn(Bank, 'ready').mockReturnValue(true),
        spyOn(Bank, 'items').mockReturnValue([{ id: 995, name: 'Coins', count: 100000, slot: 0, comId: 5382, ops: [] }]),
        spyOn(Inventory, 'items').mockReturnValue([]),
        spyOn(Equipment, 'items').mockReturnValue([]),
        spyOn(bot['supplies'], 'bank').mockResolvedValue(true),
        spyOn(bot['supplies'], 'deposit').mockResolvedValue(),
        spyOn(bot['supplies'], 'closeBank').mockResolvedValue(true),
        spyOn(ScriptRegistry, 'get').mockReturnValue({ name: plan.script, description: '', create: () => bot })
    ];
    try {
        bot['shoppingChecked'] = true;
        bot['resetCount'] = 2;
        bot['retry'] = plan;
        bot['pendingPlans'] = [plan];
        await bot.loop();
        expect(walk).toHaveBeenCalledTimes(1);
        expect(walk.mock.calls[0][1]).toMatchObject({ attempts: 4, timeoutMs: 120000 });
        expect(start).not.toHaveBeenCalled();
        expect(bot['lastFailure']?.reason).toContain('Cannot reach');
        if (!combat) {
            expect(finish).not.toHaveBeenCalled();
            expect(bot['waitingUntil']).toBeGreaterThan(now);
            expect(bot['retry']).toBeNull();
            expect(bot['pendingPlans']).toEqual([]);
            expect(bot['resetCount']).toBe(3);
            expect(bot['session'].memory.cooldowns).toEqual({});
            return;
        }
        expect(finish).not.toHaveBeenCalled();
        expect(bot['resetCount']).toBe(2);
        expect(bot['session'].memory.cooldowns[plan.id]).toBe(now + 900000);
        expect(bot['session'].memory.objective).toBe(objective);
        expect(bot['session'].plan).toBeNull();
        expect(bot['retry']).toBeNull();
        expect(bot['pendingPlans']).toEqual([]);
        expect(String(bot['phase'])).toBe('bank');
        const next = planNext(bot['snapshot'](), bot['session'].memory, () => 0);
        expect(next.kind).toBe('activity');
        if (next.kind !== 'activity') throw new Error('No replacement activity');
        expect(next.queue.at(-1)?.combat).toBe(true);
        expect(next.plan.objective).toBe(objective);
        expect(next.plan.id).not.toBe(plan.id);
    } finally { bot.onStop(); for (const patch of patches) patch.mockRestore(); }
});

test('bank preparation errors do not count as failed fishing attempts', async () => {
    const bot = new AccountLeveler();
    const finish = spyOn(bot, 'requestFinish').mockImplementation(() => {});
    const name = spyOn(Game, 'myName').mockReturnValue(null);
    const tile = spyOn(Game, 'tile').mockReturnValue({ x: 3092, z: 3245, level: 0 });
    const plan = { id: 'fish-shrimps', label: 'fish shrimps', script: 'Fisher', objective: 'attack', settings: {}, needs: [] };
    try {
        bot['session'].start(plan, Date.now(), () => 0);
        for (let n = 0; n < 3; n++) bot['fail']('Could not open a loaded bank');
        expect(bot['session'].memory.cooldowns).toEqual({});
        expect(finish).not.toHaveBeenCalled();
        expect(bot['lastFailure']?.reason).toBe('Could not open a loaded bank');
        expect(bot['waitingUntil']).toBeGreaterThan(Date.now());
    } finally { bot.onStop(); for (const patch of [finish, name, tile]) patch.mockRestore(); }
});

test('saved gathering cooldowns are removed while the original failure survives diagnostic history rotation', () => {
    const bot = new AccountLeveler();
    let saved = JSON.stringify({ cooldowns: { 'fish-shrimps': Date.now() + 900000, 'lumbridge-goblins': Date.now() + 900000 }, diagnostics: {} });
    const storage = bot['storage'];
    bot['storage'] = () => ({ getItem: () => saved, setItem: (_key, value) => { saved = value; } });
    const name = spyOn(Game, 'myName').mockReturnValue('leveler-test');
    const tile = spyOn(Game, 'tile').mockReturnValue({ x: 3092, z: 3245, level: 0 });
    try {
        bot['load']();
        expect(bot['session'].memory.cooldowns['fish-shrimps']).toBeUndefined();
        expect(bot['session'].memory.cooldowns['lumbridge-goblins']).toBeGreaterThan(Date.now());
        bot['fail']('Could not open a loaded bank');
        for (let n = 0; n < 30; n++) bot['actions'].note(`walk ${n}`);
        bot['save']();
        const diagnostic = JSON.parse(saved).diagnostics;
        expect(diagnostic.failure).toMatchObject({ reason: 'Could not open a loaded bank', phase: 'bank' });
        expect(diagnostic.history.some((event: { message: string }) => event.message.includes('loaded bank'))).toBe(false);
        bot['load'](); bot['save']();
        expect(JSON.parse(saved).diagnostics.failure.reason).toBe('Could not open a loaded bank');
    } finally { bot.onStop(); bot['storage'] = storage; for (const patch of [name, tile]) patch.mockRestore(); }
});

test('empty shop stock retries without blacklisting the item or the activity', async () => {
    const { SupplyStockError } = await import('#/bot/scripts/AccountLeveler/supplies.js');
    const bot = new AccountLeveler();
    const patches = [
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Game, 'tile').mockReturnValue({ x: 3253, z: 3420, level: 0 }),
        spyOn(bot['supplies'], 'bank').mockRejectedValue(new SupplyStockError('Lowe has no Bronze arrow', ['Bronze arrow']))
    ];
    try {
        bot['session'].start({ id: 'goblins', objective: 'ranged', label: 'goblins', script: 'AutoFighter', needs: [], settings: {}, combat: true }, Date.now(), () => 0);
        const before = Date.now();
        await bot.loop();
        expect(bot['unavailableItems'].size).toBe(0);
        expect(bot['session'].memory.cooldowns).toEqual({});
        expect(bot['temporarilyUnavailable'].get('bronze arrow')).toBeGreaterThanOrEqual(before + 60000);
        expect(bot['waitingUntil']).toBeGreaterThanOrEqual(before + 3000);
        expect(String(bot['phase'])).toBe('bank');
        expect(bot['actions'].current).toContain('shop restocks');
    } finally { bot.onStop(); for (const patch of patches) patch.mockRestore(); }
});

test('consuming the last equipped arrow triggers resupply rather than a failed combat attempt', async () => {
    const bot = new AccountLeveler();
    const patches = [
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Game, 'tile').mockReturnValue({ x: 3253, z: 3420, level: 0 }),
        spyOn(Game, 'inCombat').mockReturnValue(false),
        spyOn(Skills, 'level').mockReturnValue(1),
        spyOn(Bank, 'ready').mockReturnValue(false),
        spyOn(Bank, 'items').mockReturnValue([]),
        spyOn(Inventory, 'items').mockReturnValue([]),
        spyOn(Equipment, 'items').mockReturnValue([])
    ];
    try {
        bot['session'].start({ id: 'goblins', objective: 'ranged', label: 'goblins', script: 'AutoFighter', needs: [{ item: 'Bronze arrow', count: 1, carry: 1, minimum: 1, equip: true }], settings: {}, combat: true }, Date.now(), () => 0);
        bot['phase'] = 'train';
        await bot.loop();
        expect(String(bot['phase'])).toBe('bank');
        expect(bot['session'].memory.cooldowns).toEqual({});
        expect(bot['actions'].current).toContain('Supplies exhausted');
    } finally { bot.onStop(); for (const patch of patches) patch.mockRestore(); }
});


test('repeated bank failures keep retrying with bounded backoff and respect cancellation', async () => {
    const bot = new AccountLeveler();
    let now = 1000000;
    const finish = spyOn(bot, 'requestFinish').mockImplementation(() => {});
    const bank = spyOn(bot['supplies'], 'bank').mockResolvedValue(false);
    const patches = [finish, bank,
        spyOn(Date, 'now').mockImplementation(() => now),
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Game, 'tile').mockReturnValue({ x: 3092, z: 3245, level: 0 })
    ];
    try {
        const delays: number[] = [];
        for (let attempt = 1; attempt <= 12; attempt++) {
            await bot.loop();
            expect(bank).toHaveBeenCalledTimes(attempt);
            expect(finish).not.toHaveBeenCalled();
            const delay = bot['waitingUntil'] - now;
            delays.push(delay);
            expect(delay).toBeGreaterThan(0);
            expect(delay).toBeLessThanOrEqual(60000);
            await bot.loop();
            expect(bank).toHaveBeenCalledTimes(attempt);
            now = bot['waitingUntil'] + 1;
        }
        expect(delays.at(-1)).toBe(60000);
        expect(delays[2]).toBeGreaterThan(delays[0]);
        expect(bot['lastFailure']?.reason).toBe('Nearest bank could not be opened');
        bank.mockRejectedValue(new ScriptAborted());
        await expect(bot.loop()).rejects.toBeInstanceOf(ScriptAborted);
        expect(finish).not.toHaveBeenCalled();
    } finally { bot.onStop(); for (const patch of patches) patch.mockRestore(); }
});

test('repeated combat preparation failure abandons the plan, not the account leveler', () => {
    const bot = new AccountLeveler();
    const now = 1000000;
    const finish = spyOn(bot, 'requestFinish').mockImplementation(() => {});
    const patches = [finish, spyOn(Date, 'now').mockReturnValue(now), spyOn(Game, 'myName').mockReturnValue(null)];
    const plan = { id: 'lumbridge-chickens', label: 'chickens', script: 'AutoFighter', objective: 'attack', settings: {}, needs: [], combat: true };
    try {
        bot['session'].start(plan, now, () => 0);
        bot['pendingPlans'] = [plan];
        for (let n = 0; n < 3; n++) bot['fail']('Could not equip weapon');
        expect(finish).not.toHaveBeenCalled();
        expect(bot['retry']).toBeNull();
        expect(bot['pendingPlans']).toEqual([]);
        expect(bot['session'].plan).toBeNull();
        expect(bot['session'].memory.cooldowns[plan.id]).toBeGreaterThan(now);
        expect(bot['session'].memory.objective).toBe('attack');
    } finally { bot.onStop(); for (const patch of patches) patch.mockRestore(); }
});

test('blocked supplies are rechecked and training starts when supplies arrive', async () => {
    const bot = new AccountLeveler();
    let now = 1000000;
    let stocked = false;
    const finish = spyOn(bot, 'requestFinish').mockImplementation(() => {});
    const start = spyOn(bot['activity'], 'start').mockResolvedValue();
    const bank = spyOn(bot['supplies'], 'bank').mockResolvedValue(true);
    const patches = [finish, start, bank,
        spyOn(Date, 'now').mockImplementation(() => now),
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Game, 'tile').mockReturnValue({ x: 3092, z: 3245, level: 0 }),
        spyOn(Game, 'inCombat').mockReturnValue(false),
        spyOn(Skills, 'level').mockImplementation(skill => skill === 'fishing' ? 1 : 40),
        spyOn(Skills, 'xp').mockReturnValue(0),
        spyOn(Bank, 'ready').mockReturnValue(true),
        spyOn(Bank, 'items').mockImplementation(() => stocked ? [{ id: 303, name: 'Small fishing net', count: 1, slot: 0, comId: 5382, ops: [] }] : []),
        spyOn(Bank, 'close').mockResolvedValue(true),
        spyOn(Inventory, 'items').mockReturnValue([]),
        spyOn(Equipment, 'items').mockReturnValue([]),
        spyOn(bot['supplies'], 'stock').mockReturnValue({ 'small fishing net': 1 }),
        spyOn(bot['supplies'], 'held').mockReturnValue(1),
        spyOn(bot['supplies'], 'equipment').mockReturnValue([]),
        spyOn(bot['supplies'], 'deposit').mockResolvedValue(),
        spyOn(bot['supplies'], 'withdraw').mockResolvedValue(true),
        spyOn(bot['supplies'], 'closeBank').mockResolvedValue(true),
        spyOn(Traversal, 'walkResilient').mockResolvedValue(true),
        spyOn(ScriptRegistry, 'get').mockReturnValue({ name: 'Fisher', description: '', create: () => bot })
    ];
    try {
        bot['shoppingChecked'] = true;
        bot['unavailableItems'].add('small fishing net');
        for (let attempt = 0; attempt < 5; attempt++) {
            await bot.loop();
            expect(finish).not.toHaveBeenCalled();
            expect(start).not.toHaveBeenCalled();
            expect(bot['waitingUntil']).toBeGreaterThan(now);
            expect(bot['waitingUntil']).toBeLessThanOrEqual(now + 60000);
            const calls = bank.mock.calls.length;
            await bot.loop();
            expect(bank).toHaveBeenCalledTimes(calls);
            now = bot['waitingUntil'] + 1;
        }
        expect(bot['unavailableItems'].size).toBe(0);
        stocked = true;
        await bot.loop();
        expect(start).toHaveBeenCalledTimes(1);
        expect(bot['session'].plan?.script).toBe('Fisher');
        expect(String(bot['phase'])).toBe('train');
        expect(finish).not.toHaveBeenCalled();
        expect(bot['resetCount']).toBe(0);
    } finally { bot.onStop(); for (const patch of patches) patch.mockRestore(); }
});

test('reaching every target still finishes the leveler', async () => {
    const bot = new AccountLeveler();
    const finish = spyOn(bot, 'requestFinish').mockImplementation(() => {});
    const patches = [finish,
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(Game, 'myName').mockReturnValue(null),
        spyOn(Skills, 'level').mockReturnValue(40),
        spyOn(Bank, 'ready').mockReturnValue(true),
        spyOn(Bank, 'items').mockReturnValue([]),
        spyOn(Bank, 'close').mockResolvedValue(true),
        spyOn(Inventory, 'items').mockReturnValue([]),
        spyOn(Equipment, 'items').mockReturnValue([]),
        spyOn(bot['supplies'], 'bank').mockResolvedValue(true)
    ];
    try {
        bot['shoppingChecked'] = true;
        await bot.loop();
        expect(finish).toHaveBeenCalledTimes(1);
        expect(finish).toHaveBeenCalledWith('All 19 enabled skills reached 40');
    } finally { bot.onStop(); for (const patch of patches) patch.mockRestore(); }
});
