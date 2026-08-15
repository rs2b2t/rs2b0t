/** Two-account Fisher mule e2e at Catherby: the Gatherer hauls raw lobster to the camp meet, the Cooker cooks at the Range and banks (burntPolicy Drop).
 *  BASE / BUDGET_S from the environment; redeploy first when GatheringBot / cook / mule code changes. */

// Usage:
//   HEADED=1 bun e2e/gatheringbot-cooker-pair-test.ts
//   BASE=http://localhost:8890 BUDGET_S=240 bun e2e/gatheringbot-cooker-pair-test.ts

// Redeploy first when GatheringBot / cook / mule code changes:
//   ~/redeploy.sh
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    mainlandAccount,
    maxmeAndClearDialogs,
    startScript
} from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8890' });
const BUDGET_MS = (Number(process.env.BUDGET_S) || 240) * 1000;
const stamp = Date.now().toString(36).slice(-6);
const G_USER = process.env.GATHERER_NAME || `gfg${stamp}`;
const C_USER = process.env.COOKER_NAME || `gfc${stamp}`;

const MEET = { x: 2845, z: 3431, level: 0 } as const;
const PIER = { x: 2842, z: 3433, level: 0 } as const;

type Tile = { x: number; z: number; level: number };

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        Inventory: {
            items(): { name: string | null; count: number }[];
            count(n: string): number;
            used(): number;
        };
        Skills: { xp(n: string): number };
    };
    rs2b0t: {
        runner: {
            state: string;
            ctx?: { log?: { time: number; level: string; msg: string }[] } | null;
        };
        registry: { get(n: string): unknown };
    };
};

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

function teleCmd(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: Tile, maxDist = 14): Promise<void> {
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

async function setFisher(page: Page, map: Record<string, string>): Promise<void> {
    await page.evaluate(entries => {
        for (const [k, v] of Object.entries(entries)) {
            sessionStorage.setItem(`rs2b0t:set:Fisher:${k}`, v);
            try {
                localStorage.setItem(`rs2b0t:set:Fisher:${k}`, v);
            } catch {
                /* ignore */
            }
        }
    }, map);
}

async function sample(page: Page): Promise<{
    tile: Tile | null;
    rawLob: number;
    cookedLob: number;
    used: number;
    cookXp: number;
    state: string;
    logs: string[];
    lastLog: string;
}> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const items = g.__rs2b0t.Inventory.items();
        const rawLob = items
            .filter(i => /^raw lobster$/i.test(i.name ?? ''))
            .reduce((s, i) => s + Math.max(1, i.count), 0);
        const cookedLob = items
            .filter(i => /^lobster$/i.test(i.name ?? ''))
            .reduce((s, i) => s + Math.max(1, i.count), 0);
        const logs = (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg);
        return {
            tile: g.__rs2b0t.reader.worldTile(),
            rawLob,
            cookedLob,
            used: g.__rs2b0t.Inventory.used(),
            cookXp: g.__rs2b0t.Skills.xp('cooking'),
            state: g.rs2b0t.runner.state,
            logs,
            lastLog: (logs[logs.length - 1] ?? '').slice(0, 90)
        };
    });
}

function logHas(msgs: string[], re: RegExp): boolean {
    return msgs.some(m => re.test(m));
}

console.log(
    `gatheringbot-cooker-pair base=${base} gatherer=${G_USER} cooker=${C_USER} budget=${Math.round(BUDGET_MS / 1000)}s`
);

const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const stampFn = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;

try {
    const pageG = await (await browser.newContext()).newPage();
    const pageC = await (await browser.newContext()).newPage();

    console.log(`${stampFn()} bring up gatherer '${G_USER}'`);
    await mainlandAccount(pageG, base, G_USER);
    console.log(`${stampFn()} gatherer maxme + clear level-up dialogs`);
    await maxmeAndClearDialogs(pageG);
    await clearChatDialogs(pageG);
    await cheatQuiet(pageG, '~clearinv');
    await cheatQuiet(pageG, 'give lobster_pot 1');
    await cheatQuiet(pageG, 'give raw_lobster 27');
    await teleArrive(pageG, PIER);
    await setFisher(pageG, {
        fishMethod: 'Lobster cage — lobster',
        location: 'Catherby',
        cookMode: 'Off',
        toolAcquire: 'Off',
        forgetfulBank: 'false',
        leashRadius: '18',
        muleMode: 'Gatherer',
        mulePartner: C_USER
    });
    console.log(`${stampFn()} gatherer ready (27 raw lobster + pot)`);

    console.log(`${stampFn()} bring up cooker '${C_USER}'`);
    await mainlandAccount(pageC, base, C_USER);
    console.log(`${stampFn()} cooker maxme + clear level-up dialogs`);
    await maxmeAndClearDialogs(pageC);
    await clearChatDialogs(pageC);
    await cheatQuiet(pageC, '~clearinv');
    await teleArrive(pageC, MEET);
    await setFisher(pageC, {
        fishMethod: 'Lobster cage — lobster',
        location: 'Catherby',
        cookMode: 'Cook then bank',
        cookFish: 'Lobster',
        burntPolicy: 'Drop',
        toolAcquire: 'Off',
        forgetfulBank: 'false',
        leashRadius: '18',
        muleMode: 'Cooker',
        mulePartner: G_USER
    });
    console.log(`${stampFn()} cooker ready at meet (empty pack)`);

    const regOk = async (page: Page) =>
        page.evaluate(() => Boolean((globalThis as never as Abi).rs2b0t.registry.get('Fisher')));
    if (!(await regOk(pageG)) || !(await regOk(pageC))) {
        fail('Fisher missing from registry — redeploy bot client');
    }

    const cookXp0 = (await sample(pageC)).cookXp;

    await startScript(pageG, 'Fisher');
    await startScript(pageC, 'Fisher');
    console.log(`${stampFn()} both Fisher scripts started — waiting for handoff + cook`);

    const g0 = await sample(pageG);
    if (g0.rawLob < 20) {
        fail(`gatherer precondition: need ≥20 raw lobster (have ${g0.rawLob})`);
    }
    const rawStart = g0.rawLob;
    const deadline = Date.now() + BUDGET_MS;
    let passed = false;
    let detail = '';

    while (Date.now() < deadline) {
        await pageG.waitForTimeout(3000);
        const [g, c] = await Promise.all([sample(pageG), sample(pageC)]);
        const bothAlive = g.state !== 'crashed' && c.state !== 'crashed';
        if (!bothAlive) {
            detail = `crash g=${g.state} c=${c.state} gLog=${g.lastLog} cLog=${c.lastLog}`;
            break;
        }

        const traded =
            logHas(g.logs, /mule:\s*trade complete/i)
            || logHas(c.logs, /mule:\s*trade complete/i)
            || g.rawLob <= rawStart - 10;
        const cookerCooked =
            c.cookXp > cookXp0
            || logHas(c.logs, /bank:\s*deposited\s+\d+\s+cooked/i)
            || logHas(c.logs, /cook:\s*cook-then-bank/i) && c.rawLob === 0 && c.cookedLob === 0 && traded;
        const cookerGotRaw =
            c.rawLob > 0
            || c.cookedLob > 0
            || c.cookXp > cookXp0
            || logHas(c.logs, /mule:\s*accepting raw|mule:\s*trade complete/i);

        console.log(
            `${stampFn()} g.raw=${g.rawLob} c.raw=${c.rawLob} c.cooked=${c.cookedLob} ` +
                `c.cookXpΔ=${c.cookXp - cookXp0} g=${g.state} c=${c.state} ` +
                `| g: ${g.lastLog.slice(0, 48)} | c: ${c.lastLog.slice(0, 48)}`
        );

        // Full success: the handoff landed and the cooker cooked (XP or banked cooked).
        if (traded && cookerGotRaw && (c.cookXp > cookXp0 || logHas(c.logs, /bank:\s*deposited\s+\d+\s+cooked/i))) {
            passed = true;
            detail =
                `handoff raw ${rawStart}→${g.rawLob} (gatherer); cooker cookXpΔ=${c.cookXp - cookXp0} ` +
                `raw=${c.rawLob} cooked=${c.cookedLob} ` +
                `banked=${logHas(c.logs, /bank:\s*deposited\s+\d+\s+cooked/i)} ` +
                `trades g=${logHas(g.logs, /mule:\s*trade complete/i)} c=${logHas(c.logs, /mule:\s*trade complete/i)}`;
            break;
        }
        // Soft pass after cook complete with empty cooker pack and gatherer emptied.
        if (g.rawLob === 0 && c.cookXp > cookXp0 && c.rawLob === 0 && cookerCooked) {
            passed = true;
            detail = `gatherer empty; cooker cookXpΔ=${c.cookXp - cookXp0}`;
            break;
        }
    }

    if (!passed) {
        const [g, c] = await Promise.all([sample(pageG), sample(pageC)]);
        fail(
            detail
                || `timeout g.raw=${g.rawLob} c.raw=${c.rawLob} c.cooked=${c.cookedLob} ` +
                    `cookXpΔ=${c.cookXp - cookXp0} gLog=${g.lastLog} cLog=${c.lastLog}`
        );
    }

    console.log(`\nPASS gatheringbot-cooker-pair: ${detail}`);
    process.exit(0);
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
