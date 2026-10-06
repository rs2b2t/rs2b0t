import { afterEach, beforeEach, expect, test } from 'bun:test';
import AutoFighter, { shouldKeepBankItem } from '#/bot/scripts/AutoFighter/AutoFighter.js';
import { wantsAutoFighterLoot } from '#/bot/scripts/AutoFighter/AutoFighterData.js';
import type { Task } from '#/bot/api/bot/Bot.js';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Input } from '#/bot/input/Input.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Game } from '#/bot/api/game/Game.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Sustain } from '#/bot/api/sustain/Sustain.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import Tile from '#/bot/geometry/Tile.js';
import { stubProps } from '../../lib/stubSingletons.js';

class Fighter extends AutoFighter {
    registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}

let bot: Fighter;
let inventory: InvItemSnapshot[];
let logs: string[];
let restores: (() => void)[];
let consumed: boolean;
const bone = (id: number, name: string, slot: number, noted = false, ops = ['Bury']): InvItemSnapshot => ({
    id, name, slot, count: noted ? 10 : 1, noted, ops, comId: 1
});
const task = () => bot.registered.find(t => t.constructor.name === 'BuryBones')!;
async function start(settings: Record<string, boolean> = {}) {
    bot = new Fighter();
    bot.bindLog(message => logs.push(message));
    bot.settings = new SettingsBag({ foodWithdraw: 0, panicHp: 0, solveClues: false, ...settings });
    await bot.onStart();
}

beforeEach(() => {
    inventory = [];
    logs = [];
    consumed = true;
    restores = [
        stubProps(reader, { inventory: () => inventory, inventorySize: () => 28, bankComId: () => -1, equipment: () => [] }),
        stubProps(Game, { tile: () => new Tile(3200, 3200), ingame: () => true, inCombat: () => false }),
        stubProps(Skills, { xp: () => 0, level: () => 40, effective: () => 40, hpFraction: () => 1 }),
        stubProps(Sustain, { set: () => {} }),
        stubProps(Execution, { delayUntil: async check => check(), delayTicks: async () => {} }),
        stubProps(EventSignal, { pending: () => false }),
        stubProps(Input, { heldOp: (_id, slot) => { if (consumed) inventory = inventory.filter(item => item.slot !== slot); return true; } })
    ];
});

afterEach(() => {
    bot?.disposeSubscriptions();
    for (const restore of restores.reverse()) restore();
});

test('Big bones stay untouched by default and with only regular burial enabled', async () => {
    inventory = [bone(532, 'Big bones', 0)];
    await start();
    expect(task().validate()).toBe(false);
    bot.disposeSubscriptions();
    await start({ buryBones: true });
    expect(task().validate()).toBe(false);
    expect(Inventory.count('Big bones')).toBe(1);
    expect(wantsAutoFighterLoot('Big bones', [], true)).toBe(false);
    expect(shouldKeepBankItem('Big bones', 532, 'Trout', true, [], [], true)).toBe(false);
});

test('Big bones can be buried independently of regular bones', async () => {
    inventory = [bone(526, 'Bones', 0), bone(532, 'Big bones', 1), bone(536, 'Dragon bones', 2)];
    await start({ buryBigBones: true });
    expect(task().validate()).toBe(true);
    await task().execute();
    expect(Inventory.count('Big bones')).toBe(0);
    expect(Inventory.count('Bones')).toBe(1);
    expect(Inventory.count('Dragon bones')).toBe(1);
    expect(task().validate()).toBe(false);
    expect(logs).toContain('buried Big bones');
});

test('both options bury both supported types and stop when no eligible bones remain', async () => {
    inventory = [bone(526, 'Bones', 0), bone(532, 'Big bones', 1)];
    await start({ buryBones: true, buryBigBones: true });
    expect(task().validate()).toBe(true);
    await task().execute();
    expect(task().validate()).toBe(true);
    await task().execute();
    expect(inventory).toEqual([]);
    expect(task().validate()).toBe(false);
});

test('noted bones and items without Bury do not block usable bones or keep burial running', async () => {
    inventory = [bone(533, 'Big bones', 0, true), bone(532, 'Big bones', 1, false, ['Drop']), bone(532, 'Big bones', 2)];
    await start({ buryBigBones: true });
    expect(task().validate()).toBe(true);
    await task().execute();
    expect(inventory.map(item => item.slot)).toEqual([0, 1]);
    expect(task().validate()).toBe(false);
    expect(logs.filter(message => message.startsWith('buried '))).toEqual(['buried Big bones']);
});

test('a dispatched Bury without consumption does not report a burial', async () => {
    inventory = [bone(532, 'Big bones', 0)];
    consumed = false;
    await start({ buryBigBones: true });
    await task().execute();
    expect(Inventory.count('Big bones')).toBe(1);
    expect(logs.filter(message => message.startsWith('buried '))).toEqual([]);
});

test('the Big bones option forces their loot and protects them during banking independently', () => {
    expect(wantsAutoFighterLoot('Big bones', [], false, true)).toBe(true);
    expect(wantsAutoFighterLoot('Bones', [], false, true)).toBe(false);
    expect(wantsAutoFighterLoot('Dragon bones', [], true, true)).toBe(false);
    expect(shouldKeepBankItem('Big bones', 532, 'Trout', true, [], [], false, true)).toBe(true);
    expect(shouldKeepBankItem('Bones', 526, 'Trout', true, [], [], false, true)).toBe(false);
});

test('enabling Big bones makes the live loot task select their drops', async () => {
    let name = 'Big bones';
    restores.push(stubProps(reader, { groundItems: () => [{ id: 532, name, count: 1, ops: ['Take'], tile: new Tile(3201, 3200), distance: 1 }] }));
    await start({ buryBigBones: true });
    const loot = bot.registered.find(t => t.constructor.name === 'LootDrops')!;
    expect(loot.validate()).toBe(true);
    name = 'Bones';
    expect(loot.validate()).toBe(false);
});

test('banking deposits noted regular and Big bones even when burial is enabled', () => {
    expect(shouldKeepBankItem('Bones', 527, 'Trout', true, [], [], true, true)).toBe(false);
    expect(shouldKeepBankItem('Big bones', 533, 'Trout', true, [], [], true, true)).toBe(false);
    expect(shouldKeepBankItem('Bones', 526, 'Trout', true, [], [], true, true)).toBe(true);
    expect(shouldKeepBankItem('Big bones', 532, 'Trout', true, [], [], true, true)).toBe(true);
});
