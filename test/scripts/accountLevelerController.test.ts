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
