import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import EdgevilleMonkeyBars from '#/bot/scripts/EdgevilleMonkeyBars/EdgevilleMonkeyBars.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';

afterEach(() => mock.restore());

test.each([true, false])('delegated bars restock the leveler food; available=%s', available => {
    return runRestock(available);
});

async function runRestock(available: boolean) {
    const bot = new EdgevilleMonkeyBars();
    bot.settings = new SettingsBag({ food: 'Trout', loadout: '', foodAmount: 12, minFood: 1, restockMode: 'Dungeon ladder (out of food)' });
    bot.bindLog(() => {});
    const finish = mock(() => {});
    bot.bindFinish(finish);
    let food = 0;
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 3094, z: 3493, level: 0 });
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(Skills, 'effective').mockReturnValue(60);
    spyOn(reader, 'retaliateControls').mockReturnValue(null);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockImplementation(() => Array.from({ length: food }, (_, slot) => ({ id: 333, name: 'Trout', count: 1, slot, comId: 3214, ops: [] })));
    spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    spyOn(Bank, 'openBooth').mockResolvedValue(true);
    spyOn(Bank, 'depositAllMatching').mockResolvedValue(undefined);
    const withdraw = spyOn(Bank, 'withdrawX').mockImplementation(async (name, count) => {
        if (available && name === 'Trout') food = count;
        return food > 0;
    });
    const stop = spyOn(ScriptRunner, 'stop').mockImplementation(() => {});
    try {
        await bot.onStart();
        await bot.loop();
        expect(withdraw).toHaveBeenCalledWith('Trout', 12);
        expect(stop).not.toHaveBeenCalled();
        expect(finish).toHaveBeenCalledTimes(available ? 0 : 1);
    } finally { bot.disposeSubscriptions(); }
}
