import { describe, expect, test } from 'bun:test';
import { clusterEligible, planCluster, type PlannerCfg } from '#/bot/shops/Planner.js';
import type { AccountView, RouteCluster, SeenMap, ShopRecord } from '#/bot/shops/types.js';

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
        expect(plan.estCost).toBeLessThanOrEqual(CFG.maxGpPerLeg / 1.25);
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
        expect(plan.estCost).toBeLessThanOrEqual(5000 / 1.25);
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
