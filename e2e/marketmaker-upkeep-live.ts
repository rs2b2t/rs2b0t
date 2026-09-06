/** The three things a MarketMaker operator sees go wrong, proven on a live shop at Seers bank:
 *  the stall guard restarting a healthy shop, the order book jumping back to row one on every
 *  edit, and the shop's own chat never reaching the client that is saying it. */

// Usage:
//   bun e2e/marketmaker-upkeep-live.ts
//   BASE=http://localhost:8890 IDLE_MIN=12 SHOP=upkeepshop bun e2e/marketmaker-upkeep-live.ts

import { readFileSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { deployIsolatedClient, fail, launchBrowser, logout } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, maxmeAndClearDialogs, startScript } from './tutorial/harness.js';
import { MARKET_PRICES } from '../src/bot/data/marketprices.js';

const BASE = process.env.BASE ?? 'http://localhost:8890';
const SHOP = process.env.SHOP ?? 'upkeepshop';
const SPOT = { x: 2725, z: 3491, level: 0 } as const;
const TICK_MS = Number(process.env.TICK_MS) || 600;
/** Supervisor's WEDGE_MS is 10 minutes, so the watch has to outlast it with room to spare. */
const IDLE_MIN = process.env.IDLE_MIN === undefined ? 12 : Number(process.env.IDLE_MIN);
const ADVERTISE_S = 30;

const BOOK = 'upkeep';
const BANK_COINS = 2_000_000;
/** Enough rows that the table scrolls well past its 46vh box, and enough shared words that the filter has work to do. */
// Why: the panel draws an item icon per row, and ObjType.getSprite builds the model the first time it is asked, so a freshly booted client pays for every row at once and a full book stalls the page under software GL.
const BOOK_ROWS = Number(process.env.BOOK_ROWS) || 40;
/** A window rather than the head of the list, so the two Rune plates the fuzzy query aims at are in the book. */
const ROWS = MARKET_PRICES.slice(50, 50 + BOOK_ROWS);

interface Abi {
    __rs2b0t: {
        reader: {
            worldTile(): { x: number; z: number; level: number } | null;
            chat(n: number): { type: number; username: string | null; text: string }[];
            localPlayerName(): string | null;
        };
    };
    rs2b0t: {
        runner: { state: string; ctx?: { log?: { msg: string }[]; loopCount: number } | null };
        registry: { get(n: string): unknown };
    };
}

const style = /<style>([\s\S]*?)<\/style>/.exec(readFileSync('public-bot/bot.html', 'utf8'))?.[1] ?? '';

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
    fail(`upkeep: could not tele the shop to ${SPOT.x},${SPOT.z}`);
}

async function seed(page: Page): Promise<void> {
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
                rows: ROWS.map(r => ({ id: r.id, mid: r.mid, cap: 1000, buying: true, selling: true }))
            }]),
            settings: {
                priceBook: BOOK,
                spot: `${SPOT.x},${SPOT.z},${SPOT.level}`,
                advertiseSeconds: String(ADVERTISE_S),
                engagementTimeoutSeconds: '90',
                intentSeconds: '90',
                cooldownSeconds: '15',
                coinFloat: '200000'
            } as Record<string, string>
        }
    );
}

/** Reach the panel the operator reaches, through the button that opens it. */
// Why: the isolated deploy repoints the script tag inside the engine's own bot.html and never copies this repo's copy, so the panel's stylesheet has to be injected or the new rows render unstyled.
async function openOrderBooks(page: Page): Promise<void> {
    console.log(`  panel: injecting ${style.length} bytes of panel css`);
    await page.addStyleTag({ content: style });

    console.log('  panel: clicking "Order books"');
    const opened = await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Order books');
        btn?.click();
        return Boolean(btn);
    });
    if (!opened) {
        fail('upkeep: no "Order books" button in the bot panel');
    }
    await page.waitForTimeout(600);
    console.log('  panel: open');
}

interface BookView {
    rows: number;
    first: string;
    scrollTop: number;
    /** How far the table could scroll, so a held offset can be read against the room it had. */
    scrollMax: number;
    focused: string | null;
    caret: number | null;
}

function readBook(page: Page): Promise<BookView> {
    return page.evaluate(() => {
        const table = document.querySelector('.rs2b0t-pricebook-table') as HTMLElement | null;
        const names = Array.from(document.querySelectorAll('.rs2b0t-pricebook-table .rs2b0t-pricebook-name'));
        const active = document.activeElement as HTMLElement | null;
        const row = active?.closest('[data-item]') as HTMLElement | null;
        return {
            rows: names.length,
            first: names[0]?.textContent ?? '',
            scrollTop: table?.scrollTop ?? -1,
            scrollMax: table ? table.scrollHeight - table.clientHeight : -1,
            focused: active?.dataset.role ? `${row?.dataset.item ?? '-'}:${active.dataset.role}` : null,
            caret: active instanceof HTMLInputElement && active.type === 'text' ? active.selectionStart : null
        };
    });
}

const isolated = deployIsolatedClient('mmupkeep');
const browser = await launchBrowser({ swiftshader: true });
let shopPage: Page | null = null;

try {
    const page = await (await browser.newContext()).newPage();
    shopPage = page;
    // Why: every wait below is a Playwright auto-wait, and the default is no deadline at all on some of them, so a hang reads as a run that is still going.
    page.setDefaultTimeout(45_000);

    await mainlandAccount(page, BASE, SHOP, isolated.page);
    await maxmeAndClearDialogs(page);
    await clearChatDialogs(page);
    await cheatQuiet(page, `speed ${TICK_MS}`);

    console.log(`upkeep: seeding the bank and a ${ROWS.length}-row book`);
    await cheatQuiet(page, '~clearinv');
    await cheatQuiet(page, `~bankitem coins ${BANK_COINS}`);
    await cheatQuiet(page, '~bankitem iron_ore 2000');
    await cheatQuiet(page, '~bankitem yew_logs 500');
    await seed(page);
    await teleArrive(page);

    // ---- the order book panel --------------------------------------------
    console.log('upkeep: opening the order book');
    const openedAt = Date.now();
    await openOrderBooks(page);
    console.log(`  panel: open took ${Math.round((Date.now() - openedAt) / 1000)}s`);

    const whole = await readBook(page);
    console.log(`  panel: ${whole.rows} rows, led by '${whole.first}'`);
    if (whole.rows !== ROWS.length) {
        fail(`upkeep: the book shows ${whole.rows} rows, not the ${ROWS.length} seeded`);
    }
    if (whole.first.startsWith('item ')) {
        fail(`upkeep: the book is showing raw ids ('${whole.first}'), so the obj catalogue never loaded`);
    }
    await page.screenshot({ path: 'docs/e2e/marketmaker-orderbook-unfiltered.png' });
    console.log('  panel: unfiltered shot written');

    console.log('upkeep: filtering on letters in order');
    await page.click('[data-role=book-filter]');
    await page.type('[data-role=book-filter]', 'rnplt', { delay: 120 });
    await page.waitForTimeout(400);

    const fuzzy = await readBook(page);
    if (fuzzy.rows === 0 || fuzzy.rows >= whole.rows) {
        fail(`upkeep: 'rnplt' left ${fuzzy.rows} of ${whole.rows} rows, so the filter did nothing`);
    }
    if (!/^Rune plate/.test(fuzzy.first)) {
        fail(`upkeep: 'rnplt' kept rows but the first is '${fuzzy.first}', not a Rune plate`);
    }
    if (fuzzy.caret !== 5 || fuzzy.focused !== '-:book-filter') {
        fail(`upkeep: the caret left the filter box mid-type (focus=${fuzzy.focused}, caret=${fuzzy.caret})`);
    }
    console.log(`upkeep: 'rnplt' narrowed ${whole.rows} rows to ${fuzzy.rows} led by '${fuzzy.first}', caret held at ${fuzzy.caret}`);
    await page.screenshot({ path: 'docs/e2e/marketmaker-orderbook-filtered.png' });

    console.log('upkeep: editing a row far down a scrolled table');
    await page.fill('[data-role=book-filter]', '');
    await page.waitForTimeout(400);
    // Why: the panel fills item icons in over several passes and a row without one is shorter, so measuring before they land reads a table at a fraction of its length.
    let settled = -1;
    for (let probe = 0; probe < 20; probe++) {
        const height = await page.evaluate(
            () => (document.querySelector('.rs2b0t-pricebook-table') as HTMLElement | null)?.scrollHeight ?? 0
        );
        if (height === settled) {
            break;
        }
        settled = height;
        await page.waitForTimeout(700);
    }
    console.log(`  panel: row heights settled at ${settled}px of content`);

    const target = ROWS[ROWS.length - 1].id;
    // Why: page.fill scrolls its target into view and fires its own change, so it would move the table and commit the edit before the measurement, and the panel would be blamed for both.
    const edit = await page.evaluate(id => {
        const geom = (): { top: number; max: number } => {
            const t = document.querySelector('.rs2b0t-pricebook-table') as HTMLElement;
            return { top: t.scrollTop, max: t.scrollHeight - t.clientHeight };
        };
        const cell = document.querySelector(`[data-item="${id}"] [data-role=mid]`) as HTMLInputElement;
        cell.focus();
        (document.querySelector('.rs2b0t-pricebook-table') as HTMLElement).scrollTop = 1e6;
        const before = geom();
        cell.value = '4321';
        cell.dispatchEvent(new Event('change'));
        const after = document.activeElement as HTMLElement | null;
        const row = after?.closest('[data-item]') as HTMLElement | null;
        return {
            before,
            after: geom(),
            focused: after?.dataset.role ? `${row?.dataset.item ?? '-'}:${after.dataset.role}` : null
        };
    }, target);

    console.log(
        `  panel: scrolled to ${edit.before.top} of ${edit.before.max}, edited, ` +
            `left at ${edit.after.top} of ${edit.after.max} with the cursor in ${edit.focused}`
    );
    if (edit.before.max <= 0 || edit.before.top < edit.before.max) {
        fail(`upkeep: the table was at ${edit.before.top} of ${edit.before.max}, so holding its offset proves nothing`);
    }
    if (edit.after.top !== edit.before.top) {
        fail(`upkeep: the table jumped from ${edit.before.top} to ${edit.after.top} on an edit`);
    }
    if (edit.focused !== `${target}:mid`) {
        fail(`upkeep: focus left the edited cell (now ${edit.focused})`);
    }

    const saved = await page.evaluate(
        ({ book, id }) => {
            const raw = sessionStorage.getItem('rs2b0t:set:PriceBooks:books') ?? '[]';
            const books = JSON.parse(raw) as { name: string; rows: { id: number; mid: number }[] }[];
            return books.find(b => b.name === book)?.rows.find(r => r.id === id)?.mid ?? -1;
        },
        { book: BOOK, id: target }
    );
    if (saved !== 4321) {
        fail(`upkeep: the edit did not reach the book (mid=${saved})`);
    }
    console.log(`upkeep: edit held scrollTop ${edit.after.top} and focus on ${edit.focused}, book saved mid=${saved}`);

    await page.evaluate(() => {
        (document.querySelector('.rs2b0t-pricebook [data-action=close]') as HTMLButtonElement | null)?.click();
    });
    await page.waitForTimeout(400);

    // ---- the shop's own chat ---------------------------------------------
    if (!(await page.evaluate(() => Boolean((globalThis as never as Abi).rs2b0t.registry.get('MarketMaker'))))) {
        fail('upkeep: MarketMaker is missing from the registry — the deployed bundle is stale');
    }
    await startScript(page, 'MarketMaker');
    await page.waitForTimeout(8_000);

    const state = await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state);
    if (state !== 'running') {
        const log = await page.evaluate(() =>
            ((globalThis as never as Abi).rs2b0t.runner.ctx?.log ?? []).slice(-4).map(l => l.msg)
        );
        fail(`upkeep: the shop did not stay up (${state}): ${log.join(' | ')}`);
    }

    console.log(`upkeep: waiting up to ${ADVERTISE_S * 2}s for the shop to advertise, and reading its own chat back`);
    let heard = '';
    for (let probe = 0; probe < ADVERTISE_S * 2 && heard === ''; probe++) {
        heard = await page.evaluate(() => {
            const { reader } = (globalThis as never as Abi).__rs2b0t;
            const me = (reader.localPlayerName() ?? '').toLowerCase();
            const mine = reader.chat(20).find(l => (l.username ?? '').toLowerCase() === me && l.text.length > 0);
            return mine?.text ?? '';
        });
        if (heard === '') {
            await page.waitForTimeout(1_000);
        }
    }
    if (heard === '') {
        fail('upkeep: the shop said nothing its own client could read');
    }
    console.log(`upkeep: the shop hears itself — "${heard}"`);
    await page.screenshot({ path: 'docs/e2e/marketmaker-hears-itself.png' });

    // ---- the stall guard --------------------------------------------------
    console.log(
        IDLE_MIN === 0
            ? 'upkeep: IDLE_MIN=0, skipping the wedge watch'
            : `upkeep: standing the shop still for ${IDLE_MIN}min, past the 10min wedge`
    );
    const deadline = Date.now() + IDLE_MIN * 60_000;
    let loops = 0;
    while (Date.now() < deadline) {
        await page.waitForTimeout(30_000);
        const snap = await page.evaluate(() => {
            const { runner } = (globalThis as never as Abi).rs2b0t;
            const log = runner.ctx?.log ?? [];
            return {
                state: runner.state,
                loops: runner.ctx?.loopCount ?? 0,
                guard: log.filter(l => /stall guard|watchdog/i.test(l.msg)).map(l => l.msg)
            };
        });
        if (snap.guard.length > 0) {
            fail(`upkeep: the stall guard fired on an idle shop — ${snap.guard.join(' | ')}`);
        }
        if (snap.state !== 'running') {
            fail(`upkeep: the shop stopped on its own (${snap.state})`);
        }
        if (snap.loops <= loops) {
            fail(`upkeep: the loop counter reset from ${loops} to ${snap.loops}, so the script restarted`);
        }
        loops = snap.loops;
        const standing = (IDLE_MIN * 60_000 - (deadline - Date.now())) / 60_000;
        console.log(`  +${standing.toFixed(1)}min standing still, running, loop ${loops}, no watchdog line`);
    }

    console.log(
        `PASS marketmaker-upkeep-live: ${IDLE_MIN}min idle with no stall-guard restart (loop ${loops}), ` +
            `the shop read its own line back, and the order book filtered ${whole.rows} rows to ${fuzzy.rows} ` +
            `while holding scrollTop ${edit.after.top} of ${edit.after.max} and the caret through an edit`
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
