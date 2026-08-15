/** Live proof for #364 — Gu'Tanoth ledges. Case A (default): dig 3546 via the chasm Jump-From, tele jump stand (2531,3026) → dig (2542,3031).
 *  Case B (CASE=toban): dig 3548 via the Toban cave, tele cave mouth (2499,2988) → dig (2581,3030). */

//   CASE=toban HEADED=1 bun e2e/gutanoth-ledges-364-live.ts

//   ~/redeploy.sh && HEADED=1 bun e2e/gutanoth-ledges-364-live.ts
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { runLiveWalkProof } from './lib/liveWalkProof.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

const CASE = (process.env.CASE ?? 'chasm').toLowerCase();
const CHASM_START = { x: 2531, z: 3026, level: 0 };
const CHASM_DIG = { x: 2542, z: 3031, level: 0 };
const TOBAN_START = { x: 2499, z: 2988, level: 0 };
const TOBAN_DIG = { x: 2581, z: 3030, level: 0 };
const START = CASE === 'toban' ? TOBAN_START : CHASM_START;
const DIG = CASE === 'toban' ? TOBAN_DIG : CHASM_DIG;
const ARRIVAL = 2;
const BUDGET_MS = 180_000;

type Tile = { x: number; z: number; level: number };
type Abi = { __rs2b0t: { reader: { worldTile(): Tile | null } } };

const proof = createHarnessProof({
    issue: 364,
    slug: CASE === 'toban' ? 'gutanoth-toban' : 'gutanoth-chasm'
});

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
    const user = `gt364${Date.now().toString(36).slice(-5)}`;
    console.log(`#364 gutanoth-live case=${CASE} base=${base} user=${user}`);
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);
    await cheatQuiet(page, 'speed 300');
    if (CASE !== 'toban') {
        await cheatQuiet(page, 'give coins 100');
        console.log('gave coins 100 for chasm toll');
    }

    console.log(`tele start ${START.x},${START.z} (no tele onto dig island)`);
    await teleArrive(page, START, 2);

    const res = await runLiveWalkProof(page, {
        dest: DIG,
        radius: ARRIVAL,
        budgetMs: BUDGET_MS,
        scriptName: `Issue364_${CASE}`,
        attempts: 6
    });

    const tile = res.tile;
    const logs = res.logs;
    const dist = tile ? cheb(tile, DIG) : 9999;
    const sawCross = logs.some(l => /Jump-From|Cave entrance|Ladder|chasm|Toban|crossed|pay/i.test(l));
    const ok = res.ok && dist <= ARRIVAL;

    console.log(`ok=${res.ok} arrivedByTile=${res.arrivedByTile} dist=${dist} sawCross=${sawCross}`);
    console.log(logs.slice(-40).join('\n'));

    if (!ok) {
        await proof.writeFailure(page);
        throw new Error(`FAIL case=${CASE} dist=${dist} tile=${JSON.stringify(tile)}`);
    }
    await proof.writeSuccess(page, {
        issue: 364,
        case: CASE,
        dist,
        sawCross,
        arrivedByTile: res.arrivedByTile,
        tile,
        dest: DIG,
        logs: logs.slice(-60)
    });
    console.log(`PASS #364 gutanoth-${CASE}`);
    process.exit(0);
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
