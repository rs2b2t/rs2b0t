import { afterEach, expect, spyOn, test } from 'bun:test';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { scenario, restoreScenario } from './scheduler.fixture.js';

afterEach(restoreScenario);

test('melee drinks the complete due set before handing control to a long fight', async () => {
    const fixture = await scenario('taverley-blue', 'melee', { usePotions: true });
    const levels: Record<string, number> = { attack: 75, strength: 75, defence: 75 };
    const potions = ['attack', 'strength', 'defence'].map((skill, slot) => new InvItem({ id: slot + 1, name: `Super ${skill}(3)`, count: 1, slot, comId: 3214, ops: ['Drink'] }));
    spyOn(Inventory, 'items').mockReturnValue(potions);
    spyOn(Inventory, 'count').mockImplementation(name => potions.some(potion => potion.name === name) ? 1 : 0);
    spyOn(Skills, 'level').mockReturnValue(75);
    spyOn(Skills, 'effective').mockImplementation(skill => levels[skill] ?? 90);
    spyOn(InvItem.prototype, 'interact').mockImplementation(function (this: InvItem, op) {
        if (op === 'Drink') levels[this.name!.split(' ')[1]!.split('(')[0]!] = 91;
        return true;
    });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async predicate => predicate());

    await fixture.task('SipPotion').execute();

    expect(levels).toEqual({ attack: 91, strength: 91, defence: 91 });
});

test('blue dragon melee drinks super defence as part of its super set', async () => {
    const fixture = await scenario('taverley-blue', 'melee', { usePotions: true });
    const sip = fixture.task('SipPotion');
    spyOn(sip, 'validate').mockRestore();
    let defence = 70;
    const potion = new InvItem({ id: 163, name: 'Super defence(3)', count: 1, slot: 0, comId: 3214, ops: ['Drink'] });
    spyOn(Inventory, 'items').mockReturnValue([potion]);
    spyOn(Inventory, 'count').mockImplementation(name => name === potion.name ? 1 : 0);
    spyOn(Skills, 'level').mockReturnValue(70);
    spyOn(Skills, 'effective').mockImplementation(skill => skill === 'defence' ? defence : 90);
    spyOn(InvItem.prototype, 'interact').mockImplementation(op => { if (op === 'Drink') defence = 85; return true; });
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async predicate => predicate());

    expect(sip.validate()).toBe(true);
    await sip.execute();
    expect(defence).toBe(85);
});

test('disabling melee potions does not drink super defence', async () => {
    const fixture = await scenario('taverley-blue', 'melee', { usePotions: false });
    const sip = fixture.task('SipPotion');
    spyOn(sip, 'validate').mockRestore();
    expect(sip.validate()).toBe(false);
    expect(fixture.bot.keepExtra()).not.toContain('Super defence(3)');
});
