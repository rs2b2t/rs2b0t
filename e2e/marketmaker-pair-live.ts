/** Two-account MarketMaker e2e at Seers bank: the maker runs the shop and a scripted customer works it over.
 *  Four legs: a sale, a purchase, a short pay the maker must never accept, and an offer holding a stray item it must decline.
 *  Quotes travel over public chat, and the maker pays out in notes, so the chat protocol and the cert mapping are both live here. */

// Usage:
//   HEADED=1 bun e2e/marketmaker-pair-live.ts
//   BASE=http://localhost:8890 BUDGET_S=420 bun e2e/marketmaker-pair-live.ts

// The harness builds and deploys its own isolated client; no manual redeploy needed.
import type { Page } from 'playwright-core';
import { deployIsolatedClient, launchBrowser, parseArgs } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    mainlandAccount,
    maxmeAndClearDialogs,
    startScript
} from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8890' });
const BUDGET_MS = (Number(process.env.BUDGET_S) || 420) * 1000;
const stamp = Date.now().toString(36).slice(-6);
const MAKER = process.env.MAKER_NAME || `mm${stamp}`;
const CUSTOMER = process.env.CUSTOMER_NAME || `mc${stamp}`;

/** Seers bank, north booth row. */
const SPOT = { x: 2725, z: 3491, level: 0 } as const;

const IRON_ORE = 440;
/** cert_iron_ore. The customer is seeded noted, since 300 unnoted ore would fill all 28 slots. */
const IRON_ORE_NOTED = 441;
const COINS = 995;

/** 20gp mid at a 20% spread quotes 18 buy / 22 sell. */
const BOOK = JSON.stringify([{
    name: 'e2e',
    margin: 20,
    maxTradeValue: 100_000,
    rows: [{ id: IRON_ORE, mid: 20, cap: 4000, buying: true, selling: true }]
}]);

const SALE_QTY = 100;
const SALE_PRICE = 22;
const BUY_QTY = 100;
const BUY_PRICE = 18;

type Tile = { x: number; z: number; level: number };

type Abi = {
    __rs2b0t: {
        reader: {
            worldTile(): Tile | null;
            localPlayerName(): string | null;
            chat(n: number): { type: number; username: string | null; text: string }[];
        };
        Inventory: { items(): { id: number; name: string | null; count: number }[]; countById(id: number): number };
        Trade: {
            active(): boolean;
            onOfferScreen(): boolean;
            onConfirmScreen(): boolean;
            partner(): string | null;
            myOffer(): { id: number; count: number }[];
            theirOffer(): { id: number; count: number }[];
            request(name: string): Promise<boolean>;
            offer(name: string, n: number, pick?: (i: { id: number }) => boolean): Promise<boolean>;
            accept(): Promise<boolean>;
            decline(): Promise<void>;
        };
    };
    rs2b0t: {
        actions: { sayPublic(text: string): boolean };
        runner: { state: string; ctx?: { log?: { msg: string }[] } | null };
        registry: { get(n: string): unknown };
    };
};

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const t0 = Date.now();
const at = (): string => `[${Math.round((Date.now() - t0) / 1000)}s]`;

function teleCmd(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: Tile, maxDist = 6): Promise<void> {
    for (let a = 0; a < 4; a++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let p = 0; p < 12; p++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && t.level === spot.level && Math.max(Math.abs(t.x - spot.x), Math.abs(t.z - spot.z)) <= maxDist) {
                await page.waitForTimeout(700);
                return;
            }
            await page.waitForTimeout(350);
        }
    }
    fail(`tele to ${spot.x},${spot.z} failed`);
}

async function writeSettings(page: Page, script: string, map: Record<string, string>): Promise<void> {
    await page.evaluate(([name, entries]) => {
        for (const [k, v] of Object.entries(entries as Record<string, string>)) {
            sessionStorage.setItem(`rs2b0t:set:${name}:${k}`, v);
            try {
                localStorage.setItem(`rs2b0t:set:${name}:${k}`, v);
            } catch {
                /* private mode */
            }
        }
    }, [script, map] as [string, Record<string, string>]);
}

async function say(page: Page, text: string): Promise<void> {
    const sent = await page.evaluate(t => (globalThis as never as Abi).rs2b0t.actions.sayPublic(t), text);
    if (!sent) {
        fail(`customer could not say '${text}'`);
    }
    console.log(`${at()} customer says: ${text}`);
    await page.waitForTimeout(1200);
}

/** Wait for a public line from the maker. Proves the quote reached the customer over the chat wire. */
async function waitForMakerLine(page: Page, re: RegExp, ms: number): Promise<string | null> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        const hit = await page.evaluate(
            ([name, source]) => {
                const lines = (globalThis as never as Abi).__rs2b0t.reader.chat(20);
                const from = (u: string | null) => (u ?? '').replace(/^@cr\d@/, '').trim().toLowerCase();
                const want = new RegExp(source as string, 'i');
                return lines.find(l => from(l.username) === (name as string).toLowerCase() && want.test(l.text))?.text ?? null;
            },
            [MAKER, re.source] as [string, string]
        );
        if (hit) {
            return hit;
        }
        await page.waitForTimeout(600);
    }
    return null;
}

async function dump(makerPage: Page, custPage: Page, label: string): Promise<string> {
    const logs = (await makerLogs(makerPage)).slice(-10);
    const chat = await custPage.evaluate(() =>
        (globalThis as never as Abi).__rs2b0t.reader
            .chat(12)
            .map(l => `${l.type}|${l.username ?? ''}|${l.text}`)
    );
    return `${label}\n  maker log: ${logs.join('\n             ')}\n  chat seen: ${chat.join('\n             ')}`;
}

async function countById(page: Page, id: number): Promise<number> {
    return page.evaluate(i => (globalThis as never as Abi).__rs2b0t.Inventory.countById(i), id);
}

/** Noted and unnoted together, since the maker pays out in notes. */
async function oreCount(page: Page): Promise<number> {
    return (await countById(page, IRON_ORE)) + (await countById(page, IRON_ORE_NOTED));
}

async function makerLogs(page: Page): Promise<string[]> {
    return page.evaluate(() => ((globalThis as never as Abi).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
}

/** Wait for the maker to open the trade screen on the customer's client. */
async function waitTradeOpen(page: Page, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.onOfferScreen())) {
            return true;
        }
        await page.waitForTimeout(400);
    }
    return false;
}

async function waitTradeClosed(page: Page, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (!(await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.active()))) {
            return true;
        }
        await page.waitForTimeout(400);
    }
    return false;
}

/** Request until the screen opens. The engine answers "is busy at the moment" while the maker has its bank open. */
async function openTrade(page: Page, maker: string, label: string): Promise<boolean> {
    for (let attempt = 0; attempt < 12; attempt++) {
        await page.evaluate(m => (globalThis as never as Abi).__rs2b0t.Trade.request(m), maker);
        if (await waitTradeOpen(page, 6_000)) {
            console.log(`${at()} ${label}: trade screen open`);
            return true;
        }
    }
    console.log(`${at()} ${label}: the trade screen never opened after 12 requests`);
    return false;
}

async function offerItem(page: Page, give: { name: string; id: number; qty: number }): Promise<boolean> {
    return page.evaluate(
        g => (globalThis as never as Abi).__rs2b0t.Trade.offer(g.name, g.qty, i => i.id === g.id),
        give
    );
}

/** Customer side: request the trade, put up `give`, then accept both screens. */
async function customerTrade(
    page: Page,
    maker: string,
    give: { name: string; id: number; qty: number } | null,
    label: string
): Promise<boolean> {
    if (!(await openTrade(page, maker, label))) {
        return false;
    }

    if (give) {
        const offered = await offerItem(page, give);
        if (!offered) {
            console.log(`${at()} ${label}: could not offer ${give.qty} x ${give.name}`);
            return false;
        }
        await page.waitForTimeout(1500);
    }

    // Why: the maker only accepts once both sides match, so the customer accepts on a loop until the modal moves on.
    for (let i = 0; i < 25; i++) {
        const state = await page.evaluate(() => {
            const t = (globalThis as never as Abi).__rs2b0t.Trade;
            return { offer: t.onOfferScreen(), confirm: t.onConfirmScreen(), active: t.active() };
        });
        if (!state.active) {
            return true;
        }
        await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.accept());
        await page.waitForTimeout(900);
    }
    return !(await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.active()));
}

console.log(`marketmaker-pair base=${base} maker=${MAKER} customer=${CUSTOMER} budget=${Math.round(BUDGET_MS / 1000)}s`);

const isolated = deployIsolatedClient('mm');
const browser = await launchBrowser({ swiftshader: true });

try {
    const makerPage = await (await browser.newContext()).newPage();
    const custPage = await (await browser.newContext()).newPage();

    console.log(`${at()} bring up maker '${MAKER}'`);
    await mainlandAccount(makerPage, base, MAKER, isolated.page);
    await maxmeAndClearDialogs(makerPage);
    await clearChatDialogs(makerPage);
    await cheatQuiet(makerPage, '~clearinv');
    // Why: well under the 4000 cap, so the purchase leg has room; the cap refusal gets its own leg.
    await cheatQuiet(makerPage, '~bankitem iron_ore 1000');
    await cheatQuiet(makerPage, '~bankitem coins 500000');
    await teleArrive(makerPage, SPOT);

    await makerPage.evaluate(json => {
        sessionStorage.setItem('rs2b0t:set:PriceBooks:books', json);
        try {
            localStorage.setItem('rs2b0t:set:PriceBooks:books', json);
        } catch {
            /* private mode */
        }
    }, BOOK);
    await writeSettings(makerPage, 'MarketMaker', {
        priceBook: 'e2e',
        spot: `${SPOT.x},${SPOT.z},${SPOT.level}`,
        // Why: advertising off keeps the chat log readable while the legs run.
        advertiseSeconds: '0',
        engagementTimeoutSeconds: '120',
        maxQueue: '4',
        coinFloat: '50000'
    });

    console.log(`${at()} bring up customer '${CUSTOMER}'`);
    await mainlandAccount(custPage, base, CUSTOMER, isolated.page);
    await maxmeAndClearDialogs(custPage);
    await clearChatDialogs(custPage);
    await cheatQuiet(custPage, '~clearinv');
    await cheatQuiet(custPage, 'give coins 100000');
    await cheatQuiet(custPage, 'give cert_iron_ore 300');
    await teleArrive(custPage, SPOT);

    if (!(await makerPage.evaluate(() => Boolean((globalThis as never as Abi).rs2b0t.registry.get('MarketMaker'))))) {
        fail('MarketMaker missing from the registry — the deployed bundle is stale');
    }

    await startScript(makerPage, 'MarketMaker');
    console.log(`${at()} MarketMaker started, waiting for it to seed its ledger`);
    await makerPage.waitForTimeout(12_000);

    const state = await makerPage.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state);
    if (state === 'crashed' || state === 'stopped') {
        fail(`MarketMaker did not stay up (${state}): ${(await makerLogs(makerPage)).slice(-4).join(' | ')}`);
    }

    const deadline = Date.now() + BUDGET_MS;
    const results: string[] = [];

    // ---- leg 1: the customer buys 100 iron ore -------------------------
    const oreBefore = await oreCount(custPage);
    const gpBefore = await countById(custPage, COINS);
    await say(custPage, `buy ${SALE_QTY} iron ore`);
    const saleQuote = await waitForMakerLine(custPage, /trade me/i, 90_000);
    if (saleQuote === null) {
        fail(await dump(makerPage, custPage, 'sale leg: the maker never quoted'));
    }
    console.log(`${at()} maker quoted: ${saleQuote}`);

    if (!(await customerTrade(custPage, MAKER, { name: 'Coins', id: COINS, qty: SALE_QTY * SALE_PRICE }, 'sale'))) {
        fail(await dump(makerPage, custPage, 'sale leg: the trade never completed'));
    }
    await waitTradeClosed(custPage, 10_000);
    await custPage.waitForTimeout(2000);

    const oreAfter = await oreCount(custPage);
    const gpAfter = await countById(custPage, COINS);
    if (oreAfter - oreBefore !== SALE_QTY || gpBefore - gpAfter !== SALE_QTY * SALE_PRICE) {
        fail(await dump(makerPage, custPage, `sale leg: expected +${SALE_QTY} ore and -${SALE_QTY * SALE_PRICE}gp, got +${oreAfter - oreBefore} ore and -${gpBefore - gpAfter}gp`));
    }
    results.push(`sold ${SALE_QTY} iron ore for ${SALE_QTY * SALE_PRICE}gp`);
    console.log(`${at()} PASS leg 1: ${results[0]}`);

    // ---- leg 2: the customer sells 100 iron ore ------------------------
    if (Date.now() > deadline) {
        fail('out of budget before the purchase leg');
    }
    const oreBefore2 = await oreCount(custPage);
    const gpBefore2 = await countById(custPage, COINS);
    await say(custPage, `sell ${BUY_QTY} iron ore`);
    const buyQuote = await waitForMakerLine(custPage, /i'll pay/i, 90_000);
    if (buyQuote === null) {
        fail(await dump(makerPage, custPage, 'purchase leg: the maker never quoted'));
    }
    console.log(`${at()} maker quoted: ${buyQuote}`);

    if (!(await customerTrade(custPage, MAKER, { name: 'Iron ore', id: IRON_ORE_NOTED, qty: BUY_QTY }, 'purchase'))) {
        fail(await dump(makerPage, custPage, 'purchase leg: the trade never completed'));
    }
    await waitTradeClosed(custPage, 10_000);
    await custPage.waitForTimeout(2000);

    const oreAfter2 = await oreCount(custPage);
    const gpAfter2 = await countById(custPage, COINS);
    if (oreBefore2 - oreAfter2 !== BUY_QTY || gpAfter2 - gpBefore2 !== BUY_QTY * BUY_PRICE) {
        fail(await dump(makerPage, custPage, `purchase leg: expected -${BUY_QTY} ore and +${BUY_QTY * BUY_PRICE}gp, got -${oreBefore2 - oreAfter2} ore and +${gpAfter2 - gpBefore2}gp`));
    }
    results.push(`bought ${BUY_QTY} for ${BUY_QTY * BUY_PRICE}gp`);
    console.log(`${at()} PASS leg 2: ${results[1]}`);

    // ---- leg 3: a short pay must never be accepted ----------------------
    if (Date.now() > deadline) {
        fail('out of budget before the refusal leg');
    }
    const oreBefore3 = await oreCount(custPage);
    const gpBefore3 = await countById(custPage, COINS);
    const logMark = (await makerLogs(makerPage)).length;

    await say(custPage, `buy ${SALE_QTY} iron ore`);
    if ((await waitForMakerLine(custPage, /trade me/i, 90_000)) === null) {
        fail(await dump(makerPage, custPage, 'short-pay leg: the maker never quoted'));
    }
    await customerTrade(custPage, MAKER, { name: 'Coins', id: COINS, qty: 100 }, 'short pay');
    await custPage.waitForTimeout(10_000);

    // Why: the coins sit in the open offer, not the pack, so only the ore count and the maker's log tell the truth here.
    if ((await oreCount(custPage)) !== oreBefore3) {
        fail(await dump(makerPage, custPage, 'short-pay leg: the maker handed over ore for 100gp'));
    }
    if ((await makerLogs(makerPage)).slice(logMark).some(m => /trade complete/i.test(m))) {
        fail(await dump(makerPage, custPage, 'short-pay leg: the maker completed an underpaid trade'));
    }

    // Why: the customer declines through the same API the bot uses, so a broken decline fails this leg rather than hiding.
    await custPage.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.decline());
    await waitTradeClosed(custPage, 15_000);
    await custPage.waitForTimeout(3000);
    if ((await countById(custPage, COINS)) !== gpBefore3) {
        fail(await dump(makerPage, custPage, `short-pay leg: coins did not come back (${gpBefore3} -> ${await countById(custPage, COINS)})`));
    }
    results.push(`never accepted a 100gp short pay on a ${SALE_QTY * SALE_PRICE}gp quote`);
    console.log(`${at()} PASS leg 3: ${results[2]}`);

    // ---- leg 4: an offer holding something it never quoted is declined ---
    if (Date.now() > deadline) {
        fail('out of budget before the decline leg');
    }
    const oreBefore4 = await oreCount(custPage);
    const declineMark = (await makerLogs(makerPage)).length;

    await say(custPage, `buy ${SALE_QTY} iron ore`);
    if ((await waitForMakerLine(custPage, /trade me/i, 90_000)) === null) {
        fail(await dump(makerPage, custPage, 'decline leg: the maker never quoted'));
    }
    // Why: the stray goes in BEFORE the price, since a matching offer is accepted the moment it lands and there would be no window left to slip anything into.
    if (!(await openTrade(custPage, MAKER, 'stray item'))) {
        fail(await dump(makerPage, custPage, 'decline leg: the trade screen never opened'));
    }
    await offerItem(custPage, { name: 'Iron ore', id: IRON_ORE_NOTED, qty: 5 });
    await offerItem(custPage, { name: 'Coins', id: COINS, qty: SALE_QTY * SALE_PRICE });
    await custPage.waitForTimeout(12_000);

    const declined = (await makerLogs(makerPage)).slice(declineMark).some(m => /declined/i.test(m));
    if (!declined) {
        fail(await dump(makerPage, custPage, 'decline leg: the maker never declined an offer holding a stray item'));
    }
    if ((await oreCount(custPage)) !== oreBefore4) {
        fail(await dump(makerPage, custPage, 'decline leg: ore moved on a trade the maker should have declined'));
    }
    results.push('declined an offer holding an item it never quoted');
    console.log(`${at()} PASS leg 4: ${results[3]}`);

    console.log(`PASS: ${results.join(', ')}`);
    process.exit(0);
} finally {
    await browser.close();
    isolated.cleanup();
}
