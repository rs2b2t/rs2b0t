/**
 * Live verification for GatheringBot (Miner / Fisher / Woodcutter).
 *
 * Boots a mainland account against a local engine, seeds skills/items (or coins
 * only for tool-buy paths), starts each script with camp settings, and asserts
 * on game state — XP, held products/tools, bank trips — not log lines alone.
 *
 * Item seed uses engine cheat `give <obj> <qty>` (not maintainer-content
 * `~item` / `~bankitem`, which this Server tree does not ship). Inventory wipe
 * is `~clearinv` (debugproc).
 *
 * Requires a deployed bot client and a running engine (default http://localhost:8890).
 * Redeploy the client yourself when GatheringBot changes — this tree does not
 * own the engine public/ tree.
 *
 * Usage:
 *   bun tools/gatheringbot-test.ts
 *   bun tools/gatheringbot-test.ts mining fishing
 *   bun tools/gatheringbot-test.ts acquire
 *   bun tools/gatheringbot-test.ts mine-bank wc-burn
 *   BASE=http://localhost:8888 bun tools/gatheringbot-test.ts
 *   HEADED=1 SLOWMO=200 bun tools/gatheringbot-test.ts mine-bank
 *   BUDGET_S=180 bun tools/gatheringbot-test.ts   # per-scenario seconds (default 150)
 */
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { cheatQuiet, mainlandAccount, startScript } from './tutorial/harness.js';

const { base, rest } = parseArgs(process.argv.slice(2), { base: process.env.BASE ?? 'http://localhost:8890' });
const filters = rest.map(s => s.toLowerCase());
const PER_SCENARIO_MS = (Number(process.env.BUDGET_S) || 150) * 1000;
const USER = process.env.USER_NAME || `gb${Date.now().toString(36).slice(-7)}`;

function failHard(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

// ── ABI ──────────────────────────────────────────────────────────────────────

type Tile = { x: number; z: number; level: number };

type Snap = {
    tile: Tile | null;
    runner: string;
    xp: Record<string, number>;
    level: Record<string, number>;
    inv: { name: string; count: number }[];
    worn: string[];
    used: number;
    free: number;
    logs: { time: number; level: string; msg: string }[];
};

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        Skills: { xp(n: string): number; level(n: string): number };
        Inventory: {
            count(n: string): number;
            items(): { name: string | null; count: number }[];
            used(): number;
            free(): number;
        };
        Equipment: { contains(n: string): boolean; items(): { name: string | null }[] };
    };
    rs2b0t: {
        runner: {
            state: string;
            ctx?: { log?: { time: number; level: string; msg: string }[] } | null;
            stop(): void;
        };
        registry: { get(name: string): unknown };
    };
};

// ── helpers ──────────────────────────────────────────────────────────────────

function teleCheat(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

function chebyshev(a: Tile, b: Tile): number {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

async function snap(page: Page): Promise<Snap> {
    return page.evaluate(() => {
        const g = globalThis as never as Abi;
        const skills = ['mining', 'fishing', 'woodcutting', 'cooking', 'firemaking', 'smithing'];
        const xp: Record<string, number> = {};
        const level: Record<string, number> = {};
        for (const s of skills) {
            xp[s] = g.__rs2b0t.Skills.xp(s);
            level[s] = g.__rs2b0t.Skills.level(s);
        }
        const inv = g.__rs2b0t.Inventory.items()
            .filter(i => i.name)
            .map(i => ({ name: i.name!, count: i.count }));
        const worn = g.__rs2b0t.Equipment.items()
            .map(i => i.name)
            .filter((n): n is string => !!n);
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            tile: g.__rs2b0t.reader.worldTile(),
            runner: g.rs2b0t.runner.state,
            xp,
            level,
            inv,
            worn,
            used: g.__rs2b0t.Inventory.used(),
            free: g.__rs2b0t.Inventory.free(),
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    });
}

function invCount(s: Snap, name: string): number {
    const wanted = name.toLowerCase();
    return s.inv.filter(i => i.name.toLowerCase() === wanted).reduce((n, i) => n + i.count, 0);
}

function invMatch(s: Snap, re: RegExp): number {
    return s.inv.filter(i => re.test(i.name)).reduce((n, i) => n + i.count, 0);
}

function hasTool(s: Snap, name: string): boolean {
    const wanted = name.toLowerCase();
    if (s.worn.some(w => w.toLowerCase() === wanted)) {
        return true;
    }
    return invCount(s, name) > 0;
}

function hasAnyPick(s: Snap): boolean {
    return s.worn.some(w => /pickaxe/i.test(w)) || s.inv.some(i => /pickaxe/i.test(i.name));
}

function hasAnyAxe(s: Snap): boolean {
    return s.worn.some(w => /\baxe\b/i.test(w) && !/pickaxe/i.test(w))
        || s.inv.some(i => /\baxe\b/i.test(i.name) && !/pickaxe/i.test(i.name));
}

async function stopScript(page: Page): Promise<void> {
    await page.evaluate(() => {
        try {
            (globalThis as never as Abi).rs2b0t.runner.stop();
        } catch {
            /* ignore */
        }
    });
    await page.waitForTimeout(400);
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

/**
 * Seed held items via engine cheat `give` (ClientCheatHandler).
 *
 * Local Server engines expose `give <obj> <qty>`, not the maintainer-content
 * debugprocs `~item` / `~bankitem`. Using `~item` here silently no-ops while
 * `~clearinv` still works — which looks like an endless inventory wipe.
 */
async function seedItem(page: Page, debugName: string, displayName: string, qty = 1): Promise<void> {
    const cmd = `give ${debugName} ${qty}`;
    for (let i = 0; i < 8; i++) {
        const sent = await cheatQuiet(page, cmd);
        if (!sent) {
            throw new Error(`give not sent (not ingame?) for ${displayName}`);
        }
        // Engine applies invAdd on the next tick; allow a couple polls.
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

async function advanceStat(page: Page, skill: string, level: number): Promise<void> {
    if (level <= 1) {
        return;
    }
    for (let i = 0; i < 4; i++) {
        const sent = await cheatQuiet(page, `advancestat ${skill} ${level}`);
        if (!sent) {
            throw new Error(`advancestat not sent (not ingame?) for ${skill}`);
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

async function clearInv(page: Page): Promise<void> {
    // debugproc clearinv — works on inv without p_finduid; still wait a tick.
    const sent = await cheatQuiet(page, '~clearinv');
    if (!sent) {
        throw new Error('~clearinv not sent (not ingame?)');
    }
    await page.waitForTimeout(700);
    // Confirm empty (ignore worn).
    for (let i = 0; i < 6; i++) {
        const used = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Inventory.used());
        if (used === 0) {
            return;
        }
        await cheatQuiet(page, '~clearinv');
        await page.waitForTimeout(400);
    }
}

async function teleArrive(page: Page, spot: Tile, maxDist = 18): Promise<boolean> {
    const cmd = teleCheat(spot);
    for (let attempt = 0; attempt < 4; attempt++) {
        // tutorial/harness cheatQuiet ignores a 3rd arg — fixed ~700ms settle per send.
        await cheatQuiet(page, cmd);
        for (let poll = 0; poll < 12; poll++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && t.level === spot.level && chebyshev(t, spot) <= maxDist) {
                // Zone rebuild lags the tile update (docs/NAV.md#level-change-loc-lag).
                // Blank Locs/Npcs here is "not loaded yet", not "camp empty".
                await page.waitForTimeout(600);
                return true;
            }
            await page.waitForTimeout(350);
        }
    }
    return false;
}

type SceneExpect = 'rocks' | 'trees' | 'fish' | 'any-loc' | 'shop';

/**
 * After ::tele the player tile updates before scenery/NPCs rebuild. Starting
 * GatheringBot in that window pins the leash to the camp with zero targets in
 * scene — looks stuck ("no rocks in leash") until something else moves the bot.
 * Poll until the expected resource class is visible near the player.
 */
async function waitSceneReady(
    page: Page,
    expect: SceneExpect,
    opts: { radius?: number; timeoutMs?: number; label?: string } = {}
): Promise<void> {
    const radius = opts.radius ?? 14;
    const timeoutMs = opts.timeoutMs ?? 12000;
    const label = opts.label ?? expect;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        const hit = await page.evaluate(
            ([kind, r]) => {
                const g = globalThis as never as Abi & {
                    __rs2b0t: {
                        Locs: {
                            query(): {
                                results(): {
                                    name: string | null;
                                    distance(): number;
                                    actions(): string[];
                                }[];
                            };
                        };
                        Npcs: {
                            query(): {
                                results(): {
                                    name: string | null;
                                    distance(): number;
                                }[];
                            };
                        };
                    };
                    rs2b0t: { client: { sceneState: number; ingame: boolean } };
                };
                if (!g.rs2b0t?.client?.ingame || g.rs2b0t.client.sceneState !== 2) {
                    return false;
                }
                const locs = g.__rs2b0t.Locs.query()
                    .results()
                    .filter(l => l.distance() <= r);
                const npcs = g.__rs2b0t.Npcs.query()
                    .results()
                    .filter(n => n.distance() <= r);
                if (kind === 'rocks') {
                    return locs.some(
                        l => /rock/i.test(l.name ?? '') && l.actions().some(a => /mine/i.test(a ?? ''))
                    );
                }
                if (kind === 'trees') {
                    return locs.some(
                        l =>
                            /tree|oak|willow|maple|yew|magic/i.test(l.name ?? '')
                            && l.actions().some(a => /chop/i.test(a ?? ''))
                    );
                }
                if (kind === 'fish') {
                    return npcs.some(n => /fishing spot/i.test(n.name ?? ''));
                }
                if (kind === 'shop') {
                    // Shopkeeper / tool seller nearby is enough for buy paths.
                    return npcs.length > 0 || locs.length > 0;
                }
                return locs.length > 0 || npcs.length > 0;
            },
            [expect, radius] as const
        );
        if (hit) {
            // One extra beat so multi-tile footprints finish streaming in.
            await page.waitForTimeout(400);
            return;
        }
        await page.waitForTimeout(350);
    }
    throw new Error(`scene not ready for ${label} within ${timeoutMs}ms (post-tele loc lag?)`);
}

function sceneExpectFor(sc: { id: string; script: Scenario['script'] }): SceneExpect {
    if (sc.id.startsWith('buy-')) {
        return 'shop';
    }
    if (sc.script === 'Miner') {
        return 'rocks';
    }
    if (sc.script === 'Woodcutter') {
        return 'trees';
    }
    return 'fish';
}

function printNewLogs(s: Snap, lastTime: number, stamp: () => string): number {
    let max = lastTime;
    for (const l of s.logs) {
        if (l.time > lastTime) {
            console.log(`      ${stamp()} · [${l.level}] ${l.msg.slice(0, 220)}`);
            if (l.time > max) {
                max = l.time;
            }
        }
    }
    return max;
}

// ── scenarios ────────────────────────────────────────────────────────────────

type Scenario = {
    id: string;
    /** Group tags for CLI filters: mining, fishing, wc, acquire, all */
    tags: string[];
    script: 'Miner' | 'Fisher' | 'Woodcutter';
    spot: Tile;
    settings: Record<string, string | number | boolean>;
    /** Held items to seed via `give` (debug name → display name, qty). No tools for acquire tests. */
    seed?: { debug: string; name: string; qty?: number }[];
    /** Skill levels to advance before start. */
    stats?: { skill: string; level: number }[];
    budgetMs?: number;
    check: (ctx: {
        start: Snap;
        cur: Snap;
        elapsedMs: number;
        sawProduct: boolean;
        productPeak: number;
        bankedHint: boolean;
    }) => 'pass' | 'wait' | 'fail';
    failMsg?: (ctx: { start: Snap; cur: Snap }) => string;
};

const SPOT = {
    swVarrockMine: { x: 3181, z: 3371, level: 0 },
    seVarrockMine: { x: 3285, z: 3366, level: 0 },
    draynorFish: { x: 3086, z: 3231, level: 0 },
    catherbyFish: { x: 2845, z: 3431, level: 0 },
    draynorTrees: { x: 3098, z: 3242, level: 0 },
    draynorWillows: { x: 3087, z: 3234, level: 0 },
    /** Near Bob (Lumbridge axes) — tool-buy axe. */
    bob: { x: 3231, z: 3203, level: 0 },
    /** Near Gerrant (Port Sarim fishing). */
    gerrant: { x: 3013, z: 3224, level: 0 },
    /** Surface hop for Nurmof (dwarven mine picks). */
    nurmofHop: { x: 3019, z: 3449, level: 0 },
    faladorEast: { x: 3013, z: 3355, level: 0 }
} as const;

const SCENARIOS: Scenario[] = [
    {
        id: 'mine-bank',
        tags: ['mining', 'mine', 'bank'],
        script: 'Miner',
        spot: SPOT.swVarrockMine,
        settings: {
            // SW Varrock seed has tin in leash — not copper (and Miner default is Iron).
            rocks: 'Tin',
            location: 'Southwest Varrock Mine',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 12
        },
        seed: [{ debug: 'bronze_pickaxe', name: 'Bronze pickaxe', qty: 1 }],
        stats: [{ skill: 'mining', level: 5 }],
        check: ({ start, cur, sawProduct, productPeak, bankedHint }) => {
            const xpGain = cur.xp.mining - start.xp.mining;
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            // Gathered ore and either still holding it or already banked a load.
            if (xpGain >= 35 && (sawProduct || productPeak > 0)) {
                return 'pass';
            }
            // Strong bank signal: product peaked then left pack after XP gain.
            if (xpGain > 0 && bankedHint) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur }) =>
            `mining xp ${start.xp.mining}→${cur.xp.mining}, inv=${cur.inv.map(i => `${i.count}x ${i.name}`).join(', ') || 'empty'}`
    },
    {
        id: 'mine-power',
        tags: ['mining', 'mine', 'power', 'drop'],
        script: 'Miner',
        spot: SPOT.swVarrockMine,
        settings: {
            rocks: 'Tin',
            location: 'None',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 10
        },
        seed: [{ debug: 'bronze_pickaxe', name: 'Bronze pickaxe', qty: 1 }],
        stats: [{ skill: 'mining', level: 5 }],
        check: ({ start, cur, sawProduct, productPeak }) => {
            const xpGain = cur.xp.mining - start.xp.mining;
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            // Power-mine: XP up and product was seen (and ideally dropped — peak then lower).
            if (xpGain >= 50 && sawProduct) {
                return 'pass';
            }
            if (xpGain >= 70 && productPeak >= 1) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur }) =>
            `power-mine xp ${start.xp.mining}→${cur.xp.mining}, product=${invMatch(cur, /ore/i)}`
    },
    {
        id: 'fish-bank',
        tags: ['fishing', 'fish', 'bank'],
        script: 'Fisher',
        spot: SPOT.draynorFish,
        settings: {
            fishMethod: 'Small net — shrimp/anchovy',
            location: 'Draynor Village',
            cookMode: 'Off',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 18
        },
        seed: [{ debug: 'net', name: 'Small fishing net', qty: 1 }],
        stats: [{ skill: 'fishing', level: 5 }],
        check: ({ start, cur, sawProduct, bankedHint }) => {
            const xpGain = cur.xp.fishing - start.xp.fishing;
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            if (xpGain >= 30 && (sawProduct || bankedHint)) {
                return 'pass';
            }
            if (xpGain >= 50) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur }) =>
            `fishing xp ${start.xp.fishing}→${cur.xp.fishing}, raw=${invMatch(cur, /^raw /i)}`
    },
    {
        id: 'fish-cook',
        tags: ['fishing', 'fish', 'cook'],
        script: 'Fisher',
        spot: SPOT.catherbyFish,
        settings: {
            fishMethod: 'Lobster cage — lobster',
            location: 'Catherby',
            cookMode: 'Cook then bank',
            cookFish: 'All raw',
            burntPolicy: 'Drop',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 18
        },
        // Full pack of raw lobster so cook-then-bank fires immediately (no 20+ min fish).
        seed: [
            { debug: 'lobster_pot', name: 'Lobster pot', qty: 1 },
            { debug: 'raw_lobster', name: 'Raw lobster', qty: 27 }
        ],
        stats: [
            { skill: 'fishing', level: 40 },
            { skill: 'cooking', level: 40 }
        ],
        budgetMs: 180_000,
        check: ({ start, cur }) => {
            const cookXp = cur.xp.cooking - start.xp.cooking;
            const cooked = invMatch(cur, /^lobster$/i);
            const rawLeft = invMatch(cur, /^raw lobster$/i);
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            if (cookXp > 0 || cooked > 0) {
                return 'pass';
            }
            // Raw count dropped without cooking XP can mean banked raw — still wait.
            if (rawLeft < 27 && cookXp === 0) {
                return 'wait';
            }
            return 'wait';
        },
        failMsg: ({ start, cur }) =>
            `cook xp ${start.xp.cooking}→${cur.xp.cooking}, rawLob=${invMatch(cur, /^raw lobster$/i)} cookedLob=${invMatch(cur, /^lobster$/i)}`
    },
    {
        id: 'wc-bank',
        tags: ['woodcutting', 'wc', 'bank'],
        script: 'Woodcutter',
        spot: SPOT.draynorTrees,
        settings: {
            treeName: 'Tree',
            location: 'Draynor (trees)',
            burnMode: 'Off',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 12
        },
        seed: [{ debug: 'bronze_axe', name: 'Bronze axe', qty: 1 }],
        stats: [{ skill: 'woodcutting', level: 5 }],
        check: ({ start, cur, sawProduct, bankedHint }) => {
            const xpGain = cur.xp.woodcutting - start.xp.woodcutting;
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            if (xpGain >= 40 && (sawProduct || bankedHint || invMatch(cur, /logs/i) > 0)) {
                return 'pass';
            }
            if (xpGain >= 60) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ start, cur }) =>
            `wc xp ${start.xp.woodcutting}→${cur.xp.woodcutting}, logs=${invMatch(cur, /logs/i)}`
    },
    {
        id: 'wc-burn',
        tags: ['woodcutting', 'wc', 'burn', 'firemaking'],
        script: 'Woodcutter',
        spot: SPOT.draynorTrees,
        settings: {
            treeName: 'Tree',
            location: 'Draynor (trees)',
            burnMode: 'Chop then burn',
            fireSpot: 'Auto',
            toolAcquire: 'Off',
            forgetfulBank: false,
            leashRadius: 12
        },
        // Near-full logs so chop-then-burn starts lighting without a long chop first.
        seed: [
            { debug: 'bronze_axe', name: 'Bronze axe', qty: 1 },
            { debug: 'tinderbox', name: 'Tinderbox', qty: 1 },
            { debug: 'logs', name: 'Logs', qty: 26 }
        ],
        stats: [
            { skill: 'woodcutting', level: 5 },
            { skill: 'firemaking', level: 5 }
        ],
        budgetMs: 150_000,
        check: ({ start, cur }) => {
            const fmXp = cur.xp.firemaking - start.xp.firemaking;
            const logs = invMatch(cur, /^logs$/i);
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            if (fmXp > 0) {
                return 'pass';
            }
            if (logs < 26 && fmXp === 0) {
                return 'wait';
            }
            return 'wait';
        },
        failMsg: ({ start, cur }) =>
            `fm xp ${start.xp.firemaking}→${cur.xp.firemaking}, logs=${invMatch(cur, /^logs$/i)}`
    },
    {
        id: 'buy-pick',
        tags: ['acquire', 'buy', 'mining', 'tools'],
        script: 'Miner',
        // Start at surface hop so Buy/repair can enter Nurmof; camp is Dwarven Mine.
        spot: SPOT.nurmofHop,
        settings: {
            rocks: 'Copper',
            location: 'Dwarven Mine',
            toolAcquire: 'Buy / repair',
            forgetfulBank: false,
            leashRadius: 14
        },
        // Coins only — no pick. Optional bars/smithing not required for bronze.
        // Held stack (no ~bankitem on this engine); enough for Nurmof hop + buy.
        seed: [{ debug: 'coins', name: 'Coins', qty: 2500 }],
        stats: [{ skill: 'mining', level: 5 }],
        budgetMs: 180_000,
        check: ({ start, cur, elapsedMs }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const gotPick = hasAnyPick(cur);
            const xpGain = cur.xp.mining - start.xp.mining;
            if (gotPick && xpGain > 0) {
                return 'pass';
            }
            // Tool alone after ~45s proves the buy path (gather may still path underground).
            if (gotPick && elapsedMs >= 45_000) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ cur }) =>
            `pick=${hasAnyPick(cur)} coins=${invCount(cur, 'Coins')} inv=${cur.inv.map(i => i.name).join(',') || 'empty'}`
    },
    {
        id: 'buy-axe',
        tags: ['acquire', 'buy', 'woodcutting', 'wc', 'tools'],
        script: 'Woodcutter',
        spot: SPOT.bob,
        settings: {
            treeName: 'Tree',
            location: 'Draynor (trees)',
            burnMode: 'Off',
            toolAcquire: 'Buy / repair',
            forgetfulBank: false,
            leashRadius: 12
        },
        seed: [{ debug: 'coins', name: 'Coins', qty: 2500 }],
        stats: [{ skill: 'woodcutting', level: 5 }],
        budgetMs: 180_000,
        check: ({ start, cur, elapsedMs }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const gotAxe = hasAnyAxe(cur);
            const xpGain = cur.xp.woodcutting - start.xp.woodcutting;
            if (gotAxe && xpGain > 0) {
                return 'pass';
            }
            if (gotAxe && elapsedMs >= 45_000) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ cur }) =>
            `axe=${hasAnyAxe(cur)} coins=${invCount(cur, 'Coins')} inv=${cur.inv.map(i => i.name).join(',') || 'empty'}`
    },
    {
        id: 'buy-net',
        tags: ['acquire', 'buy', 'fishing', 'tools'],
        script: 'Fisher',
        spot: SPOT.gerrant,
        settings: {
            fishMethod: 'Small net — shrimp/anchovy',
            location: 'Draynor Village',
            cookMode: 'Off',
            toolAcquire: 'Buy / repair',
            forgetfulBank: false,
            leashRadius: 18
        },
        seed: [{ debug: 'coins', name: 'Coins', qty: 1200 }],
        stats: [{ skill: 'fishing', level: 5 }],
        budgetMs: 180_000,
        check: ({ start, cur, elapsedMs }) => {
            if (cur.runner === 'crashed') {
                return 'fail';
            }
            const gotNet = invCount(cur, 'Small fishing net') > 0;
            const xpGain = cur.xp.fishing - start.xp.fishing;
            if (gotNet && xpGain > 0) {
                return 'pass';
            }
            if (gotNet && elapsedMs >= 45_000) {
                return 'pass';
            }
            return 'wait';
        },
        failMsg: ({ cur }) =>
            `net=${invCount(cur, 'Small fishing net')} coins=${invCount(cur, 'Coins')}`
    }
];

// Soft-pass for buy scenarios: tool acquired after enough wall time proves buy path
// even if gather resume is slow (pathing/hop).
function buySoftPass(id: string, cur: Snap, elapsedMs: number): boolean {
    if (elapsedMs < 45_000) {
        return false;
    }
    if (id === 'buy-pick') {
        return hasAnyPick(cur);
    }
    if (id === 'buy-axe') {
        return hasAnyAxe(cur);
    }
    if (id === 'buy-net') {
        return invCount(cur, 'Small fishing net') > 0;
    }
    return false;
}

function wantScenario(s: Scenario): boolean {
    if (filters.length === 0) {
        return true;
    }
    return filters.some(f => f === 'all' || s.id === f || s.tags.includes(f) || s.script.toLowerCase() === f);
}

// ── run ──────────────────────────────────────────────────────────────────────

const selected = SCENARIOS.filter(wantScenario);
if (selected.length === 0) {
    failHard(
        `no scenarios match [${filters.join(', ')}]. ids: ${SCENARIOS.map(s => s.id).join(', ')}`
    );
}

console.log(`gatheringbot-test base=${base} user=${USER} scenarios=${selected.map(s => s.id).join(',')}`);
console.log(`per-scenario budget ≈ ${Math.round(PER_SCENARIO_MS / 1000)}s (override with BUDGET_S=)`);

const browser = await launchBrowser({ swiftshader: true });
const results: { id: string; ok: boolean; detail: string; ms: number }[] = [];

try {
    const page = await browser.newPage();
    const t0 = Date.now();
    const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]') && /error|fail|park|PARKED/i.test(txt)) {
            console.log(`  ${stamp()} ${txt.slice(0, 200)}`);
        }
    });

    await mainlandAccount(page, base, USER);
    console.log(`${stamp()} mainland-ready as '${USER}'`);

    // Registry sanity — scripts must be present in the deployed client.
    const names = await page.evaluate(() => {
        const r = (globalThis as never as Abi).rs2b0t.registry;
        return ['Miner', 'Fisher', 'Woodcutter'].map(n => `${n}=${r.get(n) ? 'ok' : 'MISSING'}`);
    });
    console.log(`${stamp()} registry ${names.join(' ')}`);
    if (names.some(n => n.includes('MISSING'))) {
        failHard('script registry missing Miner/Fisher/Woodcutter — redeploy bot client');
    }

    for (const sc of selected) {
        const scStart = Date.now();
        console.log(`\n══ ${sc.id} (${sc.script}) ══`);
        try {
            await stopScript(page);
            await clearInv(page);

            // Seed items BEFORE stat floods (same lesson as firegiant-test).
            // Use engine `give` — `~item`/`~bankitem` are not on this Server tree.
            for (const it of sc.seed ?? []) {
                await seedItem(page, it.debug, it.name, it.qty ?? 1);
                console.log(`  seeded ${it.qty ?? 1}x ${it.name}`);
            }
            for (const st of sc.stats ?? []) {
                await advanceStat(page, st.skill, st.level);
                console.log(`  ${st.skill} → ${st.level}`);
            }

            // Acquire tests must not already hold the tool.
            if (sc.id.startsWith('buy-')) {
                const pre = await snap(page);
                if (sc.id === 'buy-pick' && hasAnyPick(pre)) {
                    throw new Error('precondition: already holding a pickaxe');
                }
                if (sc.id === 'buy-axe' && hasAnyAxe(pre)) {
                    throw new Error('precondition: already holding an axe');
                }
                if (sc.id === 'buy-net' && invCount(pre, 'Small fishing net') > 0) {
                    throw new Error('precondition: already holding a net');
                }
                if (invCount(pre, 'Coins') < 1) {
                    throw new Error('precondition: no coins after seed');
                }
            }

            const arrived = await teleArrive(page, sc.spot);
            if (!arrived) {
                const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
                throw new Error(`tele to ${sc.spot.x},${sc.spot.z} failed (at ${t ? `${t.x},${t.z},${t.level}` : '?'})`);
            }
            console.log(`  arrived near ${sc.spot.x},${sc.spot.z}`);

            // Do not start until scenery/NPCs exist in the leash — tele tile lands
            // a beat before Locs rebuild (same lag as level-change transports).
            const expect = sceneExpectFor(sc);
            await waitSceneReady(page, expect, {
                radius: Math.max(14, Number(sc.settings.leashRadius) || 12),
                label: `${sc.id}/${expect}`
            });
            console.log(`  scene ready (${expect})`);

            await setSettings(page, sc.script, sc.settings);
            // Confirm storage keys the runner will resolve (Miner default rocks=Iron
            // would idle at tin-only SW Varrock if this write missed).
            const applied = await page.evaluate(name => {
                const keys = ['rocks', 'treeName', 'fishMethod', 'location', 'leashRadius', 'toolAcquire'];
                const out: Record<string, string | null> = {};
                for (const k of keys) {
                    out[k] = sessionStorage.getItem(`rs2b0t:set:${name}:${k}`);
                }
                return out;
            }, sc.script);
            console.log(`  settings ${JSON.stringify(applied)}`);
            await startScript(page, sc.script);
            console.log(`  started ${sc.script}`);

            const start = await snap(page);
            let lastLog = 0;
            let sawProduct = false;
            let productPeak = 0;
            let bankedHint = false;
            let prevProduct = 0;
            const budget = sc.budgetMs ?? PER_SCENARIO_MS;
            let outcome: 'pass' | 'fail' = 'fail';
            let detail = '';

            while (Date.now() - scStart < budget) {
                await page.waitForTimeout(4000);
                const cur = await snap(page);
                lastLog = printNewLogs(cur, lastLog, stamp);

                const product =
                    sc.script === 'Miner'
                        ? invMatch(cur, /ore/i)
                        : sc.script === 'Fisher'
                          ? invMatch(cur, /^raw /i)
                          : invMatch(cur, /logs/i);
                if (product > 0) {
                    sawProduct = true;
                }
                if (product > productPeak) {
                    productPeak = product;
                }
                // Product left the pack after we had some + XP moved → likely banked or dropped.
                if (prevProduct >= 3 && product < prevProduct - 1 && cur.xp.mining + cur.xp.fishing + cur.xp.woodcutting > start.xp.mining + start.xp.fishing + start.xp.woodcutting) {
                    bankedHint = true;
                }
                prevProduct = product;

                const elapsedMs = Date.now() - scStart;
                const verdict = sc.check({ start, cur, elapsedMs, sawProduct, productPeak, bankedHint });
                if (verdict === 'pass' || buySoftPass(sc.id, cur, elapsedMs)) {
                    outcome = 'pass';
                    detail = `xpΔ m/f/w/c/fm=${cur.xp.mining - start.xp.mining}/${cur.xp.fishing - start.xp.fishing}/${cur.xp.woodcutting - start.xp.woodcutting}/${cur.xp.cooking - start.xp.cooking}/${cur.xp.firemaking - start.xp.firemaking} productPeak=${productPeak} tile=${cur.tile ? `${cur.tile.x},${cur.tile.z}` : '?'}`;
                    break;
                }
                if (verdict === 'fail') {
                    outcome = 'fail';
                    detail = sc.failMsg?.({ start, cur }) ?? `runner=${cur.runner}`;
                    break;
                }
                if (cur.runner === 'stopped' || cur.runner === 'crashed') {
                    // Re-check once more for pass conditions after stop.
                    const again = sc.check({ start, cur, elapsedMs, sawProduct, productPeak, bankedHint });
                    if (again === 'pass' || buySoftPass(sc.id, cur, elapsedMs)) {
                        outcome = 'pass';
                        detail = `stopped ok; productPeak=${productPeak}`;
                    } else {
                        outcome = 'fail';
                        detail = `runner ${cur.runner}; ${sc.failMsg?.({ start, cur }) ?? ''}`;
                    }
                    break;
                }
            }

            if (outcome !== 'pass' && Date.now() - scStart >= (sc.budgetMs ?? PER_SCENARIO_MS)) {
                const cur = await snap(page);
                // Final soft pass for buy paths.
                if (buySoftPass(sc.id, cur, Date.now() - scStart)) {
                    outcome = 'pass';
                    detail = `tool acquired (soft) after budget; ${sc.failMsg?.({ start, cur }) ?? ''}`;
                } else {
                    outcome = 'fail';
                    detail = `timeout; ${sc.failMsg?.({ start, cur }) ?? ''}`;
                }
            }

            await stopScript(page);
            const ms = Date.now() - scStart;
            results.push({ id: sc.id, ok: outcome === 'pass', detail, ms });
            console.log(`${outcome === 'pass' ? 'PASS' : 'FAIL'} ${sc.id} (${Math.round(ms / 1000)}s) ${detail}`);
        } catch (e) {
            await stopScript(page).catch(() => undefined);
            const ms = Date.now() - scStart;
            const detail = e instanceof Error ? e.message : String(e);
            results.push({ id: sc.id, ok: false, detail, ms });
            console.log(`FAIL ${sc.id} (${Math.round(ms / 1000)}s) ${detail}`);
        }
    }
} finally {
    await browser.close();
}

console.log('\n── summary ──');
for (const r of results) {
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(12)} ${Math.round(r.ms / 1000)}s  ${r.detail}`);
}
const failed = results.filter(r => !r.ok);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
    process.exit(1);
}
console.log('PASS');
