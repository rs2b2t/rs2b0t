// Task 9 section test: jump-start a fresh account to the Quest Guide section
// (the 220 -> 260 ladder) and assert TutorialBot's four
// QuestGuide.ts stages carry it into the mine unattended.
//
// THE JUMP RECIPE HERE IS DELIBERATELY MORE THAN `setvar + relog` -- it makes
// the jumped account FAITHFUL to what a real 0 -> 220 run leaves behind.
// TutorialBot's stage validators are (by ADR-0007 design) gated on permanent
// OBSERVABLES a real run accumulates -- items that never leave the pack, xp
// that never goes back to 0 -- and a bare varp jump has none of them, which
// re-opens earlier sections' stages. Because `TaskBot.loop()` runs the FIRST
// validating stage in array order, any re-opened earlier stage STARVES the
// quest stages behind it. Chased down live, one layer at a time (each was
// masked by the previous one):
//
//   1. No bronze axe -> Survival's `OpenInventoryTab` (gated on `!axe`)
//      re-fires forever, flipping the sidebar back to the inventory tab the
//      moment `OpenQuestTab` selects the quest journal: observed live as a
//      stall at exactly 240 with `TalkQuestGuideAgain` (gated on
//      `activeSideTab() === 2`) never running.
//   2. Fixing 1 with `::give bronze_axe` alone re-opens `ChopTree`
//      (`firemaking xp === 0 && axe && !logs`) -- the bot chops scenery
//      trees ~10s/loop forever (observed live: `ScriptContext.loopCount` 2
//      after 20s, matching ChopTree's two delayUntil waits, tutorial pinned
//      at 220 with the chat modal never once open).
//   3. Cooking xp > 0 (needed to close `NetShrimp`/`CookShrimp`) re-opens
//      `OpenChefDoor` (gated on `cooking xp > 0 && x <= 3089 && no
//      flour/dough/bread`) anywhere west of the survival fence -- which the
//      whole quest-guide area is. `::give bread` closes its bread-chain gate
//      the same way a real bake does.
//
// Full faithful kit: bronze_axe (OpenInventoryTab), net (TalkSurvivalAgain),
// bread (OpenChefDoor), firemaking xp (ChopTree/LightFire), cooking xp
// (NetShrimp/CookShrimp + OpenSurvivalGate's entry). The one-shot-latched
// stages (talks, tab clicks, gate/door opens) CANNOT be pre-closed from
// outside -- a fresh script instance re-arms them -- but each fires at most
// once, latches on its verified outcome, and is harmless at tutorial=220
// (recap dialogues, plain tab switches, doors/gates that teleport through
// without advancing the varp).
//
// The test lands the jumped account INSIDE the Quest Guide's hall via
// `::tele` at (3086,3121) -- a tile chosen against every misfire surface
// found live: inside the hall's sealed walls (z < 3126; a Talk-to from the
// north strip CANNOT path in -- QuestGuide.ts file-header note 1), within
// 10 of the Quest Guide's wander box, out of the RuneScape Guide's
// (Survival's `TalkToGuide` gate is proximity-only and his wander box gets
// within 10 of the mine-ladder tile), and > 20 tiles from the survival gate
// (whose re-armed opener would otherwise teleport the bot back east). An
// earlier no-tele variant (letting the re-armed `OpenQuestGuideDoor` walk
// the bot over from spawn organically) proved able to reach and clear BOTH
// recap conversations but stalled somewhere on the cross-island leg within
// the 5-min deadline twice -- that leg is Task 8's chef-test territory
// (proven there in the real flow), not this section's, so the section test
// doesn't re-prove it. The re-armed `OpenQuestGuideDoor` still fires once
// IN-test (run-enabled is its only gate): it teleports the bot out through
// the door, latching on the observed z >= 3126 crossing -- and
// `EnterQuestHall` then does exactly what it does after a REAL 200 -> 220
// arrival: opens the door from the north strip and re-enters. So the
// section's real entry seam gets exercised on every test run.
//
// `chef-test.ts` (full REAL 0 -> 220 run, no cheats) stays the regression
// gate proving the quest stages are also quiet BEFORE 220.
//
// Usage: bun tools/tutorial/questguide-test.ts [base-url]

import { launchBrowser } from '../lib/harness.js';
import { bootAndLogin, cheatQuiet, getServerVarQuiet, relog, startScript } from './harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const TARGET = 260;
const DEADLINE_MS = 5 * 60_000;
const POLL_MS = 3000;

/** Climbing the mine ladder shifts world z by +6400 (QuestGuide.ts's MINE_Z note). */
const MINE_Z = 9000;

/** World (3086,3121), inside the hall (file header), as `::tele level,mx,mz,lx,lz`. */
const TELE_CMD = 'tele 0,48,48,14,49';
const LANDING = { x: 3086, z: 3121 };

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

    const user = `qg${Date.now().toString(36).slice(-7)}`;
    await bootAndLogin(page, base, user);

    const fresh = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] fresh account '${user}': tutorial=${fresh} (server)`);
    if (fresh !== 0) {
        fail(`fresh account did not start at tutorial=0 (got ${fresh}) -- tutorial-varp assumption broken`);
    }

    // Two-step setvar (the "Stage-jump recipe corrections"):
    // a single `setvar tutorial 220` from a fresh spawn silently reverts to 1
    // (the design-modal close cascade rewrites it a tick later). ALL commands
    // go through cheatQuiet, not the typed `cheat`: the first setvar closes
    // the design modal, after which the typed path's canvas-focus click lands
    // in the world and can start an NPC dialogue -- which then EATS all typed
    // input, silently dropping later kit commands (harness.ts cheatQuiet doc).
    await cheatQuiet(page, 'setvar tutorial 1');
    await cheatQuiet(page, 'setvar tutorial 220');
    const jumped = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] after setvar 1 -> 220: tutorial=${jumped} (server)`);
    if (jumped !== 220) {
        fail(`setvar jump to 220 did not stick (got ${jumped})`);
    }

    // Faithful-account kit (file header): the permanent observables a real
    // 0 -> 220 run leaves behind, without which earlier sections' validators
    // re-open and starve the quest stages.
    await cheatQuiet(page, 'give bronze_axe 1');
    await cheatQuiet(page, 'give net 1');
    await cheatQuiet(page, 'give bread 1');
    await cheatQuiet(page, 'advancestat firemaking 2');
    await cheatQuiet(page, 'advancestat cooking 2');
    console.log(`[${ts()}] faithful kit granted (axe/net/bread + firemaking/cooking xp)`);

    // Relog so the login script re-evaluates at 220: attaches the backpack
    // (inv_transmit -- the items above are invisible to the client until
    // then) plus the stats/music/controls tabs, and re-fires the 220 entry
    // hint via ~set_tutorial_progress. The quest journal tab is deliberately
    // NOT attached at 220 (login gates it on > 230), keeping OpenQuestTab's
    // attach-signal faithful.
    await relog(page, user);
    console.log(`[${ts()}] relog complete`);

    // Land inside the hall (file header: every alternative landing found a
    // misfire surface live).
    await cheatQuiet(page, TELE_CMD);
    await page.waitForTimeout(1000);
    const tile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`[${ts()}] teleported: tile=${JSON.stringify(tile)}`);
    if (!tile || tile.x !== LANDING.x || tile.z !== LANDING.z) {
        fail(`tele into the Quest Guide hall did not land at (${LANDING.x},${LANDING.z}) (got ${JSON.stringify(tile)})`);
    }

    await startScript(page, 'TutorialBot');
    console.log(`[${ts()}] TutorialBot started`);

    const deadline = Date.now() + DEADLINE_MS;
    let v = 220;
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

    // Mine-arrival observable: the climb shifts world z by +6400; confirm the
    // client agrees post-climb.
    const mineTile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`[${ts()}] post-climb tile: ${JSON.stringify(mineTile)}`);
    if (!mineTile || mineTile.z < MINE_Z) {
        fail(`tutorial reached ${v} but the client tile doesn't show the expected mine z-jump (got ${JSON.stringify(mineTile)})`);
    }

    console.log(`PASS: TutorialBot drove a jump-started account 220 -> ${v} unattended, mine z-jump confirmed (${JSON.stringify(mineTile)})`);
} finally {
    await browser.close();
}
