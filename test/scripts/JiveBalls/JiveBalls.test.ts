import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot, type NpcSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { GameMessages } from '#/bot/api/chatbox/gameMessages.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { Reachability } from '#/bot/event/webwalk/geometry/Reachability.js';
import Tile from '#/bot/geometry/Tile.js';
import { Input } from '#/bot/input/Input.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { ScriptRegistry } from '#/bot/runtime/ScriptRegistry.js';
import JiveBalls from '#/bot/scripts/JiveBalls/JiveBalls.js';
import { SHEEP_SITES, chooseSite } from '#/bot/scripts/JiveBalls/sites.js';
import '#/bot/scripts/index.js';

afterEach(() => { mock.restore(); GameMessages.reset(); });

const PEN = new Tile(3198, 3266, 0);
function item(id: number, slot = 0): InvItemSnapshot {
    return { id, count: 1, name: id === 1735 ? 'Shears' : id === 1737 ? 'Wool' : 'Other', slot, comId: 3214, ops: ['Drop'] };
}
function sheep(index: number, over: Partial<NpcSnapshot> = {}): NpcSnapshot {
    return {
        index, id: 43, name: 'Sheep', anim: -1, level: 0, size: 1, tile: PEN,
        distance: 1, ops: [], inCombat: false, health: 1, totalHealth: 1, faceEntity: -1, ...over
    };
}

async function fixture(pack = [item(1735)], location = 'lumbridge') {
    const state = {
        pack, tile: PEN, npcs: [sheep(1)], bank: new Map([[1735, 1]]),
        open: false, ready: true, sideReady: true, tick: 10, notes: true,
        sheared: [] as number[], stops: [] as string[], escapes: false
    };
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockImplementation(() => state.tile);
    spyOn(Game, 'tick').mockImplementation(() => state.tick);
    spyOn(reader, 'bankComId').mockImplementation(() => state.open ? 5382 : -1);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'bankSideItems').mockImplementation(() => state.sideReady ? state.pack : []);
    spyOn(reader, 'npcs').mockImplementation(() => state.npcs);
    spyOn(reader, 'selfSlot').mockReturnValue(5);
    spyOn(reader, 'groundItems').mockReturnValue([]);
    spyOn(reader, 'toLocal').mockImplementation((lx, lz) => ({ lx, lz }));
    spyOn(Banking, 'open').mockImplementation(async () => { state.open = true; return true; });
    spyOn(Bank, 'waitReady').mockImplementation(async () => state.ready);
    spyOn(Bank, 'backpackReady').mockImplementation(async () => state.sideReady);
    spyOn(Bank, 'countById').mockImplementation(id => state.bank.get(id) ?? 0);
    spyOn(Bank, 'depositAllMatching').mockImplementation(async match => {
        state.pack = state.pack.filter(i => {
            if (!match(i.name!, i.id)) return true;
            state.bank.set(i.id, (state.bank.get(i.id) ?? 0) + i.count);
            return false;
        });
    });
    spyOn(Bank, 'deposit').mockImplementation(name => {
        const target = state.pack.find(i => i.name === name);
        if (!target) return false;
        state.pack = state.pack.filter(i => i !== target);
        state.bank.set(target.id, (state.bank.get(target.id) ?? 0) + 1);
        return true;
    });
    spyOn(Bank, 'setNoteMode').mockImplementation(async value => { state.notes = value; });
    spyOn(Bank, 'withdrawXById').mockImplementation(async (id, count) => {
        expect(id).toBe(1735);
        expect(count).toBe(1);
        expect(state.notes).toBe(false);
        if (!state.bank.get(id)) return false;
        state.bank.set(id, state.bank.get(id)! - 1);
        state.pack.push(item(id));
        return true;
    });
    spyOn(Bank, 'close').mockImplementation(async () => { state.open = false; return true; });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(Execution, 'delayTicks').mockImplementation(async ticks => { state.tick += ticks; });
    spyOn(Execution, 'noteProgress').mockImplementation(() => {});
    spyOn(Reachability, 'canReach').mockReturnValue(true);
    spyOn(Traversal, 'walkResilient').mockImplementation(async dest => { state.tile = Tile.from(dest); return true; });
    spyOn(Input, 'useItemOnNpc').mockImplementation((id, _slot, _com, index) => {
        expect(id).toBe(1735);
        expect(state.open).toBe(false);
        state.sheared.push(index);
        if (state.escapes) GameMessages.record('The sheep manages to get away from you!');
        else state.pack.push(item(1737, state.pack.length));
        return true;
    });
    spyOn(ChatDialog, 'canContinue').mockReturnValue(true);
    spyOn(ChatDialog, 'continue').mockResolvedValue(true);
    const bot = new JiveBalls();
    bot.settings = new SettingsBag({ location });
    bot.bindLog(() => {});
    bot.bindFinish(reason => state.stops.push(reason));
    await bot.onStart();
    return { bot, state };
}

test('registers a selectable wool gathering script', () => {
    const meta = ScriptRegistry.get('JiveBalls');
    expect(meta?.create()).toBeInstanceOf(JiveBalls);
    expect(meta?.settingsSchema?.location.default).toBe('random');
    expect(meta?.settingsSchema?.location.options).toContain('ardougne');
});

test('random selection covers each flock in proportion to shearable sheep', () => {
    const chosen = Array.from({ length: 37 }, (_, i) => chooseSite('random', () => (i + 0.5) / 37)?.id);
    expect(Object.fromEntries(SHEEP_SITES.map(s => [s.id, chosen.filter(id => id === s.id).length])))
        .toEqual({ lumbridge: 16, varrock: 5, falador: 3, monastery: 3, ardougne: 10 });
    expect(chooseSite('missing')).toBeNull();
});

test('uses shears on an unsheared sheep and leaves automatic dialogue closure to the client', async () => {
    const { bot, state } = await fixture();
    await bot.loop();
    expect(state.sheared).toEqual([1]);
    expect(Inventory.countById(1737)).toBe(1);
    expect(ChatDialog.continue).not.toHaveBeenCalled();
    expect(Execution.noteProgress).toHaveBeenCalled();
});

test('ignores shorn, diseased, unreachable, out-of-area and other-player sheep', async () => {
    const { bot, state } = await fixture();
    state.npcs = [
        sheep(1, { id: 42 }), sheep(2, { id: 1763, name: 'Diseased sheep 1' }),
        sheep(3, { tile: new Tile(3300, 3266, 0) }), sheep(4, { tile: new Tile(3198, 3266, 1) }),
        sheep(5, { faceEntity: 32774 }), sheep(6, { tile: new Tile(3199, 3266, 0) }), sheep(7)
    ];
    spyOn(Reachability, 'canReach').mockImplementation(tile => tile.x !== 3199);
    await bot.loop();
    expect(state.sheared).toEqual([7]);
});

test('fills twenty-seven slots, banks wool, keeps shears and resumes at the same flock', async () => {
    const { bot, state } = await fixture();
    for (let i = 0; i < 27; i++) await bot.loop();
    expect(Inventory.used()).toBe(28);
    await bot.loop();
    expect(state.bank.get(1737)).toBe(27);
    expect(state.pack.map(i => i.id)).toEqual([1735]);
    expect(state.open).toBe(false);
    expect(Banking.open).toHaveBeenCalledWith(expect.objectContaining({ stand: new Tile(3093, 3243, 0) }));
    await bot.loop();
    expect(Inventory.countById(1737)).toBe(1);
    expect(bot.recoveryAnchor()).toEqual(PEN);
});

test('withdraws missing shears as an item after clearing unrelated starting items', async () => {
    const { bot, state } = await fixture([item(995)]);
    await bot.loop();
    expect(state.bank.get(995)).toBe(1);
    expect(state.pack.map(i => i.id)).toEqual([1735]);
    expect(state.open).toBe(false);
});

test('banks spare shears so even a pack full of tools leaves twenty-seven wool slots', async () => {
    const { bot, state } = await fixture(Array.from({ length: 28 }, (_, slot) => item(1735, slot)));
    await bot.loop();
    expect(state.pack.map(i => i.id)).toEqual([1735]);
    expect(state.bank.get(1735)).toBe(28);
    for (let i = 0; i < 27; i++) await bot.loop();
    expect(Inventory.countById(1737)).toBe(27);
});

test.each(['ready', 'sideReady'] as const)('does not bank or source missing shears before %s', async flag => {
    const { bot, state } = await fixture([item(995)]);
    state[flag] = false;
    await bot.loop();
    expect(Bank.depositAllMatching).not.toHaveBeenCalled();
    expect(Traversal.walkResilient).not.toHaveBeenCalled();
    expect(state.stops).toEqual([]);
});

test('retries a failed wool deposit without leaving the bank or shearing', async () => {
    const { bot, state } = await fixture([item(1735), ...Array.from({ length: 27 }, (_, i) => item(1737, i + 1))]);
    spyOn(Bank, 'depositAllMatching').mockResolvedValueOnce(undefined);
    await bot.loop();
    expect(Inventory.used()).toBe(28);
    expect(state.open).toBe(true);
    await bot.loop();
    expect(state.bank.get(1737)).toBe(27);
    expect(state.open).toBe(false);
    expect(state.sheared).toEqual([]);
});

test('retries a failed shears withdrawal before shearing or fetching a ground spawn', async () => {
    const { bot, state } = await fixture([]);
    spyOn(Bank, 'withdrawXById').mockResolvedValueOnce(false);
    await bot.loop();
    expect(state.pack).toEqual([]);
    await bot.loop();
    expect(state.pack.map(i => i.id)).toEqual([1735]);
    expect(Traversal.walkResilient).not.toHaveBeenCalled();
});

test('retries closing the bank before attempting to shear', async () => {
    const { bot, state } = await fixture([]);
    spyOn(Bank, 'close').mockResolvedValueOnce(false);
    await bot.loop();
    expect(state.open).toBe(true);
    await bot.loop();
    expect(state.open).toBe(false);
    expect(state.sheared).toEqual([]);
    await bot.loop();
    expect(state.sheared).toEqual([1]);
});

test('fetches free shears when none are banked, then returns to the selected flock', async () => {
    const { bot, state } = await fixture([]);
    state.bank.clear();
    await bot.loop();
    state.tile = new Tile(3152, 3306, 0);
    spyOn(reader, 'groundItems').mockReturnValue([{ id: 1735, name: 'Shears', count: 1, tile: state.tile, distance: 0, ops: ['Take'] }]);
    spyOn(Input, 'takeObj').mockImplementation((_x, _z, id) => { state.pack.push(item(id)); return true; });
    await bot.loop();
    expect(Inventory.countById(1735)).toBe(1);
    await bot.loop();
    expect(state.tile).toEqual(PEN);
    expect(state.stops).toEqual([]);
});

test('waits for wool to regrow instead of banking an empty pack or changing sites', async () => {
    const { bot, state } = await fixture();
    state.npcs = [sheep(1, { id: 42 })];
    await bot.loop();
    expect(state.sheared).toEqual([]);
    expect(Banking.open).not.toHaveBeenCalled();
    expect(Traversal.walkResilient).not.toHaveBeenCalled();
    expect(Execution.delayTicks).toHaveBeenCalled();
    state.npcs = [sheep(1)];
    await bot.loop();
    expect(Inventory.countById(1737)).toBe(1);
});

test('an escaped sheep does not count as wool and another sheep is tried next', async () => {
    const { bot, state } = await fixture();
    state.escapes = true;
    await bot.loop();
    expect(Inventory.countById(1737)).toBe(0);
    state.escapes = false;
    state.npcs.push(sheep(2));
    await bot.loop();
    expect(state.sheared).toEqual([1, 2]);
    expect(Inventory.countById(1737)).toBe(1);
});

test('walks into the flock rather than attempting to shear through a fence', async () => {
    const { bot, state } = await fixture();
    state.tile = new Tile(3188, 3266, 0);
    spyOn(Reachability, 'canReach').mockReturnValue(false);
    await bot.loop();
    expect(state.sheared).toEqual([]);
    expect(state.tile).toEqual(PEN);
});

test('random location is selected once and a selected location never rerolls', async () => {
    spyOn(Math, 'random').mockReturnValue(0.99);
    const { bot, state } = await fixture([item(1735)], 'random');
    expect(bot.recoveryAnchor()).toEqual(new Tile(2654, 3367, 0));
    spyOn(Math, 'random').mockReturnValue(0);
    await bot.loop();
    expect(state.tile).toEqual(new Tile(2654, 3367, 0));
    expect(bot.recoveryAnchor()).toEqual(new Tile(2654, 3367, 0));
});

test('invalid saved location stops with a useful reason', async () => {
    const { bot, state } = await fixture([item(1735)], 'missing');
    await bot.loop();
    expect(state.stops).toHaveLength(1);
    expect(state.stops[0]).toContain('location');
    expect(state.sheared).toEqual([]);
});
