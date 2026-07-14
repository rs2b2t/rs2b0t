/**
 * Pure allocation for the single-shop buyout bot: given the OPEN shop's live
 * stock and the coins in the pack, decide how many of each chosen item to
 * buy. Valuable-first (descending item cost) so a bounded budget captures
 * law/death/nature before elementals — the same priority principle the
 * ShopRunner route learned the hard way. Prices ride the engine curve
 * (StockModel.unitPrice: price rises as stock falls, 6× cap).
 */
import { unitPrice } from '#/bot/shops/StockModel.js';
import type { ShopRecord } from '#/bot/shops/types.js';

export interface BuyoutItem {
    obj: string;
    name: string;
    units: number;
    estCost: number;
}

/** `stock` is keyed by content obj id (the caller maps live display names
 *  through the shop record); `chosen` holds lowercase display names. */
export function buyoutPlan(rec: ShopRecord, stock: Record<string, number>, coins: number, chosen: ReadonlySet<string>): BuyoutItem[] {
    const wants = rec.items
        .filter(i => chosen.has(i.name.toLowerCase()) && (stock[i.obj] ?? 0) > 0)
        .sort((a, b) => b.cost - a.cost);

    let left = coins;
    const plan: BuyoutItem[] = [];
    for (const item of wants) {
        const have = stock[item.obj] ?? 0;
        let units = 0;
        let estCost = 0;
        while (units < have) {
            const next = unitPrice(item, { sell: rec.sell, delta: rec.delta }, have - units);
            if (estCost + next > left) {
                break;
            }
            estCost += next;
            units += 1;
        }
        left -= estCost;
        if (units > 0) {
            plan.push({ obj: item.obj, name: item.name, units, estCost });
        }
    }
    return plan;
}
