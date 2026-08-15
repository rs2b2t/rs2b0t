/** Live verification for Thiever efficiency (#139): [base], with BASE / BUDGET_S / HEADED / SLOWMO from the environment. Boots a mainland account, seeds a short pack of cooked lobsters, starts Thiever on Ardougne Guards with loot off, and asserts thieving XP/hr >= 25k after a warm-up.
 *  Why: item seeds go through the engine cheat `give <obj> <qty>` rather than `~item`/`~bankitem`, and the bot client is redeployed by hand — tools/deploy-local.sh from this tree is not for live e2e. */

// Usage:
//   bun e2e/thievingbot-test.ts
//   bun e2e/thievingbot-test.ts http://localhost:8888
//   BASE=http://localhost:8890 BUDGET_S=900 bun e2e/thievingbot-test.ts
//   HEADED=1 SLOWMO=200 bun e2e/thievingbot-test.ts
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, startScript } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8890' });
const USER = process.env.USER_NAME || `th${Date.now().toString(36).slice(-7)}`;
/** Total wall budget (default 12 min — needs a few minutes of steal XP for a stable XP/hr). */
const BUDGET_MS = (Number(process.env.BUDGET_S) || 720) * 1000;
/** Ignore XP/hr until this many seconds of runtime (warmup / first bank trip). */
const WARMUP_S = Number(process.env.WARMUP_S) || 180;
/** Pass bar: thieving XP per hour. */
const TARGET_XPH = Number(process.env.TARGET_XPH) || 25_000;

const GUARD_SPOT = { x: 2661, z: 3306, level: 0 } as const;
/** Pack food only — enough for a default ~12 min soak without a bank trip. */
const INV_FOOD = 22;

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type Tile = { x: number; z: number; level: number };

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        Skills: { xp(n: string): number; level(n: string): number };
        Inventory: {
            count(n: string): number;
            items(): { name: string | null; count: number }[];
            used(): number;
        };
        Npcs: {
            query(): {
                results(): { name: string | null; distance(): number }[];
            };
        };
    };
    rs2b0t: {
        runner: {
            state: string;
            ctx?: { log?: { time: number; level: string; msg: string }[] } | null;
            start(meta: unknown): void;
            stop(reason: string): void;
        };
        registry: { get(name: string): unknown };
        client: { ingame: boolean; sceneState: number };
    };
};

function teleCheat(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

function chebyshev(a: Tile, b: Tile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

async function teleArrive(page: Page, spot: Tile, maxDist = 18): Promise<boolean> {
    const cmd = teleCheat(spot);
    for (let attempt = 0; attempt < 4; attempt++) {
        await cheatQuiet(page, cmd);
        for (let poll = 0; poll < 12; poll++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && t.level === spot.level && chebyshev(t, spot) <= maxDist) {
                await page.waitForTimeout(600);
                return true;
            }
            await page.waitForTimeout(350);
        }
    }
    return false;
}

async function seedItem(page: Page, debugName: string, displayName: string, qty = 1): Promise<void> {
    const cmd = `give ${debugName} ${qty}`;
    for (let i = 0; i < 8; i++) {
        const sent = await cheatQuiet(page, cmd);
        if (!sent) {
            throw new Error(`give not sent (not ingame?) for ${displayName}`);
        }
        for (let poll = 0; poll < 4; poll++) {
            const n = await page.evaluate(name => (globalThis as never as Abi).__rs2b0t.Inventory.count(name), displayName);
            if (n >= qty) {
                return;
            }
            await page.waitForTimeout(250);
        }
    }
    const inv = await page.evaluate(() =>
        (globalThis as never as Abi).__rs2b0t.Inventory.items()
            .filter(i => i.name)
            .map(i => `${i.count}x ${i.name}`)
            .join(', ')
    );
    throw new Error(`could not seed ${displayName} via '${cmd}' (inv=${inv || 'empty'})`);
}

async function clearInv(page: Page): Promise<void> {
    const sent = await cheatQuiet(page, '~clearinv');
    if (!sent) {
        throw new Error('~clearinv not sent (not ingame?)');
    }
    await page.waitForTimeout(700);
    for (let i = 0; i < 6; i++) {
        const used = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Inventory.used());
        if (used === 0) {
            return;
        }
        await cheatQuiet(page, '~clearinv');
        await page.waitForTimeout(400);
    }
}

async function advanceStat(page: Page, skill: string, level: number): Promise<void> {
    const before = await page.evaluate(s => (globalThis as never as Abi).__rs2b0t.Skills.level(s), skill);
    if (before >= level) {
        return;
    }
    for (let i = 0; i < 4; i++) {
        const sent = await cheatQuiet(page, `advancestat ${skill} ${level}`);
        if (!sent) {
            throw new Error(`advancestat not sent for ${skill}`);
        }
        const have = await page.evaluate(s => (globalThis as never as Abi).__rs2b0t.Skills.level(s), skill);
        if (have >= level) {
            return;
        }
        await page.waitForTimeout(500);
    }
    const have = await page.evaluate(s => (globalThis as never as Abi).__rs2b0t.Skills.level(s), skill);
    if (have < level) {
        throw new Error(`advancestat ${skill} ${level} stuck at ${have}`);
    }
}

/** Drain level-up / chat continues so they don't block movement. */
async function clearChatDialogs(page: Page): Promise<void> {
    const clicked = await page.evaluate(async () => {
        const g = globalThis as never as {
            rs2b0t: {
                reader: {
                    modals(): { chat: number };
                    chatContinueComId(): number;
                    chatOptions(): { text: string; comId: number }[];
                };
                actions: { continueDialog(): boolean; ifButton(comId: number): boolean };
            };
        };
        let n = 0;
        let quiet = 0;
        for (let i = 0; i < 80; i++) {
            const chatOpen = g.rs2b0t.reader.modals().chat !== -1;
            const canContinue = g.rs2b0t.reader.chatContinueComId() !== -1;
            const opts = g.rs2b0t.reader.chatOptions();
            if (!chatOpen && !canContinue && opts.length === 0) {
                quiet++;
                if (quiet >= 4) {
                    break;
                }
                await new Promise(r => setTimeout(r, 200));
                continue;
            }
            quiet = 0;
            if (canContinue) {
                if (g.rs2b0t.actions.continueDialog()) {
                    n++;
                }
            } else if (opts.length > 0) {
                if (g.rs2b0t.actions.ifButton(opts[0]!.comId)) {
                    n++;
                }
            }
            await new Promise(r => setTimeout(r, 250));
        }
        return n;
    });
    if (clicked > 0) {
        console.log(`  cleared ${clicked} chat dialog(s)`);
    }
}

async function setSettings(page: Page, script: string, map: Record<string, string | number | boolean>): Promise<void> {
    await page.evaluate(([name, entries]) => {
        for (const [k, v] of Object.entries(entries)) {
            sessionStorage.setItem(`rs2b0t:set:${name}:${k}`, String(v));
            try {
                localStorage.setItem(`rs2b0t:set:${name}:${k}`, String(v));
            } catch {
                /* private mode */
            }
        }
    }, [script, map] as const);
}

type Snap = {
    tile: Tile | null;
    runner: string;
    thievingXp: number;
    thievingLevel: number;
    food: number;
    logs: { time: number; level: string; msg: string }[];
    guardsNear: number;
};

async function snap(page: Page): Promise<Snap> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const inv = g.__rs2b0t.Inventory.items();
        const food = inv
            .filter(i => (i.name ?? '').toLowerCase().includes('lobster'))
            .reduce((n, i) => n + i.count, 0);
        const guardsNear = g.__rs2b0t.Npcs.query()
            .results()
            .filter(n => n.name === 'Guard' && n.distance() <= 20).length;
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            tile: g.__rs2b0t.reader.worldTile(),
            runner: g.rs2b0t.runner.state,
            thievingXp: g.__rs2b0t.Skills.xp('thieving'),
            thievingLevel: g.__rs2b0t.Skills.level('thieving'),
            food,
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg })),
            guardsNear
        };
    });
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
    page.on('pageerror', e => console.log(`pageerror: ${e}`));

    await mainlandAccount(page, base, USER);
    console.log(`mainland-ready as '${USER}' @ ${base}`);

    // Stats: thieving 50 for Guards@40+, solid HP so fails don't death-loop.
    await advanceStat(page, 'thieving', 50);
    await advanceStat(page, 'hitpoints', 50);
    await advanceStat(page, 'defence', 40);
    await clearChatDialogs(page);
    console.log('  stats: thieving 50 / hp 50 / def 40');

    await clearInv(page);

    // Pack food only — skip bank seed on short budgets (setup waste).
    await seedItem(page, 'lobster', 'Lobster', INV_FOOD);
    console.log(`  inv: ${INV_FOOD} cooked Lobster (no bank seed)`);

    if (!(await teleArrive(page, GUARD_SPOT, 10))) {
        fail(`could not tele to Guard spot ${GUARD_SPOT.x},${GUARD_SPOT.z}`);
    }
    // Wait for Guards in scene after tele.
    {
        const deadline = Date.now() + 20_000;
        let ready = false;
        while (Date.now() < deadline) {
            const n = await page.evaluate(() =>
                (globalThis as never as Abi).__rs2b0t.Npcs.query()
                    .results()
                    .filter(npc => npc.name === 'Guard' && npc.distance() <= 18).length
            );
            if (n > 0) {
                ready = true;
                console.log(`  scene: ${n} Guard(s) nearby`);
                break;
            }
            await page.waitForTimeout(400);
        }
        if (!ready) {
            console.log('  warn: no Guards in scene yet — starting anyway');
        }
    }

    await setSettings(page, 'Thiever', {
        target: 'Guard',
        action: 'Pickpocket',
        food: 'Lobster',
        eatAtHp: 50,
        // No bank seed on short soaks — don't walk empty for food.
        banking: 'None',
        foodWithdraw: 22,
        bankAtFood: 0,
        // Blank loot: coin walks are not part of the XP/hr bar for #139.
        loot: '',
        obstacle: 'door, gate',
        leashRadius: 19
    });
    await startScript(page, 'Thiever');
    // XP/hr is measured from script start, not process boot (seed/relog skew).
    const scriptT0 = Date.now();
    console.log(
        `started Thiever Guard/Lobster/None/22/19 loot=off — budget ${Math.round(BUDGET_MS / 1000)}s, ` +
            `warmup ${WARMUP_S}s active, target ≥${(TARGET_XPH / 1000).toFixed(0)}k XP/hr`
    );

    const start = await snap(page);
    const startXp = start.thievingXp;
    let lastLogTime = 0;
    let peakXph = 0;
    let bestSample: { s: number; xph: number; gained: number } | null = null;

    while (Date.now() - t0 < BUDGET_MS) {
        await page.waitForTimeout(8_000);
        const cur = await snap(page);
        for (const l of cur.logs) {
            if (l.time > lastLogTime) {
                console.log(`  ${stamp()} [${l.level}] ${l.msg.slice(0, 220)}`);
                lastLogTime = l.time;
            }
        }

        const activeS = (Date.now() - scriptT0) / 1000;
        const gained = cur.thievingXp - startXp;
        const xph = activeS > 30 ? (gained / activeS) * 3600 : 0;
        if (xph > peakXph) {
            peakXph = xph;
        }

        const tile = cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?';
        console.log(
            `  ${stamp()} xp+${gained} (${(xph / 1000).toFixed(1)}k/hr active) food=${cur.food} ` +
                `guards=${cur.guardsNear} tile=${tile} runner=${cur.runner} lv=${cur.thievingLevel}`
        );

        if (cur.runner === 'crashed' || cur.runner === 'stopped') {
            fail(`runner state is '${cur.runner}' after +${gained} xp`);
        }

        if (activeS >= WARMUP_S) {
            bestSample = { s: activeS, xph, gained };
            if (xph >= TARGET_XPH && gained >= 500) {
                console.log(
                    `PASS: ${(xph / 1000).toFixed(1)}k thieving XP/hr ` +
                        `(+${gained} xp in ${Math.round(activeS)}s active; peak ${(peakXph / 1000).toFixed(1)}k)`
                );
                process.exit(0);
            }
        }
    }

    if (bestSample && bestSample.xph >= TARGET_XPH) {
        console.log(
            `PASS: ${(bestSample.xph / 1000).toFixed(1)}k thieving XP/hr ` +
                `(+${bestSample.gained} xp in ${Math.round(bestSample.s)}s active)`
        );
        process.exit(0);
    }

    const final = bestSample;
    fail(
        final
            ? `only ${(final.xph / 1000).toFixed(1)}k XP/hr after ${Math.round(final.s)}s active ` +
                  `(+${final.gained} xp, peak ${(peakXph / 1000).toFixed(1)}k; need ≥${(TARGET_XPH / 1000).toFixed(0)}k)`
            : `never left warmup (${WARMUP_S}s) with measurable XP`
    );
} finally {
    await browser.close();
}
