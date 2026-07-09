// Live smoke test for the rs2b2t relay: proves a LOCALLY-served client reaches
// the LIVE rs2b2t world through the relay. Launches the Electron shell against
// the relay, injects credentials + arms auto-login (the same path the wall
// uses), asserts ingame on the live server, and prints the player's position.
//
//   1) start the relay:  bun tools/rs2b2t-relay.ts
//   2) run (Node, not Bun — Playwright's Electron launcher needs Node):
//      npx tsx tools/relay-test.ts <user> <pass>
import { _electron as electron } from 'playwright-core';

const relay = process.env.RELAY_URL ?? 'http://localhost:8899';
const username = process.argv[2] ?? 'botfarm1';
const password = process.argv[3] ?? 'botfarm2026';

function fail(m: string): never {
    console.error(`FAIL: ${m}`);
    process.exit(1);
}

type Rs2b0t = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; constructor: { loopCycle: number } };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        setCredentials(u: string, p: string): void;
        setAutoLogin(on: boolean): void;
    };
};

const app = await electron.launch({
    args: ['desktop/main.cjs', `--server=${relay}/bot.html?nodeid=1&inputmode=synthetic`],
    executablePath: 'desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
});

try {
    const page = await app.firstWindow();

    await page
        .waitForFunction(() => ((globalThis as never as Rs2b0t).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 })
        .catch(() => fail('client never started through the relay'));
    console.log('client running through the relay; loading rs2b2t cache…');

    // Inject creds + arm auto-login. The bot's AutoRelogin logs in once the
    // title screen is ready (survives the slow first-load), which is exactly
    // how the wall logs each bot in.
    await page.evaluate(([u, p]) => {
        const l = (globalThis as never as Rs2b0t).rs2b0t;
        l.setCredentials(u, p);
        l.setAutoLogin(true);
    }, [username, password]);

    const ingame = await page
        .waitForFunction(() => (globalThis as never as Rs2b0t).rs2b0t.client.ingame && (globalThis as never as Rs2b0t).rs2b0t.client.sceneState === 2, undefined, { timeout: 120000 })
        .then(() => true)
        .catch(() => false);
    if (!ingame) fail(`'${username}' did not reach ingame on live rs2b2t within the timeout`);

    const pos = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`PASS: '${username}' is INGAME on live rs2b2t at world (${pos?.x}, ${pos?.z}, level ${pos?.level})`);
    console.log('\nPASS — the relay bridges a local client to the live rs2b2t server.');
} finally {
    await app.close();
}
