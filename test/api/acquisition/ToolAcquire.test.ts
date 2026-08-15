import { describe, expect, test } from 'bun:test';

import { pickaxeReq, axeReq } from '#/bot/api/acquisition/Tools.js';
import { resolveFishMethod } from '#/bot/data/fishingMethods.js';
import {
    AXE_BAR_FOR,
    BOB_VENDOR,
    BROKEN_AXE,
    BROKEN_PICKAXE,
    GERRANT_VENDOR,
    HARRY_VENDOR,
    NURMOF_VENDOR,
    acquireKeepNames,
    bestAffordableShopTier,
    bestOwnedTier,
    bestSmithableAxe,
    canFundPlan,
    coinsToWithdraw,
    parseToolAcquireMode,
    pickaxeShopOffers,
    planAxeAcquire,
    planBrokenToolRepair,
    buyPlansCost,
    fishingGearShopCart,
    planFishingGearAcquire,
    planFishingGearBuys,
    planGatherToolAcquire,
    planPickaxeAcquire,
    type AcquireWorld
} from '#/bot/api/acquisition/ToolAcquire.js';
import { PICKAXES } from '#/bot/api/acquisition/Tools.js';

function world(partial: Partial<AcquireWorld> & { levels?: Record<string, number>; held?: Record<string, number>; bank?: Record<string, number> }): AcquireWorld {
    const levels = partial.levels ?? {};
    const held = partial.held ?? {};
    const bank = partial.bank ?? {};
    return {
        skillLevel: skill => levels[skill] ?? partial.skillLevel?.(skill) ?? 1,
        heldCount: name => held[name] ?? partial.heldCount?.(name) ?? 0,
        invCount: name => held[name] ?? partial.invCount?.(name) ?? 0,
        bankCount: name => bank[name] ?? partial.bankCount?.(name) ?? 0,
        worn: name => (held[name] ?? 0) > 0 && (partial.worn?.(name) ?? false)
    };
}

describe('ToolAcquire parse', () => {
    test('parseToolAcquireMode accepts Buy / repair variants', () => {
        expect(parseToolAcquireMode('Off')).toBe('off');
        expect(parseToolAcquireMode('Buy / repair')).toBe('on');
        expect(parseToolAcquireMode('buy/repair')).toBe('on');
        expect(parseToolAcquireMode(true)).toBe('on');
        expect(parseToolAcquireMode(undefined)).toBe('off');
    });
});

describe('ToolAcquire pickaxe', () => {
    test('buys best affordable usable pick when missing', () => {
        const w = world({
            levels: { mining: 41 },
            bank: { Coins: 5000 }
        });
        const plan = planPickaxeAcquire(w, { upgrade: false });
        expect(plan?.kind).toBe('buy');
        if (plan?.kind === 'buy') {
            expect(plan.name).toBe('Adamant pickaxe');
            expect(plan.cost).toBe(3200);
            expect(plan.vendor.keeper).toBe(NURMOF_VENDOR.keeper);
            expect(plan.equip).toBe(true);
        }
    });

    test('no buy when too poor', () => {
        const w = world({
            levels: { mining: 41 },
            bank: { Coins: 10 }
        });
        // bronze is 1gp — still affordable
        const plan = planPickaxeAcquire(w, { upgrade: false });
        expect(plan?.kind).toBe('buy');
        if (plan?.kind === 'buy') {
            expect(plan.name).toBe('Bronze pickaxe');
        }

        const broke = world({ levels: { mining: 41 }, bank: { Coins: 0 }, held: { Coins: 0 } });
        expect(planPickaxeAcquire(broke, { upgrade: false })).toBeNull();
    });

    test('upgrade:false returns null when any usable pick owned', () => {
        const w = world({
            levels: { mining: 41 },
            held: { 'Bronze pickaxe': 1 },
            bank: { Coins: 50_000 }
        });
        expect(planPickaxeAcquire(w, { upgrade: false })).toBeNull();
    });

    test('upgrade:true buys better pick when affordable', () => {
        const w = world({
            levels: { mining: 41 },
            held: { 'Bronze pickaxe': 1 },
            bank: { Coins: 50_000 }
        });
        const plan = planPickaxeAcquire(w, { upgrade: true });
        expect(plan?.kind).toBe('buy');
        if (plan?.kind === 'buy') {
            expect(plan.name).toBe('Rune pickaxe');
            expect(plan.reason).toContain('upgrade');
        }
    });

    test('broken pick prefers repair over buy', () => {
        const w = world({
            levels: { mining: 41 },
            held: { [BROKEN_PICKAXE]: 1 },
            bank: { Coins: 50_000 }
        });
        const plan = planPickaxeAcquire(w, { upgrade: true });
        expect(plan?.kind).toBe('repair');
        if (plan?.kind === 'repair') {
            expect(plan.vendor.keeper).toBe('Nurmof');
            expect(plan.brokenName).toBe(BROKEN_PICKAXE);
        }
    });
});

describe('ToolAcquire axe', () => {
    test('buys steel from Bob when missing and affordable', () => {
        const w = world({
            levels: { woodcutting: 21, smithing: 1 },
            bank: { Coins: 500 }
        });
        const plan = planAxeAcquire(w, { upgrade: false });
        expect(plan?.kind).toBe('buy');
        if (plan?.kind === 'buy') {
            expect(plan.name).toBe('Steel axe');
            expect(plan.vendor.keeper).toBe(BOB_VENDOR.keeper);
            expect(plan.cost).toBe(200);
        }
    });

    test('smiths mithril when bar+hammer and WC/smith levels allow', () => {
        const w = world({
            levels: { woodcutting: 41, smithing: 51 },
            bank: { 'Mithril bar': 1, Hammer: 1, Coins: 0 }
        });
        const plan = planAxeAcquire(w, { upgrade: false });
        expect(plan?.kind).toBe('smith');
        if (plan?.kind === 'smith') {
            expect(plan.name).toBe('Mithril axe');
            expect(plan.bar).toBe('Mithril bar');
        }
    });

    test('prefers better smith over Bob steel when both available', () => {
        const w = world({
            levels: { woodcutting: 41, smithing: 51 },
            bank: { 'Mithril bar': 1, Hammer: 1, Coins: 500 }
        });
        const plan = planAxeAcquire(w, { upgrade: false });
        expect(plan?.kind).toBe('smith');
        if (plan?.kind === 'smith') {
            expect(plan.name).toBe('Mithril axe');
        }
    });

    test('broken axe prefers Bob repair', () => {
        const plan = planBrokenToolRepair(n => n === BROKEN_AXE);
        expect(plan?.kind).toBe('repair');
        if (plan?.kind === 'repair') {
            expect(plan.vendor.keeper).toBe('Bob');
        }
    });
});

describe('ToolAcquire fishing', () => {
    test('feathers route to Gerrant even from Catherby', () => {
        const method = resolveFishMethod('Fly fishing — trout/salmon');
        const w = world({
            held: { 'Fly fishing rod': 1 },
            bank: { Coins: 500 }
        });
        const plan = planFishingGearAcquire(method, w, { near: { x: 2846, z: 3429 } });
        expect(plan?.kind).toBe('buy');
        if (plan?.kind === 'buy') {
            expect(plan.name.toLowerCase()).toBe('feather');
            expect(plan.vendor.keeper).toBe(GERRANT_VENDOR.keeper);
        }
    });

    test('bait prefers Harry without near tile', () => {
        const method = resolveFishMethod('Bait rod — sardine/herring');
        const w = world({
            held: { 'Fishing rod': 1 },
            bank: { Coins: 500 }
        });
        const plan = planFishingGearAcquire(method, w);
        expect(plan?.kind).toBe('buy');
        if (plan?.kind === 'buy') {
            expect(plan.name.toLowerCase()).toBe('fishing bait');
            expect(plan.vendor.keeper).toBe(HARRY_VENDOR.keeper);
        }
    });

    test('Catherby lobster pot buys from Harry not Gerrant', () => {
        const method = resolveFishMethod('Lobster cage — lobster');
        const w = world({
            bank: { Coins: 100 }
        });
        const plan = planFishingGearAcquire(method, w, { near: { x: 2846, z: 3429 } });
        expect(plan?.kind).toBe('buy');
        if (plan?.kind === 'buy') {
            expect(plan.name).toBe('Lobster pot');
            expect(plan.vendor.keeper).toBe(HARRY_VENDOR.keeper);
            expect(plan.vendor.stand.x).toBe(2833);
            expect(plan.vendor.stand.z).toBe(3443);
        }
    });

    test('Draynor small net still prefers Gerrant by proximity', () => {
        const method = resolveFishMethod('Small net — shrimp/anchovy');
        const w = world({ bank: { Coins: 50 } });
        const plan = planFishingGearAcquire(method, w, { near: { x: 3086, z: 3231 } });
        expect(plan?.kind).toBe('buy');
        if (plan?.kind === 'buy') {
            expect(plan.name).toBe('Small fishing net');
            expect(plan.vendor.keeper).toBe(GERRANT_VENDOR.keeper);
        }
    });

    test('baitQty buys up to target when bank+inv are short', () => {
        const method = resolveFishMethod('Bait rod — sardine/herring');
        const w = world({
            held: { 'Fishing rod': 1, 'Fishing bait': 10 },
            bank: { Coins: 2000 }
        });
        // have 10, target 50 → buy 40
        const plan = planFishingGearAcquire(method, w, { baitQty: 50, near: { x: 2846, z: 3429 } });
        expect(plan?.kind).toBe('buy');
        if (plan?.kind === 'buy') {
            expect(plan.name).toBe('Fishing bait');
            expect(plan.qty).toBe(40);
            expect(plan.cost).toBe(40 * 3);
            expect(plan.vendor.keeper).toBe(HARRY_VENDOR.keeper);
        }
    });

    test('baitQty does not buy when bank already holds enough', () => {
        const method = resolveFishMethod('Bait rod — sardine/herring');
        const w = world({
            held: { 'Fishing rod': 1, 'Fishing bait': 5 },
            bank: { 'Fishing bait': 200, Coins: 2000 }
        });
        const plan = planFishingGearAcquire(method, w, { baitQty: 100 });
        expect(plan).toBeNull();
    });

    test('planFishingGearBuys lists fly rod then feathers at Gerrant', () => {
        const method = resolveFishMethod('Fly fishing — trout/salmon');
        const w = world({ bank: { Coins: 3000 } });
        const buys = planFishingGearBuys(method, w, { baitQty: 50, near: { x: 3013, z: 3224 } });
        expect(buys.length).toBe(2);
        expect(buys[0]!.name).toBe('Fly fishing rod');
        expect(buys[0]!.qty).toBe(1);
        expect(buys[0]!.cost).toBe(5);
        expect(buys[0]!.vendor.keeper).toBe(GERRANT_VENDOR.keeper);
        expect(buys[1]!.name.toLowerCase()).toBe('feather');
        expect(buys[1]!.qty).toBe(50);
        expect(buys[1]!.cost).toBe(100);
        expect(buys[1]!.vendor.keeper).toBe(GERRANT_VENDOR.keeper);
        expect(buyPlansCost(buys)).toBe(105);
    });

    test('fishingGearShopCart keeps same-vendor multi-buy (rod + feathers)', () => {
        const method = resolveFishMethod('Fly fishing — trout/salmon');
        const w = world({ bank: { Coins: 3000 } });
        const cart = fishingGearShopCart(method, w, { baitQty: 50, near: { x: 3013, z: 3224 } });
        expect(cart.map(p => p.name.toLowerCase())).toEqual(['fly fishing rod', 'feather']);
        expect(new Set(cart.map(p => p.vendor.keeper)).size).toBe(1);
        expect(cart[0]!.vendor.keeper).toBe(GERRANT_VENDOR.keeper);
    });

    test('fishingGearShopCart is empty when coins cannot fund any piece', () => {
        const method = resolveFishMethod('Fly fishing — trout/salmon');
        const w = world({ bank: { Coins: 0 } });
        expect(fishingGearShopCart(method, w, { baitQty: 50 })).toEqual([]);
    });

    test('planFishingGearAcquire still returns first piece only', () => {
        const method = resolveFishMethod('Fly fishing — trout/salmon');
        const w = world({ bank: { Coins: 3000 } });
        const first = planFishingGearAcquire(method, w, { baitQty: 50 });
        expect(first?.kind).toBe('buy');
        if (first?.kind === 'buy') {
            expect(first.name).toBe('Fly fishing rod');
        }
    });
});

describe('ToolAcquire helpers', () => {
    test('bestOwnedTier / bestAffordableShopTier', () => {
        expect(bestOwnedTier(41, PICKAXES, n => (n === 'Steel pickaxe' ? 1 : 0))).toBe('Steel pickaxe');
        const offer = bestAffordableShopTier(41, PICKAXES, pickaxeShopOffers(), 4000, 'Steel pickaxe');
        expect(offer?.name).toBe('Adamant pickaxe');
    });

    test('bestSmithableAxe needs hammer + bar + levels', () => {
        expect(
            bestSmithableAxe(41, 51, null, bar => (bar === 'Mithril bar' ? 1 : 0), true)?.name
        ).toBe('Mithril axe');
        expect(bestSmithableAxe(41, 51, null, () => 1, false)).toBeNull();
        // Smithing 1 + bronze bar → bronze axe
        expect(
            bestSmithableAxe(5, 1, null, bar => (bar === 'Bronze bar' ? 1 : 0), true)?.name
        ).toBe('Bronze axe');
        // Woodcutting never gates the axe — smithing and the bar do
        expect(bestSmithableAxe(5, 51, null, bar => (bar === 'Mithril bar' ? 1 : 0), true)?.name).toBe('Mithril axe');
        expect(bestSmithableAxe(41, 50, null, bar => (bar === 'Mithril bar' ? 1 : 0), true)).toBeNull();
    });

    test('coinsToWithdraw / canFundPlan / acquireKeepNames', () => {
        expect(coinsToWithdraw(500, 100)).toBe(400);
        expect(coinsToWithdraw(100, 200)).toBe(0);
        const buy = planPickaxeAcquire(
            world({ levels: { mining: 1 }, bank: { Coins: 10 } }),
            { upgrade: false }
        )!;
        expect(canFundPlan(buy, 0, 10)).toBe(true);
        expect(canFundPlan(buy, 0, 0)).toBe(false);
        if (buy.kind === 'buy') {
            expect(acquireKeepNames(buy)).toContain('Coins');
        }
        const repair = planBrokenToolRepair(n => n === BROKEN_PICKAXE)!;
        expect(acquireKeepNames(repair)).toContain(BROKEN_PICKAXE);

        // Smith keep must retain bar + hammer so restock deposit does not dump materials.
        const smith = planAxeAcquire(
            world({
                levels: { woodcutting: 41, smithing: 86 },
                held: { Hammer: 1, 'Runite bar': 1 }
            }),
            { upgrade: false }
        );
        expect(smith?.kind).toBe('smith');
        if (smith?.kind === 'smith') {
            expect(smith.bar).toBe('Runite bar');
            expect(acquireKeepNames(smith)).toEqual(expect.arrayContaining(['Coins', 'Runite bar', 'Hammer']));
            expect(AXE_BAR_FOR['Rune axe']).toBe('Runite bar');
        }
    });

    test('planGatherToolAcquire routes mining/woodcutting reqs', () => {
        const mine = planGatherToolAcquire([pickaxeReq()], world({ levels: { mining: 6 }, bank: { Coins: 200 } }), {
            upgrade: false
        });
        expect(mine?.kind).toBe('buy');
        if (mine?.kind === 'buy') {
            expect(mine.name).toBe('Iron pickaxe');
        }

        const chop = planGatherToolAcquire([axeReq()], world({ levels: { woodcutting: 1 }, bank: { Coins: 20 } }), {
            upgrade: false
        });
        expect(chop?.kind).toBe('buy');
        if (chop?.kind === 'buy') {
            expect(chop.name).toBe('Bronze axe');
        }
    });

    test('Nurmof hop metadata present', () => {
        expect(NURMOF_VENDOR.hopFrom?.x).toBe(3019);
        expect(NURMOF_VENDOR.hopLoc).toBe('Trapdoor');
        expect(NURMOF_VENDOR.stand.z).toBe(9844);
    });
});
