import { afterEach, expect, mock, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Equipment } from '#/bot/api/equipment/Equipment.js';
import { EventSignal } from '#/bot/api/execution/EventSignal.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import Alcher from '#/bot/scripts/Alcher/Alcher.js';
import Superheater from '#/bot/scripts/Superheater/Superheater.js';

afterEach(() => mock.restore());

test.each([false, true])('a delegated superheater withdraws the last complete steel recipe, fire runes %p', async useFireRunes => {
    const bot = new Superheater();
    bot.settings = new SettingsBag({ bar: 'Steel', useFireRunes });
    const finish = mock(() => {});
    bot.bindFinish(finish);
    spyOn(bot, 'resolveBank').mockResolvedValue(true);
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    spyOn(Skills, 'level').mockReturnValue(55);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Equipment, 'contains').mockImplementation(name => !useFireRunes && name === 'Staff of fire');
    const pack: Record<string, number> = { 'Nature rune': 1 };
    const stock: Record<string, number> = { 'Iron ore': 4, Coal: 3, 'Fire rune': 4 };
    spyOn(Inventory, 'count').mockImplementation(name => pack[name] ?? 0);
    spyOn(Inventory, 'used').mockReturnValue(1);
    spyOn(Bank, 'isOpen').mockReturnValue(true);
    spyOn(Bank, 'waitReady').mockResolvedValue(true);
    spyOn(Bank, 'count').mockImplementation(name => stock[name] ?? 0);
    spyOn(Bank, 'depositAllMatching').mockResolvedValue(undefined);
    spyOn(Bank, 'withdraw').mockReturnValue(false);
    spyOn(Bank, 'withdrawX').mockImplementation(async (name, desired) => {
        const take = Math.min(desired, stock[name] ?? 0);
        if (!take) return false;
        pack[name] = (pack[name] ?? 0) + take;
        stock[name] -= take;
        return true;
    });
    const close = spyOn(Bank, 'close').mockResolvedValue(true);
    await bot.onStart();
    await bot.loop();
    expect(pack).toEqual({ 'Nature rune': 1, 'Iron ore': 1, Coal: 2, ...(useFireRunes ? { 'Fire rune': 4 } : {}) });
    expect(close).toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
});

test.each([Alcher, Superheater])('%p reports a missing skill to its parent', async Child => {
    const child = new Child();
    const finish = mock(() => {});
    child.bindFinish(finish);
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    spyOn(Skills, 'level').mockReturnValue(1);
    await child.onStart();
    expect(finish).toHaveBeenCalled();
});

test('a delegated alcher funds its final carried note with five fires when the bank has no notes left', async () => {
    const bot = new Alcher();
    bot.settings = new SettingsBag({ items: ['yew_longbow'], useFireRunes: true });
    const finish = mock(() => {});
    bot.bindFinish(finish);
    spyOn(bot, 'resolveBank').mockResolvedValue(true);
    spyOn(bot, 'openBank').mockResolvedValue(true);
    spyOn(bot, 'notedId').mockReturnValue(856);
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    spyOn(Skills, 'level').mockReturnValue(55);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(Equipment, 'contains').mockReturnValue(false);
    const pack: Record<string, number> = { 'Nature rune': 1 };
    spyOn(Inventory, 'count').mockImplementation(name => pack[name] ?? 0);
    spyOn(Inventory, 'countById').mockImplementation(id => id === 856 ? 1 : 0);
    spyOn(Inventory, 'used').mockReturnValue(2);
    spyOn(Bank, 'isOpen').mockReturnValue(true);
    spyOn(Bank, 'waitReady').mockResolvedValue(true);
    spyOn(Bank, 'countById').mockReturnValue(0);
    spyOn(Bank, 'count').mockImplementation(name => name === 'Fire rune' ? 5 : 0);
    spyOn(Bank, 'depositAllMatching').mockResolvedValue(undefined);
    spyOn(Bank, 'setNoteMode').mockResolvedValue(undefined);
    spyOn(Bank, 'withdrawX').mockImplementation(async (name, count) => { pack[name] = count; return true; });
    const close = spyOn(Bank, 'close').mockResolvedValue(true);
    await bot.onStart();
    await bot.loop();
    expect(pack['Fire rune']).toBe(5);
    expect(bot.canAlchOne()).toBe(true);
    expect(close).toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
});

test('a rejected superheat cast yields to the leveler on the next loop', async () => {
    const bot = new Superheater();
    bot.settings = new SettingsBag({ bar: 'Iron' });
    spyOn(bot, 'resolveBank').mockResolvedValue(true);
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    spyOn(Skills, 'level').mockReturnValue(55);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Equipment, 'contains').mockReturnValue(true);
    spyOn(Inventory, 'count').mockReturnValue(3);
    spyOn(Inventory, 'first').mockReturnValue({ name: 'Iron ore' } as NonNullable<ReturnType<typeof Inventory.first>>);
    spyOn(Bank, 'isOpen').mockReturnValue(false);
    spyOn(Game, 'openSideTab').mockResolvedValue(true);
    const cast = spyOn(Game, 'castOnItem').mockResolvedValueOnce(false).mockRejectedValue(new Error('repeated cast'));
    await bot.onStart();
    await bot.loop();
    expect(cast).toHaveBeenCalledTimes(1);
});

async function startStaffTask(bot: Alcher | Superheater) {
    const finish = mock(() => {});
    bot.bindFinish(finish);
    const log = spyOn(bot, 'log').mockImplementation(() => {});
    const open = spyOn(bot, 'openBank').mockResolvedValue(true);
    spyOn(bot, 'resolveBank').mockResolvedValue(true);
    const delay = spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    spyOn(Skills, 'level').mockReturnValue(55);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    const pending = spyOn(EventSignal, 'pending').mockReturnValue(false);
    spyOn(Equipment, 'contains').mockReturnValue(false);
    spyOn(Inventory, 'used').mockReturnValue(0);
    spyOn(Inventory, 'count').mockReturnValue(0);
    await bot.onStart();
    return { finish, log, open, delay, pending };
}

test.each([Alcher, Superheater])('%p retries a stalled staff withdrawal until the bank confirms all fire staves are gone', async Child => {
    const bot = new Child();
    const { finish, log, open } = await startStaffTask(bot);
    spyOn(Bank, 'count').mockImplementationOnce(() => 1).mockReturnValue(0);
    const withdraw = spyOn(Bank, 'withdrawX').mockResolvedValue(false);
    const ready = spyOn(Bank, 'waitReady').mockResolvedValueOnce(false).mockResolvedValue(true);
    await bot.loop();
    expect(withdraw).toHaveBeenCalledWith('Staff of fire', 1);
    expect(ready).toHaveBeenCalledWith(3500);
    expect(log).toHaveBeenCalledWith('withdraw of Staff of fire stalled but the bank list is still settling — retrying');
    expect(finish).not.toHaveBeenCalled();
    await bot.loop();
    expect(finish).toHaveBeenCalledWith('no fire staff in the bank');
    expect(open).toHaveBeenCalledTimes(2);
    expect(withdraw).toHaveBeenCalledTimes(1);
});

test.each([Alcher, Superheater])('%p handles an event arriving while waiting for Wield', async Child => {
    const bot = new Child();
    const { delay, open, pending } = await startStaffTask(bot);
    spyOn(Bank, 'count').mockImplementation(name => Number(name === 'Fire battlestaff'));
    const withdraw = spyOn(Bank, 'withdrawX').mockResolvedValue(true);
    const close = spyOn(Bank, 'close').mockResolvedValue(true);
    delay.mockImplementation(async (_predicate, timeout) => {
        expect(timeout).toBe(3000);
        pending.mockReturnValue(true);
        return false;
    });
    const equip = spyOn(Equipment, 'equip').mockResolvedValue(true);
    await bot.loop();
    expect(withdraw).toHaveBeenCalledWith('Fire battlestaff', 1);
    expect(close).toHaveBeenCalledTimes(1);
    if (Child === Superheater) {
        expect(equip).not.toHaveBeenCalled();
        expect(open).toHaveBeenCalledTimes(1);
    } else {
        expect(equip).toHaveBeenCalledWith('Fire battlestaff');
        expect(open).toHaveBeenCalledTimes(2);
    }
});
