import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import { QuestLoadout } from '#/bot/api/ai/quests/gear.js';
import { DragonSupplies } from '#/bot/api/ai/quests/defs/dragonslayer/supplies.js';
import { ArravConfig } from '#/bot/api/ai/quests/defs/shieldofarrav/config.js';
import { HeroConfig } from '#/bot/api/ai/quests/defs/heroquest/config.js';
import { LegendsConfig } from '#/bot/api/ai/quests/defs/legends/config.js';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import AIOQuester, { AIO_SETTINGS } from '#/bot/scripts/AIOQuester/AIOQuester.js';
import { SettingsBag, SettingsStore } from '#/bot/runtime/Settings.js';
import { renderControl } from '#/bot/panel/paramControls.js';

let restore: () => void;
beforeEach(() => {
    const food = QuestFood.name;
    const loadout = QuestLoadout.current;
    const planks = DragonSupplies.wildernessPlanks;
    const arrav = { ...ArravConfig };
    const hero = { ...HeroConfig };
    const legends = { ...LegendsConfig };
    restore = () => {
        QuestFood.name = food;
        QuestLoadout.current = loadout;
        DragonSupplies.wildernessPlanks = planks;
        Object.assign(ArravConfig, arrav);
        Object.assign(HeroConfig, hero);
        Object.assign(LegendsConfig, legends);
    };
});

afterEach(() => {
    restore();
    sessionStorage.clear();
    localStorage.clear();
});

test.each([
    ['cook, sheep', ['cook', 'sheep']],
    ['+cook, -sheep', ['cook']],
    ['-cook, -sheep', []],
    ['+missing, -removed', []]
])('saved quest choices %s produce the same run queue after reload', async (raw, expected) => {
    SettingsStore.save('AIOQuester', 'quests', raw);
    sessionStorage.clear();
    const login = spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    const bot = new AIOQuester();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag(SettingsStore.resolve('AIOQuester', AIO_SETTINGS));
    try {
        await bot.onStart();
        expect([...bot.pickedIds()].sort()).toEqual(expected);
    } finally {
        await bot.onStop();
        bot.disposeSubscriptions();
        login.mockRestore();
    }
});

test('an unchanged legacy empty selection still runs every implemented quest', async () => {
    const login = spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    const bot = new AIOQuester();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag(SettingsStore.resolve('AIOQuester', AIO_SETTINGS));
    try {
        await bot.onStart();
        expect([...bot.pickedIds()].sort()).toEqual([...(AIO_SETTINGS.quests.options ?? [])].sort());
    } finally {
        await bot.onStop();
        bot.disposeSubscriptions();
        login.mockRestore();
    }
});

test('the real quest selector marks only online authoritative completed quest rows', () => {
    const login = spyOn(reader, 'ingame').mockReturnValue(true);
    const quests = spyOn(reader, 'questStatuses').mockReturnValue([
        { comId: 1, name: "Cook's Assistant", colour: 0x00f800 },
        { comId: 2, name: 'Sheep Shearer', colour: 0xf8f800 }
    ]);
    const refreshers: Array<() => void> = [];
    try {
        const host = renderControl(AIO_SETTINGS.quests, 'sheep', () => {}, {
            disabled: false,
            registerRefresh: refresh => refreshers.push(refresh)
        });
        const complete = () => Array.from(host.querySelectorAll('.is-complete')).map(row => row.querySelector('.rs2b0t-param-choice-name')?.textContent);
        expect(complete()).toEqual(["Cook's Assistant"]);
        login.mockReturnValue(false);
        refreshers.forEach(refresh => refresh());
        expect(complete()).toEqual([]);
        login.mockReturnValue(true);
        quests.mockReturnValue([]);
        refreshers.forEach(refresh => refresh());
        expect(complete()).toEqual([]);
        quests.mockReturnValue([{ comId: 2, name: 'Sheep Shearer', colour: 0x00f800 }]);
        refreshers.forEach(refresh => refresh());
        expect(complete()).toEqual(['Sheep Shearer']);
    } finally {
        login.mockRestore();
        quests.mockRestore();
    }
});
