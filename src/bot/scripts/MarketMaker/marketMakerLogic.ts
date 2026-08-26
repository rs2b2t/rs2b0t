import type { SellIntent } from '../../api/market/appraise.js';
import { resolveByName, type Catalog } from '../../api/market/catalog.js';
import { rowOf, type PriceBook } from '../../api/market/priceBook.js';
import { rowValid } from '../../api/market/prices.js';

/** A chat request naming what the customer wants to buy. Carries no price and no reservation. */
export interface Intent extends SellIntent {
    customer: string;
    askedAtMs: number;
    /** Set once the clock has been restarted, so a request cannot be kept alive for ever. */
    renewed?: boolean;
    /** Bank trips that came back with none of it. */
    misses?: number;
}

/** The window in flight. Everything here dies with the window. */
export interface Window {
    customer: string;
    openedAtMs: number;
    /** Consecutive beats where the customer's side has not moved. */
    stillBeats: number;
    /** How many times the bot has changed its own side. */
    reOffers: number;
    /** Signature of the customer's side last beat. */
    lastSig: string;
    /** True once the modal has been seen open on this client. */
    sawOpen: boolean;
    /** Set the moment the bot accepts, and checked again on the confirm screen. */
    accepted: { give: Map<number, number>; get: Map<number, number> } | null;
    /** Consecutive beats spent waiting on the customer to put their side up. */
    waited: number;
}

/** Bank once free slots drop this low, so a purchase always has room to land. */
export const FREE_SLOT_FLOOR = 4;

function key(name: string): string {
    return name.trim().toLowerCase();
}

/** Chat intents, cooldowns, and the one open window. */
// Why: there is no queue and no quote. The engine allows one window per player, so the server is the mutex and the window is the transaction.
export class Desk {
    private intents = new Map<string, Intent>();
    private cooldowns = new Map<string, number>();
    private window: Window | null = null;

    constructor(private readonly intentCap: number) {}

    // ---- intents ----

    remember(intent: Intent): void {
        const k = key(intent.customer);
        this.intents.delete(k);
        this.intents.set(k, intent);
        while (this.intents.size > this.intentCap) {
            const oldest = this.intents.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.intents.delete(oldest);
        }
    }

    intentFor(customer: string, nowMs: number, ttlMs: number): Intent | null {
        const i = this.intents.get(key(customer));
        if (!i || nowMs - i.askedAtMs > ttlMs) {
            return null;
        }
        return i;
    }

    forget(customer: string): void {
        this.intents.delete(key(customer));
    }

    /** Restart an intent's clock, for the moment the customer is told the goods are ready. */
    // Why: the wait for a bank trip and a free window is dead time the customer cannot control, and charging it against the intent loses the request they already paid attention to.
    renew(customer: string, nowMs: number): void {
        const i = this.intents.get(key(customer));
        // Why: renewing every time the shop re-announces lets a request that never settles block the customer's every later trade, so the clock restarts once and then runs out.
        if (i && i.renewed !== true) {
            i.askedAtMs = nowMs;
            i.renewed = true;
        }
    }

    pruneIntents(nowMs: number, ttlMs: number): void {
        for (const [k, i] of this.intents) {
            if (nowMs - i.askedAtMs > ttlMs) {
                this.intents.delete(k);
            }
        }
    }

    /** Cut an order down to what the shop managed to get, so it stops trying to top it up. */
    // Why: an order it can never fill keeps Restock firing for ever, and Restock at the bank is what stops the
    // Why: shop banking at all, so the order has to become satisfiable rather than stay outstanding.
    limitTo(customer: string, qty: number): void {
        const i = this.intents.get(key(customer));
        if (i && qty > 0 && qty < i.maxQty) {
            i.maxQty = qty;
        }
    }

    /** Count a bank trip that fetched none of it, and say whether to give up on the order. */
    // Why: the next fetch is always the oldest live intent, so an order that cannot be filled blocks every customer behind it until it is dropped.
    missedStock(customer: string, limit: number): boolean {
        const i = this.intents.get(key(customer));
        if (!i) {
            return false;
        }
        i.misses = (i.misses ?? 0) + 1;
        return i.misses >= limit;
    }

    /** The oldest live intent, which is whose goods the bot fetches next. */
    nextIntent(nowMs: number, ttlMs: number): Intent | null {
        for (const i of this.intents.values()) {
            if (nowMs - i.askedAtMs <= ttlMs) {
                return i;
            }
        }
        return null;
    }

    intentCount(): number {
        return this.intents.size;
    }

    /** Drop everything the desk is holding: what was asked for, who is waiting out a cooldown, and the window. */
    // Why: a desk that has got itself into a state nobody can trade through needs one way back to empty.
    clear(): void {
        this.intents.clear();
        this.cooldowns.clear();
        this.window = null;
    }

    // ---- the window ----

    open(customer: string, nowMs: number): Window {
        this.window = { customer, openedAtMs: nowMs, stillBeats: 0, reOffers: 0, lastSig: '', sawOpen: false, accepted: null, waited: 0 };
        return this.window;
    }

    current(): Window | null {
        return this.window;
    }

    close(): void {
        this.window = null;
    }

    /** True once the window has run past its deadline. */
    expired(nowMs: number, windowMs: number): boolean {
        return this.window !== null && nowMs - this.window.openedAtMs > windowMs;
    }

    // ---- cooldowns ----

    cool(customer: string, untilMs: number): void {
        this.cooldowns.set(key(customer), untilMs);
    }

    onCooldown(customer: string, nowMs: number): boolean {
        const until = this.cooldowns.get(key(customer));
        if (until === undefined) {
            return false;
        }
        if (nowMs > until) {
            this.cooldowns.delete(key(customer));
            return false;
        }
        return true;
    }
}

/** How the beat should move, given what the window looks like now. */
export type Beat =
    | { do: 'offer'; reason: string }
    | { do: 'wait'; reason: string }
    | { do: 'accept' }
    | { do: 'give-up'; reason: string };

/** One beat of an open window, as a pure decision. */
// Why: the bot only acts on a side that has stopped moving. Any change resets both accepts, so a bot that answers every twitch never lets the trade settle.
export function decideBeat(input: {
    theirSig: string;
    window: Window;
    oweMatched: boolean;
    wantMatched: boolean;
    oweAnything: boolean;
    stillBeatsNeeded: number;
    reOfferCap: number;
    /** Beats of waiting on them before the window is given back. */
    waitCap: number;
}): Beat {
    const beat = beatFor(input);
    // Why: the shop serves one window at a time, so a customer sitting on an open one costs every customer
    // Why: behind them. Waiting is capped, and the deadline stays as the backstop for a trade still moving.
    if (beat.do === 'wait' && input.window.waited >= input.waitCap) {
        return { do: 'give-up', reason: 'you left your side up too long' };
    }
    return beat;
}

function beatFor(input: {
    theirSig: string;
    window: Window;
    oweMatched: boolean;
    wantMatched: boolean;
    oweAnything: boolean;
    stillBeatsNeeded: number;
    reOfferCap: number;
}): Beat {
    if (input.theirSig !== input.window.lastSig) {
        return { do: 'wait', reason: 'their side moved' };
    }
    if (input.window.stillBeats < input.stillBeatsNeeded) {
        return { do: 'wait', reason: 'settling' };
    }
    if (!input.oweAnything) {
        return { do: 'wait', reason: 'nothing to trade yet' };
    }
    if (!input.oweMatched) {
        return input.window.reOffers >= input.reOfferCap
            ? { do: 'give-up', reason: 'too many changes in one trade' }
            : { do: 'offer', reason: 'my side does not match what I owe' };
    }
    // Why: a sale is x * y = z, so short money is not a smaller deal, it is not the deal.
    if (!input.wantMatched) {
        return { do: 'wait', reason: 'their side is not the deal yet' };
    }
    return { do: 'accept' };
}

/** Stable signature of a trade side, so "unchanged" is decidable. */
export function sideSignature(side: ReadonlyMap<number, number>): string {
    return [...side].sort((a, b) => a[0] - b[0]).map(([id, n]) => `${id}x${n}`).join(',');
}

export function advertiseDue(lastMs: number, nowMs: number, everySeconds: number): boolean {
    return everySeconds > 0 && nowMs - lastMs >= everySeconds * 1000;
}

export function shouldSettle(freeSlots: number, packCoins: number, coinFloor: number): boolean {
    return freeSlots <= FREE_SLOT_FLOOR || packCoins > coinFloor;
}

/** New chat lines since the last read, oldest-first. Both arrays are signatures, newest-first. */
// Why: marking the place with only the newest signature loses a verbatim repeat, since the mark and the new line look identical, so a customer who says the same thing twice is heard once.
export function freshChatLines(prev: readonly string[], now: readonly string[]): string[] {
    if (prev.length === 0 || now.length === 0) {
        return [];
    }

    for (let shift = 0; shift < now.length; shift++) {
        let aligned = true;
        for (let i = 0; i < prev.length && shift + i < now.length; i++) {
            if (now[shift + i] !== prev[i]) {
                aligned = false;
                break;
            }
        }
        if (aligned) {
            return now.slice(0, shift).reverse();
        }
    }

    return [...now].reverse();
}

/** Per-player command budget. */
// Why: without one, fifty distinct item queries build a fifty-line outbound backlog and the shop visibly lags for everyone, at no cost to the flooder.
export class RateLimiter {
    private hits = new Map<string, number[]>();
    private penalised = new Map<string, number>();

    constructor(
        private readonly max: number,
        private readonly windowMs: number,
        private readonly penaltyMs: number
    ) {}

    allow(name: string, nowMs: number): boolean {
        const k = key(name);
        const until = this.penalised.get(k);
        if (until !== undefined) {
            if (nowMs <= until) {
                return false;
            }
            this.penalised.delete(k);
            this.hits.delete(k);
        }

        const recent = (this.hits.get(k) ?? []).filter(t => nowMs - t < this.windowMs);
        if (recent.length >= this.max) {
            this.penalised.set(k, nowMs + this.penaltyMs);
            this.hits.delete(k);
            return false;
        }

        recent.push(nowMs);
        this.hits.set(k, recent);
        return true;
    }
}

/** What a quote request names, before any reply is composed. */
export type QuoteTarget =
    | { kind: 'miss'; answer: boolean }
    | { kind: 'ambiguous'; candidates: { id: number; name: string }[] }
    | { kind: 'hit'; id: number; name: string };

/** Resolve a customer's words against the side of the book they are asking about. */
// Why: an implied count means the line may be ordinary chat opening with "buy", so it has to name an item exactly, and a miss goes unanswered instead of quoting back at every passing sentence.
export function resolveQuote(input: {
    cat: Catalog;
    book: PriceBook;
    query: string;
    side: 'buying' | 'selling';
    qtyImplied: boolean;
}): QuoteTarget {
    const { cat, book, query, side, qtyImplied } = input;
    const candidates = resolveByName(cat, query, { exactOnly: qtyImplied }).filter(r => {
        const row = rowOf(book, r.id);
        return row !== null && row[side] && rowValid(book, row);
    });
    if (candidates.length === 0) {
        return { kind: 'miss', answer: !qtyImplied };
    }
    if (candidates.length > 1) {
        return { kind: 'ambiguous', candidates: candidates.map(c => ({ id: c.id, name: c.name })) };
    }
    return { kind: 'hit', id: candidates[0].id, name: candidates[0].name };
}


/** One settled trade, kept so the paint can show what the shop has been doing. */
export interface Deal {
    atMs: number;
    customer: string;
    /** Which way the goods went. */
    kind: 'sold' | 'bought';
    itemId: number;
    count: number;
    /** Coins the shop took in, or paid out as a negative. */
    gp: number;
    /** More than one kind of item changed hands, so the headline item is only part of it. */
    mixed: boolean;
}

/** Read a settled window back as one deal, keyed on which side the coins were on. */
// Why: the shop's own side carries the coins when it is buying, so the direction is decidable without tracking who opened the window.
export function dealOf(input: {
    give: ReadonlyMap<number, number>;
    get: ReadonlyMap<number, number>;
    coinId: number;
    customer: string;
    atMs: number;
}): Deal | null {
    const { give, get, coinId, customer, atMs } = input;
    const paid = give.get(coinId) ?? 0;
    const took = get.get(coinId) ?? 0;
    const goods = [...(paid > 0 ? get : give)].filter(([id]) => id !== coinId);
    if (goods.length === 0) {
        return null;
    }
    const headline = goods.reduce((big, one) => (one[1] > big[1] ? one : big));
    return {
        atMs,
        customer,
        kind: paid > 0 ? 'bought' : 'sold',
        itemId: headline[0],
        count: headline[1],
        gp: paid > 0 ? -paid : took,
        mixed: goods.length > 1
    };
}

/** What the deals add up to, for the line under the log. */
export function dealTotals(deals: readonly Deal[]): { count: number; net: number; sold: number; bought: number } {
    let net = 0;
    let sold = 0;
    let bought = 0;
    for (const d of deals) {
        net += d.gp;
        if (d.kind === 'sold') {
            sold++;
        } else {
            bought++;
        }
    }
    return { count: deals.length, net, sold, bought };
}

function pad(text: string, width: number): string {
    return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

function padStart(text: string, width: number): string {
    return text.length >= width ? text : ' '.repeat(width - text.length) + text;
}

/** One line of the deal log, in columns that line up down the list. */
export function dealLine(input: {
    clock: string;
    customer: string;
    kind: 'sold' | 'bought';
    count: number;
    item: string;
    gp: number;
    mixed: boolean;
}): string {
    const { clock, customer, kind, count, item, gp, mixed } = input;
    const arrow = kind === 'sold' ? '+' : '-';
    const what = `${padStart(count.toLocaleString('en-US'), 5)} ${item}${mixed ? ' +more' : ''}`;
    const money = `${gp >= 0 ? '+' : ''}${gp.toLocaleString('en-US')}`;
    return `${clock}  ${pad(customer, 12)} ${arrow} ${kind === 'sold' ? 'sold' : 'bght'} ${pad(what, 20)} ${padStart(money, 9)}`;
}

/** hh:mm:ss in the operator's own clock. */
export function clockOf(atMs: number): string {
    const d = new Date(atMs);
    return [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}
