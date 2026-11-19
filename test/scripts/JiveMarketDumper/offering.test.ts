import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Input } from '#/bot/input/Input.js';
import { offerPile } from '#/bot/scripts/JiveMarketDumper/offering.js';
import type { Dumpable } from '#/bot/scripts/JiveMarketDumper/logic.js';

afterEach(() => mock.restore());

const line = (id: number, count: number, notedId: number | null = null): Dumpable =>
    ({ id, count, name: 'Goods ' + id, displayName: 'Goods ' + id, notedId, stackable: false });
const item = (id: number, count: number, slot: number, name = 'Goods ' + id): InvItemSnapshot =>
    ({ id, count, slot, name, comId: 3322, ops: [] });

function window(pack: InvItemSnapshot[], offered: InvItemSnapshot[] = []) {
    const state = { open: true, pack, offered, ignoreOnce: -1 };
    spyOn(reader, 'tradeOfferOpen').mockImplementation(() => state.open);
    spyOn(reader, 'tradeSidePack').mockImplementation(() => state.pack);
    spyOn(reader, 'tradeMyOffer').mockImplementation(() => state.offered);
    const batches: number[][] = [];
    let sent: number[] = [];
    spyOn(Input, 'invButton').mockImplementation((id, slot, com, op) => {
        expect(state.pack.some(row => row.id === id && row.slot === slot)).toBe(true);
        expect([com, op]).toEqual([3322, 4]);
        sent.push(id);
        return true;
    });
    const advance = () => {
        if (!sent.length) return;
        batches.push(sent);
        for (const id of sent) {
            if (id === state.ignoreOnce) { state.ignoreOnce = -1; continue; }
            const moved = state.pack.filter(row => row.id === id);
            state.offered.push(...moved);
            state.pack = state.pack.filter(row => row.id !== id);
        }
        sent = [];
    };
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => { advance(); return condition(); });
    return { state, batches, advance };
}

test('twenty full stacks use four batches without opening quantity dialogs', async () => {
    const pile = Array.from({ length: 20 }, (_, i) => line(100 + i, 1000));
    const { batches } = window(pile.map((row, slot) => item(row.id, row.count, slot)));
    expect(await offerPile(pile)).toBe(true);
    expect(batches.map(batch => batch.length)).toEqual([5, 5, 5, 5]);
});

test('retries only a missing item and counts repeated slots, notes and existing offers', async () => {
    const { state, batches } = window([item(200, 1, 0), item(200, 1, 1), item(201, 50, 2, 'Goods 200'), item(300, 8, 3), item(995, 20, 4)], [item(300, 2, 0)]);
    state.ignoreOnce = 201;
    expect(await offerPile([line(200, 52, 201), line(300, 10)])).toBe(true);
    expect(batches).toEqual([[200, 201, 300], [201]]);
    expect(state.pack.map(row => row.id)).toEqual([995]);
});

test('never sends a whole stack that exceeds the planned amount', async () => {
    const { batches } = window([item(100, 11, 0)]);
    expect(await offerPile([line(100, 10)])).toBe(false);
    expect(batches).toEqual([]);
});

test('a closed screen cannot confirm a partially sent pile', async () => {
    const { state, advance } = window([item(100, 10, 0)]);
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async condition => { advance(); state.open = false; return condition(); });
    expect(await offerPile([line(100, 10)])).toBe(false);
});
