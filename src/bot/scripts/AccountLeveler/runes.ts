import { SHOP_DB } from '../../data/shopdb.js';
import { marketLotSize } from './marketLots.js';
import { purchaseBudget, supplyOffer } from './offers.js';
import { requirementKey, stockOf, type ActivityPlan, type LevelerSnapshot, type Requirement } from './types.js';

export const RUNE_TARGETS: Readonly<Record<string, number>> = {
    'Law rune': 1000, 'Nature rune': 1000, 'Fire rune': 1000, 'Earth rune': 1000, 'Water rune': 1000, 'Air rune': 10_000
};

interface RuneOrder {
    needs: Requirement[];
    budget: number;
    reserve: number;
    market?: Requirement & { id: number };
}

export function runeReserveOrder(s: LevelerSnapshot, queue: readonly ActivityPlan[], cooldowns: Record<string, number>): RuneOrder | null {
    if (!s.bankReady || cooldowns['rune-reserves'] > s.now) return null;
    const gold = stockOf(s, 'Coins');
    const needed = new Map<string, Requirement>();
    for (const plan of queue) for (const need of plan.needs) {
        const key = requirementKey(need);
        if (need.count > (needed.get(key)?.count ?? 0)) needed.set(key, need);
    }
    let committed = Math.max(200, needed.get('Coins')?.count ?? 0);
    for (const [key, need] of needed) {
        const short = need.count - stockOf(s, key);
        const offer = short > 0 && supplyOffer(need.item);
        if (offer) committed += purchaseBudget(offer, short);
    }
    const allowance = Math.floor(Math.max(0, gold - committed) / 4);
    if (!allowance) return null;
    const missing = Object.entries(RUNE_TARGETS).filter(([name, target]) =>
        stockOf(s, name) < target && !s.unavailableItems?.includes(name.toLowerCase()))
        .sort(([a, at], [b, bt]) => stockOf(s, a) / at - stockOf(s, b) / bt);
    const needs: Requirement[] = [];
    let shopItems = missing.filter(([item]) => supplyOffer(item)).length;
    let budget = 0;
    for (const [item, target] of missing) {
        const owned = stockOf(s, item);
        const offer = supplyOffer(item);
        if (!offer) {
            if (needs.length || cooldowns['rune-reserves:' + item] > s.now) continue;
            const count = marketLotSize(item, target - owned);
            const id = s.marketItem?.({ item, count });
            const unit = SHOP_DB.magicguildshop.items.find(entry => entry.name === item)?.cost;
            if (id !== undefined && unit && allowance >= unit * count) {
                return { needs: [], budget: allowance, reserve: gold - allowance, market: { item, id, count } };
            }
            continue;
        }
        const share = (allowance - budget) / shopItems;
        shopItems--;
        const count = Math.min(target - owned, 1000, Math.floor(share / purchaseBudget(offer, 1)));
        if (!count) continue;
        budget += purchaseBudget(offer, count);
        needs.push({ item, count: owned + count });
    }
    return needs.length ? { needs, budget, reserve: gold - budget } : null;
}

export function canStealChaos(s: LevelerSnapshot): boolean {
    return s.levels.thieving >= 70 && s.levels.hitpoints >= 30
        && ['attack', 'strength', 'defence'].every(skill => s.levels[skill] >= 20)
        && (s.stock.coins ?? 0) >= 200;
}
