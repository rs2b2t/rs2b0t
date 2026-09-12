import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript, type Rs2b0t } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 6 });
assert(['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname), 'local engine required');
const bank = { x: 3185, z: 3440, level: 0 };
const shop = { x: 3281, z: 3398, level: 0 };
const tag = `lt279${Date.now().toString(36).slice(-6)}`;
const pagePath = process.env.CLIENT_PAGE;
if (process.argv.includes('--no-deploy')) assert(pagePath && /^\/bot-[\w-]+\.html$/.test(pagePath), '--no-deploy requires an isolated CLIENT_PAGE');
const client = process.argv.includes('--no-deploy') ? { page: pagePath!, cleanup: () => undefined } : deployIsolatedClient(tag, process.env.ENGINE_DIR);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const errors: string[] = [];
page.on('pageerror', error => errors.push(String(error)));
mkdirSync('docs/e2e', { recursive: true });

type Api = Rs2b0t & {
    __rs2b0t: {
        Inventory: { count(name: string): number };
        Bank: { count(name: string): number; isOpen(): boolean; ready(): boolean };
        Locs: { query(): { name(name: string): { nearest(): { interact(op: string): boolean | Promise<boolean> } | null } } };
        Skills: { xp(name: string): number; level(name: string): number };
        Shop: { isOpen(): boolean; stock(): { name: string; count: number }[] };
    };
};

const snapshot = async () => {
    const current = await page.evaluate(() => {
        const g = globalThis as never as Api;
        return {
            state: g.rs2b0t.runner.state,
            tile: g.rs2b0t.reader.worldTile(),
            inventory: g.rs2b0t.reader.inventory(),
            thread: g.__rs2b0t.Inventory.count('Thread'),
            leather: g.__rs2b0t.Inventory.count('Leather'),
            coins: g.__rs2b0t.Inventory.count('Coins'),
            bankCoins: g.__rs2b0t.Bank.count('Coins'),
            bankThread: g.__rs2b0t.Bank.count('Thread'),
            bankLeather: g.__rs2b0t.Bank.count('Leather'),
            bankOpen: g.__rs2b0t.Bank.isOpen(),
            bankReady: g.__rs2b0t.Bank.ready(),
            shopOpen: g.__rs2b0t.Shop.isOpen(),
            stock: g.__rs2b0t.Shop.stock(),
            xp: g.__rs2b0t.Skills.xp('crafting'),
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-15)
        };
    });
    return current;
};
const distance = (tile: { x: number; z: number } | null, target: { x: number; z: number }) => tile ? Math.max(Math.abs(tile.x - target.x), Math.abs(tile.z - target.z)) : Infinity;

try {
    await mainlandAccount(page, base, tag, client.page);
    assert(await cheatQuiet(page, 'setstat crafting 14'));
    await clearChatDialogs(page);
    assert.equal(await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Skills.level('crafting')), 14);
    assert(await cheatQuiet(page, '~clearinv'));
    await seedItemsToBank(page, [
        { debugName: 'needle', displayName: 'Needle', qty: 1 },
        { debugName: 'leather', displayName: 'Leather', qty: 40 },
        { debugName: 'coins', displayName: 'Coins', qty: 500 }
    ], bank);
    assert(await teleTo(page, bank, 2));
    assert(await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Locs.query().name('Bank booth').nearest()?.interact('Use-quickly')));
    await page.waitForFunction(() => (globalThis as never as Api).__rs2b0t.Bank.ready(), undefined, { timeout: 10_000 });
    const before = await snapshot();
    assert.equal(before.thread + before.bankThread, 0, 'fixture must have no thread');
    assert.equal(before.bankLeather, 40);
    assert.equal(before.bankCoins, 500);
    console.log(`BEFORE ${JSON.stringify(before)}`);
    await page.screenshot({ path: 'docs/e2e/issue-279-before.png' });
    await setSettings(page, 'LeatherCrafter', { leatherType: 'Leather', threadPerTrip: 20 });
    await startScript(page, 'LeatherCrafter');
    const deadline = Date.now() + minutes * 60_000;
    let sawShop = false;
    let purchased = false;
    let returned: Awaited<ReturnType<typeof snapshot>> | null = null;
    let nextLog = 0;
    let done = false;
    while (Date.now() < deadline) {
        const current = await snapshot();
        sawShop ||= current.shopOpen && distance(current.tile, shop) <= 8;
        if (!purchased && sawShop && current.thread > 0 && distance(current.tile, shop) <= 8) {
            purchased = true;
            console.log(`PURCHASE ${JSON.stringify(current)}`);
            await page.screenshot({ path: 'docs/e2e/issue-279-shop.png' });
        }
        if (purchased && current.bankReady && distance(current.tile, bank) <= 6 && current.leather > 0) returned = current;
        if (returned && current.xp > before.xp && distance(current.tile, bank) <= 6) {
            assert(returned.coins + returned.bankCoins < before.bankCoins, 'thread purchase did not spend coins');
            assert(returned.bankLeather < before.bankLeather, 'no banked leather withdrawn');
            console.log(`RETURNED ${JSON.stringify(returned)}`);
            console.log(`PASS #279 purchased=${purchased} returned=true craftingXp=${current.xp - before.xp} ${JSON.stringify(current)}`);
            await page.screenshot({ path: 'docs/e2e/issue-279.png' });
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
    assert(done, `sawShop=${sawShop} purchased=${purchased} returned=${returned}: ${JSON.stringify(await snapshot())}`);
    assert.deepEqual(errors, [], 'browser errors');
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
