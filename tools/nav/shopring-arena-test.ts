import { launchBrowser } from '../lib/harness.js';
import { type Page } from 'playwright-core';
import { cheat, cheatQuiet, mainlandAccount } from '../tutorial/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';
const user = `srarena${Date.now() % 100000}`;

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
await cheat(page, '~bankitem coins 250000');
await cheat(page, '~bankitem rune_scimitar 1');
await cheat(page, '~maxme');
await cheatQuiet(page, 'tele 0,48,54,30,37');

const seededKey = await page.evaluate(async (park: string) => {
    const g = globalThis as never as { __rs2b0t: { Game: { myName(): string | null } } };
    let name = '';
    for (let i = 0; i < 40 && !name; i++) { name = g.__rs2b0t.Game.myName() ?? ''; if (!name) { await new Promise(r => setTimeout(r, 250)); } }
    sessionStorage.setItem('rs2b0t:set:ShopRunner:route', 'live');
    sessionStorage.setItem('rs2b0t:set:ShopRunner:maxGpPerLeg', '60000');
    sessionStorage.setItem('rs2b0t:set:ShopRunner:mageArena', 'true');
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
    return fail(`timed out waiting for ${re}`);
}

await waitForLog(/\[shoprun\] magearena: withdrew \d+gp/, 180_000);
await waitForLog(/\[shoprun\] buy shop=magearena_runeshop item=\w+ n=\d+/, 900_000);
await waitForLog(/\[shoprun\] cluster magearena done/, 240_000);
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
