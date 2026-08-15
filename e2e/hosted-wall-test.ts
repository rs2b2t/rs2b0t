import { launchBrowser } from './lib/harness.js';

const base = process.argv[2] ?? 'http://localhost:8890';
const tag = Date.now().toString(36).slice(-6);
const u1 = `hw${tag}a`;
const u2 = `hw${tag}b`;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

interface Snap { id: number; username: string; ingame: boolean }
type Mbx = { multibox: { add(a: { username: string; password: string }): unknown; slots(): Snap[] } };

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await page.goto(`${base}/rs2b0t/multibox.html`);
    await page.waitForFunction(() => Boolean((globalThis as never as Mbx).multibox), undefined, { timeout: 30000 });
    console.log('wall booted at /rs2b0t/');

    const host = await page.evaluate(() => window.location.host);
    if (host !== new URL(base).host) fail(`served from '${host}', expected the game origin '${new URL(base).host}'`);

    await page.evaluate(([a, b]) => {
        const m = (globalThis as never as Mbx).multibox;
        m.add({ username: a, password: 'test' });
        m.add({ username: b, password: 'test' });
    }, [u1, u2]);

    const srcs = await page.evaluate(() => Array.from(document.querySelectorAll('iframe')).map(f => new URL((f as HTMLIFrameElement).src).pathname));
    if (srcs.length !== 2) fail(`expected 2 slot iframes, got ${srcs.length}`);
    for (const src of srcs) {
        if (src !== '/rs2b0t/bot.html') fail(`slot iframe resolved to '${src}', expected '/rs2b0t/bot.html' — is bot.html staged?`);
    }
    console.log(`slot iframes resolved under /rs2b0t/: ${srcs.join(', ')}`);

    await page.waitForFunction(() => {
        const s = (globalThis as never as Mbx).multibox.slots();
        return s.length === 2 && s.every(x => x.ingame);
    }, undefined, { timeout: 90000 }).catch(() => fail('both bots did not reach ingame within 90s'));

    const users = (await page.evaluate(() => (globalThis as never as Mbx).multibox.slots())).map(s => s.username).sort();
    if (users[0] === users[1]) fail(`accounts collided: ${users.join(', ')}`);
    console.log(`PASS: two distinct accounts ingame (${users.join(', ')})`);

    // offsetParent, not .hidden — an author display rule can beat the UA's
    // [hidden]{display:none}, leaving a "hidden" row plainly on screen
    const card = await page.evaluate(() => ({
        cpuHidden: (document.getElementById('mbx-resource-cpu-row') as HTMLElement).offsetParent === null,
        memoryHidden: (document.getElementById('mbx-resource-memory-row') as HTMLElement).offsetParent === null,
        bots: document.getElementById('mbx-resource-bots')!.textContent ?? '',
        traffic: document.getElementById('mbx-resource-traffic')!.textContent ?? ''
    }));
    if (!card.cpuHidden || !card.memoryHidden) fail(`host rows still shown with no resource monitor (cpu ${card.cpuHidden}, ram ${card.memoryHidden})`);
    if (!card.bots.startsWith('2 bots')) fail(`bot count read '${card.bots}', expected '2 bots'`);
    if (card.traffic.includes('offline')) fail(`traffic row read '${card.traffic}' — the absent monitor took it down`);
    console.log(`resource card: ${card.bots}, traffic '${card.traffic}', host rows hidden`);

    console.log('PASS — hosted /rs2b0t/ wall works same-origin (prod target, no proxy)');
} finally {
    await browser.close();
}
