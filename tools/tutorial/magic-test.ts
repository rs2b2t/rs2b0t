// Task 13 section test: jump-start a fresh account to the magic section
// (docs/tutorial-map.md's 610 -> 1000 ladder) and assert TutorialBot's five
// Magic.ts stages carry it through Terrova, the two forced Wind Strike
// casts and the mainland prompt to Lumbridge unattended.
//
// Same jump-start shape as `bankchapel-test.ts` (Task 12): two-step setvar +
// the faithful-account kit (mining xp gates the pre-mine sections shut;
// ranged xp opens the bank section's `pastCombat()` — quiet here anyway via
// its position boxes, and the magic section's own era gate) + relog + tele
// to the chapel-exit landing (3122,3101).
//
// PASS = tutorial >= 1000 AND the client tile on the mainland (Lumbridge —
// `@tutorial_complete` telejumps to (3222,3222)).
//
// Usage: bun tools/tutorial/magic-test.ts [base-url]

import { chromium } from 'playwright-core';
import { bootAndLogin, cheatQuiet, getServerVarQuiet, relog, startScript } from './harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const TARGET = 1000;
const DEADLINE_MS = 8 * 60_000;
const POLL_MS = 3000;

/** Chapel-exit landing (BankChapel.ts's ExitChapel outcome: just south of newbie_door8). */
const LANDING = { x: 3122, z: 3101 };
/** `tele level,mx,mz,lx,lz` for LANDING: mapsquare 48,48, local (50,29). */
const TELE_CMD = 'tele 0,48,48,50,29';

/** Mainland proof: west Lumbridge is x > 3190; the island tops out ~3155. */
const MAINLAND_X = 3190;

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

    const user = `mg${Date.now().toString(36).slice(-7)}`;
    await bootAndLogin(page, base, user);

    const fresh = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] fresh account '${user}': tutorial=${fresh} (server)`);
    if (fresh !== 0) {
        fail(`fresh account did not start at tutorial=0 (got ${fresh}) -- tutorial-varp assumption broken`);
    }

    await cheatQuiet(page, 'setvar tutorial 1');
    await cheatQuiet(page, 'setvar tutorial 610');
    const jumped = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] after setvar 1 -> 610: tutorial=${jumped} (server)`);
    if (jumped !== 610) {
        fail(`setvar jump to 610 did not stick (got ${jumped})`);
    }

    // Faithful-account kit (bankchapel-test's, unchanged — nothing new gates here).
    await cheatQuiet(page, 'give bronze_axe 1');
    await cheatQuiet(page, 'give net 1');
    await cheatQuiet(page, 'give bread 1');
    await cheatQuiet(page, 'advancestat firemaking 2');
    await cheatQuiet(page, 'advancestat cooking 2');
    await cheatQuiet(page, 'advancestat mining 2');
    await cheatQuiet(page, 'advancestat ranged 2');
    console.log(`[${ts()}] faithful kit granted (axe/net/bread + firemaking/cooking/mining/ranged xp)`);

    await relog(page, user);
    console.log(`[${ts()}] relog complete`);

    await cheatQuiet(page, TELE_CMD);
    await page.waitForTimeout(1000);
    const tile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`[${ts()}] teleported: tile=${JSON.stringify(tile)}`);
    if (!tile || tile.x !== LANDING.x || tile.z !== LANDING.z) {
        fail(`tele to the chapel-exit landing did not land at (${LANDING.x},${LANDING.z}) (got ${JSON.stringify(tile)})`);
    }

    await startScript(page, 'TutorialBot');
    console.log(`[${ts()}] TutorialBot started`);

    const deadline = Date.now() + DEADLINE_MS;
    let v = 610;
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

    // Terminal observable: the mainland teleport.
    await page.waitForTimeout(1500);
    const mainlandTile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`[${ts()}] post-teleport tile: ${JSON.stringify(mainlandTile)}`);
    if (!mainlandTile || mainlandTile.x <= MAINLAND_X) {
        fail(`tutorial reached ${v} but the client tile doesn't show the mainland teleport (got ${JSON.stringify(mainlandTile)})`);
    }

    console.log(`PASS: TutorialBot drove a jump-started account 610 -> ${v} unattended, mainland teleport confirmed (${JSON.stringify(mainlandTile)})`);
} finally {
    await browser.close();
}
