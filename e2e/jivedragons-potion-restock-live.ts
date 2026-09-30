import assert from 'node:assert/strict';
import type { Bank } from '../src/bot/api/bank/Bank.js';
import type { Equipment } from '../src/bot/api/equipment/Equipment.js';
import type { Inventory } from '../src/bot/api/inventory/Inventory.js';
import type JiveDragons from '../src/bot/scripts/JiveDragons/JiveDragons.js';
import { siteFor } from '../src/bot/api/combat/hunting/sites.js';
import { deployIsolatedClient, launchBrowser, positionalArgs, setSettings, stopScript } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, seedItemsToBank, startScript } from './tutorial/harness.js';

interface Api {
    __rs2b0t: { Bank: typeof Bank; Equipment: typeof Equipment; Inventory: typeof Inventory };
    rs2b0t: { runner: { bot: JiveDragons | null; ctx: { log: { msg: string }[] } | null } };
}

const base = positionalArgs(process.argv.slice(2), 'http://localhost:8890')[0];
const user = `jp${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
const client = deployIsolatedClient(user);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
try {
    await mainlandAccount(page, base, user, client.page);
    await seedItemsToBank(page, [
        { debugName: 'lobster', displayName: 'Lobster', qty: 20 },
        { debugName: 'dusty_key', displayName: 'Dusty key', qty: 1 },
        { debugName: '3dose2attack', displayName: 'Super attack(3)', qty: 2 },
        { debugName: '3dose2strength', displayName: 'Super strength(3)', qty: 2 },
        { debugName: '3dose2defense', displayName: 'Super defence(3)', qty: 2 }
    ], siteFor('taverley-blue').bank);
    for (const [debug, name] of [['bronze_sword', 'Bronze sword'], ['antidragonbreathshield', 'Dragonfire shield']]) {
        await cheatQuiet(page, `give ${debug} 1`);
        assert(await page.evaluate(item => (globalThis as unknown as Api).__rs2b0t.Equipment.equip(item), name));
    }
    for (const debug of ['1dose2attack', '2dose2strength', '3dose2defense']) await cheatQuiet(page, `give ${debug} 1`);
    await cheatQuiet(page, 'give cert_lobster 20');
    await setSettings(page, 'JiveDragons', {
        site: 'taverley-blue', combatStyle: 'melee', weapon: 'Bronze sword',
        usePotions: true, useSpecial: false, solveClues: false, foodWithdraw: 5, leaveVia: 'walk'
    });
    await startScript(page, 'JiveDragons');
    await page.waitForFunction(() => ((globalThis as unknown as Api).rs2b0t.runner.bot?.bankTrips ?? 0) > 0, undefined, { timeout: 60000 });
    await stopScript(page);
    assert(await page.evaluate(() => (globalThis as unknown as Api).__rs2b0t.Bank.openNearest('Bank booth', 'Use-quickly')));
    await page.waitForFunction(() => (globalThis as unknown as Api).__rs2b0t.Bank.loaded());
    const result = await page.evaluate(() => {
        const { Inventory, Bank } = (globalThis as unknown as Api).__rs2b0t;
        return {
            held: ['Super attack(3)', 'Super strength(3)', 'Super defence(3)'].map(name => Inventory.count(name)),
            partials: Inventory.items().filter(i => /^Super .*\([12]\)$/.test(i.name ?? '')).map(i => i.name),
            banked: ['Super attack(1)', 'Super strength(2)', 'Super attack(3)', 'Super strength(3)', 'Super defence(3)'].map(name => Bank.count(name)),
            food: Inventory.count('Lobster'),
            foodBanked: Bank.countById(379),
            notedFood: Inventory.countById(380)
        };
    });
    assert.deepEqual(result.held, [1, 1, 1]);
    assert.deepEqual(result.partials, []);
    assert.deepEqual(result.banked, [1, 1, 1, 1, 2]);
    assert.equal(result.food, 5);
    assert.equal(result.foodBanked, 35);
    assert.equal(result.notedFood, 0);
    await page.screenshot({ path: 'docs/e2e/jivedragons-potion-restock-live.png' });
    console.log(`PASS: partial supers banked, fresh three-dose set held, full defence flask retained; ${JSON.stringify(result)}`);
} finally {
    console.log(await page.evaluate(() => (globalThis as unknown as Api).rs2b0t?.runner.ctx?.log.map(line => line.msg)).catch(() => []));
    await stopScript(page).catch(() => {});
    await browser.close();
    client.cleanup();
}
