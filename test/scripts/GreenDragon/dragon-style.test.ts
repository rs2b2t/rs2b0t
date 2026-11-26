import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Game } from '#/bot/api/game/Game.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import GreenDragon from '#/bot/scripts/GreenDragon/GreenDragon.js';
import type { MeleeCombatStyle } from '#/bot/api/combat/CombatStyle.js';
import { BankTeleport } from '#/bot/api/bank/BankTeleport.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';

afterEach(() => mock.restore());

test.each(['Teleport to Varrock', 'Flee to bank'])('ordinary green dragon bank trips honor %s', async escape => {
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    spyOn(Game, 'autoRetaliateOn').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue({ x: 3096, z: 3814, level: 0 });
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    const events: string[] = [];
    spyOn(BankTeleport, 'cast').mockImplementation(async (name, _log, leaveDeep) => { events.push(`${name}:${leaveDeep}`); return true; });
    spyOn(Traversal, 'walkResilient').mockImplementation(async () => { events.push('bank walk'); return false; });
    const bot = new GreenDragon();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ escape, solveClues: false });
    await bot.onStart();
    const bank = bot['tasks'].find(task => Reflect.get(task, 'name') === 'BankRun');
    if (!bank) throw new Error('Missing BankRun task');
    await bank.execute();
    expect(events).toEqual(escape === 'Teleport to Varrock' ? ['Varrock:true', 'bank walk'] : ['bank walk']);
});

for (const [weapon, kind, wanted] of [
    ['Dragon longsword', 'melee', 'controlled'],
    ['Rune scimitar', 'melee', 'attack'],
    ['Dragon longsword', 'mage', 'strength']
] as const) {
    test(`GreenDragon uses ${wanted} with ${weapon} in ${kind}`, async () => {
        const state: { selected: MeleeCombatStyle } = { selected: 'strength' };
        spyOn(reader, 'equipment').mockReturnValue([{ id: 1305, name: weapon, slot: 3, count: 1, ops: ['Remove'], comId: 1 }]);
        spyOn(Execution, 'delayUntil').mockResolvedValue(true);
        spyOn(Game, 'autoRetaliateOn').mockReturnValue(true);
        spyOn(Game, 'hasCombatStyle').mockImplementation(style => style === state.selected);
        spyOn(Game, 'setCombatStyle').mockImplementation(style => { if (typeof style === 'number') return false; state.selected = style; return true; });
        const bot = new GreenDragon();
        bot.bindLog(() => {});
        bot.settings = new SettingsBag({ combatStyle: kind, meleeStyle: 'attack', weapon: 'Dragon longsword', solveClues: false });
        await bot.onStart();
        const style = bot['tasks'].find(task => Reflect.get(task, 'name') === 'SetAttackStyle');
        if (!style) throw new Error('Missing SetAttackStyle task');
        if (await style.validate()) await style.execute();
        expect(state.selected).toBe(wanted);
    });
}

test('the Wilderness hunter targets adult reds and walks back to Red Dragon Isle', async () => {
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    spyOn(Game, 'autoRetaliateOn').mockReturnValue(true);
    const walk = spyOn(Traversal, 'walkResilient').mockResolvedValue(true);
    const bot = new GreenDragon();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ target: 'Red dragon' });
    await bot.onStart();
    expect(bot.grindTargets()).toEqual(['red dragon']);
    const task = bot['tasks'].find(task => Reflect.get(task, 'name') === 'ReturnToField')!;
    await task.execute();
    expect(walk.mock.calls[0][0]).toMatchObject({ x: 3216, z: 3820, level: 0 });
});
