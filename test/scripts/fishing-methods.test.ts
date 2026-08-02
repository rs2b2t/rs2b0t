import { expect, test } from 'bun:test';

import {
    ALL_FISHING_GEAR_NAMES,
    FISHING_METHODS,
    FISHING_METHOD_OPTIONS,
    WHIRLPOOL_IDS,
    fishingRestockPlan,
    gearKeepNames,
    gearLabel,
    hasFishingGear,
    missingFishingGear,
    resolveFishMethod,
    spotMatchesMethod
} from '#/bot/api/FishingMethods.js';

test('Net disambiguates small (Net/Bait) vs big (Net/Harpoon) net by pair', () => {
    const small = resolveFishMethod('Small net — shrimp/anchovy');
    const big = resolveFishMethod('Big net — mackerel/cod/bass');
    expect(small.op).toBe('Net');
    expect(small.pair).toBe('Bait');
    expect(big.op).toBe('Net');
    expect(big.pair).toBe('Harpoon');
});

test('Bait disambiguates sardine (Net/Bait) vs pike (Lure/Bait) by pair', () => {
    expect(resolveFishMethod('Bait rod — sardine/herring').pair).toBe('Net');
    expect(resolveFishMethod('Bait rod — pike').pair).toBe('Lure');
});

test('Harpoon — tuna/swordfish is Cage/Harpoon (not Net/Harpoon sharks)', () => {
    const h = resolveFishMethod('Harpoon — tuna/swordfish');
    expect(h.op).toBe('Harpoon');
    expect(h.pair).toBe('Cage');
});

test('Harpoon — sharks is Net/Harpoon', () => {
    const shark = resolveFishMethod('Harpoon — sharks');
    expect(shark.op).toBe('Harpoon');
    expect(shark.pair).toBe('Net');
    expect(shark.gear.map(g => g.name)).toEqual(['Harpoon']);
});

test('Oily rod — lava eel is Bait-only (empty pair)', () => {
    const oily = resolveFishMethod('Oily rod — lava eel');
    expect(oily.op).toBe('Bait');
    expect(oily.pair).toBe('');
    expect(oily.gear.map(g => g.name)).toEqual(['Oily fishing rod', 'Fishing bait']);
    expect(FISHING_METHOD_OPTIONS).toContain('Oily rod — lava eel');
});

test('every method has a valid primary op; pair is either empty or a different valid op', () => {
    const validOps = new Set(['Net', 'Bait', 'Lure', 'Cage', 'Harpoon']);
    for (const m of FISHING_METHODS) {
        expect(validOps.has(m.op), m.name).toBe(true);
        if (m.pair === '') {
            continue;
        }
        expect(validOps.has(m.pair), m.name).toBe(true);
        expect(m.pair, m.name).not.toBe(m.op);
    }
    expect(FISHING_METHOD_OPTIONS.length).toBe(FISHING_METHODS.length);
    expect(FISHING_METHOD_OPTIONS).toContain('Lobster cage — lobster');
});

test('unknown label falls back to the first method', () => {
    expect(resolveFishMethod('nonsense')).toBe(FISHING_METHODS[0]);
});

test('every method declares gear pieces with min/restock', () => {
    for (const m of FISHING_METHODS) {
        expect(m.gear.length, m.name).toBeGreaterThan(0);
        for (const g of m.gear) {
            expect(g.name.length, m.name).toBeGreaterThan(0);
            expect(g.min, g.name).toBeGreaterThan(0);
            expect(g.restock, g.name).toBeGreaterThanOrEqual(g.min);
        }
    }
});

test('gear helpers: keep names, has/missing, label, restock plan', () => {
    const rod = resolveFishMethod('Bait rod — sardine/herring');
    expect(gearKeepNames(rod)).toEqual(['Fishing rod', 'Fishing bait']);
    expect(gearLabel(rod)).toBe('Fishing rod + Fishing bait');
    expect(hasFishingGear(rod, n => (n === 'Fishing rod' ? 1 : 0))).toBe(false);
    expect(missingFishingGear(rod, n => (n === 'Fishing rod' ? 1 : 0)).map(g => g.name)).toEqual(['Fishing bait']);
    expect(hasFishingGear(rod, _n => 1)).toBe(true);

    const plan = fishingRestockPlan(
        rod,
        n => (n === 'Fishing rod' ? 1 : 0),
        n => (n === 'Fishing bait' ? 250 : 0)
    );
    expect(plan).toEqual([{ name: 'Fishing bait', qty: 100 }]);

    // Already topped up → empty plan
    expect(fishingRestockPlan(rod, () => 100, () => 50)).toEqual([]);
});

test('ALL_FISHING_GEAR_NAMES covers tools and bait used by methods', () => {
    expect(ALL_FISHING_GEAR_NAMES).toContain('Small fishing net');
    expect(ALL_FISHING_GEAR_NAMES).toContain('Harpoon');
    expect(ALL_FISHING_GEAR_NAMES).toContain('Fishing bait');
    expect(ALL_FISHING_GEAR_NAMES).toContain('Oily fishing rod');
});

test('spotMatchesMethod: Cage/Harpoon is tuna, not sharks', () => {
    const tuna = resolveFishMethod('Harpoon — tuna/swordfish');
    const shark = resolveFishMethod('Harpoon — sharks');
    const cageHarpoon = ['Cage', 'Harpoon'];
    const netHarpoon = ['Net', 'Harpoon'];
    expect(spotMatchesMethod(cageHarpoon, tuna)).toBe(true);
    expect(spotMatchesMethod(netHarpoon, tuna)).toBe(false);
    expect(spotMatchesMethod(netHarpoon, shark)).toBe(true);
    expect(spotMatchesMethod(cageHarpoon, shark)).toBe(false);
});

test('spotMatchesMethod is case-insensitive and order-independent', () => {
    const lobster = resolveFishMethod('Lobster cage — lobster');
    expect(spotMatchesMethod(['harpoon', 'cage'], lobster)).toBe(true);
    expect(spotMatchesMethod(['Cage'], lobster)).toBe(false);
});

test('spotMatchesMethod: oily rod accepts Bait-only spots', () => {
    const oily = resolveFishMethod('Oily rod — lava eel');
    expect(spotMatchesMethod(['Bait'], oily)).toBe(true);
    expect(spotMatchesMethod(['Net', 'Bait'], oily)).toBe(true);
    expect(spotMatchesMethod(['Net'], oily)).toBe(false);
});

test('whirlpool ids cover all four changetype variants', () => {
    expect(WHIRLPOOL_IDS.has(403)).toBe(true);
    expect(WHIRLPOOL_IDS.has(404)).toBe(true);
    expect(WHIRLPOOL_IDS.has(405)).toBe(true);
    expect(WHIRLPOOL_IDS.has(406)).toBe(true);
});
