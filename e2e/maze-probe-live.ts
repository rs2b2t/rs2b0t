/** Debug probe: tele into a maze spawn corner, watch the guardian until exit or 4 min.
 *  Content: mapzone 0_45_71, route ends at chamber door 2910,4576, then Touch Strange shrine 3634 → end_macro_maze. */

//   bun e2e/maze-probe-live.ts [http://localhost:8890] [--spawn se] [--minutes 4]
import { boot, bringUpOffIsland, cheatQuiet, deployIsolatedClient, fail, launchBrowser, login, positionalArgs } from './lib/harness.js';

const argv = process.argv.slice(2);
const args = positionalArgs(argv, 'http://localhost:8890');
const base = args[0];

/** Local (lx,lz) of the four `macro_maze_teleports` corners. */
const SPAWNS: Record<string, { lx: number; lz: number }> = {
    nw: { lx: 11, lz: 53 },
    ne: { lx: 53, lz: 53 },
    se: { lx: 53, lz: 11 },
    sw: { lx: 11, lz: 11 }
};
const spawnAt = argv.indexOf('--spawn');
const spawnKey = (spawnAt >= 0 ? argv[spawnAt + 1] : 'nw')?.toLowerCase() ?? 'nw';
const spawn = SPAWNS[spawnKey];
if (!spawn) {
    fail(`--spawn ${spawnKey}: expected one of ${Object.keys(SPAWNS).join(', ')}`);
}
const minutesAt = argv.indexOf('--minutes');
const RUN_MS = (minutesAt >= 0 ? Number(argv[minutesAt + 1]) : 4) * 60_000;

const user = `mz${Date.now().toString(36).slice(-5)}`;
const client = deployIsolatedClient(`mz${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const consoleLogs: string[] = [];
page.on('console', m => {
    const t = m.text();
    if (/random|maze|shrine|door|Touch|rs2b0t|error|Execution/i.test(t)) {
        consoleLogs.push(t.slice(0, 280));
        console.log('[browser]', t.slice(0, 280));
    }
});

try {
    await page.goto(`${base}${client.page}`);
    await boot(page);
    await login(page, user);
    await bringUpOffIsland(page, { user });
    await page.waitForFunction(
        () => (globalThis as { rs2b0t?: { reader?: { sceneState?: () => number } } }).rs2b0t?.reader?.sceneState?.() === 2,
        undefined,
        { timeout: 90_000 }
    );
    console.log(`scene ready; teleporting to the ${spawnKey.toUpperCase()} spawn (local ${spawn.lx},${spawn.lz})`);
    await cheatQuiet(page, `tele 0,45,71,${spawn.lx},${spawn.lz}`, 5000);

    const deadline = Date.now() + RUN_MS;
    const visits = new Map<string, number>();
    let i = 0;
    while (Date.now() < deadline) {
        const s = await page.evaluate(() => {
            const g = globalThis as unknown as {
                rs2b0t: {
                    reader: {
                        worldTile: () => { x: number; z: number; level: number } | null;
                        sceneState: () => number;
                    };
                };
            };
            const t = g.rs2b0t.reader.worldTile();
            return {
                t,
                scene: g.rs2b0t.reader.sceneState(),
                inMaze: t !== null && t.x >> 6 === 45 && t.z >> 6 === 71
            };
        });
        if (s.t) {
            const k = `${s.t.x},${s.t.z}`;
            visits.set(k, (visits.get(k) ?? 0) + 1);
        }
        console.log(i, JSON.stringify(s.t), 'inMaze', s.inMaze);
        if (!s.inMaze && i > 2) {
            console.log('LEFT MAZE — PASS');
            break;
        }
        i++;
        await page.waitForTimeout(2500);
    }
    const left = !(await page.evaluate(() => {
        const t = (globalThis as unknown as { rs2b0t: { reader: { worldTile: () => { x: number; z: number } | null } } }).rs2b0t.reader.worldTile();
        return t !== null && t.x >> 6 === 45 && t.z >> 6 === 71;
    }));
    console.log('--- console dump ---');
    console.log(consoleLogs.join('\n'));
    // A pendulum shows up as a handful of tiles soaking up the run.
    const hot = [...visits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`--- most-visited tiles --- ${hot.map(([k, n]) => `${k}x${n}`).join(' ')}`);
    await page.screenshot({ path: 'screenshots/maze-probe.png', fullPage: true });
    if (!left) {
        console.error(`FAIL: still in the maze after ${RUN_MS / 1000}s from the ${spawnKey.toUpperCase()} spawn`);
        process.exit(1);
    }
    console.log(`PASS maze probe from the ${spawnKey.toUpperCase()} spawn`);
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    client.cleanup();
    await browser.close();
}
