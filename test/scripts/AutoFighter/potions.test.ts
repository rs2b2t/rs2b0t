import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import { FighterPotions, fighterPotionPlans } from '#/bot/scripts/AutoFighter/potions.js';

afterEach(() => mock.restore());

function fixture(settings: Record<string, boolean | number> = { useSuperAttack: true, useSuperStrength: true, useSuperDefence: true }) {
    const state = { pack: ['Super attack(2)', 'Super strength(3)', 'Super defence(1)'], bank: new Map<string, number>(), levels: { attack: 80, strength: 80, defence: 80 } as Record<string, number>, event: false, open: false, tick: 1 };
    spyOn(Inventory, 'items').mockImplementation(() => state.pack.map((name, slot) => new InvItem({ id: slot + 1, name, slot, count: 1, comId: 3214, ops: ['Drink'] })));
    spyOn(Inventory, 'isFull').mockImplementation(() => state.pack.length >= 28);
    spyOn(Bank, 'isOpen').mockImplementation(() => state.open);
    spyOn(Bank, 'count').mockImplementation(name => state.bank.get(name) ?? 0);
    spyOn(Bank, 'setNoteMode').mockResolvedValue(undefined);
    const withdraw = spyOn(Bank, 'withdrawX').mockImplementation(async (name, count) => {
        const qty = Math.min(count, state.bank.get(name) ?? 0, 28 - state.pack.length);
        state.pack.push(...Array(qty).fill(name));
        state.bank.set(name, (state.bank.get(name) ?? 0) - qty);
        return qty > 0;
    });
    spyOn(Skills, 'level').mockReturnValue(80);
    spyOn(Skills, 'effective').mockImplementation(skill => state.levels[skill] ?? 80);
    spyOn(EventSignal, 'pending').mockImplementation(() => state.event);
    spyOn(Game, 'tick').mockImplementation(() => state.tick);
    spyOn(Execution, 'delayUntil').mockImplementation(async check => check());
    const drink = spyOn(InvItem.prototype, 'interact').mockImplementation(async function (this: InvItem, op) {
        expect(op).toBe('Drink');
        const skill = this.name!.includes('attack') ? 'attack' : this.name!.includes('strength') ? 'strength' : 'defence';
        state.levels[skill] = 97;
        const doses = Number(this.name!.at(-2));
        state.pack[this.slot] = doses === 1 ? 'Vial' : this.name!.replace(`(${doses})`, `(${doses - 1})`);
        return true;
    });
    const logs: string[] = [];
    const plans = fighterPotionPlans(new SettingsBag(settings), 'melee', []);
    const potions = new FighterPotions(plans, message => logs.push(message));
    return { state, potions, drink, withdraw, logs };
}

test('potions default off and each type can be selected independently', () => {
    expect(fighterPotionPlans(new SettingsBag(), 'melee', [])).toEqual([]);
    for (const [setting, skill] of [['useSuperAttack', 'attack'], ['useSuperStrength', 'strength'], ['useSuperDefence', 'defence']]) {
        expect(fighterPotionPlans(new SettingsBag({ [setting]: true }), 'melee', []).map(p => p.potion.skill)).toEqual([skill]);
    }
});

test('defence works with ranged and magic while melee boosts are excluded', () => {
    const bag = new SettingsBag({ useSuperAttack: true, useSuperStrength: true, useSuperDefence: true });
    for (const style of ['mage', 'range'] as const) expect(fighterPotionPlans(bag, style, []).map(p => p.potion.skill)).toEqual(['defence']);
});

test('selected loadout controls bottle count and preferred dose form', () => {
    const plans = fighterPotionPlans(new SettingsBag({ useSuperStrength: true }), 'melee', [{ item: 'Super strength(4)', qty: 2 }]);
    expect(plans.map(p => [p.flask, p.want])).toEqual([['Super strength(4)', 2]]);
});

test('drinks one enabled boost at a time and waits until boosts fade', async () => {
    const { state, potions, drink } = fixture();
    expect(await potions.sip()).toBe(true);
    expect(drink).toHaveBeenCalledTimes(1);
    expect(state.pack[0]).toBe('Super attack(1)');
    state.tick += 5;
    expect(await potions.sip()).toBe(true);
    state.tick += 5;
    expect(await potions.sip()).toBe(true);
    expect(state.pack[2]).toBe('Vial');
    expect(potions.due()).toBeNull();
    state.tick += 5;
    state.levels.strength = 89;
    expect(potions.due()).toBeNull();
    state.levels.strength = 88;
    expect(potions.due()?.potion.skill).toBe('strength');
});

test('disabled potions are never drunk even when carried', async () => {
    const { state, potions } = fixture({ useSuperAttack: false, useSuperStrength: true, useSuperDefence: false });
    expect(await potions.sip()).toBe(true);
    expect(state.pack).toEqual(['Super attack(2)', 'Super strength(2)', 'Super defence(1)']);
    expect(potions.due()).toBeNull();
});

test('does not drink through a bank modal or random event', async () => {
    const { state, potions, drink } = fixture();
    state.open = true;
    expect(await potions.sip()).toBe(false);
    state.open = false;
    state.event = true;
    expect(await potions.sip()).toBe(false);
    expect(drink).not.toHaveBeenCalled();
});

test('failed drink verification yields instead of starving other combat tasks', async () => {
    const { state, potions, drink } = fixture();
    drink.mockReturnValue(true);
    expect(await potions.sip()).toBe(false);
    expect(potions.due()).toBeNull();
    state.tick += 10;
    expect(potions.due()).not.toBeNull();
});

test('restocking keeps partial bottles and falls back to available dose sizes', async () => {
    const { state, potions, withdraw } = fixture();
    state.pack = ['Super attack(1)'];
    state.bank = new Map([['Super attack(3)', 10], ['Super strength(4)', 1], ['Super defence(2)', 1]]);
    await potions.restock();
    expect(state.pack).toEqual(['Super attack(1)', 'Super strength(4)', 'Super defence(2)']);
    expect(withdraw).not.toHaveBeenCalledWith('Super attack(3)', expect.anything());
    expect(potions.keepNames()).toContain('Super strength(1)');
});

test('empty potion stock warns once without requesting another bank trip', async () => {
    const { state, potions, logs } = fixture({ useSuperAttack: true, useSuperStrength: false, useSuperDefence: false });
    state.pack = [];
    await potions.restock();
    await potions.restock();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('unboosted');
    expect(potions.due()).toBeNull();
});

test('combat task drinks selected potions, resumes attacks, and stays idle away from camp', async () => {
    const { default: AutoFighter } = await import('#/bot/scripts/AutoFighter/AutoFighter.js');
    const { Sustain } = await import('#/bot/api/sustain/Sustain.js');
    const { ChatDialog } = await import('#/bot/api/ui/dialogue/ChatDialog.js');
    const { state, drink } = fixture();
    spyOn(Game, 'ingame').mockReturnValue(true);
    const tile = spyOn(Game, 'tile').mockReturnValue({ x: 3200, z: 3200, level: 0 });
    spyOn(Game, 'inCombat').mockReturnValue(true);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Sustain, 'set').mockImplementation(() => {});
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    const bot = new AutoFighter();
    bot.settings = new SettingsBag({ useSuperStrength: true, solveClues: false });
    bot.bindLog(() => {});
    try {
        await bot.onStart();
        const task = bot['tasks'].find(task => task.constructor.name === 'DrinkPotions')!;
        expect(task).toBeDefined();
        expect(task.validate()).toBe(true);
        await task.execute();
        expect(state.pack[1]).toBe('Super strength(2)');
        expect(bot.resumeAttack).toBe(true);
        expect(drink).toHaveBeenCalledTimes(1);
        state.levels.strength = 80;
        state.tick += 10;
        tile.mockReturnValue({ x: 3300, z: 3200, level: 0 });
        expect(task.validate()).toBe(false);
    } finally {
        bot.disposeSubscriptions();
    }
});


test('each enabled potion has an independent bottle target', () => {
    const plans = fighterPotionPlans(new SettingsBag({
        useSuperAttack: true, superAttackCount: 2,
        useSuperStrength: true, superStrengthCount: 4,
        useSuperDefence: true, superDefenceCount: 3
    }), 'melee', []);
    expect(plans.map(plan => [plan.potion.skill, plan.want])).toEqual([['attack', 2], ['strength', 4], ['defence', 3]]);
});

test('explicit bottle count overrides the loadout quantity but preserves its dose preference', () => {
    const plans = fighterPotionPlans(new SettingsBag({ useSuperStrength: true, superStrengthCount: 4 }), 'melee', [{ item: 'Super strength(4)', qty: 2 }]);
    expect(plans.map(plan => [plan.flask, plan.want])).toEqual([['Super strength(4)', 4]]);
    expect(fighterPotionPlans(new SettingsBag({ useSuperAttack: false, superAttackCount: 4 }), 'melee', [])).toEqual([]);
});

test('multiple bottles top up only the deficit across partial and full doses', async () => {
    const { state, potions, withdraw } = fixture({ useSuperAttack: true, superAttackCount: 3, useSuperStrength: true, superStrengthCount: 4 });
    state.pack = ['Super attack(1)', 'Super strength(2)'];
    state.bank = new Map([['Super attack(3)', 10], ['Super strength(3)', 1], ['Super strength(4)', 10]]);
    await potions.restock();
    expect(state.pack.filter(name => name.startsWith('Super attack'))).toHaveLength(3);
    expect(state.pack.filter(name => name.startsWith('Super strength'))).toHaveLength(4);
    expect(withdraw.mock.calls).toEqual([['Super attack(3)', 2], ['Super strength(3)', 1], ['Super strength(4)', 2]]);
    await potions.restock();
    expect(withdraw).toHaveBeenCalledTimes(3);
});

test('large potion targets preserve slots reserved for food', async () => {
    const { state, potions, withdraw } = fixture({ useSuperStrength: true, superStrengthCount: 20 });
    state.pack = Array(5).fill('Other supply');
    state.bank.set('Super strength(3)', 30);
    await potions.restock(10);
    expect(withdraw).toHaveBeenCalledWith('Super strength(3)', 13);
    expect(state.pack).toHaveLength(18);
});
