// Live 2-account smoke for the player-trade API (Master Nature Crafter, phase 1).
// Two mainland accounts stand together off-island; B (giver) hands a stack of Rune
// essence to A (receiver) through the full offer -> confirm handshake driven entirely
// by the Trade API. PASS when the essence moves from B's pack into A's.
//
// Usage: bun tools/trade-test.ts [base]

import type { Page } from 'playwright-core';
import { boot, bringUpOffIsland, fail, launchBrowser, login } from './lib/harness.js';
import { cheatQuiet } from './tutorial/harness.js';

const base = process.argv[2] || 'http://localhost:8890';
const stamp = Date.now().toString(36).slice(-6);
const A_USER = `trada${stamp}`; // receiver
const B_USER = `tradb${stamp}`; // giver
const ITEM = 'Rune essence'; // non-stackable — one pack slot each, so seed under 28
const SEED = 20;

type Abi = {
    __rs2b0t: {
        Trade: {
            request(name: string): Promise<boolean>;
            offerAll(name: string): Promise<boolean>;
            accept(): Promise<boolean>;
            onOfferScreen(): boolean;
            onConfirmScreen(): boolean;
            active(): boolean;
            partner(): string | null;
            theirOffer(): { name: string | null; count: number }[];
        };
        Players: { query(): { name(s: string): { exists(): boolean } } };
        Inventory: { count(name: string): number };
    };
};

const request = (p: Page, name: string) => p.evaluate(n => (globalThis as never as Abi).__rs2b0t.Trade.request(n), name);
const offerAll = (p: Page, name: string) => p.evaluate(n => (globalThis as never as Abi).__rs2b0t.Trade.offerAll(n), name);
const accept = (p: Page) => p.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.accept());
const onOffer = (p: Page) => p.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.onOfferScreen());
const onConfirm = (p: Page) => p.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.onConfirmScreen());
const active = (p: Page) => p.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.active());
const partner = (p: Page) => p.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.partner());
const theirOffer = (p: Page) => p.evaluate(() => (globalThis as never as Abi).__rs2b0t.Trade.theirOffer());
const sees = (p: Page, name: string) => p.evaluate(n => (globalThis as never as Abi).__rs2b0t.Players.query().name(n).exists(), name);
const count = (p: Page, name: string) => p.evaluate(n => (globalThis as never as Abi).__rs2b0t.Inventory.count(n), name);

async function bringUp(page: Page, user: string): Promise<void> {
    page.on('pageerror', e => console.log(`[${user}] pageerror: ${e}`));
    await page.goto(`${base}/bot.html`);
    await boot(page);
    if (!(await login(page, user))) fail(`${user}: first login failed`);
    await bringUpOffIsland(page, { user });
    console.log(`[${user}] off-island and ready`);
}

const browser = await launchBrowser();
try {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    await bringUp(pageA, A_USER);
    await bringUp(pageB, B_USER);

    // Seed after the relog (a pre-relog seed is rolled back). Direct packet
    // (cheatQuiet), not typed chat — no canvas-focus dependency. Clear both packs
    // first: B for a clean essence-only slate, A so it has room to receive.
    await cheatQuiet(pageA, '~clearinv');
    await cheatQuiet(pageB, '~clearinv');
    if (!(await cheatQuiet(pageB, `~item blankrune ${SEED}`))) { fail('B seed command not sent'); }
    let bStart = 0;
    for (let i = 0; i < 6 && bStart < SEED; i++) {
        await pageB.waitForTimeout(600);
        bStart = await count(pageB, ITEM);
    }
    if (bStart < SEED) fail(`B seed failed — holds ${bStart} ${ITEM}`);
    console.log(`B seeded ${bStart} ${ITEM}; A holds ${await count(pageA, ITEM)}`);

    // Wait until each account can see the other in its player list.
    let visible = false;
    for (let i = 0; i < 10 && !visible; i++) {
        await pageA.waitForTimeout(1500);
        visible = (await sees(pageA, B_USER)) && (await sees(pageB, A_USER));
    }
    if (!visible) fail(`accounts can't see each other (A sees B=${await sees(pageA, B_USER)}, B sees A=${await sees(pageB, A_USER)})`);
    console.log('both accounts see each other');

    // 1. Mutual "Trade with" until both are on the offer screen.
    let opened = false;
    for (let i = 0; i < 20 && !opened; i++) {
        await request(pageA, B_USER);
        await request(pageB, A_USER);
        await pageA.waitForTimeout(1500);
        opened = (await onOffer(pageA)) && (await onOffer(pageB));
    }
    if (!opened) fail(`offer screen never opened (A=${await onOffer(pageA)} B=${await onOffer(pageB)})`);
    console.log(`offer screen open — A trading with '${await partner(pageA)}', B with '${await partner(pageB)}'`);

    // 2. B offers the whole essence stack; wait until A sees it.
    let sawOffer = false;
    for (let i = 0; i < 12 && !sawOffer; i++) {
        await offerAll(pageB, ITEM);
        await pageA.waitForTimeout(1000);
        const off = await theirOffer(pageA);
        // Non-stackable essence shows as N separate count-1 entries — sum them.
        const offered = off.filter(o => (o.name ?? '').toLowerCase() === ITEM.toLowerCase()).reduce((s, o) => s + Math.max(1, o.count), 0);
        sawOffer = offered >= SEED;
    }
    if (!sawOffer) fail(`A never saw B's ${ITEM} offer: ${JSON.stringify(await theirOffer(pageA))}`);
    console.log(`A sees B's offer of ${SEED} ${ITEM}`);

    // 3. Both accept the offer screen -> confirm screen.
    let confirmed = false;
    for (let i = 0; i < 15 && !confirmed; i++) {
        if (await onOffer(pageA)) { await accept(pageA); }
        if (await onOffer(pageB)) { await accept(pageB); }
        await pageA.waitForTimeout(1000);
        confirmed = (await onConfirm(pageA)) && (await onConfirm(pageB));
    }
    if (!confirmed) fail(`confirm screen never reached (A=${await onConfirm(pageA)} B=${await onConfirm(pageB)})`);
    console.log('both on the confirm screen');

    // 4. Both accept the confirm screen -> exchange + close.
    let done = false;
    for (let i = 0; i < 15 && !done; i++) {
        if (await active(pageA)) { await accept(pageA); }
        if (await active(pageB)) { await accept(pageB); }
        await pageA.waitForTimeout(1000);
        done = !(await active(pageA)) && !(await active(pageB));
    }
    if (!done) fail('trade never closed after confirm');

    // 5. Verify the essence changed hands.
    const aEnd = await count(pageA, ITEM);
    const bEnd = await count(pageB, ITEM);
    console.log(`after trade: A holds ${aEnd} ${ITEM}, B holds ${bEnd}`);
    if (aEnd >= SEED && bEnd === 0) {
        console.log(`PASS: ${SEED} ${ITEM} moved from B to A through the full trade handshake`);
        await browser.close();
        process.exit(0);
    }
    fail(`essence did not change hands cleanly (A=${aEnd} expected>=${SEED}, B=${bEnd} expected 0)`);
} catch (e) {
    console.error(e);
    fail(String(e));
}
