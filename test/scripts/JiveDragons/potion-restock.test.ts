import { afterEach, expect, spyOn, test } from 'bun:test';
import { reader, type InvItemSnapshot } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Loadouts } from '#/bot/api/loadout/loadoutStore.js';
import { Input } from '#/bot/input/Input.js';
import { siteFor } from '#/bot/scripts/JiveDragons/sites.js';
import { restoreSafety, safetyScenario, shield } from './safety.fixture.js';

afterEach(restoreSafety);

const names = ['Super attack', 'Super strength', 'Super defence'];
const item = (name: string, slot: number): InvItemSnapshot => ({
    id: 1000 + slot, name, slot, count: 1, comId: 3214, ops: ['Deposit-All']
});

for (const { doses, fresh, want } of [
    { doses: [1, 1, 1], fresh: 3, want: 1 },
    { doses: [2, 2, 2], fresh: 3, want: 1 },
    { doses: [1, 3, 2], fresh: 3, want: 1 },
    { doses: [3, 3, 3], fresh: 3, want: 1 },
    { doses: [3, 3, 3], fresh: 4, want: 2 }
]) {
    test(`banking replaces ${doses} dose supers with ${want} x ${fresh}-dose flasks`, async () => {
        const { bot, state, task } = await safetyScenario('dragons', {
            site: 'heroes-blue', combatStyle: 'melee', weapon: 'Rune scimitar',
            usePotions: true, foodWithdraw: 1, leaveVia: 'walk'
        });
        if (fresh === 4) {
            spyOn(Loadouts, 'all').mockReturnValue([{ name: 'supers', worn: {}, carry: names.map(name => ({ item: `${name}(4)`, qty: 2 })) }]);
            await bot.onStart();
        }
        state.tile = siteFor('heroes-blue').bank;
        state.pack = [item('Lobster', 0), ...names.map((name, i) => item(`${name}(${doses[i]})`, i + 1))];
        state.worn = [shield(), item('Rune scimitar', 10)];
        state.bank = names.flatMap((name, i) => Array.from({ length: want }, (_, j) => item(`${name}(${fresh})`, 20 + i * want + j)));
        spyOn(Bank, 'depositAllMatching').mockRestore();
        spyOn(reader, 'bankSideItems').mockImplementation(() => state.pack);
        spyOn(Input, 'invButton').mockImplementation((id, slot) => {
            const held = state.pack.find(i => i.id === id && i.slot === slot);
            if (!held || !state.open) return false;
            state.pack = state.pack.filter(i => i !== held);
            state.bank.push(held);
            return true;
        });

        await task('BankRun').execute();

        expect(names.map(name => Inventory.count(`${name}(${fresh})`))).toEqual([want, want, want]);
        expect(state.pack.filter(i => i.name?.startsWith('Super ') && !i.name.endsWith(`(${fresh})`))).toEqual([]);
        expect(state.bank.filter(i => i.name?.startsWith('Super ') && !i.name.endsWith(`(${fresh})`)).map(i => i.name)).toEqual(
            names.flatMap((name, i) => doses[i] < fresh ? [`${name}(${doses[i]})`] : [])
        );
        for (let i = 0; i < names.length; i++) {
            expect(state.bank.some(item => item.name === `${names[i]}(${fresh})`)).toBe(doses[i] === fresh);
        }
        expect(bot.bankTrips).toBe(1);
    });
}
