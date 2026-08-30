/** Live BankSorter harness: proves the cold sort and the incremental re-sort against a real bank.
 *  Why: base :8890, because :8888 has no `bankitem` debugproc and the seed silently banks nothing.
 *  Why: `~bankitem` ADDS rather than sets, so every run wipes with `~clearbank` before seeding. */

//   HEADED=1 bun e2e/banksorter-live.ts --tick 200
import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser, parseArgs } from './lib/harness.js';
import {
    cheatQuiet,
    mainlandAccount,
    seedItemsToBank,
    startScript,
    teleTo,
    type BankSeedItem
} from './tutorial/harness.js';
import { CATEGORY_ORDER, categoryOf } from '../src/bot/api/bank/bankSortRules.js';

const VARROCK_WEST_BANK = { x: 3185, z: 3440, level: 0 };
const COINS = 995;
const BANK_INSERT_VARP = 304;

interface BankedRow {
    slot: number;
    id: number;
    name: string | null;
    cost: number;
}

const COLD_SEED: BankSeedItem[] = [
    { debugName: 'bones', displayName: 'Bones', qty: 20 },
    { debugName: 'shark', displayName: 'Shark', qty: 30 },
    { debugName: 'rune_scimitar', displayName: 'Rune scimitar', qty: 1 },
    { debugName: 'iron_ore', displayName: 'Iron ore', qty: 50 },
    { debugName: 'coins', displayName: 'Coins', qty: 500_000 },
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'lawrune', displayName: 'Law rune', qty: 200 },
    { debugName: 'logs', displayName: 'Logs', qty: 100 },
    { debugName: 'feather', displayName: 'Feather', qty: 500 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

const TOPUP_SEED: BankSeedItem[] = [
    { debugName: 'airrune', displayName: 'Air rune', qty: 300 },
    { debugName: 'bronze_arrow', displayName: 'Bronze arrow', qty: 150 },
    { debugName: 'tinderbox', displayName: 'Tinderbox', qty: 1 }
];

function assertSorted(rows: readonly BankedRow[], seeded: readonly string[]): void {
    if (rows.length === 0) {
        throw new Error('bank read back empty');
    }
    if (rows[0].id !== COINS) {
        throw new Error(`slot 0 holds ${rows[0].name} (${rows[0].id}), wanted Coins (${COINS})`);
    }

    let previous = -1;
    let previousName = '';
    for (const row of rows) {
        const rank = CATEGORY_ORDER.indexOf(categoryOf(row));
        if (rank < previous) {
            throw new Error(
                `slot ${row.slot} "${row.name}" is ${CATEGORY_ORDER[rank]} after "${previousName}" (${CATEGORY_ORDER[previous]})`
            );
        }
        previous = rank;
        previousName = row.name ?? '?';
    }

    const got = rows.map(r => r.name ?? '?').sort().join(',');
    const want = [...seeded].sort().join(',');
    if (got !== want) {
        throw new Error(`bank contents changed\n  got:  ${got}\n  want: ${want}`);
    }
}

/** Reopen the bank and read it the way the executor's snapshot() does, joining items with the catalog for cost.
 *  Why: the script closes the bank before it stops, so a bare bankItems() read afterwards returns an empty list. */
async function readBank(page: Page, stand: { x: number; z: number; level: number }): Promise<BankedRow[]> {
    await teleTo(page, stand, 6, 25_000);
    await page.waitForTimeout(500);

    await page.evaluate(s => {
        const g = globalThis as never as {
            __rs2b0t: {
                LoopingBot: new () => object;
                registerScript(meta: { name: string; create: () => unknown }): void;
                reader: {
                    bankItems(): { slot: number; id: number; name: string | null }[];
                    objCatalog(): { id: number; cost: number }[];
                };
                Bank: {
                    openBooth(t: unknown, name: string, op: string): Promise<boolean>;
                    openNearest(name: string, op: string): Promise<boolean>;
                    snapshotReady(): boolean;
                    close(): Promise<boolean>;
                };
                Execution: { delayUntil(c: () => boolean, ms: number): Promise<boolean> };
            };
            rs2b0t: { runner: { start(meta: unknown): void }; registry: { get(n: string): unknown } };
            __bankRows?: { done: boolean; rows: BankedRow[]; reason: string };
        };
        const abi = g.__rs2b0t;
        g.__bankRows = { done: false, rows: [], reason: '' };

        class ReadBankBot extends abi.LoopingBot {
            private ran = false;
            async loop(): Promise<number> {
                if (this.ran) {
                    return 5000;
                }
                this.ran = true;
                const out = g.__bankRows!;
                try {
                    const opened = (await abi.Bank.openBooth(s, 'Bank booth', 'Use-quickly'))
                        || (await abi.Bank.openNearest('Bank booth', 'Use-quickly'));
                    if (!opened) {
                        out.reason = 'could not open a booth';
                        return 5000;
                    }
                    await abi.Execution.delayUntil(() => abi.Bank.snapshotReady(), 5000);
                    const costs = new Map(abi.reader.objCatalog().map(rec => [rec.id, rec.cost]));
                    out.rows = abi.reader.bankItems().map(item => ({
                        slot: item.slot,
                        id: item.id,
                        name: item.name,
                        cost: costs.get(item.id) ?? 0
                    }));
                    await abi.Bank.close();
                } catch (err) {
                    out.reason = String(err);
                } finally {
                    out.done = true;
                }
                return 5000;
            }
        }

        abi.registerScript({ name: 'HarnessReadBank', create: () => new ReadBankBot() });
        g.rs2b0t.runner.start(g.rs2b0t.registry.get('HarnessReadBank'));
    }, stand);

    await page.waitForFunction(
        () => (globalThis as never as { __bankRows?: { done: boolean } }).__bankRows?.done === true,
        undefined,
        { timeout: 40_000 }
    );
    const out = await page.evaluate(
        () => (globalThis as never as { __bankRows: { rows: BankedRow[]; reason: string } }).__bankRows
    );
    await page.evaluate(() => {
        type Abi = { rs2b0t: { runner: { stop(reason: string): void } } };
        (globalThis as never as Abi).rs2b0t.runner.stop('harness read done');
    });
    if (out.reason) {
        throw new Error(`readBank: ${out.reason}`);
    }

    return out.rows;
}

async function readVarp(page: Page, index: number): Promise<number> {
    return page.evaluate(i => {
        type Abi = { rs2b0t: { reader: { varp(n: number): number } } };
        return (globalThis as never as Abi).rs2b0t.reader.varp(i);
    }, index);
}

/** Returns the run's log lines, which carry the per-round "N sent" counts the incremental case asserts on. */
async function runSorter(page: Page, label: string, maxMs = 180_000): Promise<string[]> {
    console.log(`${label}: starting BankSorter`);
    await startScript(page, 'BankSorter');

    const startedAt = Date.now();
    while (Date.now() - startedAt < maxMs) {
        await page.waitForTimeout(2000);
        const snap = await page.evaluate(() => {
            type Abi = { rs2b0t: { runner: { state: string; ctx?: { log?: { msg: string }[] } } } };
            const { runner } = (globalThis as never as Abi).rs2b0t;
            return { state: runner.state, logs: (runner.ctx?.log ?? []).map(l => l.msg) };
        });
        if (snap.state === 'stopped' || snap.state === 'crashed') {
            const secs = Math.round((Date.now() - startedAt) / 1000);
            console.log(`${label}: script ${snap.state} after ${secs}s`);
            for (const line of snap.logs.filter(l => l.startsWith('bank sort:') || l.startsWith('BankSorter:'))) {
                console.log(`  ${line}`);
            }
            if (snap.state === 'crashed') {
                throw new Error(`${label}: BankSorter crashed`);
            }
            return snap.logs;
        }
    }
    throw new Error(`${label}: BankSorter never stopped within ${maxMs}ms`);
}

async function seed(page: Page, items: readonly BankSeedItem[], label: string): Promise<void> {
    console.log(`${label}: seeding ${items.length} item type(s)`);
    await seedItemsToBank(page, [...items], VARROCK_WEST_BANK);
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    const args = parseArgs(argv, { base: 'http://localhost:8890', minutes: 20 });
    // Why: parseArgs drops every "-" flag from rest, so --tick has to come off argv directly.
    const tickIndex = argv.indexOf('--tick');
    const tickMs = tickIndex >= 0 ? Number(argv[tickIndex + 1]) || 600 : 600;

    const client = deployIsolatedClient('banksorter');
    const browser = await launchBrowser();
    const page = await browser.newPage();

    try {
        await mainlandAccount(page, args.base, 'banksort1', client.page);
        await cheatQuiet(page, `speed ${tickMs}`);
        console.log(`tick rate: ${tickMs}ms`);

        await teleTo(page, VARROCK_WEST_BANK);
        // Why: cheatQuiet writes the CLIENT_CHEAT packet directly, so the command carries no "::".
        await cheatQuiet(page, '~clearbank');

        const varpBefore = await readVarp(page, BANK_INSERT_VARP);
        console.log(`arrange varp before: ${varpBefore}`);

        await seed(page, COLD_SEED, 'cold');
        await runSorter(page, 'cold');

        const coldRows = await readBank(page, VARROCK_WEST_BANK);
        assertSorted(coldRows, COLD_SEED.map(s => s.displayName));
        console.log(`cold PASS: ${coldRows.length} slots, order ${coldRows.map(r => r.name).join(' | ')}`);

        await seed(page, TOPUP_SEED, 'incremental');
        const topUpLogs = await runSorter(page, 'incremental');

        const summary = topUpLogs.find(l => l.startsWith('BankSorter: sorted'));
        if (!summary) {
            throw new Error(`incremental: no sorted summary in the log\n  ${topUpLogs.join('\n  ')}`);
        }
        if (!summary.includes('(insert)')) {
            throw new Error(`incremental: expected insert mode, got "${summary}"`);
        }
        const moves = Number(/(\d+) moves/.exec(summary)?.[1] ?? -1);
        if (moves < 0 || moves > 4) {
            throw new Error(`incremental: wanted a single batch of at most 4 moves, got ${moves}`);
        }
        console.log(`incremental: one batch, ${moves} moves, insert mode`);

        const topUpRows = await readBank(page, VARROCK_WEST_BANK);
        assertSorted(topUpRows, [...COLD_SEED, ...TOPUP_SEED].map(s => s.displayName));
        console.log(`incremental PASS: ${topUpRows.length} slots, order ${topUpRows.map(r => r.name).join(' | ')}`);

        const varpAfter = await readVarp(page, BANK_INSERT_VARP);
        if (varpAfter !== varpBefore) {
            throw new Error(`arrange varp left at ${varpAfter}, started at ${varpBefore}`);
        }
        console.log(`arrange varp restored to ${varpAfter}`);

        console.log('PASS: cold sort and incremental re-sort both landed');
    } finally {
        await browser.close();
    }
}

await main();
