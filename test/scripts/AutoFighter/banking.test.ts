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
