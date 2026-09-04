/** Live proof for JiveMarketDumper: a MarketMaker at Seers bank with a two-row book, a customer whose bank holds both rows and something the book does not buy.
 *  Why: the window, the maker's pricing and the notes withdrawal all drive two live clients, so this run is the only proof the bank empties into the maker at the book price and the run stops when nothing it buys is left. */

// Usage: HEADED=1 bun e2e/jivemarketdumper-live.ts [--base url] [--minutes n] [--no-deploy]
import type { Page } from 'playwright-core';
import { deployIsolatedClient, fail, launchBrowser, requireSim, stopScript } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, maxmeAndClearDialogs, startScript } from './tutorial/harness.js';

interface Args {
    base: string;
    minutes: number;
    deploy: boolean;
}

function parse(argv: readonly string[]): Args {
    const out: Args = { base: process.env.BASE ?? 'http://localhost:8890', minutes: 8, deploy: true };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--minutes') { out.minutes = Number(value); }
    }
    if (!Number.isFinite(out.minutes) || out.minutes <= 0) { fail(`--minutes takes a positive number, got '${out.minutes}'`); }
    return out;
}

const args = parse(process.argv.slice(2));
const stamp = Date.now().toString(36).slice(-6);
const MAKER = `mm${stamp}`;
const CUSTOMER = `md${stamp}`;

interface Point { x: number; z: number; level: number }

/** The middle of the Seers bank floor, the maker's default stand. */
const SPOT: Point = { x: 2725, z: 3491, level: 0 };
const IRON = 440;
const YEW = 1515;
const CAP = 100_000;
const YEW_BUY = 288;
const IRON_BUY = 18;
const SEED_YEWS = 500;
const SEED_IRON = 1000;
/** Everything the book buys, at the buy price: two piles under the cap, then nothing left. */
const EXPECTED_GP = SEED_YEWS * YEW_BUY + SEED_IRON * IRON_BUY;
const POLL_MS = 2000;
const SCREENSHOT = 'docs/e2e/jivemarketdumper-live.png';

const BOOK = JSON.stringify([{
    name: 'e2e',
    margin: 20,
    maxTradeValue: CAP,
    rows: [
        { id: IRON, mid: 20, cap: 4_000, buying: true, selling: true },
        { id: YEW, mid: 320, cap: 2_000, buying: true, selling: true }
    ]
}]);

const SALE = /^\[dumper\] sold (.+?) for ([\d,]+)gp$/;

interface Snapshot {
    pos: Point | null;
    coins: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

const fmt = (p: Point | null): string => (p ? `(${p.x},${p.z},${p.level})` : '(?)');

function teleCmd(t: Point): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: Point): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let probe = 0; probe < 12; probe++) {
            const t = await page.evaluate(() => (globalThis as never as { __rs2b0t: { reader: { worldTile(): Point | null } } }).__rs2b0t.reader.worldTile());
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

async function runnerLogs(page: Page, n = 12): Promise<string[]> {
    return page.evaluate(k => ((globalThis as never as { rs2b0t: { runner: { ctx?: { log?: { msg: string }[] } | null } } }).rs2b0t.runner.ctx?.log ?? []).slice(-k).map(l => l.msg), n);
}

await requireSim(args.base);
const client = args.deploy ? deployIsolatedClient(`md${stamp}`) : null;
const browser = await launchBrowser({ swiftshader: true });
try {
    const makerPage = await (await browser.newContext()).newPage();
    const custPage = await (await browser.newContext()).newPage();
    makerPage.on('pageerror', e => console.log(`maker pageerror: ${e}`));
    custPage.on('pageerror', e => console.log(`customer pageerror: ${e}`));

    console.log(`bringing up the maker '${MAKER}'`);
    await mainlandAccount(makerPage, args.base, MAKER, client?.page);
    await maxmeAndClearDialogs(makerPage);
    await clearChatDialogs(makerPage);
    await cheatQuiet(makerPage, '~clearinv');
    await cheatQuiet(makerPage, '~bankitem coins 500000');
    await teleArrive(makerPage, SPOT);
    await writeStorage(makerPage, {
        'rs2b0t:set:PriceBooks:books': BOOK,
        'rs2b0t:set:MarketMaker:priceBook': 'e2e',
        'rs2b0t:set:MarketMaker:spot': `${SPOT.x},${SPOT.z},${SPOT.level}`,
        'rs2b0t:set:MarketMaker:advertiseSeconds': '0',
        'rs2b0t:set:MarketMaker:engagementTimeoutSeconds': '120',
        'rs2b0t:set:MarketMaker:cooldownSeconds': '15',
        'rs2b0t:set:MarketMaker:coinFloat': '200000'
    });

    console.log(`bringing up the customer '${CUSTOMER}'`);
    await mainlandAccount(custPage, args.base, CUSTOMER, client?.page);
    await maxmeAndClearDialogs(custPage);
    await clearChatDialogs(custPage);
    await cheatQuiet(custPage, '~clearinv');
    await cheatQuiet(custPage, `~bankitem yew_logs ${SEED_YEWS}`);
    await cheatQuiet(custPage, `~bankitem iron_ore ${SEED_IRON}`);
    // Why: not in the book, so it has to stay in the bank while the run still ends with "nothing it buys".
    await cheatQuiet(custPage, '~bankitem rune_chainbody 2');
    await teleArrive(custPage, SPOT);
    await writeStorage(custPage, {
        'rs2b0t:set:PriceBooks:books': BOOK,
        'rs2b0t:set:JiveMarketDumper:maker': MAKER,
        'rs2b0t:set:JiveMarketDumper:priceBook': 'e2e',
        'rs2b0t:set:JiveMarketDumper:maxPerTrade': String(CAP)
    });

    await startScript(makerPage, 'MarketMaker');
    console.log('MarketMaker started, waiting for its ledger and coin float');
    await makerPage.waitForTimeout(25_000);
    const makerState = await makerPage.evaluate(() => (globalThis as never as { rs2b0t: { runner: { state: string } } }).rs2b0t.runner.state);
    if (makerState !== 'running') {
        fail(`MarketMaker did not stay up (${makerState}): ${(await runnerLogs(makerPage, 4)).join(' | ')}`);
    }

    const read = (): Promise<Snapshot> =>
        custPage.evaluate((): Snapshot => {
            const g = globalThis as never as {
                __rs2b0t: { Inventory: { countById(id: number): number } };
                rs2b0t: {
                    runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } };
                    reader: { worldTile(): Point | null };
                };
            };
            return {
                pos: g.rs2b0t.reader.worldTile(),
                coins: g.__rs2b0t.Inventory.countById(995),
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-80)
            };
        });

    await startScript(custPage, 'JiveMarketDumper');
    console.log(`started JiveMarketDumper against ${MAKER}, watching`);

    const t0 = Date.now();
    const deadline = t0 + args.minutes * 60_000;
    let last = await read();
    let lastLogTime = 0;
    let sales = 0;
    let gp = 0;
    let stopReason = '';
    let shotTaken = false;

    while (Date.now() < deadline) {
        await custPage.waitForTimeout(POLL_MS);
        last = await read();
        const fresh = last.logs.filter(l => l.time > lastLogTime);
        for (const line of fresh) {
            console.log(`      · [${line.level}] ${line.msg}`);
            const sale = SALE.exec(line.msg);
            if (sale) {
                sales++;
                gp += Number(sale[2]!.replace(/,/g, ''));
            }
            // Why: the runner prefixes its own stop line, so the reason is matched anywhere in the line rather than at its start.
            if (/\[dumper\] the bank holds nothing/.test(line.msg)) {
                stopReason = line.msg;
            }
        }
        if (fresh.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...fresh.map(l => l.time));
        }
        console.log(`  t=${Math.round((Date.now() - t0) / 1000)}s pos=${fmt(last.pos)} coins=${last.coins} sales=${sales} gp=${gp} runner=${last.runner}`);

        // Why: the overlay only paints while the script runs, so the proof frame is taken after the first sale, with the pile and the takings on it.
        if (!shotTaken && sales >= 1) {
            await custPage.screenshot({ path: SCREENSHOT });
            shotTaken = true;
        }
        if (last.runner === 'stopped') {
            console.log('  runner stopped');
            break;
        }
    }

    if (!shotTaken) {
        await custPage.screenshot({ path: SCREENSHOT });
    }
    if (last.runner !== 'stopped') {
        await stopScript(custPage);
    }
    await stopScript(makerPage);
    console.log(`final: sales=${sales} gp=${gp} expected=${EXPECTED_GP} runner=${last.runner}`);

    const tail = async (): Promise<string> => `customer: ${last.logs.slice(-6).map(l => l.msg).join(' | ')}\n  maker: ${(await runnerLogs(makerPage, 8)).join(' | ')}`;
    if (sales < 2) {
        fail(`only ${sales} sale(s), so the bank never emptied in piles under the cap: ${await tail()}`);
    }
    if (gp !== EXPECTED_GP) {
        fail(`took ${gp}gp for stock worth ${EXPECTED_GP}gp at the book's buy prices: ${await tail()}`);
    }
    if (last.runner !== 'stopped' || stopReason === '') {
        fail(`the run did not stop on an empty bank: ${await tail()}`);
    }
    console.log(`PASS, ${sales} sales took ${gp.toLocaleString()}gp for every yew log and iron ore in the bank, then stopped: ${stopReason.replace(/^\[dumper\] /, '')}`);
} finally {
    client?.cleanup();
    await browser.close();
}
