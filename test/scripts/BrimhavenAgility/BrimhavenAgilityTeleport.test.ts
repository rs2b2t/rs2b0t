import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import BrimhavenAgility from '#/bot/scripts/BrimhavenAgility/BrimhavenAgility.js';
import { ARDY_BANK, ARENA_ENTRANCE, ARENA_VARP } from '#/bot/scripts/BrimhavenAgility/BrimhavenAgilityLogic.js';

const restore: (() => void)[] = [];
let pack: Map<string, number>;
let bank: Map<string, number>;
let tile: Tile;
let magic: number;
let questComplete: boolean;
let lands: boolean;
let casts: string[];
let walks: Tile[];
let bot: BrimhavenAgility;

beforeEach(() => {
    pack = new Map([['Coins', 260], ['Law rune', 2], ['Water rune', 2]]);
    bank = new Map([['Lobster', 200], ['Law rune', 100], ['Water rune', 100]]);
    tile = new Tile(ARENA_ENTRANCE.x, ARENA_ENTRANCE.z, 0);
    magic = 51;
    questComplete = true;
    lands = true;
    casts = [];
    walks = [];
    const items = () => [...pack].flatMap(([name, count]) => Array.from({ length: name === 'Lobster' ? count : Number(count > 0) }, (_, slot) => new InvItem({ id: 1, name, count: name === 'Lobster' ? 1 : count, slot, comId: 3214, ops: ['Eat'] })));
    const mocks = [
        spyOn(Game, 'ingame').mockReturnValue(true),
        spyOn(Game, 'sceneReady').mockReturnValue(true),
        spyOn(Game, 'tile').mockImplementation(() => tile),
        spyOn(reader, 'worldTile').mockImplementation(() => tile),
        spyOn(reader, 'varp').mockImplementation(id => id === ARENA_VARP ? 2 : 0),
        spyOn(reader, 'questStatuses').mockImplementation(() => [{ name: 'Plague City', colour: questComplete ? 0x00f800 : 0xf8f800, comId: 1 }]),
        spyOn(Game, 'teleport').mockImplementation(async name => { casts.push(name); if (lands) tile = new Tile(2661, 3301, 0); return true; }),
        spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition()),
        spyOn(Execution, 'delayTicks').mockResolvedValue(undefined),
        spyOn(ChatDialog, 'canContinue').mockReturnValue(false),
        spyOn(Inventory, 'items').mockImplementation(items),
        spyOn(Inventory, 'count').mockImplementation(name => pack.get(name) ?? 0),
        spyOn(Inventory, 'free').mockImplementation(() => 28 - items().length),
        spyOn(Skills, 'level').mockReturnValue(70),
        spyOn(Skills, 'effective').mockImplementation(name => name === 'magic' ? magic : 70),
        spyOn(Skills, 'xp').mockReturnValue(0),
        spyOn(Traversal, 'walkResilient').mockImplementation(async dest => { walks.push(Tile.from(dest)); return tile.x === ARDY_BANK.x && tile.z === ARDY_BANK.z; }),
        spyOn(Bank, 'openNearest').mockResolvedValue(true),
        spyOn(Bank, 'close').mockResolvedValue(true),
        spyOn(Bank, 'count').mockImplementation(name => bank.get(name) ?? 0),
        spyOn(Bank, 'depositAllMatching').mockImplementation(async match => { for (const [name, count] of pack) if (match(name, 1)) { bank.set(name, (bank.get(name) ?? 0) + count); pack.delete(name); } }),
        spyOn(Bank, 'withdrawX').mockImplementation(async (name, count) => {
            const take = Math.min(count, bank.get(name) ?? 0, pack.has(name) && name !== 'Lobster' ? count : name === 'Lobster' ? Inventory.free() : Inventory.free() > 0 ? count : 0);
            if (take > 0) { pack.set(name, (pack.get(name) ?? 0) + take); bank.set(name, (bank.get(name) ?? 0) - take); }
            return take === count;
        })
    ];
    restore.push(...mocks.map(mock => () => mock.mockRestore()));
});

afterEach(() => { bot?.disposeSubscriptions(); restore.splice(0).reverse().forEach(fn => fn()); });

async function start(stealRestock = false): Promise<void> {
    bot = new BrimhavenAgility();
    bot.settings = new SettingsBag({ food: 'Lobster', foodWithdraw: 25, bankAtTickets: 1000, stealRestock });
    bot.bindLog(() => {});
    await bot.onStart();
}

test.each([false, true])('teleports directly from the arena when food runs out (steal=%s)', async steal => {
    tile = new Tile(2794, 9568, 3);
    await start(steal);
    await bot.loop();
    expect(casts).toEqual(['Ardougne']);
    expect(tile).toEqual(new Tile(2661, 3301, 0));
    expect(walks).toHaveLength(0);
});

test.each(['magic', 'quest', 'runes', 'food'])('does not cast when blocked by %s', async blocked => {
    if (blocked === 'magic') magic = 50;
    if (blocked === 'quest') questComplete = false;
    if (blocked === 'runes') pack.set('Law rune', 1);
    if (blocked === 'food') pack.set('Lobster', 1);
    await start();
    await bot.loop();
    expect(casts).toHaveLength(0);
});

test('a cast without arrival falls back to the bank route without casting again', async () => {
    lands = false;
    await start();
    await bot.loop();
    await bot.loop();
    await bot.loop();
    expect(casts).toEqual(['Ardougne']);
    expect(walks).toEqual([Tile.from(ARDY_BANK), Tile.from(ARDY_BANK)]);
});

test('banks one return teleport and leaves room for food, coins and a ticket', async () => {
    pack.delete('Law rune');
    pack.delete('Water rune');
    tile = Tile.from(ARDY_BANK);
    await start();
    await bot.loop();
    expect(pack.get('Law rune')).toBe(2);
    expect(pack.get('Water rune')).toBe(2);
    expect(pack.get('Lobster')).toBe(24);
    expect(Inventory.free()).toBe(1);
    walks = [];
    await bot.loop();
    expect(walks).toEqual([Tile.from(ARENA_ENTRANCE)]);
});

test('missing banked runes keeps the ordinary food loadout', async () => {
    pack.delete('Law rune');
    pack.delete('Water rune');
    bank.delete('Water rune');
    tile = Tile.from(ARDY_BANK);
    await start();
    await bot.loop();
    expect(pack.get('Law rune')).toBeUndefined();
    expect(pack.get('Lobster')).toBe(25);
});

test('successful teleports allow another food trip when runes remain', async () => {
    await start();
    await bot.loop();
    tile = new Tile(ARENA_ENTRANCE.x, ARENA_ENTRANCE.z, 0);
    await bot.loop();
    expect(casts).toEqual(['Ardougne', 'Ardougne']);
});
