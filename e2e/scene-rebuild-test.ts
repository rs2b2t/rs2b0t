// Scene readiness memoization — correctness proof against a local engine: [base].
// Why: checkLocations answers from a cached set of outstanding models rather than re-decoding the loc stream every tick, so the risk is a scene reporting ready too early (empty or broken) or never at all ("Loading - please wait") — teleport across regions and require a populated scene each time.

//   bun e2e/scene-rebuild-test.ts [http://localhost:8888]
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, positionalArgs } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const user = args[1] ?? `scene${Date.now().toString(36).slice(-5)}`;

const STOPS = [
    { name: 'Varrock west bank', x: 3185, z: 3436 },
    { name: 'Falador east bank', x: 3013, z: 3355 },
    { name: 'Draynor village', x: 3092, z: 3243 },
    { name: 'Al Kharid', x: 3269, z: 3167 },
    { name: 'Edgeville', x: 3093, z: 3491 },
    { name: 'Lumbridge', x: 3222, z: 3218 },
    { name: 'Varrock west bank (again)', x: 3185, z: 3436 }
];

const LOAD_TIMEOUT_MS = 90_000;

interface Api {
    __rs2b0t: {
        Locs: { query(): { count(): number } };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
    rs2b0t: { client: { sceneState: number } };
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('pageerror', e => console.log(`  PAGE ERROR: ${e.message}`));

    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) fail('login failed');
    await bringUpOffIsland(page, { user });
    console.log(`ingame as ${user}, off tutorial island\n`);

    const results: { name: string; ms: number; locs: number; sawRebuild: boolean }[] = [];

    for (const stop of STOPS) {
        await cheatQuiet(page, `tele 0,${stop.x >> 6},${stop.z >> 6},${stop.x & 63},${stop.z & 63}`, 150);

        const started = Date.now();
        let sawRebuild = false;
        let settled: { locs: number; tile: { x: number; z: number } } | null = null;

        while (Date.now() - started < LOAD_TIMEOUT_MS) {
            const snap = await page.evaluate(() => {
                const api = globalThis as never as Api;
                const tile = api.__rs2b0t.reader.worldTile();
                return { state: api.rs2b0t.client.sceneState, locs: api.__rs2b0t.Locs.query().count(), tile };
            });

            if (snap.state === 1) {
                sawRebuild = true;
            }
            const arrived = snap.tile && Math.abs(snap.tile.x - stop.x) <= 2 && Math.abs(snap.tile.z - stop.z) <= 2;
            if (snap.state === 2 && arrived && snap.locs > 0) {
                if (snap.tile) {
                    settled = { locs: snap.locs, tile: snap.tile };
                }
                break;
            }
            await new Promise(r => setTimeout(r, 100));
        }

        const ms = Date.now() - started;
        if (!settled) {
            fail(`${stop.name}: scene never became ready within ${LOAD_TIMEOUT_MS}ms — memo may be withholding readiness`);
        }
        console.log(`  PASS  ${stop.name.padEnd(26)} ready in ${String(ms).padStart(6)}ms  locs=${String(settled.locs).padStart(4)}  rebuilt=${sawRebuild}`);
        results.push({ name: stop.name, ms, locs: settled.locs, sawRebuild });
    }

    const rebuilt = results.filter(r => r.sawRebuild).length;
    if (rebuilt === 0) {
        fail('no teleport ever entered the loading state — the test never exercised a scene rebuild');
    }
    const thin = results.filter(r => r.locs < 20);
    if (thin.length) {
        fail(`scene reported ready but is nearly empty at: ${thin.map(t => `${t.name} (${t.locs} locs)`).join(', ')}`);
    }

    console.log(`\nOK — ${results.length} region loads, ${rebuilt} real rebuilds, every scene populated.`);
    console.log(`   slowest ${Math.max(...results.map(r => r.ms))}ms, median locs ${results.map(r => r.locs).sort((a, b) => a - b)[results.length >> 1]}`);
} finally {
    await browser.close();
}
