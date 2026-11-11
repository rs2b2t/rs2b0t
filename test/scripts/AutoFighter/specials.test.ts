import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { actions, reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import AutoFighter from '#/bot/scripts/AutoFighter/AutoFighter.js';

let bot: AutoFighter;
afterEach(() => { bot?.disposeSubscriptions(); mock.restore(); });

async function scenario() {
    const state = { arrows: 2, energy: 350, armed: false };
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Execution, 'delayUntil').mockImplementation(async check => check());
    spyOn(Game, 'tile').mockReturnValue({ x: 3200, z: 3200, level: 0 });
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Sustain, 'set').mockImplementation(() => {});
    spyOn(reader, 'equipment').mockImplementation(() => [
        { id: 861, name: 'Magic shortbow', count: 1, slot: 3, comId: 1, ops: [] },
        { id: 882, name: 'Bronze arrow', count: state.arrows, slot: 13, comId: 1, ops: [] }
    ]);
    spyOn(reader, 'varp').mockImplementation(id => id === 300 ? state.energy : id === 301 && state.armed ? 1 : 0);
    spyOn(reader, 'sideTabInterface').mockReturnValue(1764);
    const click = spyOn(actions, 'ifButton').mockImplementation(() => { state.armed = !state.armed; return true; });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async check => check());
    bot = new AutoFighter();
    bot.bindFinish(() => {});
    bot.settings = new SettingsBag({ combatStyle: 'range', useSpecial: true, solveClues: false });
    bot.bindLog(() => {});
    await bot.onStart();
    const special = bot['tasks'].find(task => task.constructor.name === 'ArmSpecial')!;
    return { state, special, click };
}

test('MSB only arms with two quivered arrows and enough energy', async () => {
    const { state, special, click } = await scenario();
    state.arrows = 1;
    expect(special.validate()).toBe(false);
    state.arrows = 2;
    state.energy = 349;
    expect(special.validate()).toBe(false);
    state.energy = 350;
    expect(special.validate()).toBe(true);
    await special.execute();
    expect(click).toHaveBeenCalledWith(7537);
    expect(state.armed).toBe(true);
    expect(special.validate()).toBe(false);
});

test('an armed MSB with one arrow is disarmed and resumes ordinary attacks', async () => {
    const { state, special } = await scenario();
    state.arrows = 1;
    state.armed = true;
    expect(special.validate()).toBe(true);
    await special.execute();
    expect(state.armed).toBe(false);
    expect(bot.resumeAttack).toBe(true);
    expect(special.validate()).toBe(false);
});
