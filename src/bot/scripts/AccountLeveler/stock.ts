import { stockCounts, type CountedItem } from './supplies.js';

export class LevelerStock {
    ready = false;
    private bank: Record<string, number> = {};

    observe(items: readonly CountedItem[], ready: boolean): void {
        if (!ready) return;
        this.bank = stockCounts(items);
        this.ready = true;
    }

    total(carried: readonly CountedItem[]): Record<string, number> {
        const result = { ...this.bank };
        for (const [key, count] of Object.entries(stockCounts(carried))) result[key] = (result[key] ?? 0) + count;
        return result;
    }

    invalidate(): void {
        this.ready = false;
        this.bank = {};
    }
}
