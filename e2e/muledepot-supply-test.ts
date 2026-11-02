// MuleDepot e2e, Supply mode: 1 supplier + N clients at one bank (Seers by default).
// The supplier withdraws the loadout one batch at a time and hands each client the whole thing, once,
// then stops. The loadout here is deliberately wider than the batch width, so the pass proves
// multi-batch delivery rather than a single lucky trade.
// Usage: bun e2e/muledepot-supply-test.ts [--base URL] [--minutes N] [num-clients] [bank]
// Why: the harness's parseArgs claims bare numbers as `minutes`, so the client count and the bank
// name are read from `rest`, which only ever holds non-numeric extras.

import type { BrowserContext, Page } from 'playwright-core';
import { launchBrowser, parseArgs, cheatQuiet, fail, stopScript, setSettings } from './lib/harness.js';
import { mainlandAccount, maxmeAndClearDialogs, seedItemsToBank, startScript, teleTo, type BankSeedItem } from './tutorial/harness.js';

const { base, minutes, rest } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8888' });
const budgetMin = minutes > 0 ? minutes : 4;
const NUM_CLIENTS = Number(rest[0]) || 2;
const BANK = rest[1] || 'Seers';

/** Seers' bank stand, which is the script's default. */
const SEERS: { x: number; z: number; level: number } = { x: 2725, z: 3491, level: 0 };

/** Slots one trade may fill. Small on purpose, so a five-line loadout cannot fit in one batch. */
const TRADE_SLOTS = 3;

/**
 * The loadout, as `<quantity> <item name>`. All stackable, so each line really is one pack slot
 * and a line really is one trade slot, which is what the batch plan assumes.
 *
 * Why: no rune essence, because the seeder reaches the cheat channel and cert_blank_rune only
 * takes through the keyboard path, so a seeded essence is an item that never arrives.
 */
const LOADOUT: { debug: string; display: string; qty: number }[] = [
    { debug: 'cooked_meat', display: 'Cooked meat', qty: 400 },
    { debug: 'raw_shark', display: 'Raw shark', qty: 300 },
    { debug: 'trout', display: 'Trout', qty: 250 },
    { debug: 'yew_logs', display: 'Yew logs', qty: 150 },
    { debug: 'coins', display: 'Coins', qty: 4000 }
];

/** How many batches the plan above should produce, which the test asserts the run matches. */
const EXPECTED_BATCHES = Math.ceil(LOADOUT.length / TRADE_SLOTS);

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
const SUPPLIER = `musp${stamp}`;
const CLIENTS = Array.from({ length: NUM_CLIENTS }, (_, i) => `muc${i}${stamp}`);

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
    /** Highest `transfer success #N` in the log: monotonic, so it survives the log buffer shifting. */
    transfers: number;
    /** Highest `trade screen failure #N`, also monotonic, so a dropped log line cannot hide one. */
    screenFailures: number;
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
        return {
            listed: names.reduce((s, n) => s + units(n), 0),
            pack: items.length,
            state: g.rs2b0t.runner.state,
            transfers: peak(/transfer success #(\d+)/),
            screenFailures: peak(/trade screen failure #(\d+)/),
            banked: logs.filter(m => /banked \d+ slot/.test(m)).length,
            lastLog: logs.slice(-3).map(m => m.slice(0, 46)).join(' // '),
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
        // Why: one loadout per client. The supplier hands a whole loadout to each account, so a
        // single seeded loadout leaves it unable to serve anyone but the first.
        const items: BankSeedItem[] = LOADOUT.map(l => ({
            debugName: l.debug,
            displayName: l.display,
            qty: l.qty * NUM_CLIENTS
        }));
        await seedItemsToBank(page, items, SEERS);
    }
    await setSettings(page, 'MuleDepot', {
        mode: 'Supply',
        designation,
        bank: BANK,
        accounts,
        loadout: LOADOUT.map(l => `${l.qty} ${l.display}`).join(', '),
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
    // Why: page.goto uses Playwright's 30s default, and booting several clients at once on a busy
    // host overruns it, which reads as a script failure when nothing is wrong with the script.
    const openPage = async (context: BrowserContext): Promise<Page> => {
        const page = await context.newPage();
        page.setDefaultTimeout(120_000);
        page.setDefaultNavigationTimeout(120_000);
        return page;
    };

    const supPage = await openPage(await browser.newContext());
    const clientPages: Page[] = [];
    for (let i = 0; i < NUM_CLIENTS; i++) {
        clientPages.push(await openPage(await browser.newContext()));
    }

    const loadoutCsv = LOADOUT.map(l => `${l.qty} ${l.display}`).join(', ');
    console.log(`bringing up 1 supplier + ${NUM_CLIENTS} client(s) at ${BANK}`);
    console.log(`loadout "${loadoutCsv}" at ${TRADE_SLOTS} slots/trade = ${EXPECTED_BATCHES} batch(es) per client (sequential)...`);
    await setup(supPage, SUPPLIER, 'Supplier', CLIENTS.join(','), true);
    for (let i = 0; i < NUM_CLIENTS; i++) {
        await setup(clientPages[i]!, CLIENTS[i]!, 'Client', SUPPLIER, false);
    }

    console.log(`\nall started — soaking up to ${budgetMin}min, finishing early once everyone is served:\n`);

    const startedAt = Date.now();
    const deadline = startedAt + budgetMin * 60_000;
    const displays = LOADOUT.map(l => l.display);
    const stopped: { who: string; why: string }[] = [];
    let ss: Sample = { listed: 0, pack: 0, state: '?', transfers: 0, screenFailures: 0, banked: 0, lastLog: '', stopReason: '' };
    let cs: Sample[] = [];

    async function stopAll(): Promise<void> {
        await stopScript(supPage);
        for (const p of clientPages) {
            await stopScript(p);
        }
    }

    while (Date.now() < deadline) {
        ss = await sample(supPage, displays);
        cs = await Promise.all(clientPages.map(p => sample(p, displays)));
        const mins = Math.round((Date.now() - startedAt) / 6000) / 10;

        console.log(`── t=${mins}min | supplier listed=${String(ss.listed).padStart(5)} transfers=${ss.transfers} banks=${ss.banked} ${ss.state} · ${ss.lastLog}`);
        cs.forEach((r, i) => {
            console.log(`   C${i} listed=${String(r.listed).padStart(5)} received=${r.transfers} banks=${r.banked} ${r.state.padEnd(8)} · ${r.lastLog}`);
            // Why: a client has no reason to stop on its own, so one that does has given up early.
            if (r.state !== 'running' && r.state !== 'crashed' && !stopped.some(s => s.who === `C${i}`)) {
                stopped.push({ who: `C${i}`, why: r.stopReason || r.state });
            }
        });

        if ([ss.state, ...cs.map(r => r.state)].includes('crashed')) {
            console.log('!! a bot crashed — ending the run early');
            await stopAll();
            break;
        }
        // The supplier stops itself once every client has the whole loadout, which is the pass.
        if (ss.state !== 'running') {
            console.log('supplier finished — ending the run');
            break;
        }
        await supPage.waitForTimeout(20_000);
    }

    // Why: asserted on the last in-run sample, since stopAll() stops every bot and a sample taken
    // after it would report the harness's own stop rather than what the run did.
    await stopAll();

    const elapsedMin = Math.round((Date.now() - startedAt) / 6000) / 10;

    console.log(`\n=== SUPPLY DONE (${elapsedMin}min, ${NUM_CLIENTS} client(s), ${BANK}) ===`);
    console.log('supplier log tail:');
    for (const line of await tail(supPage)) {
        console.log(`   S | ${line.slice(0, 96)}`);
    }
    for (const [i, p] of clientPages.entries()) {
        console.log(`client ${i} log tail:`);
        for (const line of await tail(p, 10)) {
            console.log(`   C${i} | ${line.slice(0, 96)}`);
        }
    }
    console.log(`supplier: ${ss.transfers} transfer(s), ${ss.banked} bank pass(es), state ${ss.state}`);
    console.log(`   stop reason: ${ss.stopReason || '(none logged)'}`);
    cs.forEach((r, i) => console.log(`   C${i}: received ${r.transfers} batch(es), ${r.banked} bank pass(es), state ${r.state}`));
    for (const s of stopped) {
        console.log(`   ${s.who} stopped: ${s.why}`);
    }

    const wantBatches = EXPECTED_BATCHES * NUM_CLIENTS;
    const problems: string[] = [];
    if (ss.transfers < wantBatches) {
        problems.push(`supplier completed ${ss.transfers} transfer(s), expected ${wantBatches} (${EXPECTED_BATCHES} batch(es) x ${NUM_CLIENTS} client(s))`);
    }
    if (ss.state === 'crashed') {
        problems.push('the supplier crashed');
    }
    if (ss.state === 'running') {
        problems.push(`the supplier never finished: still serving after ${elapsedMin}min, ${ss.transfers}/${wantBatches} transfer(s)`);
    }
    for (const [i, r] of cs.entries()) {
        if (r.transfers < EXPECTED_BATCHES) {
            problems.push(`C${i} received ${r.transfers} batch(es), expected ${EXPECTED_BATCHES}`);
        }
        if (r.state === 'crashed') {
            problems.push(`C${i} crashed`);
        }
    }
    for (const s of stopped) {
        problems.push(`${s.who} stopped mid-run: ${s.why}`);
    }
    const screenFailures = ss.screenFailures + cs.reduce((n, r) => n + r.screenFailures, 0);
    if (screenFailures > 0) {
        problems.push(`${screenFailures} trade screen failure(s) logged`);
    }

    if (problems.length === 0) {
        console.log(`\nPASS: 1 supplier handed ${EXPECTED_BATCHES} batch(es) to each of ${NUM_CLIENTS} client(s) at ${BANK} in ${elapsedMin}min — ${ss.transfers} transfer(s), supplier stopped on its own, no crashes.`);
        await browser.close();
        process.exit(0);
    }
    fail(`supply run found ${problems.length} problem(s):\n  - ${problems.join('\n  - ')}`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
