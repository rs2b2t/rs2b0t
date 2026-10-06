import { expect, test } from 'bun:test';
import { auditSupplies, shoppingStops } from '#/bot/scripts/AccountLeveler/shopping.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

function snapshot(levels: Record<string, number> = {}, stock: Record<string, number> = { coins: 500000 }): LevelerSnapshot {
    return { levels: { attack: 20, strength: 20, defence: 20, hitpoints: 25, ranged: 5, magic: 1, prayer: 1,
        fishing: 20, cooking: 15, woodcutting: 1, firemaking: 1, fletching: 1, mining: 1, smithing: 1,
        crafting: 1, agility: 1, thieving: 1, herblore: 3, runecraft: 1, ...levels }, stock,
    bankReady: true, quests: { 'Druidic Ritual': true }, target: 30, wilderness: false, now: 0 };
}

test('a wealthy bare bank gets a current usable kit and useful consumable batches before training', () => {
    const audit = auditSupplies(snapshot());
    const needs = Object.fromEntries(audit.needs.map(need => [need.item, need.count]));
    expect(needs).toMatchObject({ 'Mithril scimitar': 1, 'Mithril platebody': 1, 'Mithril platelegs': 1, 'Mithril full helm': 1,
        'Oak shortbow': 1, 'Staff of air': 1, 'Mind rune': 200, 'Bronze arrow': 1000, Feather: 1000,
        'Fly fishing rod': 1, 'Steel axe': 1, 'Iron pickaxe': 1, Tinderbox: 1, Knife: 1,
        Hammer: 1, Needle: 1, Thread: 100, 'Vial of water': 27, 'Eye of newt': 27 });
    expect(audit.needs.every(need => !need.carry && !need.equip)).toBe(true);
    expect(audit.needs.find(need => need.item === 'Oak shortbow')?.id).toBe(843);
    expect(audit.budget).toBeGreaterThan(0);
    expect(audit.budget + audit.reserve).toBeLessThanOrEqual(500000);
});

test('owned bank and equipment supply totals prevent another startup purchase', () => {
    const first = auditSupplies(snapshot());
    const stock: Record<string, number> = { coins: 500000 };
    for (const need of first.needs) stock[need.id === undefined ? need.item.toLowerCase() : `#${need.id}`] = need.count;
    expect(auditSupplies(snapshot({}, stock)).needs).toEqual([]);
    expect(auditSupplies(snapshot({}, stock)).budget).toBe(0);
});

test('low gold preserves travel money and skips unaffordable supplies', () => {
    const audit = auditSupplies(snapshot({}, { coins: 210 }));
    expect(audit.budget + audit.reserve).toBeLessThanOrEqual(210);
    expect(audit.reserve).toBeGreaterThanOrEqual(200);
    expect(audit.needs.some(need => need.item === 'Mithril scimitar')).toBe(false);
    expect(audit.skipped.length).toBeGreaterThan(0);
    expect(auditSupplies(snapshot({}, { coins: 30 })).needs).toEqual([]);
});

test('completed skills and future gear do not inflate the startup shopping list', () => {
    const s = snapshot();
    for (const skill of Object.keys(s.levels)) s.levels[skill] = 30;
    s.levels.ranged = 1;
    const audit = auditSupplies(s);
    expect(audit.needs).toEqual([{ item: 'Shortbow', id: 841, count: 1 }, { item: 'Bronze arrow', count: 1000 }]);
    s.stock.shortbow = 20;
    s.stock['#50'] = 20;
    expect(auditSupplies(s).needs.some(need => need.id === 841)).toBe(true);
    s.stock['#841'] = 1;
    expect(auditSupplies(s).needs.some(need => need.id === 841)).toBe(false);
});

test('shopping stops group missing purchases by vendor and use exact bow ids', () => {
    const stops = shoppingStops([{ item: 'Iron chainbody', count: 1 }, { item: 'Shortbow', id: 841, count: 1 },
        { item: 'Bronze arrow', count: 1000 }, { item: 'Iron platelegs', count: 1 }], { shortbow: 20, '#50': 20, 'iron platelegs': 1 });
    expect(stops.map(stop => ({ keeper: stop.keeper, needs: stop.needs.map(need => need.item) }))).toEqual([
        { keeper: 'Horvik', needs: ['Iron chainbody'] }, { keeper: 'Lowe', needs: ['Shortbow', 'Bronze arrow'] }
    ]);
});

test('locked herblore defers distant potion supplies until Druidic Ritual is complete', () => {
    const s = snapshot({ herblore: 1, attack: 1, strength: 1, defence: 1, hitpoints: 10 });
    s.quests['Druidic Ritual'] = false;
    const audit = auditSupplies(s);
    expect(audit.needs.some(need => need.item === 'Vial of water' || need.item === 'Eye of newt')).toBe(false);
    expect(shoppingStops(audit.needs, s.stock).some(stop => stop.keeper === 'Aemad')).toBe(false);
    expect(audit.needs).toContainEqual({ item: 'Iron scimitar', count: 1 });
});

test('cooking below trout level stocks a shrimp net even when fishing is already complete', () => {
    const s = snapshot();
    for (const skill of Object.keys(s.levels)) s.levels[skill] = 30;
    s.levels.cooking = 1;
    expect(auditSupplies(s).needs).toEqual([{ item: 'Small fishing net', count: 1 }]);
});

test('startup rune shopping matches the strongest affordable current spell', () => {
    const s = snapshot({ magic: 35 }, { coins: 1000000 }); s.target = 40;
    const audit = auditSupplies(s);
    expect(audit.needs).toContainEqual({ item: 'Chaos rune', count: 200 });
    expect(audit.needs).toContainEqual({ item: 'Fire rune', count: 800 });
    expect(audit.needs.some(need => need.item === 'Mind rune')).toBe(false);
});

test('a fresh account defers the underground pickaxe shop until combat is established', () => {
    const s = snapshot({ attack: 1, strength: 1, defence: 1, hitpoints: 10 });
    const audit = auditSupplies(s);
    expect(audit.needs.some(need => /pickaxe$/i.test(need.item))).toBe(false);
    expect(audit.skipped.some(message => message.includes('Nurmof'))).toBe(true);
});
