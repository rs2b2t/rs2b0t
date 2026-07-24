// Hands-on session: open a visible local client, log in, teleport to the Ardougne
// East bank, and seed 100k gp + 1000 rune essence. Then leave the window open so a
// human can play and demonstrate the exact un-note flow.
//
// Usage: HEADED=1 bun tools/ardy-session.ts [base] [user]

import { boot, bringUpOffIsland, fail, launchBrowser, login, type } from './lib/harness.js';
import { cheatQuiet } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const USER = process.argv[3] || `demo${Date.now().toString(36).slice(-5)}`;
const ARD_TELE = '::tele 0,41,51,31,19'; // Ardougne East bank (2655,3283)

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, USER))) fail('first login failed');
    await bringUpOffIsland(page, { user: USER });

    await type(page, ARD_TELE);
    await page.reload();
    await boot(page);
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) { await page.waitForTimeout(2500); ok = await login(page, USER); }
    if (!ok) fail('relogin at Ardougne failed');

    await cheatQuiet(page, '~item coins 100000'); // gp in hand
    await cheatQuiet(page, '~bankitem coins 100000'); // + gp in the bank
    await cheatQuiet(page, '~bankitem blankrune 1000'); // 1000 essence in the bank
    await page.waitForTimeout(600);

    console.log('==================================================================');
    console.log(`READY — account '${USER}' (password: test) at the Ardougne East bank.`);
    console.log('  • 100,000 gp in your pack AND 100,000 gp in the bank');
    console.log('  • 1,000 Rune essence in the bank');
    console.log('The window is yours. Show me the exact un-note flow (which store, which');
    console.log('ops), then tell me what to change. This session stays open — Ctrl-C or');
    console.log('tell me to close it when done.');
    console.log('==================================================================');

    await new Promise(() => {}); // keep the browser open indefinitely
} catch (e) {
    console.error(e);
    fail(String(e));
}
