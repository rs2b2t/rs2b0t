import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

type Api = {
    __rs2b0t: { Inventory: { count(name: string): number; first(name: string): { interact(op: string): Promise<boolean> } | null } };
    rs2b0t: {
        reader: { worldTile(): { x: number; z: number; level: number } | null; groundItems(): { id: number; count: number; distance: number }[] };
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
    };
};

const { base } = parseArgs(process.argv.slice(2));
const tag = `coin${Date.now().toString(36).slice(-6)}`;
const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const page = await browser.newPage();
const snapshot = () => page.evaluate(() => {
    const g = globalThis as never as Api;
    return { coins: g.__rs2b0t.Inventory.count('Coins'), tile: g.rs2b0t.reader.worldTile(),
        ground: g.rs2b0t.reader.groundItems().filter(item => item.id === 995 && item.distance <= 2),
        state: g.rs2b0t.runner.state, logs: g.rs2b0t.runner.ctx?.log.slice(-12).map(line => line.msg) ?? [] };
});

try {
    await mainlandAccount(page, base, tag, client.page);
    assert(await teleTo(page, { x: 2780, z: 3050, level: 0 }, 0), 'runner fixture teleport');
    assert(await cheatQuiet(page, '~clearinv'), 'clear inventory');
    assert(await cheatQuiet(page, 'give coins 450'), 'seed coins');
    await page.waitForFunction(() => (globalThis as never as Api).__rs2b0t.Inventory.count('Coins') === 450);
    assert(await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.first('Coins')?.interact('Drop')), 'drop coin stack');
    await page.waitForFunction(() => {
        const g = globalThis as never as Api;
        return g.__rs2b0t.Inventory.count('Coins') === 0 && g.rs2b0t.reader.groundItems().some(item => item.id === 995 && item.count === 450 && item.distance <= 1);
    });
    const before = await snapshot();
    await mkdir('docs/e2e', { recursive: true });
    await page.screenshot({ path: 'docs/e2e/issue-739-before.png', fullPage: true });
    await setSettings(page, 'NatureCrafter', { mode: 'Runner', rune: 'Nature runes', partner: 'fixturemaster', bankEvery: 0 });
    await startScript(page, 'NatureCrafter');
    await page.waitForFunction(() => {
        const g = globalThis as never as Api;
        return g.__rs2b0t.Inventory.count('Coins') === 450 && !g.rs2b0t.reader.groundItems().some(item => item.id === 995 && item.distance <= 2);
    }, undefined, { timeout: 20_000 });
    const after = await snapshot();
    assert.equal(after.coins - before.coins, 450, 'runner received the dropped stack');
    assert.equal(after.ground.length, 0, 'dropped stack left the ground');
    assert.equal(after.state, 'running', 'runner remained active');
    await stopScript(page);
    await page.screenshot({ path: 'docs/e2e/issue-739.png', fullPage: true });
    await Bun.write('docs/e2e/issue-739.json', JSON.stringify({ issue: 739, result: 'PASS', at: new Date().toISOString(),
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), before, after }, null, 2) + '\n');
    console.log('PASS', JSON.stringify({ before, after }));
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
