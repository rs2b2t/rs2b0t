// Issue #294 — rail tabs: full user journey against a local engine.
// Creates a vault + three profiles through the real UI, groups bots into tabs
// with real drag events, renames/reorders/deletes tabs, then reloads the page
// and proves the whole tab state (list, order, membership, active) restores.
//
//   bun tools/multibox-tabs-test.ts [http://localhost:8888]
import { fail, launchBrowser } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const tag = Date.now().toString(36).slice(-6);
const users = [`tab${tag}a`, `tab${tag}b`, `tab${tag}c`] as const;
const PASSPHRASE = 'tabs-e2e';

interface Snap { id: number; username: string; ingame: boolean; focused: boolean; tab: string }
type Mbx = {
    multibox: {
        slots(): Snap[];
        tabs(): string[];
        activeTab(): string;
    };
};

function want<T>(actual: T, expected: T, what: string): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        fail(`${what}: got ${a}, expected ${e}`);
    }
    console.log(`ok: ${what} = ${e}`);
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await page.goto(`${base}/multibox.html`);
    await page.waitForFunction(() => Boolean((globalThis as never as Mbx).multibox), undefined, { timeout: 30000 });
    console.log('wall booted');

    const mbx = () => page.evaluate(() => {
        const m = (globalThis as never as Mbx).multibox;
        return { tabs: m.tabs(), active: m.activeTab(), slots: m.slots().map(s => ({ username: s.username, tab: s.tab, focused: s.focused })) };
    });

    // ---- create the vault and three profiles through the real UI ----
    for (const [i, user] of users.entries()) {
        await page.click('#mbx-add');
        if (i === 0) {
            await page.fill('#mbx-vault-pass', PASSPHRASE);
            await page.fill('#mbx-vault-confirm', PASSPHRASE);
            await page.click('#mbx-vault-go');
        }
        await page.fill('#mbx-new-user', user);
        await page.fill('#mbx-new-pass', 'test');
        await page.click('#mbx-new-go');
    }
    await page.waitForFunction(n => (globalThis as never as Mbx).multibox.slots().length === n, users.length, { timeout: 15000 });
    console.log('three profiles created and loaded');

    // visible tile order = flex order; harness drags by that order, like a user
    const dragTileToChip = (tileIndex: number, tab: string) => page.evaluate(([idx, name]) => {
        const tiles = Array.from(document.querySelectorAll<HTMLElement>('.mbx-slot')).sort((a, b) => (Number.parseInt(a.style.order, 10) || 0) - (Number.parseInt(b.style.order, 10) || 0));
        const tile = tiles[idx as number];
        const chip = document.querySelector<HTMLElement>(`.mbx-tabchip[data-tab="${name}"]`);
        if (!tile || !chip) {
            throw new Error(`no tile ${idx} or chip '${name}'`);
        }
        const dt = new DataTransfer();
        tile.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        chip.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        chip.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        tile.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, [tileIndex, tab] as const);

    const dragChipBeforeChip = (dragged: string, target: string) => page.evaluate(([from, to]) => {
        const chip = (name: string) => document.querySelector<HTMLElement>(`.mbx-tabchip[data-tab="${name}"]`);
        const src = chip(from as string);
        const dst = chip(to as string);
        if (!src || !dst) {
            throw new Error(`no chip '${from}' or '${to}'`);
        }
        const dt = new DataTransfer();
        const rect = dst.getBoundingClientRect();
        const x = rect.left + 2;
        src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x }));
        dst.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x }));
        src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
    }, [dragged, target] as const);

    const hiddenByUser = () => page.evaluate(() => {
        const m = (globalThis as never as Mbx).multibox;
        const tiles = Array.from(document.querySelectorAll<HTMLElement>('.mbx-slot')).sort((a, b) => (Number.parseInt(a.style.order, 10) || 0) - (Number.parseInt(b.style.order, 10) || 0));
        return Object.fromEntries(m.slots().map((s, i) => [s.username, tiles[i].offsetParent === null]));
    });

    // ---- group bots into a new tab ----
    await page.click('.mbx-tabadd');
    await page.fill('.mbx-tabinput', 'miners');
    await page.press('.mbx-tabinput', 'Enter');
    let state = await mbx();
    want(state.tabs, ['Main', 'miners'], 'tabs after add');
    want(state.active, 'Main', 'active stays put so the bots to drag remain visible');

    await dragTileToChip(1, 'miners');
    await dragTileToChip(2, 'miners');
    state = await mbx();
    want(state.slots.map(s => s.tab), ['Main', 'miners', 'miners'], 'membership after drags');
    want(state.slots.filter(s => s.focused).map(s => s.username), [users[0]], 'focus fell back to the visible bot');
    want(await hiddenByUser(), { [users[0]]: false, [users[1]]: true, [users[2]]: true }, 'miners tiles hidden while Main is active');

    await page.click('.mbx-tabchip[data-tab="miners"]');
    state = await mbx();
    want(state.active, 'miners', 'tab switch');
    want(state.slots.filter(s => s.focused).map(s => s.username), [users[1]], 'first miner took focus');
    want(await hiddenByUser(), { [users[0]]: true, [users[1]]: false, [users[2]]: false }, 'Main tile hidden while miners is active');

    // ---- screenshot 1: grouped wall, bots in game ----
    await page.waitForFunction(() => (globalThis as never as Mbx).multibox.slots().every(s => s.ingame), undefined, { timeout: 120000 }).catch(() => fail('bots did not reach ingame'));
    console.log('all three bots ingame');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'docs/e2e/issue-294-tabs.png' });
    console.log('screenshot: docs/e2e/issue-294-tabs.png');

    // ---- rename via the gear ----
    await page.click('.mbx-tabgear');
    await page.click('.mbx-tabmenu-rename');
    await page.fill('.mbx-tabinput', 'mules');
    await page.press('.mbx-tabinput', 'Enter');
    state = await mbx();
    want(state.tabs, ['Main', 'mules'], 'tabs after rename');
    want(state.active, 'mules', 'active follows the rename');
    want(state.slots.map(s => s.tab), ['Main', 'mules', 'mules'], 'bots follow the rename');

    // ---- reorder tabs by dragging a chip ----
    await page.click('.mbx-tabadd');
    await page.fill('.mbx-tabinput', 'afk');
    await page.press('.mbx-tabinput', 'Enter');
    await dragChipBeforeChip('afk', 'mules');
    state = await mbx();
    want(state.tabs, ['Main', 'afk', 'mules'], 'tab order after chip drag');

    // ---- delete a tab: its bot folds into the prior tab (Main) ----
    await dragTileToChip(1, 'afk');
    await page.click('.mbx-tabchip[data-tab="afk"]');
    await page.click('.mbx-tabgear');
    await page.click('.mbx-tabmenu-delete');
    state = await mbx();
    want(state.tabs, ['Main', 'mules'], 'tabs after delete');
    want(state.active, 'Main', 'delete activates the prior tab');
    want(state.slots.map(s => s.tab), ['Main', 'Main', 'mules'], 'deleted tab bot landed in Main');

    await page.click('.mbx-tabchip[data-tab="mules"]');

    // tab names ride inside the encrypted vault payload, never in plaintext
    const blob = await page.evaluate(() => localStorage.getItem('rs2b0t:multibox:profiles') ?? '');
    if (blob.length === 0 || blob.includes('mules') || blob.includes(users[0])) {
        fail('vault blob is missing or leaks tab/account names in plaintext');
    }
    console.log('ok: tab state is encrypted at rest');

    // ---- reload: unlock, load all, everything restores ----
    await page.reload();
    await page.waitForFunction(() => Boolean((globalThis as never as Mbx).multibox), undefined, { timeout: 30000 });
    state = await mbx();
    want(state.tabs, ['Main'], 'locked wall starts with just Main');

    await page.click('#mbx-add');
    await page.fill('#mbx-vault-pass', PASSPHRASE);
    await page.click('#mbx-vault-go');
    await page.click('#mbx-load-all');
    await page.waitForFunction(n => (globalThis as never as Mbx).multibox.slots().length === n, users.length, { timeout: 15000 });
    state = await mbx();
    want(state.tabs, ['Main', 'mules'], 'tab list restored');
    want(state.active, 'mules', 'active tab restored');
    want(state.slots.map(s => ({ u: s.username, t: s.tab })), [
        { u: users[0], t: 'Main' },
        { u: users[1], t: 'Main' },
        { u: users[2], t: 'mules' }
    ], 'bot order and membership restored');
    want(await hiddenByUser(), { [users[0]]: true, [users[1]]: true, [users[2]]: false }, 'restored visibility matches the active tab');

    // ---- screenshot 2: restored wall back in game ----
    await page.waitForFunction(() => (globalThis as never as Mbx).multibox.slots().every(s => s.ingame), undefined, { timeout: 120000 }).catch(() => fail('bots did not relog after the reload'));
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'docs/e2e/issue-294-restored.png' });
    console.log('screenshot: docs/e2e/issue-294-restored.png');

    console.log('PASS — rail tabs group, rename, reorder, delete, and survive a restart');
} finally {
    await browser.close();
}
