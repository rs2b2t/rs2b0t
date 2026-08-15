/** Live proof for #368 — Entrana ferry, gangplank and the no-weapons/armour gate.
 *  Nothing teleports onto the island: strip gear → Port Sarim monk stand (3048,3236) → walk to (2818,3351) → Monk Talk-to → deck → Cross gangplank. */

//   ~/redeploy.sh && HEADED=1 bun e2e/entrana-gear-368-live.ts
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

const MONK_STAND = { x: 3048, z: 3236, level: 0 };
/** Walkable tile next to drawers search (2818,3351). */
const DRAWERS_STAND = { x: 2818, z: 3350, level: 0 };
const ARRIVAL = 2;
const BUDGET_MS = 240_000;

type Tile = { x: number; z: number; level: number };
type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        Inventory: { count(n: string): number; items(): { name: string | null }[] };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        registerScript(m: { name: string; create(): unknown }): unknown;
        Traversal: {
            walkResilient(
                d: Tile,
                o: { radius?: number; attempts?: number; timeoutMs?: number; log?: (m: string) => void }
            ): Promise<boolean>;
        };
    };
    rs2b0t: { runner: { state: string; start(m: unknown): void; stop(reason: string): void } };
    __368?: { ok: boolean; tile: Tile | null; logs: string[] };
};

const proof = createHarnessProof({ issue: 368, slug: 'entrana-gear' });

function cheb(a: Tile, b: Tile): number {
    if (a.level !== b.level) {
        return 9999;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function teleCmd(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: Tile, maxDist = 3): Promise<void> {
    for (let a = 0; a < 8; a++) {
        if (page.isClosed()) {
            throw new Error('page closed before tele');
        }
        await cheatQuiet(page, teleCmd(spot));
        for (let p = 0; p < 25; p++) {
            if (page.isClosed()) {
                throw new Error('page closed during tele settle');
            }
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && cheb(t, spot) <= maxDist) {
                await page.waitForTimeout(600);
                return;
            }
            await page.waitForTimeout(200);
        }
    }
    throw new Error(`tele ${spot.x},${spot.z} failed`);
}

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
page.on('console', msg => {
    if (msg.type() === 'error') {
        console.log(`[browser:error] ${msg.text().slice(0, 240)}`);
    }
});
try {
    await proof.ensureDirs();
    const user = `en368${Date.now().toString(36).slice(-5)}`;
    console.log(`#368 entrana-gear-live base=${base} user=${user}`);
    console.log('bake: Port Sarim monk → Entrana ferry → gangplank → drawers');
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);
    await cheatQuiet(page, 'speed 300');
    // Fresh account: no weapons/armour. (SolveClue bank strip covers geared runs.)
    await cheatQuiet(page, 'empty');
    console.log('emptied pack for monk search');

    console.log(`tele to monk stand ${MONK_STAND.x},${MONK_STAND.z}`);
    await teleArrive(page, MONK_STAND, 3);
    const here = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
    console.log(`at ${JSON.stringify(here)}`);

    console.log('starting walkResilient to drawers stand');
    await page.evaluate(({ dest, budget, radius }) => {
        const g = globalThis as never as Abi;
        const api = g.__rs2b0t;
        const logs: string[] = [];
        const log = (m: string) => {
            logs.push(m);
            console.log(`[#368] ${m}`);
        };
        class Probe extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    const ok = await api.Traversal.walkResilient(dest, {
                        radius,
                        attempts: 8,
                        timeoutMs: budget,
                        log
                    });
                    g.__368 = { ok, tile: api.reader.worldTile(), logs };
                } catch (e) {
                    log(String(e));
                    g.__368 = { ok: false, tile: api.reader.worldTile(), logs };
                } finally {
                    g.rs2b0t.runner.stop('harness stop');
                }
            }
        }
        g.__368 = { ok: false, tile: null, logs: [] };
        g.rs2b0t.runner.start(
            api.registerScript({ name: 'Issue368Entrana', create: () => new Probe() })
        );
    }, { dest: DRAWERS_STAND, budget: BUDGET_MS, radius: ARRIVAL });

    const t0 = Date.now();
    while (Date.now() - t0 < BUDGET_MS + 90_000) {
        if ((await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state)) === 'idle') {
            break;
        }
        await page.waitForTimeout(400);
    }

    const res = await page.evaluate(() => (globalThis as never as Abi).__368);
    const tile = res?.tile ?? null;
    const logs = res?.logs ?? [];
    const dist = tile ? cheb(tile, DRAWERS_STAND) : 9999;
    const onEntrana = tile !== null && tile.x >= 2802 && tile.x <= 2878 && tile.z >= 3329 && tile.z <= 3393 && tile.level === 0;
    const sawFerry = logs.some(l => /Entrana|Monk|ferry|board/i.test(l));
    const sawPlank = logs.some(l => /Gangplank|plank|Cross/i.test(l));
    const ok = res?.ok === true && dist <= ARRIVAL && onEntrana;

    console.log(`walk ok=${res?.ok} dist=${dist} onEntrana=${onEntrana} ferry=${sawFerry} plank=${sawPlank}`);
    console.log(logs.slice(-50).join('\n'));

    if (!ok) {
        await proof.writeFailure(page);
        throw new Error(
            `FAIL dist=${dist} onEntrana=${onEntrana} ferry=${sawFerry} plank=${sawPlank} tile=${JSON.stringify(tile)}`
        );
    }
    await proof.writeSuccess(page, {
        issue: 368,
        pattern: 'Port Sarim monk → ferry → ship_from_entrana_off → drawers stand',
        dist,
        onEntrana,
        sawFerry,
        sawPlank,
        tile,
        dest: DRAWERS_STAND,
        logs: logs.slice(-80)
    });
    console.log('PASS #368 entrana-gear-live');
    process.exit(0);
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
