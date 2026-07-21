// Task 3 dialog-driver integration test: jump a fresh account past the
// character-design screen straight to the first talking stage of Tutorial
// Island, talk to the basics instructor, and assert that once TutorialBot is
// started (AdvanceDialog wired first in onStart, per this task) it clicks
// and chooses through the whole conversation unattended.
//
// Why the relog trick: a fresh account spawns with the character-design
// screen forced open (main modal 3559, tutorial varp 281 = 0) because the
// login script (content/scripts/tutorial/scripts/tutorial.rs2,
// `[label,start_tutorial]`) does `if_openmain(player_kit)` only while
// `%tutorial = ^newbie_basics_instructor_start` (0). DesignAccept isn't
// built until Task 4, so a bot can't close that modal yet. Instead: use the
// `::setvar` debug command (confirmed below, engine-native — see
// ClientCheatHandler.ts `cmd === 'setvar'`, gated on staffModLevel >= 3;
// every login on a non-production Engine-TS gets staffModLevel 4, see
// LoginThread.ts) to jump the *server-side* varp straight past the design
// stage to `^newbie_basics_instructor_designed_character` (1), then reload
// the page and log back in as the same account — the login script re-runs,
// sees tutorial != 0, and skips the design modal entirely.
//
// NOTE on verifying the jump: this test checks `::setvar`'s effect via
// `::getvar` (game-chat echo), NOT `reader.varp(281)`. Confirmed during this
// task: `tutorial` (varp 281) is not marked `transmit=yes` in its pack config
// (content/scripts/tutorial/configs/tutorial.varp), so the client's local
// varp mirror never receives it even though the server-side write genuinely
// happens (see harness.ts `getServerVar` doc comment for the full
// differential-probe writeup). That's a foundational concern for the whole
// tutorial-arc plan (TutorialBot.progress() reads that same client mirror) —
// flagged in the Task 3 report, not fixed here (out of this task's scope: a
// content-pack change, not a bot-client change).
//
// Usage: bun tools/tutorial/dialog-test.ts [base-url]

import { launchBrowser } from '../lib/harness.js';
import { bootAndLogin, cheat, getServerVar, getServerVarQuiet, relog, startScript } from './harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
// ^newbie_basics_instructor_designed_character (content/scripts/tutorial/configs/tutorial.constant):
// one past design-accept — no design modal, ready to talk to the basics
// instructor (content id `newbie_basics_instructor`).
const TALKING_STAGE = 1;
// p_telejump target in [label,start_tutorial] (tutorial.rs2) for tutorial ==
// 0 -- the same room a fresh account already spawns in; re-asserted here so
// the test doesn't depend on save-position assumptions surviving the relog.
const GUIDE_ROOM = '0,48,48,22,34';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type NpcSnap = { index: number; name: string | null; distance: number; ops: (string | null)[] };
type Rs2b0t = {
    rs2b0t: {
        reader: {
            varp(index: number): number;
            modals(): { main: number; side: number; chat: number };
            npcs(): NpcSnap[];
        };
        router: { driver: { interactNpc(index: number, op: number): boolean | Promise<boolean> } };
    };
};

const modals = (page: import('playwright-core').Page) => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.modals());

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const user = `dlg${Date.now().toString(36).slice(-7)}`;
    await bootAndLogin(page, base, user);

    const fresh = await getServerVar(page, 'tutorial');
    const freshModals = await modals(page);
    console.log(`fresh account '${user}': tutorial=${fresh} (server), main modal=${freshModals.main}`);
    if (fresh !== 0) {
        fail(`fresh account did not start at tutorial=0 (got ${fresh}) -- TUTORIAL_VARP assumption broken`);
    }
    if (freshModals.main !== 3559) {
        fail(`fresh account did not have the design screen open (main modal ${freshModals.main}, expected 3559)`);
    }

    // Step 1: confirm the debug-var command's syntax (by varp name, matching
    // content/scripts/tutorial/configs/tutorial.varp's `[tutorial]` debugname).
    await cheat(page, `setvar tutorial ${TALKING_STAGE}`);
    const afterSet = await getServerVar(page, 'tutorial');
    if (afterSet !== TALKING_STAGE) {
        fail(`::setvar tutorial ${TALKING_STAGE} did not stick (::getvar reads ${afterSet}) -- no stage-jump mechanism available on this engine`);
    }
    console.log(`::setvar tutorial ${TALKING_STAGE} confirmed via ::getvar (server value now ${afterSet}; note reader.varp(281) client-side never reflects this -- see harness.ts getServerVar doc)`);

    // Step 2: the relog trick -- log out and back in as the same account so
    // the login script re-evaluates with tutorial != 0. Budget generously:
    // Engine-TS doesn't notice a client.logout() until its ~30s dead-
    // connection timeout fires (see harness.ts `relog` doc).
    console.log('relogging (budget up to ~90s -- Engine-TS dead-connection timeout, see harness.ts relog doc)...');
    await relog(page, user);
    const afterRelog = await getServerVar(page, 'tutorial');
    const relogModals = await modals(page);
    console.log(`relogged in: tutorial=${afterRelog} (server), main modal=${relogModals.main}`);
    if (afterRelog !== TALKING_STAGE) {
        fail(`tutorial varp did not persist across relog (expected ${TALKING_STAGE}, got ${afterRelog}) -- scope=perm assumption broken`);
    }
    if (relogModals.main !== -1) {
        fail(`design screen still open after relog (main modal ${relogModals.main}) -- relog trick did not bypass it`);
    }

    // Belt-and-suspenders: confirm ::tele too and land in the guide's room
    // regardless of where the save happened to leave us.
    await cheat(page, `tele ${GUIDE_ROOM}`);
    await page.waitForTimeout(1500); // let the scene rebuild around the new tile

    // Step 3: start TutorialBot (AdvanceDialog wired first in onStart) before
    // any dialog is open -- it should sit idle (no task validates).
    await startScript(page, 'TutorialBot');

    // Step 4: talk to the basics instructor (discover its display name live
    // rather than hardcoding it) and assert a dialog opens.
    const guideName = await page.evaluate(() => {
        const npcs = (globalThis as never as Rs2b0t).rs2b0t.reader.npcs();
        const candidates = npcs.filter(n => n.ops.some(o => o?.toLowerCase() === 'talk-to')).sort((a, b) => a.distance - b.distance);
        const guide = candidates[0];
        if (!guide) {
            return null;
        }
        const op = guide.ops.findIndex(o => o?.toLowerCase() === 'talk-to') + 1;
        (globalThis as never as Rs2b0t).rs2b0t.router.driver.interactNpc(guide.index, op);
        return guide.name;
    });
    if (!guideName) {
        fail('no nearby NPC with a Talk-to option -- could not find the basics instructor to open a dialog with');
    }
    console.log(`basics-instructor display name (live query): '${guideName}'`);

    const opened = await page
        .waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.reader.modals().chat !== -1, undefined, { timeout: 8000 })
        .then(() => true)
        .catch(() => false);
    if (!opened) {
        fail('talking to the basics instructor never opened a chat dialog');
    }
    console.log('dialog opened');

    // Step 5: the assertion this task exists to prove -- AdvanceDialog
    // (wired first in TutorialBot.onStart) clicks/chooses through the whole
    // conversation unattended.
    const cleared = await page
        .waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.reader.modals().chat === -1, undefined, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);

    if (!cleared) {
        fail('dialog never cleared -- AdvanceDialog is not wired/working');
    }

    // AdvanceDialog must DECLINE the guide's dev-only "skip the tutorial?"
    // prompt ("No, thank you."), not accept it. Accepting jumps straight to
    // ^tutorial_complete (1000); declining continues the welcome and advances
    // 1 -> 4 (^newbie_basics_instructor_interact_with_scenery). See the Task 3
    // report for the original short-circuit finding.
    //
    // Task 7 update: TutorialBot keeps driving past 4 (OpenGuideDoor -> 10,
    // the survival stages beyond), and its next dialogue can be open by the
    // time this reads — so poll with getServerVarQuiet (typed input is eaten
    // while a chat dialog is open; a single typed read here flakes on the
    // stale pre-jump echo) and accept any value in [4, 1000).
    const deadline = Date.now() + 15000;
    let finalVarp: number | null = null;
    while (Date.now() < deadline) {
        finalVarp = await getServerVarQuiet(page, 'tutorial');
        if (finalVarp !== null && finalVarp >= 4) {
            break;
        }
        await page.waitForTimeout(1000);
    }
    if (finalVarp === 1000) {
        fail('AdvanceDialog SKIPPED the tutorial (tutorial=1000) -- it must decline the "skip the tutorial?" prompt, not take "Yes please."');
    }
    if (finalVarp === null || finalVarp < 4) {
        fail(`dialog cleared but tutorial did not progress past the guide welcome (expected >= 4, got ${finalVarp}) -- decline path not reached`);
    }
    console.log(`PASS: AdvanceDialog cleared the dialog and DECLINED the skip prompt (tutorial now ${finalVarp} server-side, expected >= 4; later stages keep driving)`);
} finally {
    await browser.close();
}
