import { launchBrowser } from '../lib/harness.js';
import { bootAndLogin, cheat, getServerVar, getServerVarQuiet, relog, startScript } from './harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const TALKING_STAGE = 1;
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

    await cheat(page, `setvar tutorial ${TALKING_STAGE}`);
    const afterSet = await getServerVar(page, 'tutorial');
    if (afterSet !== TALKING_STAGE) {
        fail(`::setvar tutorial ${TALKING_STAGE} did not stick (::getvar reads ${afterSet}) -- no stage-jump mechanism available on this engine`);
    }
    console.log(`::setvar tutorial ${TALKING_STAGE} confirmed via ::getvar (server value now ${afterSet}; note reader.varp(281) client-side never reflects this -- see harness.ts getServerVar doc)`);

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

    await cheat(page, `tele ${GUIDE_ROOM}`);
    await page.waitForTimeout(1500);

    await startScript(page, 'TutorialBot');

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

    const cleared = await page
        .waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.reader.modals().chat === -1, undefined, { timeout: 20000 })
        .then(() => true)
        .catch(() => false);

    if (!cleared) {
        fail('dialog never cleared -- AdvanceDialog is not wired/working');
    }

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
