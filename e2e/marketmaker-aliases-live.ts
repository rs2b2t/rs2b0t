/** The names the 2004 content repeats, proven on a live shop at Seers bank: a repeated name answered
 *  with the words that separate it, a colour and a key half resolving to the one obj the customer meant,
 *  a list carrying only what the shop holds, and the shop back on its pitch rather than parked on a booth. */

// Usage:
//   HEADED=1 bun e2e/marketmaker-aliases-live.ts
//   BASE=http://localhost:8890 BUDGET_S=900 bun e2e/marketmaker-aliases-live.ts

// The harness builds and deploys its own isolated client; no manual redeploy needed.
import type { Page } from 'playwright-core';
import { deployIsolatedClient, launchBrowser, parseArgs } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, maxmeAndClearDialogs, startScript } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8890' });
const BUDGET_MS = (Number(process.env.BUDGET_S) || 900) * 1000;
const stamp = Date.now().toString(36).slice(-6);
const MAKER = process.env.MAKER_NAME || `ma${stamp}`;
const CUSTOMER = process.env.CUSTOMER_NAME || `ca${stamp}`;

/** The middle of the Seers bank floor, three tiles clear of the booth counter at z=3494. */
const SPOT = { x: 2725, z: 3491, level: 0 } as const;
/** Where a booth click parks the bot, which is what the old leash of 3 let it call home. */
const COUNTER_Z = 3493;

const BLUE_HIDE = 1751;
const BLUE_HIDE_NOTE = 1752;
const GREEN_HIDE = 1753;
const GREEN_HIDE_NOTE = 1754;
const LOOP_HALF = 987;
const LOOP_HALF_NOTE = 988;
const YEW = 1515;
const COINS = 995;

/** Yew is in the book and never in the bank, so the list has something to leave out. */
const BOOK = JSON.stringify([
    {
        name: 'alias',
        margin: 20,
        maxTradeValue: 100_000,
        rows: [
            { id: BLUE_HIDE, mid: 2_000, cap: 500, buying: true, selling: true },
            { id: GREEN_HIDE, mid: 1_500, cap: 500, buying: true, selling: true },
            { id: LOOP_HALF, mid: 8_000, cap: 50, buying: true, selling: true },
            { id: YEW, mid: 320, cap: 2_000, buying: true, selling: true }
        ]
    }
]);

const BLUE_SELL = 2_200;
const LOOP_SELL = 8_800;

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

/** Every public line from the maker that arrived after `mark`, newest first. */
// Why: chat(20) is a rolling buffer, so a bare search matches the previous leg's line and a leg that should fail passes.
async function makerLinesSince(page: Page, mark: string): Promise<string[]> {
    return page.evaluate(
        ([name, since]) => {
            const lines = (globalThis as never as Abi).__rs2b0t.reader.chat(20);
            const sig = (l: { type: number; username: string | null; text: string }) =>
                `${l.type}|${l.username ?? ''}|${l.text}`;
            const from = (u: string | null) =>
                (u ?? '')
                    .replace(/^@cr\d@/, '')
                    .trim()
                    .toLowerCase();
            const out: string[] = [];
            for (const line of lines) {
                if (sig(line) === since) {
                    break;
                }
                if (from(line.username) === name.toLowerCase()) {
                    out.push(line.text);
                }
            }
            return out;
        },
        [MAKER, mark] as [string, string]
    );
}

async function waitForMakerLine(page: Page, re: RegExp, ms: number, mark: string): Promise<string | null> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        const hit = (await makerLinesSince(page, mark)).find(text => re.test(text));
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

/** Everything the maker said to one command, so a list spread over several lines can be read as one. */
async function askForLines(page: Page, command: string, settleMs: number): Promise<string[]> {
    const mark = await chatMark(page);
    await say(page, command);
    await page.waitForTimeout(settleMs);
    return (await makerLinesSince(page, mark)).reverse();
}

async function countById(page: Page, id: number): Promise<number> {
    return page.evaluate(i => (globalThis as never as Abi).__rs2b0t.Inventory.countById(i), id);
}

async function heldOf(page: Page, plain: number, noted: number): Promise<number> {
    return (await countById(page, plain)) + (await countById(page, noted));
}

async function makerLogs(page: Page): Promise<string[]> {
    return page.evaluate(() => ((globalThis as never as Abi).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));
}

async function tileOf(page: Page): Promise<Tile | null> {
    return page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
}

async function where(page: Page): Promise<string> {
    const t = await tileOf(page);
    return t ? `${t.x},${t.z},${t.level}` : 'nowhere';
}

async function dump(makerPage: Page, custPage: Page, label: string): Promise<string> {
    const logs = (await makerLogs(makerPage)).slice(-26);
    const chat = await custPage.evaluate(() =>
        (globalThis as never as Abi).__rs2b0t.reader.chat(14).map(l => `${l.type}|${l.username ?? ''}|${l.text}`)
    );
    const [makerAt, custAt, state] = await Promise.all([
        where(makerPage),
        where(custPage),
        makerPage.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state)
    ]);
    return [
        label,
        `  maker at ${makerAt} (spot ${SPOT.x},${SPOT.z}), runner ${state}; customer at ${custAt}`,
        `  maker log: ${logs.join('\n             ')}`,
        `  chat seen: ${chat.join('\n             ')}`
    ].join('\n');
}

/** Request until the window opens; the engine refuses while the maker is at the bank. */
async function openTrade(page: Page, label: string): Promise<boolean> {
    for (let attempt = 0; attempt < 14; attempt++) {
        await page.evaluate(m => (globalThis as never as Abi).__rs2b0t.Trade.request(m), MAKER);
        for (let probe = 0; probe < 15; probe++) {
            if (await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.onOfferScreen())) {
                console.log(`${at()} ${label}: window open (request ${attempt + 1})`);
                return true;
            }
            await page.waitForTimeout(400);
        }
    }
    console.log(`${at()} ${label}: the window never opened`);
    return false;
}

async function offerItem(page: Page, give: { name: string; id: number; qty: number }): Promise<boolean> {
    return page.evaluate(g => (globalThis as never as Abi).__rs2b0t.Trade.offer(g.name, g.qty, i => i.id === g.id), give);
}

async function botSide(page: Page): Promise<Slot[]> {
    return page.evaluate(() =>
        (globalThis as never as Abi).__rs2b0t.Trade.theirOffer().map(s => ({ id: s.id, count: s.count }))
    );
}

async function waitBotSide(page: Page, want: (side: Slot[]) => boolean, ms: number, label: string): Promise<Slot[] | null> {
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

console.log(`marketmaker-aliases base=${base} maker=${MAKER} customer=${CUSTOMER} budget=${Math.round(BUDGET_MS / 1000)}s`);

const isolated = deployIsolatedClient('ma');
const browser = await launchBrowser({ swiftshader: true });

try {
    const makerPage = await (await browser.newContext()).newPage();
    const custPage = await (await browser.newContext()).newPage();

    console.log(`${at()} bring up maker '${MAKER}'`);
    await mainlandAccount(makerPage, base, MAKER, isolated.page);
    await maxmeAndClearDialogs(makerPage);
    await clearChatDialogs(makerPage);
    await cheatQuiet(makerPage, '~clearinv');
    // Why: two hides that read as one name in the client, so only the alias can tell the shop which is which.
    await cheatQuiet(makerPage, '~bankitem dragonhide_blue 120');
    await cheatQuiet(makerPage, '~bankitem dragonhide_green 120');
    await cheatQuiet(makerPage, '~bankitem keyhalf2 20');
    await cheatQuiet(makerPage, '~bankitem coins 500000');
    await teleArrive(makerPage, SPOT);

    await writeStorage(makerPage, {
        'rs2b0t:set:PriceBooks:books': BOOK,
        'rs2b0t:set:MarketMaker:priceBook': 'alias',
        'rs2b0t:set:MarketMaker:spot': `${SPOT.x},${SPOT.z},${SPOT.level}`,
        // Why: advertising off keeps the chat log readable while the legs run.
        'rs2b0t:set:MarketMaker:advertiseSeconds': '0',
        'rs2b0t:set:MarketMaker:engagementTimeoutSeconds': '120',
        'rs2b0t:set:MarketMaker:intentSeconds': '120',
        'rs2b0t:set:MarketMaker:cooldownSeconds': '10',
        'rs2b0t:set:MarketMaker:coinFloat': '200000'
    });

    console.log(`${at()} bring up customer '${CUSTOMER}'`);
    await mainlandAccount(custPage, base, CUSTOMER, isolated.page);
    await maxmeAndClearDialogs(custPage);
    await clearChatDialogs(custPage);
    await cheatQuiet(custPage, '~clearinv');
    await cheatQuiet(custPage, 'give coins 200000');
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

    // ---- leg 1: list carries only what the shop is holding ---------------
    const listed = await askForLines(custPage, 'list', 9_000);
    if (listed.length === 0) {
        fail(await dump(makerPage, custPage, 'list leg: the maker never answered "list"'));
    }
    const listText = listed.join(' ');
    if (/yew/i.test(listText)) {
        fail(await dump(makerPage, custPage, `list leg: named Yew logs, which the bank holds none of — ${listText}`));
    }
    if (!/blue dragonhide/i.test(listText) || !/green dragonhide/i.test(listText)) {
        fail(await dump(makerPage, custPage, `list leg: did not name both hides by colour — ${listText}`));
    }
    if (!/loop half of key/i.test(listText)) {
        fail(await dump(makerPage, custPage, `list leg: did not name the loop half — ${listText}`));
    }
    results.push('list named both hides by colour and the loop half, and left out the yew row it holds none of');
    console.log(`${at()} PASS leg 1: ${listText}`);
    await custPage.screenshot({ path: 'docs/e2e/marketmaker-aliases-list.png' });

    // ---- leg 2: a repeated name is answered with the words that split it --
    if (Date.now() > deadline) {
        fail('out of budget before the ambiguity leg');
    }
    const asked = await askUntilAnswered(custPage, 'buying 5 dragonhide', /which\?/i);
    if (asked === null) {
        fail(await dump(makerPage, custPage, 'ambiguity leg: the maker never asked which hide was meant'));
    }
    if (!/blue/i.test(asked) || !/green/i.test(asked)) {
        fail(await dump(makerPage, custPage, `ambiguity leg: asked without naming the colours — ${asked}`));
    }
    if (/#\d/.test(asked)) {
        fail(await dump(makerPage, custPage, `ambiguity leg: fell back to an id when a colour would do — ${asked}`));
    }
    results.push(`answered a repeated name with its colours: ${asked}`);
    console.log(`${at()} PASS leg 2: ${asked}`);
    await custPage.screenshot({ path: 'docs/e2e/marketmaker-aliases-which.png' });

    // ---- leg 3: the colour picks one obj out of the pair ------------------
    if (Date.now() > deadline) {
        fail('out of budget before the colour leg');
    }
    const blue0 = await heldOf(custPage, BLUE_HIDE, BLUE_HIDE_NOTE);
    const green0 = await heldOf(custPage, GREEN_HIDE, GREEN_HIDE_NOTE);

    const quoted = await askUntilAnswered(custPage, 'buying 5 blue dragonhide', /trade me|moment/i);
    if (quoted === null) {
        fail(await dump(makerPage, custPage, 'colour leg: the maker never quoted the blue hide'));
    }
    if (!/blue dragonhide/i.test(quoted)) {
        fail(await dump(makerPage, custPage, `colour leg: quoted without naming the colour — ${quoted}`));
    }
    if (!(await openTrade(custPage, 'colour'))) {
        fail(await dump(makerPage, custPage, 'colour leg: the window never opened'));
    }
    await offerItem(custPage, { name: 'Coins', id: COINS, qty: 5 * BLUE_SELL });
    if (!(await waitBotSide(custPage, s => unitsOn(s, BLUE_HIDE, BLUE_HIDE_NOTE) === 5, 60_000, 'colour'))) {
        fail(await dump(makerPage, custPage, 'colour leg: the maker never put up 5 blue dragonhide'));
    }
    const side = await botSide(custPage);
    if (unitsOn(side, GREEN_HIDE, GREEN_HIDE_NOTE) !== 0) {
        fail(await dump(makerPage, custPage, `colour leg: green hide crossed the window too — ${JSON.stringify(side)}`));
    }
    if (!(await settle(custPage, 'colour'))) {
        fail(await dump(makerPage, custPage, 'colour leg: the trade never completed'));
    }
    await custPage.waitForTimeout(2500);

    const blueGained = (await heldOf(custPage, BLUE_HIDE, BLUE_HIDE_NOTE)) - blue0;
    const greenGained = (await heldOf(custPage, GREEN_HIDE, GREEN_HIDE_NOTE)) - green0;
    if (blueGained !== 5 || greenGained !== 0) {
        fail(
            await dump(
                makerPage,
                custPage,
                `colour leg: expected +5 blue and +0 green, got +${blueGained} blue and +${greenGained} green`
            )
        );
    }
    results.push(`'buying 5 blue dragonhide' handed over obj ${BLUE_HIDE} and left obj ${GREEN_HIDE} alone`);
    console.log(`${at()} PASS leg 3: ${results[2]}`);

    // ---- leg 4: the key half the customer names is the one they get -------
    if (Date.now() > deadline) {
        fail('out of budget before the key-half leg');
    }
    const loop0 = await heldOf(custPage, LOOP_HALF, LOOP_HALF_NOTE);
    const keyQuote = await askUntilAnswered(custPage, 'buying 1 loop half of key', /trade me|moment/i);
    if (keyQuote === null) {
        fail(await dump(makerPage, custPage, 'key leg: the maker never quoted the loop half'));
    }
    if (!/loop half of key/i.test(keyQuote)) {
        fail(await dump(makerPage, custPage, `key leg: quoted without naming the half — ${keyQuote}`));
    }
    if (!(await openTrade(custPage, 'key half'))) {
        fail(await dump(makerPage, custPage, 'key leg: the window never opened'));
    }
    await offerItem(custPage, { name: 'Coins', id: COINS, qty: LOOP_SELL });
    if (!(await waitBotSide(custPage, s => unitsOn(s, LOOP_HALF, LOOP_HALF_NOTE) === 1, 60_000, 'key half'))) {
        fail(await dump(makerPage, custPage, 'key leg: the maker never put up the loop half'));
    }
    if (!(await settle(custPage, 'key half'))) {
        fail(await dump(makerPage, custPage, 'key leg: the trade never completed'));
    }
    await custPage.waitForTimeout(2500);
    if ((await heldOf(custPage, LOOP_HALF, LOOP_HALF_NOTE)) - loop0 !== 1) {
        fail(await dump(makerPage, custPage, 'key leg: the loop half never arrived'));
    }
    results.push(`'buying 1 loop half of key' handed over obj ${LOOP_HALF}, which shares its name with obj 985`);
    console.log(`${at()} PASS leg 4: ${results[3]}`);

    // ---- leg 5: the shop goes back to its pitch, not the booth ------------
    if (Date.now() > deadline) {
        fail('out of budget before the pitch leg');
    }
    const banked = (await makerLogs(makerPage)).some(m => /bank/i.test(m));
    let home: Tile | null = null;
    for (let probe = 0; probe < 40; probe++) {
        home = await tileOf(makerPage);
        if (home && Math.max(Math.abs(home.x - SPOT.x), Math.abs(home.z - SPOT.z)) <= 1) {
            break;
        }
        await makerPage.waitForTimeout(1500);
    }
    if (!home) {
        fail(await dump(makerPage, custPage, 'pitch leg: could not read the maker tile'));
    }
    const drift = Math.max(Math.abs(home.x - SPOT.x), Math.abs(home.z - SPOT.z));
    if (drift > 1) {
        fail(await dump(makerPage, custPage, `pitch leg: settled ${drift} tiles from the pitch at ${home.x},${home.z}`));
    }
    if (home.z >= COUNTER_Z) {
        fail(await dump(makerPage, custPage, `pitch leg: settled on the booth counter row at ${home.x},${home.z}`));
    }
    results.push(`came back to ${home.x},${home.z}, ${drift} from the pitch and clear of the counter${banked ? ' after banking' : ''}`);
    console.log(`${at()} PASS leg 5: ${results[4]}`);
    await makerPage.screenshot({ path: 'docs/e2e/marketmaker-aliases-pitch.png' });

    console.log(`PASS: ${results.join(', ')}`);
    process.exit(0);
} finally {
    await browser.close();
    isolated.cleanup();
}
