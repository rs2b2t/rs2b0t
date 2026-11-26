import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import AccountLeveler, { SETTINGS } from '#/bot/scripts/AccountLeveler/AccountLeveler.js';
import { activityActions } from '#/bot/scripts/AccountLeveler/actions.js';
import { enabledSkills } from '#/bot/scripts/AccountLeveler/planner.js';
import type { ActivityPlan, LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

afterEach(() => mock.restore());

const snapshot = (): LevelerSnapshot => ({
    stock: { coal: 1000 }, bankStock: { coal: 1000 }, bankReady: true, quests: {},
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, 1])), target: 70,
    supplierOnly: true, seersWorld: true, supplySeers: false, wilderness: false, mode: 'Hard clue farming', now: Date.now()
});

test('the dedicated supplier checkbox defaults off and is independent of post-target supply', () => {
    expect(SETTINGS.supplierOnly).toMatchObject({ type: 'boolean', default: false });
    const bot = new AccountLeveler();
    bot.settings = new SettingsBag({ supplierOnly: true, supplySeers: false });
    expect(bot['snapshot']()).toMatchObject({ supplierOnly: true, supplySeers: false });
});

test('supplier banks the last load and starts a market sale ahead of clues and queued training', async () => {
    const bot = new AccountLeveler();
    bot.settings = new SettingsBag({ supplierOnly: true });
    const training: ActivityPlan = { id: 'old', objective: 'smithing', label: 'Smith', script: 'SmithingBot', settings: {}, needs: [] };
    bot['pendingPlans'] = [training];
    bot['retry'] = training;
    let banked = false;
    bot['snapshot'] = () => ({ ...snapshot(), bankStock: { coal: banked ? 1000 : 990 } });
    spyOn(Bank, 'isOpen').mockReturnValue(true);
    spyOn(Inventory, 'items').mockReturnValue([{ name: 'Coal', count: 10 }] as ReturnType<typeof Inventory.items>);
    spyOn(bot['supplies'], 'bank').mockResolvedValue(true);
    spyOn(bot['supplies'], 'deposit').mockImplementation(async () => { banked = true; });
    const clue = bot['startBankClue'] = mock(async () => true);
    const start = bot['startPlannedActivity'] = mock(async (_plan: ActivityPlan) => {});
    await bot['selectAndStart']();
    expect(clue).not.toHaveBeenCalled();
    expect(start.mock.calls[0]?.[0]).toMatchObject({ script: 'MarketSeller', settings: { supplierOnly: true, item: 'coal' } });
    expect(bot['pendingPlans']).toEqual([]);
    expect(bot['retry']).toBeNull();
});

test.each([['Sold a Seers supply lot', false], ['Maker declined', true]])('finished seller applies its cooldown for %s', async (reason, cooldown) => {
    const bot = new AccountLeveler();
    const plan: ActivityPlan = { id: 'sell-seers-surplus:coal', label: 'Sell coal', objective: 'economy', script: 'MarketSeller',
        settings: { supplierOnly: true, item: 'coal' }, needs: [] };
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'inCombat').mockReturnValue(false);
    bot['snapshot'] = snapshot;
    bot['phase'] = 'train';
    bot['session'].start(plan, Date.now(), () => 0);
    bot['activity'].outcome = { kind: 'finished', reason };
    await bot.loop();
    expect(bot['session'].memory.cooldowns[plan.id] > Date.now()).toBe(cooldown);
    expect(bot).toHaveProperty('phase', 'bank');
});

test('a herb lot counts the banked quantity of the selected herb ID', () => {
    const bot = new AccountLeveler();
    const s = { ...snapshot(), stock: { herb: 1500, '#199': 1000 }, bankStock: { herb: 1499, '#199': 999 } };
    const plan: ActivityPlan = { id: 'herbs', label: 'Herbs', objective: 'economy', script: 'AutoFighter',
        settings: {}, needs: [], output: { item: 'Herb', id: 199, count: 1000 } };
    expect(bot['reached'](plan, s)).toBe(false);
    s.bankStock['#199']++;
    expect(bot['reached'](plan, s)).toBe(true);
});

test('the sale queue shows the bank check, trip to Seers and sale', () => {
    const plan: ActivityPlan = { id: 'sale', label: 'Sell 1,000 coal to Seers Market', objective: 'economy', script: 'MarketSeller',
        settings: { supplierOnly: true, item: 'coal' }, needs: [], travel: { x: 2725, z: 3491, level: 0 } };
    const actions = activityActions(plan, snapshot());
    expect(actions.map(action => action.id)).toEqual(['bank:start', 'travel', 'train']);
    expect(actions[1].label).toBe('Travel to Seers Market');
});

test('banking a full lot of a secondary drop sends the supplier back to market', () => {
    const bot = new AccountLeveler();
    const s = { ...snapshot(), bankStock: { 'dragon bones': 1000, dragonhide: 970 }, stock: { 'dragon bones': 1000, dragonhide: 970 } };
    const plan: ActivityPlan = { id: 'dragons', label: 'Gather hides', objective: 'economy', script: 'JiveDragons',
        settings: {}, needs: [], output: { item: 'Dragonhide', count: 1000 } };
    spyOn(Bank, 'isOpen').mockReturnValue(true);
    expect(bot['reached'](plan, s)).toBe(true);
    bot['session'].memory.cooldowns['sell-seers-surplus:dragon bones'] = s.now + 60000;
    expect(bot['reached'](plan, s)).toBe(false);
});
