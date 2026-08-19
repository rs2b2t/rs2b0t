// Live proof — HillGiant with a Brass key banks at Varrock West (~3185,3440).

//   ENGINE_DIR=... sh tools/deploy-local.sh   # once
//   bun e2e/hillgiant-bank-428-live.ts [http://localhost:8888]
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, positionalArgs, setSettings } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `hgw${Date.now().toString(36).slice(-5)}`;

const EDGEVILLE = { x: 3094, z: 3493 };
const WEST = { x: 3185, z: 3440 };
const EAST = { x: 3253, z: 3420 };
const PIT = { x: 3115, z: 9835 };

interface Api {
    __rs2b0t: {
        Inventory: { count(name: string): number; contains(name: string): boolean; used(): number };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
    };
}

function cheb(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
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

    for (const stat of ['attack', 'strength', 'defence', 'hitpoints']) {
        await cheatQuiet(page, `setstat ${stat} 70`, 800);
    }
    await cheatQuiet(page, `tele 0,${PIT.x >> 6},${PIT.z >> 6},${PIT.x & 63},${PIT.z & 63}`, 3500);
    await cheatQuiet(page, 'give trout 2', 1200);
    await cheatQuiet(page, 'give limpwurt_root 14', 2000);
    await cheatQuiet(page, 'give big_bones 12', 2000);
    await cheatQuiet(page, 'give edgevilledungeonkey 1', 1200);

    const seeded = await page.evaluate(() => {
        const api = (globalThis as never as Api).__rs2b0t;
        return {
            used: api.Inventory.used(),
            tile: api.reader.worldTile()
        };
    });
    if (seeded.used < 20) {
        fail(`expected a packed inventory, used=${seeded.used}`);
    }
    console.log(`seeded pit pack used=${seeded.used} at ${JSON.stringify(seeded.tile)}`);

    await setSettings(page, 'HillGiant', {
        lootSlots: 1,
        food: 'Trout',
        foodWithdraw: 2
    });
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('HillGiant');
        if (!meta) {
            throw new Error('HillGiant not registered');
        }
        g.rs2b0t.runner.start(meta);
    });
    console.log('HillGiant started — waiting for Varrock West bank');

    const deadline = Date.now() + 180_000;
    let sawWest = false;
    while (Date.now() < deadline) {
        const t = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.reader.worldTile());
        const logs = await page.evaluate(() =>
            ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-20).map(l => l.msg)
        );
        if (t && t.level === 0 && t.z < 4000) {
            if (cheb(t, WEST) <= 8) {
                sawWest = true;
                console.log(`PASS — at Varrock West bank area ${JSON.stringify(t)}`);
                break;
            }
            if (cheb(t, EDGEVILLE) <= 8) {
                fail(`banked at Edgeville ${JSON.stringify(t)}`);
            }
            if (cheb(t, EAST) <= 8) {
                fail(`banked at Varrock East ${JSON.stringify(t)}`);
            }
        }
        if (logs.some(m => /Edgeville bank/i.test(m))) {
            fail('script still walks to Edgeville bank');
        }
        await page.waitForTimeout(1500);
    }

    const logs = await page.evaluate(() =>
        ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-30).map(l => l.msg)
    );
    console.log('--- recent logs ---');
    for (const m of logs) {
        console.log(`  ${m}`);
    }

    if (!sawWest) {
        fail('never reached Varrock West bank within 3 minutes');
    }
    console.log('PASS — HillGiant banks at Varrock West');
} finally {
    await browser.close();
}
