export type EngagementKind = 'buy' | 'sell';

/** An indicative price, not a promise and not a place in line. */
// Why: the price is re-derived when the customer turns up, so a quote against a mispriced row cannot be banked and redeemed after the row is fixed.
export interface Quote {
    customer: string;
    /** 'sell' means the bot sells. */
    kind: EngagementKind;
    /** Unnoted obj id. */
    itemId: number;
    qty: number;
    unitPrice: number;
    quotedAtMs: number;
}

/** The one transaction in flight. */
export interface Engagement {
    customer: string;
    kind: EngagementKind;
    give: Map<number, number>;
    get: Map<number, number>;
    startedAtMs: number;
    opened: boolean;
}

/** Bank once free slots drop this low, so a purchase always has room to land. */
export const FREE_SLOT_FLOOR = 4;

function key(name: string): string {
    return name.trim().toLowerCase();
}

/** Live quotes, cooldowns, and the single customer being served. There is no queue. */
// Why: a list of who is next can be camped or filled with throwaway names, so the race is settled by whoever opens a trade first and by the engine turning the rest away.
export class Desk {
    private quotes = new Map<string, Quote>();
    private cooldowns = new Map<string, number>();
    private serving: Engagement | null = null;

    constructor(private readonly quoteCap: number) {}

    // ---- quotes ----

    quote(q: Quote): void {
        const k = key(q.customer);
        this.quotes.delete(k);
        this.quotes.set(k, q);
        // Map preserves insertion order, so the first key is the oldest quote.
        while (this.quotes.size > this.quoteCap) {
            const oldest = this.quotes.keys().next().value;
            if (oldest === undefined) {
                break;
            }
            this.quotes.delete(oldest);
        }
    }

    liveQuote(customer: string, nowMs: number, ttlMs: number): Quote | null {
        const q = this.quotes.get(key(customer));
        if (!q || nowMs - q.quotedAtMs > ttlMs) {
            return null;
        }
        return q;
    }

    dropQuote(customer: string): void {
        this.quotes.delete(key(customer));
    }

    prune(nowMs: number, ttlMs: number): void {
        for (const [k, q] of this.quotes) {
            if (nowMs - q.quotedAtMs > ttlMs) {
                this.quotes.delete(k);
            }
        }
    }

    quoteCount(): number {
        return this.quotes.size;
    }

    // ---- the one transaction ----

    current(): Engagement | null {
        return this.serving;
    }

    startServing(e: Engagement): void {
        this.serving = e;
    }

    markOpened(): void {
        if (this.serving) {
            this.serving.opened = true;
        }
    }

    finishServing(): void {
        this.serving = null;
    }

    /** The served engagement once it has run past the window, so the caller can drop and cool it. */
    staleServing(nowMs: number, windowMs: number): Engagement | null {
        if (!this.serving || nowMs - this.serving.startedAtMs <= windowMs) {
            return null;
        }
        return this.serving;
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

export function advertiseDue(lastMs: number, nowMs: number, everySeconds: number): boolean {
    return everySeconds > 0 && nowMs - lastMs >= everySeconds * 1000;
}

export function shouldRestock(need: ReadonlyMap<number, number>, inPack: (id: number) => number): boolean {
    for (const [id, qty] of need) {
        if (inPack(id) < qty) {
            return true;
        }
    }
    return false;
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
