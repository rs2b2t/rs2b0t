// Task 7 integration test: a fresh account runs the REAL tutorial start (the
// design-accept and welcome-dialogue stages already exist from Tasks 3/4) and
// this task's survival section (Game.openSideTab, WelcomeScreen, TalkToGuide
// + the 10 Survival.ts stage tasks wired into TutorialBot.onStart), asserting
// the server ladder reaches stage 130 with NO cheats
// FROM THE BOT -- TutorialBot drives 0 -> 130 unattended on observable state
// only (ADR-0007).
//
// Progress is polled via ::getvar (server-authoritative game-chat echo), not
// reader.varp(281) -- see ADR-0007 and tools/tutorial/harness.ts's
// getServerVar() doc comment for why the client-side varp mirror can't be
// trusted for this. The poll uses harness.getServerVarQuiet() (direct
// CLIENT_CHEAT packet, Task 6 recipe) rather than the typed getServerVar():
// the typed path first CLICKS the canvas at a fixed pixel to focus it -- a
// real game click, i.e. a stray walk/interact injected into the bot's world
// on every poll while it's mid-stage -- and typed input is eaten while a
// chat dialog is open.
//
// Every DISTINCT value seen is logged with a timestamp, so a stalled run's
// last line names the broken stage via the ladder table.
//
// Usage: bun tools/tutorial/survival-test.ts [base-url]

import { chromium } from 'playwright-core';
import { bootAndLogin, getServerVarQuiet, startScript } from './harness.js';

const base = process.argv[2] ?? 'http://localhost:8888';
const TARGET = 130;
const DEADLINE_MS = 10 * 60_000;
const POLL_MS = 5000;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

function ts(): string {
    return new Date().toISOString();
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    const user = `sur${Date.now().toString(36).slice(-7)}`;
    await bootAndLogin(page, base, user);

    const fresh = await getServerVarQuiet(page, 'tutorial');
    console.log(`[${ts()}] fresh account '${user}': tutorial=${fresh} (server)`);
    if (fresh !== 0) {
        fail(`fresh account did not start at tutorial=0 (got ${fresh}) -- tutorial-varp assumption broken`);
    }

    await startScript(page, 'TutorialBot');
    console.log(`[${ts()}] TutorialBot started`);

    const deadline = Date.now() + DEADLINE_MS;
    let v = 0;
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

    console.log(`PASS: TutorialBot drove a fresh account 0 -> ${v} unattended (no cheats)`);
} finally {
    await browser.close();
}
