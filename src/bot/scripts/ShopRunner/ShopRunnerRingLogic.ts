import { unitPrice } from '#/bot/api/shop/StockModel.js';
import type { AccountView, Route, RouteCluster, ShopItemDef, ShopRecord } from '#/bot/api/shop/types.js';

export function chosenShopItem(rec: ShopRecord, obj: string, chosen: ReadonlySet<string>): ShopItemDef | undefined {
    const item = rec.items.find(i => i.obj === obj);
    return item && chosen.has(item.name.toLowerCase()) ? item : undefined;
}

function itemBuyoutCost(rec: ShopRecord, item: ShopItemDef): number {
    let cost = 0;
    for (let stock = item.baseline; stock > 0; stock--) {
        cost += unitPrice(item, { sell: rec.sell, delta: rec.delta }, stock);
    }
    return cost;
}

export function buyoutCostFromBaseline(rec: ShopRecord, obj: string): number {
    const item = rec.items.find(i => i.obj === obj);
    return item ? itemBuyoutCost(rec, item) : 0;
}

export function estimateClusterGp(cluster: RouteCluster, db: Record<string, ShopRecord>, chosen: ReadonlySet<string>): number {
    let total = 0;
    for (const shop of cluster.shops) {
        const rec = db[shop.shopId];
        if (!rec) {
            continue;
        }
        for (const buy of shop.buys) {
            const item = chosenShopItem(rec, buy.obj, chosen);
            if (item) {
                total += itemBuyoutCost(rec, item);
            }
        }
    }
    return total;
}

export function withdrawFor(estimate: number, bufferPct: number, maxGpPerLeg: number): number {
    return Math.min(maxGpPerLeg, Math.ceil(estimate * (1 + bufferPct / 100)));
}

export function clusterEligible(cluster: RouteCluster, acct: AccountView, toggles: Record<string, boolean>): boolean {
    if (cluster.setting !== undefined && toggles[cluster.setting] !== true) {
        return false;
    }
    for (const gate of cluster.gates) {
        if (gate.qp !== undefined && acct.qp < gate.qp) {
            return false;
        }
        if (gate.quest !== undefined && acct.quests[gate.quest] !== true) {
            return false;
        }
        if (gate.skill !== undefined && (acct.skills[gate.skill.name] ?? 1) < gate.skill.level) {
            return false;
        }
    }
    return true;
}

/** Why: Mage Arena (and every other stop) was still walked when the selection was only vials. */
export function clusterSellsChosen(cluster: RouteCluster, db: Record<string, ShopRecord>, chosen: ReadonlySet<string>): boolean {
    for (const shop of cluster.shops) {
        const rec = db[shop.shopId];
        if (!rec) {
            continue;
        }
        for (const buy of shop.buys) {
            if (chosenShopItem(rec, buy.obj, chosen)) {
                return true;
            }
        }
    }
    return false;
}

export function nextCluster(
    route: Route,
    lastId: string | null,
    acct: AccountView,
    toggles: Record<string, boolean>,
    chosen: ReadonlySet<string>,
    db: Record<string, ShopRecord>
): RouteCluster | null {
    const ids = route.ring;
    const start = lastId === null ? 0 : (ids.indexOf(lastId) + 1) % ids.length;
    for (let i = 0; i < ids.length; i++) {
        const cluster = route.clusters.find(c => c.id === ids[(start + i) % ids.length]);
        if (cluster && clusterEligible(cluster, acct, toggles) && clusterSellsChosen(cluster, db, chosen)) {
            return cluster;
        }
    }
    return null;
}
