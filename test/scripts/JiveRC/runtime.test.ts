import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import type { Task } from '#/bot/api/bot/Bot.js';
import { bus } from '#/bot/api/events/EventBus.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Trade } from '#/bot/api/trade/Trade.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import { Input } from '#/bot/input/Input.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import JiveRC from '#/bot/scripts/JiveRC/JiveRC.js';

class Crafter extends JiveRC {
    readonly registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}

const BANK = new Tile(3152, 9575, 0);
const RUINS = new Tile(3173, 9501, 0);
const MEET = new Tile(2142, 4830, 0);
let bot: Crafter;
let tile: Tile;
let pack: InvItemSnapshot[];
let walks: Tile[];
let now: number;
let bankOpen: boolean;
let noted: boolean;
let deposits: string[];

const item = (id: number, name: string, count = 1): InvItemSnapshot =>
    ({ id, name, count, slot: 0, comId: 3214, ops: ['Drop'] });
const task = (name: string): Task => bot.registered.find(t => t.constructor.name === name)!;
const essence = (n: number): InvItemSnapshot[] => Array.from({ length: n }, (_, slot) => ({ ...item(1436, 'Rune essence'), slot }));

beforeEach(() => {
    tile = BANK;
    pack = [];
    walks = [];
    now = 1_000_000;
    bankOpen = false;
    noted = true;
    deposits = [];
    spyOn(Date, 'now').mockImplementation(() => now);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockImplementation(() => tile);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(reader, 'inventory').mockImplementation(() => pack);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'players').mockReturnValue([]);
    spyOn(reader, 'toLocal').mockImplementation((x, z) => ({ lx: x, lz: z }));
    spyOn(reader, 'locs').mockImplementation(() => tile.z < 5000 ? [
        { typecode: 2, id: 2487, name: 'Altar', ops: ['Craft-rune'], tile: new Tile(2141, 4832, 0), distance: 1 },
        { typecode: 3, id: 2473, name: 'Portal', ops: ['Use'], tile: new Tile(2142, 4812, 0), distance: 18 }
    ] : [
        { typecode: 1, id: 2461, name: 'Mysterious ruins', ops: [], tile: new Tile(3176, 9497, 0), distance: 1 }
    ]);
    spyOn(Input, 'useItemOnLoc').mockImplementation((id, _slot, _com, _x, _z, typecode) => {
        if (id !== 1454 || typecode !== 1) return false;
        tile = new Tile(2142, 4813, 0);
        return true;
    });
    spyOn(Input, 'interactLoc').mockImplementation((_x, _z, typecode, op) => {
        if (typecode === 2 && op === 1) {
            const count = Inventory.countById(1436);
            pack = pack.filter(i => i.id !== 1436);
            pack.push(item(564, 'Cosmic rune', count));
            return true;
        }
        if (typecode === 3 && op === 1) {
            tile = RUINS;
            return true;
        }
        return false;
    });
    spyOn(Trade, 'active').mockReturnValue(false);
    spyOn(Trade, 'myOffer').mockReturnValue([]);
    spyOn(Trade, 'theirOffer').mockReturnValue([]);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Execution, 'delayUntil').mockImplementation(async check => check());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Traversal, 'walkResilient').mockImplementation(async dest => {
        tile = Tile.from(dest);
        walks.push(tile);
        return true;
    });
    spyOn(Bank, 'openBooth').mockResolvedValue(false);
    spyOn(Bank, 'openNearest').mockResolvedValue(false);
    spyOn(Bank, 'openNpcAccess').mockImplementation(async access => {
        bankOpen = access.name === 'Banker' && access.op === 'Bank';
        return bankOpen;
    });
    spyOn(Bank, 'isOpen').mockImplementation(() => bankOpen);
    spyOn(Bank, 'loaded').mockImplementation(() => bankOpen);
    spyOn(Bank, 'setNoteMode').mockImplementation(async value => { noted = value; });
    spyOn(Bank, 'count').mockImplementation(name => name === 'Rune essence' ? 1000 : 0);
    spyOn(Bank, 'depositAllMatching').mockImplementation(async match => {
        pack = pack.filter(i => {
            if (!match(i.name!, i.id)) return true;
            deposits.push(i.name!);
            return false;
        });
    });
    spyOn(Bank, 'withdrawX').mockImplementation(async (name, count) => {
        if (!bankOpen || name !== 'Rune essence') return false;
        pack.push(...(noted ? [item(1437, name, count)] : essence(count)));
        pack.forEach((i, slot) => { i.slot = slot; });
        return true;
    });
    bot = new Crafter();
    bot.bindLog(() => {});
});

afterEach(() => {
    bot.disposeSubscriptions();
    mock.restore();
});

async function start(mode = 'Master', stayInAltar = false, rune = 'Cosmic runes'): Promise<void> {
    bot.settings = new SettingsBag({ mode, stayInAltar, rune, partner: 'partner', bankEvery: 1 });
    await bot.onStart();
}

test('a cosmic master starts at Runecrafting 27 and keeps its talisman and entry staff', async () => {
    spyOn(Skills, 'level').mockReturnValue(27);
    await start();
    expect(bot.cfg().rune).toBe('Cosmic rune');
    expect(bot.keepList(true)).toContain('cosmic talisman');
    expect(bot.keepList(true)).toContain('cosmic rune');
    expect(bot.keepList(true)).toContain('dramen staff');
});

test('a cosmic master below Runecrafting 27 cannot start', async () => {
    spyOn(Skills, 'level').mockReturnValue(26);
    await expect(start()).rejects.toThrow('runecrafting level too low');
});

test('cosmic runners can deliver outside without a Runecrafting level or talisman', async () => {
    spyOn(Skills, 'level').mockReturnValue(1);
    await start('Runner');
    pack = essence(25);
    await task('DeliverEssence').execute();
    expect(walks).toEqual([RUINS]);
});

test.each(['Master', 'Runner'])('cosmic %s gives an actionable error when started outside Zanaris', async mode => {
    tile = new Tile(3200, 3200, 0);
    await expect(start(mode)).rejects.toThrow('Zanaris');
});

test('cosmic startup accepts the western bank path but rejects the Lumbridge cellar', async () => {
    tile = new Tile(3145, 9550, 0);
    await start('Runner');
    tile = new Tile(3209, 9616, 0);
    await expect(start('Runner')).rejects.toThrow('Zanaris');
});

test('the cosmic master enters from Zanaris instead of treating it as an altar', async () => {
    tile = RUINS;
    pack = essence(25);
    await start();
    expect(task('EnterAltar').validate()).toBe(true);
});

test('an empty cosmic master waits at the ruins instead of trying to portal out of Zanaris', async () => {
    tile = RUINS;
    await start();
    expect(task('ExitTemple').validate()).toBe(false);
    expect(task('WaitForRunner').validate()).toBe(true);
});

test('a cosmic runner banks one unnoted trade load through the fairy banker', async () => {
    pack = [item(772, 'Dramen staff'), item(995, 'Coins', 10)];
    await start('Runner');
    expect(task('BankRestock').validate()).toBe(true);
    await task('BankRestock').execute();
    expect(bankOpen).toBe(true);
    expect(Inventory.countById(1436)).toBe(25);
    expect(Inventory.countById(1437)).toBe(0);
    expect(Inventory.contains('Dramen staff')).toBe(true);
    expect(deposits).toEqual(['Coins']);
});

test('a cosmic master banks through the fairy banker and returns with its talisman and staff', async () => {
    tile = RUINS;
    pack = [item(1454, 'Cosmic talisman'), item(772, 'Dramen staff'), item(564, 'Cosmic rune', 200)];
    await start();
    now += 60_001;
    expect(task('BankEverything').validate()).toBe(true);
    await task('BankEverything').execute();
    expect(walks).toEqual([BANK, RUINS]);
    expect(deposits).toEqual(['Cosmic rune']);
    expect(pack.map(i => i.name)).toEqual(['Cosmic talisman', 'Dramen staff']);
});

test.each([[2142, 4813], [2162, 4833], [2142, 4853], [2122, 4833]])('inside runner meets the master from cosmic entry pad %i,%i', async (x, z) => {
    tile = new Tile(x, z, 0);
    pack = [item(1454, 'Cosmic talisman'), ...essence(25)];
    await start('Runner', true);
    await task('DeliverEssence').execute();
    expect(walks).toEqual([MEET]);
});

test('inside master meets runners from its cosmic entry pad', async () => {
    tile = new Tile(2162, 4833, 0);
    await start('Master', true);
    await task('WaitForRunner').execute();
    expect(walks).toEqual([MEET]);
});

test('an old trade request cannot strand the cosmic master on its next entry pad', async () => {
    tile = MEET;
    await start('Master', true);
    bus.emit('chat.message', { type: 4, username: 'partner', text: 'wishes to trade with you.' });
    bot.markHandshakeStarted();
    now += 60_001;
    tile = new Tile(2162, 4833, 0);
    await task('WaitForRunner').execute();
    expect(walks).toEqual([MEET]);
});

test('a runner still in Zanaris does not take a portal after delivering outside', async () => {
    pack = [item(1454, 'Cosmic talisman')];
    await start('Runner', true);
    expect(task('ExitAltarForRestock').validate()).toBe(false);
});

test.each([0, 25])('outside-trading runner leaves the cosmic altar when started with %i essence', async count => {
    tile = MEET;
    pack = essence(count);
    await start('Runner');
    const next = task(count > 0 ? 'DeliverEssence' : 'ExitAltarForRestock');
    expect(next.validate()).toBe(true);
    await next.execute();
    expect(tile).toEqual(RUINS);
    expect(Inventory.countById(1436)).toBe(count);
});

test.each([false, true])('cosmic master uses its talisman, crafts and respects inside trading (%s)', async stay => {
    tile = RUINS;
    pack = [item(1454, 'Cosmic talisman'), ...essence(25)];
    await start('Master', stay);
    await task('EnterAltar').execute();
    expect(tile).toEqual(new Tile(2142, 4813, 0));
    expect(task('CraftRunes').validate()).toBe(true);
    await task('CraftRunes').execute();
    expect(Inventory.countById(1436)).toBe(0);
    expect(Inventory.countById(564)).toBe(25);
    expect(bot.inTemple()).toBe(stay);
    if (!stay) expect(tile).toEqual(RUINS);
});

test('Go bank leaves the cosmic altar before walking to Zanaris bank', async () => {
    tile = MEET;
    pack = [item(1454, 'Cosmic talisman'), ...essence(25)];
    await start('Runner', true);
    spyOn(bot, 'goBankActive').mockReturnValue(true);
    await task('GoBankPark').execute();
    expect(tile).toEqual(RUINS);
    await task('GoBankPark').execute();
    expect(tile).toEqual(BANK);
});

test.each([
    ['Air runes', 2843, 4833],
    ['Nature runes', 2399, 4840],
    ['Cosmic runes', 2141, 4832]
])('%s recognizes only its own altar mapsquare', async (rune, x, z) => {
    tile = new Tile(Number(x), Number(z), 0);
    await start('Master', false, String(rune));
    expect(task('ExitTemple').validate()).toBe(true);
    tile = new Tile(2900, 4820, 0);
    expect(task('ExitTemple').validate()).toBe(false);
    tile = new Tile(Number(x), Number(z), 1);
    expect(task('ExitTemple').validate()).toBe(false);
});
