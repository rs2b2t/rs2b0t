import { unnotedId, type Catalog } from './catalog.js';
import type { OfferItem } from './quote.js';

export type TradeScreen = 'none' | 'offer' | 'confirm';

export type TradeDecision =
    | { action: 'wait'; reason: string }
    | { action: 'offer' }
    | { action: 'accept' }
    | { action: 'decline'; reason: string };

export interface TradeExpectation {
    customer: string;
    give: ReadonlyMap<number, number>;
    get: ReadonlyMap<number, number>;
}

export const HEADER_WAIT_TICKS = 8;

export function normaliseOffer(cat: Catalog, items: readonly OfferItem[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const item of items) {
        const id = unnotedId(cat, item.id);
        out.set(id, (out.get(id) ?? 0) + Math.max(1, item.count));
    }
    return out;
}

export function offersMatch(actual: ReadonlyMap<number, number>, expected: ReadonlyMap<number, number>): boolean {
    if (actual.size !== expected.size) {
        return false;
    }
    for (const [id, count] of expected) {
        if (actual.get(id) !== count) {
            return false;
        }
    }
    return true;
}

// Why: separates "still filling" from "wrong", so a part-filled offer waits and an overpay or a stray item declines.
function stillFilling(actual: ReadonlyMap<number, number>, expected: ReadonlyMap<number, number>): boolean {
    for (const [id, count] of actual) {
        const want = expected.get(id);
        if (want === undefined || count > want) {
            return false;
        }
    }
    return true;
}

/**
 * Whether to accept, decline, offer or wait on one beat of an open trade.
 * Why: every unknown resolves to decline, since declining costs a trade and accepting the wrong one costs the stock.
 */
export function decideMarketTrade(input: {
    screen: TradeScreen;
    partnerHeader: string | null;
    expect: TradeExpectation;
    cat: Catalog;
    myOffer: readonly OfferItem[];
    theirOffer: readonly OfferItem[];
    /** null until the confirm screen has filled. */
    confirmMatches: boolean | null;
    waitedTicks: number;
}): TradeDecision {
    if (input.screen === 'none') {
        return { action: 'wait', reason: 'no trade screen' };
    }

    if (input.partnerHeader === null) {
        return input.waitedTicks > HEADER_WAIT_TICKS
            ? { action: 'decline', reason: 'partner header never filled' }
            : { action: 'wait', reason: 'partner header' };
    }

    if (input.partnerHeader.trim().toLowerCase() !== input.expect.customer.trim().toLowerCase()) {
        return { action: 'decline', reason: `not my customer (${input.partnerHeader})` };
    }

    if (input.screen === 'confirm') {
        if (input.confirmMatches === null) {
            return { action: 'wait', reason: 'confirm screen' };
        }
        return input.confirmMatches
            ? { action: 'accept' }
            : { action: 'decline', reason: 'confirm screen does not match the quote' };
    }

    const mine = normaliseOffer(input.cat, input.myOffer);
    if (!offersMatch(mine, input.expect.give)) {
        return stillFilling(mine, input.expect.give)
            ? { action: 'offer' }
            : { action: 'decline', reason: 'my own offer does not match the quote' };
    }

    const theirs = normaliseOffer(input.cat, input.theirOffer);
    if (!offersMatch(theirs, input.expect.get)) {
        return stillFilling(theirs, input.expect.get)
            ? { action: 'wait', reason: 'their offer' }
            : { action: 'decline', reason: 'their offer does not match the quote' };
    }

    return { action: 'accept' };
}

export interface MarketTradeHooks {
    screen(): TradeScreen;
    partnerHeader(): string | null;
    myOffer(): OfferItem[];
    theirOffer(): OfferItem[];
    /** null until the confirm screen has filled. Only called on that screen. */
    confirmMatches(expect: TradeExpectation): boolean | null;
    offerGive(give: ReadonlyMap<number, number>): Promise<boolean>;
    accept(): Promise<boolean>;
    decline(): Promise<void>;
    log(msg: string): void;
}

/** One beat of an open market trade. Call from a Task that owns the loop, since movement cancels the modal. */
export async function driveMarketTradeBeat(
    expect: TradeExpectation,
    cat: Catalog,
    hooks: MarketTradeHooks,
    state: { waitedTicks: number }
): Promise<TradeDecision> {
    const screen = hooks.screen();
    const header = hooks.partnerHeader();
    state.waitedTicks = header === null ? state.waitedTicks + 1 : 0;

    const decision = decideMarketTrade({
        screen,
        partnerHeader: header,
        expect,
        cat,
        myOffer: hooks.myOffer(),
        theirOffer: hooks.theirOffer(),
        confirmMatches: screen === 'confirm' ? hooks.confirmMatches(expect) : null,
        waitedTicks: state.waitedTicks
    });

    switch (decision.action) {
        case 'offer':
            await hooks.offerGive(expect.give);
            break;
        case 'accept':
            await hooks.accept();
            break;
        case 'decline':
            hooks.log(`trade declined: ${decision.reason}`);
            await hooks.decline();
            break;
        case 'wait':
            break;
    }

    return decision;
}
