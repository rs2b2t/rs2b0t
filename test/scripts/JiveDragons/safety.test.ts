import { afterEach, expect, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Npc } from '#/bot/api/npcs/Npcs.js';
import JiveDragons from '#/bot/scripts/JiveDragons/JiveDragons.js';
import { Fight } from '#/bot/scripts/JiveDragons/combat.js';
import { bankRoutine } from '#/bot/scripts/JiveDragons/supply.js';
import { food, restoreSafety, safetyScenario, SHIELD, shield } from './safety.fixture.js';

afterEach(restoreSafety);

for (const kind of ['dragons', 'kbd'] as const) {
    test(`${kind} banks food to retrieve a bank-only shield from a full kept pack`, async () => {
        const { bot, state, site } = await safetyScenario(kind);
        state.pack.push(...Array.from({ length: 5 }, (_, i) => ({ ...state.pack[0], slot: 23 + i })));
        const valuables = state.pack.filter(i => i.count > 1).map(i => ({ ...i }));
        expect(Inventory.used()).toBe(28);
        const deposit = spyOn(Bank, 'deposit');
        const opts = { withdrawFood: true, runeCasts: 0, runeBuffer: 0, escapeStock: 0, healTo: 0, leave: async () => true };
        await bankRoutine(bot, site, opts);
        expect(Equipment.contains(SHIELD)).toBe(true);
        expect(state.bank.find(i => i.name === bot.foodName())?.count).toBe(1);
        expect(deposit).toHaveBeenCalledWith(bot.foodName(), 'Deposit-1');
        await bankRoutine(bot, site, opts);
        expect(Equipment.contains(SHIELD)).toBe(true);
        expect(deposit).toHaveBeenCalledTimes(1);
        expect(state.pack.filter(i => i.count > 1)).toEqual(valuables);
        expect(bot.parked).toBe(false);
    });

    for (const failure of ['refused', 'unconfirmed', 'closed', 'withdrawal']) {
        test(`${kind} retries full-pack shield preparation after ${failure}`, async () => {
            const { bot, state, site } = await safetyScenario(kind);
            state.pack.push(...Array.from({ length: 5 }, (_, i) => ({ ...state.pack[0], slot: 23 + i })));
            const deposit = spyOn(Bank, 'deposit');
            const originalDeposit = deposit.getMockImplementation()!;
            const withdrawal = spyOn(Bank, 'withdraw');
            const originalWithdrawal = withdrawal.getMockImplementation()!;
            if (failure === 'refused') deposit.mockReturnValue(false);
            if (failure === 'unconfirmed') deposit.mockReturnValue(true);
            if (failure === 'closed') deposit.mockImplementation(() => { state.open = false; return true; });
            if (failure === 'withdrawal') withdrawal.mockReturnValue(false);
            const opts = { withdrawFood: true, runeCasts: 0, runeBuffer: 0, escapeStock: 0, healTo: 0, leave: async () => true };
            await bankRoutine(bot, site, opts);
            expect(bot.bankTrips).toBe(0);
            expect(bot.parked).toBe(false);
            expect(Equipment.contains(SHIELD)).toBe(false);
            expect(state.bank.some(i => i.name === SHIELD)).toBe(true);
            if (failure !== 'withdrawal') expect(withdrawal).not.toHaveBeenCalledWith(SHIELD, expect.any(String));
            deposit.mockImplementation(originalDeposit);
            withdrawal.mockImplementation(originalWithdrawal);
            await bankRoutine(bot, site, opts);
            expect(Equipment.contains(SHIELD)).toBe(true);
            expect(bot.bankTrips).toBe(1);
        });
    }

    test(`${kind} fetches a bank-only shield before entering with food and runes held`, async () => {
        const { bot, task, site } = await safetyScenario(kind);
        expect(Bank.count(SHIELD)).toBe(0);
        expect(bot.parked).toBe(false);
        expect(await task('BankRun').validate()).toBe(true);
        expect(await task('EnterLair').validate()).toBe(false);
        await bankRoutine(bot, site, { withdrawFood: false, runeCasts: 0, runeBuffer: 0, escapeStock: 0, healTo: 0, leave: async () => true });
        expect(Equipment.contains(SHIELD)).toBe(true);
        expect(bot.parked).toBe(false);
        expect(await task('EnterLair').validate()).toBe(true);
    });

    test(`${kind} cannot enter with a shield that fails to equip`, async () => {
        const { state, task } = await safetyScenario(kind);
        state.pack.push(shield());
        spyOn(Equipment, 'equip').mockResolvedValue(false);
        await task('GearEquip').execute();
        expect(await task('EnterLair').validate()).toBe(false);
    });

    for (const bank of ['missing', 'unloaded', 'failed-open', 'closed-mid-withdrawal']) {
        test(`${kind} only parks for a shield confirmed missing from a ready bank: ${bank}`, async () => {
            const { bot, state, site } = await safetyScenario(kind);
            expect(bot.parked).toBe(false);
            if (bank === 'missing') state.bank = [];
            if (bank === 'unloaded') state.loaded = false;
            if (bank === 'failed-open') state.openAllowed = false;
            if (bank === 'closed-mid-withdrawal') spyOn(Bank, 'withdraw').mockImplementation(() => { state.open = false; return false; });
            await bankRoutine(bot, site, { withdrawFood: false, runeCasts: 0, runeBuffer: 0, escapeStock: 0, healTo: 0, leave: async () => true });
            expect(bot.parked).toBe(bank === 'missing');
            if (bank !== 'missing') expect(bot.bankTrips).toBe(0);
        });
    }

    test(`${kind} rejects attacks without the required equipped shield`, async () => {
        const { state, task, site } = await safetyScenario(kind);
        state.tile = site.safespots[0]!;
        const target = { index: 17, id: 1, name: site.target, anim: -1, level: 227, size: 3, tile: { ...state.tile, x: state.tile.x + 3 }, distance: 3, ops: ['Attack'], inCombat: false, health: 100, totalHealth: 200, faceEntity: -1 };
        state.npcs = [target];
        const attack = spyOn(Npc.prototype, 'interact').mockReturnValue(true);
        const fight = task('Fight') as Fight;
        expect(fight.validate()).toBe(false);
        expect(await fight['engage'](new Npc(target), site.target)).toBe(false);
        expect(attack).not.toHaveBeenCalled();
        state.worn.push(shield());
        expect(fight.validate()).toBe(true);
        expect(await fight['engage'](new Npc(target), site.target)).toBe(true);
        state.worn = state.worn.filter(i => i.name !== SHIELD);
        let polls = 0;
        spyOn(EventSignal, 'pending').mockImplementation(() => ++polls > 4);
        const upkeep = spyOn(Execution, 'delayTicks');
        upkeep.mockClear();
        await fight.execute();
        expect(upkeep).not.toHaveBeenCalled();
        expect(attack).toHaveBeenCalledTimes(1);
    });
}

test('Dragons does not force shield banking while a clue owns equipment', async () => {
    const { bot, task } = await safetyScenario('dragons');
    const dragons = bot as JiveDragons;
    expect(dragons.solveClue).not.toBeNull();
    spyOn(dragons.solveClue!, 'ownsEquipment').mockReturnValue(true);
    expect(await task('BankRun').validate()).toBe(false);
});

test('Dragons rechecks the shield after arming a special', async () => {
    const { bot, state, task, site } = await safetyScenario('dragons');
    state.worn.push(shield());
    state.tile = site.safespots[0]!;
    const target = { index: 17, id: 1, name: site.target, anim: -1, level: 227, size: 3, tile: { ...state.tile, x: state.tile.x + 3 }, distance: 3, ops: ['Attack'], inCombat: false, health: 100, totalHealth: 200, faceEntity: -1 };
    state.npcs = [target];
    spyOn(bot as JiveDragons, 'armSpecial').mockImplementation(async () => { state.worn = state.worn.filter(i => i.name !== SHIELD); });
    const attack = spyOn(Npc.prototype, 'interact').mockReturnValue(true);
    expect(await (task('Fight') as Fight)['engage'](new Npc(target), site.target)).toBe(false);
    expect(attack).not.toHaveBeenCalled();
});

test('shared bank healing confirms each cake form despite offsetting damage', async () => {
    const { bot, state, site, interact } = await safetyScenario('kbd', { food: 'Cake' });
    state.pack = [food('Cake', 1891)];
    state.worn.push(shield());
    state.hp = 30;
    const forms = [food('2/3 cake', 1893), food('Slice of cake', 1895)];
    interact.mockImplementation(() => {
        const next = forms.shift();
        state.pack = next ? [next] : [];
        state.hp--;
        return true;
    });
    const ticks = spyOn(Execution, 'delayUntilTicks');
    ticks.mockClear();
    await bankRoutine(bot, site, { withdrawFood: false, runeCasts: 0, runeBuffer: 0, escapeStock: 0, healTo: 0.9, leave: async () => true });
    expect(interact).toHaveBeenCalledTimes(3);
    expect(ticks).toHaveBeenCalledTimes(3);
    expect(ticks.mock.calls.every(([, count]) => count === 2)).toBe(true);
});

for (const kind of ['dragons', 'kbd', 'demons'] as const) {
    for (const change of ['consumed', 'partial', 'healed', 'rejected', 'unchanged']) {
        test(`${kind} confirms a bite by food or HP within two ticks: ${change}`, async () => {
            const { bot, state, interact } = await safetyScenario(kind, { food: 'Cake' });
            state.pack = [food('Cake', 1891)];
            state.hp = 30;
            interact.mockImplementation(() => {
                if (change === 'consumed') state.pack = [];
                if (change === 'partial') state.pack[0] = food('2/3 cake', 1893);
                if (change === 'healed') state.hp += 4;
                if (change === 'consumed' || change === 'partial') state.hp -= 2;
                return change !== 'rejected';
            });
            const timed = spyOn(Execution, 'delayUntil');
            timed.mockClear();
            const ticks = spyOn(Execution, 'delayUntilTicks');
            ticks.mockClear();
            expect(await bot.eatOnce()).toBe(!['rejected', 'unchanged'].includes(change));
            expect(timed).not.toHaveBeenCalled();
            if (change === 'rejected') expect(ticks).not.toHaveBeenCalled();
            else expect(ticks).toHaveBeenCalledWith(expect.any(Function), 2);
        });
    }
}
