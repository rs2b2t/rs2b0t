import { describe, expect, test } from 'bun:test';
import { COSMIC, JEWELS, JEWEL_OPTIONS, PACK, castsAffordable, decide, jewelByName, jewelSlots, runesPerCast, staffFor, tripPlan, type Counts } from '#/bot/scripts/JiveEnchanter/logic.js';

const sapphireRing = jewelByName('Sapphire ring')!;
const rubyAmulet = jewelByName('Ruby amulet')!;
const dragonRing = jewelByName('Dragonstone ring')!;
const held = (counts: Record<string, number>) => (name: string) => counts[name] ?? 0;

describe('JEWELS', () => {
    test('is the eleven jewels the content converts, and nothing the spells refuse', () => {
        expect(JEWELS).toHaveLength(11);
        expect(new Set(JEWEL_OPTIONS).size).toBe(11);
        expect(jewelByName('Emerald necklace')).toBeNull();
        expect(jewelByName('Gold ring')).toBeNull();
    });

    test('carries the spell, its magic level, xp and runes off the content rows', () => {
        expect(sapphireRing.spell.name).toBe('Enchant Lvl-1 Jewelry');
        expect(sapphireRing.spell.magic).toBe(7);
        expect(sapphireRing.spell.xp).toBe(17.5);
        expect(sapphireRing.spell.elements).toEqual([{ rune: 'Water rune', count: 1 }]);
        expect(dragonRing.spell.magic).toBe(68);
        expect(dragonRing.spell.elements).toEqual([{ rune: 'Earth rune', count: 15 }, { rune: 'Water rune', count: 15 }]);
    });

    test('amulets are the strung ids, since the unstrung ones share the display name', () => {
        expect(rubyAmulet.id).toBe(1698);
        expect(jewelByName('Dragonstone amulet')).toMatchObject({ id: 1702, name: 'Dragonstoneamulet', product: 'Amulet of glory' });
        expect(sapphireRing).toMatchObject({ id: 1637, product: 'Ring of recoil' });
        expect(jewelByName('Sapphire necklace')?.product).toBe('Games necklace(8)');
    });

    test('jewelByName takes the label or the pack name in any case', () => {
        expect(jewelByName('ruby AMULET')).toBe(rubyAmulet);
        expect(jewelByName('Dragonstoneamulet')?.label).toBe('Dragonstone amulet');
    });
});

describe('runesPerCast', () => {
    test('is the cosmic plus the element runes, unless a wielded staff covers the element', () => {
        expect(runesPerCast(sapphireRing, [])).toEqual([{ rune: COSMIC, count: 1 }, { rune: 'Water rune', count: 1 }]);
        expect(runesPerCast(sapphireRing, ['Staff of water'])).toEqual([{ rune: COSMIC, count: 1 }]);
        expect(runesPerCast(sapphireRing, ['Mystic water staff'])).toEqual([{ rune: COSMIC, count: 1 }]);
        expect(runesPerCast(sapphireRing, ['Staff of fire'])).toHaveLength(2);
    });

    test('a level-5 cast keeps whichever element the staff does not cover', () => {
        expect(runesPerCast(dragonRing, ['Earth battlestaff'])).toEqual([{ rune: COSMIC, count: 1 }, { rune: 'Water rune', count: 15 }]);
    });
});

describe('castsAffordable and jewelSlots', () => {
    test('casts are bounded by the scarcest rune', () => {
        expect(castsAffordable(sapphireRing, [], held({ [COSMIC]: 10, 'Water rune': 4 }))).toBe(4);
        expect(castsAffordable(rubyAmulet, [], held({ [COSMIC]: 10, 'Fire rune': 12 }))).toBe(2);
        expect(castsAffordable(rubyAmulet, ['Staff of fire'], held({ [COSMIC]: 10 }))).toBe(10);
    });

    test('each rune stack takes a slot from the jewels', () => {
        expect(jewelSlots(sapphireRing, [])).toBe(PACK - 2);
        expect(jewelSlots(sapphireRing, ['Staff of water'])).toBe(PACK - 1);
        expect(jewelSlots(dragonRing, [])).toBe(PACK - 3);
    });
});

describe('decide', () => {
    test('casts while a jewel and the runes for one cast are in the pack, otherwise banks', () => {
        expect(decide({ jewels: 5, casts: 3 })).toEqual({ kind: 'cast' });
        expect(decide({ jewels: 0, casts: 3 })).toEqual({ kind: 'bank' });
        expect(decide({ jewels: 5, casts: 0 })).toEqual({ kind: 'bank' });
    });
});

describe('tripPlan', () => {
    const counts = (c: Record<string, number>): Counts => ({ jewels: c.jewels ?? 0, rune: name => c[name] ?? 0 });
    const empty = counts({});

    test('fills the free slots with jewels and takes the runes those casts need', () => {
        const bank = counts({ jewels: 100, [COSMIC]: 500, 'Water rune': 500 });
        expect(tripPlan(sapphireRing, [], empty, bank)).toEqual({
            ok: true,
            jewels: 26,
            runes: [{ rune: COSMIC, count: 26 }, { rune: 'Water rune', count: 26 }]
        });
    });

    test('runes already in the pack count against the withdrawal', () => {
        const bank = counts({ jewels: 100, [COSMIC]: 500, 'Water rune': 500 });
        expect(tripPlan(sapphireRing, [], counts({ [COSMIC]: 30, 'Water rune': 10 }), bank)).toEqual({ ok: true, jewels: 26, runes: [{ rune: 'Water rune', count: 16 }] });
    });

    test('a short bank makes a short trip, sized by the scarcest of jewels and runes', () => {
        expect(tripPlan(sapphireRing, [], empty, counts({ jewels: 4, [COSMIC]: 500, 'Water rune': 500 }))).toMatchObject({ ok: true, jewels: 4 });
        expect(tripPlan(sapphireRing, [], empty, counts({ jewels: 100, [COSMIC]: 3, 'Water rune': 500 }))).toMatchObject({ ok: true, jewels: 3 });
    });

    test('counts the jewels and the casts already held before asking the bank', () => {
        const plan = tripPlan(sapphireRing, [], counts({ jewels: 6, [COSMIC]: 2, 'Water rune': 2 }), counts({ [COSMIC]: 500, 'Water rune': 500 }));
        expect(plan).toEqual({ ok: true, jewels: 0, runes: [{ rune: COSMIC, count: 4 }, { rune: 'Water rune', count: 4 }] });
    });

    test('a wielded staff frees a slot and drops its rune from the list', () => {
        const bank = counts({ jewels: 100, [COSMIC]: 500 });
        expect(tripPlan(sapphireRing, ['Staff of water'], empty, bank)).toEqual({ ok: true, jewels: 27, runes: [{ rune: COSMIC, count: 27 }] });
    });

    test('stops with the missing thing named', () => {
        const noJewels = tripPlan(sapphireRing, [], empty, counts({ [COSMIC]: 500, 'Water rune': 500 }));
        expect(!noJewels.ok && noJewels.reason).toContain('Sapphire ring');
        const noCosmic = tripPlan(sapphireRing, [], empty, counts({ jewels: 10, 'Water rune': 500 }));
        expect(!noCosmic.ok && noCosmic.reason).toContain(COSMIC);
        const noWater = tripPlan(sapphireRing, [], empty, counts({ jewels: 10, [COSMIC]: 500 }));
        expect(!noWater.ok && noWater.reason).toContain('Water rune');
    });
});

describe('staffFor', () => {
    test('names a banked staff that covers one of the spell elements, or null', () => {
        expect(staffFor(sapphireRing, held({ 'Staff of water': 1 }))).toBe('Staff of water');
        expect(staffFor(sapphireRing, held({ 'Water battlestaff': 1 }))).toBe('Water battlestaff');
        expect(staffFor(sapphireRing, held({ 'Staff of fire': 1 }))).toBeNull();
        expect(staffFor(dragonRing, held({ 'Staff of water': 1 }))).toBe('Staff of water');
    });
});
