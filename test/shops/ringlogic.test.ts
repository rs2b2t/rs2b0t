import { describe, expect, test } from 'bun:test';

import { buyoutCostFromBaseline, clusterEligible, estimateClusterGp, nextCluster, withdrawFor } from '#/bot/shops/RingLogic.js';
import { ROUTE } from '#/bot/shops/data/route.js';
import { SHOP_DB } from '#/bot/shops/data/shopdb.js';
import type { AccountView } from '#/bot/shops/types.js';

const acct = (skills: Record<string, number>): AccountView => ({ qp: 0, quests: {}, skills });
const ALL = new Set(Object.values(SHOP_DB).flatMap(r => r.items.map(i => i.name.toLowerCase())));

describe('clusterEligible', () => {
    const byId = new Map(ROUTE.clusters.map(c => [c.id, c]));
    test('skill gates skip under-levelled accounts', () => {
        expect(clusterEligible(byId.get('rangingguild')!, acct({ ranged: 39 }), {})).toBe(false);
        expect(clusterEligible(byId.get('rangingguild')!, acct({ ranged: 40 }), {})).toBe(true);
        expect(clusterEligible(byId.get('magicguild')!, acct({ magic: 65 }), {})).toBe(false);
        expect(clusterEligible(byId.get('magicguild')!, acct({ magic: 66 }), {})).toBe(true);
    });
    test('the mageArena toggle gates its cluster', () => {
        expect(clusterEligible(byId.get('magearena')!, acct({}), {})).toBe(false);
        expect(clusterEligible(byId.get('magearena')!, acct({}), { mageArena: false })).toBe(false);
        expect(clusterEligible(byId.get('magearena')!, acct({}), { mageArena: true })).toBe(true);
    });
});

describe('nextCluster', () => {
    test('advances the ring in order and wraps', () => {
        const a = acct({ fishing: 99, ranged: 99, magic: 99 });
        const t = { mageArena: true };
        expect(nextCluster(ROUTE, null, a, t)?.id).toBe('varrock');
        expect(nextCluster(ROUTE, 'varrock', a, t)?.id).toBe('portsarim');
        expect(nextCluster(ROUTE, 'magearena', a, t)?.id).toBe('varrock'); // wrap
    });
    test('skips ineligible clusters', () => {
        const fresh = acct({ fishing: 1, ranged: 1, magic: 1 });
        expect(nextCluster(ROUTE, 'catherby', fresh, {})?.id).toBe('varrock'); // guilds + arena all skipped
    });
});

describe('gp math', () => {
    test('withdrawFor applies buffer and cap', () => {
        expect(withdrawFor(1000, 25, 100_000)).toBe(1250);
        expect(withdrawFor(90_000, 25, 100_000)).toBe(100_000); // capped
        expect(withdrawFor(0, 25, 100_000)).toBe(0);
    });
    test('buyout cost rises as stock is drained (engine curve, > baseline*base-price... the curve premium)', () => {
        const rec = SHOP_DB['runeshop'];
        const item = rec.items.find(i => i.obj === 'deathrune')!;
        const cost = buyoutCostFromBaseline(rec, 'deathrune');
        expect(cost).toBeGreaterThan(0);
        // draining stock below baseline raises the unit price, so the total
        // must exceed a flat baseline*list-price floor at the shop's sell rate
        expect(cost).toBeGreaterThanOrEqual(item.baseline * Math.floor((Math.max(100, rec.sell) * item.cost) / 1000));
    });
    test('estimateClusterGp respects the chosen filter', () => {
        const varrock = ROUTE.clusters[0];
        const all = estimateClusterGp(varrock, SHOP_DB, ALL);
        const none = estimateClusterGp(varrock, SHOP_DB, new Set());
        const deathOnly = estimateClusterGp(varrock, SHOP_DB, new Set(['death rune']));
        expect(all).toBeGreaterThan(0);
        expect(none).toBe(0);
        expect(deathOnly).toBeGreaterThan(0);
        expect(deathOnly).toBeLessThan(all);
    });
});
