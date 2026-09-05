import { describe, expect, test } from 'bun:test';
import { GOLD_BAR, JEWELLERY, PRODUCT_OPTIONS, craftable, decide, jewelByName, makeOp, setsPerTrip, withdrawPlan, type PackState } from '#/bot/scripts/JiveCrafting/logic.js';

const sapphireRing = jewelByName('Sapphire ring')!;
const goldRing = jewelByName('Gold ring')!;
const ready: PackState = { mould: true, bars: 13, gems: 13 };

describe('JEWELLERY', () => {
    test('is the eighteen gold products of the content structs, six per mould', () => {
        expect(JEWELLERY).toHaveLength(18);
        for (const kind of ['ring', 'necklace', 'amulet'] as const) {
            expect(JEWELLERY.filter(j => j.kind === kind)).toHaveLength(6);
        }
        expect(new Set(PRODUCT_OPTIONS).size).toBe(18);
    });

    test('carries the level and xp the struct gives each product', () => {
        expect(sapphireRing.level).toBe(20);
        expect(sapphireRing.xp).toBe(40);
        expect(jewelByName('Gold necklace')).toMatchObject({ level: 6, xp: 20, gem: null });
        expect(jewelByName('Dragonstone amulet')).toMatchObject({ level: 80, xp: 150, gem: 'Dragonstone' });
    });

    test('names the pack item where the content spells it differently from the label', () => {
        expect(jewelByName('Dragonstone amulet')?.item).toBe('Dragonstoneamulet');
        expect(jewelByName('Dragonstone necklace')?.item).toBe('Dragon necklace');
        expect(goldRing.item).toBe('Gold ring');
    });

    test('each kind takes its own mould', () => {
        expect(goldRing.mould).toBe('Ring mould');
        expect(jewelByName('Ruby necklace')?.mould).toBe('Necklace mould');
        expect(jewelByName('Ruby amulet')?.mould).toBe('Amulet mould');
    });

    test('jewelByName takes the label or the pack name in any case, and null otherwise', () => {
        expect(jewelByName('sapphire RING')).toBe(sapphireRing);
        expect(jewelByName('Dragonstoneamulet')?.label).toBe('Dragonstone amulet');
        expect(jewelByName('Silver sickle')).toBeNull();
    });
});

describe('setsPerTrip', () => {
    test('a gem product pairs a bar with a gem beside the mould, a gold one fills the rest of the pack with bars', () => {
        expect(setsPerTrip(sapphireRing)).toBe(13);
        expect(setsPerTrip(goldRing)).toBe(27);
    });
});

describe('decide', () => {
    test('crafts while the mould, a bar and a gem are all in the pack', () => {
        expect(decide(ready, sapphireRing)).toEqual({ kind: 'craft' });
    });

    test('a gold product needs no gem', () => {
        expect(decide({ ...ready, gems: 0 }, goldRing)).toEqual({ kind: 'craft' });
    });

    test('banks without the mould, without bars, or without the gem the product takes', () => {
        expect(decide({ ...ready, mould: false }, sapphireRing)).toEqual({ kind: 'bank' });
        expect(decide({ ...ready, bars: 0 }, sapphireRing)).toEqual({ kind: 'bank' });
        expect(decide({ ...ready, gems: 0 }, sapphireRing)).toEqual({ kind: 'bank' });
    });
});

describe('craftable', () => {
    test('is the shorter of the bar and gem stacks, or the bars alone for gold', () => {
        expect(craftable({ mould: true, bars: 13, gems: 4 }, sapphireRing)).toBe(4);
        expect(craftable({ mould: true, bars: 3, gems: 13 }, sapphireRing)).toBe(3);
        expect(craftable({ mould: true, bars: 9, gems: 0 }, goldRing)).toBe(9);
    });

    test('is nothing without the mould', () => {
        expect(craftable({ mould: false, bars: 13, gems: 13 }, sapphireRing)).toBe(0);
    });
});

describe('withdrawPlan', () => {
    const stock = (counts: Record<string, number>) => (name: string) => counts[name] ?? 0;

    test('takes the mould only when the pack lacks it, then a full trip of pairs', () => {
        const bank = stock({ 'Ring mould': 1, [GOLD_BAR]: 100, Sapphire: 100 });
        expect(withdrawPlan(sapphireRing, false, bank)).toEqual({ ok: true, mould: true, bars: 13, gems: 13 });
        expect(withdrawPlan(sapphireRing, true, bank)).toEqual({ ok: true, mould: false, bars: 13, gems: 13 });
    });

    test('a short bank makes a short trip rather than none', () => {
        expect(withdrawPlan(sapphireRing, true, stock({ [GOLD_BAR]: 30, Sapphire: 5 }))).toEqual({ ok: true, mould: false, bars: 5, gems: 5 });
        expect(withdrawPlan(goldRing, true, stock({ [GOLD_BAR]: 4 }))).toEqual({ ok: true, mould: false, bars: 4, gems: 0 });
    });

    test('a gold product takes twenty-seven bars and no gems', () => {
        expect(withdrawPlan(goldRing, true, stock({ [GOLD_BAR]: 100, Sapphire: 100 }))).toEqual({ ok: true, mould: false, bars: 27, gems: 0 });
    });

    test('stops with the missing thing named when the bank cannot supply it', () => {
        const noMould = withdrawPlan(sapphireRing, false, stock({ [GOLD_BAR]: 10, Sapphire: 10 }));
        expect(noMould.ok).toBe(false);
        expect(!noMould.ok && noMould.reason).toContain('Ring mould');
        const noBars = withdrawPlan(sapphireRing, true, stock({ Sapphire: 10 }));
        expect(!noBars.ok && noBars.reason).toContain('Gold bar');
        const noGems = withdrawPlan(sapphireRing, true, stock({ [GOLD_BAR]: 10 }));
        expect(!noGems.ok && noGems.reason).toContain('Sapphire');
    });
});

describe('makeOp', () => {
    test('picks the button that finishes the load in the fewest panel opens', () => {
        expect(makeOp(13)).toBe('Make 10');
        expect(makeOp(6)).toBe('Make 10');
        expect(makeOp(5)).toBe('Make 5');
        expect(makeOp(2)).toBe('Make 5');
        expect(makeOp(1)).toBe('Make');
    });
});
