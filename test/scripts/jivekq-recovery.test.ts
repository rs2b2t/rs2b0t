import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader } from '../../src/bot/adapter/ClientAdapter.js';
import { Equipment } from '../../src/bot/api/equipment/Equipment.js';
import { Bank } from '../../src/bot/api/bank/Bank.js';
import { Banking } from '../../src/bot/api/bank/Banking.js';
import { Execution } from '../../src/bot/api/execution/Execution.js';
import { Game } from '../../src/bot/api/game/Game.js';
import { Inventory, InvItem } from '../../src/bot/api/inventory/Inventory.js';
import { Prayer, PROTECT_FROM_MAGIC } from '../../src/bot/api/prayer/Prayer.js';
import { Skills } from '../../src/bot/api/skills/Skills.js';
import { Input } from '../../src/bot/input/Input.js';
import JiveKQ from '../../src/bot/scripts/JiveKQ/JiveKQ.js';
import { Party } from '../../src/bot/scripts/JiveKQ/party.js';
import { deathReport, recoveryDrops } from '../../src/bot/scripts/JiveKQ/recovery.js';
import { provision } from '../../src/bot/scripts/JiveKQ/supply.js';
import { BANK } from '../../src/bot/scripts/JiveKQ/policy.js';
import { GEAR } from '../../src/bot/scripts/JiveKQ/loadout.js';

const tile = { x: 3473, z: 9498, level: 0 };
const death = { at: 1000, tile, items: [{ id: 861, count: 1 }, { id: 892, count: 250 }], ground: [{ id: 892, count: 30 }] };
afterEach(() => mock.restore());

test('death reports validate tile, time and bounded item counts', () => {
    expect(deathReport(death, 1000)).toEqual(death);
    for (const change of [{ at: 3000 }, { at: -200_000 }, { tile: { ...tile, level: 9 } }, { items: [{ id: 861, count: -1 }] }, { items: Array(60).fill({ id: 861, count: 1 }) }]) {
        expect(deathReport({ ...death, ...change }, 1000)).toBeNull();
    }
});

test('recovery matches the exact death tile and excludes pre-existing stacks and unrelated loot', () => {
    const bow = { id: 861, count: 1, tile };
    const drops = [bow, { id: 892, count: 30, tile }, { id: 995, count: 5000, tile }, { ...bow, tile: { ...tile, x: tile.x + 1 } }];
    expect(recoveryDrops(death, drops)).toEqual([bow]);
    drops[1].count = 280;
    expect(recoveryDrops(death, drops)).toEqual([bow, drops[1]]);
});

test('recovery sees separate unstackable drops above the pre-death ground count', () => {
    const bow = { id: 861, count: 1, tile };
    const report = { ...death, ground: [{ id: 861, count: 1 }] };
    expect(recoveryDrops(report, [bow])).toEqual([]);
    expect(recoveryDrops(report, [bow, bow])).toEqual([bow, bow]);
});

test('a confirmed teammate death permits recovery without latching a group abort', () => {
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, stage: 'fight', ready: true, tile }, 1000);
    party.receive({ name: 'two', session: 'two', trip: 1, stage: 'retreat', ready: false, restocking: true, tile, death }, 1000);
    expect(party.unsafe(1, 1000)).toBe(false);
    expect(party.deaths(1)).toEqual([{ name: 'two', session: 'two', trip: 1, death }]);
    for (const name of ['one', 'three', 'four']) party.receive({ name, session: name, trip: 1, stage: 'fight', ready: true, tile }, 8000);
    expect(party.unsafe(1, 8000)).toBe(false);
});

test('foreign, invalid and previous-trip deaths cannot excuse a missing fighter', () => {
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    for (const name of ['one', 'three', 'four']) party.receive({ name, session: name, trip: 2, stage: 'fight', ready: true, tile }, 8000);
    party.receive({ name: 'visitor', session: 'visitor', trip: 2, stage: 'retreat', ready: false, restocking: true, tile, death }, 8000);
    party.receive({ name: 'two', session: 'two', trip: 1, stage: 'retreat', ready: false, restocking: true, tile, death }, 1000);
    expect(party.unsafe(2, 8000)).toBe(true);
    expect(party.deaths(2)).toEqual([]);
});

test('a pause remains a group abort even when its heartbeat carries a death report', () => {
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, stage: 'fight', ready: true, tile }, 1000);
    party.receive({ name: 'two', session: 'two', trip: 1, stage: 'retreat', ready: false, restocking: true, reason: 'paused', tile, death }, 1000);
    expect(party.unsafe(1, 1000)).toBe(true);
});

function recoveryBot() {
    const bot = new JiveKQ();
    bot.bindLog(() => {}); bot.stage = 'fight'; bot.trip = 1;
    bot['prepared'] = true;
    bot['checkSafety'] = () => false;
    const state = { hp: 70, tick: 100, bows: 0 };
    spyOn(Date, 'now').mockReturnValue(1000);
    spyOn(Game, 'ingame').mockReturnValue(true);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Game, 'tile').mockReturnValue(tile);
    spyOn(Game, 'tick').mockImplementation(() => state.tick);
    spyOn(reader, 'serverTile').mockReturnValue(tile);
    spyOn(reader, 'toLocal').mockReturnValue({ lx: 30, lz: 30 });
    spyOn(Skills, 'effective').mockImplementation(() => state.hp);
    spyOn(Inventory, 'items').mockReturnValue([]);
    spyOn(Inventory, 'countById').mockImplementation(id => id === 861 ? state.bows : 8);
    spyOn(Inventory, 'isFull').mockReturnValue(false);
    spyOn(Inventory, 'free').mockReturnValue(4);
    spyOn(Equipment, 'items').mockReturnValue([]);
    spyOn(Prayer, 'points').mockReturnValue(70);
    spyOn(Prayer, 'active').mockImplementation(name => name === PROTECT_FROM_MAGIC);
    spyOn(Prayer, 'set').mockResolvedValue(true);
    spyOn(reader, 'groundItems').mockReturnValue([]);
    const party = new Party(['one', 'two', 'three', 'four'], 'one', 'one');
    bot['party'] = party;
    for (const name of party.roster) party.receive({ name, session: name, trip: 1, stage: 'fight', ready: true, tile, recoverySpace: 4 }, 1000);
    return { bot, state, party };
}

test('death captures the server tile before respawn and keeps broadcasting while stopped', () => {
    const { bot, state, party } = recoveryBot();
    const server = { ...tile, x: tile.x + 1 };
    spyOn(reader, 'serverTile').mockReturnValue(server);
    bot['observeDeath']();
    state.hp = 0; bot['observeDeath'](); bot['heartbeat']();
    expect(bot['death']?.tile).toEqual(server);
    expect(bot.restocking).toBe(true);
    expect(party.unsafe(1, 1000)).toBe(false);
    bot.onStop();
    expect(party.deaths(1)[0].death.tile).toEqual(server);
    expect(party.unsafe(1, 1000)).toBe(false);
});

test('only the first survivor with recovery space leaves the cross to collect gear', async () => {
    const { bot, party } = recoveryBot();
    bot['party'] = new Party(party.roster, 'three', 'three');
    for (const name of party.roster) bot['party'].receive({ name, session: name, trip: 1, stage: 'fight', ready: true, tile, recoverySpace: 4 }, 1000);
    bot['party'].receive({ name: 'two', session: 'two', trip: 1, stage: 'retreat', ready: false, restocking: true, tile, death }, 1000);
    const take = spyOn(Input, 'takeObj').mockReturnValue(true);
    expect(await bot['recoverLoot']()).toBe(false);
    expect(take).not.toHaveBeenCalled();
    bot['party'].receive({ name: 'one', session: 'one', trip: 1, stage: 'retreat', ready: false, restocking: true, tile, recoverySpace: 0 }, 1000);
    expect(await bot['recoverLoot']()).toBe(true);
    expect(bot.status).toContain('recovering two');
});

test('a queued hit after teleport records the Camelot pile instead of the old chamber tile', () => {
    const { bot, state } = recoveryBot();
    bot['observeDeath']();
    const camelot = { x: 2757, z: 3478, level: 0 };
    spyOn(reader, 'serverTile').mockReturnValue(camelot);
    state.hp = 0; bot['observeDeath']();
    expect(bot['death']?.tile).toEqual(camelot);
});

test('survivors protect and confirm a teammate gear pickup before banking it', async () => {
    const { bot, state, party } = recoveryBot();
    let protectedFromMagic = false;
    spyOn(Prayer, 'active').mockImplementation(() => protectedFromMagic);
    spyOn(Prayer, 'set').mockImplementation(async () => { protectedFromMagic = true; return true; });
    party.receive({ name: 'two', session: 'two', trip: 1, stage: 'retreat', ready: false, restocking: true, tile, death }, 1000);
    spyOn(reader, 'groundItems').mockReturnValue([{ id: 861, count: 1, tile, name: 'Magic shortbow', distance: 0, ops: ['Take'] }]);
    const take = spyOn(Input, 'takeObj').mockImplementation(() => { state.bows++; return true; });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => condition());
    expect(await bot['recoverLoot']()).toBe(true);
    expect(Prayer.set).toHaveBeenCalledWith(PROTECT_FROM_MAGIC, true);
    expect(take).not.toHaveBeenCalled();
    expect(await bot['recoverLoot']()).toBe(true);
    expect(take).toHaveBeenCalledTimes(1);
    expect(bot['lootCounts'].get('Recovered for two: Magic shortbow')).toBe(1);
    spyOn(reader, 'groundItems').mockReturnValue([]);
    state.tick += 13; await bot['recoverLoot'](); await bot['recoverLoot']();
    expect(bot.stage).toBe('retreat');
    expect(bot.restocking).toBe(true);
});

test('full inventories preserve food and escape supplies rather than discard them for recovery', async () => {
    const { bot, party } = recoveryBot();
    party.receive({ name: 'two', session: 'two', trip: 1, stage: 'retreat', ready: false, restocking: true, tile, death }, 1000);
    spyOn(reader, 'groundItems').mockReturnValue([{ id: 861, count: 1, tile, name: 'Magic shortbow', distance: 0, ops: ['Take'] }]);
    spyOn(Inventory, 'isFull').mockReturnValue(true);
    const take = spyOn(Input, 'takeObj').mockReturnValue(true);
    const held = spyOn(Input, 'heldOp').mockReturnValue(true);
    await bot['recoverLoot'](); await bot['recoverLoot']();
    expect(take).not.toHaveBeenCalled();
    expect(held).not.toHaveBeenCalled();
    expect(bot.stage).toBe('retreat');
});

test('a respawned character returns to banking without requiring its lost teleport supplies', async () => {
    const { bot } = recoveryBot();
    bot['death'] = death;
    bot.stage = 'retreat';
    spyOn(Game, 'tile').mockReturnValue({ x: 3221, z: 3218, level: 0 });
    spyOn(Prayer, 'clear').mockResolvedValue();
    await bot['escape']();
    expect(String(bot.stage)).toBe('bank');
    expect(bot['prepared']).toBe(false);
});

test('death restocking opens Shantay bank and deposits retained items before waiting for missing gear', async () => {
    recoveryBot();
    spyOn(Prayer, 'clear').mockResolvedValue();
    const open = spyOn(Banking, 'open').mockResolvedValue(true);
    spyOn(Bank, 'waitReady').mockResolvedValue(true);
    const deposit = spyOn(Bank, 'depositAllMatching').mockResolvedValue();
    spyOn(Bank, 'countById').mockReturnValue(0);
    const withdraw = spyOn(Bank, 'withdrawXById').mockResolvedValue(true);
    const log = () => {};
    expect(await provision(3, log, true)).toBe(false);
    expect(open).toHaveBeenCalledWith({ stand: BANK, preferNearby: false, log });
    expect(deposit).toHaveBeenCalledTimes(1);
    expect(withdraw).not.toHaveBeenCalled();
});

test('death restocking also waits for an insufficient arrow supply instead of stopping', async () => {
    recoveryBot();
    spyOn(Prayer, 'clear').mockResolvedValue();
    spyOn(Prayer, 'max').mockReturnValue(70);
    spyOn(Skills, 'level').mockReturnValue(70);
    spyOn(Banking, 'open').mockResolvedValue(true);
    spyOn(Bank, 'waitReady').mockResolvedValue(true);
    spyOn(Bank, 'depositAllMatching').mockResolvedValue();
    spyOn(Bank, 'close').mockResolvedValue(true);
    spyOn(Bank, 'setNoteMode').mockResolvedValue();
    spyOn(Equipment, 'items').mockReturnValue(GEAR.map((id, slot) => new InvItem({ id, slot, count: 1, name: '', ops: [], comId: 1688 })));
    spyOn(Bank, 'countById').mockReturnValue(1);
    expect(await provision(3, () => {}, true)).toBe(false);
    await expect(provision(3, () => {})).rejects.toThrow('KQ bank needs');
});
