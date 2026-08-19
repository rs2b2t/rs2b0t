import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import Tile from '#/bot/geometry/Tile.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import BrimhavenAgility from '#/bot/scripts/BrimhavenAgility/BrimhavenAgility.js';
import {
    ARDY_BANK,
    ARENA_ENTRANCE,
    ARENA_VARP,
    KARAMJA_GENERAL,
    TICKET_NAME
} from '#/bot/scripts/BrimhavenAgility/BrimhavenAgilityLogic.js';

const REPORTED_RANDOM_EVENT_TILE = new Tile(3218, 9618, 0);

const original = {
    varp: reader.varp,
    delayUntil: Execution.delayUntil,
    ingame: Game.ingame,
    sceneReady: Game.sceneReady,
    tile: Game.tile,
    canContinue: ChatDialog.canContinue,
    inventoryItems: Inventory.items,
    inventoryCount: Inventory.count,
    skillLevel: Skills.level,
    skillEffective: Skills.effective,
    skillXp: Skills.xp,
    walkResilient: Traversal.walkResilient
};

let food: number;
let coins: number;
let walks: Tile[];

beforeEach(() => {
    food = 25;
    coins = 260;
    walks = [];

    reader.varp = id => id === ARENA_VARP ? 2 : 0;
    Execution.delayUntil = async condition => condition();
    Game.ingame = () => true;
    Game.sceneReady = () => true;
    Game.tile = () => REPORTED_RANDOM_EVENT_TILE;
    ChatDialog.canContinue = () => false;
    Inventory.items = () => Array.from({ length: food }, (_, slot) => ({ name: 'Lobster', slot })) as never;
    Inventory.count = name => name === 'Coins' ? coins : (name === TICKET_NAME ? 0 : 0);
    Skills.level = name => name === 'agility' ? 40 : 20;
    Skills.effective = name => name === 'hitpoints' ? 20 : name === 'agility' ? 40 : 1;
    Skills.xp = () => 0;
    Traversal.walkResilient = async destination => {
        walks.push(Tile.from(destination));
        return false;
    };
});

afterEach(() => {
    reader.varp = original.varp;
    Execution.delayUntil = original.delayUntil;
    Game.ingame = original.ingame;
    Game.sceneReady = original.sceneReady;
    Game.tile = original.tile;
    ChatDialog.canContinue = original.canContinue;
    Inventory.items = original.inventoryItems;
    Inventory.count = original.inventoryCount;
    Skills.level = original.skillLevel;
    Skills.effective = original.skillEffective;
    Skills.xp = original.skillXp;
    Traversal.walkResilient = original.walkResilient;
});

async function startedBot(): Promise<BrimhavenAgility> {
    const bot = new BrimhavenAgility();
    bot.settings = new SettingsBag({ food: 'Lobster', foodWithdraw: 25, bankAtTickets: 1000 });
    bot.bindLog(() => {});
    await bot.onStart();
    return bot;
}

describe('BrimhavenAgility off-course recovery', () => {
    test('a funded bot pathfinds back to the arena from the reported random-event tile', async () => {
        const bot = await startedBot();
        try {
            await bot.loop();

            expect(bot.inArenaNow()).toBe(false);
            expect(bot.inPitNow()).toBe(false);
            expect(walks).toEqual([Tile.from(ARENA_ENTRANCE)]);
        } finally {
            bot.disposeSubscriptions();
        }
    });

    test('an under-supplied bot pathfinds to Ardougne instead of waiting for a rope', async () => {
        food = 0;
        coins = 0;
        const bot = await startedBot();
        try {
            await bot.loop();

            expect(bot.inArenaNow()).toBe(false);
            expect(bot.inPitNow()).toBe(false);
            expect(walks).toEqual([Tile.from(ARDY_BANK)]);
        } finally {
            bot.disposeSubscriptions();
        }
    });

    test('a Brimhaven bot short of the ship fare walks to the Karamja store', async () => {
        food = 8;
        coins = 5;
        Game.tile = () => new Tile(ARENA_ENTRANCE.x, ARENA_ENTRANCE.z, 0);
        const bot = await startedBot();
        try {
            await bot.loop();
            expect(walks).toEqual([Tile.from(KARAMJA_GENERAL)]);
        } finally {
            bot.disposeSubscriptions();
        }
    });
});
