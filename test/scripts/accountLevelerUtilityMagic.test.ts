import { expect, test } from 'bun:test';
import { methodFor } from '#/bot/scripts/AccountLeveler/methods.js';
import { enabledSkills, emptyMemory, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import { auditSupplies } from '#/bot/scripts/AccountLeveler/shopping.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

function snapshot(magic: number, smithing: number, stock: Record<string, number>): LevelerSnapshot {
    return { levels: { ...Object.fromEntries(enabledSkills.map(skill => [skill, 60])), magic, smithing },
        stock: { coins: 10000, 'staff of fire': 1, 'nature rune': 3, ...stock }, bankReady: true,
        quests: {}, allowQuests: false, target: 70, wilderness: false, now: 1 };
}

const select = (s: LevelerSnapshot, objective = 'magic') => methodFor(s, objective, emptyMemory(), () => 0.99)!;

test.each(['magic', 'smithing'])('%s superheats one complete steel recipe ahead of combat or furnace work', objective => {
    const s = snapshot(43, 30, { 'iron ore': 4, coal: 3, 'mithril ore': 25, 'chaos rune': 200 });
    const plan = select(s, objective);
    expect(plan).toMatchObject({ script: 'Superheater', objective, settings: { bar: 'Steel' } });
    expect(plan.needs).toContainEqual({ item: 'Coal', count: 2 });
    expect(resolveActivity(s, plan, emptyMemory(), Math.random)).toMatchObject({ kind: 'activity', plan: { script: 'Superheater' } });
});

test('recipe eligibility includes Smithing, Magic and the stocked fire staff', () => {
    const s = snapshot(42, 40, { 'gold ore': 2 });
    expect(select(s).script).not.toBe('Superheater');
    s.levels.magic = 43;
    expect(select(s)).toMatchObject({ script: 'Superheater', settings: { bar: 'Gold', goldsmithGauntlets: false } });
    s.levels.smithing = 39;
    expect(select(s).script).not.toBe('Superheater');
});

test('casts one banked blue hide by id and skips the combat rune shopping trip', () => {
    const s = snapshot(55, 30, { '#2499': 1, 'dragonhide body': 40, 'staff of fire': 0, 'fire battlestaff': 1 });
    expect(select(s)).toMatchObject({ script: 'Alcher', settings: { items: ['blue_dragonhide_body'], alchs: 1 } });
    expect(auditSupplies(s).needs.some(n => / rune$/.test(n.item))).toBe(false);
    s.levels.magic = 54;
    expect(select(s).script).not.toBe('Alcher');
});

test('quotes only castable alchables, capped at high alch value less the nature rune', () => {
    const s = snapshot(55, 30, { '#66': 5, 'yew longbow': 5 });
    s.marketItem = need => need.id === 855 ? need.id : undefined;
    const plan = select(s);
    expect(plan).toMatchObject({ script: 'SeersMarket', output: { id: 855, count: 3 }, settings: { reserve: 1000, maxUnitPrice: 413 } });
    s.stock.coins = 200;
    expect(select(s).script).not.toBe('SeersMarket');
    s.stock.coins = 10000;
    s.stock['nature rune'] = 0;
    expect(select(s).script).not.toBe('SeersMarket');
});

test('uses stocked fires for either spell and includes them in the alch quote cap', () => {
    const s = snapshot(55, 30, { 'staff of fire': 0, 'fire rune': 9, 'iron ore': 6, coal: 5 });
    expect(select(s)).toMatchObject({ script: 'Superheater', settings: { useFireRunes: true } });
    expect(select(s).needs).toContainEqual({ item: 'Fire rune', count: 8 });
    s.stock['#855'] = 2;
    expect(select(s)).toMatchObject({ script: 'Alcher', settings: { useFireRunes: true, alchs: 1 } });
    expect(select(s).needs).toContainEqual({ item: 'Fire rune', count: 5 });
    Object.assign(s.stock, { '#855': 0, 'iron ore': 0 });
    s.marketItem = need => need.id === 855 ? need.id : undefined;
    expect(select(s)).toMatchObject({ script: 'SeersMarket', settings: { maxUnitPrice: 288 }, output: { count: 1 } });
});

test('budgets a usable basic staff from Zaff when the bank has ores and no fire source', () => {
    const s = snapshot(43, 30, { 'staff of fire': 0, 'iron ore': 2 });
    s.target = 55;
    expect(select(s)).toMatchObject({ script: 'Superheater' });
    expect(select(s).needs).toContainEqual({ item: 'Staff of fire', count: 1, carry: 1, equip: true });
    expect(auditSupplies(s).needs).toContainEqual({ item: 'Staff of fire', count: 1 });
    s.stock.coins = 200;
    expect(select(s).script).not.toBe('Superheater');
});
