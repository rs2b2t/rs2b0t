/**
 * Pure logic for the DUMB shop ring (the planner's replacement): which cluster
 * is next, is it enterable, and how much gp its full buyout needs. No stock
 * prediction — estimates assume BASELINE stock (the worst-case wallet for a
 * full shop) and the live buy leg simply buys what's actually there.
 */
import { unitPrice } from '#/bot/shops/StockModel.js';
import type { AccountView, Route, RouteCluster, ShopRecord } from '#/bot/shops/types.js';

/** Gp to buy out `units` of one item starting from baseline stock, walking the
 *  engine's price curve (price rises as stock falls). */
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

/** Full-buyout gp estimate for every listed item across a cluster's shops,
 *  restricted to the chosen (lowercased) display names. */
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

/** The coin withdrawal for a cluster: estimate + buffer, capped. */
export function withdrawFor(estimate: number, bufferPct: number, maxGpPerLeg: number): number {
    return Math.min(maxGpPerLeg, Math.ceil(estimate * (1 + bufferPct / 100)));
}

/** Every gate passes AND the cluster's toggle (if any) is on. */
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

/** The next ELIGIBLE cluster after `lastId` in ring order (wrapping), or null
 *  when nothing on the ring is enterable. */
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
