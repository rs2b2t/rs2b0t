import { afterEach, beforeEach, expect, test } from 'bun:test';
import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Navigator } from '#/bot/event/webwalk/Navigator.js';
import { BankTeleport } from '#/bot/api/bank/BankTeleport.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Quests } from '#/bot/api/ui/questlog/Quests.js';
import { Traversal } from '#/bot/api/walking/Traversal.js';
import { stubProps } from '../../lib/stubSingletons.js';

let restores: (() => void)[];
let tile: { x: number; z: number; level: number };
let held: Record<string, number>;
let banked: Record<string, number>;
let casts: string[];
let magic: number;
let plague: boolean;
let lands: boolean;

beforeEach(() => {
    tile = { x: 2897, z: 9765, level: 0 }; magic = 70; plague = true; lands = true; casts = [];
    held = { 'Law rune': 1, 'Air rune': 3, 'Water rune': 1 }; banked = {};
    restores = [
        stubProps(Game, { tile: () => tile, teleport: async name => { casts.push(name); if (lands) tile = { x: 2965, z: 3378, level: 0 }; return true; } }),
        stubProps(reader, { worldTile: () => tile }),
        stubProps(Skills, { effective: () => magic }),
        stubProps(Quests, { status: () => plague ? 'complete' : 'notStarted' }),
        stubProps(Inventory, { count: name => held[name] ?? 0, free: () => 10 }),
        stubProps(Bank, { count: name => banked[name] ?? 0, withdrawX: async (name, count) => { held[name] = (held[name] ?? 0) + count; return true; } }),
        stubProps(Execution, { delayUntil: async check => check(), delayTicks: async () => {} })
    ];
});
afterEach(() => { for (const restore of restores.reverse()) restore(); });

test('casts the funded escape and verifies arrival outside the dungeon', async () => {
    expect(await BankTeleport.cast('Falador', () => {})).toBe(true);
    expect(casts).toEqual(['Falador']);
    expect(await BankTeleport.cast('Falador', () => {})).toBe(false);
    expect(casts).toHaveLength(1);
});

test('missing runes, low magic, quest locks and deep Wilderness fall back without casting', async () => {
    held['Law rune'] = 0;
    expect(await BankTeleport.cast('Falador', () => {})).toBe(false);
    held['Law rune'] = 2; held['Water rune'] = 2; magic = 36;
    expect(await BankTeleport.cast('Falador', () => {})).toBe(false);
    magic = 70; plague = false;
    expect(await BankTeleport.cast('Ardougne', () => {})).toBe(false);
    tile = { x: 3096, z: 3814, level: 0 };
    expect(await BankTeleport.cast('Falador', () => {})).toBe(false);
    expect(casts).toEqual([]);
});

test('a cast click without arrival reports failure so the caller can walk', async () => {
    lands = false;
    expect(await BankTeleport.cast('Falador', () => {})).toBe(false);
    expect(casts).toEqual(['Falador']);
});

test('green dragon returns reach level 20 Wilderness before attempting the spell', async () => {
    tile = { x: 3096, z: 3814, level: 0 };
    const walked: number[] = [];
    restores.push(stubProps(Traversal, { walkResilient: async destination => { walked.push(destination.z); tile = destination; return true; } }));
    expect(await BankTeleport.cast('Falador', () => {}, true)).toBe(true);
    expect(walked).toEqual([3660]);
    expect(casts).toEqual(['Falador']);
});

test('restocks a whole escape cast and leaves existing surplus alone', async () => {
    held = { 'Air rune': 10 }; banked = { 'Law rune': 2, 'Water rune': 2 };
    await BankTeleport.stock('Falador');
    expect(held).toEqual({ 'Air rune': 10, 'Law rune': 1, 'Water rune': 1 });
    held = {}; banked = { 'Law rune': 1 };
    await BankTeleport.stock('Falador');
    expect(held).toEqual({});
});

test('outbound navigation spends an extra cast from the bank and keeps activity runes packed', async () => {
    held = { 'Law rune': 3, 'Air rune': 9, 'Water rune': 3 };
    banked = { 'Law rune': 1, 'Air rune': 3, 'Water rune': 1 };
    const start = { ...held };
    let queries = 0;
    restores.push(stubProps(Bank, { close: async () => true }));
    restores.push(stubProps(Navigator, { findPath: async (_from, _to, opts) => {
        queries++;
        expect(opts?.policy?.allowTeleportIds).toContain('falador');
        return { ok: true, cost: 10, expanded: 1, hops: [], waypoints: [{ ...tile,
            transport: { kind: 'teleport', teleportId: 'falador', locName: '', locX: 0, locZ: 0, action: 'Cast', toTile: { x: 2965, z: 3378 }, toLevel: 0 } }] };
    } }));
    const goal = { x: 2946, z: 3369, level: 0 };
    const keep = Object.entries(start).map(([item, count]) => ({ item, count }));
    expect(await BankTeleport.depart(goal, [...keep, { item: 'Law rune', count: 4 }], [], () => {})).toBe(true);
    expect(queries).toBe(0);
    expect(casts).toEqual([]);
    expect(await BankTeleport.depart(goal, keep, [], () => {})).toBe(true);
    expect(queries).toBe(1);
    expect(casts).toEqual(['Falador']);
    expect(held['Law rune']).toBe(4);
});

test('when the router chooses walking, travel leaves the bank without taking a cast', async () => {
    banked = { 'Law rune': 10, 'Air rune': 10, 'Water rune': 10 };
    const start = { ...held };
    restores.push(stubProps(Bank, { close: async () => true }));
    restores.push(stubProps(Navigator, { findPath: async () => ({ ok: true, expanded: 1, cost: 10, hops: [], waypoints: [] }) }));
    expect(await BankTeleport.depart({ x: 2946, z: 3369, level: 0 }, [], [], () => {})).toBe(true);
    expect(held).toEqual(start);
    expect(casts).toEqual([]);
});

test('a partial outbound withdrawal restores the original activity pack before walking', async () => {
    banked = { 'Law rune': 1, 'Water rune': 1, 'Air rune': 3 };
    const start = { ...held };
    restores.push(stubProps(Navigator, { findPath: async () => ({ ok: true, expanded: 1, cost: 10, hops: [],
        waypoints: [{ ...tile, transport: { teleportId: 'falador', locName: '', locX: 0, locZ: 0, action: 'Cast' } }] }) }));
    restores.push(stubProps(Inventory, { first: name => new InvItem({ id: 555, name, count: held[name], comId: 0, slot: 0, ops: [] }) }));
    restores.push(stubProps(Bank, { close: async () => true, withdrawX: async (name, amount) => {
        if (name !== 'Water rune') return false;
        held[name] += amount;
        return true;
    }, depositXById: async (id, amount) => { expect(id).toBe(555); held['Water rune'] -= amount; return true; } }));
    expect(await BankTeleport.depart({ x: 2946, z: 3369, level: 0 }, [], [], () => {})).toBe(true);
    expect(casts).toEqual([]);
    expect(held).toEqual(start);
});
