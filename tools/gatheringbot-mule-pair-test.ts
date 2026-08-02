/**
 * Two-account GatheringBot mule e2e: Gatherer + Mule at SE Varrock iron.
 *
 * Boots two Playwright contexts (two logins) against the local engine, seeds a
 * full iron haul on the gatherer, starts Miner on both sides with reciprocal
 * partners, and asserts a handoff (gatherer ore drops / mule receives or banks).
 *
 * Usage:
 *   HEADED=1 bun tools/gatheringbot-mule-pair-test.ts
 *   BASE=http://localhost:8890 BUDGET_S=180 bun tools/gatheringbot-mule-pair-test.ts
 *
 * Redeploy the bot client first when GatheringBot / Trade / mule code changes:
 *   ~/redeploy.sh
 */
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
const BUDGET_MS = (Number(process.env.BUDGET_S) || 180) * 1000;
const stamp = Date.now().toString(36).slice(-6);
const G_USER = process.env.GATHERER_NAME || `gbg${stamp}`;
const M_USER = process.env.MULE_NAME || `gbm${stamp}`;

const MEET = { x: 3285, z: 3366, level: 0 } as const;
const SE_IRON = { x: 3286, z: 3369, level: 0 } as const;

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

async function setMiner(page: Page, map: Record<string, string>): Promise<void> {
    await page.evaluate(entries => {
        for (const [k, v] of Object.entries(entries)) {
            sessionStorage.setItem(`rs2b0t:set:Miner:${k}`, v);
            try {
                localStorage.setItem(`rs2b0t:set:Miner:${k}`, v);
            } catch {
                /* ignore */
            }
        }
    }, map);
}

async function sample(page: Page): Promise<{
    tile: Tile | null;
    iron: number;
    used: number;
    state: string;
    logs: string[];
    lastLog: string;
}> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const items = g.__rs2b0t.Inventory.items();
        const iron = items
            .filter(i => (i.name ?? '').toLowerCase() === 'iron ore')
            .reduce((s, i) => s + Math.max(1, i.count), 0);
        const logs = (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg);
        return {
            tile: g.__rs2b0t.reader.worldTile(),
            iron,
            used: g.__rs2b0t.Inventory.used(),
            state: g.rs2b0t.runner.state,
            logs,
            lastLog: (logs[logs.length - 1] ?? '').slice(0, 80)
        };
    });
}

function logHas(msgs: string[], re: RegExp): boolean {
    return msgs.some(m => re.test(m));
}

console.log(`gatheringbot-mule-pair base=${base} gatherer=${G_USER} mule=${M_USER} budget=${Math.round(BUDGET_MS / 1000)}s`);

const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const stampFn = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;

try {
    const pageG = await (await browser.newContext()).newPage();
    const pageM = await (await browser.newContext()).newPage();

    console.log(`${stampFn()} bring up gatherer '${G_USER}'`);
    await mainlandAccount(pageG, base, G_USER);
    console.log(`${stampFn()} gatherer maxme + clear level-up dialogs`);
    await maxmeAndClearDialogs(pageG);
    await clearChatDialogs(pageG);
    await cheatQuiet(pageG, '~clearinv');
    await cheatQuiet(pageG, 'give rune_pickaxe 1');
    await cheatQuiet(pageG, 'give iron_ore 27');
    await teleArrive(pageG, SE_IRON);
    await setMiner(pageG, {
        rocks: 'Iron',
        location: 'Southeast Varrock Mine',
        toolAcquire: 'Off',
        forgetfulBank: 'false',
        leashRadius: '18',
        muleMode: 'Gatherer',
        mulePartner: M_USER
    });
    console.log(`${stampFn()} gatherer ready at SE iron (27 iron + pick)`);

    console.log(`${stampFn()} bring up mule '${M_USER}'`);
    await mainlandAccount(pageM, base, M_USER);
    console.log(`${stampFn()} mule maxme + clear level-up dialogs`);
    await maxmeAndClearDialogs(pageM);
    await clearChatDialogs(pageM);
    await cheatQuiet(pageM, '~clearinv');
    // Mule holds nothing — empty pack to receive iron.
    await teleArrive(pageM, MEET);
    await setMiner(pageM, {
        rocks: 'Iron',
        location: 'Southeast Varrock Mine',
        toolAcquire: 'Off',
        forgetfulBank: 'false',
        leashRadius: '18',
        muleMode: 'Mule',
        mulePartner: G_USER
    });
    console.log(`${stampFn()} mule ready at meet`);

    const regOk = async (page: Page) =>
        page.evaluate(() => Boolean((globalThis as never as Abi).rs2b0t.registry.get('Miner')));
    if (!(await regOk(pageG)) || !(await regOk(pageM))) {
        fail('Miner missing from registry — redeploy bot client');
    }

    await startScript(pageG, 'Miner');
    await startScript(pageM, 'Miner');
    console.log(`${stampFn()} both Miner scripts started — waiting for trade handoff`);

    const g0 = await sample(pageG);
    if (g0.iron < 20) {
        fail(`gatherer precondition: need ≥20 iron (have ${g0.iron})`);
    }
    const ironStart = g0.iron;
    const deadline = Date.now() + BUDGET_MS;
    let passed = false;
    let detail = '';

    while (Date.now() < deadline) {
        await pageG.waitForTimeout(3000);
        const [g, m] = await Promise.all([sample(pageG), sample(pageM)]);
        const gTraded = logHas(g.logs, /mule:\s*trade complete/i) || g.iron <= ironStart - 10;
        const mGot = m.iron >= 5 || logHas(m.logs, /mule:\s*(trade complete|deposited haul|accepting product)/i);
        const bothAlive = g.state !== 'crashed' && m.state !== 'crashed';

        if (!bothAlive) {
            detail = `crash g=${g.state} m=${m.state} gLog=${g.lastLog} mLog=${m.lastLog}`;
            break;
        }

        console.log(
            `${stampFn()} g.iron=${g.iron} m.iron=${m.iron} g=${g.state} m=${m.state} ` +
                `| g: ${g.lastLog.slice(0, 50)} | m: ${m.lastLog.slice(0, 50)}`
        );

        // Success: product moved gatherer → mule (and ideally mule banks).
        if (gTraded && mGot) {
            passed = true;
            detail =
                `handoff iron ${ironStart}→${g.iron} (gatherer) mule.iron=${m.iron} ` +
                `tradesLog g=${logHas(g.logs, /mule:\s*trade complete/i)} m=${logHas(m.logs, /mule:/i)}`;
            break;
        }
        // Softer pass: gatherer emptied product and mule saw a trade complete.
        if (g.iron === 0 && logHas(m.logs, /mule:\s*trade complete|mule:\s*deposited haul/i)) {
            passed = true;
            detail = `gatherer empty; mule progressed (m.iron=${m.iron})`;
            break;
        }
    }

    if (!passed) {
        const [g, m] = await Promise.all([sample(pageG), sample(pageM)]);
        fail(
            detail ||
                `timeout iron g=${g.iron} m=${m.iron} ` +
                    `gLog=${g.lastLog} mLog=${m.lastLog}`
        );
    }

    console.log(`\nPASS gatheringbot-mule-pair: ${detail}`);
    process.exit(0);
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
