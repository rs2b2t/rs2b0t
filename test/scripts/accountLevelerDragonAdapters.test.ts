import '../../src/bot/scripts/index.js';
import { afterEach, expect, spyOn, test } from 'bun:test';
import AIOQuester from '#/bot/scripts/AIOQuester/AIOQuester.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { SUPPLY_GATHERS } from '#/bot/api/ai/quests/defs/dragonslayer/supplies.js';
import type { QuestSnapshot } from '#/bot/api/ai/quests/engine/types.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import { QuestLoadout } from '#/bot/api/ai/quests/gear.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Loadouts } from '#/bot/api/loadout/loadoutStore.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import { ScriptActivity } from '#/bot/runtime/ScriptActivity.js';
import AccountLeveler from '#/bot/scripts/AccountLeveler/AccountLeveler.js';
import { methodFor } from '#/bot/scripts/AccountLeveler/methods.js';
import { emptyMemory, enabledSkills } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';
import { restoreSafety, safetyScenario } from './JiveDragons/safety.fixture.js';

const snapshot = (): LevelerSnapshot => ({ levels: Object.fromEntries(enabledSkills.map(skill => [skill, 50])),
    stock: { coins: 100000, lobster: 100, 'dragonfire shield': 1 }, quests: { 'Dragon Slayer': true }, target: 60,
    wilderness: true, bankReady: true, now: 1000 });

afterEach(restoreSafety);

for (const roll of [0, 0.999]) test(`dragon adapter ${roll} uses supported settings, keeps prepared food and carries its return fare`, async () => {
    const s = snapshot();
    const plan = methodFor(s, 'prayer', emptyMemory(), () => roll)!;
    const meta = ScriptRegistry.get(plan.script)!;
    for (const [key, value] of Object.entries(plan.settings)) {
        const definition = meta.settingsSchema?.[key];
        expect(definition, `${plan.script}.${key}`).toBeDefined();
        if (definition?.options?.length && !definition.optionsFrom) {
            for (const option of Array.isArray(value) ? value : [value]) expect(definition.options).toContain(option);
        }
    }
    expect(plan.needs.find(n => n.item === 'Coins')?.carry).toBeGreaterThanOrEqual(60);
    await safetyScenario('dragons');
    spyOn(Loadouts, 'all').mockReturnValue([{ name: 'Other activity', worn: {}, carry: [{ item: 'Shark', qty: 20 }] }]);
    const logs: string[] = [];
    const activity = new ScriptActivity(message => logs.push(message));
    try {
        await activity.start(meta, plan.settings);
        expect(logs.some(line => /food '?Lobster/.test(line))).toBe(true);
        expect(logs.some(line => /food '?Shark/.test(line))).toBe(false);
    } finally { activity.stop(); }
});

test('controller completes dragon Prayer, quest and rune collection at their own goals', () => {
    const s = snapshot();
    const bot = new AccountLeveler();
    const prayer = methodFor(s, 'prayer', emptyMemory(), () => 0)!;
    expect(bot['reached'](prayer, s)).toBe(false);
    s.levels.prayer = 60;
    expect(bot['reached'](prayer, s)).toBe(true);
    const quest = { ...prayer, quest: 'Dragon Slayer' };
    s.quests['Dragon Slayer'] = false;
    expect(bot['reached'](quest, s)).toBe(false);
    s.quests['Dragon Slayer'] = true;
    expect(bot['reached'](quest, s)).toBe(true);
    const runes = { ...prayer, objective: 'magic', output: { item: 'Chaos rune', count: 200 } };
    s.stock['chaos rune'] = 199;
    expect(bot['reached'](runes, s)).toBe(false);
    s.stock['chaos rune'] = 200;
    expect(bot['reached'](runes, s)).toBe(true);
});


test('delegated quest cannot gather Wilderness planks after a partial repair or lost supplies', async () => {
    const previousFood = QuestFood.name;
    const previousLoadout = QuestLoadout.current;
    const snap: QuestSnapshot = { journal: 'inProgress', inv: new Map(), worn: new Set(), bankCoins: 500, noProgress: 0, freeSlots: 10 };
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    const bot = new AIOQuester();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ quests: ['dragon'], gatherWildernessPlanks: false });
    try {
        await bot.onStart();
        expect(SUPPLY_GATHERS.plank(snap, 1).kind).toBe('wait');
        expect(SUPPLY_GATHERS.plank(snap, 3).kind).toBe('wait');
    } finally {
        await bot.onStop();
        bot.disposeSubscriptions();
        QuestFood.name = previousFood;
        QuestLoadout.current = previousLoadout;
    }
    expect(SUPPLY_GATHERS.plank(snap, 3).kind).toBe('custom');
});
