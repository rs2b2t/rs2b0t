// End-to-end wall test: launch the Electron shell on /multibox.html, add two
// bots, and assert (1) they log in as DISTINCT accounts (credential isolation),
// (2) the focused bot draws fast while the other draws slow yet BOTH keep
// logic (loopCycle) at full speed (decoupling), and (3) focus↔wall navigation
// never reloads an iframe (loopCycle never resets).
//   PATH="/opt/homebrew/opt/node@24/bin:$PATH" npx tsx tools/multibox-test.ts [server-url]
import { _electron as electron } from 'playwright-core';

const server = process.argv[2] ?? 'http://localhost:8888';
const tag = Date.now().toString(36).slice(-6);
const u1 = `mbx${tag}a`;
const u2 = `mbx${tag}b`;

function fail(msg: string): never { console.error(`FAIL: ${msg}`); process.exit(1); }

interface Snap { id: number; username: string; ingame: boolean; loopCycle: number; drawn: number; mode: string; focused: boolean }
type Mbx = { multibox: { add(a: { username: string; password: string }): unknown; focus(id: number): void; wall(): void; slots(): Snap[] } };

const app = await electron.launch({
    args: ['desktop/main.cjs', `--server=${server}/multibox.html`],
    executablePath: 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
});

try {
    const page = await app.firstWindow();
    const slots = () => page.evaluate(() => (globalThis as never as Mbx).multibox.slots());

    await page.waitForFunction(() => Boolean((globalThis as never as Mbx).multibox), undefined, { timeout: 30000 });
    console.log('manager booted');

    await page.evaluate(([a, b]) => { const m = (globalThis as never as Mbx).multibox; m.add({ username: a, password: 'test' }); m.add({ username: b, password: 'test' }); }, [u1, u2]);

    // both auto-login with their injected creds
    await page.waitForFunction(() => { const s = (globalThis as never as Mbx).multibox.slots(); return s.length === 2 && s.every(x => x.ingame); }, undefined, { timeout: 90000 })
        .catch(() => fail('both bots did not reach ingame within 90s'));

    // (1) credential isolation — two DISTINCT usernames actually ingame
    const users = (await slots()).map(s => s.username).sort();
    if (users.length !== 2 || users[0] === users[1]) fail(`accounts collided: ${users.join(', ')}`);
    if (users[0] !== u1 && users[0] !== u2) fail(`unexpected usernames: ${users.join(', ')}`);
    console.log(`PASS: two distinct accounts ingame (${users.join(', ')})`);

    // (2) decoupling — focus slot 1, measure both over 4s
    const ids = (await slots()).map(s => s.id);
    await page.evaluate(id => (globalThis as never as Mbx).multibox.focus(id), ids[0]);
    const a = await slots();
    await page.waitForTimeout(4000);
    const b = await slots();
    const by = (arr: Snap[], id: number) => arr.find(s => s.id === id)!;
    const secs = 4;
    const fDraw = (by(b, ids[0]).drawn - by(a, ids[0]).drawn) / secs;
    const bDraw = (by(b, ids[1]).drawn - by(a, ids[1]).drawn) / secs;
    const fLoop = (by(b, ids[0]).loopCycle - by(a, ids[0]).loopCycle) / secs;
    const bLoop = (by(b, ids[1]).loopCycle - by(a, ids[1]).loopCycle) / secs;
    console.log(`focused: draw ${fDraw.toFixed(1)} loop ${fLoop.toFixed(1)} | background: draw ${bDraw.toFixed(1)} loop ${bLoop.toFixed(1)} (fps)`);
    if (fDraw < 25) fail(`focused bot draw fps too low (${fDraw.toFixed(1)})`);
    if (bDraw > 15) fail(`background bot draw not throttled (${bDraw.toFixed(1)})`);
    if (fLoop < 25 || bLoop < 25) fail(`logic starved (focused ${fLoop.toFixed(1)}, background ${bLoop.toFixed(1)})`);
    console.log('PASS: render decoupled from logic across the wall');

    // (3) navigation does not reload — loopCycle is monotonic across focus↔wall
    const beforeNav = by(await slots(), ids[1]).loopCycle;
    await page.evaluate(id => (globalThis as never as Mbx).multibox.focus(id), ids[1]);
    await page.waitForTimeout(500);
    await page.evaluate(() => (globalThis as never as Mbx).multibox.wall());
    await page.waitForTimeout(500);
    const afterNav = by(await slots(), ids[1]).loopCycle;
    if (afterNav < beforeNav) fail(`iframe reloaded on navigation (loopCycle ${beforeNav} -> ${afterNav})`);
    console.log('PASS: fullscreen↔wall navigation kept sessions alive (no reload)');

    console.log('\nPASS');
} finally {
    await app.close();
}
