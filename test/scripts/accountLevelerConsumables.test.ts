import { expect, test } from 'bun:test';
import { canCatch, FISH, refreshConsumables } from '#/bot/scripts/AccountLeveler/catalog.js';
import { magicEquipment } from '#/bot/scripts/AccountLeveler/magic.js';
import { methodFor } from '#/bot/scripts/AccountLeveler/methods.js';
import { emptyMemory, enabledSkills, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';

function snapshot(stock: Record<string, number>, levels: Record<string, number> = {}): LevelerSnapshot {
    return { levels: { ...Object.fromEntries(enabledSkills.map(skill => [skill, 40])), ...levels },
        stock: { shrimps: 24, ...stock }, bankReady: true, quests: {}, target: 50, wilderness: false, now: 1 };
}
const method = (s: LevelerSnapshot, skill: string) => methodFor(s, skill, emptyMemory(), () => 0)!;

test.each([1, 8, 299, 300, 1000])('ranged starts with %i banked arrows instead of requiring a refill', arrows => {
    const s = snapshot({ '#843': 1, 'bronze arrow': arrows, coins: 0 });
    s.unavailableItems = ['bronze arrow'];
    const plan = method(s, 'ranged');
    expect(plan.needs.find(need => need.item === 'Bronze arrow')).toEqual({ item: 'Bronze arrow', count: Math.min(300, arrows), carry: Math.min(300, arrows), equip: true, minimum: 1 });
    expect(plan.settings.ammoWithdraw).toBe(Math.min(300, arrows));
    expect(resolveActivity(s, plan, emptyMemory(), () => 0).kind).toBe('activity');
});

test('empty ranged supplies request a useful refill with a one-arrow minimum', () => {
    const plan = method(snapshot({ coins: 100000, '#843': 1 }), 'ranged');
    expect(plan.needs.find(need => need.item === 'Bronze arrow')).toMatchObject({ count: 300, carry: 300, minimum: 1 });
});

test('ready mind runes are used before buying an ideal expensive chaos batch', () => {
    const s = snapshot({ coins: 500000, 'staff of air': 1, 'mind rune': 40 }, { magic: 35 });
    const kit = magicEquipment(s);
    expect(kit.spell).toBe('Wind Strike');
    expect(kit.casts).toBe(40);
    expect(kit.needs).toEqual([{ item: 'Staff of air', count: 1, carry: 1, equip: true },
        { item: 'Mind rune', count: 40, carry: 40, minimum: 1 }]);
    expect(method(s, 'magic').settings.runesWithdraw).toBe(40);
});

test('multi-rune spells round every supply down to the same complete cast batch', () => {
    const s = snapshot({ coins: 0, 'staff of air': 1, 'chaos rune': 8, 'fire rune': 31 }, { magic: 35 });
    const kit = magicEquipment(s);
    expect(kit.spell).toBe('Fire Bolt');
    expect(kit.casts).toBe(7);
    expect(kit.needs).toContainEqual({ item: 'Chaos rune', count: 7, carry: 7, minimum: 1 });
    expect(kit.needs).toContainEqual({ item: 'Fire rune', count: 28, carry: 28, minimum: 4 });
    expect(kit.needs.some(need => need.item === 'Air rune')).toBe(false);
    expect(resolveActivity(s, method(s, 'magic'), emptyMemory(), () => 0).kind).toBe('activity');
});

test('a stronger spell with less than one complete cast falls back to usable wind runes', () => {
    const kit = magicEquipment(snapshot({ coins: 0, 'staff of air': 1, 'chaos rune': 8, 'fire rune': 3, 'earth rune': 2 }, { magic: 35 }));
    expect(kit.spell).toBe('Wind Bolt');
    expect(kit.casts).toBe(8);
    expect(kit.needs).toContainEqual({ item: 'Chaos rune', count: 8, carry: 8, minimum: 1 });
});

test('full banked rune supplies retain reserve casts and the smaller carried batch', () => {
    const kit = magicEquipment(snapshot({ coins: 0, 'staff of air': 1, 'chaos rune': 500, 'fire rune': 2000 }, { magic: 35 }));
    expect(kit.spell).toBe('Fire Bolt');
    expect(kit.casts).toBe(150);
    expect(kit.needs).toContainEqual({ item: 'Chaos rune', count: 200, carry: 150, minimum: 1 });
    expect(kit.needs).toContainEqual({ item: 'Fire rune', count: 800, carry: 600, minimum: 4 });
});

test('no complete rune batch cannot resolve to a zero-cast training activity', () => {
    const s = snapshot({ coins: 0, 'staff of air': 1, 'fire rune': 3 }, { magic: 35 });
    const plan = method(s, 'magic');
    expect(plan.needs.every(need => need.count > 0)).toBe(true);
    expect(Number(plan.settings.runesWithdraw)).toBeGreaterThan(0);
    expect(resolveActivity(s, plan, emptyMemory(), () => 0).kind).toBe('blocked');
});

test('a rune batch does not waive the air staff requirement', () => {
    const s = snapshot({ coins: 0, 'mind rune': 40 }, { magic: 35 });
    expect(method(s, 'magic').needs).toContainEqual({ item: 'Staff of air', count: 1, carry: 1, equip: true });
    expect(resolveActivity(s, method(s, 'magic'), emptyMemory(), () => 0).kind).toBe('blocked');
});

test('fly fishing uses seven owned feathers even when shop feathers are unavailable', () => {
    const s = snapshot({ coins: 0, 'fly fishing rod': 1, feather: 7 }, { fishing: 20 });
    s.unavailableItems = ['feather'];
    expect(canCatch(s, FISH[1])).toBe(true);
    const plan = method(s, 'fishing');
    expect(plan.needs).toContainEqual({ item: 'Feather', count: 7, carry: 7, minimum: 1 });
    expect(plan.settings.baitQty).toBe(7);
    expect(resolveActivity(s, plan, emptyMemory(), () => 0).kind).toBe('activity');
});

test('empty feathers require a refill and a missing unavailable net is not a valid fallback', () => {
    const s = snapshot({ coins: 100000, 'fly fishing rod': 1 }, { fishing: 20 });
    expect(method(s, 'fishing').needs).toContainEqual({ item: 'Feather', count: 200, carry: 200, minimum: 1 });
    s.unavailableItems = ['feather', 'small fishing net'];
    expect(canCatch(s, FISH[1])).toBe(false);
    expect(canCatch(s, FISH[0])).toBe(false);
    s.stock['small fishing net'] = 1;
    expect(canCatch(s, FISH[0])).toBe(true);
});

test('an exhausted eight-arrow retry restores the policy refill while preserving its camp and output', () => {
    const plan = method(snapshot({ '#843': 1, 'bronze arrow': 8, coins: 0 }), 'ranged');
    plan.output = { item: 'Cow hide', count: 26 };
    const refreshed = refreshConsumables(snapshot({ '#843': 1, coins: 500000 }), plan);
    expect(refreshed.needs.find(need => need.item === 'Bronze arrow')).toEqual({ item: 'Bronze arrow', count: 300, carry: 300, minimum: 1, equip: true });
    expect(refreshed.settings.ammoWithdraw).toBe(300);
    expect(refreshed.id).toBe(plan.id);
    expect(refreshed.travel).toEqual(plan.travel);
    expect(refreshed.output).toEqual({ item: 'Cow hide', count: 26 });
    expect(refreshed.needs.filter(need => !need.minimum)).toEqual(plan.needs.filter(need => !need.minimum));
    expect(plan.settings.ammoWithdraw).toBe(8);
});

test('retrying a former eight-arrow batch uses the newly banked 87 arrows', () => {
    const plan = method(snapshot({ '#843': 1, 'bronze arrow': 8, coins: 0 }), 'ranged');
    const refreshed = refreshConsumables(snapshot({ '#843': 1, 'bronze arrow': 87, coins: 500000 }), plan);
    expect(refreshed.needs.find(need => need.item === 'Bronze arrow')).toMatchObject({ count: 87, carry: 87, minimum: 1 });
    expect(refreshed.settings.ammoWithdraw).toBe(87);
});

test('an exhausted eight-cast retry restores the same spell to 200 reserve and 150 carried casts', () => {
    const plan = method(snapshot({ 'staff of air': 1, 'chaos rune': 8, 'fire rune': 32, coins: 0 }, { magic: 35 }), 'magic');
    const refreshed = refreshConsumables(snapshot({ 'staff of air': 1, coins: 500000 }, { magic: 35 }), plan);
    expect(refreshed.settings.spell).toBe('Fire Bolt');
    expect(refreshed.settings.runesWithdraw).toBe(150);
    expect(refreshed.needs).toContainEqual({ item: 'Chaos rune', count: 200, carry: 150, minimum: 1 });
    expect(refreshed.needs).toContainEqual({ item: 'Fire rune', count: 800, carry: 600, minimum: 4 });
    expect(refreshed.id).toBe(plan.id);
});

test('a mage retry rounds newly available runes to the same positive complete cast batch', () => {
    const plan = method(snapshot({ 'staff of air': 1, 'chaos rune': 8, 'fire rune': 32, coins: 0 }, { magic: 35 }), 'magic');
    const refreshed = refreshConsumables(snapshot({ 'staff of air': 1, 'chaos rune': 87, 'fire rune': 131, coins: 500000 }, { magic: 35 }), plan);
    expect(refreshed.settings.runesWithdraw).toBe(32);
    expect(refreshed.needs).toContainEqual({ item: 'Chaos rune', count: 32, carry: 32, minimum: 1 });
    expect(refreshed.needs).toContainEqual({ item: 'Fire rune', count: 128, carry: 128, minimum: 4 });
});

test('an exhausted seven-feather retry restores its 200-feather target and remains blocked when unavailable', () => {
    const plan = method(snapshot({ 'fly fishing rod': 1, feather: 7, coins: 0 }, { fishing: 20 }), 'fishing');
    const s = snapshot({ 'fly fishing rod': 1, coins: 500000 }, { fishing: 20 });
    s.unavailableItems = ['feather'];
    const refreshed = refreshConsumables(s, plan);
    expect(refreshed.needs).toContainEqual({ item: 'Feather', count: 200, carry: 200, minimum: 1 });
    expect(refreshed.settings.baitQty).toBe(200);
    expect(resolveActivity(s, refreshed, emptyMemory(), () => 0).kind).toBe('blocked');
});

test('leather crafting uses available thread and restores its target after consuming it', () => {
    const s = snapshot({ coins: 100000, thread: 8, leather: 26, needle: 1 }, { crafting: 5 });
    const plan = method(s, 'crafting');
    expect(plan.settings.threadPerTrip).toBe(8);
    expect(plan.needs.find(need => need.item === 'Thread')).toMatchObject({ count: 8, carry: 8, minimum: 1 });
    s.stock.thread = 0;
    const refreshed = refreshConsumables(s, plan);
    expect(refreshed.settings.threadPerTrip).toBe(100);
});
