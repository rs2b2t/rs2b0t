/**
 * Live proof for #366 — Plague City sewer pipe into West Ardougne.
 *
 *   setvar elenaquest 30 (complete + scroll stage)
 *   give Spade + Gas mask; equip mask
 *   tele garden stand (2566,3330) — no tele into West Ardougne
 *   walkResilient dig (2488,3308): mud dig → sewer → pipe → manhole → dig
 *
 *   ~/redeploy.sh && HEADED=1 bun tools/plague-pipe-366-live.ts
 */
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

const GARDEN = { x: 2566, z: 3330, level: 0 };
const DIG = { x: 2488, z: 3308, level: 0 };
const ARRIVAL = 2;
const BUDGET_MS = 240_000;

type Tile = { x: number; z: number; level: number };
type Abi = { __rs2b0t: { reader: { worldTile(): Tile | null } } };

const proof = createHarnessProof({ issue: 366, slug: 'plague-pipe' });

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
    const user = `pc366${Date.now().toString(36).slice(-5)}`;
    console.log(`#366 plague-pipe-live base=${base} user=${user}`);
    console.log('bake: garden mud dig → sewer → pipe (gasmask) → West Ardougne dig');
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);
    await cheatQuiet(page, 'speed 300');

    // ^elena_complete = 29; seed uses 30 for scroll (also opens pipe path).
    await cheatQuiet(page, 'setvar elenaquest 30');
    await relog(page, user);
    await maxmeAndClearDialogs(page);
    const eq = await getServerVarQuiet(page, 'elenaquest');
    console.log(`elenaquest=${eq} (need ≥29)`);
    if ((eq ?? 0) < 29) {
        throw new Error(`elenaquest not complete (got ${eq})`);
    }

    await cheatQuiet(page, 'give spade 1');
    await cheatQuiet(page, 'give gasmask 1');
    // Equip runs inside specialCrossing for the pipe hop (needs a running script).
    console.log('gave Spade + Gas mask (equip at pipe hop)');

    console.log(`tele garden ${GARDEN.x},${GARDEN.z}`);
    await teleArrive(page, GARDEN, 2);

    const res = await runLiveWalkProof(page, {
        dest: DIG,
        radius: ARRIVAL,
        budgetMs: BUDGET_MS,
        scriptName: 'Issue366PlaguePipe',
        attempts: 8
    });

    const tile = res.tile;
    const logs = res.logs;
    const dist = tile ? cheb(tile, DIG) : 9999;
    const inWest =
        tile !== null && tile.x >= 2433 && tile.x <= 2556 && tile.z >= 3266 && tile.z <= 3334 && tile.level === 0;
    const sawMud = logs.some(l => /mud|spade|Mud patch|Mud pile/i.test(l));
    const sawPipe = logs.some(l => /pipe|Sewer|manhole|Manhole/i.test(l));
    const ok = res.ok && dist <= ARRIVAL && inWest;

    console.log(
        `ok=${res.ok} arrivedByTile=${res.arrivedByTile} dist=${dist} inWest=${inWest} mud=${sawMud} pipe=${sawPipe}`
    );
    console.log(logs.slice(-50).join('\n'));

    if (!ok) {
        await proof.writeFailure(page);
        throw new Error(`FAIL dist=${dist} inWest=${inWest} tile=${JSON.stringify(tile)}`);
    }
    await proof.writeSuccess(page, {
        issue: 366,
        pattern: 'garden mud dig → sewer → pipe → West Ardougne dig',
        dist,
        inWest,
        sawMud,
        sawPipe,
        arrivedByTile: res.arrivedByTile,
        tile,
        dest: DIG,
        logs: logs.slice(-80)
    });
    console.log('PASS #366 plague-pipe-live');
    process.exit(0);
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
