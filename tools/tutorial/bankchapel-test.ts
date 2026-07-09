// Task 12 section test: jump-start a fresh account to the bank & chapel
// section (docs/tutorial-map.md's 500 -> 610 ladder) and assert TutorialBot's
// thirteen BankChapel.ts stages carry it through the bank, the Financial
// Advisor and Brother Brace to the chapel-exit crossing unattended.
//
// Same jump-start shape as `combat-test.ts` (Task 11): two-step setvar (a
// bare `setvar tutorial N` from a fresh spawn silently reverts --
// docs/tutorial-map.md's "Stage-jump recipe corrections") + the faithful-
// account kit + relog + a `::tele` to the real 470 -> 500 ladder-out landing
// (3111,3125).
//
// KIT (every piece closes a specific gate -- Task 9 addendum's law):
//   - bronze_axe / net / bread + firemaking/cooking xp: the established base
//     kit -- closes Survival's OpenInventoryTab/ChopTree/NetShrimp/CookShrimp
//     and Chef's OpenChefDoor permanently.
//   - mining xp (NEW, Task 12): closes Chef's OpenQuestGuideDoor and the
//     whole QuestGuide chain via their `Skills.xp('mining') === 0` era gates
//     -- without it the re-armed chain walks a 500 account back down the
//     mine and strands it (QuestGuide.ts file-header note 8).
//   - ranged xp (NEW, Task 12): opens BankChapel.ts's own `pastCombat()`
//     era gate (ranged xp is the combat section's permanent milestone).
//   Deliberately NOT granted: smithing/attack xp (no validator reads them
//   today) and the combat items (every combat stage is position-gated
//   underground; none fire at the bank).
//
// Expected one-shot noise before the section engages (each fires once,
// harmless): OpenStatsTab / OpenMusicTab / OpenControlsTab (plain tab
// switches) and ToggleRunOn (run on -- actually useful for the walks).
//
// Usage: bun tools/tutorial/bankchapel-test.ts [base-url]

import { chromium } from 'playwright-core';
import { bootAndLogin, cheatQuiet, getServerVarQuiet, relog, startScript } from './harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const TARGET = 610;
const DEADLINE_MS = 10 * 60_000; // ~25 dialogue pages + 3 tab clicks + ~45 tiles of walking; observed runs are minutes, not seconds
const POLL_MS = 3000;

/** Live-confirmed 470 -> 500 ladder-out landing (docs/tutorial-map.md, Combat.ts's ClimbOutLadder). */
const LANDING = { x: 3111, z: 3125 };
/** `tele level,mx,mz,lx,lz` for LANDING: mapsquare 48,48, local (39,53). */
const TELE_CMD = 'tele 0,48,48,39,53';

/** `newbie_door8`'s wall line (BankChapel.ts CHAPEL_EXIT_DOOR): the 600 -> 610 crossing leaves z <= 3102. */
const EXIT_Z = 3102;

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

    const user = `bk${Date.now().toString(36).slice(-7)}`;
    await bootAndLogin(page, base, user);

    const fresh = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] fresh account '${user}': tutorial=${fresh} (server)`);
    if (fresh !== 0) {
        fail(`fresh account did not start at tutorial=0 (got ${fresh}) -- tutorial-varp assumption broken`);
    }

    // Two-step setvar (docs/tutorial-map.md's "Stage-jump recipe corrections").
    await cheatQuiet(page, 'setvar tutorial 1');
    await cheatQuiet(page, 'setvar tutorial 500');
    const jumped = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] after setvar 1 -> 500: tutorial=${jumped} (server)`);
    if (jumped !== 500) {
        fail(`setvar jump to 500 did not stick (got ${jumped})`);
    }

    // Faithful-account kit (file header -- each piece closes a named gate).
    await cheatQuiet(page, 'give bronze_axe 1');
    await cheatQuiet(page, 'give net 1');
    await cheatQuiet(page, 'give bread 1');
    await cheatQuiet(page, 'advancestat firemaking 2');
    await cheatQuiet(page, 'advancestat cooking 2');
    await cheatQuiet(page, 'advancestat mining 2');
    await cheatQuiet(page, 'advancestat ranged 2');
    console.log(`[${ts()}] faithful kit granted (axe/net/bread + firemaking/cooking/mining/ranged xp)`);

    // Relog so the login script re-evaluates at 500: attaches the backpack +
    // every tab through combat-options (prayer/friends/ignore stay detached
    // -- their attaches are the section's own talk outcomes).
    await relog(page, user);
    console.log(`[${ts()}] relog complete`);

    // Land where the real 470 -> 500 ladder climb-out surfaces.
    await cheatQuiet(page, TELE_CMD);
    await page.waitForTimeout(1000);
    const tile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`[${ts()}] teleported: tile=${JSON.stringify(tile)}`);
    if (!tile || tile.x !== LANDING.x || tile.z !== LANDING.z) {
        fail(`tele to the ladder landing did not land at (${LANDING.x},${LANDING.z}) (got ${JSON.stringify(tile)})`);
    }

    await startScript(page, 'TutorialBot');
    console.log(`[${ts()}] TutorialBot started`);

    const deadline = Date.now() + DEADLINE_MS;
    let v = 500;
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
        fail(`stalled at tutorial=${v} (wanted >= ${TARGET}) -- see docs/tutorial-map.md's ladder table for which stage this names`);
    }

    // Terminal observable: the chapel-exit crossing (ExitChapel's latch).
    const exitTile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`[${ts()}] post-exit tile: ${JSON.stringify(exitTile)}`);
    if (!exitTile || exitTile.z > EXIT_Z) {
        fail(`tutorial reached ${v} but the client tile doesn't show the chapel-exit crossing (got ${JSON.stringify(exitTile)})`);
    }

    console.log(`PASS: TutorialBot drove a jump-started account 500 -> ${v} unattended, chapel-exit crossing confirmed (${JSON.stringify(exitTile)})`);
} finally {
    await browser.close();
}
