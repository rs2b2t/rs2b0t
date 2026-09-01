/** A shop whose bank holds less than its coin float used to stand at the booth banking and
 *  re-withdrawing the same stack on every loop, never serving anyone. It should make one trip
 *  and then open for business. */

// Usage:
//   bun e2e/marketmaker-short-float-live.ts
//   BASE=http://localhost:8890 WATCH_S=90 bun e2e/marketmaker-short-float-live.ts

import type { Page } from 'playwright-core';
import { deployIsolatedClient, fail, launchBrowser, logout } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, maxmeAndClearDialogs, startScript } from './tutorial/harness.js';

const BASE = process.env.BASE ?? 'http://localhost:8890';
const SHOP = process.env.SHOP ?? 'shortfloat';
const SPOT = { x: 2725, z: 3491, level: 0 } as const;
const TICK_MS = Number(process.env.TICK_MS) || 600;
const WATCH_S = Number(process.env.WATCH_S) || 90;

/** Deliberately under the float, so the top-up can never be satisfied. */
const BANK_COINS = 50_000;
const FLOAT = 200_000;
const BOOK = 'shortfloat';
const IRON = 440;

interface Abi {
    __rs2b0t: {
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        Inventory: { countById(id: number): number };
    };
    rs2b0t: {
        runner: { state: string; bot: { status?: string } | null; ctx?: { log?: { msg: string }[] } | null };
        registry: { get(n: string): unknown };
    };
}

function teleCmd(t: typeof SPOT): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
        await cheatQuiet(page, teleCmd(SPOT));
        for (let probe = 0; probe < 12; probe++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && t.level === SPOT.level && Math.max(Math.abs(t.x - SPOT.x), Math.abs(t.z - SPOT.z)) <= 6) {
                await page.waitForTimeout(700);
                return;
            }
            await page.waitForTimeout(350);
        }
    }
    fail(`shortfloat: could not tele the shop to ${SPOT.x},${SPOT.z}`);
}

const isolated = deployIsolatedClient('shortfloat');
const browser = await launchBrowser({ swiftshader: true });
let shopPage: Page | null = null;

try {
    const page = await (await browser.newContext()).newPage();
    shopPage = page;
    page.setDefaultTimeout(45_000);

    await mainlandAccount(page, BASE, SHOP, isolated.page);
    await maxmeAndClearDialogs(page);
    await clearChatDialogs(page);
    await cheatQuiet(page, `speed ${TICK_MS}`);

    console.log(`shortfloat: banking ${BANK_COINS}gp against a ${FLOAT}gp float`);
    await cheatQuiet(page, '~clearinv');
    await cheatQuiet(page, `~bankitem coins ${BANK_COINS}`);
    await cheatQuiet(page, '~bankitem iron_ore 2000');

    await page.evaluate(
        ({ json, settings }) => {
            const write = (k: string, v: string): void => {
                sessionStorage.setItem(k, v);
                try {
                    localStorage.setItem(k, v);
                } catch {
                    /* private mode */
                }
            };
            write('rs2b0t:set:PriceBooks:books', json);
            for (const [k, v] of Object.entries(settings)) {
                write(`rs2b0t:set:MarketMaker:${k}`, v);
            }
        },
        {
            json: JSON.stringify([{
                name: BOOK,
                margin: 20,
                maxTradeValue: 500_000,
                rows: [{ id: IRON, mid: 20, cap: 1000, buying: true, selling: true }]
            }]),
            settings: {
                priceBook: BOOK,
                spot: `${SPOT.x},${SPOT.z},${SPOT.level}`,
                advertiseSeconds: '0',
                engagementTimeoutSeconds: '90',
                intentSeconds: '90',
                cooldownSeconds: '15',
                coinFloat: String(FLOAT)
            } as Record<string, string>
        }
    );

    await teleArrive(page);
    await startScript(page, 'MarketMaker');
    await page.waitForTimeout(8_000);

    const state = await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state);
    if (state !== 'running') {
        const log = await page.evaluate(() =>
            ((globalThis as never as Abi).rs2b0t.runner.ctx?.log ?? []).slice(-4).map(l => l.msg)
        );
        fail(`shortfloat: the shop did not stay up (${state}): ${log.join(' | ')}`);
    }

    console.log(`shortfloat: watching the status for ${WATCH_S}s`);
    let trips = 0;
    let wasBanking = false;
    let openFor = 0;
    for (let probe = 0; probe < WATCH_S * 2; probe++) {
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            return {
                status: g.rs2b0t.runner.bot?.status ?? '',
                state: g.rs2b0t.runner.state,
                pack: g.__rs2b0t.Inventory.countById(995)
            };
        });
        if (snap.state !== 'running') {
            fail(`shortfloat: the shop stopped (${snap.state})`);
        }
        const banking = snap.status === 'banking the takings';
        if (banking && !wasBanking) {
            trips++;
            console.log(`  trip ${trips} at +${Math.round(probe / 2)}s, carrying ${snap.pack}gp`);
        }
        wasBanking = banking;
        if (snap.status.startsWith('open for business') || snap.status.startsWith('serving')) {
            openFor++;
        }
        await page.waitForTimeout(500);
    }

    const carried = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Inventory.countById(995));
    console.log(`shortfloat: ${trips} bank trip(s), open for business on ${openFor} of ${WATCH_S * 2} looks, carrying ${carried}gp`);

    // Why: one trip is right — it banks the goods and takes what coins there are. Anything more is the loop.
    if (trips > 1) {
        fail(`shortfloat: the shop made ${trips} bank trips in ${WATCH_S}s, so it is still looping on a float it cannot reach`);
    }
    if (carried !== BANK_COINS) {
        fail(`shortfloat: the shop carries ${carried}gp, not the ${BANK_COINS}gp the bank had`);
    }
    if (openFor === 0) {
        fail('shortfloat: the shop never reported itself open for business');
    }

    console.log(
        `PASS marketmaker-short-float-live: ${trips} bank trip in ${WATCH_S}s against a bank ` +
            `${FLOAT - BANK_COINS}gp short of the float, then open for business carrying ${carried}gp`
    );
} finally {
    if (shopPage) {
        try {
            await logout(shopPage);
        } catch {
            /* already gone */
        }
    }
    await browser.close();
    isolated.cleanup();
}
