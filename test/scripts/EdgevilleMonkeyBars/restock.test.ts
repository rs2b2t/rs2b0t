import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import EdgevilleMonkeyBars from '#/bot/scripts/EdgevilleMonkeyBars/EdgevilleMonkeyBars.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Loadouts } from '#/bot/api/loadout/loadoutStore.js';
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
    spyOn(Loadouts, 'all').mockReturnValue([{ name: 'Melee', worn: {}, carry: [{ item: 'Lobster', qty: 12 }] }]);
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

test.each([
    ['Shark', 'Lobster', 'Shark'],
    ['', 'Trout', 'Trout']
])('starts with packed %s or the loadout food %s', async (setting, loadoutFood, packed) => {
    const bot = new EdgevilleMonkeyBars();
    bot.settings = new SettingsBag({ food: setting, loadout: '', minFood: 1, restockMode: 'Dungeon ladder (out of food)' });
    const log = mock(() => {});
    bot.bindLog(log);
    spyOn(Loadouts, 'all').mockReturnValue([{ name: 'Melee', worn: {}, carry: [{ item: loadoutFood, qty: 12 }] }]);
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 3094, z: 3493, level: 0 });
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(reader, 'retaliateControls').mockReturnValue(null);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockReturnValue(Array.from({ length: 12 }, (_, slot) => ({
        id: packed === 'Shark' ? 385 : 333, slot, name: packed, count: 1, comId: 3214, ops: ['Eat']
    })));
    try {
        await bot.onStart();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('hasFood: true'));
        const restock = bot['tasks'].find(task => task.constructor.name === 'BankAndRestock')!;
        expect(restock.validate()).toBe(false);
    } finally { bot.disposeSubscriptions(); }
});

test('starts the dungeon exit walk when the return swing has landed and settled', async () => {
    const { Input } = await import('#/bot/input/Input.js');
    const bot = new EdgevilleMonkeyBars();
    bot.settings = new SettingsBag({ restockMode: 'Dungeon ladder (out of food)' });
    bot.bindLog(() => {});
    let tick = 0;
    let swinging = false;
    let z = 9969;
    const walks: number[] = [];
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockImplementation(() => ({ x: 3121, z, level: 0 }));
    spyOn(Game, 'animating').mockImplementation(() => swinging && tick < 5);
    spyOn(Skills, 'effective').mockReturnValue(60);
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(reader, 'inventory').mockReturnValue([]);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'retaliateControls').mockReturnValue(null);
    spyOn(reader, 'toLocal').mockReturnValue({ lx: 2, lz: 2 });
    spyOn(reader, 'locs').mockImplementation(() => [{ id: 2320, typecode: 2, tile: { x: 3121, z: 9969, level: 0 }, name: 'Monkeybars', ops: ['Swing across'], distance: 1 }]);
    spyOn(Input, 'interactLoc').mockImplementation(() => { swinging = true; return true; });
    spyOn(Execution, 'delayUntil').mockImplementation(async (ready, ms = 6000) => {
        for (let i = 0; !ready() && i < ms / 600; i++) {
            tick++;
            if (swinging && tick === 4) z = 9964;
        }
        return ready();
    });
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { walks.push(tick); z = 3493; return true; });
    spyOn(Bank, 'openBooth').mockResolvedValue(false);
    spyOn(Bank, 'openNearest').mockResolvedValue(false);
    try {
        await bot.onStart();
        await bot.loop();
        expect(walks[0]).toBe(5);
    } finally { bot.disposeSubscriptions(); }
});

test('resumes agility after the last confirmed bite while spacing consecutive meals', async () => {
    const { Input } = await import('#/bot/input/Input.js');
    let tick = 0;
    let hp = 36;
    const bites: number[] = [];
    spyOn(Skills, 'effective').mockImplementation(() => hp);
    spyOn(Skills, 'level').mockReturnValue(60);
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { tick += n; });
    spyOn(Execution, 'delayUntil').mockImplementation(async ready => ready());
    spyOn(reader, 'retaliateControls').mockReturnValue(null);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockImplementation(() => hp >= 60 ? [] : [
        { id: 379, slot: 1, name: 'Lobster', count: 1, comId: 3214, ops: ['Eat'] }
    ]);
    spyOn(Input, 'heldOp').mockImplementation(() => { hp += 12; bites.push(tick); return true; });
    const bot = new EdgevilleMonkeyBars();
    bot.bindLog(() => {});
    try {
        await bot.onStart();
        await bot['tasks'].find(task => task.constructor.name === 'EatFood')!.execute();
        expect(bites).toEqual([0, 3]);
        expect(tick).toBe(3);
    } finally { bot.disposeSubscriptions(); }
});
