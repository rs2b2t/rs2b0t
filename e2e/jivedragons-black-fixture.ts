import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import type { Equipment } from '../src/bot/api/equipment/Equipment.js';
import type { Inventory } from '../src/bot/api/inventory/Inventory.js';
import type { Skills } from '../src/bot/api/skills/Skills.js';
import type { Loadouts } from '../src/bot/api/loadout/loadoutStore.js';
import { cheatQuiet, clearChatDialogs, seedItemsToBank, teleTo } from './tutorial/harness.js';

const bank = { x: 2946, z: 3369, level: 0 };
const worn = [['coif', 'Coif'], ['black_dragonhide_body', 'Dragonhide body'], ['black_dragonhide_chaps', 'Dragonhide chaps'],
    ['black_dragon_vambraces', 'Dragon vambraces'], ['leather_boots', 'Leather boots'], ['amulet_of_glory', 'Amulet of glory']] as const;
const pack = [['magic_shortbow', 'Magic shortbow', 1], ['rune_arrow', 'Rune arrow', 500], ['4doserangerspotion', 'Ranging potion(4)', 1],
    ['shark', 'Shark', 20], ['4dose2antipoison', 'Superantipoison(4)', 1], ['airrune', 'Air rune', 30],
    ['waterrune', 'Water rune', 10], ['lawrune', 'Law rune', 10], ['dusty_key', 'Dusty key', 1]] as const;
type FixtureRuntime = { readonly __rs2b0t: { readonly Equipment: typeof Equipment; readonly Inventory: typeof Inventory; readonly Skills: typeof Skills; readonly Loadouts: typeof Loadouts } };

export async function seedBlackFixture(page: Page, site: 'black' | 'blue' = 'black'): Promise<void> {
    for (const command of ['~clearinv inv', '~clearinv worn', '~clearbank']) assert(await cheatQuiet(page, command));
    for (const [skill, level] of [['attack', 75], ['strength', 75], ['defence', 75], ['hitpoints', 99], ['prayer', 70], ['ranged', 85], ['magic', 80], ['agility', 40], ['woodcutting', 45]] as const) {
        assert(await cheatQuiet(page, `setstat ${skill} ${level}`));
    }
    await clearChatDialogs(page, 'level fixture');
    await seedItemsToBank(page, [
        { debugName: 'shark', displayName: 'Shark', qty: 400 },
        { debugName: 'rune_arrow', displayName: 'Rune arrow', qty: 5000 },
        { debugName: 'magic_shortbow', displayName: 'Magic shortbow', qty: 1 },
        { debugName: '4doserangerspotion', displayName: 'Ranging potion(4)', qty: 5 },
        { debugName: '4dose2antipoison', displayName: 'Superantipoison(4)', qty: 20 },
        { debugName: 'airrune', displayName: 'Air rune', qty: 20000 },
        { debugName: 'waterrune', displayName: 'Water rune', qty: 200 },
        { debugName: 'lawrune', displayName: 'Law rune', qty: 200 }
    ], bank);
    for (const [debug, name] of worn) {
        assert(await cheatQuiet(page, `give ${debug} 1`));
        await page.evaluate(async name => {
            function ready(value: unknown): value is FixtureRuntime { return typeof value === 'object' && value !== null && '__rs2b0t' in value; }
            const g = globalThis;
            if (!ready(g)) throw new Error('fixture ABI absent');
            await g.__rs2b0t.Equipment.equip(name);
        }, name);
    }
    for (const [debug, , quantity] of pack) assert(await cheatQuiet(page, `give ${debug} ${quantity}`));
    const verified = await page.evaluate(() => {
        function ready(value: unknown): value is FixtureRuntime { return typeof value === 'object' && value !== null && '__rs2b0t' in value; }
        const g = globalThis;
        if (!ready(g)) throw new Error('fixture ABI absent');
        return { arrows: g.__rs2b0t.Inventory.count('Rune arrow'), sharks: g.__rs2b0t.Inventory.count('Shark'),
            ranged: g.__rs2b0t.Skills.level('ranged'), hp: g.__rs2b0t.Skills.level('hitpoints'), worn: g.__rs2b0t.Equipment.items().map(i => i.name) };
    });
    assert.equal(verified.arrows, 500);
    assert.equal(verified.sharks, 20);
    assert.equal(verified.ranged, 85);
    assert.equal(verified.hp, 99);
    for (const [, name] of worn) assert(verified.worn.includes(name), `${name} not equipped`);
    console.log('fixture', verified);
    const free = await page.evaluate(async () => {
        function ready(value: unknown): value is FixtureRuntime { return typeof value === 'object' && value !== null && '__rs2b0t' in value; }
        const g = globalThis;
        if (!ready(g)) throw new Error('fixture ABI absent');
        await g.__rs2b0t.Equipment.equip('Magic shortbow');
        await g.__rs2b0t.Equipment.equip('Rune arrow');
        g.__rs2b0t.Loadouts.save([{ name: 'Private Sharks', worn: {}, carry: [{ item: 'Shark', qty: 22 }] }]);
        return 28 - g.__rs2b0t.Inventory.used();
    });
    assert(free > 0);
    assert(await cheatQuiet(page, `give shark ${free}`));
    const full = await page.evaluate(() => {
        function ready(value: unknown): value is FixtureRuntime { return typeof value === 'object' && value !== null && '__rs2b0t' in value; }
        const g = globalThis;
        if (!ready(g)) throw new Error('fixture ABI absent');
        return { used: g.__rs2b0t.Inventory.used(), sharks: g.__rs2b0t.Inventory.count('Shark'),
            bow: g.__rs2b0t.Equipment.contains('Magic shortbow'), ammo: g.__rs2b0t.Equipment.contains('Rune arrow') };
    });
    assert.equal(full.used, 28);
    assert(full.bow && full.ammo);
    console.log('CANDIDATE FULL-FOOD FIXTURE', full);
    await clearChatDialogs(page, 'fixture dialogs');
    const stand = site === 'black' ? { x: 2836, z: 9817, level: 0 } : { x: 2901, z: 9809, level: 0 };
    assert(await teleTo(page, stand, 0, 30000));
}

export const blackSettings = {
    site: 'taverley-black', stand: 1, combatStyle: 'range', bow: 'Magic shortbow', ammo: 'Rune arrow', rangeStyle: 'rapid',
    ammoWithdraw: 500, useSpecial: true, rangingPotion: true, foodWithdraw: 20, panicHp: 30, foodReserve: 4, healTo: 90,
    teleStock: 2, buryBones: true, solveClues: false, bankCommonJunk: true, logDetail: 'Verbose', usePotions: false, loadout: 'Private Sharks',
    leaveVia: 'teleport', lootBlack: 'Dragon bones, Dragonhide, Uncut diamond, Uncut ruby, Uncut emerald, Uncut sapphire'
} as const;
