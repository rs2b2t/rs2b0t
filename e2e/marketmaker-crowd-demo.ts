/** A crowd of customer bots trading against one MarketMaker at Seers bank, so the shop meets a busy
 *  day instead of one polite customer: 80 items on both sides of the book, buys and sells running at
 *  once, and customers who walk out mid-trade.
 *  Not a test: it asserts nothing, runs until its budget or Ctrl-C, and prints what each side did. */

// Usage:
//   bun e2e/marketmaker-crowd-demo.ts
//   BASE=http://localhost:8890 CUSTOMERS=4 BUDGET_S=1800 SEED=7 bun e2e/marketmaker-crowd-demo.ts

import type { Page } from 'playwright-core';
import { deployIsolatedClient, launchBrowser, logout } from './lib/harness.js';
import { cheatQuiet, clearChatDialogs, mainlandAccount, maxmeAndClearDialogs, startScript } from './tutorial/harness.js';

const BASE = process.env.BASE ?? 'http://localhost:8890';
const SHOP = process.env.SHOP ?? 'crowdshop';
const CUSTOMERS = Math.max(1, Number(process.env.CUSTOMERS) || 4);
/** 0 runs until Ctrl-C. */
const BUDGET_MS = (Number(process.env.BUDGET_S) || 0) * 1000;
const TICK_MS = Number(process.env.TICK_MS) || 600;
const SEED = Number(process.env.SEED) || 20260825;

const SPOT = { x: 2725, z: 3491, level: 0 } as const;
const COINS = 995;

const MARGIN = 20;
const MAX_TRADE = 500_000;
const BANK_COINS = 10_000_000;
const COIN_FLOAT = 600_000;
/** Under the shop's own limit of 3 commands per 10s, so no customer talks itself into the penalty box. */
const SAY_GAP_MS = 12_000;
/** What one customer trades at a time. Well under the float, so several trades fit between bank trips. */
const TRADE_VALUE = 60_000;

interface Stock {
    obj: string;
    id: number;
    /** The noted form, or -1 where the item has none. */
    note: number;
    name: string;
    mid: number;
    bank: number;
    cap: number;
}

// Why: ids, names and values come from the engine's own obj configs, so the book prices what the game prices.
const STOCK: Stock[] = [
    { obj: 'iron_ore', id: 440, note: 441, name: 'Iron ore', mid: 17, bank: 10000, cap: 100000 },
    { obj: 'coal', id: 453, note: 454, name: 'Coal', mid: 45, bank: 10000, cap: 100000 },
    { obj: 'copper_ore', id: 436, note: 437, name: 'Copper ore', mid: 3, bank: 10000, cap: 100000 },
    { obj: 'tin_ore', id: 438, note: 439, name: 'Tin ore', mid: 3, bank: 10000, cap: 100000 },
    { obj: 'mithril_ore', id: 447, note: 448, name: 'Mithril ore', mid: 162, bank: 2000, cap: 20000 },
    { obj: 'adamantite_ore', id: 449, note: 450, name: 'Adamantite ore', mid: 400, bank: 2000, cap: 20000 },
    { obj: 'gold_ore', id: 444, note: 445, name: 'Gold ore', mid: 150, bank: 2000, cap: 20000 },
    { obj: 'silver_ore', id: 442, note: 443, name: 'Silver ore', mid: 75, bank: 2000, cap: 20000 },
    { obj: 'bronze_bar', id: 2349, note: 2350, name: 'Bronze bar', mid: 8, bank: 10000, cap: 100000 },
    { obj: 'iron_bar', id: 2351, note: 2352, name: 'Iron bar', mid: 28, bank: 10000, cap: 100000 },
    { obj: 'steel_bar', id: 2353, note: 2354, name: 'Steel bar', mid: 100, bank: 2000, cap: 20000 },
    { obj: 'mithril_bar', id: 2359, note: 2360, name: 'Mithril bar', mid: 300, bank: 2000, cap: 20000 },
    { obj: 'adamantite_bar', id: 2361, note: 2362, name: 'Adamantite bar', mid: 640, bank: 500, cap: 5000 },
    { obj: 'gold_bar', id: 2357, note: 2358, name: 'Gold bar', mid: 300, bank: 2000, cap: 20000 },
    { obj: 'silver_bar', id: 2355, note: 2356, name: 'Silver bar', mid: 150, bank: 2000, cap: 20000 },
    { obj: 'logs', id: 1511, note: 1512, name: 'Logs', mid: 4, bank: 10000, cap: 100000 },
    { obj: 'oak_logs', id: 1521, note: 1522, name: 'Oak logs', mid: 20, bank: 10000, cap: 100000 },
    { obj: 'willow_logs', id: 1519, note: 1520, name: 'Willow logs', mid: 40, bank: 10000, cap: 100000 },
    { obj: 'maple_logs', id: 1517, note: 1518, name: 'Maple logs', mid: 80, bank: 2000, cap: 20000 },
    { obj: 'yew_logs', id: 1515, note: 1516, name: 'Yew logs', mid: 160, bank: 2000, cap: 20000 },
    { obj: 'magic_logs', id: 1513, note: 1514, name: 'Magic logs', mid: 320, bank: 2000, cap: 20000 },
    { obj: 'raw_lobster', id: 377, note: 378, name: 'Raw lobster', mid: 150, bank: 2000, cap: 20000 },
    { obj: 'raw_swordfish', id: 371, note: 372, name: 'Raw swordfish', mid: 200, bank: 2000, cap: 20000 },
    { obj: 'raw_shark', id: 383, note: 384, name: 'Raw shark', mid: 300, bank: 2000, cap: 20000 },
    { obj: 'raw_tuna', id: 359, note: 360, name: 'Raw tuna', mid: 100, bank: 2000, cap: 20000 },
    { obj: 'lobster', id: 379, note: 380, name: 'Lobster', mid: 150, bank: 2000, cap: 20000 },
    { obj: 'swordfish', id: 373, note: 374, name: 'Swordfish', mid: 200, bank: 2000, cap: 20000 },
    { obj: 'tuna', id: 361, note: 362, name: 'Tuna', mid: 100, bank: 2000, cap: 20000 },
    { obj: 'shark', id: 385, note: 386, name: 'Shark', mid: 300, bank: 2000, cap: 20000 },
    { obj: 'trout', id: 333, note: 334, name: 'Trout', mid: 20, bank: 10000, cap: 100000 },
    { obj: 'salmon', id: 329, note: 330, name: 'Salmon', mid: 50, bank: 10000, cap: 100000 },
    { obj: 'naturerune', id: 561, note: -1, name: 'Nature rune', mid: 20, bank: 10000, cap: 100000 },
    { obj: 'lawrune', id: 563, note: -1, name: 'Law rune', mid: 40, bank: 10000, cap: 100000 },
    { obj: 'deathrune', id: 560, note: -1, name: 'Death rune', mid: 30, bank: 10000, cap: 100000 },
    { obj: 'bloodrune', id: 565, note: -1, name: 'Blood rune', mid: 50, bank: 10000, cap: 100000 },
    { obj: 'chaosrune', id: 562, note: -1, name: 'Chaos rune', mid: 15, bank: 10000, cap: 100000 },
    { obj: 'cosmicrune', id: 564, note: -1, name: 'Cosmic rune', mid: 15, bank: 10000, cap: 100000 },
    { obj: 'airrune', id: 556, note: -1, name: 'Air rune', mid: 4, bank: 10000, cap: 100000 },
    { obj: 'earthrune', id: 557, note: -1, name: 'Earth rune', mid: 4, bank: 10000, cap: 100000 },
    { obj: 'firerune', id: 554, note: -1, name: 'Fire rune', mid: 4, bank: 10000, cap: 100000 },
    { obj: 'waterrune', id: 555, note: -1, name: 'Water rune', mid: 4, bank: 10000, cap: 100000 },
    { obj: 'mindrune', id: 558, note: -1, name: 'Mind rune', mid: 3, bank: 10000, cap: 100000 },
    { obj: 'rune_scimitar', id: 1333, note: 1334, name: 'Rune scimitar', mid: 25600, bank: 50, cap: 500 },
    { obj: 'rune_platebody', id: 1127, note: 1128, name: 'Rune platebody', mid: 65000, bank: 50, cap: 500 },
    { obj: 'rune_platelegs', id: 1079, note: 1080, name: 'Rune platelegs', mid: 64000, bank: 50, cap: 500 },
    { obj: 'rune_kiteshield', id: 1201, note: 1202, name: 'Rune kiteshield', mid: 54400, bank: 50, cap: 500 },
    { obj: 'rune_full_helm', id: 1163, note: 1164, name: 'Rune full helm', mid: 35200, bank: 50, cap: 500 },
    { obj: 'adamant_scimitar', id: 1331, note: 1332, name: 'Adamant scimitar', mid: 2560, bank: 500, cap: 5000 },
    { obj: 'mithril_scimitar', id: 1329, note: 1330, name: 'Mithril scimitar', mid: 1040, bank: 500, cap: 5000 },
    { obj: 'steel_scimitar', id: 1325, note: 1326, name: 'Steel scimitar', mid: 400, bank: 2000, cap: 20000 },
    { obj: 'iron_scimitar', id: 1323, note: 1324, name: 'Iron scimitar', mid: 112, bank: 2000, cap: 20000 },
    { obj: 'bronze_scimitar', id: 1321, note: 1322, name: 'Bronze scimitar', mid: 32, bank: 10000, cap: 100000 },
    { obj: 'maple_longbow', id: 851, note: 852, name: 'Maple longbow', mid: 640, bank: 500, cap: 5000 },
    { obj: 'unstrung_maple_longbow', id: 62, note: 63, name: 'Maple longbow', mid: 320, bank: 2000, cap: 20000 },
    { obj: 'yew_longbow', id: 855, note: 856, name: 'Yew longbow', mid: 1280, bank: 500, cap: 5000 },
    { obj: 'willow_longbow', id: 847, note: 848, name: 'Willow longbow', mid: 320, bank: 2000, cap: 20000 },
    { obj: 'oak_longbow', id: 845, note: 846, name: 'Oak longbow', mid: 160, bank: 2000, cap: 20000 },
    { obj: 'bronze_arrow', id: 882, note: -1, name: 'Bronze arrow', mid: 1, bank: 10000, cap: 100000 },
    { obj: 'iron_arrow', id: 884, note: -1, name: 'Iron arrow', mid: 3, bank: 10000, cap: 100000 },
    { obj: 'steel_arrow', id: 886, note: -1, name: 'Steel arrow', mid: 12, bank: 10000, cap: 100000 },
    { obj: 'mithril_arrow', id: 888, note: -1, name: 'Mithril arrow', mid: 32, bank: 10000, cap: 100000 },
    { obj: 'adamant_arrow', id: 890, note: -1, name: 'Adamant arrow', mid: 80, bank: 2000, cap: 20000 },
    { obj: 'rune_arrow', id: 892, note: -1, name: 'Rune arrow', mid: 400, bank: 2000, cap: 20000 },
    { obj: 'uncut_sapphire', id: 1623, note: 1624, name: 'Uncut sapphire', mid: 25, bank: 10000, cap: 100000 },
    { obj: 'uncut_emerald', id: 1621, note: 1622, name: 'Uncut emerald', mid: 50, bank: 10000, cap: 100000 },
    { obj: 'uncut_ruby', id: 1619, note: 1620, name: 'Uncut ruby', mid: 100, bank: 2000, cap: 20000 },
    { obj: 'uncut_diamond', id: 1617, note: 1618, name: 'Uncut diamond', mid: 200, bank: 2000, cap: 20000 },
    { obj: 'sapphire', id: 1607, note: 1608, name: 'Sapphire', mid: 250, bank: 2000, cap: 20000 },
    { obj: 'emerald', id: 1605, note: 1606, name: 'Emerald', mid: 500, bank: 2000, cap: 20000 },
    { obj: 'ruby', id: 1603, note: 1604, name: 'Ruby', mid: 1000, bank: 500, cap: 5000 },
    { obj: 'diamond', id: 1601, note: 1602, name: 'Diamond', mid: 2000, bank: 500, cap: 5000 },
    { obj: 'dragonhide_green', id: 1753, note: 1754, name: 'Dragonhide', mid: 20, bank: 10000, cap: 100000 },
    { obj: 'dragonhide_blue', id: 1751, note: 1752, name: 'Dragonhide', mid: 40, bank: 10000, cap: 100000 },
    { obj: 'feather', id: 314, note: -1, name: 'Feather', mid: 2, bank: 10000, cap: 100000 },
    { obj: 'flax', id: 1779, note: 1780, name: 'Flax', mid: 5, bank: 10000, cap: 100000 },
    { obj: 'bow_string', id: 1777, note: 1778, name: 'Bow string', mid: 10, bank: 10000, cap: 100000 },
    { obj: 'egg', id: 1944, note: 1945, name: 'Egg', mid: 4, bank: 10000, cap: 100000 },
    { obj: 'cake', id: 1891, note: 1892, name: 'Cake', mid: 50, bank: 10000, cap: 100000 },
    { obj: 'meat_pizza', id: 2293, note: 2294, name: 'Meat pizza', mid: 50, bank: 10000, cap: 100000 },
    { obj: 'bass', id: 365, note: 366, name: 'Bass', mid: 120, bank: 2000, cap: 20000 }
];

type Slot = { id: number; count: number };
type Tile = { x: number; z: number; level: number };

type Abi = {
    __rs2b0t: {
        reader: {
            worldTile(): Tile | null;
            chat(n: number): { type: number; username: string | null; text: string }[];
        };
        Inventory: { used(): number; countById(id: number): number };
        Trade: {
            active(): boolean;
            onOfferScreen(): boolean;
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

interface Customer {
    name: string;
    page: Page;
    sold: number;
    bought: number;
    refused: number;
    busy: number;
    walkouts: number;
    gp: number;
    lastSayMs: number;
}

const t0 = Date.now();
const at = (): string => `[${Math.round((Date.now() - t0) / 1000)}s]`;

function gp(n: number): string {
    return n.toLocaleString('en-US');
}

/** Seeded, so a run that turns up a bug can be run again the same way. */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const rnd = mulberry32(SEED);

function pick<T>(xs: readonly T[]): T {
    return xs[Math.floor(rnd() * xs.length)];
}

function sellPrice(mid: number): number {
    const buy = Math.max(1, Math.floor((mid * (200 - MARGIN)) / 200));
    return Math.max(buy + 1, Math.ceil((mid * (200 + MARGIN)) / 200));
}

function teleCmd(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: Tile, within = 6): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let probe = 0; probe < 12; probe++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && t.level === spot.level && Math.max(Math.abs(t.x - spot.x), Math.abs(t.z - spot.z)) <= within) {
                await page.waitForTimeout(600);
                return true;
            }
            await page.waitForTimeout(350);
        }
    }
    return false;
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

// Why: a run that ends without a clean logout leaves the account in-world, and every name here is fixed, so the next run is refused for 60s at the login screen with a message about map lag.
async function bringUp(page: Page, name: string, clientPage: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            await mainlandAccount(page, BASE, name, clientPage);
            return;
        } catch (err) {
            if (attempt >= 3) {
                throw err;
            }
            console.log(`${at()} ${name}: login refused, waiting out the lock (try ${attempt}/3)`);
            await page.waitForTimeout(35_000);
        }
    }
}

function priceBook(): string {
    return JSON.stringify([{
        name: 'crowd',
        margin: MARGIN,
        maxTradeValue: MAX_TRADE,
        rows: STOCK.map(s => ({ id: s.id, mid: s.mid, cap: s.cap, buying: true, selling: true }))
    }]);
}

// ---- what a customer can do ---------------------------------------------

async function coinsHeld(page: Page): Promise<number> {
    return page.evaluate(id => (globalThis as never as Abi).__rs2b0t.Inventory.countById(id), COINS);
}

async function itemHeld(page: Page, item: Stock): Promise<number> {
    return page.evaluate(
        g => {
            const inv = (globalThis as never as Abi).__rs2b0t.Inventory;
            return inv.countById(g.id) + (g.note > 0 ? inv.countById(g.note) : 0);
        },
        { id: item.id, note: item.note }
    );
}

async function topUpCoins(c: Customer): Promise<number> {
    const held = await coinsHeld(c.page);
    if (held >= 300_000) {
        return held;
    }
    await cheatQuiet(c.page, 'give coins 1000000');
    return coinsHeld(c.page);
}

/** Request until the window opens. The shop serves one customer at a time, so a refusal means busy. */
async function openTrade(c: Customer): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
        await c.page.evaluate(m => (globalThis as never as Abi).__rs2b0t.Trade.request(m), SHOP);
        for (let probe = 0; probe < 10; probe++) {
            if (await c.page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.onOfferScreen())) {
                return true;
            }
            await c.page.waitForTimeout(400);
        }
    }
    c.busy++;
    return false;
}

async function tradeActive(page: Page): Promise<boolean> {
    return page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.active());
}

/** Accept until the window closes. The shop re-checks on the confirm screen before it confirms. */
async function settle(page: Page): Promise<boolean> {
    for (let i = 0; i < 26; i++) {
        if (!(await tradeActive(page))) {
            return true;
        }
        await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.accept());
        await page.waitForTimeout(900);
    }
    return !(await tradeActive(page));
}

async function abandon(page: Page): Promise<void> {
    if (await tradeActive(page)) {
        await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.decline());
        await page.waitForTimeout(600);
    }
}

/** Wait for the shop's side of the window to satisfy `want`, or the window to close. */
async function waitShopSide(page: Page, want: (side: Slot[]) => boolean, ms: number): Promise<Slot[] | null> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        if (!(await tradeActive(page))) {
            return null;
        }
        const side = await page.evaluate(() =>
            (globalThis as never as Abi).__rs2b0t.Trade.theirOffer().map(s => ({ id: s.id, count: Math.max(1, s.count) }))
        );
        if (want(side)) {
            return side;
        }
        await page.waitForTimeout(500);
    }
    return null;
}

async function chatMark(page: Page): Promise<string> {
    return page.evaluate(() => {
        const top = (globalThis as never as Abi).__rs2b0t.reader.chat(1)[0];
        return top ? `${top.type}|${top.username ?? ''}|${top.text}` : '';
    });
}

// Why: chat(20) is a rolling buffer, so a bare search matches the previous cycle's quote and the customer pays the wrong price.
async function waitShopLine(page: Page, re: RegExp, ms: number, mark: string): Promise<string | null> {
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
            [SHOP, re.source, mark] as [string, string, string]
        );
        if (hit) {
            return hit;
        }
        await page.waitForTimeout(600);
    }
    return null;
}

/** The shop's own log and pack, read from its page when a leg gives up on this side of the glass. */
let shopProbe: ((id: number) => Promise<string>) | null = null;

async function shopSays(id: number): Promise<string> {
    if (shopProbe === null) {
        return 'no probe';
    }
    try {
        return await shopProbe(id);
    } catch {
        return 'probe failed';
    }
}

/** The last few lines this customer heard, for when a leg gives up and the reason is in the shop's own words. */
async function heard(page: Page, n = 6): Promise<string> {
    const lines = await page.evaluate(
        count => (globalThis as never as Abi).__rs2b0t.reader.chat(count).map(l => `${l.username ?? ''}: ${l.text}`),
        n
    );
    return lines.reverse().join(' | ');
}

async function say(c: Customer, text: string): Promise<boolean> {
    const wait = SAY_GAP_MS - (Date.now() - c.lastSayMs);
    if (wait > 0) {
        await c.page.waitForTimeout(wait);
    }
    c.lastSayMs = Date.now();
    return c.page.evaluate(t => (globalThis as never as Abi).rs2b0t.actions.sayPublic(t), text);
}

/** Put items in the window and take whatever the shop puts up for them. */
async function sellToShop(c: Customer, item: Stock): Promise<void> {
    const qty = Math.max(1, Math.min(500, Math.floor(TRADE_VALUE / Math.max(1, item.mid))));
    const noted = item.note > 0;
    await cheatQuiet(c.page, `give ${noted ? `cert_${item.obj}` : item.obj} ${qty}`);

    if (!(await openTrade(c))) {
        return;
    }
    const before = await coinsHeld(c.page);
    const put = await c.page.evaluate(
        g => (globalThis as never as Abi).__rs2b0t.Trade.offer(g.name, g.qty, i => i.id === g.id),
        { name: item.name, id: noted ? item.note : item.id, qty }
    );
    if (!put) {
        console.log(`${at()} ${c.name} could not put ${item.name} in the window`);
        await abandon(c.page);
        return;
    }

    const paid = await waitShopSide(c.page, side => side.some(s => s.id === COINS), 30_000);
    if (paid === null) {
        console.log(`${at()} ${c.name} put ${gp(qty)} x ${item.name} up and the shop paid nothing — heard: ${await heard(c.page)}`);
        await abandon(c.page);
        return;
    }
    if (!(await settle(c.page))) {
        await abandon(c.page);
        return;
    }
    const after = await coinsHeld(c.page);
    if (after > before) {
        c.sold++;
        c.gp += after - before;
        console.log(`${at()} ${c.name} sold ${gp(qty)} x ${item.name} for ${gp(after - before)}gp`);
    }
}

/** Say what you want, then put up the coins it asks for. */
async function buyFromShop(c: Customer, item: Stock): Promise<void> {
    const each = sellPrice(item.mid);
    const qty = Math.max(1, Math.min(100, Math.floor(TRADE_VALUE / each)));
    // Why: the strung and unstrung bows share a display name, so the unstrung one has to be asked for by its suffix or the shop rightly hands over the strung one.
    const asked = item.obj.startsWith('unstrung_') ? `${item.name} u` : item.name;
    // Why: the count is optional now, so half the single-item requests leave it out and go through the implied-count path.
    const line = qty === 1 && rnd() < 0.5 ? `buying ${asked}` : `buying ${qty} ${asked}`;

    const mark = await chatMark(c.page);
    if (!(await say(c, line))) {
        console.log(`${at()} ${c.name} could not say '${line}'`);
        return;
    }
    // Why: the shop answers every customer in one public channel, so a quote has to be matched on the item as well as the speaker or one bot pays the price it heard quoted to the other.
    const named = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const quoted = new RegExp(`x\\s+${named}\\s*=\\s*([\\d, ]+)\\s*gp`, 'i');
    const refused = new RegExp(`I don't sell|I have no ${named}|matches:`, 'i');
    const answer = await waitShopLine(c.page, new RegExp(`${quoted.source}|${refused.source}`, 'i'), 40_000, mark);
    if (answer === null) {
        console.log(`${at()} ${c.name} said '${line}' and the shop never answered`);
        return;
    }
    const total = Number((quoted.exec(answer)?.[1] ?? '').replace(/\D/g, ''));
    if (!Number.isFinite(total) || total <= 0) {
        c.refused++;
        console.log(`${at()} ${c.name} asked '${line}' and got: ${answer}`);
        return;
    }
    // Why: the invitation is its own line once the shop has been to the bank, and it names the item too.
    const ready = new RegExp(`got your ${named}\\.|${quoted.source}[^|]*trade me`, 'i');
    if (!/Trade me\./i.test(answer) && (await waitShopLine(c.page, ready, 90_000, mark)) === null) {
        console.log(`${at()} ${c.name} was quoted ${gp(total)}gp for ${item.name} and never got asked to trade`);
        return;
    }

    const held = await topUpCoins(c);
    const put = Math.min(total, held);
    const before = await itemHeld(c.page, item);
    if (!(await openTrade(c))) {
        return;
    }
    const staked = await c.page.evaluate(
        g => (globalThis as never as Abi).__rs2b0t.Trade.offer('Coins', g.put, i => i.id === g.coins),
        { put, coins: COINS }
    );
    if (!staked) {
        console.log(`${at()} ${c.name} could not stake ${gp(put)}gp`);
        await abandon(c.page);
        return;
    }

    const goods = await waitShopSide(c.page, side => side.some(s => s.id !== COINS), 75_000);
    if (goods === null) {
        console.log(
            `${at()} ${c.name} staked ${gp(put)}gp for ${item.name} and the shop put nothing up\n` +
                `        heard: ${await heard(c.page)}\n` +
                `        shop: ${await shopSays(item.id)}`
        );
        await abandon(c.page);
        return;
    }
    if (!(await settle(c.page))) {
        await abandon(c.page);
        return;
    }
    const landed = (await itemHeld(c.page, item)) - before;
    if (landed <= 0) {
        console.log(
            `${at()} ${c.name} staked ${gp(put)}gp for ${item.name} and nothing arrived\n` +
                `        heard: ${await heard(c.page)}\n` +
                `        shop: ${await shopSays(item.id)}`
        );
        return;
    }
    c.bought++;
    c.gp -= put;
    console.log(`${at()} ${c.name} bought ${gp(landed)} x ${item.name} for ${gp(put)}gp`);
}

/** Open a window and leave, which is what puts a customer in the cooldown. */
async function walkOut(c: Customer): Promise<void> {
    if (!(await openTrade(c))) {
        return;
    }
    await c.page.waitForTimeout(1200);
    await abandon(c.page);
    c.walkouts++;
    console.log(`${at()} ${c.name} opened a window and walked out`);
}

// ---- the run -------------------------------------------------------------

let closing = false;
process.on('SIGINT', () => {
    closing = true;
});

function outOfTime(): boolean {
    return closing || (BUDGET_MS > 0 && Date.now() - t0 > BUDGET_MS);
}

/** Wipe a customer that has filled up, since a full pack cannot receive what it just paid for. */
// Why: every turn hands the customer more stock to sell, so without this the pack fills and every later trade fails on inventory space rather than on anything the shop did.
async function makeRoom(c: Customer): Promise<void> {
    const used = await c.page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Inventory.used());
    if (used < 20) {
        return;
    }
    await cheatQuiet(c.page, '~clearinv');
    await cheatQuiet(c.page, 'give coins 1000000');
}

async function customerLoop(c: Customer): Promise<void> {
    while (!outOfTime()) {
        const item = pick(STOCK);
        const roll = rnd();
        try {
            await makeRoom(c);
            if (roll < 0.45) {
                await sellToShop(c, item);
            } else if (roll < 0.92) {
                await buyFromShop(c, item);
            } else {
                await walkOut(c);
            }
            await c.page.waitForTimeout(1500 + Math.floor(rnd() * 3500));
        } catch (err) {
            // Why: a loop that throws rejects the Promise.all and closes the browser under the other three, so every customer's turn ends inside its own catch.
            console.log(`${at()} ${c.name} hit an error: ${String(err).slice(0, 160)}`);
            await abandon(c.page).catch(() => undefined);
        }
    }
}

const isolated = deployIsolatedClient('crowd');
const browser = await launchBrowser({ swiftshader: true });
const pages: Page[] = [];

try {
    const shopPage = await (await browser.newContext()).newPage();
    pages.push(shopPage);

    console.log(`crowd: ${CUSTOMERS} customers against '${SHOP}' at ${BASE}, ${STOCK.length} items, seed ${SEED}`);
    await bringUp(shopPage, SHOP, isolated.page);
    await maxmeAndClearDialogs(shopPage);
    await clearChatDialogs(shopPage);
    await cheatQuiet(shopPage, `speed ${TICK_MS}`);

    console.log(`${at()} seeding the shop's bank with ${STOCK.length} items`);
    await cheatQuiet(shopPage, '~clearinv');
    // Why: bankitem adds to what is already there, so without this every restart stacks on the last one until the common items sit over their cap and the shop stops buying them.
    await cheatQuiet(shopPage, '~clearbank');
    await cheatQuiet(shopPage, `~bankitem coins ${BANK_COINS}`);
    for (const s of STOCK) {
        await cheatQuiet(shopPage, `~bankitem ${s.obj} ${s.bank}`);
    }

    await writeStorage(shopPage, {
        'rs2b0t:set:PriceBooks:books': priceBook(),
        'rs2b0t:set:MarketMaker:priceBook': 'crowd',
        'rs2b0t:set:MarketMaker:spot': `${SPOT.x},${SPOT.z},${SPOT.level}`,
        // Why: a crowd fills the chat on its own, so the shop keeps quiet unless it is answering someone.
        'rs2b0t:set:MarketMaker:advertiseSeconds': '0',
        'rs2b0t:set:MarketMaker:engagementTimeoutSeconds': '90',
        // Why: the shop serves one window at a time, so a request waits out the customer in front of it as well as a bank trip.
        'rs2b0t:set:MarketMaker:intentSeconds': '240',
        'rs2b0t:set:MarketMaker:cooldownSeconds': '15',
        'rs2b0t:set:MarketMaker:coinFloat': String(COIN_FLOAT)
    });

    if (!(await teleArrive(shopPage, SPOT))) {
        throw new Error(`crowd: could not tele the shop to ${SPOT.x},${SPOT.z}`);
    }
    if (!(await shopPage.evaluate(() => Boolean((globalThis as never as Abi).rs2b0t.registry.get('MarketMaker'))))) {
        throw new Error('crowd: MarketMaker is missing from the registry — the deployed bundle is stale');
    }
    await startScript(shopPage, 'MarketMaker');
    await shopPage.waitForTimeout(8_000);

    const state = await shopPage.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state);
    if (state !== 'running') {
        const log = await shopPage.evaluate(() =>
            ((globalThis as never as Abi).rs2b0t.runner.ctx?.log ?? []).slice(-4).map(l => l.msg)
        );
        throw new Error(`crowd: the shop did not stay up (${state}): ${log.join(' | ')}`);
    }
    console.log(`${at()} the shop is up. Watch at ${BASE}${isolated.page}`);

    shopProbe = async (id: number) =>
        shopPage.evaluate(want => {
            const g = globalThis as never as Abi & {
                __rs2b0t: { Inventory: { countById(i: number): number; used(): number } };
            };
            const log = (g.rs2b0t.runner.ctx?.log ?? []).slice(-8).map(l => l.msg);
            return `pack ${g.__rs2b0t.Inventory.used()}/28, ${want} x${g.__rs2b0t.Inventory.countById(want)} | ${log.join(' | ')}`;
        }, id);

    const crowd: Customer[] = [];
    for (let i = 1; i <= CUSTOMERS; i++) {
        const name = `${SHOP}c${i}`;
        const page = await (await browser.newContext()).newPage();
        pages.push(page);
        console.log(`${at()} bringing up customer '${name}'`);
        await bringUp(page, name, isolated.page);
        await maxmeAndClearDialogs(page);
        await clearChatDialogs(page);
        await cheatQuiet(page, '~clearinv');
        await cheatQuiet(page, 'give coins 1000000');
        // Why: standing on the shop's own tile blocks it, so each customer takes a spot around it.
        await teleArrive(page, { x: SPOT.x + (i % 3) - 1, z: SPOT.z - 2 - Math.floor(i / 3), level: SPOT.level }, 3);
        crowd.push({ name, page, sold: 0, bought: 0, refused: 0, busy: 0, walkouts: 0, gp: 0, lastSayMs: 0 });
    }

    console.log(`${at()} ${crowd.length} customers trading. Ctrl-C to close the shop.`);

    const report = (async () => {
        while (!outOfTime()) {
            await shopPage.waitForTimeout(30_000);
            const snap = await shopPage.evaluate(() => {
                const g = globalThis as never as Abi;
                const log = g.rs2b0t.runner.ctx?.log ?? [];
                return {
                    state: g.rs2b0t.runner.state,
                    coins: g.__rs2b0t.Inventory.countById(995),
                    pack: g.__rs2b0t.Inventory.used(),
                    last: log[log.length - 1]?.msg ?? ''
                };
            });
            const totals = crowd.reduce(
                (a, c) => ({
                    sold: a.sold + c.sold,
                    bought: a.bought + c.bought,
                    refused: a.refused + c.refused,
                    busy: a.busy + c.busy,
                    walkouts: a.walkouts + c.walkouts
                }),
                { sold: 0, bought: 0, refused: 0, busy: 0, walkouts: 0 }
            );
            console.log(
                `${at()} shop ${snap.state} pack ${snap.pack}/28 ${gp(snap.coins)}gp | ` +
                    `sold to it ${totals.sold}, bought from it ${totals.bought}, ` +
                    `refused ${totals.refused}, busy ${totals.busy}, walkouts ${totals.walkouts} | ${snap.last}`
            );
            if (snap.state !== 'running') {
                closing = true;
            }
        }
    })();

    await Promise.all([report, ...crowd.map(c => customerLoop(c))]);

    for (const c of crowd) {
        console.log(
            `${at()} ${c.name}: sold ${c.sold}, bought ${c.bought}, refused ${c.refused}, ` +
                `busy ${c.busy}, walkouts ${c.walkouts}, took ${gp(c.gp)}gp`
        );
    }
} finally {
    console.log('crowd: logging everyone out');
    for (const page of pages) {
        try {
            await logout(page);
        } catch {
            /* already gone */
        }
    }
    await browser.close();
    isolated.cleanup();
}
