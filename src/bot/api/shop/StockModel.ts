import { shopBuyPrice } from '#/bot/api/shop/shopPrice.js';
import type { BuyPolicy, Seen, ShopItemDef } from '#/bot/api/shop/types.js';

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
    return shopBuyPrice(item.cost, item.baseline - stock, shop.sell, shop.delta);
}

export function unitsUnderPolicy(policy: BuyPolicy, stock: number, baseline: number): number {
    if (policy.kind === 'buyout') {
        return Math.max(0, stock);
    }
    const floorCount = Math.ceil((policy.pct / 100) * baseline);
    return Math.max(0, stock - floorCount);
}
