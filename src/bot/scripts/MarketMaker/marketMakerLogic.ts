import type { SellIntent } from '../../api/market/appraise.js';

/** A chat request naming what the customer wants to buy. Carries no price and no reservation. */
export interface Intent extends SellIntent {
    customer: string;
    askedAtMs: number;
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
    /** Set the moment the bot accepts, and checked again on the confirm screen. */
    accepted: { give: Map<number, number>; get: Map<number, number> } | null;
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

    pruneIntents(nowMs: number, ttlMs: number): void {
        for (const [k, i] of this.intents) {
            if (nowMs - i.askedAtMs > ttlMs) {
                this.intents.delete(k);
            }
        }
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

    // ---- the window ----

    open(customer: string, nowMs: number): Window {
        this.window = { customer, openedAtMs: nowMs, stillBeats: 0, reOffers: 0, lastSig: '', accepted: null };
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
