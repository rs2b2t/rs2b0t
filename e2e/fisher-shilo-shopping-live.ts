import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import type { Browser, Page } from 'playwright-core';
import { launchBrowser } from './lib/harness.js';
import { mainlandAccount, startScript } from './tutorial/harness.js';
import { assess, count, type Scenario } from './fisher-shilo/contracts.js';
import { isolatedDeployment } from './fisher-shilo/deploy.js';
import { FUNDING, MINIMUM_TRIP_FUNDING, SHOP_METADATA, seedFixture } from './fisher-shilo/fixture.js';
import { options } from './fisher-shilo/options.js';
import { installTrace, readTrace } from './fisher-shilo/trace.js';
import { cadence } from './fisher-shilo/cadence.js';
import { cleanLogout } from './fisher-shilo/cleanup.js';

async function main(): Promise<void> {
    const args = options(process.argv.slice(2));
    const tag = `fs-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
    const directory = `out/e2e/${tag}`;
    await mkdir(directory, { recursive: true });
    let deployment: ReturnType<typeof isolatedDeployment> | undefined;
    let browser: Browser | undefined;
    let failure: string | undefined;
    let speedChanged = false;
    const runs: unknown[] = [];
    try {
        if (args.deploy) deployment = isolatedDeployment(tag);
        browser = await launchBrowser();
        const scenarios: readonly Scenario[] = args.scenario === 'all' ? ['full', 'empty'] : [args.scenario];
        for (const scenario of scenarios) {
            const username = `fs${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
            console.log(`Fisher ${scenario}: username=${username} base=${args.base}`);
            let page: Page | undefined;
            let outcome: unknown = { status: 'incomplete' };
            const errors: string[] = [];
            let loggedOut = false;
            let startIndex = 0;
            let timing: Awaited<ReturnType<typeof cadence>> | undefined;
            let cleanup: Awaited<ReturnType<typeof cleanLogout>> | undefined;
            let trace: Awaited<ReturnType<typeof readTrace>> = { events: [], intervals: [] };
            try {
                page = await browser.newPage();
                page.on('pageerror', error => errors.push(error.message));
                await mainlandAccount(page, args.base, username, deployment?.page ?? process.env.E2E_CLIENT_PAGE ?? '/bot.html');
                timing = await cadence(page, args.setTick200);
                speedChanged ||= timing.changed;
                if (args.tick200 || args.setTick200) assert(timing.after >= 150 && timing.after <= 250, '200ms cadence required before starting');
                await installTrace(page);
                await seedFixture(page, scenario, username);
                startIndex = Math.max(0, (await readTrace(page)).events.length - 1);
                await startScript(page, 'Fisher');
                const deadline = Date.now() + args.minutes * 60000;
                while (Date.now() < deadline) {
                    trace = await readTrace(page, startIndex);
                    const firstShop = trace.events.find(event => event.kind === 'shop-before');
                    if (firstShop) assert(count(firstShop.inventory, 'Coins') >= MINIMUM_TRIP_FUNDING,
                        'coin funding before first shop must include both shelves, not just feathers');
                    const result = assess(trace.events, scenario);
                    if (result.status === 'pass') {
                        outcome = result;
                        break;
                    }
                    await page.waitForTimeout(200);
                }
                assert.equal(assess(trace.events, scenario).status, 'pass', 'shopping outcome deadline exceeded');
                const intervals = trace.intervals.slice(1).sort((a, b) => a - b);
                const median = intervals[Math.floor(intervals.length / 2)];
                console.log(`observed server tick median=${median ?? 'unavailable'}ms; speedChanged=${speedChanged}`);
                if (args.tick200 || args.setTick200) assert(median !== undefined && median >= 150 && median <= 250,
                    '--tick200 requires an already configured 200ms engine');
                assert.deepEqual(errors, [], 'browser runtime errors');
            } catch (error) {
                outcome = { status: 'fail', error: error instanceof Error ? error.message : String(error) };
                throw error;
            } finally {
                try {
                    if (page) {
                        await page.evaluate(() => globalThis.rs2b0t?.runner.stop('Fisher harness teardown'));
                        trace = await readTrace(page, startIndex);
                        await page.evaluate(() => globalThis.__fisherShoppingTrace?.restore());
                        await page.screenshot({ path: `${directory}/${scenario}.png` });
                    }
                } finally {
                    try {
                        if (page) {
                            cleanup = await cleanLogout(page);
                            loggedOut = cleanup.loggedOut;
                            assert(loggedOut, `logout not verified for ${username}`);
                        }
                    } finally {
                        runs.push({ scenario, username, outcome, loggedOut, errors, timing, cleanup, trace });
                        await page?.close();
                    }
                }
            }
        }
    } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        throw error;
    } finally {
        try {
            await writeFile(`${directory}/evidence.json`, JSON.stringify({
                args, funding: FUNDING, minimumTripFunding: MINIMUM_TRIP_FUNDING,
                shops: SHOP_METADATA, instrumentation: 'record-only Shop.open / Bank.close / frame / PLAYER_INFO listeners',
                status: failure === undefined ? 'pass' : 'fail', failure,
                speedChanged, runs
            }, null, 2));
        } finally {
            try { await browser?.close(); } finally { deployment?.cleanup(); }
        }
        console.log(`Fisher evidence: ${directory}/evidence.json`);
    }
}

if (import.meta.main) {
    main().catch(error => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
