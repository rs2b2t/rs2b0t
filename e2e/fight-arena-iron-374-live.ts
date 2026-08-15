// Live proof #374 — Miner at Fight Arena prefers nearest iron (not a far rock).
//
//   bun e2e/fight-arena-iron-374-live.ts [http://localhost:8890]
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, positionalArgs } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `fa${Date.now().toString(36).slice(-6)}`;
const CAMP = { x: 2631, z: 3146 };

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number };
        Equipment: { contains(name: string): boolean };
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            locs(): Array<{ id: number; name: string | null; tile: { x: number; z: number; level: number }; distance: number }>;
        };
    };
    rs2b0t: {
        runner: { state: string; start(m: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
    };
}

const browser = await launchBrowser();
const page = await browser.newPage();
try {
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) {
        fail('login failed');
    }
    await bringUpOffIsland(page, { user });
    console.log(`ingame as ${user}`);

    await cheatQuiet(page, 'setstat mining 15', 800);
    await cheatQuiet(page, `tele 0,${CAMP.x >> 6},${CAMP.z >> 6},${CAMP.x & 63},${CAMP.z & 63}`, 3500);
    await cheatQuiet(page, 'give steel_pickaxe 1', 1200);

    // Settings: Iron only + Fight Arena camp
    await page.evaluate(() => {
        sessionStorage.setItem('rs2b0t:set:Miner:rocks', 'Iron');
        sessionStorage.setItem('rs2b0t:set:Miner:location', 'Fight Arena Mine');
        try {
            localStorage.setItem('rs2b0t:set:Miner:rocks', 'Iron');
            localStorage.setItem('rs2b0t:set:Miner:location', 'Fight Arena Mine');
        } catch {
            /* private mode */
        }
    });

    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('Miner');
        if (!meta) {
            throw new Error('Miner not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log('Miner started');

    type Sample = { ore: number; meD: number; nearestD: number; me: { x: number; z: number } };
    const samples: Sample[] = [];
    let lastOre = 0;
    const deadline = Date.now() + 150_000;

    while (Date.now() < deadline && samples.length < 5) {
        await page.waitForTimeout(1500);
        const snap = await page.evaluate(() => {
            const ironIds = new Set([2092, 2093]);
            const g = globalThis as never as Api;
            const me = g.__rs2b0t.reader.worldTile();
            if (!me) {
                return null;
            }
            const iron = g.__rs2b0t.reader
                .locs()
                .filter(l => ironIds.has(l.id))
                .map(l => ({
                    tile: l.tile,
                    d: Math.max(Math.abs(l.tile.x - me.x), Math.abs(l.tile.z - me.z))
                }))
                .sort((a, b) => a.d - b.d);
            return {
                me: { x: me.x, z: me.z },
                nearestD: iron[0]?.d ?? 99,
                ore: g.__rs2b0t.Inventory.count('Iron ore'),
                pick: g.__rs2b0t.Equipment.contains('Steel pickaxe') || g.__rs2b0t.Inventory.count('Steel pickaxe') > 0,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-6).map(l => l.msg)
            };
        });
        if (!snap) {
            continue;
        }
        if (snap.ore > lastOre) {
            // Got ore — should be next to a rock (nearestD ≤ 1 typically)
            samples.push({ ore: snap.ore, meD: snap.nearestD, nearestD: snap.nearestD, me: snap.me });
            console.log(`ore+ → ${snap.ore} at ${JSON.stringify(snap.me)} nearestIronD=${snap.nearestD}`);
            lastOre = snap.ore;
            // Inefficient: after a successful mine, nearest iron should be ≤2 (adjacent/near)
            if (snap.nearestD > 3) {
                fail(
                    `after mining, nearest remaining iron is ${snap.nearestD} tiles away — likely mined a far rock while closer ones exist`
                );
            }
        }
        if (samples.length === 0 && Date.now() % 10000 < 2000) {
            console.log(`waiting… ore=${snap.ore} nearestD=${snap.nearestD} pick=${snap.pick}`);
        }
    }

    const logs = await page.evaluate(() =>
        ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-25).map(l => l.msg)
    );
    console.log('--- logs ---');
    for (const m of logs) {
        console.log(`  ${m}`);
    }

    if (samples.length < 2) {
        fail(`only ${samples.length} mine samples (need ≥2)`);
    }
    console.log(`PASS #374 live — ${samples.length} iron ores; post-mine nearest rock always ≤3 tiles`);
} finally {
    await browser.close();
}
