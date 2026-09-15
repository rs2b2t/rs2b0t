import { describe, expect, test } from 'bun:test';
import {
    FOOD_DEFAULT_COUNT,
    SECONDARIES,
    SHIELD_NAME,
    SHOP_COIN_CAP,
    foodHealAmount,
    grinds,
    keepOnDeposit,
    needsRestock,
    secondaryByName,
    shouldEat,
    shopCoinsToWithdraw,
    secondaryById
} from '#/bot/scripts/HerbloreSecondaries/HerbloreSecondariesLogic.js';

describe('HerbloreSecondaries catalog', () => {
    test('covers every secondary the issue names', () => {
        const ids = SECONDARIES.map(s => s.id).sort();
        expect(ids as string[]).toEqual(
            ['chocolate_dust', 'eye_of_newt', 'red_spiders_eggs', 'snape_grass', 'toads_legs', 'unicorn_horn_dust', 'white_berries']
        );
    });

    test('white berries requires the dragonfire shield', () => {
        const w = secondaryById('white_berries');
        expect(w.needShield).toBe(true);
        expect(w.takeFood).toBe(true);
        expect(w.anchor?.z).toBeGreaterThan(3700); // wilderness
    });

    test('red spider eggs sit in the Edgeville dungeon', () => {
        const e = secondaryById('red_spiders_eggs');
        expect(e.anchor?.z).toBeGreaterThan(9900);
        expect(e.takeFood).toBe(true);
    });

    test('snape grass is west of the Crafting Guild', () => {
        const s = secondaryById('snape_grass');
        expect(s.anchor?.x).toBeGreaterThan(2900);
        expect(s.anchor?.x).toBeLessThan(2930);
    });

    test('toads process swamp toads into legs at the Grand Tree bank', () => {
        const t = secondaryById('toads_legs');
        expect(t.mode).toBe('loot_process');
        expect(t.sourceName).toBe('Swamp toad');
        expect(t.bank?.level).toBe(1);
    });

    test('chocolate dust buys bars and grinds with a pestle', () => {
        const c = secondaryById('chocolate_dust');
        expect(c.mode).toBe('buy_grind');
        expect(c.grindFrom).toBe('Chocolate bar');
        expect(c.toolName).toBe('Pestle and mortar');
        expect(c.shopNpc).toBe('Wydin');
        expect(c.toolShopNpc).toBe('Jatix');
    });

    test('unicorn horn dust grinds banked horns at whichever bank is nearest', () => {
        const u = secondaryById('unicorn_horn_dust');
        expect(u.mode).toBe('bank_grind');
        expect(u.grindFrom).toBe('Unicorn horn');
        expect(u.toolName).toBe('Pestle and mortar');
        expect(u.takeFood).toBe(false);
        expect(u.bank).toBeUndefined();
        expect(u.anchor).toBeUndefined();
        expect(u.shopNpc).toBeUndefined();
        expect(u.toolShopNpc).toBeUndefined();
    });

    test('grinds covers both grind modes and nothing else', () => {
        expect(grinds(secondaryById('chocolate_dust'))).toBe(true);
        expect(grinds(secondaryById('unicorn_horn_dust'))).toBe(true);
        expect(grinds(secondaryById('eye_of_newt'))).toBe(false);
        expect(grinds(secondaryById('toads_legs'))).toBe(false);
    });

    test('secondaryByName resolves display names', () => {
        expect(secondaryByName("Red spiders' eggs")?.id).toBe('red_spiders_eggs');
        expect(secondaryByName('nope')).toBeNull();
    });
});

describe('HerbloreSecondaries decisions', () => {
    test('shop coin withdraw never exceeds the death-safe cap', () => {
        expect(SHOP_COIN_CAP).toBe(5000);
        expect(shopCoinsToWithdraw(0, 100_000)).toBe(5000);
        expect(shopCoinsToWithdraw(2000, 100_000)).toBe(3000);
        expect(shopCoinsToWithdraw(5000, 100_000)).toBe(0);
        expect(shopCoinsToWithdraw(0, 400)).toBe(400);
    });

    test('eats when a full heal fits under max HP', () => {
        expect(shouldEat({ hp: 20, maxHp: 40, heal: 12, foodCount: 3, freeSlots: 5, collecting: true })).toBe(true);
        expect(shouldEat({ hp: 35, maxHp: 40, heal: 12, foodCount: 3, freeSlots: 5, collecting: true })).toBe(false);
    });

    test('eats to free a slot when full while collecting', () => {
        expect(shouldEat({ hp: 40, maxHp: 40, heal: 12, foodCount: 2, freeSlots: 0, collecting: true })).toBe(true);
        expect(shouldEat({ hp: 40, maxHp: 40, heal: 12, foodCount: 2, freeSlots: 0, collecting: false })).toBe(false);
    });

    test('default food withdraw is 10', () => {
        expect(FOOD_DEFAULT_COUNT).toBe(10);
        expect(foodHealAmount('Lobster')).toBe(12);
    });

    test('keep list retains supplies but deposits product and source loot', () => {
        const w = secondaryById('white_berries');
        expect(keepOnDeposit(w, 'Lobster')).toContain(SHIELD_NAME);
        expect(keepOnDeposit(w, 'Lobster')).not.toContain(w.name);

        const c = secondaryById('chocolate_dust');
        expect(keepOnDeposit(c, 'Lobster')).toContain('Pestle and mortar');
        expect(keepOnDeposit(c, 'Lobster')).toContain('Chocolate bar');
        expect(keepOnDeposit(c, 'Lobster')).not.toContain(c.name);

        // Toad legs + swamp toads are the loot, keeping them caused bank open/close spam.
        const t = secondaryById('toads_legs');
        const keep = keepOnDeposit(t, 'Lobster');
        expect(keep).not.toContain(t.name);
        expect(keep).not.toContain(t.sourceName);
    });

    test('loot routes bank everything, including random-event coins', () => {
        // Coins on a loot route only ever come from a random event.
        expect(keepOnDeposit(secondaryById('red_spiders_eggs'), 'Lobster')).toEqual(['Lobster']);
        expect(keepOnDeposit(secondaryById('toads_legs'), 'Lobster')).toEqual([]);
        // Shop routes still need their float.
        expect(keepOnDeposit(secondaryById('eye_of_newt'), 'Lobster')).toContain('Coins');
        expect(keepOnDeposit(secondaryById('chocolate_dust'), 'Lobster')).toContain('Coins');
    });

    test('restock when food is empty on a dangerous secondary, not merely low', () => {
        const e = secondaryById('red_spiders_eggs');
        expect(
            needsRestock({
                def: e,
                foodCount: 0,
                foodWant: 10,
                coins: 0,
                hasShield: true,
                hasTool: true,
                packFull: false,
                grindLeft: 0
            })
        ).toBe(true);
        expect(
            needsRestock({
                def: e,
                foodCount: 2,
                foodWant: 10,
                coins: 0,
                hasShield: true,
                hasTool: true,
                packFull: false,
                grindLeft: 0
            })
        ).toBe(false);
    });

    test('bank grind restocks when the horns run out or the pack fills with dust, never for coins', () => {
        const u = secondaryById('unicorn_horn_dust');
        const base = { def: u, foodCount: 0, foodWant: 0, coins: 0, hasShield: false, hasTool: true };
        expect(needsRestock({ ...base, packFull: false, grindLeft: 0 })).toBe(true);
        expect(needsRestock({ ...base, packFull: true, grindLeft: 0 })).toBe(true);
        expect(needsRestock({ ...base, packFull: false, grindLeft: 5 })).toBe(false);
    });

    test('a full pack mid-grind keeps grinding instead of banking one dust at a time', () => {
        const u = secondaryById('unicorn_horn_dust');
        const c = secondaryById('chocolate_dust');
        const base = { foodCount: 0, foodWant: 0, coins: 500, hasShield: false, hasTool: true, packFull: true };
        expect(needsRestock({ ...base, def: u, grindLeft: 26 })).toBe(false);
        expect(needsRestock({ ...base, def: c, grindLeft: 3 })).toBe(false);
        expect(needsRestock({ ...base, def: secondaryById('toads_legs'), grindLeft: 0 })).toBe(true);
    });

    test('bank grind keeps the pestle and the horns, banks dust and stray coins', () => {
        const keep = keepOnDeposit(secondaryById('unicorn_horn_dust'), 'Lobster');
        expect(keep).toEqual(['Pestle and mortar', 'Unicorn horn']);
    });
});

describe('HerbloreSecondaries banks', () => {
    test('white berries bank at Ardougne West, where the Deserted Keep lever lands', () => {
        const w = secondaryById('white_berries');
        expect(w.bankName).toBe('Ardougne West');
        expect(w.bank).toEqual({ x: 2616, z: 3332, level: 0 });
    });
});
