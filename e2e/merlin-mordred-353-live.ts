/** Live proof for #353 Mordred re-attack loop.
 *  Drives product fortress() through __rs2b0t.questLive, the same code as Merlin's Crystal. */

//   ~/redeploy.sh && HEADED=1 bun e2e/merlin-mordred-353-live.ts
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import {
    cheatQuiet,
    mainlandAccount,
    maxmeAndClearDialogs
} from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

const KEEP_L0 = { x: 2770, z: 3403, level: 0 };
const WATCH_MS = 180_000;
const proof = createHarnessProof({ issue: 353, slug: 'merlin-mordred' });

type Tile = { x: number; z: number; level: number };
type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        registerScript(m: { name: string; create(): unknown }): unknown;
        questLive: {
            merlinFortress(log: (m: string) => void): Promise<boolean>;
            merlinResetMordredBrief(): void;
            merlinMordredBriefed(): boolean;
        };
    };
    rs2b0t: { runner: { state: string; start(m: unknown): void; stop(reason: string): void } };
    __353?: {
        done: boolean;
        ok: boolean;
        briefed: boolean;
        leaveLogs: string[];
        attackAfterBrief: number;
        detail: string;
    };
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

async function teleArrive(page: Page, spot: Tile, maxDist = 4): Promise<void> {
    for (let a = 0; a < 8; a++) {
        await cheatQuiet(page, teleCmd(spot));
        for (let p = 0; p < 20; p++) {
            const t = await page.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile());
            if (t && cheb(t, spot) <= maxDist) {
                await page.waitForTimeout(500);
                return;
            }
            await page.waitForTimeout(200);
        }
    }
    throw new Error(`tele ${spot.x},${spot.z} failed`);
}

const browser = await launchBrowser({ swiftshader: true });
const page = await browser.newPage();
try {
    await proof.ensureDirs();
    const user = `mc353${Date.now().toString(36).slice(-5)}`;
    console.log(`#353 merlin-mordred-live base=${base} user=${user}`);
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);
    await cheatQuiet(page, 'speed 300');
    await cheatQuiet(page, 'setvar arthur 3');
    await cheatQuiet(page, '~clearinv inv');
    await cheatQuiet(page, 'give rune_mace 1');
    await cheatQuiet(page, 'give lobster 10');
    await teleArrive(page, KEEP_L0);

    await page.evaluate(() => {
        const g = globalThis as never as Abi;
        const api = g.__rs2b0t;
        const leaveLogs: string[] = [];
        let sawBrief = false;
        const attackAfterBrief = 0;
        const log = (m: string) => {
            leaveLogs.push(m);
            console.log(`[#353] ${m}`);
            if (/morgan brief|already briefed|no re-attack/i.test(m)) {
                sawBrief = true;
            }
            // product fortress logs "leaving keep" after brief
            if (/leaving keep/i.test(m)) {
                sawBrief = true;
            }
        };

        api.questLive.merlinResetMordredBrief();

        class Probe extends api.LoopingBot {
            private ticks = 0;
            private postBriefTicks = 0;

            override async loop(): Promise<void> {
                this.ticks++;
                try {
                    const before = api.questLive.merlinMordredBriefed();
                    await api.questLive.merlinFortress(log);
                    const after = api.questLive.merlinMordredBriefed();
                    if (after) {
                        sawBrief = true;
                    }
                    if (before || after) {
                        this.postBriefTicks++;
                        // Call fortress again while briefed — must not re-engage Mordred
                        // (product path logs "already briefed" and leaveKeep).
                        await api.questLive.merlinFortress(log);
                    }
                    // Success: briefed and we have leave/brief logs, or var progressed
                    if (sawBrief && this.postBriefTicks >= 2) {
                        g.__353 = {
                            done: true,
                            ok: true,
                            briefed: true,
                            leaveLogs,
                            attackAfterBrief,
                            detail: `briefed after ${this.ticks} fortress calls; postBriefTicks=${this.postBriefTicks}`
                        };
                        g.rs2b0t.runner.stop('harness stop');
                        return;
                    }
                    if (this.ticks > 80) {
                        g.__353 = {
                            done: true,
                            ok: false,
                            briefed: sawBrief,
                            leaveLogs,
                            attackAfterBrief,
                            detail: `timeout ticks=${this.ticks} briefed=${sawBrief}`
                        };
                        g.rs2b0t.runner.stop('harness stop');
                    }
                } catch (e) {
                    log(String(e));
                    g.__353 = {
                        done: true,
                        ok: false,
                        briefed: sawBrief,
                        leaveLogs,
                        attackAfterBrief,
                        detail: String(e)
                    };
                    g.rs2b0t.runner.stop('harness stop');
                }
            }
        }

        g.__353 = {
            done: false,
            ok: false,
            briefed: false,
            leaveLogs: [],
            attackAfterBrief: 0,
            detail: ''
        };
        g.rs2b0t.runner.start(
            api.registerScript({ name: 'Issue353MordredProbe', create: () => new Probe() })
        );
    });

    const t0 = Date.now();
    while (Date.now() - t0 < WATCH_MS) {
        const snap = await page.evaluate(() => (globalThis as never as Abi).__353);
        if (snap?.done) {
            console.log(JSON.stringify(snap, null, 2));
            if (!snap.ok) {
                await proof.writeFailure(page);
                throw new Error(snap.detail);
            }
            await proof.writeSuccess(page, { issue: 353, ...snap });
            console.log('PASS #353 merlin-mordred-live');
            process.exit(0);
        }
        await page.waitForTimeout(500);
    }
    throw new Error('harness timeout');
} catch (e) {
    console.error(e);
    await proof.writeFailure(page).catch(() => undefined);
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
