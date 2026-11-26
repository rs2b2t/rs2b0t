import { afterEach, describe, expect, test } from 'bun:test';

import { reader } from '#/bot/adapter/ClientAdapter.js';
import { Bank } from '#/bot/api/bank/Bank.js';
import { Execution } from '#/bot/api/execution/Execution.js';
import { Inventory } from '#/bot/api/inventory/Inventory.js';
import { ScriptRunner } from '#/bot/runtime/ScriptRunner.js';
import { SettingsBag } from '#/bot/runtime/Settings.js';
import TannerBot from '#/bot/scripts/TannerBot/TannerBot.js';

const original = {
    delayUntil: Execution.delayUntil,
    bankItems: Bank.items,
    depositAllMatching: Bank.depositAllMatching,
    openNearest: Bank.openNearest,
    inventoryCount: Inventory.count,
    inventoryUsed: Inventory.used,
    inventorySize: reader.inventorySize,
    stop: ScriptRunner.stop
};

afterEach(() => {
    Execution.delayUntil = original.delayUntil;
    Bank.items = original.bankItems;
    Bank.depositAllMatching = original.depositAllMatching;
    Bank.openNearest = original.openNearest;
    Inventory.count = original.inventoryCount;
    Inventory.used = original.inventoryUsed;
    reader.inventorySize = original.inventorySize;
    ScriptRunner.stop = original.stop;
});

function setupBankLeg(items: ReturnType<typeof Bank.items>) {
    const bot = new TannerBot();
    const logs: string[] = [];
    let stops = 0;

    bot.bindLog(message => logs.push(message));
    (bot as unknown as { walkTo(): Promise<boolean> }).walkTo = async () => true;
    Bank.openNearest = async () => true;
    Bank.depositAllMatching = async () => {};
    Bank.items = () => items;
    Inventory.count = name => name === 'Coins' ? 2_000 : 0;
    Inventory.used = () => 1;
    reader.inventorySize = () => 28;
    ScriptRunner.stop = () => { stops++; };

    return { bot, logs, stops: () => stops };
}

describe('TannerBot tanning modes', () => {
    test.each<[string, number]>([
        ['Soft leather', 1741],
        ['Hard leather', 1743],
        ['Green dragonhide', 1745],
        ['Blue dragonhide', 2505],
        ['Red dragonhide', 2507],
        ['Black dragonhide', 2509],
        ['unknown', 1741]
    ])('%s selects product %i', async (hideType, productId) => {
        Execution.delayUntil = async () => true;
        const bot = new TannerBot();
        bot.settings = new SettingsBag({ hideType });
        await bot.onStart();
        expect(bot['mode'].productId).toBe(productId);
    });
});

describe('TannerBot bank withdrawal failures', () => {
    test('a transient withdrawal failure retries without stopping', async () => {
        const { bot, logs, stops } = setupBankLeg([{
            id: 1739,
            name: 'Cow hide',
            count: 100,
            slot: 4,
            comId: 5382,
            // The bank still has hides, but its Withdraw-X action was not ready.
            ops: ['Withdraw-1', 'Withdraw-5', 'Withdraw-10', 'Withdraw-All', null]
        }]);

        const continued = await (bot as unknown as { bankLeg(threadRun: boolean): Promise<boolean> }).bankLeg(false);

        expect(continued).toBe(false);
        expect(stops()).toBe(0);
        expect(logs.some(message => /100.*Cow hide.*retrying/i.test(message))).toBe(true);
        expect(logs.some(message => /no Cow hide left/i.test(message))).toBe(false);
    });

    test('no visible hides waits without stopping the script', async () => {
        const { bot, logs, stops } = setupBankLeg([]);

        const continued = await (bot as unknown as { bankLeg(threadRun: boolean): Promise<boolean> }).bankLeg(false);

        expect(continued).toBe(false);
        expect(stops()).toBe(0);
        expect(logs).toContain('Cow hide not currently visible in the bank — waiting.');
    });
});
