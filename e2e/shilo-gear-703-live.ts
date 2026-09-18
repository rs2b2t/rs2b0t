import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript, type Rs2b0t } from './lib/harness.js';
import { clearChatDialogs, getServerVarQuiet, mainlandAccount, relog, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { minutes: 3 });
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'local engine required');
const cases = rest.length ? rest : ['inventory', 'bank-full'];
assert(cases.every(name => ['inventory', 'bank-full'].includes(name)), 'cases: inventory bank-full');
const bank = { x: 2616, z: 3332, level: 0 };
const gear = [
    ['steel_scimitar', 'Steel scimitar'],
    ['steel_chainbody', 'Steel chainbody'],
    ['steel_platelegs', 'Steel platelegs'],
    ['steel_full_helm', 'Steel full helm'],
    ['steel_kiteshield', 'Steel kiteshield']
] as const;
const protectedItems = ['Rope', 'Tattered scroll'];

type Api = Rs2b0t & {
    __rs2b0t: {
        Inventory: { count(name: string): number; used(): number };
        Bank: { count(name: string): number };
        Skills: { level(name: string): number };
        Quests: { status(name: string): string };
    };
};

async function give(page: Page, obj: string, name: string, count: number): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
        const held = await page.evaluate(n => (globalThis as never as Api).__rs2b0t.Inventory.count(n), name);
        if (held >= count) return;
        assert(await cheatQuiet(page, `give ${obj} ${count - held}`), `give ${obj} not sent`);
    }
    assert(await page.evaluate(([n, qty]) => (globalThis as never as Api).__rs2b0t.Inventory.count(n) >= qty, [name, count] as const), `missing ${name}`);
}

function snapshot(page: Page) {
    return page.evaluate(() => {
        const g = globalThis as never as Api;
        return {
            state: g.rs2b0t.runner.state,
            tile: g.rs2b0t.reader.worldTile(),
            inventory: g.rs2b0t.reader.inventory(),
            equipment: g.rs2b0t.reader.equipment(),
            bankFood: g.__rs2b0t.Bank.count('Lobster'),
            bankGear: ['Steel scimitar', 'Steel chainbody', 'Steel platelegs', 'Steel full helm', 'Steel kiteshield'].map(name => [name, g.__rs2b0t.Bank.count(name)]),
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-15)
        };
    });
}

assert((await fetch(`${base}/bot.html`, { signal: AbortSignal.timeout(5000) })).ok, 'local engine unavailable');
const tag = `sv703${Date.now().toString(36).slice(-6)}`;
const pagePath = process.env.CLIENT_PAGE;
if (process.argv.includes('--no-deploy')) assert(pagePath && /^\/bot-[\w-]+\.html$/.test(pagePath), '--no-deploy requires CLIENT_PAGE=/bot-<isolated-tag>.html');
const client = process.argv.includes('--no-deploy')
    ? { page: pagePath!, cleanup: () => undefined }
    : deployIsolatedClient(tag, process.env.ENGINE_DIR);
const browser = await launchBrowser({ swiftshader: true });
try {
    for (const scenario of cases) {
        const context = await browser.newContext();
        const page = await context.newPage();
        const user = `s7${scenario === 'inventory' ? 'i' : 'b'}${Date.now().toString(36).slice(-8)}`;
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(String(error)));
        console.log(`CASE ${scenario} user=${user}`);
        try {
            await mainlandAccount(page, base, user, client.page);
            for (const command of ['setvar druidquest 4', 'setvar junglepotion 12', 'setvar zombiequeen 7']) {
                assert(await cheatQuiet(page, command), `${command} not sent`);
            }
            assert.equal(await getServerVarQuiet(page, 'zombiequeen'), 7);
            await relog(page, user);
            assert.equal(await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Quests.status('Shilo Village')), 'inProgress');
            for (const skill of ['attack', 'defence', 'hitpoints', 'crafting', 'agility', 'smithing', 'mining']) {
                assert(await cheatQuiet(page, `setstat ${skill} 60`));
            }
            await clearChatDialogs(page);
            assert(await page.evaluate(() => ['attack', 'defence', 'hitpoints'].every(name => (globalThis as never as Api).__rs2b0t.Skills.level(name) >= 60)));
            assert(await cheatQuiet(page, '~clearinv'));
            assert(await teleTo(page, bank, 2));
            if (scenario === 'bank-full') {
                await seedItemsToBank(page, gear.map(([debugName, displayName]) => ({ debugName, displayName, qty: 1 })), bank);
            } else {
                for (const [obj, name] of gear) await give(page, obj, name, 1);
            }
            await give(page, 'rope', 'Rope', 1);
            await give(page, 'zqberviriusscroll', 'Tattered scroll', 1);
            await give(page, 'lobster', 'Lobster', scenario === 'inventory' ? 21 : 26);
            assert.equal(await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.used()), 28, 'fixture must fill all 28 slots');
            const before = await snapshot(page);
            assert(gear.every(([, name]) => !before.equipment.some(item => item.name === name)), 'fixture must leave combat gear unequipped');
            console.log(`BEFORE ${scenario} ${JSON.stringify(before)}`);
            await page.screenshot({ path: `docs/e2e/issue-703-${scenario}-before.png` });
            if (scenario === 'inventory') assert(await teleTo(page, { x: 2898, z: 9401, level: 0 }, 1));
            await setSettings(page, 'AIOQuester', { quests: 'zombiequeen', food: 'Lobster' });
            await startScript(page, 'AIOQuester');
            const deadline = Date.now() + minutes * 60_000;
            let done = false;
            let bankFoodPeak = before.bankFood;
            let nextLog = 0;
            while (Date.now() < deadline) {
                const current = await snapshot(page);
                if (current.bankFood > bankFoodPeak) {
                    bankFoodPeak = current.bankFood;
                    await page.screenshot({ path: 'docs/e2e/issue-703-bank-deposit.png' });
                }
                assert(protectedItems.every(name => current.inventory.some(item => item.name === name && item.count === 1)), `quest item lost: ${JSON.stringify(current)}`);
                if (gear.every(([, name]) => current.equipment.some(item => item.name === name))) {
                    if (scenario === 'bank-full') assert(bankFoodPeak > before.bankFood, 'full pack never freed room by banking food');
                    console.log(`PASS ${scenario} ${JSON.stringify({ ...current, bankFoodPeak })}`);
                    await page.screenshot({ path: `docs/e2e/issue-703-${scenario}-after.png` });
                    done = true;
                    break;
                }
                assert.equal(current.state, 'running', JSON.stringify(current));
                if (Date.now() >= nextLog) {
                    console.log(`WATCH ${scenario} ${JSON.stringify(current)}`);
                    nextLog = Date.now() + 10_000;
                }
                await page.waitForTimeout(250);
            }
            assert(done, `gear never equipped: ${JSON.stringify(await snapshot(page))}`);
            assert.deepEqual(errors, [], 'browser errors');
        } finally {
            await stopScript(page).catch(() => undefined);
            await logout(page).catch(() => false);
            await context.close();
        }
    }
    console.log('PASS #703 Shilo inventory and bank gearing');
} finally {
    await browser.close();
    client.cleanup();
}
