export type EngagementKind = 'buy' | 'sell';

export interface Engagement {
    customer: string;
    kind: EngagementKind;
    /** unnoted id -> units the bot puts up. */
    give: Map<number, number>;
    /** unnoted id -> units the customer must put up. */
    get: Map<number, number>;
    quotedAtMs: number;
    opened: boolean;
}

/** Bank once free slots drop this low, so a buy always has room to land. */
export const FREE_SLOT_FLOOR = 4;

function same(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * One customer served at a time, the rest FIFO.
 * Why: the trade modal is exclusive and movement cancels it, so a second engagement in flight would lose both.
 */
export class Queue {
    private line: Engagement[] = [];

    constructor(private readonly cap: number) {}

    enqueue(customer: string, e: Engagement): 'engaged' | 'queued' | 'full' | 'requoted' {
        const i = this.line.findIndex(x => same(x.customer, customer));
        if (i !== -1) {
            this.line[i] = e;
            return 'requoted';
        }
        if (this.line.length >= this.cap) {
            return 'full';
        }
        this.line.push(e);
        return this.line.length === 1 ? 'engaged' : 'queued';
    }

    current(): Engagement | null {
        return this.line[0] ?? null;
    }

    markOpened(customer: string): void {
        const e = this.line.find(x => same(x.customer, customer));
        if (e) {
            e.opened = true;
        }
    }

    finish(customer: string): void {
        this.line = this.line.filter(x => !same(x.customer, customer));
    }

    expire(nowMs: number, ttlMs: number): string[] {
        const stale = this.line.filter(x => nowMs - x.quotedAtMs > ttlMs);
        this.line = this.line.filter(x => nowMs - x.quotedAtMs <= ttlMs);
        return stale.map(x => x.customer);
    }

    waiting(): string[] {
        return this.line.slice(1).map(x => x.customer);
    }

    size(): number {
        return this.line.length;
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
