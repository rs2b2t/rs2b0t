import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, seedItemsToBank, startScript } from './tutorial/harness.js';

type Api = {
    __rs2b0t: {
        Inventory: { count(name: string): number; used(): number };
        Bank: { count(name: string): number; isOpen(): boolean };
        Skills: { level(name: string): number };
        Loadouts: { save(loadouts: { name: string; worn: object; carry: { item: string; qty: number }[] }[]): void };
    };
    rs2b0t: { runner: { state: string; ctx: { log: { msg: string }[] } | null } };
};

const { base } = parseArgs(process.argv.slice(2));
const tag = `rune${Date.now().toString(36).slice(-6)}`;
const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const page = await browser.newPage();
const targets = [['Air rune', 100], ['Earth rune', 20], ['Fire rune', 20], ['Law rune', 20], ['Water rune', 20]] as const;
const snapshot = () => page.evaluate(names => {
    const g = globalThis as never as Api;
    return { held: Object.fromEntries(names.map(name => [name, g.__rs2b0t.Inventory.count(name)])),
        bank: Object.fromEntries(names.map(name => [name, g.__rs2b0t.Bank.count(name)])),
        bankOpen: g.__rs2b0t.Bank.isOpen(), magic: g.__rs2b0t.Skills.level('magic'),
        food: g.__rs2b0t.Inventory.count('Trout'), slots: g.__rs2b0t.Inventory.used(),
        state: g.rs2b0t.runner.state, logs: g.rs2b0t.runner.ctx?.log.slice(-18).map(line => line.msg) ?? [] };
}, targets.map(([name]) => name));

try {
    await mainlandAccount(page, base, tag, client.page);
    assert(await cheatQuiet(page, 'setstat magic 45'), 'magic fixture');
    await clearChatDialogs(page);
    await seedItemsToBank(page, [
        ...targets.map(([name]) => ({ debugName: name.toLowerCase().replaceAll(' ', ''), displayName: name, qty: 500 })),
        { debugName: 'coins', displayName: 'Coins', qty: 5000 },
        { debugName: 'trout', displayName: 'Trout', qty: 30 },
        { debugName: 'spade', displayName: 'Spade', qty: 1 },
        { debugName: 'trail_sextant', displayName: 'Sextant', qty: 1 },
        { debugName: 'trail_watch', displayName: 'Watch', qty: 1 },
        { debugName: 'trail_chart', displayName: 'Chart', qty: 1 },
        { debugName: 'shantay_pass', displayName: 'Shantay pass', qty: 1 }
    ], { x: 3185, z: 3440, level: 0 });
    assert(await cheatQuiet(page, '~clearinv'), 'empty trail inventory');
    assert(await cheatQuiet(page, 'give trail_clue_hard_riddle012 1'), 'Hans clue fixture');
    const before = await snapshot();
    assert.equal(before.magic, 45);
    assert(targets.every(([name]) => before.held[name] === 0), 'runes start in the bank');
    await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Loadouts.save([
        { name: 'Rune budget proof', worn: {}, carry: [{ item: 'Trout', qty: 20 }] }
    ]));
    await mkdir('docs/e2e', { recursive: true });
    await page.screenshot({ path: 'docs/e2e/issue-593-before.png', fullPage: true });
    await setSettings(page, 'ClueSolver', { loadout: 'Rune budget proof', foodWithdraw: 20, restorePrayer: false, useTeleports: true });
    await startScript(page, 'ClueSolver');
    await page.waitForFunction(expected => {
        const g = globalThis as never as Api;
        return g.__rs2b0t.Bank.isOpen() && g.__rs2b0t.Inventory.count('Trout') === 10 &&
            expected.every(([name, count]) => g.__rs2b0t.Inventory.count(name) === count && g.__rs2b0t.Bank.count(name) === 500 - count);
    }, targets, { timeout: 180_000, polling: 50 });
    const after = await snapshot();
    assert.equal(after.food, 10, 'trail food cap');
    for (const [name, count] of targets) {
        assert.equal(after.held[name], count, `${name} cast budget`);
        assert.equal(after.bank[name], 500 - count, `${name} withdrawn from the seeded bank`);
    }
    await stopScript(page);
    await page.screenshot({ path: 'docs/e2e/issue-593.png', fullPage: true });
    await Bun.write('docs/e2e/issue-593.json', JSON.stringify({ issue: 593, result: 'PASS', at: new Date().toISOString(),
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), before, after }, null, 2) + '\n');
    console.log('PASS', JSON.stringify({ before, after }));
} catch (error) {
    console.log('FAILURE STATE', JSON.stringify(await snapshot().catch(() => null)));
    await mkdir('out', { recursive: true });
    await page.screenshot({ path: 'out/issue-593-failure.png', fullPage: true }).catch(() => undefined);
    throw error;
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
