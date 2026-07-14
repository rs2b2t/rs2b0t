// Task 10 section test: jump-start a fresh account to the mining + smithing
// section (the 260 -> 360 ladder) and assert
// TutorialBot's ten Mining.ts stages carry it to the exit gate unattended.
//
// Same jump-start shape as `questguide-test.ts` (Task 9), extended one
// section further: two-step setvar (a bare `setvar tutorial N` from a fresh
// spawn silently reverts -- the "Stage-jump recipe
// corrections") + the FAITHFUL-ACCOUNT KIT (Task 9 addendum) so every
// EARLIER section's stages -- which run first in `TutorialBot`'s stage
// array and would otherwise re-open and starve Mining.ts's stages the
// moment their permanent observable is missing -- stay permanently quiet:
//   - `bronze_axe`/`net`/`bread` + firemaking/cooking xp close Survival's
//     OpenInventoryTab/ChopTree/LightFire/TalkSurvivalAgain/NetShrimp/
//     CookShrimp AND Chef's OpenChefDoor (`onChefSide()` only checks
//     `x <= 3089`, which OVERLAPS the mine's tin-rock/furnace/anvil cluster
//     (x 3073-3083) -- without `bread` closing `breadChainNotStarted()`,
//     OpenChefDoor would misfire underground and walk-snap toward a SURFACE
//     tile that doesn't exist in the mine's scene, stalling the run).
//   - QuestGuide.ts's stages are all gated on SURFACE z (`insideHall()`/
//     `northOfHall()` check z against `QUEST_GUIDE_DOOR.z`, ~3126) so they
//     stay quiet underground with no extra kit needed; a fresh script
//     instance also means `progress.talkedAgain` starts false, keeping
//     `ClimbToMine` quiet regardless.
//   - `OpenSurvivalGate`'s one-shot latches on `interact()` DISPATCHING
//     (pre-existing Task 7 stage, out of this task's scope to change), and
//     its `.name('Gate').action('Open').within(20)` query is NOT tile-pinned
//     -- the mine's exit gate (tut_mining_exit, display "Gate") sits within
//     20 tiles of the mine-arrival tile, so this harmlessly fires ONCE at
//     test start (the exit gate's own content gates the open on
//     `%tutorial >= 350`, so at 260 it just mesboxes "finish Mining and
//     Smithing first" -- cleared by `AdvanceDialog`) and then latches quiet
//     for the rest of the run. Expected noise, not a bug this test flags.
//
// Lands the jumped account at the mine-arrival tile (3081,9519,0 --
// QuestGuide.ts's `ClimbToMine` verified this live in Task 9) via `::tele`
// (no `::tele` walk-in-organically variant attempted here, unlike
// questguide-test's no-tele experiment -- the cross-island leg is chef-
// test's territory, not this section's).
//
// Usage: bun tools/tutorial/mining-test.ts [base-url]

import { chromium } from 'playwright-core';
import { bootAndLogin, cheatQuiet, getServerVarQuiet, relog, startScript } from './harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const TARGET = 360;
const DEADLINE_MS = 10 * 60_000;
const POLL_MS = 3000;

/** Live-probed mine-arrival tile (Task 9, QuestGuide.ts's `ClimbToMine`). */
const ARRIVAL = { x: 3081, z: 9519 };
/** `tele level,mx,mz,lx,lz` for ARRIVAL: mapsquare 48,148 (world >> 6), local (9,47). */
const TELE_CMD = 'tele 0,48,148,9,47';

/** Live-probed exit-gate wall line (Mining.ts's `EXIT_GATE_X`) -- the section's terminal crossing. */
const EXIT_GATE_X = 3094;

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

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const user = `mn${Date.now().toString(36).slice(-7)}`;
    await bootAndLogin(page, base, user);

    const fresh = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] fresh account '${user}': tutorial=${fresh} (server)`);
    if (fresh !== 0) {
        fail(`fresh account did not start at tutorial=0 (got ${fresh}) -- tutorial-varp assumption broken`);
    }

    // Two-step setvar (the "Stage-jump recipe corrections").
    await cheatQuiet(page, 'setvar tutorial 1');
    await cheatQuiet(page, 'setvar tutorial 260');
    const jumped = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] after setvar 1 -> 260: tutorial=${jumped} (server)`);
    if (jumped !== 260) {
        fail(`setvar jump to 260 did not stick (got ${jumped})`);
    }

    // Faithful-account kit (file header) -- the permanent observables a real
    // 0 -> 260 run leaves behind, without which earlier sections' validators
    // re-open and starve the mining stages.
    await cheatQuiet(page, 'give bronze_axe 1');
    await cheatQuiet(page, 'give net 1');
    await cheatQuiet(page, 'give bread 1');
    await cheatQuiet(page, 'advancestat firemaking 2');
    await cheatQuiet(page, 'advancestat cooking 2');
    console.log(`[${ts()}] faithful kit granted (axe/net/bread + firemaking/cooking xp)`);

    // Relog so the login script re-evaluates at 260: attaches the backpack
    // + every earlier tab.
    await relog(page, user);
    console.log(`[${ts()}] relog complete`);

    // Land at the mine-arrival tile.
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
    let v = 260;
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

    // Exit-gate crossing observable: confirm the client tile agrees.
    const exitTile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`[${ts()}] post-gate tile: ${JSON.stringify(exitTile)}`);
    if (!exitTile || exitTile.x <= EXIT_GATE_X) {
        fail(`tutorial reached ${v} but the client tile doesn't show the expected exit-gate crossing (got ${JSON.stringify(exitTile)})`);
    }

    console.log(`PASS: TutorialBot drove a jump-started account 260 -> ${v} unattended, exit-gate crossing confirmed (${JSON.stringify(exitTile)})`);
} finally {
    await browser.close();
}
