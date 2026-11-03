import { describe, expect, test } from 'bun:test';
import { canonicalMarketItems, isMarketMerchant, marketReceiptSlots, parseMarketQuote, purchase, receiptMatches, type PurchasePort, type PurchaseIntent } from '../../src/bot/scripts/JiveTT/marketTrade.js';

function desk(options: { changed?: boolean; partial?: boolean; receipt?: boolean; coins?: number; price?: number } = {}) {
    let stage: 'none' | 'offer' | 'confirm' = 'none';
    let cash = options.coins ?? 10000;
    let goods: { id: number; count: number }[] = [];
    let mine: { id: number; count: number }[] = [];
    const wanted = [{ id: 157, count: 2 }, { id: 145, count: 2 }, { id: 163, count: 2 }];
    const saved: (PurchaseIntent | null)[] = [];
    let accepts = 0;
    const port: PurchasePort = {
        ready: () => true,
        snapshot: () => ({ coins: cash, items: goods }),
        quote: async () => ({ kind: 'quote', quantity: 2, each: options.price ?? 100, total: (options.price ?? 100) * 2 }),
        request: async () => { stage = 'offer'; return true; },
        screen: () => stage,
        partner: () => 'seers market',
        offerCoins: async count => { mine = [{ id: 995, count }]; return true; },
        offers: () => ({ mine, theirs: options.partial ? wanted.slice(0, 2) : options.changed && stage === 'confirm' ? [{ id: 157, count: 1 }] : wanted }),
        confirmReady: () => true,
        receiptFits: () => true,
        accept: async () => {
            accepts++;
            if (stage === 'offer') stage = 'confirm';
            else { stage = 'none'; cash -= 200; if (options.receipt !== false) goods = wanted; }
            return true;
        },
        wait: async () => {},
        decline: async () => { stage = 'none'; },
        persist: intent => { saved.push(intent); }
    };
    return { port, saved, accepts: () => accepts };
}
const order = { account: 'buyer', item: 'Super set', quantity: 2, expected: [{ id: 157, count: 2 }, { id: 145, count: 2 }, { id: 163, count: 2 }], maxUnitPrice: 100, maxSpend: 1000, coinReserve: 200 };

describe('JiveTT verified market purchase', () => {
    test('checks both screens and exact delivered items and coins', async () => {
        const d = desk();
        const result = await purchase(order, d.port);
        expect(result.kind).toBe('bought');
        expect(d.accepts()).toBe(2);
        expect(d.saved[0]?.expected).toEqual(order.expected);
        expect(d.saved.at(-1)?.cost).toBe(200);
    });
    test('rejects a changed confirm offer before final acceptance', async () => {
        const d = desk({ changed: true });
        expect((await purchase(order, d.port)).kind).toBe('offer-changed');
        expect(d.accepts()).toBe(1);
    });
    test('rejects incomplete super sets', async () => {
        const d = desk({ partial: true });
        expect((await purchase(order, d.port)).kind).toBe('stockout');
        expect(d.accepts()).toBe(0);
    });
    test('retains intent when final acceptance has no complete receipt', async () => {
        const d = desk({ receipt: false });
        expect((await purchase(order, d.port)).kind).toBe('receipt-unconfirmed');
        expect(d.saved.at(-1)).not.toBeNull();
    });
    test('refuses unbounded prices, over-ceiling quote and depleted travel cash', async () => {
        expect((await purchase({ ...order, maxUnitPrice: 0 }, desk().port)).kind).toBe('missing-ceiling');
        expect((await purchase(order, desk({ price: 101 }).port)).kind).toBe('price-rejected');
        expect((await purchase(order, desk({ coins: 399 }).port)).kind).toBe('insufficient-funds');
    });
    test('only accepts exact current quoted quantity and matching price arithmetic', () => {
        expect(parseMarketQuote('2 x Super set = 1,000gp (500ea). Trade me.', 'Super set', 2)).toEqual({ kind: 'quote', quantity: 2, total: 1000, each: 500 });
        expect(parseMarketQuote('1 x Super set = 500gp (500ea).', 'Super set', 2)?.kind).toBe('stockout');
        expect(parseMarketQuote('2 x Super set = 100gp (500ea).', 'Super set', 2)).toBeNull();
    });
});

test('retains intent if disconnect throws during final acceptance', async () => {
    const d = desk();
    const original = d.port.accept;
    let calls = 0;
    d.port.accept = async () => { if (++calls === 2) throw new Error('disconnected'); return original(); };
    await expect(purchase(order, d.port)).rejects.toThrow('disconnected');
    expect(d.saved.at(-1)).not.toBeNull();
});

test('waits while the merchant adds the three set components separately', async () => {
    const d = desk();
    const offers = d.port.offers;
    let ticks = 0;
    d.port.wait = async () => { ticks++; };
    d.port.offers = () => { const result = offers(); return { ...result, theirs: result.theirs.slice(0, Math.min(3, ticks)) }; };
    expect((await purchase(order, d.port)).kind).toBe('bought');
});


test('noted receipts normalize identity without treating dose variants as interchangeable', () => {
    const notes = new Map([[140, 139], [2435, 2434]]);
    expect(canonicalMarketItems([{ id: 140, count: 4 }, { id: 139, count: 1 }, { id: 2435, count: 2 }], notes)).toEqual([{ id: 139, count: 5 }, { id: 2434, count: 2 }]);
});

test('waits for the initial trade partner header before offering coins', async () => {
    const d = desk();
    let ticks = 0;
    d.port.wait = async () => { ticks++; };
    d.port.partner = () => ticks ? 'seers market' : null;
    expect((await purchase(order, d.port)).kind).toBe('bought');
});


test('merchant identity ignores server crown markup but still matches the entire name', () => {
    expect(isMarketMerchant('@cr2@Seers Market')).toBe(true);
    expect(isMarketMerchant('@cr1@Seers Market scam')).toBe(false);
    expect(isMarketMerchant(null)).toBe(false);
});


test('an incomplete persisted intent cannot prove a receipt from coin loss alone', () => {
    const intent = { account: 'alice', item: 'Shark', quantity: 1, expected: [], itemsBefore: [], coinsBefore: 100, cost: 100, at: Date.now() };
    expect(receiptMatches(intent, { coins: 0, items: [] })).toBe(false);
});


test('unnoted bottles consume one slot each while noted sets need three stacks', () => {
    const unnoted = [145, 157, 163].map(id => ({ id, count: 20 }));
    const noted = [146, 158, 164].map(id => ({ id, count: 20 }));
    const stackable = (id: number) => [146, 158, 164].includes(id);
    expect(marketReceiptSlots(unnoted, [], stackable)).toBe(60);
    expect(marketReceiptSlots(noted, [], stackable)).toBe(3);
    expect(marketReceiptSlots(noted, [{ id: 146, count: 1 }], stackable)).toBe(2);
});

test('declines an otherwise valid receipt before acceptance when it cannot fit', async () => {
    const d = desk();
    d.port.receiptFits = () => false;
    expect((await purchase(order, d.port)).kind).toBe('unavailable');
    expect(d.accepts()).toBe(0);
});

test('reissues an unanswered trade request after the merchant finishes fetching stock', async () => {
    const d = desk();
    const request = d.port.request;
    let requests = 0;
    d.port.request = async () => ++requests === 1 ? true : request();
    expect((await purchase(order, d.port)).kind).toBe('bought');
    expect(requests).toBe(2);
    expect(d.accepts()).toBe(2);
});
