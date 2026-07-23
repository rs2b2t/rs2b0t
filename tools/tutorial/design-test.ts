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

    await startScript(page, 'TutorialBot');

    const closed = await page
        .waitForFunction(m => (globalThis as never as Rs2b0t).rs2b0t.reader.modals().main !== m, DESIGN_MODAL, { timeout: 12000 })
        .then(() => true)
        .catch(() => false);
    if (!closed) {
        fail('design modal never closed -- DesignAccept did not click Accept (component renumbered?)');
    }
    console.log('design modal closed by DesignAccept');

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
