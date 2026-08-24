/** Live proof for the list/CSV toggle on a `string[]` setting, driven through the real panel.
 *  Why: the toggle rewrites another row's control, so the only honest check is opening the modal,
 *  flipping the mode, typing into the textarea, and reading what the store kept. */

//   HEADED=1 bun e2e/loot-csv-panel-live.ts [http://localhost:8890]
import { boot, deployIsolatedClient, fail, launchBrowser, login, positionalArgs, startFromLibrary } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8890');
const base = args[0];
const user = args[1] ?? `lcsv${Date.now().toString(36).slice(-5)}`;

const TYPED_CSV = 'Bones, Ashes, Coins';
const EXPECTED = ['Bones', 'Ashes', 'Coins'];

interface Api {
    __rs2b0t: { SettingsStore: { save(script: string, key: string, raw: string): void; displayString(script: string, key: string, def: unknown): string } };
}

const client = deployIsolatedClient(`lcsv${Date.now().toString(36).slice(-6)}`);
const browser = await launchBrowser({ swiftshader: true });
const context = await browser.newContext();
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
const page = await context.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await page.goto(`${base}${client.page}`);
    await boot(page);
    if (!(await login(page, user))) {
        fail('login failed');
    }

    await page.evaluate(() => {
        const g = globalThis as never as Api;
        g.__rs2b0t.SettingsStore.save('AutoFighter', 'lootMode', 'list');
        g.__rs2b0t.SettingsStore.save('AutoFighter', 'loot', 'clue scroll, uncut ruby');
    });
    await startFromLibrary(page, 'Combat', 'AutoFighter');
    await page.getByRole('button', { name: /Edit parameters/ }).click();
    // Why: the library modal leaves its own hidden backdrop behind, so the params body is the unambiguous handle.
    await page.waitForSelector('.rs2b0t-params-body', { state: 'visible', timeout: 5000 });

    const chips = page.locator('.rs2b0t-ctl-chips');
    if (!(await chips.first().isVisible())) {
        fail('list mode did not render the chip control for loot');
    }
    console.log('list mode renders chips');

    const modeRow = page.locator('.rs2b0t-param-row', { has: page.getByText('Loot entry mode', { exact: true }) });
    await modeRow.locator('select').selectOption({ label: 'CSV (text + copy/paste)' });

    const textarea = page.locator('textarea.rs2b0t-param-csvtext');
    await textarea.waitFor({ state: 'visible', timeout: 5000 });
    if (await chips.first().isVisible().catch(() => false)) {
        fail('the chip control survived the switch to CSV');
    }
    const seeded = await textarea.inputValue();
    if (!/clue scroll/i.test(seeded) || !/uncut ruby/i.test(seeded)) {
        fail(`the textarea did not open on the current loot, saw '${seeded}'`);
    }
    console.log(`CSV mode opened on '${seeded}'`);

    await page.locator('button.rs2b0t-button', { hasText: /^Copy$/ }).click();
    const copied = (await page.evaluate(() => navigator.clipboard.readText())).trim();
    if (copied !== seeded.trim()) {
        fail(`Copy put '${copied}' on the clipboard, not '${seeded}'`);
    }
    console.log('Copy wrote the textarea to the clipboard');

    await page.evaluate(text => navigator.clipboard.writeText(text), TYPED_CSV);
    await page.locator('button.rs2b0t-button', { hasText: /^Paste$/ }).click();
    await page.waitForTimeout(400);
    const pasted = await textarea.inputValue();
    if (pasted.trim() !== TYPED_CSV) {
        fail(`Paste left '${pasted}' in the textarea, not '${TYPED_CSV}'`);
    }

    const stored = await page.evaluate(() =>
        sessionStorage.getItem('rs2b0t:set:AutoFighter:loot') ?? localStorage.getItem('rs2b0t:set:AutoFighter:loot'));
    const kept = (stored ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (kept.join('|').toLowerCase() !== EXPECTED.join('|').toLowerCase()) {
        fail(`the store kept [${kept.join(', ')}], not [${EXPECTED.join(', ')}]`);
    }
    console.log(`Paste persisted [${kept.join(', ')}]`);

    await modeRow.locator('select').selectOption({ label: 'List (chips)' });
    await chips.first().waitFor({ state: 'visible', timeout: 5000 });
    const chipText = await page.locator('.rs2b0t-ctl-chips .rs2b0t-param-tag').allInnerTexts();
    const backToChips = chipText.map(t => t.replace('✕', '').trim());
    if (backToChips.join('|').toLowerCase() !== EXPECTED.join('|').toLowerCase()) {
        fail(`switching back showed chips [${backToChips.join(', ')}], not the pasted list`);
    }
    console.log(`switching back rebuilt chips [${backToChips.join(', ')}]`);

    await page.screenshot({ path: 'docs/e2e/loot-csv-panel-live.png' });
    console.log(`PASS, CSV mode round-tripped [${EXPECTED.join(', ')}] through the textarea, the clipboard and back to chips`);
} finally {
    client.cleanup();
    await browser.close();
}
