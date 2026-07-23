import { unitPrice } from '#/bot/shops/StockModel.js';
import type { ShopRecord } from '#/bot/shops/types.js';

export interface BuyoutItem {
    obj: string;
    name: string;
    units: number;
    estCost: number;
}

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
