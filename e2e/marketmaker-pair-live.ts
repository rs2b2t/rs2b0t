/** Two-account MarketMaker e2e at Seers bank, against the window-is-the-transaction model.
 *  Six legs: a sale paid by coins in the window, a mixed pile bought with no chat, a live re-price
 *  mid-trade, a pile over the trade cap bid at the cap, coins ignored and named, and the cooldown
 *  after walking out. Quotes and appraisals travel over public chat, and the shop pays out in notes. */

// Usage:
//   HEADED=1 bun e2e/marketmaker-pair-live.ts
//   BASE=http://localhost:8890 BUDGET_S=900 bun e2e/marketmaker-pair-live.ts

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
const BUDGET_MS = (Number(process.env.BUDGET_S) || 900) * 1000;
const stamp = Date.now().toString(36).slice(-6);
const MAKER = process.env.MAKER_NAME || `mm${stamp}`;
const CUSTOMER = process.env.CUSTOMER_NAME || `mc${stamp}`;

const SPOT = { x: 2725, z: 3491, level: 0 } as const;

const IRON = 440;
const IRON_NOTE = 441;
const YEW = 1515;
const YEW_NOTE = 1516;
const COINS = 995;
const CAP = 100_000;
/** Worth 115,200gp at the buy price, so the pile clears the cap. */
const CAP_YEWS = 400;

/** 20% spread: iron 18/22, yew 288/352. */
const BOOK = JSON.stringify([{
    name: 'e2e',
    margin: 20,
    maxTradeValue: CAP,
    rows: [
        { id: IRON, mid: 20, cap: 4_000, buying: true, selling: true },
        { id: YEW, mid: 320, cap: 2_000, buying: true, selling: true }
    ]
}]);

const IRON_BUY = 18;
const IRON_SELL = 22;
const YEW_BUY = 288;
/** Short, so the cooldown leg is provable without a slow test. */
const COOLDOWN_S = 20;

type Tile = { x: number; z: number; level: number };
type Slot = { id: number; count: number };

type Abi = {
    __rs2b0t: {
        reader: {
            worldTile(): Tile | null;
            chat(n: number): { type: number; username: string | null; text: string }[];
        };
        Inventory: { countById(id: number): number };
        Trade: {
            active(): boolean;
            onOfferScreen(): boolean;
            onConfirmScreen(): boolean;
            myOffer(): Slot[];
            theirOffer(): Slot[];
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

async function teleArrive(page: Page, spot: Tile): Promise<void> {
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
    fail(`tele to ${spot.x},${spot.z} failed`);
}

async function writeStorage(page: Page, entries: Record<string, string>): Promise<void> {
    await page.evaluate(map => {
        for (const [k, v] of Object.entries(map)) {
            sessionStorage.setItem(k, v);
            try {
                localStorage.setItem(k, v);
            } catch {
                /* private mode */
            }
        }
    }, entries);
}

async function say(page: Page, text: string): Promise<void> {
    if (!(await page.evaluate(t => (globalThis as never as Abi).rs2b0t.actions.sayPublic(t), text))) {
        fail(`customer could not say '${text}'`);
    }
    console.log(`${at()} customer says: ${text}`);
    await page.waitForTimeout(1200);
}

async function chatMark(page: Page): Promise<string> {
    return page.evaluate(() => {
        const top = (globalThis as never as Abi).__rs2b0t.reader.chat(1)[0];
        return top ? `${top.type}|${top.username ?? ''}|${top.text}` : '';
    });
}

/** Wait for a public line from the maker that arrived after `mark`. */
// Why: chat(20) is a rolling buffer, so a bare search matches the previous leg's line and a leg that should fail passes.
async function waitForMakerLine(page: Page, re: RegExp, ms: number, mark: string): Promise<string | null> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        const hit = await page.evaluate(
            ([name, source, since]) => {
                const lines = (globalThis as never as Abi).__rs2b0t.reader.chat(20);
                const sig = (l: { type: number; username: string | null; text: string }) =>
                    `${l.type}|${l.username ?? ''}|${l.text}`;
                const from = (u: string | null) => (u ?? '').replace(/^@cr\d@/, '').trim().toLowerCase();
                const want = new RegExp(source, 'i');
                for (const line of lines) {
                    if (sig(line) === since) {
                        break;
                    }
                    if (from(line.username) === name.toLowerCase() && want.test(line.text)) {
                        return line.text;
                    }
                }
                return null;
            },
            [MAKER, re.source, mark] as [string, string, string]
        );
        if (hit) {
            return hit;
        }
        await page.waitForTimeout(600);
    }
    return null;
}

/** Say a command until the maker answers, since a random event can put it out of chat range. */
async function askUntilAnswered(page: Page, command: string, re: RegExp, tries = 5): Promise<string | null> {
    for (let i = 0; i < tries; i++) {
        const mark = await chatMark(page);
        await say(page, command);
        const hit = await waitForMakerLine(page, re, 20_000, mark);
        if (hit) {
            return hit;
        }
        console.log(`${at()} no answer to '${command}' (try ${i + 1}/${tries})`);
    }
    return null;
}

async function countById(page: Page, id: number): Promise<number> {
    return page.evaluate(i => (globalThis as never as Abi).__rs2b0t.Inventory.countById(i), id);
}

async function oreCount(page: Page): Promise<number> {
    return (await countById(page, IRON)) + (await countById(page, IRON_NOTE));
}

async function yewCount(page: Page): Promise<number> {
    return (await countById(page, YEW)) + (await countById(page, YEW_NOTE));
}

async function makerLogs(page: Page): Promise<string[]> {
    return page.evaluate(() => ((globalThis as never as Abi).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
}

async function where(page: Page): Promise<string> {
    return page.evaluate(() => {
        const t = (globalThis as never as Abi).__rs2b0t.reader.worldTile();
        return t ? `${t.x},${t.z},${t.level}` : 'nowhere';
    });
}

async function dump(makerPage: Page, custPage: Page, label: string): Promise<string> {
    const logs = (await makerLogs(makerPage)).slice(-26);
    const chat = await custPage.evaluate(() =>
        (globalThis as never as Abi).__rs2b0t.reader.chat(12).map(l => `${l.type}|${l.username ?? ''}|${l.text}`)
    );
    const [makerAt, custAt, state, custTrade] = await Promise.all([
        where(makerPage),
        where(custPage),
        makerPage.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state),
        custPage.evaluate(() => {
            const t = (globalThis as never as Abi).__rs2b0t.Trade;
            return `active=${t.active()} offer=${t.onOfferScreen()} confirm=${t.onConfirmScreen()} mine=${t.myOffer().length} theirs=${t.theirOffer().length}`;
        })
    ]);
    return [
        label,
        `  maker at ${makerAt} (spot ${SPOT.x},${SPOT.z}), runner ${state}; customer at ${custAt}`,
        `  customer trade: ${custTrade}`,
        `  maker log: ${logs.join('\n             ')}`,
        `  chat seen: ${chat.join('\n             ')}`
    ].join('\n');
}

/** Game messages (no sender) in the chat buffer that match. */
async function countGameLines(page: Page, re: RegExp): Promise<number> {
    return page.evaluate(source => {
        const want = new RegExp(source, 'i');
        return (globalThis as never as Abi).__rs2b0t.reader.chat(20).filter(l => l.type === 0 && want.test(l.text)).length;
    }, re.source);
}

/** Request until the window opens; the engine refuses while the maker is at the bank. */
// Why: a "Trade with" click clears the pending action, which closes a window that opened the same tick, so a request that went through is waited out and only a refused one is repeated.
async function openTrade(page: Page, label: string): Promise<boolean> {
    for (let attempt = 0; attempt < 8; attempt++) {
        const busyBefore = await countGameLines(page, /busy at the moment/);
        await page.evaluate(m => (globalThis as never as Abi).__rs2b0t.Trade.request(m), MAKER);
        const deadline = Date.now() + 40_000;
        while (Date.now() < deadline) {
            if (await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.onOfferScreen())) {
                const partner = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.myOffer().length);
                console.log(`${at()} ${label}: window open (request ${attempt + 1}, my slots ${partner})`);
                return true;
            }
            if ((await countGameLines(page, /busy at the moment/)) > busyBefore) {
                console.log(`${at()} ${label}: the maker is busy, asking again shortly`);
                break;
            }
            await page.waitForTimeout(400);
        }
        await page.waitForTimeout(3_000);
    }
    console.log(`${at()} ${label}: the window never opened`);
    return false;
}

async function offerItem(page: Page, give: { name: string; id: number; qty: number }): Promise<boolean> {
    return page.evaluate(
        g => (globalThis as never as Abi).__rs2b0t.Trade.offer(g.name, g.qty, i => i.id === g.id),
        give
    );
}

/** The maker's side, as the customer's client sees it. */
async function botSide(page: Page): Promise<Slot[]> {
    return page.evaluate(() =>
        (globalThis as never as Abi).__rs2b0t.Trade.theirOffer().map(s => ({ id: s.id, count: s.count }))
    );
}

async function waitBotSide(
    page: Page,
    want: (side: Slot[]) => boolean,
    ms: number,
    label: string
): Promise<Slot[] | null> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (!(await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.active()))) {
            console.log(`${at()} ${label}: window closed while waiting on the maker`);
            return null;
        }
        const side = await botSide(page);
        if (want(side)) {
            return side;
        }
        await page.waitForTimeout(500);
    }
    return null;
}

function coinsOn(side: Slot[]): number {
    return side.filter(s => s.id === COINS).reduce((sum, s) => sum + Math.max(1, s.count), 0);
}

function unitsOn(side: Slot[], plain: number, noted: number): number {
    return side.filter(s => s.id === plain || s.id === noted).reduce((sum, s) => sum + Math.max(1, s.count), 0);
}

/** Accept until the window closes. The maker re-checks on the confirm screen before it confirms. */
async function settle(page: Page, label: string): Promise<boolean> {
    for (let i = 0; i < 30; i++) {
        if (!(await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.active()))) {
            console.log(`${at()} ${label}: window closed`);
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
    await cheatQuiet(makerPage, '~bankitem iron_ore 1000');
    await cheatQuiet(makerPage, '~bankitem yew_logs 200');
    await cheatQuiet(makerPage, '~bankitem coins 500000');
    await teleArrive(makerPage, SPOT);

    await writeStorage(makerPage, {
        'rs2b0t:set:PriceBooks:books': BOOK,
        'rs2b0t:set:MarketMaker:priceBook': 'e2e',
        'rs2b0t:set:MarketMaker:spot': `${SPOT.x},${SPOT.z},${SPOT.level}`,
        // Why: advertising off keeps the chat log readable while the legs run.
        'rs2b0t:set:MarketMaker:advertiseSeconds': '0',
        'rs2b0t:set:MarketMaker:engagementTimeoutSeconds': '120',
        'rs2b0t:set:MarketMaker:intentSeconds': '120',
        'rs2b0t:set:MarketMaker:cooldownSeconds': String(COOLDOWN_S),
        'rs2b0t:set:MarketMaker:coinFloat': '200000'
    });

    console.log(`${at()} bring up customer '${CUSTOMER}'`);
    await mainlandAccount(custPage, base, CUSTOMER, isolated.page);
    await maxmeAndClearDialogs(custPage);
    await clearChatDialogs(custPage);
    await cheatQuiet(custPage, '~clearinv');
    await cheatQuiet(custPage, 'give coins 100000');
    await cheatQuiet(custPage, 'give cert_iron_ore 500');
    await cheatQuiet(custPage, 'give cert_yew_logs 500');
    await teleArrive(custPage, SPOT);

    if (!(await makerPage.evaluate(() => Boolean((globalThis as never as Abi).rs2b0t.registry.get('MarketMaker'))))) {
        fail('MarketMaker missing from the registry — the deployed bundle is stale');
    }

    await startScript(makerPage, 'MarketMaker');
    console.log(`${at()} MarketMaker started, waiting for the ledger and coin float`);
    await makerPage.waitForTimeout(25_000);

    const state = await makerPage.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state);
    if (state !== 'running') {
        fail(`MarketMaker did not stay up (${state}): ${(await makerLogs(makerPage)).slice(-4).join(' | ')}`);
    }

    const deadline = Date.now() + BUDGET_MS;
    const results: string[] = [];

    // ---- leg 1: the customer buys, paying with coins in the window --------
    const ore0 = await oreCount(custPage);
    const gp0 = await countById(custPage, COINS);

    if ((await askUntilAnswered(custPage, 'buy 100 iron ore', /trade me/i)) === null) {
        fail(await dump(makerPage, custPage, 'sale leg: the maker never answered the request'));
    }
    if (!(await openTrade(custPage, 'sale'))) {
        fail(await dump(makerPage, custPage, 'sale leg: the window never opened'));
    }
    await offerItem(custPage, { name: 'Coins', id: COINS, qty: 100 * IRON_SELL });

    if (!(await waitBotSide(custPage, s => unitsOn(s, IRON, IRON_NOTE) === 100, 45_000, 'sale'))) {
        fail(await dump(makerPage, custPage, 'sale leg: the maker never put up 100 iron ore'));
    }
    if (!(await settle(custPage, 'sale'))) {
        fail(await dump(makerPage, custPage, 'sale leg: the trade never completed'));
    }
    await custPage.waitForTimeout(2500);

    const oreGained = (await oreCount(custPage)) - ore0;
    const gpSpent = gp0 - (await countById(custPage, COINS));
    if (oreGained !== 100 || gpSpent !== 100 * IRON_SELL) {
        fail(await dump(makerPage, custPage, `sale leg: expected +100 ore and -${100 * IRON_SELL}gp, got +${oreGained} and -${gpSpent}`));
    }
    results.push(`sold 100 iron ore for ${100 * IRON_SELL}gp, paid by coins in the window`);
    console.log(`${at()} PASS leg 1: ${results[0]}`);

    // ---- leg 2: a mixed pile, bought with no chat at all ------------------
    if (Date.now() > deadline) {
        fail('out of budget before the mixed-pile leg');
    }
    const ore1 = await oreCount(custPage);
    const yew1 = await yewCount(custPage);
    const gp1 = await countById(custPage, COINS);
    const owed = 100 * IRON_BUY + 10 * YEW_BUY;

    if (!(await openTrade(custPage, 'mixed pile'))) {
        fail(await dump(makerPage, custPage, 'mixed leg: the window never opened'));
    }
    await offerItem(custPage, { name: 'Iron ore', id: IRON_NOTE, qty: 100 });
    await offerItem(custPage, { name: 'Yew logs', id: YEW_NOTE, qty: 10 });

    if (!(await waitBotSide(custPage, s => coinsOn(s) === owed, 45_000, 'mixed pile'))) {
        fail(await dump(makerPage, custPage, `mixed leg: the maker never put up ${owed}gp for the pile`));
    }
    if (!(await settle(custPage, 'mixed pile'))) {
        fail(await dump(makerPage, custPage, 'mixed leg: the trade never completed'));
    }
    await custPage.waitForTimeout(2500);

    if (ore1 - (await oreCount(custPage)) !== 100 || yew1 - (await yewCount(custPage)) !== 10) {
        fail(await dump(makerPage, custPage, 'mixed leg: the goods did not move'));
    }
    const paidOut = (await countById(custPage, COINS)) - gp1;
    if (paidOut !== owed) {
        fail(await dump(makerPage, custPage, `mixed leg: expected +${owed}gp, got +${paidOut}`));
    }
    results.push(`bought 100 iron ore and 10 yew logs as one ${owed}gp bill, no chat`);
    console.log(`${at()} PASS leg 2: ${results[1]}`);

    // ---- leg 3: the customer adds more mid-trade, and the price follows ---
    // Why: this is the model. A quote could not do it, and it is where a live-priced window would oscillate if it were going to.
    if (Date.now() > deadline) {
        fail('out of budget before the re-price leg');
    }
    const gp2 = await countById(custPage, COINS);

    if (!(await openTrade(custPage, 're-price'))) {
        fail(await dump(makerPage, custPage, 're-price leg: the window never opened'));
    }
    await offerItem(custPage, { name: 'Iron ore', id: IRON_NOTE, qty: 50 });
    if (!(await waitBotSide(custPage, s => coinsOn(s) === 50 * IRON_BUY, 45_000, 're-price'))) {
        fail(await dump(makerPage, custPage, `re-price leg: no first offer of ${50 * IRON_BUY}gp`));
    }
    console.log(`${at()} re-price: maker offered ${50 * IRON_BUY}gp for 50`);

    await offerItem(custPage, { name: 'Iron ore', id: IRON_NOTE, qty: 50 });
    if (!(await waitBotSide(custPage, s => coinsOn(s) === 100 * IRON_BUY, 45_000, 're-price'))) {
        fail(await dump(makerPage, custPage, `re-price leg: the maker never followed to ${100 * IRON_BUY}gp`));
    }
    console.log(`${at()} re-price: maker followed to ${100 * IRON_BUY}gp for 100`);

    if (!(await settle(custPage, 're-price'))) {
        fail(await dump(makerPage, custPage, 're-price leg: the trade never completed after the change'));
    }
    await custPage.waitForTimeout(2500);
    if ((await countById(custPage, COINS)) - gp2 !== 100 * IRON_BUY) {
        fail(await dump(makerPage, custPage, 're-price leg: the settled amount was not the re-priced one'));
    }
    results.push(`re-priced ${50 * IRON_BUY} to ${100 * IRON_BUY}gp when the customer added more, and still settled`);
    console.log(`${at()} PASS leg 3: ${results[2]}`);

    // ---- leg 4: a pile over the trade cap is bid at the cap, and the shop says the max ----
    if (Date.now() > deadline) {
        fail('out of budget before the cap leg');
    }
    const yew3 = await yewCount(custPage);
    const gp3 = await countById(custPage, COINS);
    const mark4 = await chatMark(custPage);

    if (!(await openTrade(custPage, 'over the cap'))) {
        fail(await dump(makerPage, custPage, 'cap leg: the window never opened'));
    }
    await offerItem(custPage, { name: 'Yew logs', id: YEW_NOTE, qty: CAP_YEWS });

    if (!(await waitBotSide(custPage, s => coinsOn(s) === CAP, 45_000, 'over the cap'))) {
        fail(await dump(makerPage, custPage, `cap leg: the maker never put up the ${CAP}gp cap for a ${CAP_YEWS * YEW_BUY}gp pile`));
    }
    // Why: public chat is lowercased on the wire, so the match is case-blind.
    const capLine = await waitForMakerLine(custPage, /max i can offer is 100,000gp per trade/i, 20_000, mark4);
    if (capLine === null) {
        fail(await dump(makerPage, custPage, 'cap leg: the maker never said what the max is'));
    }
    await custPage.screenshot({ path: 'docs/e2e/marketmaker-cap-bid.png' });
    if (!(await settle(custPage, 'over the cap'))) {
        fail(await dump(makerPage, custPage, 'cap leg: the trade never completed'));
    }
    await custPage.waitForTimeout(2500);
    const capPaid = (await countById(custPage, COINS)) - gp3;
    const yewGone = yew3 - (await yewCount(custPage));
    if (capPaid !== CAP || yewGone !== CAP_YEWS) {
        fail(await dump(makerPage, custPage, `cap leg: expected +${CAP}gp for ${CAP_YEWS} yew logs, got +${capPaid}gp for ${yewGone}`));
    }
    results.push(`bid the ${CAP}gp cap for a ${CAP_YEWS * YEW_BUY}gp pile of ${CAP_YEWS} yew logs, said '${capLine}', and settled`);
    console.log(`${at()} PASS leg 4: ${results[3]}`);

    // ---- leg 5: coins on their side are ignored, and named ----------------
    if (Date.now() > deadline) {
        fail('out of budget before the ignored-coins leg');
    }
    const mark5 = await chatMark(custPage);
    if (!(await openTrade(custPage, 'ignored coins'))) {
        fail(await dump(makerPage, custPage, 'coins leg: the window never opened'));
    }
    await offerItem(custPage, { name: 'Iron ore', id: IRON_NOTE, qty: 10 });
    await offerItem(custPage, { name: 'Coins', id: COINS, qty: 777 });

    if (!(await waitBotSide(custPage, s => coinsOn(s) === 10 * IRON_BUY, 45_000, 'ignored coins'))) {
        fail(await dump(makerPage, custPage, `coins leg: the maker did not offer ${10 * IRON_BUY}gp for the ore alone`));
    }
    if ((await waitForMakerLine(custPage, /not counted/i, 20_000, mark5)) === null) {
        fail(await dump(makerPage, custPage, 'coins leg: the maker never said the coins were not counted'));
    }
    await custPage.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.decline());
    await custPage.waitForTimeout(4000);
    results.push('ignored coins in a purchase and said so before accepting');
    console.log(`${at()} PASS leg 5: ${results[4]}`);

    // ---- leg 6: walking away costs the walker, not the shop ---------------
    if (Date.now() > deadline) {
        fail('out of budget before the cooldown leg');
    }
    await custPage.waitForTimeout(8_000);
    const mark6 = await chatMark(custPage);
    await say(custPage, 'buy 100 iron ore');
    if ((await waitForMakerLine(custPage, /trade me/i, 12_000, mark6)) !== null) {
        fail(await dump(makerPage, custPage, 'cooldown leg: the maker answered someone who just walked out of a trade'));
    }
    results.push(`ignored a customer for ${COOLDOWN_S}s after they walked out mid-trade`);
    console.log(`${at()} PASS leg 6: ${results[5]}`);

    console.log(`PASS: ${results.join(', ')}`);
    process.exit(0);
} finally {
    await browser.close();
    isolated.cleanup();
}
