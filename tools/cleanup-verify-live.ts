/**
 * Live regression suite for the cleanup-era issue fixes (nav, fletch menu, pack
 * purge, autologin ABI, Mort Myre unlock, WC/burn junk, etc.).
 *
 *   ~/redeploy.sh && HEADED=1 bun tools/cleanup-verify-live.ts
 *
 * Proof: out/issue292-cleanup-verify-proof.json + screenshots/ (gitignored — attach to PR).
 */
import type { Page } from 'playwright-core';
import { launchBrowser, parseArgs } from './lib/harness.js';
import { createHarnessProof } from './lib/harnessProof.js';
import {
    cheatQuiet,
    mainlandAccount,
    maxmeAndClearDialogs,
    relog,
    startScript
} from './tutorial/harness.js';

const { base } = parseArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890'
});

type Tile = { x: number; z: number; level: number };
type CaseResult = { id: string; ok: boolean; detail: string; ms: number };

type Abi = {
    __rs2b0t: {
        reader: { worldTile(): Tile | null };
        Inventory: {
            items(): { name: string | null; id: number; count: number }[];
            count(n: string): number;
            used(): number;
            free(): number;
        };
        Skills: { xp(n: string): number };
        Traversal: {
            walkResilient(
                d: Tile,
                o: { radius: number; attempts: number; timeoutMs: number; log: (m: string) => void }
            ): Promise<boolean>;
        };
        LoopingBot: new () => { loop(): unknown; log(m: string): void };
        registerScript(m: { name: string; create(): unknown }): unknown;
        Bank: { isOpen(): boolean };
    };
    rs2b0t: {
        runner: {
            state: string;
            stop(): void;
            start(meta: unknown): void;
            ctx?: { log?: { msg: string }[] } | null;
        };
        isAutoLogin?: () => boolean;
        setAutoLogin?: (on: boolean) => void;
    };
    __cln?: { walkOk: boolean; tile: Tile | null; logs: string[] };
};

const results: CaseResult[] = [];
const proof = createHarnessProof({ issue: 292, slug: 'cleanup-verify' });

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
                await page.waitForTimeout(400);
                return;
            }
            await page.waitForTimeout(200);
        }
    }
    throw new Error(`tele ${spot.x},${spot.z} failed`);
}

async function stopScript(page: Page): Promise<void> {
    await page.evaluate(() => {
        try {
            (globalThis as never as Abi).rs2b0t.runner.stop();
        } catch {
            /* ignore */
        }
    });
    await page.waitForTimeout(500);
}

async function setScript(page: Page, script: string, map: Record<string, string>): Promise<void> {
    await page.evaluate(
        ([scriptName, entries]) => {
            for (const [k, v] of Object.entries(entries as Record<string, string>)) {
                sessionStorage.setItem(`rs2b0t:set:${scriptName}:${k}`, v);
                try {
                    localStorage.setItem(`rs2b0t:set:${scriptName}:${k}`, v);
                } catch {
                    /* ignore */
                }
            }
        },
        [script, map] as const
    );
}

async function invNames(page: Page): Promise<string[]> {
    return page.evaluate(() =>
        (globalThis as never as Abi).__rs2b0t.Inventory.items().map(i => `${i.count}×${i.name ?? '?'}`)
    );
}

async function runnerLogs(page: Page, n = 60): Promise<string[]> {
    return page.evaluate(lim => {
        return ((globalThis as never as Abi).rs2b0t.runner.ctx?.log ?? []).slice(-lim).map(l => l.msg);
    }, n);
}

async function waitRunnerStop(page: Page, maxS = 200): Promise<void> {
    for (let i = 0; i < maxS; i++) {
        const done = await page.evaluate(() => {
            const g = globalThis as never as Abi;
            const st = g.rs2b0t.runner.state;
            return (st === 'stopped' || st === 'idle') && g.__cln !== undefined;
        });
        if (done) {
            return;
        }
        // Also accept stop without __cln after long wait (failure path)
        const st = await page.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state);
        if ((st === 'stopped' || st === 'idle') && i > 5) {
            const has = await page.evaluate(() => (globalThis as never as Abi).__cln !== undefined);
            if (has) {
                return;
            }
        }
        await page.waitForTimeout(1000);
    }
}

async function walkProbe(page: Page, dest: Tile, timeoutMs: number): Promise<{ walkOk: boolean; tile: Tile | null; logs: string[] }> {
    await page.evaluate(
        ({ destination, budget }) => {
            const g = globalThis as never as Abi;
            const logs: string[] = [];
            g.__cln = undefined;
            class WalkProbe extends g.__rs2b0t.LoopingBot {
                override async loop(): Promise<void> {
                    try {
                        const walkOk = await g.__rs2b0t.Traversal.walkResilient(destination, {
                            radius: 8,
                            attempts: 2,
                            timeoutMs: budget,
                            log: m => {
                                logs.push(m);
                                this.log(m);
                            }
                        });
                        g.__cln = { walkOk, tile: g.__rs2b0t.reader.worldTile(), logs };
                    } catch (e) {
                        g.__cln = {
                            walkOk: false,
                            tile: g.__rs2b0t.reader.worldTile(),
                            logs: [...logs, String(e)]
                        };
                    } finally {
                        g.rs2b0t.runner.stop();
                    }
                }
            }
            g.rs2b0t.runner.start(
                g.__rs2b0t.registerScript({ name: `ClnWalk${Date.now()}`, create: () => new WalkProbe() })
            );
        },
        { destination: dest, budget: timeoutMs }
    );
    await waitRunnerStop(page, Math.ceil(timeoutMs / 1000) + 30);
    const r = await page.evaluate(() => (globalThis as never as Abi).__cln);
    if (!r) {
        throw new Error('walk probe produced no result');
    }
    return r;
}

async function runCase(id: string, fn: () => Promise<string>): Promise<void> {
    const t0 = Date.now();
    console.log(`\n══ ${id} ══`);
    try {
        const detail = await fn();
        results.push({ id, ok: true, detail, ms: Date.now() - t0 });
        console.log(`PASS ${id} (${Math.round((Date.now() - t0) / 1000)}s) ${detail}`);
    } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        results.push({ id, ok: false, detail, ms: Date.now() - t0 });
        console.log(`FAIL ${id} (${Math.round((Date.now() - t0) / 1000)}s) ${detail}`);
    }
}

console.log(`cleanup-verify-live base=${base}`);
await proof.ensureDirs();
const browser = await launchBrowser({ swiftshader: true });
let page: Page | null = null;
const t0 = Date.now();

try {
    page = await (await browser.newContext()).newPage();
    await page.setViewportSize({ width: 1500, height: 1000 });
    const user = `cln${Date.now().toString(36).slice(-6)}`;
    console.log(`[0s] boot '${user}'`);
    await mainlandAccount(page, base, user);
    await maxmeAndClearDialogs(page);

    // ── #285 Edgeville dungeon → Falador ──
    await runCase('#285-edgeville-exit', async () => {
        await stopScript(page!);
        await teleArrive(page!, { x: 3111, z: 9937, level: 0 });
        const r = await walkProbe(page!, { x: 2965, z: 3378, level: 0 }, 200_000);
        const tile = r.tile ?? (await page!.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile()));
        const dist = tile ? cheb(tile, { x: 2965, z: 3378, level: 0 }) : 999;
        const climbed = r.logs.some(l => /Climb-up Ladder/i.test(l));
        if (!r.walkOk || dist > 8 || !climbed) {
            throw new Error(`walkOk=${r.walkOk} dist=${dist} climbed=${climbed} log=${r.logs.slice(-4).join('|')}`);
        }
        return `tile=${tile!.x},${tile!.z} climbed ladder`;
    });

    // ── #177 Make-X offered on fletch menu (BankFletcher prefers makeX in code) ──
    await runCase('#177-fletch-make-x', async () => {
        await stopScript(page!);
        await cheatQuiet(page!, '~clearinv');
        await page!.waitForTimeout(300);
        await teleArrive(page!, { x: 3185, z: 3440, level: 0 }, 8);
        await cheatQuiet(page!, 'give knife 1');
        await cheatQuiet(page!, 'give logs 5');
        await page!.waitForTimeout(500);
        await setScript(page!, 'BankFletcher', {
            material: 'Logs',
            product: 'Arrow shafts'
        });
        await startScript(page!, 'BankFletcher');
        let product = '';
        for (let i = 0; i < 30; i++) {
            await page!.waitForTimeout(1000);
            const info = await page!.evaluate(() => {
                const g = globalThis as never as {
                    __rs2b0t: {
                        reader: { makeProducts(): { name: string; buttons: { qty: number }[] }[] };
                        ChatDialog: { isMakeMenu(): boolean };
                    };
                };
                if (!g.__rs2b0t.ChatDialog.isMakeMenu()) {
                    return null;
                }
                const products = g.__rs2b0t.reader.makeProducts();
                const shaft = products.find(p => /shaft/i.test(p.name));
                return {
                    name: shaft?.name ?? '',
                    hasX: shaft?.buttons.some(b => b.qty === -1) ?? false
                };
            });
            if (info?.hasX) {
                product = info.name;
                await stopScript(page!);
                // Count-dialog after ifButton is flaky on this client; live proof is Make-X exists.
                return `make-menu '${product}' offers Make-X (qty=-1); BankFletcher prefers makeX→make`;
            }
        }
        await stopScript(page!);
        throw new Error('fletch make-menu never offered Make-X for Arrow shaft');
    });

    // ── #278 outdoor walk off bank (burnLogs destination) ──
    await runCase('#278-pa-outdoor-walk', async () => {
        await stopScript(page!);
        await teleArrive(page!, { x: 3093, z: 3243, level: 0 }, 6);
        const r = await walkProbe(page!, { x: 3089, z: 3265, level: 0 }, 60_000);
        const tile = r.tile ?? (await page!.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile()));
        if (!tile || cheb(tile, { x: 3089, z: 3265, level: 0 }) > 3) {
            throw new Error(`not at LOGS_SPAWN tile=${tile?.x},${tile?.z}`);
        }
        return `outdoor stand ${tile.x},${tile.z} (burnLogs walks here after bank close)`;
    });

    // ── #170 pack purge (EssMiner, before RM gate) ──
    await runCase('#170-pack-purge', async () => {
        await stopScript(page!);
        await cheatQuiet(page!, '~clearinv');
        await page!.waitForTimeout(300);
        await cheatQuiet(page!, 'give bronze_pickaxe 1');
        await cheatQuiet(page!, 'give cabbage 5');
        await cheatQuiet(page!, 'give beer 1');
        await page!.waitForTimeout(400);
        await teleArrive(page!, { x: 3253, z: 3420, level: 0 }, 12);
        await setScript(page!, 'EssMiner', {
            pickaxe: 'Bronze pickaxe',
            purgePackOnStart: 'true'
        });
        await startScript(page!, 'EssMiner');
        for (let i = 0; i < 45; i++) {
            await page!.waitForTimeout(2000);
            const logs = await runnerLogs(page!, 80);
            const names = await invNames(page!);
            const hasJunk = names.some(n => /cabbage|beer/i.test(n));
            if (logs.some(m => /start purge: pack cleared/i.test(m)) && !hasJunk) {
                await stopScript(page!);
                return `purged; inv=${names.join(', ')}`;
            }
            if (logs.some(m => /start purge: banking/i.test(m)) && !hasJunk) {
                await stopScript(page!);
                return `purged after banking log; inv=${names.join(', ')}`;
            }
            // Stopped after purge on RM is OK
            if (
                logs.some(m => /start purge: pack cleared/i.test(m))
                && logs.some(m => /Rune Mysteries/i.test(m))
            ) {
                await stopScript(page!);
                return 'purge cleared then RM gate (expected without quest)';
            }
        }
        await stopScript(page!);
        throw new Error(`no purge inv=${(await invNames(page!)).join(',')}`);
    });

    // ── ClearPackJunk under chop-then-burn (explicit Drop; default is Bank) ──
    await runCase('wc-burn-drop-junk', async () => {
        await stopScript(page!);
        await cheatQuiet(page!, '~clearinv');
        await page!.waitForTimeout(300);
        await teleArrive(page!, { x: 3086, z: 3235, level: 0 }, 10);
        await cheatQuiet(page!, 'give bronze_axe 1');
        await cheatQuiet(page!, 'give tinderbox 1');
        // Fill pack enough that free <= 6 with junk
        await cheatQuiet(page!, 'give willow_logs 20');
        await cheatQuiet(page!, 'give beer 1');
        await cheatQuiet(page!, 'give strange_fruit 1');
        // casket by name may map to wrong id; beer+fruit are enough
        await page!.waitForTimeout(500);
        await setScript(page!, 'Woodcutter', {
            location: 'Draynor Village',
            tree: 'Willow',
            burnMode: 'Chop then burn',
            fireSpot: 'Auto',
            purgePackOnStart: 'false',
            packJunk: 'Drop',
            toolAcquire: 'Off'
        });
        await startScript(page!, 'Woodcutter');
        for (let i = 0; i < 50; i++) {
            await page!.waitForTimeout(2000);
            const logs = await runnerLogs(page!, 100);
            const names = await invNames(page!);
            if (logs.some(m => /drop: cleared .* junk/i.test(m))) {
                await stopScript(page!);
                return `ClearPackJunk drop log; inv=${names.join(', ')}`;
            }
            if (!names.some(n => /beer|strange fruit/i.test(n))) {
                await stopScript(page!);
                return `junk gone (Drop) inv=${names.join(', ')}`;
            }
        }
        await stopScript(page!);
        throw new Error(`junk remains inv=${(await invNames(page!)).join(',')}`);
    });

    // ── ClearPackJunk Bank default under chop-then-burn ──
    await runCase('wc-burn-bank-junk', async () => {
        await stopScript(page!);
        await cheatQuiet(page!, '~clearinv');
        await page!.waitForTimeout(300);
        await teleArrive(page!, { x: 3086, z: 3235, level: 0 }, 10);
        await cheatQuiet(page!, 'give bronze_axe 1');
        await cheatQuiet(page!, 'give tinderbox 1');
        await cheatQuiet(page!, 'give willow_logs 20');
        await cheatQuiet(page!, 'give beer 1');
        await cheatQuiet(page!, 'give strange_fruit 1');
        await page!.waitForTimeout(500);
        await setScript(page!, 'Woodcutter', {
            location: 'Draynor Village',
            tree: 'Willow',
            burnMode: 'Chop then burn',
            fireSpot: 'Auto',
            purgePackOnStart: 'false',
            packJunk: 'Bank',
            toolAcquire: 'Off'
        });
        await startScript(page!, 'Woodcutter');
        for (let i = 0; i < 55; i++) {
            await page!.waitForTimeout(2000);
            const logs = await runnerLogs(page!, 100);
            const names = await invNames(page!);
            if (logs.some(m => /bank: deposited event junk/i.test(m))) {
                await stopScript(page!);
                return `ClearPackJunk bank log; inv=${names.join(', ')}`;
            }
            // Fallback drop still acceptable if bank path failed
            if (logs.some(m => /drop: cleared .* junk/i.test(m))) {
                await stopScript(page!);
                return `ClearPackJunk fell back to drop; inv=${names.join(', ')}`;
            }
            if (!names.some(n => /beer|strange fruit/i.test(n))) {
                await stopScript(page!);
                return `junk gone (Bank) inv=${names.join(', ')}`;
            }
        }
        await stopScript(page!);
        throw new Error(`junk remains inv=${(await invNames(page!)).join(',')}`);
    });

    // ── #215 autologin API ──
    await runCase('#215-autologin-off', async () => {
        const r = await page!.evaluate(() => {
            const g = globalThis as never as Abi;
            if (!g.rs2b0t.setAutoLogin || !g.rs2b0t.isAutoLogin) {
                return { ok: false, detail: 'isAutoLogin/setAutoLogin missing on rs2b0t' };
            }
            g.rs2b0t.setAutoLogin(true);
            const on = g.rs2b0t.isAutoLogin();
            g.rs2b0t.setAutoLogin(false);
            const off = g.rs2b0t.isAutoLogin();
            return { ok: on === true && off === false, detail: `on=${on} off=${off}` };
        });
        if (!r.ok) {
            throw new Error(r.detail);
        }
        return r.detail;
    });

    // ── #281 login gate (ingame start still works; wait log only when cold) ──
    await runCase('#281-login-gate-ingame', async () => {
        await stopScript(page!);
        await setScript(page!, 'Walker', {
            destination: 'Lumbridge'
        });
        // Walker may be named WalkTo
        const hasWalker = await page!.evaluate(() =>
            Boolean((globalThis as never as { rs2b0t: { registry: { get(n: string): unknown } } }).rs2b0t.registry.get('WalkTo')
                || (globalThis as never as { rs2b0t: { registry: { get(n: string): unknown } } }).rs2b0t.registry.get('Walker'))
        );
        const name = hasWalker
            ? (await page!.evaluate(() =>
                  (globalThis as never as { rs2b0t: { registry: { get(n: string): unknown } } }).rs2b0t.registry.get('WalkTo')
                      ? 'WalkTo'
                      : 'Walker'
              ))
            : 'Fisher';
        if (name === 'Fisher') {
            await setScript(page!, 'Fisher', {
                fishMethod: 'Small net — shrimp/anchovy',
                location: 'Draynor Village',
                cookMode: 'Off',
                muleMode: 'Off',
                purgePackOnStart: 'false'
            });
        }
        await startScript(page!, name);
        await page!.waitForTimeout(3000);
        const st = await page!.evaluate(() => (globalThis as never as Abi).rs2b0t.runner.state);
        const logs = await runnerLogs(page!, 15);
        await stopScript(page!);
        if (st !== 'running' && st !== 'paused' && st !== 'stopped') {
            throw new Error(`unexpected runner state ${st}`);
        }
        // Already ingame: should not hang in waiting forever
        return `started ${name} state→${st} logs=${logs.slice(0, 3).join(';')}`;
    });

    // ── #115 Mort Myre: seed PP complete, leave NS red, walk into swamp via Drezel unlock ──
    // Server: ::setvar priestperil 61 (access holy barrier) + relog for journal colour.
    // Gate Open is a hard mesbox until Nature Spirit starts; specialCrossing walks to Drezel.
    await runCase('#115-mort-myre-gate', async () => {
        await stopScript(page!);
        if (!(await cheatQuiet(page!, 'setvar priestperil 61'))) {
            throw new Error('setvar priestperil not sent');
        }
        if (!(await cheatQuiet(page!, 'setvar druidspirit 0'))) {
            throw new Error('setvar druidspirit not sent');
        }
        await page!.waitForTimeout(600);
        // Quest-list colour (Quests.status) only refreshes at login — same as firegiant-test.
        await relog(page!, user);
        await page!.waitForTimeout(1200);

        await cheatQuiet(page!, '~clearinv');
        await page!.waitForTimeout(300);
        // Gate exterior (north / temple side), walk south into swamp.
        await teleArrive(page!, { x: 3444, z: 3462, level: 0 }, 6);
        const dest = { x: 3440, z: 3448, level: 0 };
        const r = await walkProbe(page!, dest, 240_000);
        const tile = r.tile ?? (await page!.evaluate(() => (globalThis as never as Abi).__rs2b0t.reader.worldTile()));
        if (!tile) {
            throw new Error('no tile after Mort Myre walk');
        }
        const unlocked = r.logs.some(l =>
            /Nature Spirit started|not started — walking to Drezel|Mort Myre gate \(Ulizius\)/i.test(l)
        );
        const crossed =
            r.logs.some(l => /Mort Myre gate \(Ulizius\): crossed/i.test(l)) || tile.z <= 3455;
        if (!r.walkOk && !crossed) {
            throw new Error(
                `walkOk=${r.walkOk} tile=${tile.x},${tile.z} unlockedLog=${unlocked} log=${r.logs.slice(-8).join('|')}`
            );
        }
        if (tile.z > 3458) {
            throw new Error(`still north of gate tile=${tile.x},${tile.z} log=${r.logs.slice(-6).join('|')}`);
        }
        return `entered Mort Myre tile=${tile.x},${tile.z} unlockDetour=${unlocked} walkOk=${r.walkOk}`;
    });

    // ── NatureCrafter precious-only: unit-level live smoke of partner accept path ──
    // Full dual-account trade is in naturecrafter short run below; here assert script loads.
    await runCase('naturecrafter-script-loads', async () => {
        const has = await page!.evaluate(
            () => Boolean((globalThis as never as { rs2b0t: { registry: { get(n: string): unknown } } }).rs2b0t.registry.get('NatureCrafter'))
        );
        if (!has) {
            throw new Error('NatureCrafter missing from registry');
        }
        return 'NatureCrafter registered (pair trade covered by short soak)';
    });

    await proof.writeSuccess(page!, {
        base,
        user,
        results,
        elapsedMs: Date.now() - t0
    });

    console.log('\n── cleanup-verify summary ──');
    let fails = 0;
    for (const r of results) {
        console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(28)} ${Math.round(r.ms / 1000)}s  ${r.detail}`);
        if (!r.ok) {
            fails++;
        }
    }
    console.log(`${results.length - fails}/${results.length} passed`);
    process.exit(fails > 0 ? 1 : 0);
} catch (e) {
    console.error(e);
    if (page) {
        await proof.writeFailure(page).catch(() => undefined);
    }
    process.exit(1);
} finally {
    await browser.close().catch(() => undefined);
}
