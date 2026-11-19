import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { SM_NPC, SM_TILE } from '#/bot/api/ai/quests/defs/mortton/areas.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Shop } from '#/bot/api/shop/Shop.js';
import { ITEM_DB } from '#/bot/data/itemdb.js';
import { Input } from '#/bot/input/Input.js';
import { LootProcessor } from '#/bot/scripts/ShadesOfMortton/loot.js';
import type { Stock } from '#/bot/scripts/ShadesOfMortton/policy.js';
import { Supplies } from '#/bot/scripts/ShadesOfMortton/supply.js';

afterEach(() => mock.restore());
const names = new Map([[2355, 'Silver bar'], [2357, 'Gold bar'], [2359, 'Mithril bar'], [2361, 'Adamantite bar'], [3678, 'Flamtaer hammer']]);
const item = (id: number, count = 1): InvItemSnapshot => ({ id, count, slot: id, comId: 3214, name: ITEM_DB.find(item => item.id === id)?.name ?? names.get(id) ?? '', ops: [] });
function fixture() {
    const state = { pack: [item(995, 100), item(561, 5), item(554, 25)], level: 55, event: false, casts: [] as number[], sold: [] as number[], ticks: 0 };
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(Equipment, 'items').mockReturnValue([]);
    spyOn(Skills, 'effective').mockImplementation(() => state.level);
    spyOn(Skills, 'level').mockImplementation(() => state.level);
    spyOn(EventSignal, 'pending').mockImplementation(() => state.event);
    spyOn(Game, 'openSideTab').mockResolvedValue(true);
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => condition());
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { state.ticks += n; });
    spyOn(Game, 'castOnItem').mockImplementation(async (_spell, target) => {
        state.casts.push(target.id);
        const held = state.pack.find(item => item.id === target.id)!;
        held.count--;
        state.pack.find(item => item.id === 561)!.count--;
        state.pack.find(item => item.id === 554)!.count -= 5;
        state.pack.find(item => item.id === 995)!.count += target.id === 3678 ? 6000 : Math.floor(ITEM_DB.find(item => item.id === target.id)!.cost * 0.6);
        return true;
    });
    const supply = new Supplies(() => {});
    spyOn(supply, 'walk').mockResolvedValue(true);
    spyOn(reader, 'npcs').mockReturnValue([{
        id: 1259, index: 7, anim: -1, tile: SM_TILE.RAZMIRE, name: SM_NPC.RAZMIRE, ops: ['Trade-General-Store'],
        distance: 1, level: 0, size: 1, inCombat: false, health: 0, totalHealth: 0, faceEntity: -1
    }]);
    spyOn(Input, 'interactNpc').mockReturnValue(true);
    spyOn(Shop, 'isOpen').mockReturnValue(true);
    spyOn(Shop, 'close').mockResolvedValue(undefined);
    const sell = spyOn(Shop, 'sell').mockImplementation(async (name, qty, pick) => {
        const entry = state.pack.find(entry => entry.name === name && entry.count >= qty && (!pick || pick(entry)));
        if (!entry || qty <= 0) return 0;
        state.sold.push(entry.id);
        entry.count -= qty;
        return qty;
    });
    return { state, supply, processor: new LootProcessor(supply), sell };
}

test('alchs only newly acquired allowlisted equipment and keeps the chest baseline', async () => {
    const { state, processor } = fixture();
    state.pack.push(item(1113, 3), item(3469), item(3470), item(379, 2), item(3448), item(2434), item(590));
    const before: Stock = new Map([[1113, 2], [379, 2], [3448, 1], [2434, 1], [590, 1]]);
    expect(await processor.process(before, true)).toBe(true);
    expect(state.casts).toEqual([1113]);
    expect(Inventory.countById(1113)).toBe(2);
    for (const id of [3469, 3470, 379, 3448, 2434, 590]) expect(Inventory.countById(id)).toBe(before.get(id) ?? 1);
    expect(Inventory.countById(561)).toBe(4);
    expect(Inventory.countById(554)).toBe(20);
    expect(Inventory.countById(995)).toBe(30100);
});

test('sells cheap gear without spending runes and sells all eligible loot when alchemy is off', async () => {
    const { state, processor } = fixture();
    state.pack.push(item(1217), item(1113));
    expect(await processor.process(new Map(), false)).toBe(true);
    expect(state.casts).toEqual([]);
    expect(state.sold).toEqual([1217, 1113]);
    state.sold = [];
    state.pack.push(item(1217));
    expect(await processor.process(new Map(), true)).toBe(true);
    expect(state.casts).toEqual([]);
    expect(state.sold).toEqual([1217]);
});

test('missing level or either rune falls back to selling', async () => {
    for (const missing of ['level', 'nature', 'fire'] as const) {
        const { state, processor } = fixture();
        state.pack.push(item(1113));
        if (missing === 'level') state.level = 54;
        if (missing === 'nature') state.pack = state.pack.filter(item => item.id !== 561);
        if (missing === 'fire') state.pack.find(item => item.id === 554)!.count = 4;
        expect(await processor.process(new Map(), true)).toBe(true);
        expect(state.casts).toEqual([]);
        expect(state.sold).toEqual([1113]);
        mock.restore();
    }
});

test('failed cast and accepted cast with no inventory transition fall back to selling', async () => {
    for (const accepted of [false, true]) {
        const { state, processor } = fixture();
        state.pack.push(item(1113));
        spyOn(Game, 'castOnItem').mockImplementation(async (_spell, target) => { state.casts.push(target.id); return accepted; });
        expect(await processor.process(new Map(), true)).toBe(true);
        expect(state.casts).toEqual([1113]);
        expect(state.sold).toEqual([1113]);
        expect(Inventory.countById(1113)).toBe(0);
        mock.restore();
    }
});

test('partial transition does not issue another alch and leaves remaining new equipment for selling', async () => {
    const { state, processor } = fixture();
    state.pack.push(item(1113, 2));
    spyOn(Game, 'castOnItem').mockImplementation(async (_spell, target) => {
        state.casts.push(target.id);
        state.pack.find(item => item.id === target.id)!.count--;
        return true;
    });
    expect(await processor.process(new Map(), true)).toBe(true);
    expect(state.casts).toEqual([1113]);
    expect(state.sold).toEqual([1113]);
});

test('alchs each new item separately and waits out ordinary spell recovery', async () => {
    const { state, processor } = fixture();
    state.pack.push(item(1113, 2));
    expect(await processor.process(new Map(), true)).toBe(true);
    expect(state.casts).toEqual([1113, 1113]);
    expect(state.ticks).toBeGreaterThanOrEqual(10);
    expect(state.sold).toEqual([]);
});

test('events prevent disposal and interrupted casts reconcile before another cast', async () => {
    const { state, processor, sell } = fixture();
    state.pack.push(item(1113, 2));
    state.event = true;
    expect(await processor.process(new Map(), true)).toBe(false);
    expect(state.casts).toEqual([]);
    expect(sell).not.toHaveBeenCalled();
    state.event = false;
    spyOn(Game, 'castOnItem').mockImplementation(async (_spell, target) => { state.casts.push(target.id); state.event = true; return true; });
    expect(await processor.process(new Map(), true)).toBe(false);
    state.event = false;
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => {
        state.pack.find(item => item.id === 1113)!.count = 1;
        state.pack.find(item => item.id === 995)!.count = 30100;
        state.pack.find(item => item.id === 561)!.count = 4;
        state.pack.find(item => item.id === 554)!.count = 20;
        return condition();
    });
    expect(await processor.process(new Map([[1113, 1]]), true)).toBe(true);
    expect(state.casts).toEqual([1113]);
    expect(Inventory.countById(1113)).toBe(1);
});

test('protects inventory copies of worn gear from both disposal paths', async () => {
    const { state, processor } = fixture();
    state.pack.push(item(1113));
    spyOn(Equipment, 'items').mockReturnValue([new InvItem(item(1113))]);
    expect(await processor.process(new Map(), true)).toBe(true);
    expect(state.casts).toEqual([]);
    expect(state.sold).toEqual([]);
    expect(Inventory.countById(1113)).toBe(1);
});

test.each([1353, 1361, 1357, 1389, 1381, 1383, 1385, 1387, 1391, 1233, 1225, 1227, 1255, 1257, 1259,
    1729, 1725, 1727, 1731, 1637, 1639, 1641, 1643, 1097, 1345, 2355, 2357, 2359, 2361])('sells new chest drop %i and preserves the pre-existing copy', async id => {
    const { state, processor } = fixture();
    state.pack.push(item(id, 2));
    expect(await processor.process(new Map([[id, 1]]), false)).toBe(true);
    expect(state.sold).toEqual([id]);
    expect(Inventory.countById(id)).toBe(1);
});

test.each([1391, 1259, 1731, 1643, 1345])('alchs valuable chest drop %i at its actual item value', async id => {
    const { state, processor } = fixture();
    state.pack.push(item(id));
    expect(await processor.process(new Map(), true)).toBe(true);
    expect(state.casts).toEqual([id]);
    expect(state.sold).toEqual([]);
    expect(Inventory.countById(id)).toBe(0);
});

test('keeps one useful Flamtaer hammer and sells only newly acquired extras', async () => {
    const { state, processor } = fixture();
    state.pack.push(item(3678, 3));
    expect(await processor.process(new Map(), false)).toBe(true);
    expect(state.casts).toEqual([]);
    expect(state.sold).toEqual([3678]);
    expect(Inventory.countById(3678)).toBe(1);
});

test('alchs surplus Flamtaer hammers while retaining the original useful hammer', async () => {
    const { state, processor } = fixture();
    state.pack.push(item(3678, 3));
    expect(await processor.process(new Map([[3678, 1]]), true)).toBe(true);
    expect(state.casts).toEqual([3678, 3678]);
    expect(state.sold).toEqual([]);
    expect(Inventory.countById(3678)).toBe(1);
    expect(Inventory.countById(995)).toBe(12100);
});

test('protects resources, access keys, cloth, clues and gear outside the chest allowlist', async () => {
    const { state, processor } = fixture();
    const protectedIds = [3465, 3470, 1514, 379, 380, 2434, 2435, 1941, 2347, 590, 561, 554, 2677, 1127, 1359];
    state.pack = protectedIds.map(id => item(id));
    expect(await processor.process(new Map(), true)).toBe(true);
    expect(state.casts).toEqual([]);
    expect(state.sold).toEqual([]);
    for (const id of protectedIds) expect(Inventory.countById(id)).toBe(1);
});

test('direct selling preserves worn copies, baseline possessions and a useful hammer', async () => {
    const { state, supply } = fixture();
    state.pack.push(item(1643, 2), item(1391), item(3678, 2), item(3470));
    spyOn(Equipment, 'items').mockReturnValue([new InvItem(item(1391))]);
    expect(await supply.sellLoot(new Map([[1643, 1]]))).toBe(true);
    expect(state.sold).toEqual([1643, 3678]);
    for (const id of [1643, 1391, 3678, 3470]) expect(Inventory.countById(id)).toBe(1);
});

test('a refused shop sale does not claim successful loot disposal', async () => {
    const { state, processor, sell } = fixture();
    state.pack.push(item(1217));
    sell.mockResolvedValue(0);
    expect(await processor.process(new Map(), false)).toBe(false);
    expect(Inventory.countById(1217)).toBe(1);
});
