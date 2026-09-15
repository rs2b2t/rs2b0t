import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type GroundItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { type Task } from '#/bot/api/bot/Bot.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Trade } from '#/bot/api/trade/Trade.js';
import { Input } from '#/bot/input/Input.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import NatureCrafter from '#/bot/scripts/NatureCrafter/NatureCrafter.js';

class Runner extends NatureCrafter {
    readonly registered: Task[] = [];
    protected override add(...tasks: Task[]): void { this.registered.push(...tasks); }
}

let drops: GroundItemSnapshot[];
let pack: InvItem[];
let collected: number[];
const tile = { x: 2780, z: 3050, level: 0 };
const drop = (id: number, name: string, distance = 1): GroundItemSnapshot => ({ id, name, count: 100, tile, distance, ops: [null, null, 'Take', null, null] });

beforeEach(() => {
    drops = [];
    pack = [];
    collected = [];
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(tile);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Trade, 'active').mockReturnValue(false);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'inventory').mockImplementation(() => pack.map(item => item.snap));
    spyOn(reader, 'groundItems').mockImplementation(() => drops);
    spyOn(reader, 'toLocal').mockReturnValue({ lx: 1, lz: 1 });
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => predicate());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Input, 'takeObj').mockImplementation((_x, _z, id) => {
        const item = drops.find(d => d.id === id)!;
        collected.push(id);
        pack.push(new InvItem({ ...item, slot: pack.length, comId: 3214 }));
        drops = drops.filter(d => d !== item);
        return true;
    });
});
afterEach(() => mock.restore());

async function pickup(): Promise<Task> {
    const bot = new Runner();
    bot.settings = new SettingsBag({ mode: 'Runner', partner: 'master', rune: 'Nature' });
    bot.bindLog(() => {});
    await bot.onStart();
    return bot.registered[4];
}

test('runner picks up dropped coins and observes its coin balance increase', async () => {
    drops = [drop(995, 'Coins')];
    const task = await pickup();
    expect(task.validate()).toBe(true);
    await task.execute();
    expect(collected).toEqual([995]);
    expect(Inventory.count('Coins')).toBe(100);
});

test('runner still collects noted essence and excludes unnoted essence', async () => {
    drops = [drop(1436, 'Rune essence', 0), drop(1437, 'Rune essence')];
    const task = await pickup();
    expect(task.validate()).toBe(true);
    await task.execute();
    expect(collected).toEqual([1437]);
    expect(task.validate()).toBe(false);
});

test('runner does not interrupt a trade or a delivery for coins', async () => {
    drops = [drop(995, 'Coins')];
    const task = await pickup();
    spyOn(Trade, 'active').mockReturnValue(true);
    expect(task.validate()).toBe(false);
    spyOn(Trade, 'active').mockReturnValue(false);
    pack.push(new InvItem({ id: 1436, name: 'Rune essence', count: 1, slot: 0, comId: 3214, ops: [] }));
    expect(task.validate()).toBe(false);
});

test('coins outside the pickup range are left alone', async () => {
    drops = [drop(995, 'Coins', 100)];
    expect((await pickup()).validate()).toBe(false);
});
