export interface StockEntry {
    id: number;
    count: number;
}

interface Hold {
    customer: string;
    id: number;
    qty: number;
    atMs: number;
}

export function roomUnderCap(cap: number, held: number, incoming: number): number {
    return Math.max(0, cap - held - incoming);
}

/**
 * What the bank holds, plus what has been promised to customers.
 * Why: the bank cannot be read while shut, so quoting works off the last open read minus live holds.
 */
export class Ledger {
    private stock = new Map<number, number>();
    private gp = 0;
    private holds: Hold[] = [];

    setStock(entries: readonly StockEntry[], coins: number): void {
        this.stock = new Map();
        for (const e of entries) {
            this.stock.set(e.id, (this.stock.get(e.id) ?? 0) + e.count);
        }
        this.gp = coins;
    }

    held(id: number): number {
        return this.stock.get(id) ?? 0;
    }

    coins(): number {
        return this.gp;
    }

    reserved(id: number): number {
        return this.holds.filter(h => h.id === id).reduce((s, h) => s + h.qty, 0);
    }

    available(id: number, inInventory: number): number {
        return Math.max(0, this.held(id) + inInventory - this.reserved(id));
    }

    // Why: backed by bank stock alone, so a pack that happens to hold the item cannot be promised twice.
    reserve(customer: string, id: number, qty: number, nowMs: number): boolean {
        if (qty <= 0) {
            return false;
        }
        const others = this.holds.filter(h => h.customer !== customer);
        const takenByOthers = others.filter(h => h.id === id).reduce((s, h) => s + h.qty, 0);
        if (this.held(id) - takenByOthers < qty) {
            return false;
        }
        this.holds = [...others, { customer, id, qty, atMs: nowMs }];
        return true;
    }

    release(customer: string): void {
        this.holds = this.holds.filter(h => h.customer !== customer);
    }

    /** Drops holds older than `ttlMs` and names the customers dropped. */
    expire(nowMs: number, ttlMs: number): string[] {
        const stale = this.holds.filter(h => nowMs - h.atMs > ttlMs);
        this.holds = this.holds.filter(h => nowMs - h.atMs <= ttlMs);
        return [...new Set(stale.map(h => h.customer))];
    }

    applyBought(id: number, qty: number): void {
        this.stock.set(id, this.held(id) + qty);
    }

    applySold(id: number, qty: number, gp: number): void {
        this.stock.set(id, Math.max(0, this.held(id) - qty));
        this.gp += gp;
    }

    spendable(inInventoryCoins: number): number {
        return this.gp + inInventoryCoins;
    }
}
