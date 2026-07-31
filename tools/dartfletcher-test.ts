/**
 * Live DartFletcher throughput test against a local members engine.
 *
 *   bun tools/dartfletcher-test.ts --base http://localhost:19080 --minutes 3
 *
 * Reports wall-clock XP/hr and the tick-normalized 600ms-world projection. The
 * latter stays meaningful if somebody intentionally changes the dev tick speed.
 */
import type { Page } from 'playwright-core';
import { fail, launchBrowser, parseArgs } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, startScript } from './tutorial/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { base: 'http://localhost:19080', minutes: 3 });
const USER = process.env.USER_NAME || `df${Date.now().toString(36).slice(-7)}`;
const SUPPLY = Math.max(100_000, Math.ceil(minutes * 10_000));
const EXPECTED_XP_PER_DART = 18.8;
const NORMAL_TICKS_PER_HOUR = 6_000;

type Snapshot = {
    tick: number;
    level: number;
    xp: number;
    tips: number;
    feathers: number;
    darts: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
};

type Abi = {
    __rs2b0t: {
        Skills: { level(name: string): number; xp(name: string): number };
        Inventory: { count(name: string): number };
    };
    rs2b0t: {
        host: { tickCount: number };
        runner: {
            state: string;
            ctx?: { log?: { time: number; level: string; msg: string }[] } | null;
            stop(): void;
        };
    };
};

async function setTier(page: Page): Promise<void> {
    await page.evaluate(() => {
        sessionStorage.setItem('rs2b0t:set:DartFletcher:tier', 'Rune');
        localStorage.setItem('rs2b0t:set:DartFletcher:tier', 'Rune');
    });
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        return {
            tick: g.rs2b0t.host.tickCount,
            level: g.__rs2b0t.Skills.level('fletching'),
            xp: g.__rs2b0t.Skills.xp('fletching'),
            tips: g.__rs2b0t.Inventory.count('Rune dart tip'),
            feathers: g.__rs2b0t.Inventory.count('Feather'),
            darts: g.__rs2b0t.Inventory.count('Rune dart'),
            runner: g.rs2b0t.runner.state,
            logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-30)
        };
    });
}

async function seed(page: Page, command: string, prove: () => Promise<boolean>): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
        if (!(await cheatQuiet(page, command))) {
            continue;
        }
        if (await prove()) {
            return;
        }
    }
    fail(`could not seed with '${command}'`);
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', error => {
        pageErrors.push(error.message);
        console.log(`pageerror: ${error.message}`);
    });

    await mainlandAccount(page, base, USER);
    if (!(await cheatQuiet(page, '~clearinv'))) {
        fail('could not clear inventory');
    }
    await seed(page, 'setstat fletching 99', async () => (await snapshot(page)).level === 99);
    await seed(page, `give feather ${SUPPLY}`, async () => (await snapshot(page)).feathers >= SUPPLY);
    await seed(page, `give rune_dart_tip ${SUPPLY}`, async () => (await snapshot(page)).tips >= SUPPLY);
    await setTier(page);

    const before = await snapshot(page);
    console.log(
        `ready user=${USER} fletching=${before.level} tips=${before.tips} feathers=${before.feathers} ` +
        `base=${base}`
    );
    await startScript(page, 'DartFletcher');

    const firstProgressDeadline = Date.now() + 15_000;
    let activeStart: Snapshot | null = null;
    let activeStartedAt = 0;
    while (Date.now() < firstProgressDeadline) {
        const current = await snapshot(page);
        if (current.darts > before.darts && current.xp > before.xp) {
            activeStart = current;
            activeStartedAt = Date.now();
            break;
        }
        if (current.runner !== 'running') {
            fail(`DartFletcher stopped before making a dart: ${current.logs.map(line => line.msg).join(' | ')}`);
        }
        await page.waitForTimeout(250);
    }
    if (!activeStart) {
        fail('DartFletcher made no progress in 15 seconds');
    }

    console.log('started Rune darts — measuring sustained throughput');
    const deadline = activeStartedAt + minutes * 60_000;
    let last = activeStart;
    let lastLogTime = 0;
    while (Date.now() < deadline) {
        await page.waitForTimeout(Math.min(10_000, Math.max(250, deadline - Date.now())));
        last = await snapshot(page);
        const elapsedMs = Math.max(1, Date.now() - activeStartedAt);
        const xp = last.xp - activeStart.xp;
        const darts = last.darts - activeStart.darts;
        const ticks = last.tick - activeStart.tick;
        const wallXph = (xp / elapsedMs) * 3_600_000;
        const tickXph = (xp / Math.max(1, ticks)) * NORMAL_TICKS_PER_HOUR;
        console.log(
            `  t=${(elapsedMs / 1000).toFixed(0)}s ticks=${ticks} darts=+${darts} xp=+${xp} ` +
            `wall=${Math.round(wallXph).toLocaleString()} xp/hr normal-tick=${Math.round(tickXph).toLocaleString()} xp/hr`
        );
        for (const line of last.logs) {
            if (line.time > lastLogTime) {
                console.log(`      · [${line.level}] ${line.msg}`);
            }
        }
        if (last.logs.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...last.logs.map(line => line.time));
        }
        if (last.runner !== 'running') {
            fail(`DartFletcher stopped during the soak: ${last.logs.map(line => line.msg).join(' | ')}`);
        }
    }

    const elapsedMs = Math.max(1, Date.now() - activeStartedAt);
    const ticks = last.tick - activeStart.tick;
    const darts = last.darts - activeStart.darts;
    const xp = last.xp - activeStart.xp;
    const wallXph = (xp / elapsedMs) * 3_600_000;
    const tickXph = (xp / Math.max(1, ticks)) * NORMAL_TICKS_PER_HOUR;
    const dartsPerTick = darts / Math.max(1, ticks);
    const xpPerDart = xp / Math.max(1, darts);

    await page.screenshot({ path: 'out/dart-fletcher-e2e.png', fullPage: true });
    await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.stop());

    console.log(
        `RESULT ${darts} Rune darts / ${ticks} ticks / ${(elapsedMs / 1000).toFixed(1)}s; ` +
        `${dartsPerTick.toFixed(2)} darts/tick, ${xpPerDart.toFixed(2)} XP/dart, ` +
        `${Math.round(wallXph).toLocaleString()} wall XP/hr, ${Math.round(tickXph).toLocaleString()} XP/hr at 600ms ticks`
    );

    if (pageErrors.length > 0) {
        fail(`${pageErrors.length} browser page error(s)`);
    }
    if (dartsPerTick < 40) {
        fail(`throughput ${dartsPerTick.toFixed(2)} darts/tick is below four of five available actions`);
    }
    if (Math.abs(xpPerDart - EXPECTED_XP_PER_DART) > 0.1) {
        fail(`observed ${xpPerDart.toFixed(2)} XP/dart, expected ${EXPECTED_XP_PER_DART}`);
    }
    console.log('PASS');
} finally {
    await browser.close();
}
