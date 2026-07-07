// Live 2-bot verification of the MultiBox wall through the rs2b2t relay:
// opens the wall against live rs2b2t, adds two REAL accounts, and asserts both
// reach ingame as distinct players. Proves the multi-bot path end-to-end.
//
//   1) relay up: bun tools/rs2b2t-relay.ts   (or use tools/wall-rs2b2t.sh)
//   2) npx tsx tools/wall-rs2b2t-verify.ts <userA> <passA> <userB> <passB>
import { _electron as electron } from 'playwright-core';

const relay = process.env.RELAY_URL ?? 'http://localhost:8899';
const A = process.argv[2] ?? 'botfarm1';
const Ap = process.argv[3] ?? 'botfarm2026';
const B = process.argv[4] ?? 'botfarm2';
const Bp = process.argv[5] ?? 'botfarm2026';

function fail(m: string): never {
    console.error(`FAIL: ${m}`);
    process.exit(1);
}

interface Snap { id: number; username: string; ingame: boolean; loopCycle: number; drawn: number }
type Mbx = { multibox: { add(a: { username: string; password: string }): unknown; slots(): Snap[] } };

const app = await electron.launch({
    args: ['desktop/main.cjs', `--server=${relay}/multibox.html?nodeid=1`],
    executablePath: 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
});

try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean((globalThis as never as Mbx).multibox), undefined, { timeout: 30000 });
    console.log('wall booted against live rs2b2t; adding two bots…');

    await page.evaluate(([a, ap, b, bp]) => {
        const m = (globalThis as never as Mbx).multibox;
        m.add({ username: a, password: ap });
        m.add({ username: b, password: bp });
    }, [A, Ap, B, Bp]);

    await page
        .waitForFunction(() => { const s = (globalThis as never as Mbx).multibox.slots(); return s.length === 2 && s.every(x => x.ingame); }, undefined, { timeout: 150000 })
        .catch(() => fail('both bots did not reach ingame on live rs2b2t within the timeout'));

    const users = (await page.evaluate(() => (globalThis as never as Mbx).multibox.slots().map(s => s.username))).sort();
    if (new Set(users).size !== 2) fail(`accounts collided: ${users.join(', ')}`);
    console.log(`PASS: two distinct bots INGAME on live rs2b2t via the wall — ${users.join(', ')}`);
    console.log('\nPASS — the multi-bot wall runs on the live server through the relay.');
} finally {
    await app.close();
}
