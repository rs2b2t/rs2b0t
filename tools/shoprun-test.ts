import { launchBrowser } from './lib/harness.js';
import { type Page } from 'playwright-core';
import { cheat, mainlandAccount } from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';
const user = `shoprun${Date.now() % 100000}`;

async function fail(msg: string): Promise<never> {
    try {
        const tail = (await logLines()).slice(-20);
        console.error('--- last runner log lines (tail) ---');
        for (const line of tail) {
            console.error(`  ${line}`);
        }
    } catch (err) {
        console.error(`(could not read runner log: ${err instanceof Error ? err.message : String(err)})`);
    }
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const browser = await launchBrowser();
const page: Page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror:', e.message));

await mainlandAccount(page, base, user);
await cheat(page, '~bankitem coins 100000');
await cheat(page, 'tele 0,50,53,51,28');

await page.evaluate(() => {
    localStorage.setItem('rs2b0t:set:ShopRunner:route', 'smoke-varrock');
    localStorage.setItem('rs2b0t:set:ShopRunner:maxGpPerLeg', '30000');
});

interface R { rs2b0t: { runner: { start(m: unknown): void; ctx?: { log: { msg: string }[] } }; registry: { get(n: string): unknown } } }
await page.evaluate(() => {
    const r = (globalThis as never as R).rs2b0t;
    r.runner.start(r.registry.get('ShopRunner'));
});

const logLines = (): Promise<string[]> => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

async function waitForLog(re: RegExp, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const hit = (await logLines()).find(l => re.test(l));
        if (hit) {
            return hit;
        }
        await new Promise(r => setTimeout(r, 1000));
    }
    return fail(`timed out waiting for ${re}`);
}

const withdraw = await waitForLog(/\[shoprun\] varrock: withdrew (\d+)gp/, 120_000);
const amount = Number(/withdrew (\d+)gp/.exec(withdraw)![1]);
if (amount > 30_000) {
    await fail(`withdrawal ${amount} exceeds maxGpPerLeg 30000`);
}
await waitForLog(/\[shoprun\] buy shop=runeshop item=\w+ n=\d+ spent=\d+/, 180_000);
await waitForLog(/\[shoprun\] cluster varrock done — advancing the ring/, 180_000);
await waitForLog(/\[shoprun\] varrock: withdrew \d+gp|\[shoprun\] buy shop=runeshop/, 120_000);

console.log('PASS: fund → buy out → ring advance → next lap');
await browser.close();
process.exit(0);
