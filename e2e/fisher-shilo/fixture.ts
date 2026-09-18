import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { SHOP_DB } from '../../src/bot/data/shopdb.js';
import { unitPrice } from '../../src/bot/api/shop/StockModel.js';
import { setSettings } from '../lib/harness.js';
import { cheatQuiet, clearChatDialogs, getServerVarQuiet, relog, seedItemsToBank, teleTo } from '../tutorial/harness.js';
import type { Scenario } from './contracts.js';
import { readTrace } from './trace.js';

export const SHOP_METADATA = ['Obli', 'Fernahei'].map(keeper => {
    const shop = Object.values(SHOP_DB).find(record => record.keepers.includes(keeper));
    assert(shop, `shop metadata missing for ${keeper}`);
    const name = keeper === 'Obli' ? 'Vial of water' : 'Feather';
    const item = shop.items.find(record => record.name === name);
    assert(item, `item metadata missing for ${name}`);
    return { keeper, shop, item };
});
export const FUNDING = SHOP_METADATA.reduce((sum, { shop, item }) =>
    sum + Array.from({ length: item.baseline }, (_, index) =>
        unitPrice(item, shop, item.baseline - index)).reduce((total, price) => total + price, 0), 0);
export const MINIMUM_TRIP_FUNDING = SHOP_METADATA.reduce((sum, { shop, item }) => {
    const quantity = item.stackable ? item.baseline : 25;
    return sum + Array.from({ length: quantity }, (_, index) =>
        unitPrice(item, shop, item.baseline - index)).reduce((total, price) => total + price, 0);
}, 0);

export async function seedFixture(page: Page, scenario: Scenario, username: string): Promise<void> {
    assert(await cheatQuiet(page, 'setvar zombiequeen 15'), 'quest seed not sent');
    assert.equal(await getServerVarQuiet(page, 'zombiequeen'), 15, 'Shilo quest prerequisite');
    await relog(page, username);
    assert(await cheatQuiet(page, 'setstat fishing 50'), 'fishing seed not sent');
    await clearChatDialogs(page, 'fishing fixture');
    await seedItemsToBank(page, [{ debugName: 'coins', displayName: 'Coins', qty: FUNDING }],
        { x: 3185, z: 3440, level: 0 });
    assert(await teleTo(page, { x: 2852, z: 2954, level: 0 }, 3, 25000), 'Shilo bank teleport');
    assert(await cheatQuiet(page, '~clearinv'), 'clear inventory not sent');
    for (const command of ['give fly_fishing_rod 1', 'give feather 1',
        ...(scenario === 'full' ? [`give coins ${FUNDING}`, 'give raw_trout 24', 'give bronze_dagger 1'] : [])]) {
        assert(await cheatQuiet(page, command), `fixture command not sent: ${command}`);
    }
    await page.waitForFunction(full => {
        const { Inventory, Skills } = globalThis.__rs2b0t;
        return Skills.level('fishing') === 50 && Inventory.count('Fly fishing rod') === 1 &&
            Inventory.count('Feather') === 1 && Inventory.used() === (full ? 28 : 2) &&
            (!full || (Inventory.count('Raw trout') === 24 && Inventory.count('Bronze dagger') === 1));
    }, scenario === 'full', { timeout: 15000 });
    await setSettings(page, 'Fisher', {
        fishMethod: 'Fly fishing — trout/salmon', location: 'Shilo Village',
        cookMode: 'Off', toolAcquire: 'Off', forgetfulBank: false,
        guildFeatherMinutes: 60, leashRadius: 30, muleMode: 'Off', mulePartner: ''
    });
    const bank = (await readTrace(page)).events.at(-1);
    assert(bank, 'fixture bank observation missing');
    assert.equal(bank.bankCoins, FUNDING, 'fresh bank coin fixture');
    assert.equal(bank.bankVials + bank.bankTrout + bank.bankDagger, 0, 'fresh account bank required');
    const heldCoins = await page.evaluate(() => globalThis.__rs2b0t.Inventory.count('Coins'));
    assert.equal(heldCoins, scenario === 'full' ? FUNDING : 0, 'held coin fixture');
}
