/**
 * Pure planning over the shop DB + curated route (client-free; callers pass
 * nowMs). Budgets follow the spec: withdraw ≈ estCost × 1.25 rounded up to
 * 1k, hard-capped at maxGpPerLeg; when the cap binds, planned units are
 * trimmed greedily in buys[] priority order (haulFraction stays pre-trim —
 * it measures stock availability, not affordability).
 */
import { expectedStock, unitPrice, unitsUnderPolicy } from '#/bot/shops/StockModel.js';
import type { AccountView, BuyPolicy, NavPointLike, Route, RouteCluster, SeenMap, ShopItemDef, ShopRecord } from '#/bot/shops/types.js';

export const BUDGET_BUFFER = 1.25;

export interface PlannerCfg {
    defaultPolicy: BuyPolicy;
    haulThresholdPct: number;
    maxGpPerLeg: number;
}

export interface BuyPlanItem { obj: string; name: string; units: number; estCost: number }
export interface ShopPlan { shopId: string; keeperNpc: string; stand: NavPointLike; items: BuyPlanItem[] }
export interface ClusterPlan {
    clusterId: string;
    shops: ShopPlan[];
    totalUnits: number;    // post-trim planned units
    maxUnits: number;      // units if every item sat at baseline (under policy)
    haulFraction: number;  // pre-trim available units / maxUnits
    estCost: number;       // post-trim
    budget: number;        // gp to withdraw for this cluster
}

export function clusterEligible(cluster: RouteCluster, acct: AccountView): boolean {
    return cluster.gates.every(g => {
        if (g.members && !acct.members) { return false; }
        if (g.skill && (acct.skills[g.skill.name] ?? 0) < g.skill.level) { return false; }
        if (g.quest && !acct.quests[g.quest]) { return false; }
        if (g.qp !== undefined && acct.qp < g.qp) { return false; }
        return true;
    });
}

export function cheapestUnmetGate(route: Route, acct: AccountView): string {
    const unmet: string[] = [];
    for (const c of route.clusters) {
        for (const g of c.gates) {
            if (g.members && !acct.members) { unmet.push('members world'); }
            if (g.skill && (acct.skills[g.skill.name] ?? 0) < g.skill.level) { unmet.push(`${g.skill.name} ${g.skill.level}`); }
            if (g.quest && !acct.quests[g.quest]) { unmet.push(`quest ${g.quest}`); }
            if (g.qp !== undefined && acct.qp < g.qp) { unmet.push(`${g.qp} quest points`); }
        }
    }
    return unmet[0] ?? 'none';
}

export function planCluster(
    cluster: RouteCluster,
    db: Record<string, ShopRecord>,
    seen: SeenMap,
    nowMs: number,
    cfg: PlannerCfg,
    cooldowns: Record<string, number>
): ClusterPlan {
    interface Want { shopId: string; keeperNpc: string; stand: NavPointLike; obj: string; name: string; available: number; expected: number; item: ShopItemDef; shop: { sell: number; delta: number } }
    const wants: Want[] = [];
    let maxUnits = 0;
    let availableUnits = 0;
    for (const shop of cluster.shops) {
        const rec = db[shop.shopId];
        if (!rec || (cooldowns[shop.shopId] ?? 0) > nowMs) {
            continue;
        }
        for (const buy of shop.buys) {
            const item = rec.items.find(i => i.obj === buy.obj);
            if (!item || item.baseline === 0) {
                continue; // baseline-0 items never restock; not plannable
            }
            const policy = buy.policy ?? cfg.defaultPolicy;
            const expected = expectedStock(item, seen[shop.shopId]?.[buy.obj], nowMs);
            const available = unitsUnderPolicy(policy, expected, item.baseline);
            maxUnits += unitsUnderPolicy(policy, item.baseline, item.baseline);
            availableUnits += available;
            wants.push({ shopId: shop.shopId, keeperNpc: shop.keeperNpc, stand: shop.stand, obj: buy.obj, name: item.name, available, expected, item, shop: { sell: rec.sell, delta: rec.delta } });
        }
    }

    // greedy allocation in buys[] priority order under the spend cap
    const spendCap = cfg.maxGpPerLeg / BUDGET_BUFFER;
    let spent = 0;
    const allocated = wants.map(w => {
        let units = 0;
        let cost = 0;
        while (units < w.available) {
            const next = unitPrice(w.item, w.shop, w.expected - units);
            if (spent + cost + next > spendCap) {
                break;
            }
            cost += next;
            units += 1;
        }
        spent += cost;
        return { ...w, units, estCost: cost };
    });

    const shops: ShopPlan[] = cluster.shops
        .map(s => ({
            shopId: s.shopId,
            keeperNpc: s.keeperNpc,
            stand: s.stand,
            items: allocated.filter(a => a.shopId === s.shopId).map(a => ({ obj: a.obj, name: a.name, units: a.units, estCost: a.estCost }))
        }))
        .filter(s => s.items.some(i => i.units > 0));

    const estCost = allocated.reduce((sum, a) => sum + a.estCost, 0);
    const totalUnits = allocated.reduce((sum, a) => sum + a.units, 0);
    const budget = Math.min(cfg.maxGpPerLeg, Math.ceil((estCost * BUDGET_BUFFER) / 1000) * 1000);
    return {
        clusterId: cluster.id,
        shops,
        totalUnits,
        maxUnits,
        haulFraction: maxUnits === 0 ? 0 : availableUnits / maxUnits,
        estCost,
        budget
    };
}
