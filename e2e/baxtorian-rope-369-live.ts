// Live proof for #369 / #320 — the baked FireGiant Baxtorian sequence with no mid-path cheats.
// Why: only the raft board is teleported to, and every rope hop needs the south walk between it.

//   ~/redeploy.sh && HEADED=1 bun e2e/baxtorian-rope-369-live.ts
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import {
    cheatQuiet,
    getServerVarQuiet,
    mainlandAccount,
    maxmeAndClearDialogs,
    relog
} from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

/** FireGiantLogic stands — baked path must include south walk between hops. */
const RAFT_STAND = { x: 2510, z: 3493, level: 0 };
const LEDGE = { x: 2511, z: 3463, level: 0 };
const DIG = { x: 2512, z: 3467, level: 0 };
const DEST = LEDGE;
const ARRIVAL = 2;
const BUDGET_MS = 240_000;

type Tile = { x: number; z: number; level: number };
type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        Inventory: { count(n: string): number };
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
    __369?: { ok: boolean; tile: Tile | null; logs: string[] };
};

const proof = createHarnessProof({ issue: 369, slug: 'baxtorian-rope' });

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
    const user = `bx369${Date.now().toString(36).slice(-5)}`;
    console.log(`#369 baxtorian-rope-live base=${base} user=${user}`);
    console.log('bake: raft (quest started) → walk south → rock rope → walk south → tree rope → ledge');
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);
    await cheatQuiet(page, 'speed 300');

    // Content: lograft_waterfall_quest refuses Board while waterfall_quest == 0
    // (FireGiant parks: "Waterfall Quest is not started — the log raft refuses").
    await cheatQuiet(page, 'setvar waterfall_quest 1');
    await relog(page, user);
    await maxmeAndClearDialogs(page);
    const wf = await getServerVarQuiet(page, 'waterfall_quest');
    console.log(`waterfall_quest=${wf} (need ≥1 for raft Board)`);
    if ((wf ?? 0) < 1) {
        throw new Error(`waterfall_quest not started after setvar (got ${wf})`);
    }

    await cheatQuiet(page, 'give rope 1');
    console.log('gave rope 1');

    // Fixture only: stand at raft board (sequence start). No tele past the ropes.
    console.log(`tele to raft stand ${RAFT_STAND.x},${RAFT_STAND.z}`);
    await teleArrive(page, RAFT_STAND, 4);
    const here = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
    console.log(`at ${JSON.stringify(here)}`);

    const rope = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Inventory.count('Rope'));
    if (rope < 1) {
        throw new Error(`expected Rope, got ${rope}`);
    }
    console.log(`rope count=${rope}; starting walkResilient to ledge`);

    await page.evaluate(({ dest, budget, radius }) => {
        const g = globalThis as never as Abi;
        const api = g.__rs2b0t;
        const logs: string[] = [];
        const log = (m: string) => {
            logs.push(m);
            console.log(`[#369] ${m}`);
        };
        class Probe extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    const ok = await api.Traversal.walkResilient(dest, {
                        radius,
                        attempts: 6,
                        timeoutMs: budget,
                        log
                    });
                    g.__369 = { ok, tile: api.reader.worldTile(), logs };
                } catch (e) {
                    log(String(e));
                    g.__369 = { ok: false, tile: api.reader.worldTile(), logs };
                } finally {
                    g.rs2b0t.runner.stop('harness stop');
                }
            }
        }
        g.__369 = { ok: false, tile: null, logs: [] };
        g.rs2b0t.runner.start(
            api.registerScript({ name: 'Issue369Baxtorian', create: () => new Probe() })
        );
    }, { dest: DEST, budget: BUDGET_MS, radius: ARRIVAL });

    const t0 = Date.now();
    while (Date.now() - t0 < BUDGET_MS + 90_000) {
        if ((await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state)) === 'idle') {
            break;
        }
        await page.waitForTimeout(400);
    }

    const res = await page.evaluate(() => (globalThis as never as Abi).__369);
    const tile = res?.tile ?? null;
    const logs = res?.logs ?? [];
    const distLedge = tile ? cheb(tile, LEDGE) : 9999;
    const distDig = tile ? cheb(tile, DIG) : 9999;
    const sawRaft = logs.some(l => /log raft|Board/i.test(l));
    const sawRock = logs.some(l => /rope → rock|Baxtorian rope → rock/i.test(l) && /crossed/i.test(l));
    const sawTree = logs.some(l => /rope → ledge|Dead tree/i.test(l) && /crossed/i.test(l));
    const sawSouthWalk = logs.some(l => /path:|walking|arrived/i.test(l));
    const ok = res?.ok === true && distLedge <= ARRIVAL && sawRock && sawTree;

    console.log(
        `walk ok=${res?.ok} distLedge=${distLedge} distDig=${distDig} raft=${sawRaft} rock=${sawRock} tree=${sawTree}`
    );
    console.log(logs.slice(-40).join('\n'));

    if (!ok) {
        await proof.writeFailure(page);
        throw new Error(
            `FAIL distLedge=${distLedge} rock=${sawRock} tree=${sawTree} raft=${sawRaft} tile=${JSON.stringify(tile)}`
        );
    }
    await proof.writeSuccess(page, {
        issue: 369,
        pattern: 'FireGiantLogic (raft → south walk → rock rope → south walk → tree rope → ledge)',
        distLedge,
        distDig,
        sawRaft,
        sawRock,
        sawTree,
        sawSouthWalk,
        tile,
        dest: DEST,
        dig: DIG,
        ropeCount: 1,
        logs: logs.slice(-60)
    });
    console.log('PASS #369 baxtorian-rope-live');
    process.exit(0);
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
