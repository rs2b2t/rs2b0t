import { launchBrowser } from '../lib/harness.js';
import { bootAndLogin, cheatQuiet, getServerVarQuiet, relog, startScript } from './harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const TARGET = 360;
const DEADLINE_MS = 10 * 60_000;
const POLL_MS = 3000;

const ARRIVAL = { x: 3081, z: 9519 };
const TELE_CMD = 'tele 0,48,148,9,47';

const EXIT_GATE_X = 3094;

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

    const user = `mn${Date.now().toString(36).slice(-7)}`;
    await bootAndLogin(page, base, user);

    const fresh = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] fresh account '${user}': tutorial=${fresh} (server)`);
    if (fresh !== 0) {
        fail(`fresh account did not start at tutorial=0 (got ${fresh}) -- tutorial-varp assumption broken`);
    }

    await cheatQuiet(page, 'setvar tutorial 1');
    await cheatQuiet(page, 'setvar tutorial 260');
    const jumped = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] after setvar 1 -> 260: tutorial=${jumped} (server)`);
    if (jumped !== 260) {
        fail(`setvar jump to 260 did not stick (got ${jumped})`);
    }

    await cheatQuiet(page, 'give bronze_axe 1');
    await cheatQuiet(page, 'give net 1');
    await cheatQuiet(page, 'give bread 1');
    await cheatQuiet(page, 'advancestat firemaking 2');
    await cheatQuiet(page, 'advancestat cooking 2');
    console.log(`[${ts()}] faithful kit granted (axe/net/bread + firemaking/cooking xp)`);

    await relog(page, user);
    console.log(`[${ts()}] relog complete`);

    await cheatQuiet(page, TELE_CMD);
    await page.waitForTimeout(1000);
    const tile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`[${ts()}] teleported: tile=${JSON.stringify(tile)}`);
    if (!tile || tile.x !== ARRIVAL.x || tile.z !== ARRIVAL.z) {
        fail(`tele into the mine did not land at (${ARRIVAL.x},${ARRIVAL.z}) (got ${JSON.stringify(tile)})`);
    }

    await startScript(page, 'TutorialBot');
    console.log(`[${ts()}] TutorialBot started`);

    const deadline = Date.now() + DEADLINE_MS;
    let v = 260;
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
    console.log(`[${ts()}] post-gate tile: ${JSON.stringify(exitTile)}`);
    if (!exitTile || exitTile.x <= EXIT_GATE_X) {
        fail(`tutorial reached ${v} but the client tile doesn't show the expected exit-gate crossing (got ${JSON.stringify(exitTile)})`);
    }

    console.log(`PASS: TutorialBot drove a jump-started account 260 -> ${v} unattended, exit-gate crossing confirmed (${JSON.stringify(exitTile)})`);
} finally {
    await browser.close();
}
