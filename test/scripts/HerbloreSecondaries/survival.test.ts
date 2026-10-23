import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import Tile from '#/bot/geometry/Tile.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import HerbloreSecondaries from '#/bot/scripts/HerbloreSecondaries/HerbloreSecondaries.js';
import { shouldEat } from '#/bot/scripts/HerbloreSecondaries/HerbloreSecondariesLogic.js';

afterEach(() => { mock.restore(); Sustain.set(null); });

test('low-level collectors eat at six HP even when a lobster would overheal', () => {
    expect(shouldEat({ hp: 6, maxHp: 10, heal: 12, foodCount: 9, freeSlots: 19, collecting: false })).toBe(true);
    expect(shouldEat({ hp: 10, maxHp: 10, heal: 12, foodCount: 9, freeSlots: 19, collecting: false })).toBe(false);
});

test('long walks pump the same eating task and stopping clears the hook', async () => {
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Bank, 'isOpen').mockReturnValue(false);
    spyOn(Game, 'tile').mockReturnValue(new Tile(3120, 9952, 0));
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    const bot = new HerbloreSecondaries();
    bot.settings = new SettingsBag({ secondary: "Red spiders' eggs", foodWithdraw: 10 });
    bot.bindLog(() => {});
    await bot.onStart();
    const eat = bot['tasks'].find(task => task.constructor.name === 'Eat')!;
    spyOn(eat, 'validate').mockReturnValue(true);
    const execute = spyOn(eat, 'execute').mockImplementation(async () => {});
    expect(Sustain.hook).not.toBeNull();
    await Sustain.run();
    expect(execute).toHaveBeenCalledTimes(1);
    spyOn(Bank, 'isOpen').mockReturnValue(true);
    await Sustain.run();
    expect(execute).toHaveBeenCalledTimes(1);
    bot.onStop();
    expect(Sustain.hook).toBeNull();
});
