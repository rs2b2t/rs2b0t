import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot, type ObjRecord } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { resetLiveCatalog } from '#/bot/api/market/catalog.js';
import { Shop } from '#/bot/api/shop/Shop.js';
import { Input } from '#/bot/input/Input.js';
import { MorttonShop, noteId, withdrawNoted } from '#/bot/scripts/ShadesOfMortton/shop.js';
import { Supplies } from '#/bot/scripts/ShadesOfMortton/supply.js';

afterEach(() => { mock.restore(); resetLiveCatalog(); });

const record = (id: number, certlink = -1, cost = 1): ObjRecord => ({ id, name: 'Magic pyre logs', cost, stackable: certlink !== -1, members: true, equippable: false, certlink, certtemplate: certlink === -1 ? -1 : 799 });
const item = (id: number, count = 1, slot = 0, comId = 3214): InvItemSnapshot => ({ id, count, slot, comId, name: id === 995 ? 'Coins' : 'Magic pyre logs', ops: comId === 3900 ? ['Value', 'Buy 1', 'Buy 5', 'Buy 10'] : ['Value', 'Sell 1', 'Sell 5', 'Sell 10'] });

function fixture(coins = 10000) {
    const state = {
        pack: [item(995, coins), item(3449, 20, 1)], stock: [] as InvItemSnapshot[], event: false,
        ticks: 0, sell: 0, buy: 0, sellEnabled: true, buyEnabled: true, afterSell: () => {}, afterBuy: () => {}, onTick: () => {}
    };
    spyOn(reader, 'objCatalog').mockReturnValue([record(3448), record(3449, 3448)]);
    spyOn(reader, 'inventory').mockImplementation(() => state.pack);
    spyOn(reader, 'inventorySize').mockReturnValue(28);
    spyOn(reader, 'bankComId').mockReturnValue(-1);
    spyOn(reader, 'shopInv').mockImplementation(com => com === 3900 ? state.stock : state.pack.map(i => ({ ...i, comId: 3823 })));
    spyOn(Shop, 'isOpen').mockReturnValue(true);
    spyOn(EventSignal, 'pending').mockImplementation(() => state.event);
    spyOn(Execution, 'delayTicks').mockImplementation(async n => { for (let i = 0; i < n; i++) { state.ticks++; state.onTick(); } });
    spyOn(Execution, 'delayUntil').mockImplementation(async condition => {
        for (let i = 0; i < 8; i++) { if (condition()) return true; await Execution.delayTicks(1); }
        return condition();
    });
    spyOn(Input, 'invButton').mockImplementation((id, slot, com, op) => {
        const qty = op === 3 ? 5 : op === 4 ? 10 : 1;
        if (com === 3823) {
            state.sell++;
            if (id !== 3449 || !state.sellEnabled) return true;
            const note = state.pack.find(i => i.id === id)!;
            note.count -= qty;
            state.pack = state.pack.filter(i => i.count > 0);
            let row = state.stock.find(i => i.id === 3448);
            if (!row) { row = item(3448, 0, state.stock.length, 3900); state.stock.push(row); }
            row.count += qty;
            state.afterSell();
        } else {
            state.buy++;
            if (!state.buyEnabled) return true;
            const row = state.stock.find(i => i.id === id && i.slot === slot);
            const got = Math.min(qty, row?.count ?? 0);
            if (row) row.count -= got;
            for (let i = 0; i < got; i++) state.pack.push(item(id, 1, state.pack.length));
            state.pack[0].count -= got;
            state.afterBuy();
        }
        return true;
    });
    const supply = new Supplies(() => {});
    spyOn(supply, 'walk').mockResolvedValue(true);
    return { state, shop: new MorttonShop(supply, async () => true) };
}

const held = (state: ReturnType<typeof fixture>['state'], id: number): number => state.pack.filter(i => i.id === id).reduce((n, i) => n + i.count, 0);

test('noted withdrawal verifies the certificate ID and resets note mode', async () => {
    const { state } = fixture();
    const modes: boolean[] = [];
    spyOn(Bank, 'countById').mockReturnValue(40);
    spyOn(Bank, 'setNoteMode').mockImplementation(async on => { modes.push(on); });
    spyOn(Bank, 'withdrawXById').mockImplementation(async (id, qty, landsAs) => {
        expect([id, qty, landsAs]).toEqual([3448, 8, 3449]);
        state.pack[1].count += qty;
        return true;
    });
    expect(noteId(3448)).toBe(3449);
    expect(noteId(995)).toBeNull();
    expect(await withdrawNoted(3448, 8)).toBe(true);
    expect(modes).toEqual([true, false]);
});

test('accepted withdrawal without receiving notes fails and resets note mode', async () => {
    fixture();
    const modes: boolean[] = [];
    spyOn(Bank, 'countById').mockReturnValue(40);
    spyOn(Bank, 'setNoteMode').mockImplementation(async on => { modes.push(on); });
    spyOn(Bank, 'withdrawXById').mockResolvedValue(true);
    expect(await withdrawNoted(3448, 8)).toBe(false);
    expect(modes).toEqual([true, false]);
});

test('insufficient purchase budget preserves notes before selling', async () => {
    const { state, shop } = fixture(500);
    expect(await shop.refill(3448, 5)).toBe(false);
    expect(held(state, 3449)).toBe(20);
    expect(state.sell).toBe(0);
});

test('refill buys the exact ID in batches of at most five and targets total loose count', async () => {
    const { state, shop } = fixture();
    state.pack.push(item(3448));
    state.stock.push(item(777, 100, 0, 3900));
    expect(await shop.refill(3448, 8)).toBe(true);
    expect(held(state, 3448)).toBe(8);
    expect(held(state, 777)).toBe(0);
    expect(held(state, 3449)).toBe(13);
    expect(shop.pending()).toBe(false);
});

test('full shared shop preserves notes without attempting a sale', async () => {
    const { state, shop } = fixture();
    state.stock = Array.from({ length: 40 }, (_, i) => item(6000 + i, 1, i, 3900));
    expect(await shop.refill(3448, 5)).toBe(false);
    expect(state.sell).toBe(0);
    expect(held(state, 3449)).toBe(20);
});

test('missing stock after sale ends the attempt without selling another batch', async () => {
    const { state, shop } = fixture();
    state.afterSell = () => { state.stock = []; };
    expect(await shop.refill(3448, 5)).toBe(false);
    expect(state.sell).toBe(1);
    expect(held(state, 3449)).toBe(15);
    expect(shop.pending()).toBe(false);
    expect(await shop.resume()).toBe(true);
});

test('partial stolen stock buys what remains and reports a bounded failure', async () => {
    const { state, shop } = fixture();
    state.afterSell = () => { state.stock[0].count = 2; };
    expect(await shop.refill(3448, 5)).toBe(false);
    expect(held(state, 3448)).toBe(2);
    expect(state.sell).toBe(1);
    expect(shop.pending()).toBe(false);
});

test('event after sale resumes buyback without a second sale', async () => {
    const { state, shop } = fixture();
    state.afterSell = () => { state.event = true; };
    expect(await shop.refill(3448, 5)).toBe(false);
    expect(shop.pending()).toBe(true);
    expect(state.buy).toBe(0);
    state.event = false;
    expect(await shop.resume()).toBe(true);
    expect(held(state, 3448)).toBe(5);
    expect(held(state, 3449)).toBe(15);
    expect(state.sell).toBe(1);
    expect(shop.pending()).toBe(false);
});

test('accepted sale input without removing notes cannot claim a refill', async () => {
    const { state, shop } = fixture();
    state.sellEnabled = false;
    expect(await shop.refill(3448, 5)).toBe(false);
    expect(held(state, 3449)).toBe(20);
    expect(state.sell).toBe(1);
    expect(shop.pending()).toBe(false);
});

test('accepted purchase input without receiving loose items fails within one attempt', async () => {
    const { state, shop } = fixture();
    state.buyEnabled = false;
    expect(await shop.refill(3448, 5)).toBe(false);
    expect(held(state, 3448)).toBe(0);
    expect(state.buy).toBe(1);
    expect(shop.pending()).toBe(false);
});

test('an affordable two-item refill keeps the coin reserve instead of requiring a batch of five', async () => {
    const { state, shop } = fixture(514);
    expect(await shop.refill(3448, 2)).toBe(true);
    expect(held(state, 3448)).toBe(2);
    expect(held(state, 3449)).toBe(18);
    expect(held(state, 995)).toBeGreaterThanOrEqual(500);
});

test('refill preserves two transition slots', async () => {
    const { state, shop } = fixture();
    for (let i = 0; i < 22; i++) state.pack.push(item(8000 + i));
    expect(await shop.refill(3448, 5)).toBe(false);
    expect(held(state, 3448)).toBe(2);
    expect(held(state, 3449)).toBe(18);
    expect(state.pack.length).toBe(26);
});

test('event after a completed purchase reconciles without buying or selling twice', async () => {
    const { state, shop } = fixture();
    state.afterBuy = () => { state.event = true; };
    expect(await shop.refill(3448, 5)).toBe(false);
    expect(shop.pending()).toBe(true);
    state.event = false;
    expect(await shop.resume()).toBe(true);
    expect(held(state, 3448)).toBe(5);
    expect(state.buy).toBe(1);
    expect(state.sell).toBe(1);
});

test('event before the sale lands retains the attempt until the delayed inventory update', async () => {
    const { state, shop } = fixture();
    let sent = false;
    spyOn(Input, 'invButton').mockImplementation((id, _slot, com) => {
        if (com === 3823) { state.sell++; sent = true; state.event = true; }
        else {
            state.buy++;
            state.stock[0].count -= 5;
            for (let i = 0; i < 5; i++) state.pack.push(item(id));
        }
        return true;
    });
    state.onTick = () => {
        if (sent && !state.event && !state.stock.length) {
            state.pack[1].count -= 5;
            state.stock.push(item(3448, 5, 0, 3900));
        }
    };
    expect(await shop.refill(3448, 5)).toBe(false);
    expect(shop.pending()).toBe(true);
    expect(held(state, 3449)).toBe(20);
    state.event = false;
    expect(await shop.resume()).toBe(true);
    expect(held(state, 3449)).toBe(15);
    expect(held(state, 3448)).toBe(5);
    expect(state.sell).toBe(1);
});

test('coins lost during interruption cannot consume the reserve on resume', async () => {
    const { state, shop } = fixture();
    state.afterSell = () => { state.event = true; };
    expect(await shop.refill(3448, 5)).toBe(false);
    state.pack[0].count = 501;
    state.event = false;
    expect(await shop.resume()).toBe(false);
    expect(held(state, 995)).toBe(501);
    expect(held(state, 3448)).toBe(0);
    expect(shop.pending()).toBe(false);
});

test('withdrawal restores item mode when bank input throws', async () => {
    fixture();
    const modes: boolean[] = [];
    spyOn(Bank, 'countById').mockReturnValue(40);
    spyOn(Bank, 'setNoteMode').mockImplementation(async on => { modes.push(on); });
    spyOn(Bank, 'withdrawXById').mockRejectedValue(new Error('stopped'));
    expect(withdrawNoted(3448, 8)).rejects.toThrow('stopped');
    await Promise.resolve();
    expect(modes).toEqual([true, false]);
});

test('nonbaseline pyre stock remains affordable at three thousand coins using its real catalog cost', async () => {
    const { state, shop } = fixture(3000);
    spyOn(reader, 'objCatalog').mockReturnValue([record(3448, -1, 640), record(3449, 3448, 640)]);
    resetLiveCatalog();
    expect(await shop.refill(3448, 2)).toBe(true);
    expect(held(state, 3448)).toBe(2);
    expect(held(state, 3449)).toBe(18);
});
