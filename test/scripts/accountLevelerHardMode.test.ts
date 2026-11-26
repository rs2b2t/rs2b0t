import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import AccountLeveler from '#/bot/scripts/AccountLeveler/AccountLeveler.js';
import { emptyMemory, enabledSkills, planNext } from '#/bot/scripts/AccountLeveler/planner.js';
import { hardCluePlan, HARD_CLUE_OBJECTIVE } from '#/bot/scripts/AccountLeveler/hardClues.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';
import { QUESTS } from '#/bot/api/ai/quests/data/quests.js';
import { Game } from '#/bot/api/game/Game.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';

afterEach(() => mock.restore());

const snapshot = (): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, 70])),
    stock: { coins: 1000000, shark: 100, 'superantipoison(3)': 10, 'dragon dagger': 1,
        'dusty key': 1, 'dragonfire shield': 1, 'rune platebody': 1, 'rune platelegs': 1, 'rune full helm': 1 },
    quests: Object.fromEntries(QUESTS.map(quest => [quest.name, true])),
    bankReady: true, target: 70, wilderness: false, mode: 'Hard clue farming', now: 1000
});

test('hard clue mode continues farming after all target levels have been reached', () => {
    const decision = planNext(snapshot(), emptyMemory(), () => 0);
    expect(decision.kind).toBe('activity');
    if (decision.kind !== 'activity') return;
    expect(decision.plan.objective).toBe(HARD_CLUE_OBJECTIVE);
    expect(decision.plan.settings).toMatchObject({ target: 'Hellhound', solveClues: true, prepareClueRequirements: true, allowClueWilderness: false });
});

test('a retained clue returns to planning without failing or retrying the old farm plan', async () => {
    const bot = new AccountLeveler();
    const s = snapshot();
    const plan = hardCluePlan(s, emptyMemory(), () => 0);
    if (!('script' in plan)) throw new Error(plan.reason);
    bot.settings = new SettingsBag({ mode: 'Hard clue farming' });
    bot.bindLog(() => {});
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(null);
    spyOn(Game, 'myName').mockReturnValue(null);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    bot['snapshot'] = () => s;
    bot['phase'] = 'train';
    bot['session'].start(plan, Date.now(), () => 0);
    bot['pendingPlans'] = [plan];
    bot['activity'].outcome = { kind: 'finished', reason: 'Clue retained for prerequisite training' };
    try {
        await bot.loop();
        expect(String(bot['phase'])).toBe('bank');
        expect(bot['session'].plan).toBeNull();
        expect(bot['pendingPlans']).toEqual([]);
        expect(bot['retry']).toBeNull();
        expect(bot['session'].memory.cooldowns).toEqual({});
        expect(bot['lastFailure']).toBeUndefined();
    } finally { bot.onStop(); }
});

test.each([
    ['Alcher', 'magic', 'Maple longbow'], ['JiveRC', 'runecraft', 'Rune essence']
])('%s keeps running after withdrawing its last banked inputs as notes', async (script, objective, item) => {
    const { Inventory } = await import('#/bot/api/inventory/Inventory.js');
    const bot = new AccountLeveler();
    bot.bindLog(() => {});
    const s = snapshot(); s.mode = 'Train skills'; s.levels[objective] = 60; s.stock[item.toLowerCase()] = 0; s.stock['nature rune'] = 50;
    const plan = { id: script, label: script, objective, script, settings: {}, needs: [{ item, count: 27 }] };
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(null);
    spyOn(Game, 'myName').mockReturnValue(null);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    spyOn(Inventory, 'items').mockReturnValue([{ name: item, count: 50, noted: true } as ReturnType<typeof Inventory.items>[number]]);
    const work = spyOn(bot['activity'], 'loop').mockResolvedValue(undefined);
    bot['snapshot'] = () => s;
    bot['eat'] = async () => {};
    bot['observe'] = () => {};
    bot['phase'] = 'train';
    bot['session'].start(plan, Date.now(), () => 0);
    try {
        await bot.loop();
        expect(work).toHaveBeenCalledTimes(1);
        expect(bot['session'].plan).toBe(plan);
    } finally { bot.onStop(); }
});

test.each(['retry', 'pendingPlans'] as const)('hard farming refreshes one-time shop requirements from %s before provisioning', async source => {
    const bot = new AccountLeveler();
    const s = snapshot();
    const original = hardCluePlan(s, emptyMemory(), () => 0);
    if (!('script' in original)) throw new Error(original.reason);
    const stale = { ...original, needs: [...original.needs, { item: 'Diamond', count: 1 }] };
    bot.bindLog(() => {});
    bot['snapshot'] = () => s;
    bot['tryDragonWeapons'] = async () => false;
    if (source === 'retry') bot['retry'] = stale;
    else bot['pendingPlans'] = [stale];
    spyOn(Game, 'tile').mockReturnValue(null);
    spyOn(Game, 'myName').mockReturnValue(null);
    spyOn(bot['supplies'], 'bank').mockResolvedValue(true);
    spyOn(ScriptRegistry, 'get').mockImplementation(() => { throw new Error('stop before provisioning'); });
    try {
        await expect(bot['selectAndStart']()).rejects.toThrow('stop before provisioning');
        expect(bot['displayPlan']?.id).toBe(original.id);
        expect(bot['displayPlan']?.needs.some(need => need.item === 'Diamond')).toBe(false);
    } finally { bot.onStop(); }
});
