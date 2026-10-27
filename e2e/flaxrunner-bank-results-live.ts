import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { cheatQuiet, deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript, type Rs2b0t } from './lib/harness.js';
import { mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2));
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'local engine required');
const tag = `flax${Date.now().toString(36).slice(-7)}`;
const proofDir = process.env.PROOF_DIR ?? 'out/flaxrunner-bank-results';
const before = process.env.EXPECT_MODE === 'before';
mkdirSync(proofDir, { recursive: true });
const engine = process.env.ENGINE_DIR;
assert(engine, 'ENGINE_DIR required');
const pagePath = process.env.CLIENT_PAGE;
const deploy = !process.argv.includes('--no-deploy');
if (!deploy) assert(pagePath && /^\/bot-[\w-]+\.html$/.test(pagePath), '--no-deploy requires an isolated CLIENT_PAGE');
const client = deploy ? deployIsolatedClient(tag, engine) : { page: pagePath!, cleanup: () => undefined };
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
type Call = { name: string; phase: string; result?: unknown };
type Scenario = 'walk-failure' | 'open-failure' | 'success';
type Api = Rs2b0t & {
    __rs2b0t: { Traversal: { walkResilient(...args: unknown[]): Promise<boolean> }; Bank: { openBooth(...args: unknown[]): Promise<boolean>; depositInventory(): Promise<void>; close(): Promise<boolean> } };
    flaxCalls: Call[];
    flaxScenario: Scenario;
    flaxAfterWalk(): Promise<void>;
    rs2b0t: { runner: { bot: { trips: number }; pause(): void } };
};
const sea = { x: 3000, z: 3000, level: 0 };
const bank = { x: 2724, z: 3491, level: 0 };
const results: unknown[] = [];
const snapshot = () => page.evaluate(() => {
    const g = globalThis as never as Api;
    return { calls: g.flaxCalls, trips: g.rs2b0t.runner.bot?.trips, tile: g.rs2b0t.reader.worldTile(), inventory: g.rs2b0t.reader.inventory(), logs: g.rs2b0t.runner.ctx?.log ?? [] };
});
try {
    await mainlandAccount(page, base, tag, client.page);
    await page.exposeFunction('flaxAfterWalk', async () => {
        assert(await teleTo(page, sea, 0), 'bank-open fixture teleport failed');
    });
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        g.flaxCalls = [];
        const observe = (owner: Record<string, (...args: unknown[]) => Promise<unknown>>, name: string) => {
            const original = owner[name];
            owner[name] = async (...args) => {
                g.flaxCalls.push({ name, phase: 'start' });
                const result = await original.apply(owner, args);
                g.flaxCalls.push({ name, phase: 'end', result });
                if (name === 'walkResilient' && result === true && g.flaxScenario === 'open-failure') await g.flaxAfterWalk();
                return result;
            };
        };
        observe(g.__rs2b0t.Traversal, 'walkResilient');
        observe(g.__rs2b0t.Bank, 'openBooth');
        observe(g.__rs2b0t.Bank, 'depositInventory');
        observe(g.__rs2b0t.Bank, 'close');
    });
    await setSettings(page, 'FlaxRunner', { mode: 'Spinner', partner: 'flaxpartner' });
    for (const scenario of ['walk-failure', 'open-failure', 'success'] as const) {
        assert(await cheatQuiet(page, '~clearinv'));
        assert(await cheatQuiet(page, 'give bow_string 1'));
        assert(await teleTo(page, scenario === 'walk-failure' ? sea : bank, 0));
        await page.evaluate(value => {
            const g = globalThis as never as Api;
            g.flaxCalls = [];
            g.flaxScenario = value;
        }, scenario);
        await startScript(page, 'FlaxRunner');
        await page.waitForFunction(() => {
            const g = globalThis as never as Api;
            const ended = g.flaxCalls.some(call => call.phase === 'end');
            const failed = g.rs2b0t.runner.ctx?.log.some(line => /could not (reach the bank entrance|open the bank) — will retry/.test(line.msg));
            if (!ended || (!(g.rs2b0t.runner.bot?.trips > 0) && !failed)) return false;
            g.rs2b0t.runner.pause();
            return true;
        }, undefined, { timeout: 240_000 });
        const result = await snapshot();
        results.push({ scenario, result });
        console.log(`RESULT ${scenario} ${JSON.stringify(result)}`);
        const ended = (name: string, value: unknown) => result.calls.some(call => call.name === name && call.phase === 'end' && call.result === value);
        assert(ended('walkResilient', scenario !== 'walk-failure'), 'unexpected walk result');
        if (scenario === 'success' || before) {
            assert(ended('openBooth', scenario === 'success'), 'unexpected bank result');
            assert(ended('depositInventory', undefined), 'deposit did not continue');
            assert.equal(result.trips, 1);
        } else {
            if (scenario === 'walk-failure') assert(!result.calls.some(call => call.name === 'openBooth'), 'opened after failed walk');
            else assert(ended('openBooth', false), 'bank open did not fail');
            assert(!result.calls.some(call => call.name === 'depositInventory' || call.name === 'close'), 'continued after failed prerequisite');
            assert.equal(result.trips, 0);
        }
        assert.equal(result.inventory.some(item => item.id === 1777), scenario !== 'success');
        await page.screenshot({ path: `${proofDir}/${tag}-${scenario}.png` });
        await stopScript(page);
    }
    writeFileSync(`${proofDir}/${tag}.json`, JSON.stringify({ classification: before ? 'reproduced' : 'pass', tag, base, before, fixture: 'seeded strings; unreachable sea tile for walk failure; per-account teleport after successful walk for bank-open failure; real API results unchanged', results }, null, 2));
    console.log(`${before ? 'REPRODUCED' : 'PASS'} spinner bank prerequisite checks and successful deposit`);
} catch (error) {
    const result = await snapshot().catch(() => null);
    writeFileSync(`${proofDir}/${tag}.json`, JSON.stringify({ classification: 'unconfirmed', tag, error: String(error), results, result }, null, 2));
    await page.screenshot({ path: `${proofDir}/${tag}-failure.png` }).catch(() => undefined);
    throw error;
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
    const paths = [`${engine}/public/bot/${tag}`, `${engine}/public/bot-${tag}.html`];
    assert(paths.every(path => !existsSync(path)), 'isolated deployment cleanup failed');
    console.log(`CLEANUP ${JSON.stringify(paths)}`);
}
