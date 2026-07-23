/**
 * ShopRunner MAGE ARENA smoke: the REAL live ring parked after magicguild so
 * the wilderness cluster runs next. Fund at Edgeville (deposit-all keeps the
 * Knife), staged deep-wildy walk, Slash the ruin webs, cellar ladder, buy out
 * Lundail, deposit the haul with Gundai IN-CELLAR, ring advances. PASS also
 * asserts the wilderness law: after the cluster the pack holds nothing but
 * the Knife (+ leftover coins).
 * Run: bun tools/nav/shopring-arena-test.ts [http://localhost:8890]
 */
import { launchBrowser } from '../lib/harness.js';
import { type Page } from 'playwright-core';
import { cheat, cheatQuiet, mainlandAccount } from '../tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';
const user = `srarena${Date.now() % 100000}`;

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

const browser = await launchBrowser();
const page: Page = await browser.newPage();
page.on('pageerror', e => console.error('pageerror:', e.message));

await mainlandAccount(page, base, user);
// seed the bank BEFORE maxme (maxme's dialogs swallow the next typed command)
await cheat(page, '~bankitem coins 250000');
await cheat(page, '~bankitem rune_scimitar 1');
await cheat(page, '~maxme');
// stand near Edgeville bank: (3094,3493) → msq 48_54, local (30,37)
await cheatQuiet(page, 'tele 0,48,54,30,37');

// settings + ring position BEFORE start: live route, arena ON, ring parked
// after magicguild so magearena runs next
// resolve the LIVE account name (the state key onStart reads), then seed the
// ring position so the next cluster is the one under test — verified readback.
const seededKey = await page.evaluate(async (park: string) => {
    const g = globalThis as never as { __rs2b0t: { Game: { myName(): string | null } } };
    let name = '';
    for (let i = 0; i < 40 && !name; i++) { name = g.__rs2b0t.Game.myName() ?? ''; if (!name) { await new Promise(r => setTimeout(r, 250)); } }
    localStorage.setItem('rs2b0t:set:ShopRunner:route', 'live');
    localStorage.setItem('rs2b0t:set:ShopRunner:maxGpPerLeg', '60000');
    localStorage.setItem('rs2b0t:set:ShopRunner:mageArena', 'true');
    const key = `rs2b0t:shoprun:state:${name.toLowerCase()}`;
    localStorage.setItem(key, JSON.stringify({ lastClusterId: park }));
    return `${key} = ${localStorage.getItem(key)}`;
}, 'magicguild');
console.log(`seeded ring state: ${seededKey}`);

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

// 1. funded at Edgeville
await waitForLog(/\[shoprun\] magearena: withdrew \d+gp/, 180_000);
// 2. bought out Lundail (the deep-wildy walk takes a while)
await waitForLog(/\[shoprun\] buy shop=magearena_runeshop item=\w+ n=\d+/, 900_000);
// 3. cluster done = the Gundai in-cellar deposit ran
await waitForLog(/\[shoprun\] cluster magearena done/, 240_000);
// 4. the wilderness law: nothing in the pack but the slash weapon (+ leftover coins)
const packNames: string[] = await page.evaluate(() => {
    const abi = (globalThis as never as { __rs2b0t: { Inventory: { items(): { name: string | null }[] } } }).__rs2b0t;
    return abi.Inventory.items().map(i => i.name ?? '');
});
const contraband = packNames.filter(n => n !== '' && n !== 'Rune scimitar' && n !== 'Coins');
if (contraband.length > 0) {
    await fail(`wilderness law violated — pack still holds: ${contraband.join(', ')}`);
}
console.log(`pack after the arena: [${packNames.filter(n => n).join(', ')}] — clean`);
console.log('PASS: Edgeville fund → wildy walk → Lundail buyout → Gundai deposit → ring advance');
await browser.close();
process.exit(0);
