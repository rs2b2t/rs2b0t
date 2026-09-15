import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { reader, type GroundItemSnapshot, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import Tile from '#/bot/geometry/Tile.js';
import { Input } from '#/bot/input/Input.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import JiveChests from '#/bot/scripts/JiveChests/JiveChests.js';
import { CHEST_STAND } from '#/bot/scripts/JiveChests/logic.js';

const KEY = 989;
const STONE = 1631;
const BAR = 2363;
const RUBY = 1603;
const LAW = 563;
const AIR = 556;
const WATER = 555;
const BODY = 559;
const SHIELD = 1183;
const BANK = new Tile(2946, 3369, 0);
const names = new Map([
    [KEY, 'Crystal key'], [STONE, 'Uncut dragonstone'], [BAR, 'Runite bar'], [RUBY, 'Ruby'], [1601, 'Diamond'],
    [985, 'Half of a key'], [987, 'Half of a key'], [1079, 'Rune platelegs'], [1093, 'Rune plateskirt'],
    [LAW, 'Law rune'], [AIR, 'Air rune'], [WATER, 'Water rune'], [557, 'Earth rune'], [554, 'Fire rune'],
    [BODY, 'Body rune'], [558, 'Mind rune'], [562, 'Chaos rune'], [560, 'Death rune'], [564, 'Cosmic rune'],
    [561, 'Nature rune'], [SHIELD, 'Adamant sq shield'], [995, 'Coins'], [372, 'Raw swordfish'],
    [440, 'Iron ore'], [441, 'Iron ore'], [946, 'Knife']
]);
const stacks = new Set([LAW, AIR, WATER, 557, 554, BODY, 558, 562, 560, 564, 561, 995, 441]);

function item(id: number, count = 1, slot = 0): InvItemSnapshot {
    return { id, name: names.get(id)!, count, slot, comId: 3214, ops: ['Drop'] };
}

function ground(id: number, count = 1, tile = CHEST_STAND): GroundItemSnapshot {
    return { id, name: names.get(id)!, count, tile, distance: 0, ops: ['Take'] };
}

function copies(id: number, count: number): InvItemSnapshot[] {
    return Array.from({ length: count }, (_, slot) => item(id, 1, slot));
}

function fixture(pack: InvItemSnapshot[] = [], floor: GroundItemSnapshot[] = [], teleportHome = false) {
    const state = {
        pack, floor, tile: CHEST_STAND, bank: new Map<number, number>(), open: false, stopped: false,
        rewards: [] as InvItemSnapshot[][], taken: [] as number[], closeFailures: 0, takeFailures: 0,
        depositFailures: 0, withdrawFailures: 0
    };
    const reindex = () => state.pack.forEach((i, slot) => { i.slot = slot; });
    const add = (id: number, count: number): number => {
        const held = stacks.has(id) ? state.pack.find(i => i.id === id) : undefined;
        if (held) { held.count += count; return count; }
        if (state.pack.length >= 28) return 0;
        const added = stacks.has(id) ? count : Math.min(count, 28 - state.pack.length);
        state.pack.push(...(stacks.has(id) ? [item(id, added)] : copies(id, added)));
        reindex();
        return added;
    };
    reindex();
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.pack);
    spyOn(reader, 'bankComId').mockImplementation(() => state.open ? 5292 : -1);
    spyOn(reader, 'bankItems').mockImplementation(() => [...state.bank].map(([id, count], slot) => item(id, count, slot)));
    spyOn(reader, 'groundItems').mockImplementation(() => CHEST_STAND.distanceTo(state.tile) < 15 ? state.floor : []);
    spyOn(reader, 'objCatalog').mockReturnValue([...names].map(([id, name]) => ({ id, name, stackable: stacks.has(id), cost: 1, members: true, equippable: false, certlink: -1, certtemplate: -1 })));
    spyOn(reader, 'toLocal').mockImplementation((lx, lz) => ({ lx, lz }));
    spyOn(reader, 'locs').mockReturnValue([{ id: 172, name: 'Closed chest', typecode: 1, tile: new Tile(2914, 3452, 0), distance: 1, ops: ['Open'] }]);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(Skills, 'level').mockReturnValue(99);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(Execution, 'delayUntil').mockImplementation(async predicate => Boolean(await predicate()));
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Traversal, 'walkResilient').mockImplementation(async tile => { state.tile = Tile.from(tile); return true; });
    spyOn(Bank, 'isOpen').mockImplementation(() => state.open);
    spyOn(Bank, 'loaded').mockReturnValue(true);
    spyOn(Bank, 'openBooth').mockImplementation(async () => { state.open = true; return true; });
    spyOn(Bank, 'close').mockImplementation(async () => {
        if (state.closeFailures-- > 0) return false;
        state.open = false;
        return true;
    });
    spyOn(Bank, 'depositAllMatching').mockImplementation(async match => {
        if (state.depositFailures-- > 0) return;
        state.pack = state.pack.filter(i => {
            if (!match(i.name!, i.id)) return true;
            state.bank.set(i.id, (state.bank.get(i.id) ?? 0) + i.count);
            return false;
        });
        reindex();
    });
    spyOn(Bank, 'withdrawX').mockImplementation(async (name, count) => {
        if (state.withdrawFailures-- > 0) return false;
        const id = [...names].find(([, value]) => value === name)![0];
        if ((state.bank.get(id) ?? 0) < count) return false;
        const added = add(id, count);
        state.bank.set(id, state.bank.get(id)! - added);
        return added === count;
    });
    spyOn(Input, 'heldOp').mockImplementation((id, slot) => {
        const dropped = state.pack.find(i => i.id === id && i.slot === slot);
        if (!dropped) return false;
        state.floor.push(ground(id, dropped.count, state.tile));
        state.pack = state.pack.filter(i => i !== dropped);
        reindex();
        return true;
    });
    spyOn(Input, 'takeObj').mockImplementation((x, z, id) => {
        if (state.takeFailures-- > 0) return false;
        const drop = state.floor.find(i => i.id === id && i.tile.x === x && i.tile.z === z && i.tile.level === state.tile.level);
        if (!drop || state.open) return false;
        const added = add(id, drop.count);
        if (!added) return false;
        drop.count -= added;
        state.floor = state.floor.filter(i => i.count > 0);
        state.taken.push(id);
        return true;
    });
    spyOn(Input, 'useItemOnLoc').mockImplementation((id, slot) => {
        if (id !== KEY || state.open || !state.tile.equals(CHEST_STAND)) return false;
        state.pack = state.pack.filter(i => i.slot !== slot);
        reindex();
        for (const reward of state.rewards.shift() ?? [item(STONE)]) {
            const overflow = reward.count - add(reward.id, reward.count);
            if (overflow > 0) {
                state.floor.push(...(stacks.has(reward.id) ? [ground(reward.id, overflow)] : Array.from({ length: overflow }, () => ground(reward.id))));
            }
        }
        return true;
    });
    spyOn(Game, 'teleport').mockImplementation(async id => {
        if (id !== 'falador') return false;
        for (const [rune, count] of [[AIR, 3], [WATER, 1], [LAW, 1]]) {
            const held = state.pack.find(i => i.id === rune);
            if (!held || held.count < count!) return false;
            held.count -= count!;
        }
        state.pack = state.pack.filter(i => i.count > 0);
        reindex();
        state.tile = new Tile(2965, 3378, 0);
        return true;
    });
    spyOn(ScriptRunner, 'stop').mockImplementation(() => { state.stopped = true; });
    const bot = new JiveChests();
    bot.settings = new SettingsBag({ teleportHome });
    bot.bindLog(() => {});
    return { bot, state };
}

afterEach(() => mock.restore());

describe('JiveChests reward recovery', () => {
    test('uses another key after the first reward is runes and the body runes are dropped', async () => {
        const { bot, state } = fixture(copies(KEY, 7));
        state.rewards.push([item(STONE), ...[AIR, WATER, 557, 554, BODY, 558, 562, 560, 564, 561, LAW].map(id => item(id, 10))]);
        await bot.onStart();
        await bot.loop();
        await bot.loop();
        await bot.loop();
        expect(bot.opened).toBe(2);
        expect(Inventory.count('Crystal key')).toBe(5);
        expect(state.tile).toEqual(CHEST_STAND);
    });

    test('drops the adamant shield to recover a runite bar before using another key', async () => {
        const { bot, state } = fixture([item(KEY), item(SHIELD), ...copies(RUBY, 26)], [ground(BAR)]);
        await bot.onStart();
        await bot.loop();
        await bot.loop();
        expect(Inventory.countById(SHIELD)).toBe(0);
        expect(Inventory.countById(BAR)).toBe(1);
        expect(bot.opened).toBe(0);
        expect(state.taken).toEqual([BAR]);
    });

    test('collects rewards in the requested priority order and leaves junk alone', async () => {
        const { bot, state } = fixture([item(KEY)], [995, 1079, RUBY, 1601, BAR, 985, STONE, BODY, SHIELD].map(id => ground(id)));
        await bot.onStart();
        for (let i = 0; i < 7; i++) await bot.loop();
        expect(state.taken).toEqual([STONE, 985, BAR, 1601, RUBY, 1079, 995]);
        expect(bot.opened).toBe(0);
        expect(state.floor.map(i => i.id)).toEqual([BODY, SHIELD]);
    });

    test('accepts both key halves and rune skirts ahead of ordinary rewards', async () => {
        const { bot, state } = fixture([item(KEY)], [ground(995), ground(1093), ground(987)]);
        await bot.onStart();
        for (let i = 0; i < 3; i++) await bot.loop();
        expect(state.taken).toEqual([987, 1093, 995]);
    });

    test('collects an existing rune stack even when the pack is full and a bar cannot fit', async () => {
        const { bot, state } = fixture([item(KEY), item(LAW), ...copies(RUBY, 26)], [ground(BAR), ground(LAW, 10)]);
        await bot.onStart();
        await bot.loop();
        expect(Inventory.countById(LAW)).toBe(11);
        expect(state.taken).toEqual([LAW]);
        expect(Inventory.countById(RUBY)).toBe(26);
    });

    test('does not mistake an unnoted ore for an existing noted stack', async () => {
        const { bot, state } = fixture([item(KEY), item(441, 150), ...copies(RUBY, 26)], [ground(440)]);
        await bot.onStart();
        await bot.loop();
        expect(state.taken).toEqual([]);
        expect(state.bank.get(441)).toBe(150);
    });

    test('retries a failed pickup before opening another chest', async () => {
        const { bot, state } = fixture([item(KEY)], [ground(BAR)]);
        state.takeFailures = 1;
        await bot.onStart();
        await bot.loop();
        expect(bot.opened).toBe(0);
        await bot.loop();
        expect(Inventory.countById(BAR)).toBe(1);
        expect(bot.opened).toBe(0);
    });

    test('banks and returns for overflow after the last key before stopping', async () => {
        const { bot, state } = fixture([item(KEY), ...copies(RUBY, 26)]);
        state.rewards.push([item(STONE), item(BAR, 3)]);
        await bot.onStart();
        await bot.loop();
        expect(bot.opened).toBe(1);
        expect(state.floor.map(i => i.id)).toEqual([BAR, BAR]);
        await bot.loop();
        expect(state.bank.get(RUBY)).toBe(26);
        expect(state.bank.get(BAR)).toBe(1);
        expect(state.stopped).toBe(false);
        await bot.loop();
        expect(state.tile).toEqual(CHEST_STAND);
        await bot.loop();
        await bot.loop();
        expect(Inventory.countById(BAR)).toBe(2);
        await bot.loop();
        expect(state.bank.get(BAR)).toBe(3);
        expect(state.bank.get(STONE)).toBe(1);
        expect(state.stopped).toBe(true);
    });

    test('does not withdraw more keys on the bank trip to recover overflow', async () => {
        const { bot, state } = fixture([item(KEY), ...copies(RUBY, 27)], [ground(BAR)]);
        state.bank.set(KEY, 100);
        await bot.onStart();
        await bot.loop();
        expect(Inventory.countById(KEY)).toBe(1);
        expect(state.bank.get(KEY)).toBe(100);
        await bot.loop();
        await bot.loop();
        expect(Inventory.countById(BAR)).toBe(1);
        expect(bot.opened).toBe(0);
    });

    test('clears a missing recovery pile and stops instead of returning forever', async () => {
        const { bot, state } = fixture(copies(RUBY, 28), [ground(BAR)]);
        await bot.onStart();
        await bot.loop();
        state.floor = [];
        await bot.loop();
        await bot.loop();
        expect(state.stopped).toBe(true);
    });

    test('ignores unrelated items, nearby tiles and other floors', async () => {
        const { bot, state } = fixture([item(KEY)], [ground(946), ground(BAR, 1, new Tile(2915, 3451, 0)), ground(STONE, 1, new Tile(2914, 3451, 1))]);
        await bot.onStart();
        await bot.loop();
        expect(bot.opened).toBe(1);
        expect(state.taken).toEqual([]);
    });
});

describe('JiveChests banking', () => {
    test('preserves teleport runes while depositing rewards and restocks a missing rune', async () => {
        const { bot, state } = fixture([item(LAW, 10), item(AIR, 2), item(RUBY)], [], true);
        state.tile = BANK;
        state.bank = new Map([[KEY, 20], [AIR, 100], [WATER, 100]]);
        await bot.onStart();
        await bot.loop();
        expect(Inventory.countById(LAW)).toBe(10);
        expect(Inventory.countById(AIR)).toBe(3);
        expect(Inventory.countById(WATER)).toBe(1);
        expect(Inventory.countById(KEY)).toBe(7);
        expect(state.bank.get(RUBY)).toBe(1);
    });

    test('finishes banking after teleport consumption creates free slots', async () => {
        const { bot, state } = fixture([item(KEY), item(LAW), item(AIR, 3), item(WATER), ...copies(RUBY, 24)], [ground(BAR)], true);
        state.bank = new Map([[KEY, 10], [LAW, 10], [AIR, 30], [WATER, 10]]);
        await bot.onStart();
        await bot.loop();
        expect(state.tile).toEqual(new Tile(2965, 3378, 0));
        await bot.loop();
        expect(state.bank.get(RUBY)).toBe(24);
        expect(state.open).toBe(false);
        await bot.loop();
        await bot.loop();
        expect(Inventory.countById(BAR)).toBe(1);
    });

    test.each(['closeFailures', 'depositFailures', 'withdrawFailures'] as const)('retries %s before leaving the bank', async failure => {
        const { bot, state } = fixture([item(RUBY)]);
        state.tile = BANK;
        state.bank.set(KEY, 20);
        state[failure] = 1;
        await bot.onStart();
        await bot.loop();
        await bot.loop();
        expect(state.open).toBe(false);
        expect(state.tile).toEqual(BANK);
        expect(Inventory.countById(KEY)).toBe(7);
        expect(state.bank.get(RUBY)).toBe(1);
    });

    test('deposits runes when walking home is selected', async () => {
        const { bot, state } = fixture([item(LAW, 10), item(AIR, 30), item(WATER, 10)]);
        state.tile = BANK;
        state.bank.set(KEY, 20);
        await bot.onStart();
        await bot.loop();
        expect(state.pack.map(i => i.id)).toEqual(Array(7).fill(KEY));
        expect(state.bank.get(LAW)).toBe(10);
    });

    test('leaves for the chest when teleport runes are unavailable', async () => {
        const { bot, state } = fixture([], [], true);
        state.tile = BANK;
        state.bank.set(KEY, 20);
        await bot.onStart();
        await bot.loop();
        await bot.loop();
        expect(state.tile).toEqual(CHEST_STAND);
        expect(Inventory.countById(KEY)).toBe(7);
    });
});
