import { reserveKey, keyTier } from './data.js';
import type { Stock } from './policy.js';

export function expeditionTier(stock: Stock): number {
    return Math.min(4, keyTier(reserveKey(stock) ?? -1) + 1);
}

export function huntBatch(target: number, remains: number, pyres: number, free: number, food: number, protectedCombat: boolean): number {
    if (!protectedCombat && food < 2) return 0;
    return Math.max(0, Math.min(target - remains, pyres - remains, free - 5));
}

export function burnBatch(remains: number, logs: number, notes: number, free: number): number {
    return Math.max(0, Math.min(remains, logs + Math.min(5, notes, Math.max(0, free - 2))));
}
