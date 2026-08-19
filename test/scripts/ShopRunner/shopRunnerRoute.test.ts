import { describe, expect, test } from 'bun:test';
import { ROUTE } from '#/bot/scripts/ShopRunner/ShopRunnerRoute.js';
import { SHOP_DB } from '#/bot/data/shopdb.js';
import { SHOPRUNNER_SETTINGS } from '#/bot/scripts/ShopRunner/ShopRunner.js';
import type { Route } from '#/bot/api/shop/types.js';

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
                if (!item!.stackable) {
                    expect(cluster.repeatWhileFull).toBe(true);
                }
                expect(item!.baseline).toBeGreaterThan(0);
                if (buy.policy?.kind === 'floor') {
                    expect(buy.policy.pct).toBeGreaterThan(0);
                    expect(buy.policy.pct).toBeLessThan(100);
                }
            }
        }
    }
}

describe('route data integrity vs generated shopdb', () => {
    test('ShopRunner exposes both requested Herblore supplies', () => {
        expect(SHOPRUNNER_SETTINGS.buyItems.options).toContain('Vial');
        expect(SHOPRUNNER_SETTINGS.buyItems.options).toContain('Vial of water');
        expect(SHOPRUNNER_SETTINGS.buyItems.options).toContain('Eye of newt');
        expect(SHOPRUNNER_SETTINGS.buyItems.default).toContain('Vial');
        expect(SHOPRUNNER_SETTINGS.buyItems.default).toContain('Vial of water');
        expect(SHOPRUNNER_SETTINGS.buyItems.default).toContain('Eye of newt');
    });
    test('live route resolves entirely against SHOP_DB', () => {
        checkRoute(ROUTE);
        expect(ROUTE.clusters.map(c => c.id)).toEqual(['varrock', 'portsarim', 'taverley', 'catherby', 'fishingguild', 'rangingguild', 'ardougne', 'magicguild', 'magearena']);
    });
    test('skill gates sit on the guild clusters', () => {
        const byId = new Map(ROUTE.clusters.map(c => [c.id, c]));
        expect(byId.get('varrock')!.gates).toEqual([]);
        expect(byId.get('portsarim')!.gates).toEqual([]);
        expect(byId.get('taverley')!.gates).toEqual([]);
        expect(byId.get('catherby')!.gates).toEqual([]);
        expect(byId.get('fishingguild')!.gates).toEqual([{ skill: { name: 'fishing', level: 68 } }]);
        expect(byId.get('rangingguild')!.gates).toEqual([{ skill: { name: 'ranged', level: 40 } }]);
        expect(byId.get('ardougne')!.gates).toEqual([]);
        expect(byId.get('magicguild')!.gates).toEqual([{ skill: { name: 'magic', level: 66 } }]);
        expect(byId.get('magearena')!.gates).toEqual([]);
    });
    test('the Mage Arena cluster carries the knife-only wilderness protocol', () => {
        const ma = ROUTE.clusters.find(c => c.id === 'magearena')!;
        expect(ma.setting).toBe('mageArena');
        expect(ma.keep).toEqual(['Knife']);
        expect(ma.wield).toBeUndefined();
        expect(ma.keepFallback).toEqual({ item: 'Knife', spawn: { x: 3218, z: 3418, level: 1 } });
        expect(ma.haulBank).toEqual({ stand: { x: 2533, z: 4714, level: 0 }, banker: 'Gundai' });
        expect(ma.waypoints?.length ?? 0).toBeGreaterThan(0);
        expect(ma.bank.banker).toBeUndefined();
    });
    test('Taverley repeats Jatix trips for both non-stackable Herblore supplies', () => {
        const taverley = ROUTE.clusters.find(c => c.id === 'taverley')!;
        expect(taverley.repeatWhileFull).toBe(true);
        expect(taverley.bank.stand).toEqual({ x: 2946, z: 3369, level: 0 });
        expect(taverley.shops).toEqual([{
            shopId: 'herbloreshop',
            keeperNpc: 'Jatix',
            stand: { x: 2899, z: 3427, level: 0 },
            buys: [{ obj: 'eye_of_newt' }, { obj: 'vial_empty' }]
        }]);
    });
    test('Ardougne buys filled vials from Aemad and banks at East Ardougne', () => {
        const ardougne = ROUTE.clusters.find(c => c.id === 'ardougne')!;
        expect(ardougne.repeatWhileFull).toBe(true);
        expect(ardougne.bank.stand).toEqual({ x: 2655, z: 3283, level: 0 });
        expect(ardougne.shops).toEqual([{
            shopId: 'adventurershop',
            keeperNpc: 'Aemad',
            stand: { x: 2613, z: 3294, level: 0 },
            buys: [{ obj: 'vial_water' }]
        }]);
    });
    test('ShopRunner has no smoke-varrock route setting', () => {
        expect(SHOPRUNNER_SETTINGS).not.toHaveProperty('route');
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
