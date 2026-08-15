import { afterEach, expect, test } from 'bun:test';

import { AIO_SETTINGS, QUEST_OPTION_LABELS } from '#/bot/scripts/AIOQuester/AIOQuester.js';
import { FOOD_OPTIONS } from '#/bot/api/combat/food.js';
import { QUEST_DEFS } from '#/bot/api/ai/quests/defs/index.js';
import { SettingsStore } from '#/bot/runtime/Settings.js';

afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
});

test('AIO quest options keep stable IDs but display canonical quest names', () => {
    const ids = QUEST_DEFS.map(def => def.record.id);
    expect(AIO_SETTINGS.quests.options).toEqual(ids);
    expect(QUEST_OPTION_LABELS).toEqual(Object.fromEntries(
        QUEST_DEFS.map(def => [def.record.id, def.record.name])
    ));
    expect(AIO_SETTINGS.quests.optionLabels).toBe(QUEST_OPTION_LABELS);
});

test('canonical labels do not migrate or invalidate existing stored quest IDs', () => {
    SettingsStore.save('AIOQuester', 'quests', 'cook, sheep');
    expect(SettingsStore.resolve('AIOQuester', AIO_SETTINGS).quests).toEqual(['cook', 'sheep']);
});

test('the food the engine provisions is a setting, and defaults to Lobster', () => {
    expect(AIO_SETTINGS.food.default).toBe('Lobster');
    expect(AIO_SETTINGS.food.options).toEqual(FOOD_OPTIONS);
});

test('a configured food is what gets withdrawn', () => {
    SettingsStore.save('AIOQuester', 'food', 'Shark');
    expect(SettingsStore.resolve('AIOQuester', AIO_SETTINGS).food).toBe('Shark');
});
