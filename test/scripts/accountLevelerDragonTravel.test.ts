import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { dragonTeleport } from '#/bot/scripts/AccountLeveler/dragonTravel.js';
import { dragonPrayer } from '#/bot/scripts/AccountLeveler/dragons.js';
import { combatPlan, foodFor } from '#/bot/scripts/AccountLeveler/combat.js';
import { emptyMemory, enabledSkills, resolveActivity } from '#/bot/scripts/AccountLeveler/planner.js';
import type { LevelerSnapshot } from '#/bot/scripts/AccountLeveler/types.js';
import { refreshConsumables } from '#/bot/scripts/AccountLeveler/catalog.js';
import { producer } from '#/bot/scripts/AccountLeveler/methods.js';
import AccountLeveler from '#/bot/scripts/AccountLeveler/AccountLeveler.js';
import { BankTeleport } from '#/bot/api/bank/BankTeleport.js';

afterEach(() => mock.restore());

const snapshot = (): LevelerSnapshot => ({
    levels: Object.fromEntries(enabledSkills.map(skill => [skill, 70])),
    stock: { coins: 1000000, lobster: 100, 'law rune': 10, 'air rune': 100, 'water rune': 100, 'fire rune': 100,
        'dragon longsword': 1, 'dragonfire shield': 1, 'dusty key': 1, 'bronze axe': 1 },
    quests: { 'Dragon Slayer': true, 'Lost City': true, 'Plague City': true, 'Rune Mysteries Quest': true },
    bankReady: true, target: 80, wilderness: false, now: 1000
});

test('adult blue dragon trips stock Falador escapes and use the longsword stab style', () => {
    const plan = dragonPrayer(snapshot(), emptyMemory(), () => 0)!;
    expect(plan.settings).toMatchObject({ leaveVia: 'teleport', meleeStyle: 'controlled' });
    expect(plan.bankTeleport).toBe('Falador');
    expect(plan.needs).toContainEqual({ item: 'Law rune', count: 3, carry: 3 });
});

test('adult red dragon Prayer trips bury bones and carry the Wilderness escape', () => {
    const s = snapshot();
    s.wilderness = true;
    expect(dragonPrayer(s, emptyMemory(), () => 0.5)).toMatchObject({ id: 'prayer-red-dragons',
        bankTeleport: 'Varrock', settings: { target: 'Red dragon', meleeStyle: 'controlled', escape: 'Teleport to Varrock', buryBones: true } });
});

test.each([['Baby blue dragon', 'Falador'], ['Baby red dragon', 'Ardougne']])('%s carries an escape and uses controlled longsword', (target, teleport) => {
    const plan = combatPlan(snapshot(), 'prayer', emptyMemory(), () => 0, undefined, target)!;
    expect(plan.settings).toMatchObject({ bankTeleport: teleport, meleeStyle: 'controlled' });
    expect(plan.needs.some(need => need.item === 'Law rune' && (need.carry ?? 0) > 0)).toBe(true);
});

test('Brimhaven falls back to Camelot when Ardougne is locked', () => {
    const s = snapshot(); s.quests['Plague City'] = false;
    expect(dragonTeleport(s, 'red').name).toBe('Camelot');
});

test('missing escape supplies do not block an otherwise viable dragon trip', () => {
    const s = snapshot(); s.stock['law rune'] = 0;
    const plan = dragonPrayer(s, emptyMemory(), () => 0)!;
    expect(plan.needs.some(need => need.item === 'Law rune')).toBe(false);
    expect(resolveActivity(s, plan, emptyMemory(), () => 0).kind).toBe('activity');
    s.levels.magic = 1;
    expect(dragonTeleport(s, 'blue')).toEqual({ name: 'Off', needs: [] });
});

test('unstocked escape runes can be crafted with the Law crafting requirements', () => {
    const s = snapshot(); s.stock['law rune'] = 0; s.stock['law talisman'] = 1;
    const plan = dragonPrayer(s, emptyMemory(), () => 0)!;
    const decision = resolveActivity(s, plan, emptyMemory(), () => 0);
    expect(decision.kind).toBe('activity');
    if (decision.kind === 'activity') expect(decision.queue.some(step => step.settings.rune === 'Law runes')).toBe(true);
});

test('sharks become the food for general, adult and baby dragon trips when sustainable', () => {
    const s = snapshot(); s.levels.fishing = 76; s.levels.cooking = 80;
    expect(foodFor(s)).toBe('Shark');
    expect(dragonPrayer(s, emptyMemory(), () => 0)?.food).toBe('Shark');
    const baby = combatPlan(s, 'prayer', emptyMemory(), () => 0, undefined, 'Baby red dragon')!;
    expect(baby.food).toBe('Shark');
    expect(baby.settings.food).toBe('Shark');
    s.levels.cooking = 79;
    expect(foodFor(s)).toBe('Lobster');
    s.stock.shark = 40;
    expect(foodFor(s)).toBe('Shark');
});

test('shark food dependencies fish and bank sharks before cooking them', () => {
    const s = snapshot(); s.levels.fishing = 76; s.levels.cooking = 80;
    const cook = producer(s, 'prayer', { item: 'Shark', count: 40 }, emptyMemory(), () => 0)!;
    expect(cook).toMatchObject({ script: 'CookBot', settings: { fish: 'Raw shark' }, output: { item: 'Shark', count: 40 } });
    const decision = resolveActivity(s, cook, emptyMemory(), () => 0);
    expect(decision.kind).toBe('activity');
    if (decision.kind === 'activity') expect(decision.plan.settings).toMatchObject({ fishMethod: 'Harpoon — sharks', bank: true });
});

test('mage resupply retains escape runes beyond the combat cast budget', () => {
    const s = snapshot();
    const plan = combatPlan(s, 'magic', emptyMemory(), () => 0, undefined, 'Baby blue dragon')!;
    const refreshed = refreshConsumables(s, plan);
    expect(refreshed.needs).toContainEqual({ item: 'Law rune', count: 1, carry: 1 });
    expect(refreshed.needs.find(need => need.item === 'Water rune')?.count).toBeGreaterThanOrEqual(1);
});

test('leveler session changes use the dragon escape before opening the next bank', async () => {
    const bot = new AccountLeveler();
    const events: string[] = [];
    bot.bindLog(() => {});
    bot['displayPlan'] = dragonPrayer(snapshot(), emptyMemory(), () => 0)!;
    spyOn(BankTeleport, 'cast').mockImplementation(async name => { events.push(`teleport:${name}`); return true; });
    spyOn(bot['supplies'], 'bank').mockImplementation(async () => { events.push('bank'); throw new Error('stop at bank'); });
    try {
        await expect(bot['selectAndStart']()).rejects.toThrow('stop at bank');
        expect(events).toEqual(['teleport:Falador', 'bank']);
    } finally { bot.onStop(); }
});
