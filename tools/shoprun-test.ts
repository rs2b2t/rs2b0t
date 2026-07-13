/**
 * ShopRunner smoke vs the local engine. Proves one full cluster leg:
 * seeded bank coins → withdraw (capped) → buy runes at Aubury under a 90%
 * floor → deposit haul+coins → immediate re-plan SKIPS the cluster (stock
 * model). Floor 90 keeps the haul to ~1000 runes (~100 Buy-10 clicks ≈ 2
 * min) so the leg fits the smoke timeout; floor 50 would buy ~5000.
 * Route: SMOKE_ROUTE (Aubury only) via the `route` setting.
 * Run: bun tools/shoprun-test.ts [http://localhost:8890]
 */
import { chromium, type Page } from 'playwright-core';
import { cheat, mainlandAccount } from './tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';
const user = `shoprun${Date.now() % 100000}`;

async function fail(msg: string): Promise<never> {
    // Dump the runner log tail so a live failure is diagnosable from the smoke
    // log alone (logLines is defined below; fail only runs after it exists).
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

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page: Page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror:', e.message));

await mainlandAccount(page, base, user);
// seed BANK coins (bank-seed cheat form; pack-seed would be ::give)
await cheat(page, '~bankitem coins 100000');
// stand near Varrock East bank: (3251,3420) → msq 50_53, local (51,28)
await cheat(page, 'tele 0,50,53,51,28');

// settings BEFORE start: smoke route, floor 90%, small cap (raw-string form of Settings.save)
await page.evaluate(() => {
    localStorage.setItem('rs2b0t:set:ShopRunner:route', 'smoke-varrock');
    localStorage.setItem('rs2b0t:set:ShopRunner:strategy', 'Floor %');
    localStorage.setItem('rs2b0t:set:ShopRunner:floorPct', '90');
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
    return fail(`timed out waiting for ${re}`); // Promise<never> — also satisfies the string return
}

// 1. withdrawal happens, is capped, and names the cluster
const withdraw = await waitForLog(/\[shoprun\] withdraw (\d+)gp cluster=varrock/, 120_000);
const amount = Number(/withdraw (\d+)gp/.exec(withdraw)![1]);
if (amount > 30_000) {
    await fail(`withdrawal ${amount} exceeds maxGpPerLeg 30000`);
}
// 2. real purchases at Aubury (floor 90% leaves stock behind)
await waitForLog(/\[shoprun\] buy shop=runeshop item=\w+ n=\d+ spent=\d+/, 180_000);
// 3. haul + coins banked back
await waitForLog(/\[shoprun\] banked cluster=varrock/, 180_000);
// 4. the stock model now skips the cluster (skip log or idle — either proves it)
await waitForLog(/\[shoprun\] (skip cluster=varrock haul=\d+%|idle until ~)/, 60_000);

console.log('PASS: withdraw → buy → bank → model-driven skip');
await browser.close();
process.exit(0);
