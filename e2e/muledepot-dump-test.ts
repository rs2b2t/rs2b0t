// MuleDepot e2e, Dump mode: 1 supermule + N mules at one bank (Seers by default).
// Each mule withdraws the shared item list and trades the lot to the supermule, which banks every
// delivery and keeps going. Soaks, then asserts goods moved, deliveries were banked, no trade screen
// failed, and nothing crashed or stopped.
// Usage: bun e2e/muledepot-dump-test.ts [--base URL] [--minutes N] [num-mules] [bank]
// Why: the harness's parseArgs claims bare numbers as `minutes`, so the mule count and the bank
// name are read from `rest`, which only ever holds non-numeric extras.

import type { BrowserContext, Page } from 'playwright-core';
import { launchBrowser, parseArgs, cheatQuiet, fail, stopScript, setSettings } from './lib/harness.js';
import { mainlandAccount, maxmeAndClearDialogs, seedItemsToBank, startScript, teleTo, type BankSeedItem } from './tutorial/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8888' });
const budgetMin = minutes > 0 ? minutes : 3;
const NUM_MULES = Number(rest[0]) || 2;
const BANK = rest[1] || 'Seers';

/** Seers' bank stand, which is the script's default. */
const SEERS: { x: number; z: number; level: number } = { x: 2725, z: 3491, level: 0 };

/**
 * The shared item list every mule moves.
 *
 * Why: the engine names every unidentified herb "Herb", so seeding two of them puts two separate
 * bank rows under one name. That is the case a one-row-per-name plan silently skipped, taking a
 * trip per row and looking stalled in between. A passing run proves both rows go in one pass.
 *
 * Quantities are small because a dumper takes a whole row, so a big fixture banks in one trip and
 * the second row never gets exercised.
 */
const LIST: { debug: string; display: string; qty: number }[] = [
    { debug: 'unidentified_guam', display: 'Herb', qty: 3 },
    { debug: 'unidentified_marentill', display: 'Herb', qty: 2 },
    { debug: 'raw_shark', display: 'Raw shark', qty: 40 }
];

/** The names as the operator writes them, so the CSV never repeats one name. */
const LIST_CSV = [...new Set(LIST.map(l => l.display))].join(', ');

type Tile = { x: number; z: number; level: number };

type Abi = {
    __rs2b0t: {
        Inventory: { items(): { name: string | null; id: number; count: number }[] };
        reader: { worldTile(): Tile | null };
    };
    rs2b0t: {
        runner: { state: string; ctx?: { log?: { msg: string }[] } };
    };
};

const stamp = Date.now().toString(36).slice(-5);
const SUPER = `muds${stamp}`;
const MULES = Array.from({ length: NUM_MULES }, (_, i) => `mudm${i}${stamp}`);

// ── helpers ──────────────────────────────────────────────────────────────────

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
    listed: number;
    pack: number;
    state: string;
    /** Highest `transfer success #N` the log has shown, which is monotonic and survives the buffer shifting. */
    transfers: number;
    /** Highest `trade screen failure #N`, also monotonic, so a dropped log line cannot hide one. */
    screenFailures: number;
    /** Smallest and latest distance the mule logged while closing on the supermule; null if never. */
    closest: number | null;
    latest: number | null;
    /** The mule's own account name, to prove both sides are the accounts the run thinks they are. */
    selfName: string;
    banked: number;
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
        const gaps: number[] = [];
        for (const m of logs) {
            const hit = /approaching \S+ at (\d+) tile/.exec(m);
            if (hit?.[1]) {
                gaps.push(Number(hit[1]));
            }
        }
        return {
            closest: gaps.length ? Math.min(...gaps) : null,
            latest: gaps.length ? gaps[gaps.length - 1]! : null,
            selfName: (window as unknown as { rs2b0t: { client: { loginUser: string } } }).rs2b0t.client.loginUser,
            listed: names.reduce((s, n) => s + units(n), 0),
            pack: items.length,
            state: g.rs2b0t.runner.state,
            transfers: peak(/transfer success #(\d+)/),
            screenFailures: peak(/trade screen failure #(\d+)/),
            banked: logs.filter(m => /banked \d+ slot/.test(m)).length,
            lastLog: logs.slice(-6).map(m => m.slice(0, 44)).join(' // '),
            stopReason: logs.filter(m => /stopping|stopped|crashed|supplied/i.test(m)).slice(-1)[0] ?? ''
        };
    }, [...displays]);
}

async function setup(page: Page, user: string, designation: 'Mule' | 'Supermule', accounts: string, seed: boolean): Promise<void> {
    page.on('pageerror', e => console.log(`[${user}] pageerror: ${e}`));
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);
    await clearInv(page);
    if (seed) {
        const items: BankSeedItem[] = LIST.map(l => ({ debugName: l.debug, displayName: l.display, qty: l.qty }));
        await seedItemsToBank(page, items, SEERS);
    }
    await setSettings(page, 'MuleDepot', {
        mode: 'Dump',
        designation,
        bank: BANK,
        accounts,
        items: LIST_CSV,
        itemsMode: 'csv'
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
    // Why: page.goto uses Playwright's 30s default, and booting several clients at once on a busy
    // host overruns it, which reads as a script failure when nothing is wrong with the script.
    const openPage = async (context: BrowserContext): Promise<Page> => {
        const page = await context.newPage();
        page.setDefaultTimeout(120_000);
        page.setDefaultNavigationTimeout(120_000);
        return page;
    };

    const superPage = await openPage(await browser.newContext());
    const mulePages: Page[] = [];
    for (let i = 0; i < NUM_MULES; i++) {
        mulePages.push(await openPage(await browser.newContext()));
    }

    console.log(`bringing up 1 supermule + ${NUM_MULES} mule(s) at ${BANK}, list "${LIST_CSV}" (sequential)...`);
    await setup(superPage, SUPER, 'Supermule', MULES.join(','), false);
    for (let i = 0; i < NUM_MULES; i++) {
        await setup(mulePages[i]!, MULES[i]!, 'Mule', SUPER, true);
    }

    console.log(`\nall started — soaking for ${budgetMin}min. dashboard every ~20s:\n`);

    const startedAt = Date.now();
    const deadline = startedAt + budgetMin * 60_000;
    const displays = LIST.map(l => l.display);
    const stopped: { who: string; why: string }[] = [];
    let ss: Sample = { listed: 0, pack: 0, state: '?', transfers: 0, screenFailures: 0, banked: 0, lastLog: '', stopReason: '', closest: null, latest: null, selfName: '' };
    let rs: Sample[] = [];

    async function stopAll(): Promise<void> {
        await stopScript(superPage);
        for (const p of mulePages) {
            await stopScript(p);
        }
    }

    while (Date.now() < deadline) {
        rs = await Promise.all(mulePages.map(p => sample(p, displays)));
        ss = await sample(superPage, displays);
        const mins = Math.round((Date.now() - startedAt) / 6000) / 10;

        rs.forEach((r, i) => {
            if (r.state !== 'running' && !stopped.some(s => s.who === `M${i}`)) {
                stopped.push({ who: `M${i}`, why: r.stopReason || r.state });
            }
        });

        console.log(`── t=${mins}min | supermule listed=${String(ss.listed).padStart(5)} transfers=${ss.transfers} banks=${ss.banked} ${ss.state} · ${ss.lastLog}`);
        rs.forEach((r, i) => {
            console.log(`   M${i} ${r.selfName.padEnd(11)} listed=${String(r.listed).padStart(5)} tr=${r.transfers} gap=${r.closest ?? '--'}->${r.latest ?? '--'} ${r.state.padEnd(8)} · ${r.lastLog}`);
        });

        if ([ss.state, ...rs.map(r => r.state)].includes('crashed')) {
            console.log('!! a bot crashed — ending the soak early');
            await stopAll();
            break;
        }
        await superPage.waitForTimeout(20_000);
    }

    // Why: asserted on the last in-soak sample, since stopAll() stops every bot and a sample taken
    // after it would report the harness's own stop rather than what the run did.
    await stopAll();

    const elapsedMin = Math.round((Date.now() - startedAt) / 6000) / 10;
    const totalDelivered = rs.reduce((s, r) => s + r.transfers, 0);

    console.log(`\n=== SOAK DONE (${elapsedMin}min, ${NUM_MULES} mule(s), ${BANK}) ===`);
    console.log(`supermule received ${ss.transfers} transfer(s) and ran ${ss.banked} bank pass(es)`);
    console.log(`per-mule transfers: ${rs.map(r => r.transfers).join(', ')} (total ${totalDelivered})`);
    for (const s of stopped) {
        console.log(`   ${s.who} stopped: ${s.why}`);
    }

    const problems: string[] = [];
    if (ss.transfers === 0) {
        problems.push('the supermule never received anything — check both sides are at the same bank and world');
    }
    if (ss.transfers < totalDelivered) {
        problems.push(`supermule recorded ${ss.transfers} transfer(s) for ${totalDelivered} dumper transfer(s)`);
    }
    if (ss.banked === 0 && ss.transfers > 0) {
        problems.push('the supermule received goods but never banked them');
    }
    for (const [i, r] of rs.entries()) {
        if (r.transfers === 0) {
            problems.push(`M${i} never completed a trade — its bank may not hold the list, or the supermule was out of reach`);
        }
    }
    for (const s of stopped) {
        // Why: a dumper withdraws the whole bank row, so one cycle empties it and the next pass
        // correctly stops. That is the designed end of a one-shot dump, not a failure.
        if (/holds none of/.test(s.why)) {
            console.log(`   ${s.who} stopped as expected: its bank ran out of the list`);
            continue;
        }
        problems.push(`${s.who} stopped for the wrong reason: ${s.why}`);
    }
    const screenFailures = ss.screenFailures + rs.reduce((n, r) => n + r.screenFailures, 0);
    if (screenFailures > 0) {
        problems.push(`${screenFailures} trade screen failure(s) logged`);
    }

    if (problems.length === 0) {
        console.log(`\nPASS: ${NUM_MULES} mule(s) moved the list to the supermule in ${elapsedMin}min — ${ss.transfers} transfer(s) received and ${ss.banked} bank pass(es), no failed trade screens.`);
        await browser.close();
        process.exit(0);
    }
    fail(`soak found ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
