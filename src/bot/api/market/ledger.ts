export interface StockEntry {
    id: number;
    count: number;
}

/**
 * What the bank held at the last look, adjusted by trades since.
 * Why: the bank cannot be read while shut, and the per-item cap has to mean something between trips.
 */
export class Ledger {
    private stock = new Map<number, number>();

    setStock(entries: readonly StockEntry[]): void {
        this.stock = new Map();
        for (const e of entries) {
            this.stock.set(e.id, (this.stock.get(e.id) ?? 0) + e.count);
        }
    }

    held(id: number): number {
        return this.stock.get(id) ?? 0;
    }

    add(id: number, qty: number): void {
        this.stock.set(id, Math.max(0, this.held(id) + qty));
    }
}
