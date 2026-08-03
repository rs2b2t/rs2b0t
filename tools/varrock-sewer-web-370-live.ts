/**
 * Live proof for #370 — west Varrock sewer slashable web.
 *
 * Sequence (no tele past the web):
 *   tele to sewer bottom under manhole (3237,9859)
 *   give knife (use-on works; slash_checker needs a wielded slash weapon)
 *   walkResilient to dig stand (3160,9905) — must Slash bigweb_slashable @ (3210,9898)
 *
 * Content: web.rs2 oploc1 uses ~slash_checker (wielded slash anim); oplocu accepts knife.
 * doorCrossing uses Knife useOn when present, else Slash interact.
 * Cut is 50% — walker retries in the multi-door loop.
 *
 *   ~/redeploy.sh && HEADED=1 bun tools/varrock-sewer-web-370-live.ts
 */
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

/**
 * Fixture start: north stand of the web (MAIN side). Must still Slash to reach
 * the closed west section — no tele past the rope/web.
 */
const WEB_NORTH = { x: 3210, z: 9899, level: 0 };
/** Walkable stand next to hard dig (3161,9905) in the closed west section. */
const DIG_STAND = { x: 3160, z: 9905, level: 0 };
const WEB_LOC = { x: 3210, z: 9898 };
const ARRIVAL = 2;
const BUDGET_MS = 120_000;

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
    rs2b0t: { runner: { state: string; start(m: unknown): void; stop(): void } };
    __370?: { ok: boolean; tile: Tile | null; logs: string[] };
};

const proof = createHarnessProof({ issue: 370, slug: 'varrock-sewer-web' });

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
    const user = `vw370${Date.now().toString(36).slice(-5)}`;
    console.log(`#370 varrock-sewer-web-live base=${base} user=${user}`);
    console.log('bake: web north stand → Slash @ (3210,9898) → west dig stand (3160,9905)');
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);
    await cheatQuiet(page, 'speed 300');

    // Knife in pack: doorCrossing useOn path (content oplocu). Wielded slash also works.
    await cheatQuiet(page, 'give knife 1');
    console.log('gave knife 1');

    // Fixture only: north of the web. Do not tele into the closed west section.
    console.log(`tele to web north ${WEB_NORTH.x},${WEB_NORTH.z}`);
    await teleArrive(page, WEB_NORTH, 2);
    const here = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
    console.log(`at ${JSON.stringify(here)}`);

    const knives = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Inventory.count('Knife'));
    if (knives < 1) {
        throw new Error(`expected Knife, got ${knives}`);
    }
    console.log(`knife count=${knives}; starting walkResilient to dig stand`);

    await page.evaluate(({ dest, budget, radius }) => {
        const g = globalThis as never as Abi;
        const api = g.__rs2b0t;
        const logs: string[] = [];
        const log = (m: string) => {
            logs.push(m);
            console.log(`[#370] ${m}`);
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
                    g.__370 = { ok, tile: api.reader.worldTile(), logs };
                } catch (e) {
                    log(String(e));
                    g.__370 = { ok: false, tile: api.reader.worldTile(), logs };
                } finally {
                    g.rs2b0t.runner.stop();
                }
            }
        }
        g.__370 = { ok: false, tile: null, logs: [] };
        g.rs2b0t.runner.start(
            api.registerScript({ name: 'Issue370SewerWeb', create: () => new Probe() })
        );
    }, { dest: DIG_STAND, budget: BUDGET_MS, radius: ARRIVAL });

    const t0 = Date.now();
    while (Date.now() - t0 < BUDGET_MS + 90_000) {
        if ((await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state)) === 'idle') {
            break;
        }
        await page.waitForTimeout(400);
    }

    const res = await page.evaluate(() => (globalThis as never as Abi).__370);
    const tile = res?.tile ?? null;
    const logs = res?.logs ?? [];
    const distDig = tile ? cheb(tile, DIG_STAND) : 9999;
    const sawSlash = logs.some(l => /slash|knife|Web/i.test(l) && /3210|9898|using the|crossed/i.test(l));
    const sawWebCross = logs.some(l => /crossed 'Web'|Web.*already open|using the Knife on Web/i.test(l));
    const ok = res?.ok === true && distDig <= ARRIVAL;

    console.log(`walk ok=${res?.ok} distDig=${distDig} sawSlash=${sawSlash} sawWebCross=${sawWebCross}`);
    console.log(logs.slice(-50).join('\n'));

    if (!ok) {
        await proof.writeFailure(page);
        throw new Error(
            `FAIL distDig=${distDig} sawWebCross=${sawWebCross} tile=${JSON.stringify(tile)}`
        );
    }
    await proof.writeSuccess(page, {
        issue: 370,
        pattern: 'web north stand → Slash bigweb_slashable @ (3210,9898) → west dig stand',
        distDig,
        sawSlash,
        sawWebCross,
        tile,
        dest: DIG_STAND,
        web: WEB_LOC,
        knifeCount: 1,
        logs: logs.slice(-80)
    });
    console.log('PASS #370 varrock-sewer-web-live');
    process.exit(0);
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
