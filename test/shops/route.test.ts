import { describe, expect, test } from 'bun:test';
import { ROUTE, SMOKE_ROUTE } from '#/bot/shops/data/route.js';
import { SHOP_DB } from '#/bot/shops/data/shopdb.js';
import type { Route } from '#/bot/shops/types.js';

function checkRoute(route: Route): void {
    expect(route.ring).toEqual(route.clusters.map(c => c.id));
    for (const cluster of route.clusters) {
        for (const shop of cluster.shops) {
            const rec = SHOP_DB[shop.shopId];
            expect(rec).toBeDefined();
            expect(rec.keepers).toContain(shop.keeperNpc);
            expect(rec.scope).toBe('shared');
            for (const buy of shop.buys) {
                const item = rec.items.find(i => i.obj === buy.obj);
                expect(item).toBeDefined();
                expect(item!.stackable).toBe(true);   // v1 buylist must stack (no inv pressure)
                expect(item!.baseline).toBeGreaterThan(0); // baseline-0 never restocks
                if (buy.policy?.kind === 'floor') {
                    expect(buy.policy.pct).toBeGreaterThan(0);
                    expect(buy.policy.pct).toBeLessThan(100);
                }
            }
        }
    }
}

describe('route data integrity vs generated shopdb', () => {
    test('live route resolves entirely against SHOP_DB', () => {
        checkRoute(ROUTE);
        expect(ROUTE.clusters.map(c => c.id)).toEqual(['varrock', 'portsarim', 'catherby', 'fishingguild', 'rangingguild', 'magicguild', 'magearena']);
    });
    test('skill gates sit on the guild clusters', () => {
        const byId = new Map(ROUTE.clusters.map(c => [c.id, c]));
        expect(byId.get('varrock')!.gates).toEqual([]);
        expect(byId.get('portsarim')!.gates).toEqual([]);
        expect(byId.get('catherby')!.gates).toEqual([]);
        expect(byId.get('fishingguild')!.gates).toEqual([{ skill: { name: 'fishing', level: 68 } }]);
        expect(byId.get('rangingguild')!.gates).toEqual([{ skill: { name: 'ranged', level: 40 } }]);
        expect(byId.get('magicguild')!.gates).toEqual([{ skill: { name: 'magic', level: 66 } }]);
        expect(byId.get('magearena')!.gates).toEqual([]);
    });
    test('the Mage Arena cluster carries the full wilderness protocol', () => {
        const ma = ROUTE.clusters.find(c => c.id === 'magearena')!;
        expect(ma.setting).toBe('mageArena');                    // operator toggle
        expect(ma.keep).toEqual(['Rune scimitar']);              // the ONLY carried item — a slash weapon
        expect(ma.wield).toEqual(['Rune scimitar']);             // worn: op1 Slash reads slash_checker
        expect(ma.haulBank).toEqual({ stand: { x: 2533, z: 4714, level: 0 }, banker: 'Gundai' }); // haul never walks the wild
        expect(ma.waypoints?.length ?? 0).toBeGreaterThan(0);    // staged deep-wildy walk
        expect(ma.bank.banker).toBeUndefined();                  // funding = Edgeville BOOTH
    });
    test('smoke route is the Aubury-only varrock cluster', () => {
        checkRoute(SMOKE_ROUTE);
        expect(SMOKE_ROUTE.clusters).toHaveLength(1);
        expect(SMOKE_ROUTE.clusters[0].shops).toHaveLength(1);
        expect(SMOKE_ROUTE.clusters[0].shops[0].shopId).toBe('runeshop');
    });
});

describe('buys[] priority order', () => {
    test('every shop lists its buys in descending item cost — the planner allocates the gp cap greedily in buys[] order, so a cheap-first list starves the valuable tail (the death-rune bug)', () => {
        for (const cluster of ROUTE.clusters) {
            for (const shop of cluster.shops) {
                const costs = shop.buys.map(b => SHOP_DB[shop.shopId]!.items.find(i => i.obj === b.obj)!.cost);
                const sorted = [...costs].sort((a, b) => b - a);
                expect({ shop: shop.shopId, costs }).toEqual({ shop: shop.shopId, costs: sorted });
            }
        }
    });
});
