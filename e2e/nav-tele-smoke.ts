/** Live smoke: nav spell teleport in the path graph. Lumbridge → Varrock with useTeleportCatalog + runes, expecting the hop log "casting Varrock teleport" and arrival near Varrock square.
 *  Operator tooling, not a CI gate — deploy the bot client into whatever engine you run first. BASE, BUDGET_S. Shared harness: e2e/lib/navLiveHarness.ts */

// then: HEADED=1 bun e2e/nav-tele-smoke.ts
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { cheb, seedItem, teleArrive } from './lib/navLiveHarness.js';
import { mainlandAccount, maxmeAndClearDialogs } from './tutorial/harness.js';

const START = { x: 3222, z: 3218, level: 0 }; // Lumbridge
const DEST = { x: 3213, z: 3424, level: 0 }; // Varrock tele landing
const ARRIVAL = 8;
const BUDGET_MS = (Number(process.env.BUDGET_S) || 90) * 1000;
const proof = createHarnessProof({ issue: 0, slug: 'nav-tele' });

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

type Tile = { x: number; z: number; level: number };

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        Inventory: { count(name: string): number };
        Skills: { level(name: string): number };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        Traversal: {
            walkTo(
                dest: Tile,
                opts: {
                    radius?: number;
                    timeoutMs?: number;
                    log?: (m: string) => void;
                    useTeleportCatalog?: boolean;
                    policy?: { useTeleports?: boolean; distanceBeforeTeleport?: number };
                }
            ): Promise<boolean>;
        };
        registerScript(manifest: { name: string; create(): unknown }): unknown;
    };
    rs2b0t: {
        runner: { state: string; start(meta: unknown): void; stop(reason: string): void };
    };
    __navV2Tele?: { walkOk: boolean; tile: Tile | null; logs: string[] };
};

async function seedRunes(page: Page): Promise<void> {
    // Varrock tele: law + air + fire (smaller qty than full kit is fine for one hop)
    await seedItem(page, 'lawrune', /Law rune/i, 50);
    await seedItem(page, 'airrune', /Air rune/i, 150);
    await seedItem(page, 'firerune', /Fire rune/i, 50);
}

console.log(`nav-tele-smoke base=${base} budget≈${Math.round(BUDGET_MS / 1000)}s`);
await proof.ensureDirs();
const browser = await launchBrowser({ swiftshader: true });
const t0 = Date.now();
const stamp = () => `[${Math.round((Date.now() - t0) / 1000)}s]`;
let page: Page | null = null;

try {
    const context = await browser.newContext();
    // Never reuse a stale botclient/navworker from a previous deploy.
    await context.route('**/*.{js,mjs}', async route => {
        const headers = {
            ...route.request().headers(),
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache'
        };
        await route.continue({ headers });
    });
    // Prefer Playwright default (1280×720) — see HARNESS_VIEWPORT in e2e/lib/harness.ts
    page = await context.newPage();
    page.on('console', msg => {
        const t = msg.type();
        if (t === 'log' || t === 'warning' || t === 'error') {
            console.log(`[browser:${t}] ${msg.text()}`);
        }
    });
    const user = process.env.USER_NAME || `nv2t${Date.now().toString(36).slice(-6)}`;
    console.log(`${stamp()} boot '${user}'`);
    await mainlandAccount(page, base, user);

    // Seed runes before maxme (maxme floods dialogs / busy-guards ~item)
    console.log(`${stamp()} seed Varrock tele runes`);
    await seedRunes(page);
    await maxmeAndClearDialogs(page);

    const magic = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Skills.level('magic'));
    const laws = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.Inventory.count('Law rune'));
    console.log(`${stamp()} magic=${magic} law_runes=${laws}`);
    if (magic < 25) {
        throw new Error(`magic ${magic} < 25 after maxme`);
    }
    if (laws < 1) {
        throw new Error('no Law runes after seed');
    }

    console.log(`${stamp()} tele Lumbridge ${START.x},${START.z}`);
    await teleArrive(page, START);
    const at = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
    console.log(`${stamp()} at ${at ? `${at.x},${at.z},${at.level}` : '?'}`);

    console.log(`${stamp()} walkTo Varrock with tele catalog…`);
    await page.evaluate(
        ({ destination, budget }) => {
            const g = globalThis as never as Abi;
            const logs: string[] = [];
            g.__navV2Tele = undefined;
            class Probe extends g.__rs2b0t.LoopingBot {
                override async loop(): Promise<void> {
                    try {
                        const walkOk = await g.__rs2b0t.Traversal.walkTo(destination, {
                            radius: 4,
                            timeoutMs: budget,
                            useTeleportCatalog: true,
                            policy: {
                                useTeleports: true,
                                // Lumbridge→Varrock span is ~200 cheb; force tele preference
                                distanceBeforeTeleport: 50
                            },
                            log: m => {
                                logs.push(m);
                                this.log(m);
                            }
                        });
                        g.__navV2Tele = { walkOk, tile: g.__rs2b0t.reader.worldTile(), logs };
                    } catch (e) {
                        g.__navV2Tele = {
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
                g.__rs2b0t.registerScript({ name: `NavV2Tele${Date.now()}`, create: () => new Probe() })
            );
        },
        { destination: DEST, budget: BUDGET_MS }
    );

    for (let i = 0; i < Math.ceil(BUDGET_MS / 1000) + 30; i++) {
        const done = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            return (
                g.__navV2Tele !== undefined
                && (g.rs2b0t.runner.state === 'stopped' || g.rs2b0t.runner.state === 'idle')
            );
        });
        if (done) {
            break;
        }
        if (i > 0 && i % 10 === 0) {
            const mid = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            console.log(`${stamp()} still walking… ${mid ? `${mid.x},${mid.z}` : '?'}`);
        }
        await page.waitForTimeout(1000);
    }

    const result = await page.evaluate(() => (globalThis as never as Abi).__navV2Tele);
    if (!result) {
        throw new Error('walk produced no result');
    }

    const tile = result.tile;
    const dist = tile ? cheb(tile, DEST) : 9999;
    const logs = result.logs;
    const castLog = logs.some(l => /casting\s+Varrock\s+teleport/i.test(l));
    const hopLog = logs.some(l => /\[teleport\].*Varrock|Cast Varrock/i.test(l));
    const okLog = logs.some(l => /Varrock teleport ok/i.test(l));
    const usedTele = castLog || hopLog || okLog;

    console.log(
        `${stamp()} walkOk=${result.walkOk} tile=${tile ? `${tile.x},${tile.z}` : '?'} dist=${dist} tele=${usedTele}`
    );
    console.log(`${stamp()} all walk logs (${logs.length}):\n${logs.join('\n')}`);

    if (!usedTele) {
        throw new Error(
            `path did not use Varrock tele (expected hop/cast log). sample: ${logs.filter(l => /hop|tele|path/i.test(l)).slice(0, 8).join(' | ')}`
        );
    }
    if (dist > ARRIVAL) {
        throw new Error(`not near Varrock (dist=${dist} walkOk=${result.walkOk})`);
    }

    await proof.writeSuccess(page, {
        base,
        user,
        walkOk: result.walkOk,
        tile,
        dist,
        usedTele,
        castLog,
        hopLog,
        okLog,
        logTail: logs.slice(-20)
    });
    console.log('PASS nav-tele-smoke Lumbridge → Varrock via spell tele');
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
