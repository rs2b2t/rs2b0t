// Task 4 integration test: a fresh account spawns with the character-design
// screen forced open (main modal 3559, tutorial varp 281 = 0). Start
// TutorialBot and assert its DesignAccept stage clicks Accept unattended — the
// design modal closes and the tutorial advances to stage 1 — with NO cheats
// (no ::setvar/::tele), i.e. the real 0 -> 1 transition a fresh bot account
// takes.
//
// Progress is checked via ::getvar (server-authoritative game-chat echo), not
// reader.varp(281): the tutorial varp is server-only (scope=perm, no
// transmit=yes) so the client mirror never reflects it — see
// tools/tutorial/harness.ts getServerVar() and ADR-0007.
//
// Task 7 update: TutorialBot no longer STOPS at stage 1 — TalkToGuide and the
// survival stages keep driving (1 -> 4 -> 10 -> ...), so (a) the assertion is
// now `reaches >= 1`, not `== 1`, and (b) the final read polls
// getServerVarQuiet() (direct CLIENT_CHEAT packet) in a loop: the old typed
// single-shot read raced the bot's first guide dialogue — typed input is
// eaten while a chat dialog is open, and the parse then returns the STALE
// pre-accept echo (observed live: reported 0 after a real 0 -> 1 -> 4).
//
// Usage: bun tools/tutorial/design-test.ts [base-url]

import { launchBrowser } from '../lib/harness.js';
import { type Page } from 'playwright-core';
import { bootAndLogin, getServerVar, getServerVarQuiet, startScript } from './harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const DESIGN_MODAL = 3559;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Rs2b0t = { rs2b0t: { reader: { modals(): { main: number; side: number; chat: number } } } };
const mainModal = (page: Page) => page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.modals().main);

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const user = `dsn${Date.now().toString(36).slice(-7)}`;
    await bootAndLogin(page, base, user);

    const fresh = await getServerVar(page, 'tutorial');
    const freshMain = await mainModal(page);
    console.log(`fresh account '${user}': tutorial=${fresh} (server), main modal=${freshMain}`);
    if (fresh !== 0) {
        fail(`fresh account did not start at tutorial=0 (got ${fresh}) -- tutorial-varp assumption broken`);
    }
    if (freshMain !== DESIGN_MODAL) {
        fail(`fresh account did not have the design screen open (main modal ${freshMain}, expected ${DESIGN_MODAL})`);
    }

    // Start the bot — DesignAccept should validate() on the open design modal
    // and click Accept on the very first loop.
    await startScript(page, 'TutorialBot');

    const closed = await page
        .waitForFunction(m => (globalThis as never as Rs2b0t).rs2b0t.reader.modals().main !== m, DESIGN_MODAL, { timeout: 12000 })
        .then(() => true)
        .catch(() => false);
    if (!closed) {
        fail('design modal never closed -- DesignAccept did not click Accept (component renumbered?)');
    }
    console.log('design modal closed by DesignAccept');

    // The close is what the content turns into the first progress write
    // ([if_close,player_kit] -> queue -> %tutorial = 1); poll until it lands.
    // The bot keeps driving past 1 (TalkToGuide et al., Task 7), so accept
    // any value >= 1 and use the quiet packet-based read (see header).
    const deadline = Date.now() + 15000;
    let after: number | null = null;
    while (Date.now() < deadline) {
        after = await getServerVarQuiet(page, 'tutorial');
        if (after !== null && after >= 1) {
            break;
        }
        await page.waitForTimeout(1000);
    }
    if (after === null || after < 1) {
        fail(`design accepted but tutorial did not advance past 0 (got ${after}) -- 0->1 transition not fired`);
    }

    console.log(`PASS: DesignAccept advanced a fresh account 0 -> ${after} (design screen cleared, no cheats; >= 1 expected — later stages keep driving)`);
} finally {
    await browser.close();
}
