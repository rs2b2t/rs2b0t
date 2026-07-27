import { expect, test } from 'bun:test';

import { FISHING_METHODS, FISHING_METHOD_OPTIONS, WHIRLPOOL_IDS, resolveFishMethod, spotMatchesMethod } from '#/bot/scripts/FishingMethods.js';

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
    expect(shark.gear).toEqual(['Harpoon']);
});

test('every method requires a pair op (Harpoon alone is ambiguous)', () => {
    const validOps = new Set(['Net', 'Bait', 'Lure', 'Cage', 'Harpoon']);
    for (const m of FISHING_METHODS) {
        expect(validOps.has(m.op)).toBe(true);
        expect(validOps.has(m.pair)).toBe(true);
        expect(m.pair).not.toBe(m.op);
    }
    expect(FISHING_METHOD_OPTIONS.length).toBe(FISHING_METHODS.length);
    expect(FISHING_METHOD_OPTIONS).toContain('Lobster cage — lobster');
});

test('unknown label falls back to the first method', () => {
    expect(resolveFishMethod('nonsense')).toBe(FISHING_METHODS[0]);
});

test('every method declares its gear (the bank-trip keep set)', () => {
    for (const m of FISHING_METHODS) {
        expect(m.gear.length, m.name).toBeGreaterThan(0);
    }
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

test('whirlpool ids cover all four changetype variants', () => {
    expect(WHIRLPOOL_IDS.has(403)).toBe(true);
    expect(WHIRLPOOL_IDS.has(404)).toBe(true);
    expect(WHIRLPOOL_IDS.has(405)).toBe(true);
    expect(WHIRLPOOL_IDS.has(406)).toBe(true);
});
