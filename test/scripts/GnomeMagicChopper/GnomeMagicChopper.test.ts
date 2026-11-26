import { expect, spyOn, test } from 'bun:test';

import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Game } from '#/bot/api/game/Game.js';
import { Loc } from '#/bot/api/model/Loc.js';
import { Shop } from '#/bot/api/shop/Shop.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import Tile from '#/bot/geometry/Tile.js';
import GnomeMagicChopper from '#/bot/scripts/GnomeMagicChopper/GnomeMagicChopper.js';

function stair(x: number, z: number, level = 0): Loc {
    return new Loc({
        typecode: 0,
        id: level === 0 ? 1742 : 1744,
        name: 'Staircase',
        ops: [level === 0 ? 'Climb-up' : 'Climb-down'],
        tile: new Tile(x, z, level),
        distance: 0
    });
}

function botWith(stairs: Loc[]): GnomeMagicChopper {
    const bot = new GnomeMagicChopper();
    bot.queryClimbLocs = () => stairs;
    return bot;
}

test('accepts the real north bank staircase from the northern approach', () => {
    const north = stair(2445, 3434);
    const bot = botWith([stair(2444, 3414), north]);
    expect(bot.findClimbLoc(new Tile(2445, 3436, 0), 8, 'up')).toBe(north);
});

test('keeps the southern bank staircase available', () => {
    const south = stair(2444, 3414);
    expect(botWith([south, stair(2445, 3434)]).findClimbLoc(new Tile(2444, 3416, 0), 8, 'up')).toBe(south);
});

test('rejects stairs outside the bank pins and stairs on another floor', () => {
    const bot = botWith([stair(2445, 3443), stair(2445, 3434, 1)]);
    expect(bot.findClimbLoc(new Tile(2445, 3436, 0), 8, 'up')).toBeNull();
});

test('banks a full pack when Strange fruit takes the last slot before a log', async () => {
    const inventory: InvItemSnapshot[] = [
        { id: 1359, name: 'Rune axe', count: 1, slot: 0, comId: 3214, ops: [] },
        ...Array.from({ length: 26 }, (_, index) => ({ id: 946, name: 'Knife', count: 1, slot: index + 1, comId: 3214, ops: [] })),
        { id: 464, name: 'Strange fruit', count: 1, slot: 27, comId: 3214, ops: [] }
    ];
    const bot = new GnomeMagicChopper();
    bot.gearReady = true;
    const restores: (() => void)[] = [];
    const track = <T extends { mockRestore(): void }>(spy: T): T => {
        restores.push(() => spy.mockRestore());
        return spy;
    };

    try {
        track(spyOn(reader, 'bankComId')).mockReturnValue(-1);
        track(spyOn(reader, 'inventory')).mockReturnValue(inventory);
        track(spyOn(reader, 'inventorySize')).mockReturnValue(28);
        track(spyOn(Game, 'ingame')).mockReturnValue(true);
        track(spyOn(Game, 'tile')).mockReturnValue(new Tile(2433, 3410, 0));
        track(spyOn(Game, 'animating')).mockReturnValue(false);
        track(spyOn(ChatDialog, 'canContinue')).mockReturnValue(false);
        track(spyOn(ChatDialog, 'isMakeMenu')).mockReturnValue(false);
        track(spyOn(Bank, 'isOpen')).mockReturnValue(false);
        track(spyOn(Shop, 'isOpen')).mockReturnValue(false);
        track(spyOn(Equipment, 'contains')).mockReturnValue(false);
        track(spyOn(Skills, 'level')).mockReturnValue(75);
        track(spyOn(bot, 'currentPlan')).mockReturnValue({ id: 'logs', menuMatch: '', label: 'Magic logs (bank)', bank: true, fletch: false });
        track(spyOn(bot, 'handleFemiDialog')).mockResolvedValue(false);
        track(spyOn(bot, 'prepWcGear')).mockResolvedValue(false);
        const bank = track(spyOn(bot, 'bankProductsAndReturn')).mockResolvedValue(undefined);
        const hop = track(spyOn(bot, 'hopTreePin')).mockResolvedValue(undefined);
        track(spyOn(bot, 'findTree')).mockReturnValue(null);

        await bot.loop();

        expect(bank).toHaveBeenCalledTimes(1);
        expect(hop).not.toHaveBeenCalled();
    } finally {
        for (const restore of restores) restore();
    }
});
