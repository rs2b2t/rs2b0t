import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import type { Inventory } from '../src/bot/api/inventory/Inventory.js';
import { cheatQuiet } from './tutorial/harness.js';

type Runtime = { readonly __rs2b0t: { readonly Inventory: typeof Inventory } };
export async function seedPolicyPack(page: Page, scenario: 'ammo' | 'capacity') {
    assert(await cheatQuiet(page, '~clearinv inv'));
    for (const [name, count] of [['airrune', 30], ['waterrune', 10], ['lawrune', 10], ['dusty_key', 1],
        ['4doserangerspotion', 1], ['4dose2antipoison', 1]] as const) assert(await cheatQuiet(page, `give ${name} ${count}`));
    if (scenario === 'ammo') {
        assert(await cheatQuiet(page, 'give bronze_arrow 10'));
        const dropped = await page.evaluate(async () => {
            function ready(value: unknown): value is Runtime { return typeof value === 'object' && value !== null && '__rs2b0t' in value; }
            const g = globalThis;
            if (!ready(g)) throw new Error('policy fixture runtime absent');
            const api: Runtime['__rs2b0t'] = g.__rs2b0t;
            return api.Inventory.first('Bronze arrow')?.interact('Drop');
        });
        assert(dropped);
        assert(await cheatQuiet(page, 'give rune_arrow 20'));
        assert(await cheatQuiet(page, 'give shark 21'));
    } else {
        assert(await cheatQuiet(page, 'give shark 4'));
        assert(await cheatQuiet(page, 'give dragonhide_blue 18'));
    }
    const inventory = await page.evaluate(() => {
        function ready(value: unknown): value is Runtime { return typeof value === 'object' && value !== null && '__rs2b0t' in value; }
        const g = globalThis;
        if (!ready(g)) throw new Error('policy fixture runtime absent');
        const api: Runtime['__rs2b0t'] = g.__rs2b0t;
        return { used: api.Inventory.used(), items: api.Inventory.items().map(i => ({ name: i.name, count: i.count })) };
    });
    assert.equal(inventory.used, 28);
    return inventory;
}
