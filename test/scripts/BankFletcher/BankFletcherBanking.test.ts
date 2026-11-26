import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Banking } from '#/bot/api/bank/Banking.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Game } from '#/bot/api/game/Game.js';
import { Inventory, InvItem } from '#/bot/api/inventory/Inventory.js';
import { Skills } from '#/bot/api/skills/Skills.js';
import { ChatDialog } from '#/bot/api/ui/dialogue/ChatDialog.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import BankFletcher from '#/bot/scripts/BankFletcher/BankFletcher.js';
import { BOW_STRING_ID } from '#/bot/scripts/BankFletcher/BankFletcherLogic.js';

const unstrung = 50;
const shortbow = 841;

afterEach(() => mock.restore());

async function start(mode: string, strings: number) {
    const pack: number[] = Array(strings).fill(BOW_STRING_ID);
    let bankedBows = 14;
    let open = false;
    const trips = spyOn(Banking, 'open').mockImplementation(async () => { open = true; return true; });
    spyOn(Bank, 'isOpen').mockImplementation(() => open);
    spyOn(Bank, 'close').mockImplementation(async () => { open = false; return true; });
    spyOn(Bank, 'waitReady').mockResolvedValue(true);
    spyOn(Bank, 'ready').mockImplementation(() => open);
    spyOn(Bank, 'depositAllMatching').mockResolvedValue(undefined);
    spyOn(Bank, 'items').mockImplementation(() => bankedBows ? [
        { id: unstrung, name: 'Shortbow', count: bankedBows, slot: 0, comId: 1, ops: ['Withdraw-All'] }
    ] : []);
    spyOn(Bank, 'withdrawById').mockImplementation((id, op) => {
        if (!open || id !== unstrung || op !== 'Withdraw-All') return false;
        const count = Math.min(bankedBows, 28 - pack.length);
        pack.push(...Array(count).fill(id));
        bankedBows -= count;
        return count > 0;
    });
    spyOn(Inventory, 'items').mockImplementation(() => pack.map((id, slot) => new InvItem({
        id, slot, name: id === BOW_STRING_ID ? 'Bow string' : 'Shortbow', count: 1, comId: 2, ops: []
    })));
    spyOn(Inventory, 'used').mockImplementation(() => pack.length);
    spyOn(Inventory, 'isFull').mockImplementation(() => pack.length === 28);
    spyOn(InvItem.prototype, 'useOn').mockImplementation(function (this: InvItem, target) {
        if (open || pack[this.slot] !== BOW_STRING_ID || !(target instanceof InvItem) || pack[target.slot] !== unstrung) return false;
        pack[target.slot] = shortbow;
        pack.splice(this.slot, 1);
        return true;
    });
    spyOn(Game, 'sceneReady').mockReturnValue(true);
    spyOn(ChatDialog, 'canContinue').mockReturnValue(false);
    spyOn(ChatDialog, 'isMakeMenu').mockReturnValue(false);
    spyOn(ChatDialog, 'isOpen').mockReturnValue(false);
    spyOn(Skills, 'level').mockReturnValue(5);
    spyOn(Skills, 'xp').mockReturnValue(0);
    spyOn(Execution, 'delayUntil').mockResolvedValue(true);
    spyOn(Execution, 'delayUntilTicks').mockImplementation(async check => check());
    spyOn(Execution, 'delayTicks').mockResolvedValue(undefined);
    const bot = new BankFletcher();
    bot.settings = new SettingsBag({ mode, product: 'Short bow', material: 'Logs' });
    bot.bindLog(() => {});
    const finish = mock((_reason: string) => {});
    bot.bindFinish(finish);
    await bot.onStart();
    return { bot, finish, trips };
}

for (const mode of ['string', 'cut+string']) {
    describe(mode, () => {
        test.each([1, 3, 13, 14])('finishes bows with %i carried strings in one trip', async strings => {
            const { bot, finish, trips } = await start(mode, strings);
            await bot.loop();
            expect(finish).not.toHaveBeenCalled();
            expect(bot.packCountById(unstrung)).toBeGreaterThanOrEqual(strings);
            await bot.loop();
            expect(trips).toHaveBeenCalledTimes(1);
            expect(bot.packCountById(shortbow)).toBe(strings);
            expect(bot.packCountById(BOW_STRING_ID)).toBe(0);
        });

        test('stops on the third confirmed empty string read with no carried strings', async () => {
            const { bot, finish } = await start(mode, 0);
            await bot.loop();
            await bot.loop();
            expect(finish).not.toHaveBeenCalled();
            await bot.loop();
            expect(finish.mock.calls).toEqual([["BankFletcher: bank is out of 'Bow string'"]]);
            expect(bot.packCountById(unstrung)).toBe(0);
        });
    });
}
