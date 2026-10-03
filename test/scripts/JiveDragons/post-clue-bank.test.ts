import { afterEach, expect, spyOn, test } from 'bun:test';
import type { InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { siteFor } from '#/bot/scripts/JiveDragons/sites.js';
import type JiveDragons from '#/bot/scripts/JiveDragons/JiveDragons.js';
import { restoreSafety, safetyScenario, shield } from './safety.fixture.js';

afterEach(restoreSafety);

test('post-clue banking replaces the entire trail pack with the configured dragon supplies', async () => {
    const { bot, state, task } = await safetyScenario('dragons', {
        site: 'gutanoth-blue', combatStyle: 'melee', weapon: 'Dragon longsword', usePotions: true, foodWithdraw: 3, teleStock: 2
    });
    let nextId = 1000;
    const item = (name: string, count = 1): InvItemSnapshot => ({ id: nextId++, name, count, slot: nextId, comId: 3214, ops: ['Eat', 'Deposit-All'] });
    state.tile = siteFor('gutanoth-blue').bank;
    state.worn = [shield(), item('Dragon longsword')];
    state.pack = [
        ...['Spade', 'Sextant', 'Chart', 'Watch', 'Rune platelegs'].map(name => item(name)),
        ...['Air rune', 'Water rune', 'Fire rune', 'Earth rune', 'Law rune'].map(name => item(name, 50)),
        ...['Super attack(2)', 'Super strength(1)', 'Super defence(2)'].map(name => item(name)),
        item('Shark')
    ];
    state.bank = ['Shark', 'Shark', 'Shark', 'Super attack(3)', 'Super strength(3)', 'Super defence(3)'].map(name => item(name));
    spyOn(Bank, 'depositAllMatching').mockImplementation(async match => {
        const deposited = state.pack.filter(i => match(i.name ?? '', i.id));
        state.pack = state.pack.filter(i => !deposited.includes(i));
        state.bank.push(...deposited);
    });
    const withdraw = (name: string, count: number): boolean => {
        let moved = 0;
        for (const source of state.bank.filter(i => i.name === name && i.count > 0)) {
            const take = Math.min(count - moved, source.count);
            if (take <= 0) break;
            source.count -= take;
            if (name.endsWith(' rune')) {
                const held = state.pack.find(i => i.id === source.id);
                if (held) held.count += take;
                else state.pack.push({ ...source, count: take });
            }
            else for (let i = 0; i < take; i++) state.pack.push({ ...source, count: 1 });
            moved += take;
        }
        return moved > 0;
    };
    spyOn(Bank, 'withdraw').mockImplementation((name, op) => withdraw(name, op === 'Withdraw-10' ? 10 : op === 'Withdraw-5' ? 5 : 1));
    spyOn(Bank, 'withdrawX').mockImplementation(async (name, count) => withdraw(name, count));
    (bot as JiveDragons).clueRestock = true;

    await task('BankRun').execute();

    expect(state.pack.map(i => i.name).sort()).toEqual([
        'Earth rune', 'Law rune', 'Shark', 'Shark', 'Shark', 'Super attack(3)', 'Super defence(3)', 'Super strength(3)'
    ]);
    expect(Inventory.count('Earth rune')).toBe(6);
    expect(Inventory.count('Law rune')).toBe(6);
    expect(bot.bankTrips).toBe(1);
    expect((bot as JiveDragons).clueRestock).toBe(false);
});
