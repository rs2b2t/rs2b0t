import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { Page } from 'playwright-core';
import type { Equipment } from '../src/bot/api/equipment/Equipment.js';
import type { Inventory } from '../src/bot/api/inventory/Inventory.js';
import type { Skills } from '../src/bot/api/skills/Skills.js';
import { deployIsolatedClient, launchBrowser, logout, setSettings, stopScript } from './lib/harness.js';
import {
    cheatQuiet, clearChatDialogs, mainlandAccount, relog, seedItemsToBank, startScript, teleTo,
    type BankSeedItem
} from './tutorial/harness.js';

declare const window: {
    readonly __seedBank?: { readonly done: boolean; readonly ok: boolean; readonly banked: Readonly<Record<string, number>> };
    readonly __rs2b0t: { readonly Equipment: typeof Equipment; readonly Inventory: typeof Inventory; readonly Skills: typeof Skills };
    readonly rs2b0t: { readonly runner: {
        readonly state: string;
        readonly ctx: { readonly log: readonly { readonly msg: string }[] } | null;
        stop(reason: string): void;
    } };
};

const { values } = parseArgs({ options: {
    base: { type: 'string', default: 'http://localhost:8890' },
    armour: { type: 'string', default: 'metal' },
    'no-deploy': { type: 'boolean', default: false },
    minutes: { type: 'string', default: '20' }
} });
assert(values.armour === 'metal' || values.armour === 'leather', '--armour must be metal or leather');
const minutes = Number(values.minutes);
assert(Number.isFinite(minutes) && minutes > 0, '--minutes must be finite and positive');
const budgetMs = Math.min(minutes, 20) * 60_000;
const base = values.base;
const url = new URL(base);
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'local engine required');

const LOWER = [
    { debugName: 'adamant_chainbody', displayName: 'Adamant chainbody', qty: 1 },
    { debugName: 'adamant_platelegs', displayName: 'Adamant platelegs', qty: 1 },
    { debugName: 'adamant_full_helm', displayName: 'Adamant full helm', qty: 1 }
] satisfies BankSeedItem[];
const LEATHER = [
    { debugName: 'leather_armour', displayName: 'Leather body', qty: 1 },
    { debugName: 'leather_chaps', displayName: 'Leather chaps', qty: 1 },
    { debugName: 'leather_cowl', displayName: 'Leather cowl', qty: 1 }
] satisfies BankSeedItem[];
const armour = values.armour === 'leather' ? LEATHER : LOWER;
const RUNE = [
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'rune_full_helm', displayName: 'Rune full helm', qty: 1 }
] satisfies BankSeedItem[];
const STATS = ['attack', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic', 'agility', 'thieving',
    'herblore', 'crafting', 'mining', 'smithing', 'fishing', 'cooking', 'firemaking', 'woodcutting', 'runecraft', 'fletching'];
const PREREQS = [
    ['crestquest', 11], ['heroquest', 15], ['zombiequeen', 15], ['upass', 10],
    ['waterfall_quest', 10], ['junglepotion', 12], ['druidquest', 4]
] as const;
const COMMON = [
    { debugName: 'coins', displayName: 'Coins', qty: 10_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 30 }
] satisfies BankSeedItem[];
const TB_KIT = [
    { debugName: 'maple_shortbow', displayName: 'Maple shortbow', qty: 1 },
    { debugName: 'adamant_arrow', displayName: 'Adamant arrow', qty: 200 },
    { debugName: 'net', displayName: 'Small fishing net', qty: 1 },
    { debugName: 'knife', displayName: 'Knife', qty: 1 },
    { debugName: 'pestle_and_mortar', displayName: 'Pestle and mortar', qty: 1 },
    { debugName: 'tinderbox', displayName: 'Tinderbox', qty: 1 },
    { debugName: 'seaweed', displayName: 'Seaweed', qty: 1 },
    { debugName: 'iron_spear', displayName: 'Iron spear', qty: 1 },
    { debugName: '4dose1agility', displayName: 'Agility potion(4)', qty: 1 }
] satisfies BankSeedItem[];
const LQ_KIT = [
    { debugName: 'adamant_scimitar', displayName: 'Adamant scimitar', qty: 1 },
    { debugName: 'adamant_kiteshield', displayName: 'Adamant kiteshield', qty: 1 }
] satisfies BankSeedItem[];

const tag = `qa${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
const evidence = `out/quest-armour-${tag}`;
mkdirSync(evidence, { recursive: true });
console.log(`evidence: ${evidence}`);

async function capture(page: Page, metadata: {
    readonly quest: string; readonly defence: number; readonly user: string;
    readonly fixtureVerified: boolean; readonly passed: boolean; readonly error?: string;
}): Promise<void> {
    const state = await page.evaluate(() => ({
        runner: window.rs2b0t?.runner?.state,
        logs: window.rs2b0t?.runner?.ctx?.log,
        selectedQuest: sessionStorage.getItem('rs2b0t:set:AIOQuester:quests'),
        verifiedBank: window.__seedBank,
        equipment: window.__rs2b0t?.Equipment.items().map(({ id, name, count }) => ({ id, name, count })),
        inventory: window.__rs2b0t?.Inventory.items().map(({ id, name, count }) => ({ id, name, count }))
    })).catch(error => ({ captureError: error instanceof Error ? error.message : String(error) }));
    const prefix = `${evidence}/${metadata.quest}-${metadata.defence}-${metadata.user}`;
    writeFileSync(`${prefix}.json`, JSON.stringify({ ...metadata, armour: values.armour, carriedCoinWorkaround: 1, state }, null, 2));
    await page.screenshot({ path: `${prefix}.png` });
}

const client = values['no-deploy'] ? null : deployIsolatedClient(tag);
const cleanup = () => client?.cleanup();
process.once('exit', cleanup);
try {
    const browser = await launchBrowser();
    const timeout = setTimeout(() => { void browser.close(); }, budgetMs);
    try {
        for (const quest of ['legends', 'tbwt'] as const) {
            for (const defence of [70, 30]) {
                const page = await browser.newPage();
                const user = `qa${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}`;
                let fixtureVerified = false;
                console.log(`case: ${quest} Defence=${defence} armour=${values.armour} user=${user}`);
                writeFileSync(`${evidence}/${user}.json`, JSON.stringify({ user, quest, defence, armour: values.armour }));
                try {
                    await mainlandAccount(page, base, user, client?.page ?? '/bot.html');
                    for (const stat of STATS) {
                        assert(await cheatQuiet(page, `setstat ${stat} 70`));
                    }
                    assert(await cheatQuiet(page, `setstat defence ${defence}`));
                    await clearChatDialogs(page, 'armour fixture');
                    for (const [name, value] of PREREQS) {
                        assert(await cheatQuiet(page, `setvar ${name} ${value}`));
                    }
                    await relog(page, user);
                    await clearChatDialogs(page, 'armour fixture relog');
                    assert(await cheatQuiet(page, 'setvar qp 107'));
                    const bank = quest === 'legends' ? { x: 2852, z: 2954, level: 0 } : { x: 2616, z: 3332, level: 0 };
                    await seedItemsToBank(page, [...COMMON, ...armour, ...(defence === 30 ? RUNE : []),
                        ...(quest === 'legends' ? LQ_KIT : TB_KIT)], { x: 2616, z: 3332, level: 0 });
                    fixtureVerified = true;
                    assert(await cheatQuiet(page, 'give coins 1'));
                    assert(await teleTo(page, bank, 6, 25_000), 'preparation bank arrival');
                    const expected = [...armour.map(item => item.displayName),
                        ...(quest === 'legends' ? ['Adamant scimitar', 'Adamant kiteshield'] : ['Maple shortbow', 'Adamant arrow'])];
                    await setSettings(page, 'AIOQuester', { quests: quest, food: 'Lobster', verbose: true });
                    await startScript(page, 'AIOQuester');
                    await page.waitForFunction(names => {
                        const api = window.__rs2b0t;
                        if (!names.every(name => api.Equipment.contains(name)) || api.Inventory.count('Lobster') === 0) {
                            return false;
                        }
                        window.rs2b0t.runner.stop('armour preparation observed');
                        return true;
                    }, expected, { timeout: 120_000, polling: 100 });
                    const outcome = await page.evaluate(() => ({
                        defence: window.__rs2b0t.Skills.level('defence'),
                        worn: window.__rs2b0t.Equipment.items().map(item => item.name),
                        held: window.__rs2b0t.Inventory.items().map(item => item.name)
                    }));
                    assert.equal(outcome.defence, defence);
                    for (const name of expected) assert(outcome.worn.includes(name), `missing ${name}`);
                    assert(!outcome.held.some(name => RUNE.some(item => item.displayName === name)), 'withdrew unusable Rune');
                    await capture(page, { quest, defence, user, fixtureVerified, passed: true });
                    console.log(`PASS ${quest} Defence=${defence} user=${user}: ${outcome.worn.join(', ')}`);
                } catch (error) {
                    await capture(page, { quest, defence, user, fixtureVerified, passed: false,
                        error: error instanceof Error ? error.message : String(error) });
                    throw error;
                } finally {
                    try {
                        await stopScript(page);
                        await logout(page);
                    } finally {
                        await page.close();
                    }
                }
            }
        }
    } finally {
        clearTimeout(timeout);
        await browser.close();
    }
} finally {
    cleanup();
    process.removeListener('exit', cleanup);
}
