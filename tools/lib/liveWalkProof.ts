/**
 * Start a one-shot walkResilient probe and wait until it finishes **or** the
 * player is already within chebyshev radius of dest.
 *
 * Live harnesses used to only poll `runner.state === 'idle'`. That hangs when
 * walkResilient sits on/near the target forever because isArrived fails
 * (walkable dest, canReach false, dist>0) — common for digs / blocked tiles.
 */
import type { Page } from 'playwright-core';

export type LiveTile = { x: number; z: number; level: number };

export type LiveWalkResult = {
    ok: boolean;
    tile: LiveTile | null;
    logs: string[];
    /** True when outer poll saw chebyshev ≤ radius before runner idle. */
    arrivedByTile: boolean;
    walkOk: boolean | null;
};

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): LiveTile | null };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        registerScript(m: { name: string; create(): unknown }): unknown;
        Traversal: {
            walkResilient(
                d: LiveTile,
                o: {
                    radius?: number;
                    attempts?: number;
                    timeoutMs?: number;
                    log?: (m: string) => void;
                }
            ): Promise<boolean>;
        };
    };
    rs2b0t: { runner: { state: string; start(m: unknown): void; stop(): void } };
    __liveWalk?: {
        done: boolean;
        ok: boolean;
        tile: LiveTile | null;
        logs: string[];
    };
};

function cheb(a: LiveTile, b: LiveTile): number {
    if (a.level !== b.level) {
        return 9999;
    }
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.z - b.z));
}

export async function runLiveWalkProof(
    page: Page,
    opts: {
        dest: LiveTile;
        radius: number;
        budgetMs: number;
        scriptName: string;
        attempts?: number;
        /** Poll interval for tile / runner (default 400). */
        pollMs?: number;
    }
): Promise<LiveWalkResult> {
    const pollMs = opts.pollMs ?? 400;
    const attempts = opts.attempts ?? 8;

    await page.evaluate(
        ({ dest, budget, radius, scriptName, attempts: att }) => {
            const g = globalThis as never as Abi;
            const api = g.__rs2b0t;
            const logs: string[] = [];
            const log = (m: string) => {
                logs.push(m);
                console.log(`[${scriptName}] ${m}`);
            };
            class Probe extends api.LoopingBot {
                override async loop(): Promise<void> {
                    try {
                        const ok = await api.Traversal.walkResilient(dest, {
                            radius,
                            attempts: att,
                            timeoutMs: budget,
                            log
                        });
                        g.__liveWalk = {
                            done: true,
                            ok,
                            tile: api.reader.worldTile(),
                            logs
                        };
                    } catch (e) {
                        log(String(e));
                        g.__liveWalk = {
                            done: true,
                            ok: false,
                            tile: api.reader.worldTile(),
                            logs
                        };
                    } finally {
                        try {
                            g.rs2b0t.runner.stop();
                        } catch {
                            /* ignore */
                        }
                    }
                }
            }
            g.__liveWalk = { done: false, ok: false, tile: null, logs: [] };
            g.rs2b0t.runner.start(
                api.registerScript({ name: scriptName, create: () => new Probe() })
            );
        },
        {
            dest: opts.dest,
            budget: opts.budgetMs,
            radius: opts.radius,
            scriptName: opts.scriptName,
            attempts
        }
    );

    const t0 = Date.now();
    let arrivedByTile = false;
    while (Date.now() - t0 < opts.budgetMs + 60_000) {
        if (page.isClosed()) {
            throw new Error('page closed during live walk');
        }
        const snap = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            return {
                runner: g.rs2b0t.runner.state,
                walk: g.__liveWalk ?? null,
                tile: g.__rs2b0t.reader.worldTile()
            };
        });
        const tile = snap.tile;
        if (tile && cheb(tile, opts.dest) <= opts.radius) {
            arrivedByTile = true;
            // Force stop if walkResilient is still spinning at the dest.
            if (snap.runner !== 'idle' && snap.runner !== 'stopped') {
                await page.evaluate(() => {
                    try {
                        (globalThis as never as Abi).rs2b0t.runner.stop();
                    } catch {
                        /* ignore */
                    }
                });
            }
            // Brief settle so finally-blocks can write __liveWalk.
            await page.waitForTimeout(500);
            const final = await page.evaluate(() => {
                const g = globalThis as never as Abi;
                return g.__liveWalk ?? null;
            });
            return {
                ok: true,
                tile: final?.tile ?? tile,
                logs: final?.logs ?? snap.walk?.logs ?? [],
                arrivedByTile: true,
                walkOk: final?.done ? final.ok : null
            };
        }
        if (snap.walk?.done || snap.runner === 'idle' || snap.runner === 'stopped') {
            const w = snap.walk;
            return {
                ok: w?.ok === true,
                tile: w?.tile ?? tile,
                logs: w?.logs ?? [],
                arrivedByTile,
                walkOk: w?.ok ?? null
            };
        }
        await page.waitForTimeout(pollMs);
    }

    const last = await page.evaluate(() => {
        const g = globalThis as never as Abi;
        try {
            g.rs2b0t.runner.stop();
        } catch {
            /* ignore */
        }
        return {
            walk: g.__liveWalk ?? null,
            tile: g.__rs2b0t.reader.worldTile()
        };
    });
    return {
        ok: false,
        tile: last.walk?.tile ?? last.tile,
        logs: last.walk?.logs ?? [],
        arrivedByTile,
        walkOk: last.walk?.ok ?? null
    };
}
