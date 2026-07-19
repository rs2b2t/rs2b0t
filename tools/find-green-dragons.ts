// One-off probe: teleport to candidate wilderness spots north of Edgeville and
// report any 'Green dragon' NPC tiles in the loaded scene, to pin the spawn.
import { boot, fail, launchBrowser, login, type } from './lib/harness.js';
import type { Rs2b0t } from './lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const username = `gd${Date.now().toString(36).slice(-6)}`;

// zero in on the cluster found near (3094,3810).
const CANDIDATES: [number, number][] = [
    [3094, 3800], [3094, 3820], [3080, 3810], [3110, 3810], [3094, 3835]
];
const teleCmd = (x: number, z: number): string => `::tele 0,${x >> 6},${z >> 6},${x & 63},${z & 63}`;

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, username))) fail('login failed');
    await type(page, '::tele 0,50,50,20,20', 1500);
    await page.reload();
    await boot(page);
    for (let i = 0; i < 8 && !(await login(page, username)); i++) await page.waitForTimeout(4000);

    for (const [x, z] of CANDIDATES) {
        await type(page, teleCmd(x, z), 2000);
        const info = await page.evaluate(() => {
            const g = (globalThis as never as Rs2b0t).rs2b0t;
            const me = g.reader.worldTile();
            const npcs = g.reader.npcs();
            const dragons = npcs.filter(n => n.name === 'Green dragon').map(n => `${n.tile.x},${n.tile.z}`);
            const sample = [...new Set(npcs.map(n => n.name))].slice(0, 8);
            return { me, dragons, total: npcs.length, sample };
        });
        const hit = info.dragons.length ? `GREEN DRAGONS: ${info.dragons.join(' | ')}` : `(no dragons; ${info.total} npcs: ${info.sample.join(', ')})`;
        console.log(`center ${x},${z} -> at ${info.me?.x},${info.me?.z} — ${hit}`);
    }
} finally {
    await browser.close();
}
