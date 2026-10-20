import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import AccountLeveler, { SETTINGS } from '#/bot/scripts/AccountLeveler/AccountLeveler.js';
import { methodFor, producer } from '#/bot/scripts/AccountLeveler/methods.js';
import { emptyMemory, enabledSkills, planNext, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { BotHost } from '#/bot/runtime/BotHost.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';

afterEach(() => mock.restore());

const snapshot = (): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, 60])),
    stock: { coins: 1000000, lobster: 100, 'air talisman': 1, 'rune pickaxe': 1 },
    quests: { 'Druidic Ritual': true, 'Rune Mysteries Quest': true },
    bankReady: true, target: 60, wilderness: true, now: 1000
});

test.each([undefined, 40, 60, 99])('target %s defaults to 60, supports 60 and preserves lower choices', async target => {
    expect(SETTINGS.targetLevel).toMatchObject({ default: 60, max: 60 });
    const bot = new AccountLeveler();
    bot.settings = new SettingsBag(target === undefined ? {} : { targetLevel: target });
    bot.bindLog(() => {});
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    spyOn(Game, 'myName').mockReturnValue(null);
    spyOn(BotHost, 'addFrameListener').mockReturnValue(() => {});
    try {
        await bot.onStart();
        expect(bot['target']).toBe(target === 40 ? 40 : 60);
    } finally { bot.onStop(); bot.disposeSubscriptions(); }
});

test.each(enabledSkills)('%s still has a resolvable training method at 59', skill => {
    const s = snapshot();
    s.levels[skill] = 59;
    const next = planNext(s, emptyMemory(), () => 0);
    expect(next.kind).toBe('activity');
    if (next.kind === 'activity') expect(next.plan.objective).toBe(skill);
    s.levels[skill] = 60;
    expect(planNext(s, emptyMemory()).kind).toBe('complete');
});

test.each([1, 14, 15, 40, 59])('agility %s selects the appropriate course and supplies', level => {
    const s = snapshot();
    s.levels.agility = level;
    const plan = methodFor(s, 'agility', emptyMemory(), () => 0)!;
    if (level < 15) {
        expect(plan.script).toBe('GnomeCourse');
        expect(plan.prerequisiteLevels).toEqual({ agility: 15 });
    } else {
        expect(plan.script).toBe('EdgevilleMonkeyBars');
        expect(plan.wilderness).toBe(true);
        expect(plan.travel).toMatchObject({ x: 3094, z: 3493, level: 0 });
        expect(plan.settings).toMatchObject({ food: 'Lobster', foodAmount: 12, restockMode: 'Dungeon ladder (out of food)', loadout: '' });
        expect(plan.needs).toContainEqual({ item: 'Lobster', count: 24, carry: 12 });
    }
});

test('disabling Wilderness keeps agility on the Gnome course', () => {
    const s = snapshot(); s.wilderness = false; s.levels.agility = 59;
    expect(methodFor(s, 'agility', emptyMemory(), () => 0)?.script).toBe('GnomeCourse');
});

test.each([0, 26, 27, 500, 999])('runecrafting with %s essence only stocks up below a load', count => {
    const s = snapshot(); s.levels.runecraft = 20; s.stock['rune essence'] = count;
    const next = planNext(s, { ...emptyMemory(), objective: 'runecraft' }, () => 0);
    expect(next.kind).toBe('activity');
    if (next.kind !== 'activity') return;
    expect(next.plan.script).toBe(count < 27 ? 'EssMiner' : 'RuneCrafter');
    if (count < 27) {
        expect(next.plan.output).toEqual({ item: 'Rune essence', count: 1000 });
        expect(next.queue.map(plan => plan.script)).toEqual(['EssMiner', 'RuneCrafter']);
        s.stock['rune essence'] = 1008;
        expect(resolveActivity(s, next.queue[1], emptyMemory(), () => 0)).toMatchObject({ kind: 'activity', plan: { script: 'RuneCrafter' } });
    }
});

test('large explicit essence requests are not reduced to the standard batch', () => {
    expect(producer(snapshot(), 'runecraft', { item: 'Rune essence', count: 1500 }, emptyMemory(), () => 0)?.output?.count).toBe(1500);
});

test('essence stocking finishes the batch and banks it before resuming runecrafting, even after session expiry', async () => {
    const bot = new AccountLeveler();
    const s = snapshot(); s.levels.runecraft = 20;
    const plan = producer(s, 'runecraft', { item: 'Rune essence', count: 27 }, emptyMemory(), () => 0)!;
    const craft = methodFor(s, 'runecraft', emptyMemory(), () => 0)!;
    let bankOpen = false;
    let carried = 27;
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(null);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Game, 'myName').mockReturnValue(null);
    spyOn(Bank, 'isOpen').mockImplementation(() => bankOpen);
    spyOn(Bank, 'ready').mockImplementation(() => bankOpen);
    spyOn(Inventory, 'count').mockImplementation(name => name === 'Rune essence' ? carried : 0);
    bot['snapshot'] = () => s;
    bot['eat'] = async () => {};
    bot['observe'] = () => {};
    const work = spyOn(bot['activity'], 'loop').mockResolvedValue(undefined);
    try {
        bot['phase'] = 'train';
        bot['session'].start(plan, Date.now(), () => 0);
        bot['session'].remainingMs = 0;
        bot['pendingPlans'] = [craft];
        s.stock['rune essence'] = 54;
        await bot.loop();
        expect(work).toHaveBeenCalledTimes(1);
        expect(bot['session'].plan).toBe(plan);
        s.stock['rune essence'] = 1008;
        await bot.loop();
        expect(work).toHaveBeenCalledTimes(2);
        expect(bot['session'].plan).toBe(plan);
        bankOpen = true; carried = 0;
        await bot.loop();
        expect(bot['session'].plan).toBeNull();
        expect(bot['session'].memory.objective).toBe('runecraft');
        expect(bot['pendingPlans']).toEqual([craft]);
        expect(String(bot['phase'])).toBe('bank');
    } finally { bot.onStop(); }
});
