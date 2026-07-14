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

interface BuyPlanItem { obj: string; name: string; units: number; estCost: number }
interface ShopPlan { shopId: string; keeperNpc: string; stand: NavPointLike; items: BuyPlanItem[] }
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

type Decision =
    | { kind: 'buy'; clusterId: string; shop: ShopPlan }
    | { kind: 'bank'; clusterId: string; stand: NavPointLike; boothName: string; boothOp: string; withdrawFor: ClusterPlan | null }
    | { kind: 'idle'; stand: NavPointLike; boothName: string; boothOp: string; untilMs: number; bestClusterId: string | null; bestFractionPct: number };

export interface RuntimeState {
    pos: NavPointLike | null;
    gpHeld: number;
    carryingPurchases: boolean;
    fundedPlan: ClusterPlan | null;
    visited: string[];          // shopIds bought (or skipped) within fundedPlan
    lastClusterId: string | null;
}

export interface PlanOutcome {
    decision: Decision;
    skipped: { clusterId: string; fractionPct: number }[];
}

function cheb(a: NavPointLike, b: NavPointLike): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function nearestBank(route: Route, pos: NavPointLike | null): RouteCluster {
    if (!pos) {
        return route.clusters[0];
    }
    return [...route.clusters].sort((a, b) => cheb(a.bank.stand, pos) - cheb(b.bank.stand, pos))[0];
}

function nextInRing(route: Route, qualifying: Map<string, ClusterPlan>, lastClusterId: string | null): ClusterPlan | null {
    const ring = route.ring;
    const start = lastClusterId ? (ring.indexOf(lastClusterId) + 1) % ring.length : 0;
    for (let i = 0; i < ring.length; i++) {
        const id = ring[(start + i) % ring.length];
        const plan = qualifying.get(id);
        if (plan) {
            return plan;
        }
    }
    return null;
}

export function decide(
    route: Route,
    db: Record<string, ShopRecord>,
    seen: SeenMap,
    nowMs: number,
    cfg: PlannerCfg,
    acct: AccountView,
    cooldowns: Record<string, number>,
    rt: RuntimeState
): PlanOutcome {
    const eligible = route.clusters.filter(c => clusterEligible(c, acct));
    const plans = new Map(eligible.map(c => [c.id, planCluster(c, db, seen, nowMs, cfg, cooldowns)]));
    const qualifying = new Map([...plans].filter(([, p]) => p.totalUnits > 0 && p.haulFraction * 100 >= cfg.haulThresholdPct));
    const skipped = [...plans.values()]
        .filter(p => !qualifying.has(p.clusterId))
        .map(p => ({ clusterId: p.clusterId, fractionPct: Math.round(p.haulFraction * 100) }));

    // mid-cluster: keep executing the funded plan
    if (rt.fundedPlan) {
        const next = rt.fundedPlan.shops.find(s => !rt.visited.includes(s.shopId) && (cooldowns[s.shopId] ?? 0) <= nowMs);
        if (next) {
            return { decision: { kind: 'buy', clusterId: rt.fundedPlan.clusterId, shop: next }, skipped };
        }
    }

    const target = nextInRing(route, qualifying, rt.fundedPlan?.clusterId ?? rt.lastClusterId);

    // done with a cluster (or holding stuff/gp for any other reason): bank —
    // deposit everything and fund the next target in the same visit.
    if (rt.fundedPlan || rt.carryingPurchases || rt.gpHeld > 0 || target) {
        const at = rt.fundedPlan
            ? route.clusters.find(c => c.id === rt.fundedPlan!.clusterId) ?? nearestBank(route, rt.pos)
            : nearestBank(route, rt.pos);
        return {
            decision: { kind: 'bank', clusterId: at.id, stand: at.bank.stand, boothName: at.bank.boothName, boothOp: at.bank.boothOp, withdrawFor: target },
            skipped
        };
    }

    // nothing to do: idle at the nearest bank until the model says otherwise
    const best = [...plans.values()].sort((a, b) => b.haulFraction - a.haulFraction)[0] ?? null;
    const at = nearestBank(route, rt.pos);
    return {
        decision: {
            kind: 'idle',
            stand: at.bank.stand,
            boothName: at.bank.boothName,
            boothOp: at.bank.boothOp,
            untilMs: earliestQualifyMs(route, db, seen, nowMs, cfg, acct, cooldowns),
            bestClusterId: best?.clusterId ?? null,
            bestFractionPct: Math.round((best?.haulFraction ?? 0) * 100)
        },
        skipped
    };
}

const QUALIFY_SCAN_STEP_MS = 60_000;
const QUALIFY_SCAN_HORIZON_MS = 8 * 60 * 60_000;
const QUALIFY_FALLBACK_MS = 30 * 60_000;

export function earliestQualifyMs(
    route: Route,
    db: Record<string, ShopRecord>,
    seen: SeenMap,
    nowMs: number,
    cfg: PlannerCfg,
    acct: AccountView,
    cooldowns: Record<string, number>
): number {
    const eligible = route.clusters.filter(c => clusterEligible(c, acct));
    for (let t = nowMs + QUALIFY_SCAN_STEP_MS; t <= nowMs + QUALIFY_SCAN_HORIZON_MS; t += QUALIFY_SCAN_STEP_MS) {
        for (const c of eligible) {
            const p = planCluster(c, db, seen, t, cfg, cooldowns);
            if (p.totalUnits > 0 && p.haulFraction * 100 >= cfg.haulThresholdPct) {
                return t;
            }
        }
    }
    return nowMs + QUALIFY_FALLBACK_MS;
}
