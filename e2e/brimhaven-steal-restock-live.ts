/** Live proof: BrimhavenAgility stealRestock takes cakes then guard coins. */

//   bun e2e/brimhaven-steal-restock-live.ts [http://localhost:8888]
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, positionalArgs, setSettings } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `st${Date.now().toString(36).slice(-5)}`;
const STALL = { x: 2668, z: 3312, level: 0 };

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number; items(): Array<{ name: string | null }> };
        Skills: { level(name: string): number };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
    };
}

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
try {
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) fail('login failed');
    await bringUpOffIsland(page, { user });
    await cheatQuiet(page, 'speed 200', 800);
    await cheatQuiet(page, 'setstat agility 50', 800);
    await cheatQuiet(page, 'setstat hitpoints 40', 800);
    await cheatQuiet(page, 'setstat thieving 40', 800);
    await cheatQuiet(page, 'give coins 5', 800);
    await cheatQuiet(page, `tele 0,${STALL.x >> 6},${STALL.z >> 6},${STALL.x & 63},${STALL.z & 63}`, 3000);

    await setSettings(page, 'BrimhavenAgility', {
        food: 'Lobster',
        foodWithdraw: 25,
        bankAtTickets: 1000,
        stealRestock: true
    });
    const started = await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('BrimhavenAgility');
        if (!meta) return false;
        g.rs2b0t.runner.start(meta);
        return g.rs2b0t.runner.state === 'running';
    });
    if (!started) fail('BrimhavenAgility failed to start');

    const deadline = Date.now() + 180_000;
    let cakes = 0;
    let coins = 5;
    let stoleCake = false;
    let stoleCoin = false;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const names = g.__rs2b0t.Inventory.items().map(i => (i.name ?? '').toLowerCase());
            return {
                cakes: names.filter(n => n.includes('cake') || n === 'bread' || n.includes('chocolate')).length,
                coins: g.__rs2b0t.Inventory.count('Coins'),
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                state: g.rs2b0t.runner.state
            };
        });
        cakes = snap.cakes;
        coins = snap.coins;
        if (snap.logs.some(m => /steal|Baker|stocked/i.test(m)) || cakes > 0) stoleCake = true;
        if (snap.logs.some(m => /pickpocketed a guard/i.test(m)) || coins > 5) stoleCoin = true;
        if (snap.state !== 'running') {
            fail(`script stopped early: ${snap.logs.slice(-6).join(' | ')}`);
        }
        if (stoleCake && stoleCoin) break;
        await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: 'docs/e2e/brimhaven-steal-restock-live.png' });
    if (!stoleCake) fail(`never stole cakes (cakes=${cakes})`);
    if (!stoleCoin) fail(`never stole coins (coins=${coins})`);
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));
    console.log(`PASS — stole cakes=${cakes} coins=${coins}`);
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await browser.close();
}
