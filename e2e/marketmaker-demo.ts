/** Stand a MarketMaker up at Seers bank on the local sim and leave it running, so a human can walk over and trade with it.
 *  Not a test: it asserts nothing, seeds a demo book and bank, prints how to join, and stays up until Ctrl-C. */

// Usage:
//   bun e2e/marketmaker-demo.ts
//   BASE=http://localhost:8890 SHOP=seersmarket HEADED=1 bun e2e/marketmaker-demo.ts

import type { Page } from 'playwright-core';
import { deployIsolatedClient, launchBrowser } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, maxmeAndClearDialogs, startScript } from './tutorial/harness.js';

const BASE = process.env.BASE ?? 'http://localhost:8890';
/** Fixed, so the shop's bank and its takings survive a restart. */
const SHOP = process.env.SHOP ?? 'seersmarket';
const SPOT = { x: 2725, z: 3491, level: 0 } as const;

interface Stock {
    obj: string;
    id: number;
    name: string;
    mid: number;
    cap: number;
    bank: number;
}

/** Mixed on purpose: a cheap stackable, two noteables, a big-ticket item, and the bow pair that share a display name. */
const STOCK: Stock[] = [
    { obj: 'iron_ore', id: 440, name: 'Iron ore', mid: 20, cap: 5_000, bank: 2_000 },
    { obj: 'yew_logs', id: 1515, name: 'Yew logs', mid: 320, cap: 2_000, bank: 500 },
    { obj: 'lobster', id: 379, name: 'Lobster', mid: 150, cap: 2_000, bank: 500 },
    { obj: 'naturerune', id: 561, name: 'Nature rune', mid: 180, cap: 10_000, bank: 1_000 },
    { obj: 'rune_scimitar', id: 1333, name: 'Rune scimitar', mid: 15_000, cap: 20, bank: 5 },
    { obj: 'maple_longbow', id: 851, name: 'Maple longbow', mid: 640, cap: 500, bank: 100 },
    { obj: 'unstrung_maple_longbow', id: 62, name: 'Maple longbow', mid: 320, cap: 500, bank: 100 }
];

const BANK_COINS = 2_000_000;
const MARGIN = 20;
const MAX_TRADE = 500_000;

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        Inventory: { used(): number; countById(id: number): number };
    };
    rs2b0t: {
        runner: { state: string; ctx?: { log?: { msg: string }[] } | null };
        registry: { get(n: string): unknown };
    };
};

function gp(n: number): string {
    return n.toLocaleString('en-US');
}

function teleCmd(t: { x: number; z: number; level: number }): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: typeof SPOT): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let probe = 0; probe < 12; probe++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && t.level === spot.level && Math.max(Math.abs(t.x - spot.x), Math.abs(t.z - spot.z)) <= 6) {
                await page.waitForTimeout(700);
                return;
            }
            await page.waitForTimeout(350);
        }
    }
    throw new Error(`demo: could not tele the shop to ${spot.x},${spot.z}`);
}

function priceBook(): string {
    return JSON.stringify([{
        name: 'demo',
        margin: MARGIN,
        maxTradeValue: MAX_TRADE,
        rows: STOCK.map(s => ({ id: s.id, mid: s.mid, cap: s.cap, buying: true, selling: true }))
    }]);
}

function derived(mid: number): { buy: number; sell: number } {
    const buy = Math.max(1, Math.floor((mid * (200 - MARGIN)) / 200));
    return { buy, sell: Math.max(buy + 1, Math.ceil((mid * (200 + MARGIN)) / 200)) };
}

function joiningInstructions(clientPage: string): string {
    const rows = STOCK.map(s => {
        const { buy, sell } = derived(s.mid);
        const tag = STOCK.filter(o => o.name === s.name).length > 1 ? ` #${s.id}` : '';
        return `    ${(s.name + tag).padEnd(24)} buys at ${gp(buy).padStart(7)}   sells at ${gp(sell).padStart(7)}`;
    }).join('\n');

    const gifts = STOCK.map(s => `    ::give ${s.obj} 50`).join('\n');

    return `
${'='.repeat(78)}
  The shop is open. '${SHOP}' is standing at Seers bank.
${'='.repeat(78)}

  1. Open a client and log in as anyone you like (any name works, password 'test'):

       ${BASE}${clientPage}

  2. Get to the shop and give yourself something to trade with:

       ::${teleCmd(SPOT)}
       ::give coins 500000
${gifts}

     Noted stacks are easier to carry, and the shop pays out in notes anyway:

       ::give cert_iron_ore 1000
       ::give cert_yew_logs 200

  3. Talk to it in PUBLIC chat, standing next to it:

       prices                     what it trades, both sides
       buying                     what it pays
       buy 100 iron ore           it sells you 100
       sell 100 iron ore          it buys 100 off you
       buy 1k iron ore            k and m suffixes work
       sell all iron ore          'all' works

     Then send it a trade request. It opens the trade and puts up the goods.

  4. Its book today:

${rows}

  Things worth trying:

    buy 10 maple longbow       two items share that name, so it asks which;
                               answer with 'buy 10 #851' or 'buy 10 #62'
    buy 100 rune scimitar      over the ${gp(MAX_TRADE)}gp per-trade cap, so it quotes you less
    sell 9999 lobster          past its cap, so it takes what it can and says so
    buy 100 dragon claws       not in the book
    open a trade, pay short    it waits, and never accepts
    open a trade, add junk     it declines
    open a trade, then close   it drops you and ignores you for a minute

${'='.repeat(78)}
  Ctrl-C here to close the shop.
${'='.repeat(78)}
`;
}

const isolated = deployIsolatedClient('demo');
const browser = await launchBrowser({ swiftshader: true });
let closing = false;

process.on('SIGINT', () => {
    closing = true;
});

try {
    const page = await (await browser.newContext()).newPage();

    console.log(`demo: bringing up '${SHOP}' at ${BASE}`);
    await mainlandAccount(page, BASE, SHOP, isolated.page);
    await maxmeAndClearDialogs(page);
    await clearChatDialogs(page);

    console.log('demo: seeding the bank');
    await cheatQuiet(page, '~clearinv');
    await cheatQuiet(page, `~bankitem coins ${BANK_COINS}`);
    for (const s of STOCK) {
        await cheatQuiet(page, `~bankitem ${s.obj} ${s.bank}`);
    }

    await page.evaluate(json => {
        sessionStorage.setItem('rs2b0t:set:PriceBooks:books', json);
        try {
            localStorage.setItem('rs2b0t:set:PriceBooks:books', json);
        } catch {
            /* private mode */
        }
    }, priceBook());

    await page.evaluate(entries => {
        for (const [k, v] of Object.entries(entries)) {
            sessionStorage.setItem(`rs2b0t:set:MarketMaker:${k}`, v);
            try {
                localStorage.setItem(`rs2b0t:set:MarketMaker:${k}`, v);
            } catch {
                /* private mode */
            }
        }
    }, {
        priceBook: 'demo',
        spot: `${SPOT.x},${SPOT.z},${SPOT.level}`,
        advertiseSeconds: '90',
        engagementTimeoutSeconds: '90',
        quoteSeconds: '60',
        cooldownSeconds: '60',
        coinFloat: '200000'
    } as Record<string, string>);

    await teleArrive(page, SPOT);

    if (!(await page.evaluate(() => Boolean((globalThis as never as Abi).rs2b0t.registry.get('MarketMaker'))))) {
        throw new Error('demo: MarketMaker is missing from the registry — the deployed bundle is stale');
    }
    await startScript(page, 'MarketMaker');
    await page.waitForTimeout(10_000);

    const state = await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state);
    if (state !== 'running') {
        const log = await page.evaluate(() =>
            ((globalThis as never as Abi).rs2b0t.runner.ctx?.log ?? []).slice(-4).map(l => l.msg)
        );
        throw new Error(`demo: the shop did not stay up (${state}): ${log.join(' | ')}`);
    }

    console.log(joiningInstructions(isolated.page));

    let lastLine = '';
    while (!closing) {
        await page.waitForTimeout(15_000);
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            const log = g.rs2b0t.runner.ctx?.log ?? [];
            return {
                state: g.rs2b0t.runner.state,
                pack: g.__rs2b0t.Inventory.used(),
                coins: g.__rs2b0t.Inventory.countById(995),
                last: log[log.length - 1]?.msg ?? ''
            };
        });
        if (snap.state !== 'running') {
            console.log(`demo: the shop stopped (${snap.state}) — ${snap.last}`);
            break;
        }
        if (snap.last !== lastLine) {
            lastLine = snap.last;
            console.log(`  [shop] pack ${snap.pack}/28, ${gp(snap.coins)}gp carried — ${snap.last}`);
        }
    }
} finally {
    console.log('demo: closing the shop');
    await browser.close();
    isolated.cleanup();
}
