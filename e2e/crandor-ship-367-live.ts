// Live proof for #367 — Crandor after Dragon Slayer, through the secret wall.
// Why: Lady Lumbridge is one-shot mid-quest, so post-complete access is Karamja volcano → dragonsecretdoor → climbing rope; nothing teleports onto the Crandor surface.

//   ~/redeploy.sh && HEADED=1 bun e2e/crandor-ship-367-live.ts
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { runLiveWalkProof } from './lib/liveWalkProof.js';
import {
    cheatQuiet,
    getServerVarQuiet,
    mainlandAccount,
    maxmeAndClearDialogs,
    relog
} from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

const VOLCANO = { x: 2856, z: 3167, level: 0 };
const DIG = { x: 2848, z: 3296, level: 0 };
const ARRIVAL = 2;
const BUDGET_MS = 240_000;

type Tile = { x: number; z: number; level: number };
type Abi = {
    __rs2b0t: { reader: { worldTile(): Tile | null } };
};

const proof = createHarnessProof({ issue: 367, slug: 'crandor-ship' });

function cheb(a: Tile, b: Tile): number {
    if (a.level !== b.level) {
        return 9999;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function teleCmd(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: Tile, maxDist = 3): Promise<void> {
    for (let a = 0; a < 8; a++) {
        if (page.isClosed()) {
            throw new Error('page closed before tele');
        }
        await cheatQuiet(page, teleCmd(spot));
        for (let p = 0; p < 25; p++) {
            if (page.isClosed()) {
                throw new Error('page closed during tele settle');
            }
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && cheb(t, spot) <= maxDist) {
                await page.waitForTimeout(600);
                return;
            }
            await page.waitForTimeout(200);
        }
    }
    throw new Error(`tele ${spot.x},${spot.z} failed`);
}

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
page.on('console', msg => {
    if (msg.type() === 'error') {
        console.log(`[browser:error] ${msg.text().slice(0, 240)}`);
    }
});
try {
    await proof.ensureDirs();
    const user = `cr367${Date.now().toString(36).slice(-5)}`;
    console.log(`#367 crandor-live base=${base} user=${user}`);
    console.log('bake: volcano → secret wall (DS complete) → rope up → dig');
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);
    await cheatQuiet(page, 'speed 300');

    // ^dragon_complete = 10. Content auto-sets %dragon_wall when opening after complete.
    await cheatQuiet(page, 'setvar dragonquest 10');
    await relog(page, user);
    await maxmeAndClearDialogs(page);
    const dq = await getServerVarQuiet(page, 'dragonquest');
    console.log(`dragonquest=${dq} (need 10 complete)`);
    if ((dq ?? 0) < 10) {
        throw new Error(`dragonquest not complete after setvar (got ${dq})`);
    }

    console.log(`tele to volcano ${VOLCANO.x},${VOLCANO.z} (no tele onto Crandor)`);
    await teleArrive(page, VOLCANO, 3);
    const here = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
    console.log(`at ${JSON.stringify(here)}`);

    console.log('starting walk (tile-arrival ends the harness even if walkResilient hangs)');
    const res = await runLiveWalkProof(page, {
        dest: DIG,
        radius: ARRIVAL,
        budgetMs: BUDGET_MS,
        scriptName: 'Issue367Crandor',
        attempts: 8
    });

    const tile = res.tile;
    const logs = res.logs;
    const dist = tile ? cheb(tile, DIG) : 9999;
    const onCrandor =
        tile !== null && tile.x >= 2802 && tile.x <= 2870 && tile.z >= 3230 && tile.z <= 3320 && tile.level === 0;
    const sawWall = logs.some(l => /secret|Wall|dragonsecret|Open/i.test(l));
    const sawRope = logs.some(l => /Climbing rope|Rock opening|Climb/i.test(l));
    const ok = res.ok && dist <= ARRIVAL && onCrandor;

    console.log(
        `walk ok=${res.ok} walkOk=${res.walkOk} arrivedByTile=${res.arrivedByTile} dist=${dist} onCrandor=${onCrandor} wall=${sawWall} rope=${sawRope}`
    );
    console.log(logs.slice(-50).join('\n'));

    if (!ok) {
        await proof.writeFailure(page);
        throw new Error(
            `FAIL dist=${dist} onCrandor=${onCrandor} tile=${JSON.stringify(tile)}`
        );
    }
    await proof.writeSuccess(page, {
        issue: 367,
        pattern: 'volcano → dragonsecretdoor → crandor rope/rock → dig',
        dist,
        onCrandor,
        sawWall,
        sawRope,
        arrivedByTile: res.arrivedByTile,
        walkOk: res.walkOk,
        tile,
        dest: DIG,
        logs: logs.slice(-80)
    });
    console.log('PASS #367 crandor-live');
    process.exit(0);
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
