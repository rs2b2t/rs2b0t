import { deployIsolatedClient, launchBrowser, logout, parseArgs, setSettings, stopScript } from './lib/harness.js';
import { mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

type Api = {
    __rs2b0t: { Inventory: { count(name: string): number }; Skills: { xp(name: string): number } };
    rs2b0t: {
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        runner: { state: string; ctx: { log: { time: number; msg: string }[] } | null };
    };
};

const { base, minutes } = parseArgs(process.argv.slice(2), { minutes: 8 });
const tag = `fare${Date.now().toString(36).slice(-6)}`;
const client = deployIsolatedClient(tag);
const browser = await launchBrowser();
const page = await browser.newPage();
const destination = { x: 3093, z: 3243, level: 0 };
try {
    await mainlandAccount(page, base, tag, client.page);
    if (!(await teleTo(page, { x: 2772, z: 3235, level: 0 }))) throw new Error('Brimhaven seed failed');
    const start = await page.evaluate(() => ({
        coins: (globalThis as never as Api).__rs2b0t.Inventory.count('Coins'),
        tile: (globalThis as never as Api).rs2b0t.reader.worldTile()
    }));
    if (start.coins !== 0) throw new Error(`expected no coins, got ${start.coins}`);
    console.log('START', JSON.stringify(start));
    await page.screenshot({ path: 'docs/e2e/issue-755-before.png' });
    await setSettings(page, 'WalkTo', { destination: 'Map pick', customTile: '3093,3243,0', arriveRadius: 3 });
    await startScript(page, 'WalkTo');
    let paid = false;
    let seen = 0;
    let arrived = false;
    const deadline = Date.now() + minutes * 60_000;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            return { coins: g.__rs2b0t.Inventory.count('Coins'), tile: g.rs2b0t.reader.worldTile(), state: g.rs2b0t.runner.state, logs: g.rs2b0t.runner.ctx?.log ?? [] };
        });
        for (const line of snap.logs.filter(l => l.time > seen)) console.log(line.msg);
        seen = Math.max(seen, ...snap.logs.map(l => l.time));
        if (!paid && snap.coins >= 30) {
            paid = true;
            await page.screenshot({ path: 'docs/e2e/issue-755-fare.png' });
        }
        arrived = snap.tile?.level === destination.level && Math.max(Math.abs(snap.tile.x - destination.x), Math.abs(snap.tile.z - destination.z)) <= 3;
        if (arrived) break;
        if (snap.state !== 'running') throw new Error(`WalkTo stopped at ${JSON.stringify(snap.tile)}`);
        await page.waitForTimeout(1000);
    }
    if (!paid || !arrived) throw new Error(`fare recovery incomplete: paid=${paid}, arrived=${arrived}`);
    await page.screenshot({ path: 'docs/e2e/issue-755-after.png' });
    console.log('PASS: earned the 30gp fare and reached Draynor from Brimhaven');
} finally {
    await stopScript(page).catch(() => undefined);
    await logout(page).catch(() => false);
    await browser.close();
    client.cleanup();
}
