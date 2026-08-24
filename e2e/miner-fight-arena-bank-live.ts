/** Live proof, Miner banks the Fight Arena Mine haul at Yanille rather than crossing Ardougne for it.
 *  Why: the camp table pins one bank per mine, and the only honest check is where the feet land, so the
 *  run watches the walk and fails if it drifts north to the East Ardougne booth. */

//   bun e2e/miner-fight-arena-bank-live.ts [http://localhost:8890]
import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, positionalArgs, setSettings } from './lib/harness.js';
import { clearChatDialogs, mainlandAccount, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `mn${Date.now().toString(36).slice(-5)}`;

const MINE_STAND = { x: 2631, z: 3146, level: 0 };
const YANILLE_BANK = { x: 2612, z: 3092, level: 0 };
const ARDOUGNE_EAST_BANK = { x: 2655, z: 3283, level: 0 };
const SEEDED_ORE = 26;
const ARRIVE_RADIUS = 6;
const RUN_MS = 420_000;

interface Api {
    __rs2b0t: {
        Inventory: { items(): Array<{ name: string | null; count: number }> };
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void; ctx: { log: { msg: string }[] } | null };
        registry: { get(name: string): unknown };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
}

function cheb(a: { x: number; z: number }, b: { x: number; z: number }): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

const client = deployIsolatedClient(`mn${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser();
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await cheatQuiet(page, 'setstat mining 60', 1200);
    await clearChatDialogs(page, 'mining level-ups');
    await cheatQuiet(page, 'give rune_pickaxe 1', 1200);
    await cheatQuiet(page, `give iron_ore ${SEEDED_ORE}`, 2000);
    if (!(await teleTo(page, MINE_STAND, 6, 25_000))) {
        fail(`could not reach the Fight Arena Mine stand (${MINE_STAND.x},${MINE_STAND.z})`);
    }

    const seededOre = await page.evaluate(() => (globalThis as never as Api).__rs2b0t.Inventory.items()
        .filter(i => (i.name ?? '').toLowerCase().includes('iron ore')).length);
    if (seededOre < SEEDED_ORE) {
        fail(`expected a full ore pack, held ${seededOre}`);
    }
    console.log(`seeded ${seededOre} iron ore at the mine, waiting for the bank leg`);

    await setSettings(page, 'Miner', {
        rocks: 'Iron',
        location: 'Fight Arena Mine',
        purgePackOnStart: false,
        toolAcquire: 'Off',
        muleMode: 'Off',
        tickManip: 'Off'
    });
    await page.evaluate(() => {
        const g = globalThis as never as Api;
        const meta = g.rs2b0t.registry.get('Miner');
        if (!meta) {
            throw new Error('Miner not registered');
        }
        g.rs2b0t.runner.start(meta);
    });

    const deadline = Date.now() + RUN_MS;
    let closestYanille = Infinity;
    let closestArdougne = Infinity;
    let oreLeft = seededOre;
    let arrived = false;
    while (Date.now() < deadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            return {
                tile: g.rs2b0t.reader.worldTile(),
                state: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg),
                ore: g.__rs2b0t.Inventory.items().filter(i => (i.name ?? '').toLowerCase().includes('iron ore')).length
            };
        });
        if (snap.tile) {
            closestYanille = Math.min(closestYanille, cheb(snap.tile, YANILLE_BANK));
            closestArdougne = Math.min(closestArdougne, cheb(snap.tile, ARDOUGNE_EAST_BANK));
        }
        oreLeft = snap.ore;
        arrived = arrived || closestYanille <= ARRIVE_RADIUS;
        if (snap.state !== 'running') {
            fail(`script stopped early: ${snap.logs.slice(-6).join(' | ')}`);
        }
        if (closestArdougne <= ARRIVE_RADIUS) {
            fail(`walked to the East Ardougne booth (${closestArdougne} tiles) — the camp still points at the wrong bank`);
        }
        if (arrived && oreLeft === 0) {
            break;
        }
        await page.waitForTimeout(2000);
    }

    const logs = await page.evaluate(() =>
        ((globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []).slice(-20).map(l => l.msg)
    );
    console.log('--- recent logs ---');
    for (const m of logs) {
        console.log(`  ${m}`);
    }
    await page.screenshot({ path: 'docs/e2e/miner-fight-arena-bank-live.png' });
    await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.stop('harness stop'));

    if (!arrived) {
        fail(`never reached the Yanille bank in ${RUN_MS / 1000}s, closest ${closestYanille} tiles (Ardougne closest ${closestArdougne})`);
    }
    if (oreLeft > 0) {
        fail(`reached Yanille but ${oreLeft} iron ore never left the pack`);
    }
    console.log(`PASS, banked ${seededOre} iron ore at Yanille (closest ${closestYanille} tiles; East Ardougne never closer than ${closestArdougne})`);
} finally {
    client.cleanup();
    await browser.close();
}
