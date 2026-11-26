import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import GemCutter from '#/bot/scripts/GemCutter/GemCutter.js';
import { CHISEL_ID } from '#/bot/scripts/GemCutter/GemCutterLogic.js';

let bot: GemCutter;
afterEach(() => {
    bot.disposeSubscriptions();
    mock.restore();
});

async function run(sapphires: number) {
    let open = false;
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 3253, z: 3420, level: 0 });
    spyOn(Skills, 'level').mockReturnValue(20);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Inventory, 'countById').mockImplementation(id => id === CHISEL_ID ? 1 : 0);
    spyOn(Inventory, 'items').mockReturnValue([]);
    spyOn(Inventory, 'free').mockReturnValue(27);
    spyOn(Bank, 'isOpen').mockImplementation(() => open);
    spyOn(Bank, 'openNearestAccess').mockImplementation(async () => { open = true; return true; });
    spyOn(Bank, 'backpackReady').mockResolvedValue(true);
    spyOn(Bank, 'snapshotReady').mockReturnValue(true);
    spyOn(Bank, 'loaded').mockReturnValue(false);
    spyOn(Bank, 'depositAllMatching').mockResolvedValue(undefined);
    spyOn(Bank, 'countById').mockImplementation(id => id === 1623 ? sapphires : 0);
    const withdraw = spyOn(Bank, 'withdrawXById').mockResolvedValue(false);
    const close = spyOn(Bank, 'close').mockImplementation(async () => { open = false; return true; });
    const stop = spyOn(ScriptRunner, 'stop').mockImplementation(() => {});
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    const pause = spyOn(Execution, 'delayTicks').mockRejectedValue(new Error('unexpected fixed wait during bank trip'));
    bot = new GemCutter();
    bot.settings = new SettingsBag({ gems: ['Sapphire'] });
    bot.bindLog(() => {});
    await bot.onStart();
    await bot.loop();
    return { withdraw, close, stop, pause };
}

test('an empty bank closes on the same trip without the 15-second retry loop', async () => {
    const { withdraw, close, stop, pause } = await run(0);
    expect(withdraw).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(pause).not.toHaveBeenCalled();
});

test('a failed withdrawal from a stocked bank leaves the gem eligible for retry', async () => {
    const { withdraw, stop, close } = await run(100);
    expect(withdraw).toHaveBeenCalledWith(1623, 27);
    expect(close).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(bot.targets().map(gem => gem.name)).toEqual(['Sapphire']);
});
