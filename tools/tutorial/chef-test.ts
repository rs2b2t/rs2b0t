// Task 8 section test: a fresh account runs the REAL tutorial start (no
// cheats from the bot) through survival (proven by survival-test.ts) and
// this task's chef + controls section (Chef.ts's 9 stage tasks wired into
// TutorialBot.onStart after survivalStages), asserting the server ladder
// reaches stage 220 (the Quest Guide's door, docs/tutorial-map.md).
//
// Why a full run instead of the brief's stage-jump sketch (`::setvar
// tutorial 130` + relog + `::tele`): the jump recipe works (two-step setvar
// -- see below -- plus a relog for the backpack inv_transmit, plus ::give
// for the survival items whose absence reopens Survival's OpenInventoryTab
// on a jumped account), but proving the section with it adds three moving
// parts the full run simply doesn't have, and the full run only costs ~100s
// more (survival is fast and already stable at 3/3). The jump gotchas are
// recorded here for the next task that DOES need one:
//
// 1. **`::setvar tutorial <N>` straight from a fresh spawn silently reverts
//    to 1.** `tutorial` defaults protected (no `protect=no` in its varp
//    config), so the engine's ClientCheatHandler calls `player.closeModal()`
//    before writing -- closing the character-design screen fires the real
//    `[if_close,player_kit]` -> `queue(tutorial_designed_character)` cascade,
//    which unconditionally writes `%tutorial = 1` a tick later, clobbering
//    the setvar. Fix: `setvar tutorial 1` first (matches what the cascade
//    writes anyway), THEN `setvar tutorial <N>` -- no modal left, sticks
//    immediately, no relog needed for the varp itself (verified live).
// 2. **A relog IS needed before any stage whose validator reads the
//    backpack**: the login script only attaches + `inv_transmit`s the
//    backpack (`sideIcon[3]`) when `%tutorial > 20` AT LOGIN, so a
//    jumped-but-not-relogged account reads an empty inventory forever.
//    The music/controls tabs (170/190) need no relog -- their step procs
//    attach them mid-session as the ladder really advances.
//
// The first full run of this section ALSO stalled at 130 -- not a jump
// artifact but a real stage bug worth remembering (fixed in Chef.ts, full
// mechanics in its file header): `OpenChefDoor` latched its one-shot on
// interact() DISPATCH (packet sent), but the click had fired from the
// survival-gate landing tile, 10 tiles from the door with no completable
// client path -- and for op-clicks the client moves all-or-nothing
// (`tryMove(tryNearest=false)`), while this engine's default
// `clientRoutefinder=true` puts players on the NAIVE server routefinder
// that can't route around obstacles either. Server: "I can't reach that!";
// bot: latched done, never retried. Door stages now walk-snap toward the
// door first and latch only on the observed teleport-through. (Red herring
// note for future debuggers: every tutorial door re-closes ~3 ticks after
// opening -- `loc_change(inviswall, 3)` -- so "the closed-door loc is still
// there" NEVER means the open failed; check the varp or the position.)
//
// Usage: bun tools/tutorial/chef-test.ts [base-url]

import { chromium } from 'playwright-core';
import { bootAndLogin, getServerVarQuiet, startScript } from './harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const TARGET = 220;
const DEADLINE_MS = 12 * 60_000;
const POLL_MS = 5000;

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

    const user = `chf${Date.now().toString(36).slice(-7)}`;
    await bootAndLogin(page, base, user);

    const fresh = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] fresh account '${user}': tutorial=${fresh} (server)`);
    if (fresh !== 0) {
        fail(`fresh account did not start at tutorial=0 (got ${fresh}) -- tutorial-varp assumption broken`);
    }

    await startScript(page, 'TutorialBot');
    console.log(`[${ts()}] TutorialBot started`);

    const deadline = Date.now() + DEADLINE_MS;
    let v = 0;
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

    console.log(`PASS: TutorialBot drove a fresh account 0 -> ${v} unattended (no cheats, full run)`);
} finally {
    await browser.close();
}
