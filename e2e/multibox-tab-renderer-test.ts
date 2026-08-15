// Issue #314 — a background tab must stop its bots drawing, and returning to it must resume what was running before: [base].
// Measured with each bot's own RenderGate frame counter rather than a proxy for it.

//   bun e2e/multibox-tab-renderer-test.ts [http://localhost:8888]
import { fail, launchBrowser, positionalArgs } from './lib/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://localhost:8888');
const base = args[0];
const tag = Date.now().toString(36).slice(-6);
const users = [`rnd${tag}a`, `rnd${tag}b`] as const;
const PASSPHRASE = 'renderer-e2e';
const SAMPLE_MS = 6000;

interface Snap { id: number; username: string; ingame: boolean; tab: string; mode: string; drawn: number }
type Mbx = { multibox: { slots(): Snap[]; tabs(): string[]; activeTab(): string } };

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await page.goto(`${base}/multibox.html`);
    await page.waitForFunction(() => Boolean((globalThis as never as Mbx).multibox), undefined, { timeout: 30000 });

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
    await page.waitForFunction(() => (globalThis as never as Mbx).multibox.slots().every(s => s.ingame), undefined, { timeout: 120000 })
        .catch(() => fail('bots did not reach ingame'));
    console.log('two bots ingame');

    // move the second bot into its own tab
    await page.click('.mbx-tabadd');
    await page.fill('.mbx-tabinput', 'away');
    await page.press('.mbx-tabinput', 'Enter');
    await page.evaluate(() => {
        const tiles = Array.from(document.querySelectorAll<HTMLElement>('.mbx-slot')).sort((a, b) => (Number.parseInt(a.style.order, 10) || 0) - (Number.parseInt(b.style.order, 10) || 0));
        const chip = document.querySelector<HTMLElement>('.mbx-tabchip[data-tab="away"]')!;
        const dt = new DataTransfer();
        tiles[1].dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
        chip.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        chip.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });

    const sample = async (label: string) => {
        const before = await page.evaluate(() => (globalThis as never as Mbx).multibox.slots().map(s => ({ u: s.username, tab: s.tab, mode: s.mode, drawn: s.drawn })));
        await page.waitForTimeout(SAMPLE_MS);
        const after = await page.evaluate(() => (globalThis as never as Mbx).multibox.slots().map(s => ({ u: s.username, tab: s.tab, mode: s.mode, drawn: s.drawn })));
        const deltas = after.map((a, i) => ({ user: a.u, tab: a.tab, mode: a.mode, frames: a.drawn - before[i].drawn }));
        console.log(`${label}: ${deltas.map(d => `${d.user}[${d.tab}/${d.mode}] +${d.frames} frames`).join(', ')}`);
        return deltas;
    };

    const onMain = await sample('Main active');
    if (onMain[0].frames <= 0) fail(`the visible bot stopped drawing (+${onMain[0].frames})`);
    if (onMain[1].frames !== 0) fail(`the background-tab bot kept drawing (+${onMain[1].frames} frames) — renderer not suspended`);
    if (onMain[1].mode !== 'hidden') fail(`background-tab bot mode is '${onMain[1].mode}', expected 'hidden'`);

    await page.click('.mbx-tabchip[data-tab="away"]');
    const onAway = await sample('away active');
    if (onAway[1].frames <= 0) fail(`returning to the tab did not resume drawing (+${onAway[1].frames})`);
    if (onAway[0].frames !== 0) fail(`the now-background bot kept drawing (+${onAway[0].frames} frames)`);

    await page.click('.mbx-tabchip[data-tab="Main"]');
    const back = await sample('Main active again');
    if (back[0].frames <= 0) fail('the original bot did not resume drawing after coming back');
    if (back[1].frames !== 0) fail('the away-tab bot kept drawing after being backgrounded again');

    // the suspension is the wall's own state: each bot's renderer switch and its
    // persisted setting must read as the user left them (enabled)
    const switches = await page.evaluate(() => Array.from(document.querySelectorAll('iframe')).map(f => {
        const w = (f as HTMLIFrameElement).contentWindow as unknown as { rs2b0t?: { renderGate: { enabled: boolean } } };
        const doc = (f as HTMLIFrameElement).contentDocument;
        const box = new URL((f as HTMLIFrameElement).src).searchParams.get('box') ?? '';
        const toggle = doc?.querySelector<HTMLInputElement>('input[type=checkbox]');
        return { box, gateEnabled: w?.rs2b0t?.renderGate.enabled ?? null, checkbox: toggle?.checked ?? null, stored: doc?.defaultView?.localStorage.getItem(`rs2b0t:${box}:rendererEnabled`) };
    }));
    console.log('renderer switches:', JSON.stringify(switches));
    for (const s of switches) {
        if (s.gateEnabled !== true) fail(`bot '${s.box}' had its renderer switch flipped to ${s.gateEnabled}`);
        if (s.checkbox === false) fail(`bot '${s.box}' shows an unchecked renderer box to the user`);
        if (s.stored === '0') fail(`bot '${s.box}' persisted a disabled renderer to localStorage`);
    }

    await page.screenshot({ path: 'docs/e2e/issue-314-tab-renderer.png' });
    console.log('screenshot: docs/e2e/issue-314-tab-renderer.png');
    console.log('PASS — background tabs stop drawing, resume on return, user switch untouched');
} finally {
    await browser.close();
}
