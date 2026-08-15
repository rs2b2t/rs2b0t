/** Live smoke: the Edgeville trapdoor and the Dwarven Mine (Falador party-room) trapdoor. Operator tooling, not a CI gate — deploy the bot client to your engine first.
 *  Asserts open→climb (or climb when already open) and arrival underground or on the surface. */

// then: HEADED=1 bun e2e/trapdoor-mines-live.ts
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

type Tile = { x: number; z: number; level: number };

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        Traversal: {
            walkResilient(
                d: Tile,
                o: { radius: number; attempts: number; timeoutMs: number; log: (m: string) => void }
            ): Promise<boolean>;
        };
        registerScript(m: { name: string; create(): unknown }): unknown;
    };
    rs2b0t: { runner: { state: string; stop(reason: string): void; start(meta: unknown): void } };
    __trap?: { walkOk: boolean; tile: Tile | null; logs: string[] };
};

const cases = [
    {
        id: 'edgeville-trapdoor',
        surface: { x: 3096, z: 3468, level: 0 },
        under: { x: 3096, z: 9868, level: 0 },
        // start a few tiles away so we path to the trapdoor
        start: { x: 3090, z: 3470, level: 0 }
    },
    {
        id: 'dwarven-mine-trapdoor',
        surface: { x: 3019, z: 3449, level: 0 },
        under: { x: 3019, z: 9849, level: 0 },
        start: { x: 3015, z: 3450, level: 0 }
    }
] as const;

const proof = createHarnessProof({ issue: 312, slug: 'trapdoor-mines' });

function cheb(a: Tile, b: Tile): number {
    if (a.level !== b.level) {
        return 9999;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function teleCmd(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: Tile, maxDist = 8): Promise<void> {
    for (let a = 0; a < 6; a++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let p = 0; p < 16; p++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && cheb(t, spot) <= maxDist) {
                await page.waitForTimeout(400);
                return;
            }
            await page.waitForTimeout(200);
        }
    }
    throw new Error(`tele ${spot.x},${spot.z} failed`);
}

async function walkTo(page: Page, dest: Tile, timeoutMs: number): Promise<{ walkOk: boolean; tile: Tile | null; logs: string[] }> {
    await page.evaluate(
        ({ destination, budget }) => {
            const g = globalThis as never as Abi;
            const logs: string[] = [];
            g.__trap = undefined;
            class Probe extends g.__rs2b0t.LoopingBot {
                override async loop(): Promise<void> {
                    try {
                        const walkOk = await g.__rs2b0t.Traversal.walkResilient(destination, {
                            radius: 4,
                            attempts: 3,
                            timeoutMs: budget,
                            log: m => {
                                logs.push(m);
                                this.log(m);
                            }
                        });
                        g.__trap = { walkOk, tile: g.__rs2b0t.reader.worldTile(), logs };
                    } catch (e) {
                        g.__trap = {
                            walkOk: false,
                            tile: g.__rs2b0t.reader.worldTile(),
                            logs: [...logs, String(e)]
                        };
                    } finally {
                        g.rs2b0t.runner.stop('harness stop');
                    }
                }
            }
            g.rs2b0t.runner.start(
                g.__rs2b0t.registerScript({ name: `TrapWalk${Date.now()}`, create: () => new Probe() })
            );
        },
        { destination: dest, budget: timeoutMs }
    );
    for (let i = 0; i < Math.ceil(timeoutMs / 1000) + 20; i++) {
        const done = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            return g.__trap !== undefined && (g.rs2b0t.runner.state === 'stopped' || g.rs2b0t.runner.state === 'idle');
        });
        if (done) {
            break;
        }
        await page.waitForTimeout(1000);
    }
    const r = await page.evaluate(() => (globalThis as never as Abi).__trap);
    if (!r) {
        throw new Error('walk probe produced no result');
    }
    return r;
}

const browser = await launchBrowser({ swiftshader: true });
const page = await (await browser.newContext()).newPage();
const results: { id: string; ok: boolean; detail: string }[] = [];

try {
    await proof.ensureDirs();
    const user = `trp${Date.now().toString(36).slice(-5)}`;
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);

    for (const c of cases) {
        console.log(`\n══ ${c.id} ══`);
        try {
            await teleArrive(page, c.start, 10);
            const down = await walkTo(page, c.under, 120_000);
            const tile = down.tile;
            if (!tile || cheb(tile, c.under) > 6) {
                throw new Error(
                    `not underground tile=${tile?.x},${tile?.z} logs=${down.logs.slice(-4).join('|')}`
                );
            }
            const climbed =
                down.logs.some(l => /Climb-down|trapdoor|Trapdoor/i.test(l))
                || down.logs.some(l => /opened the shut/i.test(l));
            // walk back up to prove exit ladder/trapdoor pair
            const up = await walkTo(page, c.surface, 120_000);
            const upTile = up.tile;
            if (!upTile || cheb(upTile, c.surface) > 8) {
                throw new Error(
                    `not back on surface tile=${upTile?.x},${upTile?.z} logs=${up.logs.slice(-4).join('|')}`
                );
            }
            const detail = `down@${tile.x},${tile.z} climbLog=${climbed} up@${upTile.x},${upTile.z}`;
            console.log(`PASS ${c.id} ${detail}`);
            results.push({ id: c.id, ok: true, detail });
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            console.log(`FAIL ${c.id} ${detail}`);
            results.push({ id: c.id, ok: false, detail });
        }
    }

    const fails = results.filter(r => !r.ok).length;
    if (fails > 0) {
        await proof.writeFailure(page);
        console.error(`${results.length - fails}/${results.length} passed`);
        process.exit(1);
    }
    await proof.writeSuccess(page, { base, user, results });
    console.log(`PASS trapdoor-mines ${results.length}/${results.length}`);
    process.exit(0);
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
