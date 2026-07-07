// Diagnostic probe for "Error connecting to server" reports: opens the REAL
// wall (Electron) against the relay, adds ONE bot with dummy credentials, and
// reports the title-screen login message after the attempt.
//   healthy path  -> 'Invalid username or password.' (server processed login)
//   broken path   -> 'Error connecting to server.'   (socket failed/closed)
//
//   1) relay up: bun tools/rs2b2t-relay.ts   (or use tools/wall-rs2b2t.sh)
//   2) bun tools/wall-login-probe.ts
import { _electron as electron } from 'playwright-core';

const relay = process.env.RELAY_URL ?? 'http://localhost:8899';

const app = await electron.launch({
    args: ['desktop/main.cjs', `--server=${relay}/multibox.html?nodeid=1`],
    executablePath: 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
});

try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => Boolean((globalThis as Record<string, unknown>).multibox), undefined, { timeout: 30000 });
    console.log('wall booted; adding one bot with dummy creds…');

    await page.evaluate(() => {
        (globalThis as never as { multibox: { add(a: { username: string; password: string }): unknown } }).multibox.add({ username: 'lcbuddyprobe1', password: 'notarealpass1' });
    });

    const frame = page.frames().find(f => f.url().includes('bot.html')) ?? (await page.waitForTimeout(3000), page.frames().find(f => f.url().includes('bot.html')));
    if (!frame) throw new Error('bot iframe never appeared');

    // poll the title-screen message until the login attempt resolves
    interface Lcb { client: { loginMes1: string; loginMes2: string; ingame: boolean } }
    const deadline = Date.now() + 60000;
    let last = '';
    while (Date.now() < deadline) {
        const state = await frame.evaluate(() => {
            const l = (globalThis as never as { lcbuddy?: Lcb }).lcbuddy;
            if (!l) return null;
            return { mes1: l.client.loginMes1, mes2: l.client.loginMes2 };
        });
        const cur = state ? `${state.mes1} | ${state.mes2}` : '(booting)';
        if (cur !== last) {
            console.log(`[title] ${cur}`);
            last = cur;
        }
        if (state && /Invalid username|Error connecting|attempts exceeded|Unexpected/i.test(`${state.mes1} ${state.mes2}`)) {
            console.log(`\nRESULT: ${state.mes1} ${state.mes2}`.trim());
            break;
        }
        await new Promise(r => setTimeout(r, 500));
    }
} finally {
    await app.close();
}
