import { launchBrowser } from '../lib/harness.js';
import { bootAndLogin, cheatQuiet, getServerVarQuiet, relog, startScript } from './harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const TARGET = 610;
const DEADLINE_MS = 10 * 60_000;
const POLL_MS = 3000;

const LANDING = { x: 3111, z: 3125 };
const TELE_CMD = 'tele 0,48,48,39,53';

const EXIT_Z = 3102;

type Rs2b0t = {
    rs2b0t: {
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
};

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

function ts(): string {
    return new Date().toISOString();
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const user = `bk${Date.now().toString(36).slice(-7)}`;
    await bootAndLogin(page, base, user);

    const fresh = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] fresh account '${user}': tutorial=${fresh} (server)`);
    if (fresh !== 0) {
        fail(`fresh account did not start at tutorial=0 (got ${fresh}) -- tutorial-varp assumption broken`);
    }

    await cheatQuiet(page, 'setvar tutorial 1');
    await cheatQuiet(page, 'setvar tutorial 500');
    const jumped = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] after setvar 1 -> 500: tutorial=${jumped} (server)`);
    if (jumped !== 500) {
        fail(`setvar jump to 500 did not stick (got ${jumped})`);
    }

    await cheatQuiet(page, 'give bronze_axe 1');
    await cheatQuiet(page, 'give net 1');
    await cheatQuiet(page, 'give bread 1');
    await cheatQuiet(page, 'advancestat firemaking 2');
    await cheatQuiet(page, 'advancestat cooking 2');
    await cheatQuiet(page, 'advancestat mining 2');
    await cheatQuiet(page, 'advancestat ranged 2');
    console.log(`[${ts()}] faithful kit granted (axe/net/bread + firemaking/cooking/mining/ranged xp)`);

    await relog(page, user);
    console.log(`[${ts()}] relog complete`);

    await cheatQuiet(page, TELE_CMD);
    await page.waitForTimeout(1000);
    const tile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`[${ts()}] teleported: tile=${JSON.stringify(tile)}`);
    if (!tile || tile.x !== LANDING.x || tile.z !== LANDING.z) {
        fail(`tele to the ladder landing did not land at (${LANDING.x},${LANDING.z}) (got ${JSON.stringify(tile)})`);
    }

    await startScript(page, 'TutorialBot');
    console.log(`[${ts()}] TutorialBot started`);

    const deadline = Date.now() + DEADLINE_MS;
    let v = 500;
    let lastLogged = -1;
    while (Date.now() < deadline) {
        const next = await getServerVarQuiet(page, 'tutorial');
        if (next !== null) {
            v = next;
        }
        if (v !== lastLogged) {
            console.log(`[${ts()}] tutorial=${v}`);
            lastLogged = v;
        }
        if (v >= TARGET) {
            break;
        }
        await new Promise(r => setTimeout(r, POLL_MS));
    }

    console.log(`[${ts()}] final tutorial=${v} -- ${v >= TARGET ? 'PASS' : 'FAIL'}`);
    if (v < TARGET) {
        fail(`stalled at tutorial=${v} (wanted >= ${TARGET}) -- check the ladder table for which stage this is`);
    }

    const exitTile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`[${ts()}] post-exit tile: ${JSON.stringify(exitTile)}`);
    if (!exitTile || exitTile.z > EXIT_Z) {
        fail(`tutorial reached ${v} but the client tile doesn't show the chapel-exit crossing (got ${JSON.stringify(exitTile)})`);
    }

    console.log(`PASS: TutorialBot drove a jump-started account 500 -> ${v} unattended, chapel-exit crossing confirmed (${JSON.stringify(exitTile)})`);
} finally {
    await browser.close();
}
