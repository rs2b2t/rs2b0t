import { describe, expect, test } from 'bun:test';
import { BUDGET_BUFFER, clusterEligible, decide, earliestQualifyMs, planCluster, type PlannerCfg, type RuntimeState } from '#/bot/shops/Planner.js';
import type { AccountView, Route, RouteCluster, SeenMap, ShopRecord } from '#/bot/shops/types.js';

const DB: Record<string, ShopRecord> = {
    runeshop: {
        inv: 'runeshop', title: 'T', keepers: ['Aubury'], sell: 1000, buy: 550, delta: 10, scope: 'shared', allstock: false,
        items: [
            { obj: 'mindrune', name: 'Mind rune', baseline: 1000, restockTicks: 10, cost: 3, stackable: true, members: false },
            { obj: 'deathrune', name: 'Death rune', baseline: 1000, restockTicks: 150, cost: 30, stackable: true, members: false }
        ]
    }
};

const CLUSTER: RouteCluster = {
    id: 'varrock',
    bank: { stand: { x: 3251, z: 3420, level: 0 }, boothName: 'Bank booth', boothOp: 'Use-quickly' },
    shops: [{
        shopId: 'runeshop', keeperNpc: 'Aubury', stand: { x: 3253, z: 3401, level: 0 },
        buys: [{ obj: 'mindrune' }, { obj: 'deathrune' }]
    }],
    gates: []
};

const CFG: PlannerCfg = { defaultPolicy: { kind: 'buyout' }, haulThresholdPct: 25, maxGpPerLeg: 100_000 };
const acct = (over: Partial<AccountView> = {}): AccountView => ({ members: true, qp: 0, quests: {}, skills: {}, ...over });

const ROUTE_FX: Route = { clusters: [CLUSTER], ring: ['varrock'] };
const rt = (over: Partial<RuntimeState> = {}): RuntimeState => ({
    pos: { x: 3200, z: 3400, level: 0 }, gpHeld: 0, carryingPurchases: false,
    fundedPlan: null, visited: [], lastClusterId: null, ...over
});

describe('clusterEligible', () => {
    const gated: RouteCluster = { ...CLUSTER, gates: [{ members: true }, { skill: { name: 'fishing', level: 68 } }, { quest: 'Shilo Village' }, { qp: 32 }] };
    test('all gates must pass', () => {
        expect(clusterEligible(gated, acct({ skills: { fishing: 68 }, quests: { 'Shilo Village': true }, qp: 32 }))).toBe(true);
    });
    test('any failing gate blocks: f2p world / low skill / missing quest / low qp', () => {
        expect(clusterEligible(gated, acct({ members: false, skills: { fishing: 68 }, quests: { 'Shilo Village': true }, qp: 32 }))).toBe(false);
        expect(clusterEligible(gated, acct({ skills: { fishing: 67 }, quests: { 'Shilo Village': true }, qp: 32 }))).toBe(false);
        expect(clusterEligible(gated, acct({ skills: { fishing: 68 }, qp: 32 }))).toBe(false);
        expect(clusterEligible(gated, acct({ skills: { fishing: 68 }, quests: { 'Shilo Village': true }, qp: 31 }))).toBe(false);
    });
    test('ungated cluster is always eligible', () => {
        expect(clusterEligible(CLUSTER, acct({ members: false }))).toBe(true);
    });
});

describe('planCluster', () => {
    // NOTE: a full death-rune buyout costs ~142k (price cap 6×30gp), so the
    // default 100k cap (spend cap 80k) ALWAYS trims death runes in these
    // fixtures. Use UNCAPPED where a test isolates policy math.
    const UNCAPPED: PlannerCfg = { ...CFG, maxGpPerLeg: 1_000_000 };

    test('unseen shop plans full baseline haul at fraction 1 (uncapped)', () => {
        const plan = planCluster(CLUSTER, DB, {}, 0, UNCAPPED, {});
        expect(plan.haulFraction).toBe(1);
        expect(plan.totalUnits).toBe(2000);
        const mind = plan.shops[0].items.find(i => i.obj === 'mindrune');
        expect(mind?.units).toBe(1000);
        expect(mind?.name).toBe('Mind rune');
        expect(plan.estCost).toBeGreaterThan(0);
        expect(plan.budget).toBeLessThanOrEqual(UNCAPPED.maxGpPerLeg);
    });
    test('default 100k cap trims the expensive tail (death runes) but not cheap items', () => {
        const plan = planCluster(CLUSTER, DB, {}, 0, CFG, {});
        const mind = plan.shops[0].items.find(i => i.obj === 'mindrune');
        const death = plan.shops[0].items.find(i => i.obj === 'deathrune');
        expect(mind?.units).toBe(1000);                    // ~10.6k — fits
        expect(death!.units).toBeGreaterThan(0);
        expect(death!.units).toBeLessThan(1000);           // trimmed by the cap
        expect(plan.estCost).toBeLessThanOrEqual(CFG.maxGpPerLeg / BUDGET_BUFFER);
        expect(plan.budget).toBe(CFG.maxGpPerLeg);
        expect(plan.haulFraction).toBe(1);                 // fraction is PRE-trim
    });
    test('freshly bought-out shop has fraction 0 (skipped)', () => {
        const seen: SeenMap = { runeshop: { mindrune: { count: 0, atMs: 0 }, deathrune: { count: 0, atMs: 0 } } };
        const plan = planCluster(CLUSTER, DB, seen, 0, CFG, {});
        expect(plan.totalUnits).toBe(0);
        expect(plan.haulFraction).toBe(0);
    });
    test('floor policy per-item override wins over cfg default (uncapped)', () => {
        const cluster: RouteCluster = { ...CLUSTER, shops: [{ ...CLUSTER.shops[0], buys: [{ obj: 'mindrune', policy: { kind: 'floor', pct: 50 } }, { obj: 'deathrune' }] }] };
        const plan = planCluster(cluster, DB, {}, 0, UNCAPPED, {});
        expect(plan.shops[0].items.find(i => i.obj === 'mindrune')?.units).toBe(500);
        expect(plan.shops[0].items.find(i => i.obj === 'deathrune')?.units).toBe(1000);
    });
    test('budget = round1k(estCost × 1.25) capped at maxGpPerLeg; cap trims later buys first', () => {
        const small: PlannerCfg = { ...CFG, maxGpPerLeg: 5000 };
        const plan = planCluster(CLUSTER, DB, {}, 0, small, {});
        expect(plan.budget).toBe(5000);
        // greedy in buys[] order: mindrune (3gp base) fills first, deathrune gets the remainder
        const mind = plan.shops[0].items.find(i => i.obj === 'mindrune');
        const death = plan.shops[0].items.find(i => i.obj === 'deathrune');
        expect(mind!.units).toBeGreaterThan(0);
        expect(death!.units).toBeLessThan(1000);
        expect(plan.estCost).toBeLessThanOrEqual(5000 / BUDGET_BUFFER);
        // haulFraction reflects PRE-trim availability (visit-worthiness), not the trim
        expect(plan.haulFraction).toBe(1);
    });
    test('budget rounds up to the next 1k', () => {
        // restrict to mindrune only, floor 99 → 10 units ≈ 30gp → budget 1000
        const cluster: RouteCluster = { ...CLUSTER, shops: [{ ...CLUSTER.shops[0], buys: [{ obj: 'mindrune', policy: { kind: 'floor', pct: 99 } }] }] };
        const plan = planCluster(cluster, DB, {}, 0, CFG, {});
        expect(plan.totalUnits).toBe(10);
        expect(plan.budget).toBe(1000);
    });
    test('cooled shop contributes nothing', () => {
        const plan = planCluster(CLUSTER, DB, {}, 0, CFG, { runeshop: 99_999 });
        expect(plan.totalUnits).toBe(0);
    });
    test('cooldown expiry restores the shop', () => {
        const plan = planCluster(CLUSTER, DB, {}, 100_000, UNCAPPED, { runeshop: 99_999 });
        expect(plan.totalUnits).toBe(2000);
    });
});

describe('decide', () => {
    test('cold start, cluster qualifies → bank at nearest route bank, funding it', () => {
        const { decision } = decide(ROUTE_FX, DB, {}, 0, CFG, acct(), {}, rt());
        expect(decision.kind).toBe('bank');
        if (decision.kind === 'bank') {
            expect(decision.withdrawFor?.clusterId).toBe('varrock');
            expect(decision.stand).toEqual(CLUSTER.bank.stand);
        }
    });
    test('funded with unvisited shop → buy that shop', () => {
        const plan = planCluster(CLUSTER, DB, {}, 0, CFG, {});
        const { decision } = decide(ROUTE_FX, DB, {}, 0, CFG, acct(), {}, rt({ fundedPlan: plan, gpHeld: plan.budget }));
        expect(decision.kind).toBe('buy');
        if (decision.kind === 'buy') {
            expect(decision.shop.shopId).toBe('runeshop');
        }
    });
    test('funded, all shops visited → bank (deposit), no re-fund when nothing qualifies', () => {
        const plan = planCluster(CLUSTER, DB, {}, 0, CFG, {});
        const seen: SeenMap = { runeshop: { mindrune: { count: 0, atMs: 0 }, deathrune: { count: 0, atMs: 0 } } };
        const { decision } = decide(ROUTE_FX, DB, seen, 0, CFG, acct(), {}, rt({ fundedPlan: plan, visited: ['runeshop'], carryingPurchases: true }));
        expect(decision.kind).toBe('bank');
        if (decision.kind === 'bank') {
            expect(decision.withdrawFor).toBe(null);
        }
    });
    test('nothing qualifies, empty-handed → idle with wake time and skip diagnostics', () => {
        const seen: SeenMap = { runeshop: { mindrune: { count: 0, atMs: 0 }, deathrune: { count: 0, atMs: 0 } } };
        const { decision, skipped } = decide(ROUTE_FX, DB, seen, 0, CFG, acct(), {}, rt());
        expect(decision.kind).toBe('idle');
        if (decision.kind === 'idle') {
            expect(decision.untilMs).toBeGreaterThan(0);
            expect(decision.bestClusterId).toBe('varrock');
        }
        expect(skipped).toEqual([{ clusterId: 'varrock', fractionPct: 0 }]);
    });
    test('ineligible cluster is invisible (no skip entry, no target)', () => {
        const gated: Route = { clusters: [{ ...CLUSTER, gates: [{ members: true }] }], ring: ['varrock'] };
        const { decision, skipped } = decide(gated, DB, {}, 0, CFG, acct({ members: false }), {}, rt());
        expect(decision.kind).toBe('idle');
        expect(skipped).toEqual([]);
    });
    test('carrying purchases with no funded plan → bank first (deposit), fund target in same visit', () => {
        const { decision } = decide(ROUTE_FX, DB, {}, 0, CFG, acct(), {}, rt({ carryingPurchases: true }));
        expect(decision.kind).toBe('bank');
        if (decision.kind === 'bank') {
            expect(decision.withdrawFor?.clusterId).toBe('varrock');
        }
    });
    test('ring rotation: next target starts after lastClusterId', () => {
        const c2: RouteCluster = { ...CLUSTER, id: 'portsarim', bank: { ...CLUSTER.bank, stand: { x: 3092, z: 3243, level: 0 } } };
        const two: Route = { clusters: [CLUSTER, c2], ring: ['varrock', 'portsarim'] };
        const { decision } = decide(two, DB, {}, 0, CFG, acct(), {}, rt({ lastClusterId: 'varrock' }));
        expect(decision.kind).toBe('bank');
        if (decision.kind === 'bank') {
            expect(decision.withdrawFor?.clusterId).toBe('portsarim');
        }
    });
});

describe('earliestQualifyMs', () => {
    test('death-rune-only shop bought out: 25% of 1000 = 250 units × 150 ticks × 600ms', () => {
        const deathOnly: RouteCluster = { ...CLUSTER, shops: [{ ...CLUSTER.shops[0], buys: [{ obj: 'deathrune' }] }] };
        const route: Route = { clusters: [deathOnly], ring: ['varrock'] };
        const seen: SeenMap = { runeshop: { deathrune: { count: 0, atMs: 0 } } };
        const wake = earliestQualifyMs(route, DB, seen, 0, CFG, acct(), {});
        const exact = 250 * 150 * 600;
        // minute-step scan: within one step above the exact crossing
        expect(wake).toBeGreaterThanOrEqual(exact - 60_000);
        expect(wake).toBeLessThanOrEqual(exact + 60_000);
    });
    test('nothing ever qualifies → 30min re-check fallback', () => {
        const gated: Route = { clusters: [{ ...CLUSTER, gates: [{ members: true }] }], ring: ['varrock'] };
        expect(earliestQualifyMs(gated, DB, {}, 0, CFG, acct({ members: false }), {})).toBe(30 * 60_000);
    });
});
