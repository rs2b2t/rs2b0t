// PLAN A EXIT CRITERION: a fresh account completes Tutorial Island 0 -> 1000
// and lands in Lumbridge, UNATTENDED, with no cheats used by the bot — the
// test only READS server truth via the ::getvar chat echo (and asserts the
// client tile at the end).
//
// Logs every distinct tutorial value with a timestamp: a stalled run's last
// line names the broken stage via the ladder table.
// Expected wall-clock ~12-20 min (survival ~1.5m, chef ~2.5m, quest guide
// ~1.5m, mine ~3m, combat ~5m incl. two kill waits, bank+chapel ~2m, magic
// ~1.5m, plus dialogue/walking overhead).
//
// Usage: bun tools/tutorial/full-run-test.ts [base-url]
// Plan A requires 3/3 PASSes (fresh account each run by construction).

import { launchBrowser } from '../lib/harness.js';
import { bootAndLogin, getServerVarQuiet, startScript } from './harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const TARGET = 1000;
const DEADLINE_MS = 45 * 60_000;
const POLL_MS = 5000;

/** Mainland proof: west Lumbridge is x > 3190; the island tops out ~3155. */
const MAINLAND_X = 3190;

type Rs2b0t = {
    rs2b0t: {
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        runner: { ctx: { state?: string; crashError?: unknown; loopCount?: number; log?: unknown[] } | null };
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

    const user = `fu${Date.now().toString(36).slice(-7)}`;
    await bootAndLogin(page, base, user);
    console.log(`[${ts()}] fresh account '${user}' logged in`);

    await startScript(page, 'TutorialBot');
    const started = Date.now();
    console.log(`[${ts()}] TutorialBot started — full unattended run begins`);

    const deadline = started + DEADLINE_MS;
    let v = 0;
    let lastLogged = -1;
    while (Date.now() < deadline) {
        const next = await getServerVarQuiet(page, 'tutorial');
        if (next !== null) {
            v = next;
        }
        if (v !== lastLogged) {
            console.log(`[${ts()}] tutorial=${v} (+${Math.round((Date.now() - started) / 1000)}s)`);
            lastLogged = v;
        }
        if (v >= TARGET) {
            break;
        }
        await new Promise(r => setTimeout(r, POLL_MS));
    }

    const elapsed = Math.round((Date.now() - started) / 1000);
    console.log(`[${ts()}] final tutorial=${v} after ${elapsed}s -- ${v >= TARGET ? 'PASS' : 'FAIL'}`);
    if (v < TARGET) {
        // Name the failure before dying: a crashed script (ScriptRunner
        // catches and stops) is indistinguishable from a stage stall by the
        // varp alone — the Task 9 debug-handle note.
        const ctx = await page
            .evaluate(() => {
                const c = (globalThis as never as Rs2b0t).rs2b0t.runner.ctx;
                return c ? { state: c.state, crashError: String(c.crashError ?? ''), loopCount: c.loopCount, logTail: (c.log ?? []).slice(-10) } : null;
            })
            .catch(e => `ctx unreadable: ${e}`);
        console.error(`runner ctx at stall: ${JSON.stringify(ctx, null, 1)}`);
        fail(`stalled at tutorial=${v} (wanted >= ${TARGET}) -- the ladder table names the stage`);
    }

    await page.waitForTimeout(1500);
    const tile = await page.evaluate(() => (globalThis as never as Rs2b0t).rs2b0t.reader.worldTile());
    console.log(`[${ts()}] post-teleport tile: ${JSON.stringify(tile)}`);
    if (!tile || tile.x <= MAINLAND_X) {
        fail(`tutorial reached ${v} but the client tile doesn't show Lumbridge (got ${JSON.stringify(tile)})`);
    }

    console.log(`PASS: fresh account 0 -> ${v} unattended in ${elapsed}s, no cheats, mainland confirmed (${JSON.stringify(tile)})`);
} finally {
    await browser.close();
}
