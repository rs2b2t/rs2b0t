import type { BuyPolicy, Seen, ShopItemDef } from '#/bot/shops/types.js';

export const TICK_MS = 600;

export function expectedStock(item: ShopItemDef, seen: Seen | undefined, nowMs: number): number {
    if (!seen) {
        return item.baseline;
    }
    const steps = Math.floor((nowMs - seen.atMs) / TICK_MS / item.restockTicks);
    if (seen.count < item.baseline) {
        return Math.min(item.baseline, seen.count + steps);
    }
    return Math.max(item.baseline, seen.count - steps);
}

export function unitPrice(item: ShopItemDef, shop: { sell: number; delta: number }, stock: number): number {
    const d = stock - item.baseline;
    const haggle = Math.min(1000, Math.max(-5000, d * shop.delta));
    const pct = Math.max(100, shop.sell - haggle);
    return Math.max(1, Math.floor((pct * item.cost) / 1000));
}

export function unitsUnderPolicy(policy: BuyPolicy, stock: number, baseline: number): number {
    if (policy.kind === 'buyout') {
        return Math.max(0, stock);
    }
    const floorCount = Math.ceil((policy.pct / 100) * baseline);
    return Math.max(0, stock - floorCount);
}
