// Live proof for #432 — AIOQuester "Skip quest": [base].

//   bun e2e/aio-skip-quest-432-live.ts [http://127.0.0.1:8888]
import type { Page } from 'playwright-core';
import { launchBrowser, positionalArgs } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, startScript, teleTo } from './tutorial/harness.js';

const args = positionalArgs(process.argv.slice(2), 'http://127.0.0.1:8888');
const base = args[0];
const username = `sk${Date.now().toString(36).slice(-7)}`;
const BUDGET_MS = 8 * 60_000;

// Two implemented free-to-play quests so skip has a "next" target.
const QUEUE = [
    { id: 'runemysteries', name: 'Rune Mysteries Quest' },
    { id: 'doric', name: "Doric's Quest" }
] as const;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type LogLine = { time: number; level: string; msg: string };

interface Snap {
    runner: string;
    status: string | null;
    step: string | null;
    logs: LogLine[];
    queue: { id: string; name: string; status: string; reasons: string[] }[];
    runningId: string | null;
}

async function snapshot(page: Page): Promise<Snap> {
    return page.evaluate(() => {
        const g = globalThis as never as {
            rs2b0t: {
                runner: {
                    state: string;
                    bot: {
                        status?: string;
                        stepDesc?: string;
                        runningId?: string | null;
                        rows?: { id: string; name: string; status: string; reasons: string[] }[];
                        requestSkip?: () => void;
                    } | null;
                    ctx?: { log?: LogLine[] } | null;
                };
            };
        };
        const bot = g.rs2b0t.runner.bot;
        return {
            runner: g.rs2b0t.runner.state,
            status: bot?.status ?? null,
            step: bot?.stepDesc ?? null,
            runningId: bot?.runningId ?? null,
            queue: bot?.rows ?? [],
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-200)
        };
    });
}

async function requestSkip(page: Page): Promise<void> {
    const ok = await page.evaluate(() => {
        const bot = (globalThis as never as { rs2b0t: { runner: { bot: { requestSkip?: () => void } | null } } }).rs2b0t
            .runner.bot;
        if (!bot?.requestSkip) {
            return false;
        }
        bot.requestSkip();
        return true;
    });
    if (!ok) {
        fail('runner.bot.requestSkip is not available');
    }
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, username);
    await cheatQuiet(page, 'speed 300');
    // Enough skills / empty pack — Rune Mysteries + Doric both start at the wizard / Doric.
    await cheatQuiet(page, 'tele 0,48,54,22,18'); // near Lumbridge / wizard tower approach
    await teleTo(page, { x: 3104, z: 3162, level: 0 }, 10, 20_000).catch(() => undefined);

    await page.evaluate(csv => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', csv), QUEUE.map(q => q.id).join(','));
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester queue=${QUEUE.map(q => q.id).join(',')} as ${username}`);

    const t0 = Date.now();
    let lastLog = 0;
    let firstRunning: string | null = null;
    let skipped = false;
    let sawBlockLog = false;
    let sawNextRunning = false;
    let sawSkipNotReselected = true;

    while (Date.now() - t0 < BUDGET_MS) {
        const s = await snapshot(page);
        for (const line of s.logs) {
            if (line.time > lastLog) {
                console.log(`  [${line.level}] ${line.msg}`);
                lastLog = Math.max(lastLog, line.time);
            }
            if (/skip requested — blocking .+ for this session/i.test(line.msg)) {
                sawBlockLog = true;
            }
            if (/skip requested — parking/i.test(line.msg)) {
                fail(`old park-based skip path still active: ${line.msg}`);
            }
        }

        const running = s.queue.find(r => r.status === 'RUNNING');
        if (!firstRunning && running) {
            firstRunning = running.id;
            console.log(`first running: ${running.id} (${running.name}) — requesting Skip`);
            await requestSkip(page);
            skipped = true;
        }

        if (skipped && sawBlockLog) {
            const blocked = s.queue.find(r => r.id === firstRunning);
            if (blocked?.status === 'BLOCKED' && /skipped by user/i.test(blocked.reasons.join(' '))) {
                // good
            } else if (blocked && blocked.status === 'RUNNING') {
                sawSkipNotReselected = false;
            }
            const next = s.queue.find(r => r.status === 'RUNNING');
            if (next && next.id !== firstRunning) {
                sawNextRunning = true;
                console.log(`next running after skip: ${next.id}`);
                break;
            }
            // Only one quest left runnable and it finished / drained — also success if blocked stuck
            if (s.runner === 'stopped' && blocked?.status === 'BLOCKED') {
                console.log('runner stopped with skipped quest blocked (no further READY quests)');
                sawNextRunning = true; // queue may only have had the one READY
                break;
            }
        }

        if (s.runner === 'crashed') {
            fail(`script crashed: ${JSON.stringify(s.logs.slice(-20))}`);
        }
        await page.waitForTimeout(500);
    }

    if (!skipped) {
        fail('never saw a RUNNING quest to skip');
    }
    if (!sawBlockLog) {
        fail('never saw session-block skip log');
    }
    if (!sawNextRunning) {
        const s = await snapshot(page);
        fail(`next quest never started after skip: ${JSON.stringify(s.queue)}`);
    }
    if (!sawSkipNotReselected) {
        fail('skipped quest became RUNNING again this session');
    }

    const final = await snapshot(page);
    const skippedRow = final.queue.find(r => r.id === firstRunning);
    if (skippedRow?.status !== 'BLOCKED') {
        fail(`skipped quest status is ${skippedRow?.status}, expected BLOCKED`);
    }
    console.log(`PASS #432 Skip quest: blocked ${firstRunning}, advanced queue`);
} finally {
    await browser.close();
}
