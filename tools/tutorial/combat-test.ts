// Task 11 section test: jump-start a fresh account to the combat section
// (the 360 -> 500 ladder) and assert TutorialBot's
// eleven Combat.ts stages carry it to the ladder-out surface crossing
// unattended.
//
// Same jump-start shape as `mining-test.ts` (Task 10): two-step setvar (a
// bare `setvar tutorial N` from a fresh spawn silently reverts --
// the "Stage-jump recipe corrections") + the FAITHFUL-
// ACCOUNT KIT (axe/net/bread + firemaking/cooking xp) so Survival/Chef stay
// permanently quiet, then a `::tele` into the mine + relog so every earlier
// tab is attached.
//
// KNOWN ADJACENCY (task brief, stated up front so a fresh reader isn't
// surprised by the log): landing INSIDE the mine with a fresh script
// instance re-arms Mining.ts's ten stages -- this test deliberately does
// NOT also grant a bronze dagger/pickaxe/bars/hammer, so those stages
// re-run FROM SCRATCH (talk -> prospect x2 -> talk -> mine x2 -> smelt ->
// talk -> smith -> open gate) before TutorialBot ever reaches Combat.ts's
// stages -- Dezzick re-grants the pickaxe/hammer, the rocks/furnace/anvil
// are always available, so this is self-healing noise, not a bug (~1-2 min
// per the task brief's option (a)). The deadline below is budgeted for it.
//
// Usage: bun tools/tutorial/combat-test.ts [base-url]

import { launchBrowser } from '../lib/harness.js';
import { bootAndLogin, cheatQuiet, getServerVarQuiet, relog, startScript } from './harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const TARGET = 500;
const DEADLINE_MS = 16 * 60_000; // mining re-run (~1-2 min) + the combat section itself (two kill waits, up to 60s/90s each) + travel
const POLL_MS = 3000;

/** Live-probed mine-arrival tile (QuestGuide.ts's `ClimbToMine` / mining-test.ts's `ARRIVAL`). */
const ARRIVAL = { x: 3081, z: 9519 };
/** `tele level,mx,mz,lx,lz` for ARRIVAL: mapsquare 48,148 (world >> 6), local (9,47). */
const TELE_CMD = 'tele 0,48,148,9,47';

/** `MINE_Z` from `src/bot/scripts/tutorial/stages/helpers.ts` -- underground/surface boundary. */
const MINE_Z = 9000;

type Rs2b0t = {
    rs2b0t: {
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
};

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

function ts(): string {
    return new Date().toISOString();
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const user = `cb${Date.now().toString(36).slice(-7)}`;
    await bootAndLogin(page, base, user);

    const fresh = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] fresh account '${user}': tutorial=${fresh} (server)`);
    if (fresh !== 0) {
        fail(`fresh account did not start at tutorial=0 (got ${fresh}) -- tutorial-varp assumption broken`);
    }

    // Two-step setvar (the "Stage-jump recipe corrections").
    await cheatQuiet(page, 'setvar tutorial 1');
    await cheatQuiet(page, 'setvar tutorial 360');
    const jumped = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] after setvar 1 -> 360: tutorial=${jumped} (server)`);
    if (jumped !== 360) {
        fail(`setvar jump to 360 did not stick (got ${jumped})`);
    }

    // Faithful-account kit (file header) -- closes Survival/Chef's permanent
    // observables. Deliberately NOT granting a dagger/pickaxe/ores/bars/
    // hammer: Mining.ts's stages self-heal that whole chain from scratch
    // (file-header note), which this test's deadline budgets for.
    await cheatQuiet(page, 'give bronze_axe 1');
    await cheatQuiet(page, 'give net 1');
    await cheatQuiet(page, 'give bread 1');
    await cheatQuiet(page, 'advancestat firemaking 2');
    await cheatQuiet(page, 'advancestat cooking 2');
    console.log(`[${ts()}] faithful kit granted (axe/net/bread + firemaking/cooking xp)`);

    // Relog so the login script re-evaluates at 360: attaches the backpack
    // + every earlier tab.
    await relog(page, user);
    console.log(`[${ts()}] relog complete`);

    // Land at the mine-arrival tile (Mining.ts's stages take it from there).
    await cheatQuiet(page, TELE_CMD);
    await page.waitForTimeout(1000);
    const tile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`[${ts()}] teleported: tile=${JSON.stringify(tile)}`);
    if (!tile || tile.x !== ARRIVAL.x || tile.z !== ARRIVAL.z) {
        fail(`tele into the mine did not land at (${ARRIVAL.x},${ARRIVAL.z}) (got ${JSON.stringify(tile)})`);
    }

    await startScript(page, 'TutorialBot');
    console.log(`[${ts()}] TutorialBot started`);

    const deadline = Date.now() + DEADLINE_MS;
    let v = 360;
    let lastLogged = -1;
    while (Date.now() < deadline) {
        const next = await getServerVarQuiet(page, 'tutorial');
        if (next !== null) {
            v = next;
        }
        if (v !== lastLogged) {
            console.log(`[${ts()}] tutorial=${v}`);
            lastLogged = v;
        }
        if (v >= TARGET) {
            break;
        }
        await new Promise(r => setTimeout(r, POLL_MS));
    }

    console.log(`[${ts()}] final tutorial=${v} -- ${v >= TARGET ? 'PASS' : 'FAIL'}`);
    if (v < TARGET) {
        fail(`stalled at tutorial=${v} (wanted >= ${TARGET}) -- check the ladder table for which stage this is`);
    }

    // Surface observable: confirm the client tile agrees (ClimbOutLadder's terminal outcome).
    const surfaceTile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`[${ts()}] post-ladder tile: ${JSON.stringify(surfaceTile)}`);
    if (!surfaceTile || surfaceTile.z >= MINE_Z) {
        fail(`tutorial reached ${v} but the client tile doesn't show the expected surface crossing (got ${JSON.stringify(surfaceTile)})`);
    }

    console.log(`PASS: TutorialBot drove a jump-started account 360 -> ${v} unattended, surface crossing confirmed (${JSON.stringify(surfaceTile)})`);
} finally {
    await browser.close();
}
