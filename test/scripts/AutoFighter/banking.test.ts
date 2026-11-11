import { afterEach, beforeEach, expect, test } from 'bun:test';
import AutoFighter from '#/bot/scripts/AutoFighter/AutoFighter.js';
import type { Task } from '#/bot/api/bot/Bot.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../lib/stubSingletons.js';

class Fighter extends AutoFighter {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}

const BASEMENT = new Tile(2700, 9774, 0);
const GUILD_BANK = new Tile(2732, 3378, 2);
let bot: Fighter;
let food: number;
let hp: number;
let walked: Tile[];
let opened: string[];
let restores: (() => void)[];

beforeEach(async () => {
    food = 0;
    hp = 100;
    walked = [];
    opened = [];
    restores = [
        stubProps(Game, { tile: () => BASEMENT, ingame: () => true, inCombat: () => false }),
        stubProps(Skills, { xp: () => 0, level: () => 100, effective: () => hp, hpFraction: () => hp / 100 }),
        stubProps(Quests, { status: () => 'complete' }),
        stubProps(Sustain, { set: () => {} }),
        stubProps(Execution, { delayUntil: async (check: () => boolean) => check() }),
        stubProps(Inventory, { count: () => food, items: () => Array.from({ length: food }, (_, slot) => new InvItem({ name: 'Trout', id: 333, count: 1, slot, comId: 1, ops: ['Eat'] })), isFull: () => false }),
        stubProps(Navigator, { findPath: async (_from, to) => ({ ok: true, waypoints: [], expanded: 0, hops: [], cost: GUILD_BANK.equals(to) ? 50 : 300 }) }),
        stubProps(Traversal, { walkResilient: async (tile: Tile) => { walked.push(tile); return true; } }),
        stubProps(Bank, {
            openNpcAccess: async (access: { name: string; op: string }) => { opened.push(`${access.name}:${access.op}`); return true; },
            openNearest: async () => false,
            depositAllMatching: async () => {},
            withdraw: async () => { food++; return true; },
            close: async () => true
        })
    ];
    bot = new Fighter();
    bot.settings = new SettingsBag({ target: 'Shadow warrior', food: 'Trout', foodWithdraw: 5, bankLocation: 'Nearest', solveClues: false });
    bot.bindLog(() => {});
    await bot.onStart();
});

afterEach(() => {
    bot.disposeSubscriptions();
    for (const restore of restores.reverse()) restore();
});

test('food restocking walks to the upstairs guild banker and returns to the shadow warriors', async () => {
    const bank = bot.registered.find(task => task.constructor.name === 'BankRun')!;
    expect(await bank.validate()).toBe(true);
    await bank.execute();
    expect(walked).toEqual([GUILD_BANK, BASEMENT]);
    expect(opened).toEqual(['Banker:Bank']);
    expect(food).toBe(5);
});

test('a foodless panic retreat uses the upstairs guild bank too', async () => {
    hp = 10;
    const panic = bot.registered.find(task => task.constructor.name === 'PanicRetreat')!;
    expect(await panic.validate()).toBe(true);
    await panic.execute();
    expect(walked).toEqual([GUILD_BANK]);
    expect(opened).toEqual(['Banker:Bank']);
    expect(food).toBe(5);
});

test('banking preserves Big bones selected for burial and deposits other loot', async () => {
    let inventory = [
        new InvItem({ name: 'Big bones', id: 532, count: 1, slot: 0, comId: 1, ops: ['Bury'] }),
        new InvItem({ name: 'Bones', id: 526, count: 1, slot: 1, comId: 1, ops: ['Bury'] }),
        new InvItem({ name: 'Uncut ruby', id: 1619, count: 1, slot: 2, comId: 1, ops: ['Drop'] })
    ];
    restores.push(
        stubProps(Inventory, { items: () => inventory }),
        stubProps(Bank, { depositAllMatching: async match => { inventory = inventory.filter(item => !match(item.name!, item.id)); } })
    );
    bot.disposeSubscriptions();
    bot = new Fighter();
    bot.bindLog(() => {});
    bot.settings = new SettingsBag({ foodWithdraw: 0, buryBigBones: true, solveClues: false });
    await bot.onStart();
    bot.bankAfterSolve = true;
    const bank = bot.registered.find(task => task.constructor.name === 'BankRun')!;
    expect(bank.validate()).toBe(true);
    await bank.execute();
    expect(inventory.map(item => item.name)).toEqual(['Big bones']);
});

test('delegated banking keeps travel tools and replenishes the fare before returning', async () => {
    const held: Record<string, number> = { Coins: 25, 'Bronze axe': 1, 'Uncut ruby': 1 };
    restores.push(
        stubProps(Inventory, { count: name => held[name] ?? 0, items: () => Object.entries(held).filter(([, count]) => count > 0).map(([name, count], slot) => new InvItem({ name, count, id: slot + 1, slot, comId: 1, ops: [] })) }),
        stubProps(Bank, {
            depositAllMatching: async match => { for (const name of Object.keys(held)) if (match(name, 1)) held[name] = 0; },
            withdrawX: async (name, count) => { held[name] = (held[name] ?? 0) + count; return true; }
        })
    );
    bot.disposeSubscriptions();
    bot = new Fighter();
    bot.bindLog(() => {});
    bot.bindFinish(reason => { throw new Error(reason); });
    bot.settings = new SettingsBag({ foodWithdraw: 0, solveClues: false, travelCoins: 1200, travelItems: ['Bronze axe'] });
    await bot.onStart();
    bot.bankAfterSolve = true;
    await bot.registered.find(task => task.constructor.name === 'BankRun')!.execute();
    expect(held).toEqual({ Coins: 1200, 'Bronze axe': 1, 'Uncut ruby': 0 });
    expect(walked).toEqual([GUILD_BANK, BASEMENT]);
});

test('delegated banking finishes at the bank when it cannot restore travel supplies', async () => {
    restores.push(stubProps(Inventory, { count: () => 0 }), stubProps(Bank, { withdraw: async () => false, withdrawX: async () => false }));
    bot.disposeSubscriptions();
    bot = new Fighter();
    bot.bindLog(() => {});
    bot.bindFinish(reason => { throw new Error(reason); });
    bot.settings = new SettingsBag({ foodWithdraw: 0, solveClues: false, travelCoins: 1200 });
    await bot.onStart();
    bot.bankAfterSolve = true;
    await expect(bot.registered.find(task => task.constructor.name === 'BankRun')!.execute()).rejects.toThrow('Missing travel supply: Coins');
    expect(walked).toEqual([GUILD_BANK]);
});
