import { afterEach, beforeEach, expect, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Loc, Locs } from '#/bot/api/locs/Locs.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import Tile from '#/bot/geometry/Tile.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import FlaxSpinner from '#/bot/scripts/FlaxSpinner/FlaxSpinner.js';
import { stubProps } from '../../lib/stubSingletons.js';

let restores: (() => void)[];
let inventory: InvItemSnapshot[];
let bank: InvItemSnapshot[];
let tile: Tile;
let withdrawals: string[];
let stops: string[];

function item(id: number, name: string, count = 1): InvItemSnapshot {
    return { id, name, count, slot: 0, comId: 3214, ops: ['Withdraw-All'] };
}

async function start(product = 'Wool'): Promise<FlaxSpinner> {
    const bot = new FlaxSpinner();
    bot.settings = new SettingsBag({ product });
    bot.bindLog(() => {});
    await bot.onStart();
    return bot;
}

beforeEach(() => {
    inventory = [];
    bank = [];
    tile = new Tile(2722, 3493, 0);
    withdrawals = [];
    stops = [];
    restores = [
        stubProps(reader, { bankComId: () => -1, inventory: () => inventory, bankItems: () => bank }),
        stubProps(Game, { ingame: () => true, sceneReady: () => true, tile: () => tile, animating: () => false }),
        stubProps(Skills, { xp: () => 0 }),
        stubProps(ChatDialog, { canContinue: () => false, isMakeMenu: () => false }),
        stubProps(Execution, { delayUntil: async check => check(), delayTicks: async () => {} }),
        stubProps(EventSignal, { pending: () => false }),
        stubProps(ScriptRunner, { stop: reason => { stops.push(reason ?? ''); } }),
        stubProps(Bank, {
            openBooth: async () => true,
            depositInventory: async () => { bank.push(...inventory); inventory = []; },
            withdraw: async name => {
                withdrawals.push(name);
                inventory = bank.filter(entry => entry.name === name);
                bank = bank.filter(entry => entry.name !== name);
                return true;
            }
        })
    ];
});

afterEach(() => {
    for (const restore of restores.reverse()) restore();
});

test('counts raw wool without counting balls of wool or golden wool', async () => {
    const bot = await start();
    inventory = [item(1759, 'Ball of wool', 10), item(1737, 'Wool', 3), item(3693, 'Golden wool')];
    expect(bot.fibreCount()).toBe(3);
});

test('counts flax without counting toadflax', async () => {
    const bot = await start('Flax');
    inventory = [item(2998, 'Toadflax', 10), item(1779, 'Flax', 3)];
    expect(bot.fibreCount()).toBe(3);
});

test('withdraws raw wool when balls of wool come first in the bank', async () => {
    const bot = await start();
    bank = [item(1759, 'Ball of wool', 100), item(1737, 'Wool', 28)];
    await bot.loop();
    expect(withdrawals).toEqual(['Wool']);
    expect(bot.fibreCount()).toBe(28);
});

test('banks finished balls and stops when raw wool is exhausted', async () => {
    const bot = await start();
    inventory = [item(1759, 'Ball of wool', 28)];
    await bot.loop();
    expect(inventory).toEqual([]);
    expect(bank).toEqual([item(1759, 'Ball of wool', 28)]);
    expect(withdrawals).toEqual([]);
    expect(stops).toEqual(["out of 'Wool' in the bank"]);
});

for (const [product, rawId, output, outputId] of [
    ['Wool', 1737, 'Ball of wool', 1759],
    ['Flax', 1779, 'Bow string', 1777]
] as const) {
    test(`spins a batch of ${product} and descends with only ${output}`, async () => {
        const bot = await start(product);
        tile = new Tile(2711, 3471, 1);
        inventory = [item(rawId, product, 3)];
        let spinning = false;
        let menu = true;
        let made: [string, number] | undefined;
        const ladder = new Loc({ id: 1747, name: 'Ladder', typecode: 0, tile, distance: 1, ops: ['Climb-down'] });
        const query = Locs.query();
        restores.push(
            stubProps(ChatDialog, {
                isMakeMenu: () => menu,
                makeX: async (name, amount) => { made = [name, amount]; menu = false; spinning = true; return true; }
            }),
            stubProps(Execution, {
                delayTicks: async () => {
                    if (!spinning) return;
                    const raw = inventory.find(entry => entry.id === rawId);
                    if (!raw) return;
                    raw.count--;
                    inventory = inventory.filter(entry => entry.count > 0);
                    inventory.push(item(outputId, output));
                }
            }),
            stubProps(Locs, { query: () => query }),
            stubProps(query, { name: () => query, action: () => query, nearest: () => ladder }),
            stubProps(ladder, { interact: async () => { tile = new Tile(2714, 3471, 0); return true; } })
        );
        await bot.loop();
        expect(made).toEqual([product, 3]);
        expect(bot.fibreCount()).toBe(0);
        expect(inventory.map(entry => entry.name)).toEqual([output, output, output]);
        await bot.loop();
        expect(tile.level).toBe(0);
    });
}
