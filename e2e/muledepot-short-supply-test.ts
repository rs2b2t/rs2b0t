// MuleDepot e2e, the partial-supply guard: the loadout asks for two items, the bank holds one.
// The supplier must still hand the available line to the client, then name the missing line as short
// instead of reporting a complete supply. That is the failure in review on PR #878.
// Usage: bun e2e/muledepot-short-supply-test.ts [--base URL] [--minutes N] [bank]

import type { BrowserContext, Page } from 'playwright-core';
import { launchBrowser, parseArgs, cheatQuiet, fail, stopScript, setSettings } from './lib/harness.js';
import { mainlandAccount, maxmeAndClearDialogs, seedItemsToBank, startScript, teleTo, type BankSeedItem } from './tutorial/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8888' });
const budgetMin = minutes > 0 ? minutes : 4;
const BANK = rest[0] || 'Seers';

/** Seers' bank stand, which is the script's default. */
const SEERS: { x: number; z: number; level: number } = { x: 2725, z: 3491, level: 0 };

/** Two stackable lines fit in one trade, so this is exactly one batch. */
const TRADE_SLOTS = 2;

/**
 * The loadout asks for Air and Mind, but only Air is seeded. Mind is the line the supplier must give
 * up on and report, never one it can deliver.
 */
const AIR = { debug: 'airrune', display: 'Air rune', qty: 100 };
const MIND = { debug: 'mindrune', display: 'Mind rune', qty: 100 };


type Abi = {
    __rs2b0t: {
        Inventory: { items(): { name: string | null; id: number; count: number }[] };
    };
    rs2b0t: {
        runner: { state: string; ctx?: { log?: { msg: string }[] } };
    };
};

const stamp = Date.now().toString(36).slice(-5);
const SUPPLIER = `mush${stamp}`;
const CLIENT = `mucs${stamp}`;

async function clearInv(page: Page): Promise<void> {
    for (let i = 0; i < 6; i++) {
        if (!(await cheatQuiet(page, '~clearinv'))) {
            return;
        }
        await page.waitForTimeout(700);
        const held = await page.evaluate(() =>
            (globalThis as never as Abi).__rs2b0t.Inventory.items().filter(i => i.name).length
        );
        if (held === 0) {
            return;
        }
    }
}

interface Sample {
    state: string;
    transfers: number;
    screenFailures: number;
    listed: number;
    lastLog: string;
    stopReason: string;
}

function sample(page: Page, displays: readonly string[]): Promise<Sample> {
    return page.evaluate(names => {
        const g = globalThis as never as Abi;
        const items = g.__rs2b0t.Inventory.items();
        const logs = (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg);
        const units = (wanted: string): number =>
            items.filter(i => (i.name ?? '').toLowerCase() === wanted.toLowerCase())
                .reduce((s, i) => s + Math.max(1, i.count), 0);
        const peak = (re: RegExp): number => {
            let top = 0;
            for (const m of logs) {
                const hit = re.exec(m);
                if (hit?.[1]) {
                    top = Math.max(top, Number(hit[1]));
                }
            }
            return top;
        };
        return {
            state: g.rs2b0t.runner.state,
            transfers: peak(/transfer success #(\d+)/),
            screenFailures: peak(/trade screen failure #(\d+)/),
            listed: names.reduce((s, n) => s + units(n), 0),
            lastLog: logs.slice(-3).map(m => m.slice(0, 60)).join(' // '),
            stopReason: logs.filter(m => /Stopping\.|crashed|supplied \d+ batch/i.test(m)).slice(-1)[0] ?? ''
        };
    }, [...displays]);
}

/** The last N script log lines, for when the dashboard truncation hides the sequence. */
function tail(page: Page, n = 25): Promise<string[]> {
    return page.evaluate(k => ((globalThis as never as Abi).rs2b0t.runner.ctx?.log ?? [])
        .slice(-k)
        .map(l => l.msg), n);
}

async function setup(page: Page, user: string, designation: 'Supplier' | 'Client', accounts: string, seed: boolean): Promise<void> {
    page.on('pageerror', e => console.log(`[${user}] pageerror: ${e}`));
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);
    await clearInv(page);
    if (seed) {
        // Only Air is seeded. Mind is deliberately absent, which is the review's repro.
        const items: BankSeedItem[] = [{ debugName: AIR.debug, displayName: AIR.display, qty: AIR.qty }];
        await seedItemsToBank(page, items, SEERS);
    }
    await setSettings(page, 'MuleDepot', {
        mode: 'Supply',
        designation,
        bank: BANK,
        accounts,
        loadout: `${AIR.qty} ${AIR.display}, ${MIND.qty} ${MIND.display}`,
        loadoutMode: 'csv',
        tradeSlots: TRADE_SLOTS
    });
    if (!(await teleTo(page, SEERS, 8, 30_000))) {
        fail(`${user}: could not reach ${BANK}`);
    }
    await page.waitForTimeout(1200);
    await startScript(page, 'MuleDepot');
    console.log(`  ${user} (${designation}) ready`);
}

// ── main ─────────────────────────────────────────────────────────────────────

const browser = await launchBrowser();
try {
    const openPage = async (context: BrowserContext): Promise<Page> => {
        const page = await context.newPage();
        page.setDefaultTimeout(120_000);
        page.setDefaultNavigationTimeout(120_000);
        return page;
    };

    const supPage = await openPage(await browser.newContext());
    const cliPage = await openPage(await browser.newContext());

    console.log(`bringing up 1 supplier + 1 client at ${BANK}`);
    console.log(`loadout "${AIR.qty} ${AIR.display}, ${MIND.qty} ${MIND.display}"; bank seeded with ${AIR.qty} ${AIR.display} and no ${MIND.display}`);
    await setup(supPage, SUPPLIER, 'Supplier', CLIENT, true);
    await setup(cliPage, CLIENT, 'Client', SUPPLIER, false);

    const startedAt = Date.now();
    const deadline = startedAt + budgetMin * 60_000;
    const displays = [AIR.display, MIND.display];
    let ss: Sample = { state: '?', transfers: 0, screenFailures: 0, listed: 0, lastLog: '', stopReason: '' };
    let cs: Sample = ss;

    while (Date.now() < deadline) {
        ss = await sample(supPage, displays);
        cs = await sample(cliPage, displays);
        const mins = Math.round((Date.now() - startedAt) / 6000) / 10;
        console.log(`── t=${mins}min | supplier listed=${ss.listed} transfers=${ss.transfers} ${ss.state} · ${ss.lastLog}`);
        console.log(`   client   listed=${cs.listed} received=${cs.transfers} ${cs.state} · ${cs.lastLog}`);

        if (ss.state === 'crashed' || cs.state === 'crashed') {
            console.log('!! a bot crashed — ending the run early');
            break;
        }
        if (ss.state !== 'running') {
            console.log('supplier finished — ending the run');
            break;
        }
        await supPage.waitForTimeout(5_000);
    }

    // Sample before stopping, so the harness's own stop never reads as the script's result.
    await stopScript(supPage);
    await stopScript(cliPage);

    console.log('\nsupplier log tail:');
    for (const line of await tail(supPage)) {
        console.log(`   S | ${line.slice(0, 100)}`);
    }
    console.log('client log tail:');
    for (const line of await tail(cliPage, 10)) {
        console.log(`   C | ${line.slice(0, 100)}`);
    }
    console.log(`\nsupplier: ${ss.transfers} transfer(s), state ${ss.state}`);
    console.log(`   stop reason: ${ss.stopReason || '(none logged)'}`);
    console.log(`client: received ${cs.transfers} transfer(s), state ${cs.state}`);

    const problems: string[] = [];
    if (ss.state === 'running') {
        problems.push(`the supplier never finished within ${budgetMin}min`);
    }
    if (ss.state === 'crashed') {
        problems.push('the supplier crashed');
    }
    if (ss.transfers < 1) {
        problems.push(`the supplier delivered ${ss.transfers} transfer(s), expected the available 1`);
    }
    if (cs.transfers < 1) {
        problems.push(`the client received ${cs.transfers} transfer(s), expected the available 1`);
    }
    // The available line must still be delivered; the client banks it on its own schedule, so its
    // pack may already be empty by the time the supplier stops.
    if (cs.listed > AIR.qty) {
        problems.push(`the client holds ${cs.listed} listed unit(s), more than the ${AIR.qty} supplied`);
    }
    // The missing line must be acknowledged, not folded into a clean success.
    if (!ss.stopReason.includes('short:')) {
        problems.push(`the supplier did not report a shortfall: "${ss.stopReason || '(none)'}"`);
    }
    if (!ss.stopReason.includes(MIND.display)) {
        problems.push(`the shortfall does not name ${MIND.display}: "${ss.stopReason || '(none)'}"`);
    }
    if (ss.stopReason.includes(`supplied 1 batch(es) to 1 account(s), ${AIR.qty} item(s) moved`)
        && !ss.stopReason.includes('short:')) {
        problems.push('the supplier reported a clean supply with the missing line undelivered');
    }
    if (ss.screenFailures > 0) {
        problems.push(`${ss.screenFailures} trade screen failure(s) logged`);
    }

    if (problems.length === 0) {
        console.log(`\nPASS: supplier delivered ${AIR.display} and reported ${MIND.display} short, never a clean supply.`);
        await browser.close();
        process.exit(0);
    }
    fail(`short-supply run found ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
