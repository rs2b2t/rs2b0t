import { afterEach, expect, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { foodCount } from '#/bot/api/combat/food.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Input } from '#/bot/input/Input.js';
import { siteFor } from '#/bot/scripts/JiveDragons/sites.js';
import { food, restoreSafety, safetyScenario, shield } from './safety.fixture.js';

afterEach(restoreSafety);

for (const [name, id] of [['Lobster', 379], ['Shark', 385]] as const) {
    async function setup() {
        const fixture = await safetyScenario('dragons', {
            site: 'heroes-blue', combatStyle: 'melee', weapon: 'Rune scimitar',
            food: name, foodWithdraw: 3, usePotions: false, leaveVia: 'walk'
        });
        fixture.state.tile = siteFor('heroes-blue').bank;
        fixture.state.worn = [shield(), { ...food('Rune scimitar', 1333), slot: 3 }];
        const note = { ...food(name, id + 1), count: 100, noted: true, ops: ['Drop'] };
        fixture.state.pack = [note];
        fixture.state.bank = Array.from({ length: 3 }, (_, slot) => ({ ...food(name, id), slot }));
        return fixture;
    }

    test(`${name} certificates trigger banking when edible food runs out`, async () => {
        const { task } = await setup();
        expect(task('BankRun').validate()).toBe(true);
    });

    test(`banking deposits noted ${name} and withdraws edible food`, async () => {
        const { bot, state, task } = await setup();
        state.pack[0].ops = ['Deposit-All'];
        spyOn(Bank, 'depositAllMatching').mockRestore();
        spyOn(Input, 'invButton').mockImplementation((itemId, slot) => {
            const held = state.pack.find(i => i.id === itemId && i.slot === slot);
            if (!held || !state.open) return false;
            state.pack = state.pack.filter(i => i !== held);
            state.bank.push({ ...held, id, noted: false });
            return true;
        });
        await task('BankRun').execute();
        expect(state.pack.some(i => i.id === id + 1)).toBe(false);
        expect(Inventory.countById(id)).toBe(3);
        expect(foodCount(Inventory.items(), name)).toBe(3);
        expect(state.bank.some(i => i.id === id && i.count === 100)).toBe(true);
        expect(bot.bankTrips).toBe(1);
    });

    test(`eating skips a ${name} certificate before real food`, async () => {
        const { bot, state, interact } = await setup();
        interact.mockRestore();
        state.hp = 50;
        state.pack.push({ ...food(name, id), slot: 1 });
        spyOn(Input, 'heldOp').mockImplementation((itemId, slot) => {
            const held = state.pack.find(i => i.id === itemId && i.slot === slot);
            if (!held || !held.ops.includes('Eat')) return false;
            state.pack = state.pack.filter(i => i !== held);
            state.hp += name === 'Shark' ? 20 : 12;
            return true;
        });
        expect(await bot.eatOnce()).toBe(true);
        expect(Inventory.countById(id)).toBe(0);
        expect(Inventory.countById(id + 1)).toBe(100);
    });
}
