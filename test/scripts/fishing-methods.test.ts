import { expect, test } from 'bun:test';

import { FISHING_METHODS, FISHING_METHOD_OPTIONS, SHARK_SPOT_IDS, WHIRLPOOL_IDS, resolveFishMethod } from '#/bot/scripts/FishingMethods.js';

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

test('Harpoon has no pair — it matches either harpoon spot (same fish)', () => {
    const h = resolveFishMethod('Harpoon — tuna/swordfish');
    expect(h.op).toBe('Harpoon');
    expect(h.pair).toBeUndefined();
});

test('every op/pair is a real fishing-spot op; options list matches the table', () => {
    const validOps = new Set(['Net', 'Bait', 'Lure', 'Cage', 'Harpoon']);
    for (const m of FISHING_METHODS) {
        expect(validOps.has(m.op)).toBe(true);
        if (m.pair) {
            expect(validOps.has(m.pair)).toBe(true);
        }
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

test('sharks: Harpoon on the members Net/Harpoon spots, restricted by npc id', () => {
    const shark = resolveFishMethod('Harpoon — sharks');
    expect(shark.op).toBe('Harpoon');
    expect(shark.pair).toBe('Net');
    expect(shark.gear).toEqual(['Harpoon']);
    expect(shark.spotIds).toEqual(SHARK_SPOT_IDS);
    expect(SHARK_SPOT_IDS.length).toBeGreaterThan(0);
});

test('tuna/swordfish stays unrestricted — the shark ids must not shadow it', () => {
    expect(resolveFishMethod('Harpoon — tuna/swordfish').spotIds).toBeUndefined();
});

test('whirlpool ids never overlap real shark spot ids', () => {
    for (const id of SHARK_SPOT_IDS) {
        expect(WHIRLPOOL_IDS.has(id)).toBe(false);
    }
});
