/** Live proof, Cook's Assistant leftover coin float vs taking the egg (#758).
 *  Why: coinFloatWithdraw re-ran every tick while egg/milk/flour were still outstanding, so a 10gp drop emitted withdraw Coins and grabGround treated arrival as success. */

//   ENGINE_DIR=~/Documents/engine HEADED=1 EXPECT_MODE=after bun e2e/cooksassistant-758-live.ts --base http://localhost:8888
import type { Page } from 'playwright-core';

import { cheatQuiet, deployIsolatedClient, fail, launchBrowser, parseArgs } from './lib/harness.js';
import { mainlandAccount, relog, seedItemsToBank, startScript, teleTo } from './tutorial/harness.js';

const { base, minutes } = parseArgs(process.argv.slice(2), { base: 'http://localhost:8888', minutes: 8 });
const deploy = !process.argv.includes('--no-deploy');
const user = process.env.USER_NAME || `cak${Date.now().toString(36).slice(-5)}`;
const expectMode = process.env.EXPECT_MODE === 'before' ? 'before' : 'after';
const screenshot = process.env.SCREENSHOT
    ?? (expectMode === 'before'
        ? 'docs/e2e/cooksassistant-758-before.png'
        : 'docs/e2e/cooksassistant-758-after.png');
const BUDGET_MS = minutes * 60_000;
const FARM = { x: 3238, z: 3295, level: 0 };
const EGG_PEN = { x: 3227, z: 3300 };
const WITHDRAW_COINS = /withdraw Coins/i;
const GRAB_EGG = /grab Egg/i;

interface Api {
    __rs2b0t: {
        Inventory: {
            contains(name: string): boolean;
            count(name: string): number;
            items(): Array<{ id: number; name: string | null; count: number }>;
        };
        Quests: { status(name: string): string };
    };
    rs2b0t: {
        runner: {
            state: string;
            bot: { stepDesc?: string } | null;
            ctx: { log: { time: number; msg: string }[] } | null;
        };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
    };
}

type Pack = { names: string[]; coins: number; egg: boolean; status: string; step: string };

const pack = (page: Page): Promise<Pack> =>
    page.evaluate(quest => {
        const g = globalThis as never as Api;
        const items = g.__rs2b0t.Inventory.items();
        return {
            names: items.map(i => i.name ?? ''),
            coins: g.__rs2b0t.Inventory.count('Coins'),
            egg: g.__rs2b0t.Inventory.contains('Egg'),
            status: g.__rs2b0t.Quests.status(quest),
            step: g.rs2b0t.runner.bot?.stepDesc ?? ''
        };
    }, "Cook's Assistant");

async function seedPurse(page: Page): Promise<void> {
    for (let attempt = 0; attempt < 6; attempt++) {
        await cheatQuiet(page, 'give coins 990', 1200);
        const snap = await pack(page);
        if (snap.coins >= 990) {
            return;
        }
    }
    const snap = await pack(page);
    fail(`could not seed 990 coins: names=${JSON.stringify(snap.names)} coins=${snap.coins}`);
}

const client = deploy
    ? deployIsolatedClient(`cak${Date.now().toString(36).slice(-6)}`, process.env.ENGINE_DIR)
    : { page: '/bot.html', cleanup: () => undefined };
const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
try {
    page.on('pageerror', err => console.log(`pageerror: ${err}`));
    await mainlandAccount(page, base, user, client.page);

    await seedItemsToBank(page, [{ debugName: 'coins', displayName: 'Coins', qty: 5000 }], { x: 3092, z: 3243, level: 0 });
    await cheatQuiet(page, 'setvar cookquest 1', 900);
    await relog(page, user);
    await seedPurse(page);
    const started = await pack(page);
    if (started.status !== 'inProgress') {
        fail(`journal after setvar cookquest 1 is '${started.status}', want inProgress`);
    }
    if (started.coins < 990) {
        fail(`seed missing after relog, coins=${started.coins} names=${JSON.stringify(started.names)}`);
    }
    if (started.egg) {
        fail('seed must not start with an egg');
    }
    if (!(await teleTo(page, FARM, 8, 25_000))) {
        fail(`could not reach the Lumbridge farm (${FARM.x},${FARM.z})`);
    }
    await cheatQuiet(page, 'speed 300', 700);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'cook'));
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester expect ${expectMode} (${screenshot})`);

    const t0 = Date.now();
    let lastLog = 0;
    let sawWithdraw = false;
    let sawGrab = false;
    while (Date.now() - t0 < BUDGET_MS) {
        const lines = await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.ctx?.log ?? []);
        for (const line of lines) {
            if (line.time > lastLog) {
                console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${line.msg}`);
                lastLog = Math.max(lastLog, line.time);
            }
            if (WITHDRAW_COINS.test(line.msg)) {
                sawWithdraw = true;
            }
            if (GRAB_EGG.test(line.msg)) {
                sawGrab = true;
            }
        }
        const snap = await pack(page);
        if (WITHDRAW_COINS.test(snap.step)) {
            sawWithdraw = true;
        }
        if (GRAB_EGG.test(snap.step)) {
            sawGrab = true;
        }
        if (expectMode === 'before') {
            if (snap.egg) {
                fail(`expected the pre-fix coin loop, but the pack already has an egg: ${JSON.stringify(snap.names)}`);
            }
            if (sawWithdraw) {
                break;
            }
        } else {
            if (sawWithdraw) {
                fail(`leftover coin float still sent the bot to withdraw Coins: step='${snap.step}'`);
            }
            if (snap.egg) {
                break;
            }
        }
        const runner = await page.evaluate(() => (globalThis as never as Api).rs2b0t.runner.state);
        if (runner === 'crashed' || runner === 'stopped') {
            fail(`runner ${runner} before ${expectMode}: ${JSON.stringify(lines.slice(-12).map(l => l.msg))}`);
        }
        await page.waitForTimeout(400);
    }

    const end = await pack(page);
    if (expectMode === 'before') {
        if (!sawWithdraw) {
            fail(`never saw withdraw Coins within ${minutes} min; step='${end.step}' names=${JSON.stringify(end.names)}`);
        }
        if (end.egg) {
            fail(`before-run took the egg: names=${JSON.stringify(end.names)}`);
        }
    } else {
        if (!end.egg) {
            fail(`never held an Egg within ${minutes} min; step='${end.step}' grab=${sawGrab} names=${JSON.stringify(end.names)}`);
        }
        if (sawWithdraw) {
            fail('after-run withdrew Coins');
        }
    }

    const dest = expectMode === 'before' ? undefined : EGG_PEN;
    if (dest) {
        const walkUntil = Date.now() + 20_000;
        while (Date.now() < walkUntil) {
            const tile = await page.evaluate(() => (globalThis as never as Api).rs2b0t.reader.worldTile());
            if (tile) {
                const d = Math.max(Math.abs(tile.x - dest.x), Math.abs(tile.z - dest.z));
                if (d <= 8) {
                    break;
                }
            }
            await page.waitForTimeout(400);
        }
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: screenshot });
    console.log(`PASS: Cook's Assistant ${expectMode} (${screenshot})`);
} finally {
    await browser.close();
    client.cleanup();
}
