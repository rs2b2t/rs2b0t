/**
 * Live proof for #371: clue bank prep keeps/withdraws a Shantay pass, then
 * southbound crossing into the desert is walkable (requires-gated edge).
 *
 *   ~/redeploy.sh && HEADED=1 bun tools/clue-shantay-pass-live.ts
 *
 * Proof: out/issue371-clue-shantay-pass-proof.json + screenshots/
 */
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import { cheatQuiet, mainlandAccount, maxmeAndClearDialogs } from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

const SHANTAY_PASS = 'Shantay pass';
/** North of the southbound stand (3304,3118). */
const NORTH_OF_PASS = { x: 3304, z: 3125, level: 0 } as const;
/** Hard desert dig 3552 (sextant027) — deep enough south that the pass is required. */
const DESERT_DIG = { x: 3168, z: 3041, level: 0 } as const;
const ARRIVAL = 8;
const BUDGET_MS = 180_000;

type Tile = { x: number; z: number; level: number };

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        Inventory: { count(n: string): number; items(): { name: string | null }[] };
        Bank: {
            isOpen(): boolean;
            openNearest(name: string, op: string, log?: (m: string) => void): Promise<boolean>;
            depositAllMatching(pred: (name: string) => boolean): Promise<void>;
            withdraw(name: string, op?: string): boolean | Promise<boolean>;
            close(): Promise<void>;
        };
        Traversal: {
            walkResilient(
                d: Tile,
                o: { radius?: number; attempts?: number; timeoutMs?: number; log?: (m: string) => void }
            ): Promise<boolean>;
        };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        registerScript(m: { name: string; create(): unknown }): unknown;
        nearestBank?: (t: Tile) => { name: string; tile: Tile } | null;
        BankLocations?: { nearest(t: Tile): { name: string; tile: Tile } | null };
    };
    rs2b0t: { runner: { state: string; start(meta: unknown): void; stop(): void } };
    __371?: {
        bankHadPass: boolean;
        afterBankPassCount: number;
        walkOk: boolean;
        tile: Tile | null;
        logs: string[];
    };
};

const proof = createHarnessProof({ issue: 371, slug: 'clue-shantay-pass' });

function cheb(a: Tile, b: Tile): number {
    if (a.level !== b.level) {
        return 9999;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

function teleCmd(t: Tile): string {
    return `tele ${t.level},${t.x >> 6},${t.z >> 6},${t.x & 63},${t.z & 63}`;
}

async function teleArrive(page: Page, spot: Tile, maxDist = 12): Promise<void> {
    for (let a = 0; a < 6; a++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let p = 0; p < 20; p++) {
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

/**
 * Mirrors SolveClue.bankFirst's #371 slice inside a LoopingBot (Bank/Execution
 * require a running script). Deposits non-keep junk, withdraws one Shantay pass.
 */
async function bankPrepShantayPass(page: Page): Promise<{ afterCount: number; logs: string[] }> {
    await page.evaluate(passName => {
        const g = globalThis as never as Abi;
        const api = g.__rs2b0t;
        const logs: string[] = [];
        const log = (m: string) => {
            logs.push(m);
            console.log(`[#371 bank] ${m}`);
        };

        class Prep extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    const opened = await api.Bank.openNearest('Bank booth', 'Use-quickly', log);
                    if (!opened && !api.Bank.isOpen()) {
                        const opened2 = await api.Bank.openNearest('Bank chest', 'Use', log);
                        if (!opened2 && !api.Bank.isOpen()) {
                            throw new Error('could not open bank');
                        }
                    }
                    // Keep set matches SolveClue.bankFirst (#371 adds pass).
                    const keep = (name: string) => {
                        const n = (name ?? '').toLowerCase();
                        return (
                            n === 'coins'
                            || n === passName.toLowerCase()
                            || n.includes('clue')
                            || n.includes('casket')
                        );
                    };
                    await api.Bank.depositAllMatching(name => !keep(name));
                    if (api.Inventory.count(passName) < 1) {
                        const ok = await Promise.resolve(api.Bank.withdraw(passName, 'Withdraw-1'));
                        log(ok ? `withdrew ${passName}` : `withdraw failed for ${passName}`);
                        for (let i = 0; i < 30 && api.Inventory.count(passName) < 1; i++) {
                            await new Promise(r => setTimeout(r, 100));
                        }
                    } else {
                        log(`${passName} kept through deposit`);
                    }
                    const afterCount = api.Inventory.count(passName);
                    if (api.Bank.isOpen()) {
                        await api.Bank.close();
                    }
                    g.__371 = {
                        bankHadPass: true,
                        afterBankPassCount: afterCount,
                        walkOk: false,
                        tile: null,
                        logs
                    };
                } catch (e) {
                    log(String(e));
                    g.__371 = {
                        bankHadPass: false,
                        afterBankPassCount: 0,
                        walkOk: false,
                        tile: null,
                        logs
                    };
                } finally {
                    g.rs2b0t.runner.stop();
                }
            }
        }

        g.__371 = {
            bankHadPass: false,
            afterBankPassCount: 0,
            walkOk: false,
            tile: null,
            logs
        };
        g.rs2b0t.runner.start(
            api.registerScript({ name: 'Issue371BankPrep', create: () => new Prep() })
        );
    }, SHANTAY_PASS);

    const t0 = Date.now();
    while (Date.now() - t0 < 60_000) {
        const st = await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state);
        if (st === 'idle') {
            break;
        }
        await page.waitForTimeout(200);
    }
    const snap = await page.evaluate(() => (globalThis as never as Abi).__371);
    return {
        afterCount: snap?.afterBankPassCount ?? 0,
        logs: snap?.logs ?? []
    };
}

async function walkDesert(page: Page): Promise<{ ok: boolean; tile: Tile | null; logs: string[] }> {
    return page.evaluate(
        async ({ dest, budget, radius }) => {
            const g = globalThis as never as Abi;
            const api = g.__rs2b0t;
            const logs: string[] = g.__371?.logs ?? [];
            const log = (m: string) => {
                logs.push(m);
                console.log(`[#371] ${m}`);
            };

            class Probe extends api.LoopingBot {
                override async loop(): Promise<void> {
                    try {
                        const walkOk = await api.Traversal.walkResilient(dest, {
                            radius,
                            attempts: 4,
                            timeoutMs: budget,
                            log: m => log(m)
                        });
                        const tile = api.reader.worldTile();
                        g.__371 = {
                            bankHadPass: g.__371?.bankHadPass ?? false,
                            afterBankPassCount: g.__371?.afterBankPassCount ?? 0,
                            walkOk,
                            tile,
                            logs
                        };
                    } catch (e) {
                        log(String(e));
                        g.__371 = {
                            bankHadPass: g.__371?.bankHadPass ?? false,
                            afterBankPassCount: g.__371?.afterBankPassCount ?? 0,
                            walkOk: false,
                            tile: api.reader.worldTile(),
                            logs
                        };
                    } finally {
                        g.rs2b0t.runner.stop();
                    }
                }
            }

            g.__371 = g.__371 ?? {
                bankHadPass: false,
                afterBankPassCount: 0,
                walkOk: false,
                tile: null,
                logs
            };
            g.rs2b0t.runner.start(
                api.registerScript({ name: 'Issue371ShantayClueProbe', create: () => new Probe() })
            );
            const t0 = Date.now();
            while (g.rs2b0t.runner.state !== 'idle' && Date.now() - t0 < budget + 30_000) {
                await new Promise(r => setTimeout(r, 200));
            }
            return {
                ok: g.__371?.walkOk === true,
                tile: g.__371?.tile ?? null,
                logs: g.__371?.logs ?? logs
            };
        },
        { dest: DESERT_DIG, budget: BUDGET_MS, radius: ARRIVAL }
    );
}

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
page.on('console', msg => {
    if (msg.type() === 'error') {
        console.log(`[browser:error] ${msg.text()}`);
    }
});

try {
    await proof.ensureDirs();
    const user = `c371${Date.now().toString(36).slice(-6)}`;
    console.log(`#371 clue-shantay-pass-live base=${base} user=${user}`);
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);
    await cheatQuiet(page, 'speed 300');

    // Bank-only pass: clear inv, give pass, open bank, deposit all, close.
    await cheatQuiet(page, '~clearinv inv');
    await cheatQuiet(page, 'give shantay_pass 1');
    await cheatQuiet(page, 'give coins 1000');
    // Bank near Al Kharid / Shantay
    await teleArrive(page, { x: 3269, z: 3167, level: 0 });
    await cheatQuiet(page, '~bank', 1200);
    await page.waitForFunction(() => (globalThis as never as Abi).__rs2b0t.Bank.isOpen(), undefined, {
        timeout: 8000
    }).catch(() => undefined);

    // Deposit everything (incl. pass) into bank via a short script — Bank needs runner.
    await page.evaluate(() => {
        const g = globalThis as never as Abi;
        const api = g.__rs2b0t;
        class Seed extends api.LoopingBot {
            override async loop(): Promise<void> {
                try {
                    if (!api.Bank.isOpen()) {
                        await api.Bank.openNearest('Bank booth', 'Use-quickly');
                    }
                    if (api.Bank.isOpen()) {
                        await api.Bank.depositAllMatching(() => true);
                        await api.Bank.close();
                    }
                } finally {
                    g.rs2b0t.runner.stop();
                }
            }
        }
        g.rs2b0t.runner.start(
            api.registerScript({ name: 'Issue371SeedDeposit', create: () => new Seed() })
        );
    });
    {
        const t0 = Date.now();
        while (Date.now() - t0 < 30_000) {
            const st = await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state);
            if (st === 'idle') {
                break;
            }
            await page.waitForTimeout(200);
        }
    }

    // Confirm inv has no pass
    const invBefore = await page.evaluate(
        n => (globalThis as never as Abi).__rs2b0t.Inventory.count(n),
        SHANTAY_PASS
    );
    if (invBefore !== 0) {
        throw new Error(`expected 0 pass in inv before bank prep, got ${invBefore}`);
    }

    // Run #371 bank-prep slice (keep + withdraw pass).
    await teleArrive(page, { x: 3269, z: 3167, level: 0 });
    const prep = await bankPrepShantayPass(page);
    console.log(`bank prep: afterCount=${prep.afterCount} logs=${prep.logs.join(' | ')}`);
    if (prep.afterCount < 1) {
        throw new Error('bank prep did not leave a Shantay pass in inventory');
    }

    // From north of pass, walk to desert dig — proves requires-gated edge with pass held.
    await teleArrive(page, NORTH_OF_PASS);
    const walk = await walkDesert(page);
    const tile = walk.tile;
    const dist = tile ? cheb(tile, DESERT_DIG) : 9999;
    const ok = walk.ok && dist <= ARRIVAL;
    console.log(`walk ok=${walk.ok} dist=${dist} tile=${JSON.stringify(tile)}`);
    if (!ok) {
        console.log(walk.logs.slice(-20).join('\n'));
        await proof.writeFailure(page);
        throw new Error(`desert walk failed dist=${dist}`);
    }

    await proof.writeSuccess(page, {
        issue: 371,
        bankPrepAfterPassCount: prep.afterCount,
        bankPrepLogs: prep.logs,
        walkLogs: walk.logs.slice(-30),
        dist,
        tile,
        dest: DESERT_DIG
    });
    console.log('PASS #371 clue-shantay-pass-live');
    process.exit(0);
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
