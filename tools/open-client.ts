// Open a visible bot-client window at the login screen so a human can log in and
// inspect. Does nothing else — no auto-login, no seeding. Stays open until closed.
//
// Usage: HEADED=1 bun tools/open-client.ts [base]

import { boot, fail, launchBrowser } from './lib/harness.js';

const base = process.argv[2] || 'http://localhost:8890';

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    console.log('==================================================');
    console.log(`Client window open at ${base}/bot.html — log in and inspect.`);
    console.log('The __rs2b0t debug API is on the page (reader, Inventory, etc.).');
    console.log('Tell me to close it when done, or Ctrl-C here.');
    console.log('==================================================');
    await new Promise(() => {});
} catch (e) {
    console.error(e);
    fail(String(e));
}
