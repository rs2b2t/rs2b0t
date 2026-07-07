// Scout tool: log in, teleport to a list of jagex-format coords, and dump the
// NPCs + their tiles visible in each scene. Used to confirm whether a target
// (e.g. Rellekka rock crabs) actually spawns in the open world.
//
// Usage: bun tools/scout-npcs.ts "0,42,58,22,8" "0,42,58,40,20" ...

import { chromium } from 'playwright-core';

const base = 'http://localhost:8888';
const username = `scout${Date.now().toString(36).slice(-7)}`;
const coords = process.argv.slice(2);
if (coords.length === 0) {
    coords.push('0,42,58,22,8', '0,42,57,40,40', '0,41,58,30,20', '0,43,57,20,30');
}

type Lcb = {
    lcbuddy: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        reader: { worldTile(): { x: number; z: number } | null; npcs(): { name: string | null; level: number; tile: { x: number; z: number } }[]; locs(): { name: string | null; ops: (string | null)[]; tile: { x: number; z: number }; distance: number }[] };
    };
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    await page.goto(`${base}/bot.html`);
    await page.waitForFunction(() => ((globalThis as never as { lcbuddy?: { client: { constructor: { loopCycle: number } } } }).lcbuddy?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });

    const login = async () => {
        await page.evaluate(
            ([u, p]) => {
                const c = (globalThis as never as Lcb).lcbuddy.client;
                c.loginUser = u;
                c.loginPass = p;
                void c.login(u, p, false);
            },
            [username, 'test']
        );
        return page.waitForFunction(() => (globalThis as never as Lcb).lcbuddy.client.ingame && (globalThis as never as Lcb).lcbuddy.client.sceneState === 2, undefined, { timeout: 20000 }).then(() => true).catch(() => false);
    };
    if (!(await login())) {
        console.error('login failed');
        process.exit(1);
    }

    const cmd = async (text: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(300);
        await page.keyboard.type(text, { delay: 25 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2500);
    };

    for (const coord of coords) {
        await cmd(`::tele ${coord}`);
        const out = await page.evaluate(() => {
            const r = (globalThis as never as Lcb).lcbuddy.reader;
            const me = r.worldTile();
            const npcCounts: Record<string, number> = {};
            for (const n of r.npcs()) {
                const key = `${n.name ?? '?'} (lvl ${n.level})`;
                npcCounts[key] = (npcCounts[key] ?? 0) + 1;
            }
            const rockLocs = r.locs().filter(l => /rock|crab/i.test(l.name ?? '')).slice(0, 6).map(l => `${l.name}[${l.ops.filter(Boolean).join('/')}]@${l.tile.x},${l.tile.z}`);
            return { me, npcCounts, rockLocs };
        });
        console.log(`\n@ ${coord} -> tile ${out.me ? `${out.me.x},${out.me.z}` : '?'}`);
        const entries = Object.entries(out.npcCounts).sort((a, b) => b[1] - a[1]);
        console.log(entries.length ? entries.map(([k, n]) => `  ${n}x ${k}`).join('\n') : '  (no npcs in scene)');
        if (out.rockLocs.length) console.log(`  rock/crab locs: ${out.rockLocs.join(', ')}`);
    }
} finally {
    await browser.close();
}
