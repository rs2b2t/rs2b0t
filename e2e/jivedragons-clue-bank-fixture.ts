import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import type { Inventory } from '../src/bot/api/inventory/Inventory.js';
import type { Skills } from '../src/bot/api/skills/Skills.js';
import { cheatQuiet, seedItemsToBank, teleTo, clearChatDialogs } from './tutorial/harness.js';
import { seedBlackFixture } from './jivedragons-black-fixture.js';

type Runtime = { readonly __rs2b0t: { readonly Inventory: typeof Inventory; readonly Skills: typeof Skills };
    readonly rs2b0t: { readonly reader: { varp(id: number): number } } };

export async function seedClueBankFixture(page: Page) {
    await seedBlackFixture(page, 'blue');
    await seedItemsToBank(page, [
        { debugName: 'coins', displayName: 'Coins', qty: 50000 },
        { debugName: 'spade', displayName: 'Spade', qty: 2 },
        { debugName: 'airrune', displayName: 'Air rune', qty: 1000 },
        { debugName: 'waterrune', displayName: 'Water rune', qty: 500 },
        { debugName: 'earthrune', displayName: 'Earth rune', qty: 500 },
        { debugName: 'firerune', displayName: 'Fire rune', qty: 500 },
        { debugName: 'lawrune', displayName: 'Law rune', qty: 500 }
    ], { x: 2946, z: 3369, level: 0 });
    assert(await cheatQuiet(page, '~clearinv inv'));
    for (const [name, count] of [['airrune', 30], ['waterrune', 10], ['lawrune', 10], ['shark', 10],
        ['dusty_key', 1], ['dragonhide_blue', 1], ['trail_clue_easy_simple017', 1]] as const) assert(await cheatQuiet(page, `give ${name} ${count}`));
    assert(await cheatQuiet(page, 'setvar trail_status 0'));
    const fixture = await page.evaluate(() => {
        function ready(value: unknown): value is Runtime { return typeof value === 'object' && value !== null && '__rs2b0t' in value && 'rs2b0t' in value; }
        const g = globalThis;
        if (!ready(g)) throw new Error('clue fixture runtime absent');
        const api: Runtime['__rs2b0t'] = g.__rs2b0t;
        return { inventory: api.Inventory.items().map(i => ({ id: i.id, name: i.name, count: i.count })),
            magic: api.Skills.level('magic'), trailStatus: g.rs2b0t.reader.varp(292) };
    });
    assert.equal(fixture.trailStatus, 0);
    assert(fixture.magic >= 37);
    assert(fixture.inventory.some(i => i.id === 2693));
    assert(fixture.inventory.some(i => i.name === 'Dragonhide'));
    await clearChatDialogs(page, 'clue fixture');
    assert(await teleTo(page, { x: 2901, z: 9809, level: 0 }, 0, 30000));
    return fixture;
}
