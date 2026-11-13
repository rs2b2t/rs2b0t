import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ITEM_DB } from '#/bot/data/itemdb.js';
import { LootProcessor } from '#/bot/scripts/ShadesOfMortton/loot.js';
import type { Stock } from '#/bot/scripts/ShadesOfMortton/policy.js';
import { Supplies } from '#/bot/scripts/ShadesOfMortton/supply.js';

afterEach(() => mock.restore());
const item = (id: number, count = 1): InvItemSnapshot => ({ id, count, slot: id, comId: 3214, name: ITEM_DB.find(item => item.id === id)?.name ?? '', ops: [] });
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
        state.pack.find(item => item.id === 995)!.count += Math.floor(ITEM_DB.find(item => item.id === target.id)!.cost * 0.6);
        return true;
    });
    const supply = new Supplies(() => {});
    const sell = spyOn(supply, 'sellLoot').mockImplementation(async baseline => {
        for (const entry of state.pack) {
            if (/^(Steel|Black|Mithril|Adamant|Rune) /i.test(entry.name ?? '') && entry.count > (baseline.get(entry.id) ?? 0)) {
                state.sold.push(entry.id);
                entry.count = baseline.get(entry.id) ?? 0;
            }
        }
        return true;
    });
    return { state, processor: new LootProcessor(supply), sell };
}

test('alchs only newly acquired allowlisted equipment and keeps the chest baseline', async () => {
    const { state, processor } = fixture();
    state.pack.push(item(1127, 3), item(3469), item(3470), item(379, 2), item(3448), item(2434), item(590));
    const before: Stock = new Map([[1127, 2], [379, 2], [3448, 1], [2434, 1], [590, 1]]);
    expect(await processor.process(before, true)).toBe(true);
    expect(state.casts).toEqual([1127]);
    expect(Inventory.countById(1127)).toBe(2);
    for (const id of [3469, 3470, 379, 3448, 2434, 590]) expect(Inventory.countById(id)).toBe(before.get(id) ?? 1);
    expect(Inventory.countById(561)).toBe(4);
    expect(Inventory.countById(554)).toBe(20);
    expect(Inventory.countById(995)).toBe(39100);
});

test('sells cheap gear without spending runes and sells all eligible loot when alchemy is off', async () => {
    const { state, processor } = fixture();
    state.pack.push(item(1207), item(1127));
    expect(await processor.process(new Map(), false)).toBe(true);
    expect(state.casts).toEqual([]);
    expect(state.sold).toEqual([1207, 1127]);
    state.sold = [];
    state.pack.push(item(1207));
    expect(await processor.process(new Map(), true)).toBe(true);
    expect(state.casts).toEqual([]);
    expect(state.sold).toEqual([1207]);
});

test('missing level or either rune falls back to selling', async () => {
    for (const missing of ['level', 'nature', 'fire'] as const) {
        const { state, processor } = fixture();
        state.pack.push(item(1127));
        if (missing === 'level') state.level = 54;
        if (missing === 'nature') state.pack = state.pack.filter(item => item.id !== 561);
        if (missing === 'fire') state.pack.find(item => item.id === 554)!.count = 4;
        expect(await processor.process(new Map(), true)).toBe(true);
        expect(state.casts).toEqual([]);
        expect(state.sold).toEqual([1127]);
        mock.restore();
    }
});

test('failed cast and accepted cast with no inventory transition fall back to selling', async () => {
    for (const accepted of [false, true]) {
        const { state, processor } = fixture();
        state.pack.push(item(1127));
        spyOn(Game, 'castOnItem').mockImplementation(async (_spell, target) => { state.casts.push(target.id); return accepted; });
        expect(await processor.process(new Map(), true)).toBe(true);
        expect(state.casts).toEqual([1127]);
        expect(state.sold).toEqual([1127]);
        expect(Inventory.countById(1127)).toBe(0);
        mock.restore();
    }
});

test('partial transition does not issue another alch and leaves remaining new equipment for selling', async () => {
    const { state, processor } = fixture();
    state.pack.push(item(1127, 2));
    spyOn(Game, 'castOnItem').mockImplementation(async (_spell, target) => {
        state.casts.push(target.id);
        state.pack.find(item => item.id === target.id)!.count--;
        return true;
    });
    expect(await processor.process(new Map(), true)).toBe(true);
    expect(state.casts).toEqual([1127]);
    expect(state.sold).toEqual([1127]);
});

test('alchs each new item separately and waits out ordinary spell recovery', async () => {
    const { state, processor } = fixture();
    state.pack.push(item(1127, 2));
    expect(await processor.process(new Map(), true)).toBe(true);
    expect(state.casts).toEqual([1127, 1127]);
    expect(state.ticks).toBeGreaterThanOrEqual(10);
    expect(state.sold).toEqual([]);
});

test('events prevent disposal and interrupted casts reconcile before another cast', async () => {
    const { state, processor, sell } = fixture();
    state.pack.push(item(1127, 2));
    state.event = true;
    expect(await processor.process(new Map(), true)).toBe(false);
    expect(state.casts).toEqual([]);
    expect(sell).not.toHaveBeenCalled();
    state.event = false;
    spyOn(Game, 'castOnItem').mockImplementation(async (_spell, target) => { state.casts.push(target.id); state.event = true; return true; });
    expect(await processor.process(new Map(), true)).toBe(false);
    state.event = false;
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => {
        state.pack.find(item => item.id === 1127)!.count = 1;
        state.pack.find(item => item.id === 995)!.count = 39100;
        state.pack.find(item => item.id === 561)!.count = 4;
        state.pack.find(item => item.id === 554)!.count = 20;
        return condition();
    });
    expect(await processor.process(new Map([[1127, 1]]), true)).toBe(true);
    expect(state.casts).toEqual([1127]);
    expect(Inventory.countById(1127)).toBe(1);
});

test('protects inventory copies of worn gear from both disposal paths', async () => {
    const { state, processor } = fixture();
    state.pack.push(item(1127));
    spyOn(Equipment, 'items').mockReturnValue([new InvItem(item(1127))]);
    expect(await processor.process(new Map(), true)).toBe(true);
    expect(state.casts).toEqual([]);
    expect(state.sold).toEqual([]);
    expect(Inventory.countById(1127)).toBe(1);
});
