/** Range-path smoke for every fishing camp with a curated cook surface: tele to the pier, seed raw fish, start Fisher, pass on reaching the range stand or gaining cook XP.
 *  Why: the case list mirrors CookingRanges FISH_CAMP_COOK_PLANS and must be kept in sync, and nothing here may import from src/bot — the client graphics init breaks under plain Bun. */

// Why: it catches door/approach regressions (Seers Large door) without a full bank-home loop.

// Usage:
//   HEADED=1 bun e2e/gatheringbot-range-path-test.ts
//   BUDGET_S=120 bun e2e/gatheringbot-range-path-test.ts
//   CAMPS=Catherby,Seers bun e2e/gatheringbot-range-path-test.ts

// Redeploy first when GatheringBot / CookingRanges / walkOpening change:
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

const { base, rest } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});
const PER_CAMP_MS = (Number(process.env.BUDGET_S) || 120) * 1000;
const FILTER = (process.env.CAMPS ?? rest.join(',') ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

type Tile = { x: number; z: number; level: number };
type Role = 'pier' | 'bank';

type Case = {
    id: string;
    camp: string;
    role: Role;
    stand: Tile;
    approach?: Tile;
    locName: string;
    label: string;
    spot: Tile;
    bank: Tile;
    fishMethod: string;
    rawDebug: string;
    /** Gear give so RestockFishingGear does not thrash (unused under Cooker mode). */
    toolDebug: string;
};

/**
 * Keep aligned with src/bot/api/catalogs/CookingRanges.ts FISH_CAMP_COOK_PLANS +
 * FishingLocations camp spots. Unit test listFishCampRangePathCases guards API side.
 */
const CASES_ALL: Case[] = [
    {
        id: 'range-path-catherby-pier',
        camp: 'Catherby',
        role: 'pier',
        stand: { x: 2817, z: 3443, level: 0 },
        locName: 'Range',
        label: 'Catherby range (bank house)',
        spot: { x: 2845, z: 3431, level: 0 },
        bank: { x: 2809, z: 3441, level: 0 },
        fishMethod: 'Lobster cage — lobster',
        rawDebug: 'raw_lobster',
        toolDebug: 'lobster_pot'
    },
    {
        id: 'range-path-seers-fly-fishing-pier',
        camp: 'Seers (fly fishing)',
        role: 'pier',
        approach: { x: 2740, z: 3570, level: 0 },
        stand: { x: 2735, z: 3581, level: 0 },
        locName: 'Range',
        label: 'Sinclair mansion range (Large-door approach)',
        spot: { x: 2716, z: 3532, level: 0 },
        bank: { x: 2725, z: 3491, level: 0 },
        fishMethod: 'Fly fishing — trout/salmon',
        rawDebug: 'raw_trout',
        toolDebug: 'fly_fishing_rod'
    },
    {
        id: 'range-path-seers-fly-fishing-bank',
        camp: 'Seers (fly fishing)',
        role: 'bank',
        approach: { x: 2713, z: 3484, level: 0 },
        stand: { x: 2716, z: 3477, level: 0 },
        locName: 'Range',
        label: 'Seers village range (near bank)',
        spot: { x: 2716, z: 3532, level: 0 },
        bank: { x: 2725, z: 3491, level: 0 },
        fishMethod: 'Fly fishing — trout/salmon',
        rawDebug: 'raw_trout',
        toolDebug: 'fly_fishing_rod'
    },
    {
        id: 'range-path-fishing-guild-pier',
        camp: 'Fishing Guild',
        role: 'pier',
        stand: { x: 2616, z: 3395, level: 0 },
        locName: 'Range',
        label: 'Ardougne range S of guild',
        spot: { x: 2604, z: 3420, level: 0 },
        bank: { x: 2586, z: 3420, level: 0 },
        fishMethod: 'Lobster cage — lobster',
        rawDebug: 'raw_lobster',
        toolDebug: 'lobster_pot'
    },
    {
        id: 'range-path-barbarian-village-pier',
        camp: 'Barbarian Village',
        role: 'pier',
        stand: { x: 3079, z: 3444, level: 0 },
        locName: 'Fire',
        label: 'Barb outdoor fires',
        spot: { x: 3104, z: 3430, level: 0 },
        bank: { x: 3094, z: 3493, level: 0 },
        fishMethod: 'Fly fishing — trout/salmon',
        rawDebug: 'raw_trout',
        toolDebug: 'fly_fishing_rod'
    },
    {
        id: 'range-path-draynor-village-pier',
        camp: 'Draynor Village',
        role: 'pier',
        approach: { x: 3102, z: 3258, level: 0 },
        stand: { x: 3100, z: 3257, level: 0 },
        locName: 'Fireplace',
        label: 'Draynor house fireplace',
        spot: { x: 3086, z: 3231, level: 0 },
        bank: { x: 3093, z: 3243, level: 0 },
        fishMethod: 'Small net — shrimp/anchovy',
        rawDebug: 'raw_shrimp',
        toolDebug: 'net'
    }
];

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        Inventory: { items(): { name: string | null; count: number }[] };
        Skills: { xp(n: string): number };
    };
    rs2b0t: {
        runner: {
            state: string;
            stop(reason: string): void;
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

function cheb(a: Tile, b: Tile): number {
    if (a.level !== b.level) {
        return 999;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function selectCases(): Case[] {
    if (FILTER.length === 0) {
        return CASES_ALL;
    }
    return CASES_ALL.filter(c => {
        const n = c.camp.toLowerCase();
        return FILTER.some(f => n.includes(f) || f.includes(n) || c.id.includes(f));
    });
}

async function teleArrive(page: Page, spot: Tile, maxDist = 12): Promise<void> {
    for (let a = 0; a < 5; a++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let p = 0; p < 14; p++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && cheb(t, spot) <= maxDist) {
                await page.waitForTimeout(600);
                return;
            }
            await page.waitForTimeout(300);
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

async function stopScript(page: Page): Promise<void> {
    try {
        await page.evaluate(() => {
            try {
                (globalThis as never as Abi).rs2b0t.runner.stop('harness stop');
            } catch {
                /* ignore */
            }
        });
    } catch {
        /* ignore */
    }
    await page.waitForTimeout(400);
}

async function sample(
    page: Page,
    stand: Tile,
    approach?: Tile
): Promise<{
    tile: Tile | null;
    distStand: number;
    distApproach: number;
    cookXp: number;
    raw: number;
    used: number;
    state: string;
    logs: string[];
    lastLog: string;
    invNames: string[];
}> {
    return page.evaluate(
        ([st, ap]) => {
            const g = globalThis as never as Abi;
            const tile = g.__rs2b0t.reader.worldTile();
            const d = (a: Tile | null, b: Tile) =>
                !a || a.level !== b.level
                    ? 999
                    : Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
            const items = g.__rs2b0t.Inventory.items();
            const raw = items
                .filter(i => /^raw /i.test(i.name ?? ''))
                .reduce((s, i) => s + Math.max(1, i.count), 0);
            const logs = (g.rs2b0t.runner.ctx?.log ?? []).map(l => l.msg);
            return {
                tile,
                distStand: d(tile, st as Tile),
                distApproach: ap ? d(tile, ap as Tile) : 999,
                cookXp: g.__rs2b0t.Skills.xp('cooking'),
                raw,
                used: items.length,
                state: g.rs2b0t.runner.state,
                logs,
                lastLog: (logs[logs.length - 1] ?? '').slice(0, 90),
                invNames: items.map(i => `${i.count}×${i.name ?? '?'}`).slice(0, 8)
            };
        },
        [stand, approach ?? null] as const
    );
}

function logHas(msgs: string[], re: RegExp): boolean {
    return msgs.some(m => re.test(m));
}

/** How many raw stacks fit with tool (+ feathers for fly). */
function rawSeedQty(toolDebug: string): number {
    // 28-slot pack: tool [+ feather stack] + raw.
    if (toolDebug === 'fly_fishing_rod') {
        return 26; // rod + feather + 26 raw = 28
    }
    return 27; // pot/net + 27 raw = 28
}

const CASES = selectCases();
if (CASES.length === 0) {
    fail(`no range-path cases (filter=${FILTER.join(',') || 'none'})`);
}

console.log(
    `gatheringbot-range-path base=${base} cases=${CASES.length} budget≈${Math.round(PER_CAMP_MS / 1000)}s each`
);
for (const c of CASES) {
    console.log(
        `  - ${c.id}: ${c.camp} [${c.role}] ${c.label} stand=${c.stand.x},${c.stand.z}` +
            (c.approach ? ` approach=${c.approach.x},${c.approach.z}` : '')
    );
}

const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
const results: { id: string; ok: boolean; detail: string; ms: number }[] = [];

try {
    const page = await (await browser.newContext()).newPage();
    const user = process.env.USER_NAME || `gbrp${Date.now().toString(36).slice(-6)}`;
    console.log(`${stamp()} boot '${user}'`);
    await mainlandAccount(page, base, user);
    // Same proven path as gatheringbot-test: ~maxme floods level-up chat that
    // blocks movement / cheats until drained.
    console.log(`${stamp()} base stats → 99 (maxme + clear dialogs)`);
    await maxmeAndClearDialogs(page);
    if (
        !(await page.evaluate(() => Boolean((globalThis as never as Abi).rs2b0t.registry.get('Fisher'))))
    ) {
        fail('Fisher missing — redeploy bot client');
    }

    for (const c of CASES) {
        const sc0 = Date.now();
        console.log(`\n══ ${c.id} ══`);
        await stopScript(page);
        await clearChatDialogs(page);
        await page.waitForTimeout(400);
        await cheatQuiet(page, '~clearinv');
        await page.waitForTimeout(400);
        // Exact pack seed: tool [+ feathers] + raw = 28. Oversized packs drop / confuse give.
        await cheatQuiet(page, `give ${c.toolDebug} 1`);
        await page.waitForTimeout(200);
        if (c.toolDebug === 'fly_fishing_rod') {
            await cheatQuiet(page, 'give feather 20');
            await page.waitForTimeout(200);
        }
        const rawQty = rawSeedQty(c.toolDebug);
        await cheatQuiet(page, `give ${c.rawDebug} ${rawQty}`);
        await page.waitForTimeout(400);

        const start = c.role === 'bank' ? c.bank : c.spot;
        await teleArrive(page, start);
        await page.waitForTimeout(600);

        // Cooker + raw pack → path to range and cook (no fishing restock thrash).
        await setFisher(page, {
            fishMethod: c.fishMethod,
            location: c.camp,
            cookMode: 'Cook then bank',
            cookFish: 'All raw',
            burntPolicy: 'Drop',
            afterCookCycle: 'Stop',
            toolAcquire: 'Off',
            forgetfulBank: 'false',
            leashRadius: '18',
            muleMode: 'Cooker',
            mulePartner: 'RangePathPartner'
        });

        const pre = await sample(page, c.stand, c.approach);
        if (pre.raw < 10) {
            const detail = `seed failed: raw=${pre.raw} used=${pre.used} inv=[${pre.invNames.join(', ')}]`;
            results.push({ id: c.id, ok: false, detail, ms: Date.now() - sc0 });
            console.log(`FAIL ${c.id} (0s) ${detail}`);
            continue;
        }
        console.log(
            `${stamp()} seed ok raw=${pre.raw} used=${pre.used} inv=[${pre.invNames.join(', ')}]`
        );

        const cook0 = pre.cookXp;
        await startScript(page, 'Fisher');
        console.log(
            `${stamp()} Fisher @ ${start.x},${start.z} → stand ${c.stand.x},${c.stand.z}` +
                (c.approach ? ` via ${c.approach.x},${c.approach.z}` : '')
        );

        const deadline = Date.now() + PER_CAMP_MS;
        let ok = false;
        let detail = '';
        /** Consecutive polls at/near stand with no cook XP (stall gate). */
        let stallAtOven = 0;
        /** Consecutive polls after cook/use logs with no XP. */
        let stallCookAttempt = 0;
        while (Date.now() < deadline) {
            await page.waitForTimeout(2000);
            const s = await sample(page, c.stand, c.approach);
            if (s.state === 'crashed') {
                detail = `crashed: ${s.lastLog}`;
                break;
            }
            const cookXp = s.cookXp - cook0;
            const _atStand = s.distStand <= 2;
            const nearOven = s.distStand <= 4;
            const sawCookLog = logHas(
                s.logs,
                /cook:\s*(walking to range|walking to approach|opening |cannot cook)/i
            );
            const sawUseAttempt = logHas(s.logs, /cook:\s*Raw |cook:\s*cannot cook/i);

            console.log(
                `${stamp()} distStand=${s.distStand} distAppr=${s.distApproach} cookXpΔ=${cookXp} raw=${s.raw} ` +
                    `| ${s.lastLog.slice(0, 72)}`
            );

            // Success requires cooking XP — standing on the stand alone is a false pass
            // (Draynor fireplace / Seers bank were at tile with 0 cook XP).
            if (cookXp > 0) {
                ok = true;
                detail =
                    `cookXpΔ=${cookXp} distStand=${s.distStand} raw=${s.raw} ` +
                    `tile=${s.tile ? `${s.tile.x},${s.tile.z}` : '?'}`;
                break;
            }

            if (nearOven) {
                stallAtOven++;
            } else {
                stallAtOven = 0;
            }
            if (sawUseAttempt || (nearOven && sawCookLog && s.raw > 0)) {
                stallCookAttempt++;
            } else if (!nearOven) {
                stallCookAttempt = 0;
            }

            // Fail fast: at oven ~8s without XP, or cook attempts ~10s without XP.
            if (stallAtOven >= 4) {
                detail =
                    `stall at oven (no cook XP) distStand=${s.distStand} raw=${s.raw} ` +
                    `log=${s.lastLog}`;
                break;
            }
            if (stallCookAttempt >= 5) {
                detail =
                    `stall cook attempts (no cook XP) distStand=${s.distStand} raw=${s.raw} ` +
                    `log=${s.lastLog}`;
                break;
            }
            if (logHas(s.logs, /cook:\s*cannot cook/i) && nearOven && stallAtOven >= 2) {
                detail = `cannot cook at oven distStand=${s.distStand} raw=${s.raw} log=${s.lastLog}`;
                break;
            }
        }
        await stopScript(page);
        await page.waitForTimeout(400);
        if (!ok) {
            const s = await sample(page, c.stand, c.approach);
            detail =
                detail
                || `timeout distStand=${s.distStand} distAppr=${s.distApproach} ` +
                    `cookXpΔ=${s.cookXp - cook0} raw=${s.raw} log=${s.lastLog}`;
        }
        const ms = Date.now() - sc0;
        results.push({ id: c.id, ok, detail, ms });
        console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id} (${Math.round(ms / 1000)}s) ${detail}`);
    }

    console.log('\n── range-path summary ──');
    let fails = 0;
    for (const r of results) {
        console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(48)} ${Math.round(r.ms / 1000)}s  ${r.detail}`);
        if (!r.ok) {
            fails++;
        }
    }
    console.log(`${results.length - fails}/${results.length} passed`);
    if (fails > 0) {
        process.exit(1);
    }
    console.log('PASS');
    process.exit(0);
} catch (e) {
    console.error(e);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
