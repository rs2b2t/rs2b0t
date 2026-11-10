import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import AIOQuester from '#/bot/scripts/AIOQuester/AIOQuester.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Trade } from '#/bot/api/trade/Trade.js';
import { QuestEngine } from '#/bot/api/ai/quests/engine/QuestEngine.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { ArravConfig } from '#/bot/api/ai/quests/defs/shieldofarrav/config.js';
import { HeroConfig } from '#/bot/api/ai/quests/defs/heroquest/config.js';
import { ArravHandoffState } from '#/bot/api/ai/quests/defs/shieldofarrav/partner.js';
import { HeroHandoffState } from '#/bot/api/ai/quests/defs/heroquest/partner.js';
import { DragonSupplies } from '#/bot/api/ai/quests/defs/dragonslayer/supplies.js';
import { LegendsConfig } from '#/bot/api/ai/quests/defs/legends/config.js';
import { QuestFood } from '#/bot/api/ai/quests/food.js';
import { QuestLoadout } from '#/bot/api/ai/quests/gear.js';

let restore: () => void;
beforeEach(() => {
    const food = QuestFood.name;
    const loadout = QuestLoadout.current;
    const planks = DragonSupplies.wildernessPlanks;
    const arrav = { ...ArravConfig };
    const hero = { ...HeroConfig };
    const arravHandoff = { ...ArravHandoffState };
    const heroHandoff = { ...HeroHandoffState };
    const legends = { ...LegendsConfig };
    restore = () => {
        QuestFood.name = food;
        QuestLoadout.current = loadout;
        DragonSupplies.wildernessPlanks = planks;
        Object.assign(ArravConfig, arrav);
        Object.assign(HeroConfig, hero);
        Object.assign(ArravHandoffState, arravHandoff);
        Object.assign(HeroHandoffState, heroHandoff);
        Object.assign(LegendsConfig, legends);
    };
});
afterEach(() => restore());

test('only the active selected quest advertises a counterpart', async () => {
    const progress = spyOn(QuestEngine.prototype, 'coordinationProgress').mockReturnValue(new Map([['blackarmgang', { stage: 9 }], ['hero', { stage: 1 }]]));
    const login = spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    const bot = new AIOQuester();
    bot.bindLog(() => {});
    try {
        await bot.onStart();
        bot.pickedIds().add('blackarmgang');
        bot.pickedIds().add('hero');
        bot.noteState([
            { id: 'blackarmgang', name: 'Shield of Arrav', status: 'READY', reasons: [] },
            { id: 'hero', name: 'Heroes Quest', status: 'BLOCKED', reasons: ['needs 53 Fishing'] }
        ], 'cook', 'cooking', 0, 0);
        expect(bot.partnershipSnapshot().quests.blackarmgang?.eligible).toBe(false);
        bot.noteState([], 'blackarmgang', 'working', 0, 0);
        expect(bot.partnershipSnapshot().quests.blackarmgang?.eligible).toBe(true);
        expect(bot.partnershipSnapshot().quests.hero?.eligible).toBe(false);
        bot.noteState([], 'hero', 'working', 0, 0);
        expect(bot.partnershipSnapshot().quests.hero?.eligible).toBe(true);
    } finally {
        await bot.onStop(); bot.disposeSubscriptions(); progress.mockRestore(); login.mockRestore();
    }
});

test('availability follows live hitpoints and login instead of merely having a queued quest', () => {
    const bot = new AIOQuester();
    const ingame = spyOn(Game, 'ingame').mockReturnValue(true);
    const name = spyOn(Game, 'myName').mockReturnValue('Known player');
    const hp = spyOn(Skills, 'effective').mockReturnValue(10);
    const trade = spyOn(Trade, 'active').mockReturnValue(false);
    try {
        expect(bot.partnershipSnapshot().available).toBe(true);
        hp.mockReturnValue(0);
        expect(bot.partnershipSnapshot().available).toBe(false);
        hp.mockReturnValue(10);
        ingame.mockReturnValue(false);
        expect(bot.partnershipSnapshot().available).toBe(false);
    } finally {
        ingame.mockRestore(); name.mockRestore(); hp.mockRestore(); trade.mockRestore();
    }
});

test('unknown quest progress does not advertise a guessed gang to other bots', () => {
    const bot = new AIOQuester();
    bot.pickedIds().add('blackarmgang');
    bot.noteState([{ id: 'blackarmgang', name: 'Shield of Arrav', status: 'READY', reasons: [] }], 'blackarmgang', 'checking', 0, 0);
    expect(bot.partnershipSnapshot().quests.blackarmgang?.eligible).toBe(false);
});

test('partner snapshots distinguish the exact Arrav and Hero key IDs', () => {
    const bot = new AIOQuester();
    const count = spyOn(Inventory, 'countById').mockImplementation(id => id === 759 ? 1 : 0);
    try {
        expect(bot.partnershipSnapshot().quests.blackarmgang?.hasKey).toBe(true);
        expect(bot.partnershipSnapshot().quests.hero?.hasKey).toBe(false);
        count.mockImplementation(id => id === 1586 ? 1 : 0);
        expect(bot.partnershipSnapshot().quests.blackarmgang?.hasKey).toBe(false);
        expect(bot.partnershipSnapshot().quests.hero?.hasKey).toBe(true);
    } finally { count.mockRestore(); }
});
