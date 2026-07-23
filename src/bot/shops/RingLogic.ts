import { unitPrice } from '#/bot/shops/StockModel.js';
import type { AccountView, Route, RouteCluster, ShopRecord } from '#/bot/shops/types.js';

export function buyoutCostFromBaseline(rec: ShopRecord, obj: string): number {
    const item = rec.items.find(i => i.obj === obj);
    if (!item) {
        return 0;
    }
    let cost = 0;
    for (let stock = item.baseline; stock > 0; stock--) {
        cost += unitPrice(item, { sell: rec.sell, delta: rec.delta }, stock);
    }
    return cost;
}

export function estimateClusterGp(cluster: RouteCluster, db: Record<string, ShopRecord>, chosen: ReadonlySet<string>): number {
    let total = 0;
    for (const shop of cluster.shops) {
        const rec = db[shop.shopId];
        if (!rec) {
            continue;
        }
        for (const buy of shop.buys) {
            const item = rec.items.find(i => i.obj === buy.obj);
            if (item && chosen.has(item.name.toLowerCase())) {
                total += buyoutCostFromBaseline(rec, buy.obj);
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

export function nextCluster(route: Route, lastId: string | null, acct: AccountView, toggles: Record<string, boolean>): RouteCluster | null {
    const ids = route.ring;
    const start = lastId === null ? 0 : (ids.indexOf(lastId) + 1) % ids.length;
    for (let i = 0; i < ids.length; i++) {
        const cluster = route.clusters.find(c => c.id === ids[(start + i) % ids.length]);
        if (cluster && clusterEligible(cluster, acct, toggles)) {
            return cluster;
        }
    }
    return null;
}
