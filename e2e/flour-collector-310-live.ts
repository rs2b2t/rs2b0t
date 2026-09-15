import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, stopScript, type Rs2b0t } from './lib/harness.js';
import { getServerVarQuiet, mainlandAccount, relog, seedItemsToBank, startScript } from './tutorial/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 8 });
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'local engine required');
const bank = { x: 2725, z: 3491, level: 0 };
const tag = `fc310${Date.now().toString(36).slice(-6)}`;
const pagePath = process.env.CLIENT_PAGE;
if (process.argv.includes('--no-deploy')) assert(pagePath && /^\/bot-[\w-]+\.html$/.test(pagePath), '--no-deploy requires an isolated CLIENT_PAGE');
const client = process.argv.includes('--no-deploy') ? { page: pagePath!, cleanup: () => undefined } : deployIsolatedClient(tag, process.env.ENGINE_DIR);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(String(error)));
mkdirSync('docs/e2e', { recursive: true });

type Api = Rs2b0t & {
    rs2b0t: { runner: { pause(): void; resume(): void } };
    __rs2b0t: {
        Inventory: { countById(id: number): number };
        Bank: { countById(id: number): number; isOpen(): boolean; ready(): boolean };
        Quests: { status(name: string): string };
    };
};
const snapshot = async () => {
    const current = await page.evaluate(() => {
        const g = globalThis as never as Api;
        return {
            state: g.rs2b0t.runner.state,
            tile: g.rs2b0t.reader.worldTile(),
            inventory: g.rs2b0t.reader.inventory(),
            pots: g.__rs2b0t.Inventory.countById(1931),
            flour: g.__rs2b0t.Inventory.countById(1933),
            bankPots: g.__rs2b0t.Bank.countById(1931),
            bankFlour: g.__rs2b0t.Bank.countById(1933),
            bankOpen: g.__rs2b0t.Bank.isOpen(),
            bankReady: g.__rs2b0t.Bank.ready(),
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-15)
        };
    });
    return current;
};

try {
    await mainlandAccount(page, base, tag, client.page);
    assert(await cheatQuiet(page, 'setvar murderquest 1'));
    assert.equal(await getServerVarQuiet(page, 'murderquest'), 1);
    await relog(page, tag);
    assert.equal(await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Quests.status('Murder Mystery')), 'inProgress');
    assert(await cheatQuiet(page, '~clearinv'));
    await seedItemsToBank(page, [{ debugName: 'pot_empty', displayName: 'Pot', qty: 30 }], bank);
    await startScript(page, 'FlourCollector');
    await page.waitForFunction(() => {
        const g = globalThis as never as Api;
        if (!g.__rs2b0t.Bank.ready() || g.__rs2b0t.Bank.countById(1931) !== 30) return false;
        g.rs2b0t.runner.pause();
        return true;
    }, undefined, { timeout: 30_000 });
    const before = await snapshot();
    assert.equal(before.bankPots, 30);
    assert.equal(before.pots + before.flour + before.bankFlour, 0, 'fixture must contain only banked empty pots');
    console.log(`BEFORE ${JSON.stringify(before)}`);
    await page.screenshot({ path: 'docs/e2e/issue-310-before.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.resume());
    const deadline = Date.now() + minutes * 60_000;
    let withdrew = false;
    let filled = false;
    let banked = false;
    let restocked = false;
    let done = false;
    let nextLog = 0;
    while (Date.now() < deadline) {
        const current = await snapshot();
        withdrew ||= current.pots === 28 && current.inventory.filter(item => item.id === 1931).length === 28;
        if (!filled && withdrew && current.flour === 28) {
            filled = true;
            console.log(`FILLED ${JSON.stringify(current)}`);
            await page.screenshot({ path: 'docs/e2e/issue-310-filled.png' });
        }
        if (!banked && filled && current.bankFlour === 28 && current.bankReady) {
            assert(current.tile && Math.max(Math.abs(current.tile.x - bank.x), Math.abs(current.tile.z - bank.z)) <= 6, 'flour must be deposited at Seers');
            banked = true;
            console.log(`BANKED ${JSON.stringify(current)}`);
            await page.screenshot({ path: 'docs/e2e/issue-310-bank.png' });
        }
        restocked ||= banked && current.pots === 2 && current.flour === 0;
        if (restocked && current.flour > 0) {
            console.log(`PASS #310 firstLoad=28 secondLoadFlour=${current.flour} ${JSON.stringify(current)}`);
            await page.screenshot({ path: 'docs/e2e/issue-310.png' });
            done = true;
            break;
        }
        assert.equal(current.state, 'running', JSON.stringify(current));
        if (Date.now() >= nextLog) {
            console.log(`WATCH ${JSON.stringify(current)}`);
            nextLog = Date.now() + 10_000;
        }
        await page.waitForTimeout(200);
    }
    assert(done, `withdrew=${withdrew} filled=${filled} banked=${banked} restocked=${restocked}: ${JSON.stringify(await snapshot())}`);
    assert.deepEqual(errors, [], 'browser errors');
} catch (error) {
    console.log(`FAIL ${JSON.stringify(await snapshot())}`);
    throw error;
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
