/**
 * Live proof for #285: walk from Edgeville dungeon Chaos field to Falador.
 *
 *   ~/redeploy.sh
 *   HEADED=1 bun tools/edgeville-dungeon-exit-test.ts
 *
 * Artifacts: screenshots/issue285-edgeville-exit-success.png + out/issue285-*-proof.json
 * Offline baseline (no ladder edges → NO PATH) is unit-tested in
 * test/nav/edgevilleDungeonTransport.test.ts. For live baseline-style repros of
 * other bugs, see tools/shantay-pass-route-test.ts --expect-unreachable.
 * @see tools/lib/harnessProof.ts
 */
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs } from './tutorial/harness.js';

const START = { x: 3111, z: 9937, level: 0 };
const FALADOR = { x: 2965, z: 3378, level: 0 };
const ARRIVAL = 8;
const BUDGET_MS = (Number(process.env.BUDGET_S) || 300) * 1000;
const proof = createHarnessProof({ issue: 285, slug: 'edgeville-exit' });

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
                dest: Tile,
                opts: { radius: number; attempts: number; timeoutMs: number; log: (m: string) => void }
            ): Promise<boolean>;
        };
        registerScript(manifest: { name: string; create(): unknown }): unknown;
    };
    rs2b0t: {
        runner: {
            state: string;
            start(meta: unknown): void;
            stop(): void;
        };
    };
    __evedResult?: { walkOk: boolean; tile: Tile | null; logs: string[] };
};

function cheb(a: Tile, b: Tile): number {
    if (a.level !== b.level) {
        return 9999;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function teleCmd(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: Tile, maxDist = 10): Promise<void> {
    for (let a = 0; a < 6; a++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let p = 0; p < 16; p++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && cheb(t, spot) <= maxDist) {
                await page.waitForTimeout(600);
                return;
            }
            await page.waitForTimeout(250);
        }
    }
    throw new Error(`tele to ${spot.x},${spot.z} failed`);
}

console.log(`edgeville-dungeon-exit base=${base} budget≈${Math.round(BUDGET_MS / 1000)}s`);
await proof.ensureDirs();
const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
let page: Page | null = null;

try {
    page = await (await browser.newContext()).newPage();
    page.setViewportSize({ width: 1500, height: 1000 }).catch(() => undefined);
    const user = process.env.USER_NAME || `eved${Date.now().toString(36).slice(-6)}`;
    console.log(`${stamp()} boot '${user}'`);
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);

    console.log(`${stamp()} tele Chaos field ${START.x},${START.z}`);
    await teleArrive(page, START);
    const at = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
    console.log(`${stamp()} at ${at ? `${at.x},${at.z},${at.level}` : '?'}`);

    await page.evaluate(
        ({ destination, budget }) => {
            const g = globalThis as never as Abi;
            const api = g.__rs2b0t;
            const logs: string[] = [];
            class EdgevilleExitProbe extends api.LoopingBot {
                override async loop(): Promise<void> {
                    try {
                        const walkOk = await api.Traversal.walkResilient(destination, {
                            radius: 8,
                            attempts: 3,
                            timeoutMs: budget,
                            log: m => {
                                logs.push(m);
                                this.log(m);
                                console.log(`[eved] ${m}`);
                            }
                        });
                        g.__evedResult = { walkOk, tile: api.reader.worldTile(), logs: logs.slice(-40) };
                    } catch (e) {
                        g.__evedResult = {
                            walkOk: false,
                            tile: api.reader.worldTile(),
                            logs: [...logs.slice(-40), String(e)]
                        };
                    } finally {
                        g.rs2b0t.runner.stop();
                    }
                }
            }
            g.__evedResult = undefined;
            g.rs2b0t.runner.start(
                api.registerScript({ name: 'Issue285EdgevilleExit', create: () => new EdgevilleExitProbe() })
            );
        },
        { destination: FALADOR, budget: BUDGET_MS }
    );

    const deadline = Date.now() + BUDGET_MS + 30_000;
    while (Date.now() < deadline) {
        const done = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            return g.__evedResult !== undefined && g.rs2b0t.runner.state === 'stopped';
        });
        if (done) {
            break;
        }
        await page.waitForTimeout(1500);
        const mid = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
        console.log(
            `${stamp()} walking… tile=${mid ? `${mid.x},${mid.z},${mid.level}` : '?'} dist=${mid ? cheb(mid, FALADOR) : '?'}`
        );
    }

    const result = await page.evaluate(() => (globalThis as never as Abi).__evedResult);
    if (!result) {
        throw new Error('probe did not finish');
    }
    const dist = result.tile ? cheb(result.tile, FALADOR) : 9999;
    const climbed = result.logs.some(l => /Climb-up Ladder at \(3096,9868\)/i.test(l));
    console.log(
        `${stamp()} walkOk=${result.walkOk} tile=${result.tile ? `${result.tile.x},${result.tile.z},${result.tile.level}` : '?'} distFalador=${dist} climbed=${climbed}`
    );
    for (const line of result.logs) {
        console.log(`  log: ${line}`);
    }

    const payload = {
        base,
        username: user,
        start: START,
        destination: FALADOR,
        walkOk: result.walkOk,
        finalTile: result.tile,
        distFalador: dist,
        climbedLadder: climbed,
        logs: result.logs,
        elapsedMs: Date.now() - t0
    };

    if (!result.walkOk || dist > ARRIVAL || !climbed) {
        throw new Error(
            `dungeon→Falador failed (walkOk=${result.walkOk} dist=${dist} climbed=${climbed})`
        );
    }
    await proof.writeSuccess(page, payload);
    console.log('PASS edgeville dungeon → Falador (#285)');
    process.exit(0);
} catch (e) {
    console.error(e);
    if (page) {
        await proof.writeFailure(page).catch(() => undefined);
    }
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
