export const MARKET_MERCHANT = 'seers market';
export function isMarketMerchant(name: string | null): boolean {
    return (name ?? '').replace(/^@cr[12]@/, '').trim().toLowerCase().replaceAll('_', ' ') === MARKET_MERCHANT;
}
export interface MarketItem { id: number; count: number }
export interface MarketQuote { kind: 'quote'; quantity: number; total: number; each: number }
export type QuoteResult = MarketQuote | { kind: 'stockout' | 'merchant-absent' | 'interrupted' };
export interface PurchaseOrder {
    account: string;
    item: string;
    quantity: number;
    expected: MarketItem[];
    maxUnitPrice: number;
    maxSpend: number;
    coinReserve: number;
}
export interface PurchaseIntent {
    account: string;
    item: string;
    quantity: number;
    expected: MarketItem[];
    coinsBefore: number;
    itemsBefore: MarketItem[];
    cost: number;
    at: number;
}
export type MarketPurchaseResult = { kind: 'bought'; spent: number; quantity: number; receipts: MarketItem[] }
    | { kind: 'missing-ceiling' | 'merchant-absent' | 'stockout' | 'price-rejected' | 'insufficient-funds' | 'offer-changed' | 'receipt-unconfirmed' | 'interrupted' | 'unavailable'; reason: string };
export interface PurchasePort {
    ready(): boolean;
    snapshot(): { coins: number; items: MarketItem[] };
    quote(item: string, quantity: number): Promise<QuoteResult>;
    request(): Promise<boolean>;
    screen(): 'none' | 'offer' | 'confirm';
    partner(): string | null;
    offerCoins(count: number): Promise<boolean>;
    offers(): { mine: MarketItem[]; theirs: MarketItem[] };
    confirmReady(): boolean;
    receiptFits(): boolean;
    accept(): Promise<boolean>;
    wait(): Promise<void>;
    decline(): Promise<void>;
    persist(intent: PurchaseIntent | null): void;
}

const failure = (kind: Exclude<MarketPurchaseResult['kind'], 'bought'>, reason: string): MarketPurchaseResult => ({ kind, reason });
const positive = (n: number): boolean => Number.isSafeInteger(n) && n > 0;
const counts = (items: readonly MarketItem[]): Map<number, number> => {
    const result = new Map<number, number>();
    for (const item of items) result.set(item.id, (result.get(item.id) ?? 0) + item.count);
    return result;
};
export function canonicalMarketItems(items: readonly MarketItem[], unnotedOf: ReadonlyMap<number, number>): MarketItem[] {
    return [...counts(items.map(item => ({ id: unnotedOf.get(item.id) ?? item.id, count: item.count })))].map(([id, count]) => ({ id, count }));
}
export function marketReceiptSlots(items: readonly MarketItem[], inventory: readonly MarketItem[], stackable: (id: number) => boolean): number {
    if (items.some(item => !positive(item.count))) return Infinity;
    const held = counts(inventory);
    return [...counts(items)].reduce((slots, [id, count]) => slots + (stackable(id) ? held.has(id) ? 0 : 1 : count), 0);
}
export function exactMarketItems(actual: readonly MarketItem[], expected: readonly MarketItem[]): boolean {
    if (actual.some(i => !positive(i.count) || !Number.isSafeInteger(i.id))) return false;
    const a = counts(actual);
    const b = counts(expected);
    return a.size === b.size && [...b].every(([id, count]) => a.get(id) === count);
}
function partialMarketItems(actual: readonly MarketItem[], expected: readonly MarketItem[]): boolean {
    const limit = counts(expected);
    return actual.every(i => positive(i.count)) && [...counts(actual)].every(([id, count]) => count <= (limit.get(id) ?? 0));
}
export function receiptMatches(intent: PurchaseIntent, actual: { coins: number; items: MarketItem[] }): boolean {
    if (!positive(intent.cost) || !positive(intent.quantity) || intent.expected.length === 0 || intent.expected.some(item => !positive(item.count))) return false;
    if (actual.coins !== intent.coinsBefore - intent.cost) return false;
    const before = counts(intent.itemsBefore);
    const after = counts(actual.items);
    return intent.expected.every(i => (after.get(i.id) ?? 0) === (before.get(i.id) ?? 0) + i.count);
}
export function parseMarketQuote(text: string, item: string, quantity: number): QuoteResult | null {
    if (text.toLowerCase() === `i have no ${item.toLowerCase()} right now.`) return { kind: 'stockout' };
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`^([\\d,]+) x ${escaped} = ([\\d,]+)gp \\(([\\d,]+)ea\\)\\.`, 'i').exec(text);
    if (!match) return null;
    const [qty, total, each] = match.slice(1).map(n => Number(n.replaceAll(',', '')));
    if (![qty, total, each].every(positive) || !Number.isSafeInteger(qty * each) || total !== qty * each) return null;
    return qty === quantity ? { kind: 'quote', quantity: qty, total, each } : { kind: 'stockout' };
}

export async function purchase(order: PurchaseOrder, port: PurchasePort): Promise<MarketPurchaseResult> {
    if (!positive(order.maxUnitPrice)) return failure('missing-ceiling', `Set a price ceiling for ${order.item}`);
    if (!positive(order.quantity) || !positive(order.maxSpend) || !Number.isSafeInteger(order.coinReserve) || order.coinReserve < 0
        || order.expected.length === 0 || order.expected.some(i => !positive(i.count))) return failure('unavailable', 'Invalid purchase limits');
    if (!port.ready() || port.screen() !== 'none') return failure('interrupted', 'Purchase cannot begin safely');
    const quote = await port.quote(order.item, order.quantity);
    if (quote.kind !== 'quote') return failure(quote.kind, `${order.item}: ${quote.kind}`);
    if (quote.quantity !== order.quantity || quote.each > order.maxUnitPrice || quote.total > order.maxSpend
        || !positive(quote.total) || quote.total !== quote.quantity * quote.each) return failure('price-rejected', `Quote exceeds limits for ${order.item}`);
    const before = port.snapshot();
    if (before.coins - quote.total < order.coinReserve) return failure('insufficient-funds', 'Purchase would consume travel reserve');
    const intent: PurchaseIntent = { account: order.account, item: order.item, quantity: order.quantity, expected: order.expected, coinsBefore: before.coins, itemsBefore: before.items, cost: quote.total, at: Date.now() };
    port.persist(intent);
    let confirmed = false;
    let accepted = false;
    let offered = false;
    try {
        if (!port.ready() || !(await port.request())) return failure('interrupted', 'Trade request failed');
        for (let poll = 0; poll < 80; poll++) {
            if (!port.ready()) return failure(confirmed ? 'receipt-unconfirmed' : 'interrupted', 'Trade interrupted; reconcile fresh stock');
            const screen = port.screen();
            if (screen === 'none') {
                if (confirmed && receiptMatches(intent, port.snapshot())) return { kind: 'bought', quantity: order.quantity, spent: quote.total, receipts: order.expected };
                if (!offered && !confirmed && poll > 0 && poll % 10 === 0) await port.request();
            } else {
                const partner = (port.partner() ?? '').trim().toLowerCase().replaceAll('_', ' ');
                if (!partner && screen === 'offer' && !offered) { await port.wait(); continue; }
                if (!isMarketMerchant(partner)) return failure('offer-changed', 'Trade partner changed');
                const offers = port.offers();
                if (screen === 'offer') {
                    if (confirmed) return failure('receipt-unconfirmed', 'Trade returned to offer screen after confirmation');
                    if (!offered) {
                        if (offers.mine.length || !(await port.offerCoins(quote.total))) return failure('offer-changed', 'Could not offer exact coins');
                        offered = true;
                    } else {
                        if (!exactMarketItems(offers.mine, [{ id: 995, count: quote.total }])) return failure('offer-changed', 'Coin offer changed');
                        if (offers.theirs.length) {
                            const exact = exactMarketItems(offers.theirs, order.expected);
                            if (!exact && (accepted || !partialMarketItems(offers.theirs, order.expected))) return failure('offer-changed', 'Merchant offer changed');
                            if (exact && !port.receiptFits()) return failure('unavailable', 'Merchant receipt will not fit in inventory');
                            if (exact && !accepted) accepted = await port.accept();
                        }
                    }
                } else if (port.confirmReady()) {
                    if (!accepted || !exactMarketItems(offers.mine, [{ id: 995, count: quote.total }]) || !exactMarketItems(offers.theirs, order.expected)) return failure('offer-changed', 'Confirmation does not match approved offer');
                    if (!port.receiptFits()) return failure('unavailable', 'Merchant receipt will not fit in inventory');
                    if (!confirmed) {
                        confirmed = true;
                        if (!await port.accept()) return failure('receipt-unconfirmed', 'Final acceptance was not confirmed; reconcile fresh stock');
                    }
                }
            }
            await port.wait();
        }
        return failure(confirmed ? 'receipt-unconfirmed' : offered && !accepted ? 'stockout' : 'interrupted', 'Trade timed out; reconcile fresh stock');
    } finally {
        if (port.screen() !== 'none') await port.decline();
        if (!confirmed) port.persist(null);
    }
}
