/** Live proof: Swarm + Maze random events against local Server content: [base]. Needs a botclient carrying RandomEventGuardian and the maze fix.
 *  Verified against macro_events.constant (^macro_swarm=1, ^macro_maze=8), macro_event_swarm.rs2, macro_event_maze.rs2, and pack loc 3634 = macro_maze_complete "Strange shrine" Touch @ 0_45_71_31_31. Proof: out/issue-randomevents-proof.json + screenshots/ */

//   ~/redeploy.sh   # botclient with RandomEventGuardian + maze fix
//   bun e2e/random-events-live.ts [http://localhost:8890]
import { mkdir } from 'node:fs/promises';
import { boot, bringUpOffIsland, cheatQuiet, fail, launchBrowser, login, positionalArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `re${Date.now().toString(36).slice(-6)}`;
const proof = createHarnessProof({ issue: 0, slug: 'randomevents-swarm-maze' });

interface Api {
    __rs2b0t: {
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            npcs(): Array<{ name: string | null; id: number }>;
            sceneState(): number;
            ingame(): boolean;
        };
        RandomEvents?: { detect(): { kind: string; name: string } | null; handling: boolean };
    };
    rs2b0t: {
        runner: { state: string; ctx: { log: { msg: string }[] } | null };
        reader: { sceneState(): number; worldTile(): { x: number; z: number; level: number } | null };
    };
}

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
const logs: string[] = [];
const consoleLogs: string[] = [];

function pushLog(m: string): void {
    logs.push(m);
    console.log(m);
}

page.on('console', msg => {
    const t = msg.text();
    if (/random event|rs2b0t/i.test(t)) {
        consoleLogs.push(t);
    }
});

try {
    await proof.ensureDirs();
    await page.goto(`${base}/bot.html`, { waitUntil: 'domcontentloaded' });
    await boot(page);
    if (!(await login(page, user))) {
        fail('login failed');
    }
    await bringUpOffIsland(page, { user });
    await page.waitForFunction(
        () => {
            const g = globalThis as never as Api;
            return g.rs2b0t?.reader?.sceneState?.() === 2 && g.rs2b0t?.reader?.worldTile?.() !== null;
        },
        undefined,
        { timeout: 120_000 }
    );
    pushLog(`ingame scene=2 as ${user}`);

    // ── Swarm (macro_event id 1 / content ^macro_swarm) ─────────────────────
    // Prefer content cheat; fall back to npcadd.
    await cheatQuiet(page, 'macro_event 1', 2500);
    let swarm = await page.evaluate(() => {
        const npcs = (globalThis as never as Api).__rs2b0t.reader.npcs();
        return npcs.some(n => n.id === 411 || (n.name ?? '').toLowerCase() === 'swarm');
    });
    if (!swarm) {
        await cheatQuiet(page, 'npcadd macro_swarm', 2000);
        swarm = await page.evaluate(() => {
            const npcs = (globalThis as never as Api).__rs2b0t.reader.npcs();
            return npcs.some(n => n.id === 411 || (n.name ?? '').toLowerCase() === 'swarm');
        });
    }
    if (!swarm) {
        fail('Swarm did not spawn (macro_event 1 / npcadd macro_swarm)');
    }
    pushLog('Swarm present — waiting for RandomEventGuardian (no script)');

    const swarmDeadline = Date.now() + 90_000;
    let swarmGone = false;
    let sawSwarmLog = false;
    while (Date.now() < swarmDeadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const npcs = g.__rs2b0t.reader.npcs();
            return {
                swarm: npcs.some(n => n.id === 411 || (n.name ?? '').toLowerCase() === 'swarm')
            };
        });
        if (consoleLogs.some(m => /random event/i.test(m) && /swarm/i.test(m))) {
            sawSwarmLog = true;
        }
        if (!snap.swarm) {
            swarmGone = true;
            break;
        }
        await page.waitForTimeout(800);
    }
    if (!swarmGone) {
        fail('Swarm still present after 90s — guardian/evade did not clear it');
    }
    pushLog(`Swarm cleared (log=${sawSwarmLog})`);

    // ── Maze (enter mapzone 0_45_71 — content [mapzone,0_45_71] sets ^macro_maze)
    // NW spawn enum val=0,0_45_71_11_53 → world 2891,4597
    await cheatQuiet(page, 'tele 0,45,71,11,53', 4000);
    await page.waitForFunction(
        () => {
            const t = (globalThis as never as Api).rs2b0t.reader.worldTile();
            return t !== null && t.x >> 6 === 45 && t.z >> 6 === 71;
        },
        undefined,
        { timeout: 30_000 }
    );
    const mazeTile = await page.evaluate(() => (globalThis as never as Api).rs2b0t.reader.worldTile());
    pushLog(`in maze region at ${mazeTile?.x},${mazeTile?.z} — guardian should solve`);

    const mazeDeadline = Date.now() + 240_000;
    let leftMaze = false;
    let sawMazeLog = false;
    let sawSolved = false;
    while (Date.now() < mazeDeadline) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Api;
            const t = g.rs2b0t.reader.worldTile();
            return {
                inMaze: t !== null && t.x >> 6 === 45 && t.z >> 6 === 71,
                tile: t
            };
        });
        if (consoleLogs.some(m => /random event: maze/i.test(m))) {
            sawMazeLog = true;
        }
        if (consoleLogs.some(m => /maze solved/i.test(m))) {
            sawSolved = true;
        }
        if (!snap.inMaze) {
            leftMaze = true;
            pushLog(`left maze at ${snap.tile?.x},${snap.tile?.z}`);
            break;
        }
        await page.waitForTimeout(1500);
    }
    if (!leftMaze) {
        await page.screenshot({ path: 'screenshots/issue0-randomevents-maze-stuck.png', fullPage: true }).catch(() => undefined);
        fail('still inside maze region after 240s');
    }
    if (!sawMazeLog) {
        pushLog('WARN: no maze log on runner ctx (guardian may log to console only without script)');
    }
    pushLog(`maze exit ok (solvedLog=${sawSolved})`);

    await mkdir('screenshots', { recursive: true });
    await proof.writeSuccess(page, {
        harness: 'e2e/random-events-live.ts',
        content: {
            swarm: '^macro_swarm=1, despawn when range>3 (macro_event_lost_hostile)',
            maze: 'mapzone 0_45_71, shrine macro_maze_complete id 3634 Touch @ 2911,4575',
            guardian: 'RandomEventGuardian when Game.sceneReady() (sceneState===2)'
        },
        logs: logs.slice(-40),
        consoleLogs: consoleLogs.slice(-50),
        sawSwarmLog,
        sawMazeLog,
        sawSolved
    });
    pushLog('PASS random-events live — swarm + maze with no script running');
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close();
}
