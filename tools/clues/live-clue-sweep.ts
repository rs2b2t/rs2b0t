// LIVE sweep of every clue in CLUE_DB through the real ClueSolver pipeline.
// N parallel headless clients (real GPU — SwiftShader crashes long sessions);
// each worker loops: stop solver -> tele to Varrock East bank -> drop clue/
// casket leftovers (deposit-all when the pack runs low) -> ::give the clue ->
// start ClueSolver -> PASS when the GIVEN id leaves the pack (its own step
// consumed it; trail chains are stopped right there), FAIL on an 'abandoning'
// log for it or the per-clue deadline. Results: table + out/clue-sweep.json.
//
// The per-clue unit is deliberately ONE STEP: each id's own walk+action. The
// chain a consumed clue yields is some OTHER id already covered by the sweep.
// Kit (spade + sextant/watch/chart + coins) is pre-given so the shared
// acquisition chain (tested by its own live smoke) isn't re-run 122 times.
//
// Requires the local engine running + local build deployed.
// Usage: bun tools/clues/live-clue-sweep.ts [--workers 5] [--mins 8] [--ids 2713,2811]

import fs from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { CLUE_DB } from '#/bot/clues/data/cluedb.js';

const base = 'http://localhost:8890';
const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
    const i = argv.indexOf(`--${name}`);
    return i !== -1 ? argv[i + 1] : null;
};
const WORKERS = Number(arg('workers') ?? 5);
const CLUE_DEADLINE_MS = Number(arg('mins') ?? 8) * 60_000;
const only = arg('ids')?.split(',').map(Number);
const EXPECTED_ABANDON = new Set([2811, 2815]); // audit KNOWN_UNREACHABLE allowlist

const ids = (only ?? Object.keys(CLUE_DB).map(Number)).sort((a, b) => a - b);
const queue = [...ids];
type Verdict = 'pass' | 'abandon' | 'stuck' | 'slow';
const results: { id: number; obj: string; type: string; ok: boolean; verdict: Verdict; expected?: boolean; ms: number; reason?: string; tail?: string[] }[] = [];

// Lines that mean the walk/solve advanced (not just spinning). Used to tell a
// legitimate long cross-map walk (SLOW, likely-pass) from a genuine wedge
// (STUCK — the door-dance/0-click regression signature). 'best N tiles'
// decreasing is progress too, tracked separately below.
const PROGRESS_RE = /step done|arrived|leg \d+ —|crossed '|Climb-(up|down)|Enter .* at|acquiring|Swim to|sailed|got a spade|banking loot/;
const STALL_LOG_RE = /blocked live — as close as reachable|stuck at .* — repathing|giving up after/;

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(s: unknown): void; stop?(): void; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        registry: { get(n: string): unknown };
        actions?: { continueDialog?: () => boolean; closeModal?: () => void };
    };
    __probeResult?: { done: boolean; err?: string; log: string[] };
};

function log(m: string): void {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
}

async function bootWorker(browser: Browser, w: number): Promise<Page> {
    const page = await browser.newPage();
    const username = `cs${Date.now().toString(36).slice(-5)}${w}`;
    const boot = () => page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as R).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as R).rs2b0t.client.ingame && (globalThis as never as R).rs2b0t.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false);
    };
    const cheatBoot = async (pg: Page, t: string) => {
        await pg.evaluate(x => {
            const c = (globalThis as never as R).rs2b0t.client as never as { out: { p1Enc(op: number): void; p1(v: number): void; pjstr(s: string): void } };
            c.out.p1Enc(224);
            c.out.p1(x.length + 1);
            c.out.pjstr(x);
        }, t);
        await pg.waitForTimeout(900);
    };
    await page.goto(`${base}/bot.html`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await cheatBoot(page, 'tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { throw new Error(`worker ${w}: relogin failed`); }
    await cheatBoot(page, '~maxme');
    await page.evaluate(async () => {
        const a = (globalThis as never as R).rs2b0t.actions;
        for (let i = 0; i < 25; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); }
    });
    for (const [item, probe] of [['spade', 'spade'], ['trail_sextant', 'sextant'], ['trail_watch', 'watch'], ['trail_chart', 'chart']] as [string, string][]) {
        const held = () => page.evaluate(n => {
            const { Inventory } = (globalThis as never as { __rs2b0t: { Inventory: { items(): { name: string | null }[] } } }).__rs2b0t;
            return Inventory.items().some(i => (i.name ?? '').toLowerCase() === n);
        }, probe);
        for (let attempt = 0; attempt < 4 && !(await held()); attempt++) {
            await cheatBoot(page, `give ${item}`);
            await page.waitForTimeout(600);
        }
    }
    await cheatBoot(page, 'give coins 2000');
    log(`worker ${w} ready (${username})`);
    return page;
}

// Direct CLIENT_CHEAT packet (opcode 224, io/ClientProt.ts) — canvas typing is
// focus-dependent and concurrent worker pages drop keystrokes (shakedown find).
const cheat = async (page: Page, text: string) => {
    await page.evaluate(t => {
        const c = (globalThis as never as R).rs2b0t.client as never as { out: { p1Enc(op: number): void; p1(v: number): void; pjstr(s: string): void } };
        c.out.p1Enc(224);
        c.out.p1(t.length + 1);
        c.out.pjstr(t);
    }, text);
    await page.waitForTimeout(900);
};
const typeOn = cheat; // cheat text WITHOUT the :: prefix

/** ::give with verification — typing right after a tele/reset is flaky, so
 *  retry until the id (or name probe) confirms the item landed. */
async function giveVerified(page: Page, objName: string, heldProbe: () => Promise<boolean>): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
        if (await heldProbe()) {
            return true;
        }
        await typeOn(page, `give ${objName}`);
        await page.waitForTimeout(700);
    }
    return heldProbe();
}

/** Drop clue/casket leftovers; deposit-all junk when the pack runs low. */
async function resetPack(page: Page): Promise<void> {
    await page.evaluate(() => {
        const g = globalThis as never as R & Record<string, unknown>;
        const abi = g.__rs2b0t as never as {
            LoopingBot: new () => { loop(): Promise<number | void> };
            Execution: { delayTicks(n: number): Promise<void> };
            Inventory: { items(): { name: string | null; interact(op: string): Promise<boolean> | boolean }[]; freeSlots?(): number };
            Bank: { openNearest(name: string, op: string, log?: (m: string) => void): Promise<boolean>; depositAllMatching(p: (n: string) => boolean, log?: (m: string) => void): Promise<void> };
            registerScript(m: { name: string; create(): unknown }): void;
        };
        const res: NonNullable<R['__probeResult']> = { done: false, log: [] };
        g.__probeResult = res;
        class ProbeReset extends abi.LoopingBot {
            private ran = false;
            override async loop(): Promise<number> {
                if (this.ran) { return 5000; }
                this.ran = true;
                try {
                    const clueLike = () => abi.Inventory.items().filter(i => /clue|casket/i.test(i.name ?? ''));
                    for (const it of clueLike()) {
                        await it.interact('Drop');
                        await abi.Execution.delayTicks(1);
                    }
                    const slotsUsed = abi.Inventory.items().length;
                    if (slotsUsed > 20) {
                        if (await abi.Bank.openNearest('Bank booth', 'Use-quickly')) {
                            await abi.Bank.depositAllMatching(n => !/coins|spade|sextant|watch|chart/i.test(n));
                            (g.rs2b0t.actions?.closeModal ?? ((): void => {}))();
                        }
                    }
                } catch (e) {
                    res.err = String(e);
                }
                res.done = true;
                return 5000;
            }
        }
        abi.registerScript({ name: 'ProbeReset', create: () => new ProbeReset() });
        g.rs2b0t.runner.start(g.rs2b0t.registry.get('ProbeReset'));
    });
    await page.waitForFunction(() => (globalThis as never as R).__probeResult?.done === true, undefined, { timeout: 45000 }).catch(() => undefined);
    await page.evaluate(() => { try { (globalThis as never as R).rs2b0t.runner.stop?.(); } catch { /* stopped */ } });
    await page.waitForTimeout(600);
}

async function testClue(page: Page, id: number): Promise<{ ok: boolean; verdict: Verdict; ms: number; reason?: string; tail?: string[] }> {
    const row = CLUE_DB[id];
    const started = Date.now();
    await page.evaluate(() => { try { (globalThis as never as R).rs2b0t.runner.stop?.(); } catch { /* stopped */ } });
    await page.waitForTimeout(400);
    await typeOn(page, 'tele 0,50,53,53,28'); // Varrock East bank
    await resetPack(page);
    const holds = () => page.evaluate(cid => {
        const { Inventory } = (globalThis as never as { __rs2b0t: { Inventory: { items(): { id: number }[] } } }).__rs2b0t;
        return Inventory.items().some(i => i.id === cid);
    }, id);
    if (!(await giveVerified(page, row.obj, holds))) {
        return { ok: false, verdict: 'stuck', ms: Date.now() - started, reason: 'give failed after retries' };
    }
    // Exclusivity: exactly the given clue-like item, or the PASS detector
    // (given id leaves the pack) can watch the wrong trail. A stray from a
    // late-landing give gets one more reset, then re-verify.
    const clueLikeCount = () => page.evaluate(cid => {
        const { Inventory } = (globalThis as never as { __rs2b0t: { Inventory: { items(): { id: number; name: string | null }[] } } }).__rs2b0t;
        return Inventory.items().filter(i => /clue|casket/i.test(i.name ?? '') && i.id !== cid).length;
    }, id);
    if ((await clueLikeCount()) > 0) {
        await resetPack(page);
        if (!(await giveVerified(page, row.obj, holds)) || (await clueLikeCount()) > 0) {
            return { ok: false, verdict: 'stuck', ms: Date.now() - started, reason: 'pack not exclusive after reset' };
        }
    }
    const logsBefore = await page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).length);
    await page.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('ClueSolver')); });

    const deadline = Date.now() + CLUE_DEADLINE_MS;
    let lastProgressAt = Date.now();
    let bestSeen = Infinity;
    let seenLines = 0;
    let stallStreak = 0; // consecutive stall-log lines with no offsetting progress
    while (Date.now() < deadline) {
        await page.waitForTimeout(2500);
        const all: string[] = await page.evaluate(n => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).slice(n).map(l => l.msg), logsBefore);
        const fresh = all.slice(seenLines);
        seenLines = all.length;
        const abandon = fresh.find(l => l.includes(`abandoning ${row.obj}`));
        if (abandon) {
            return { ok: false, verdict: 'abandon', ms: Date.now() - started, reason: abandon.replace(/^.*abandoning /, 'abandon: '), tail: all.slice(-16) };
        }
        if (!(await holds())) {
            return { ok: true, verdict: 'pass', ms: Date.now() - started };
        }
        // progress accounting
        let progressed = false;
        for (const l of fresh) {
            if (PROGRESS_RE.test(l)) { progressed = true; }
            const m = l.match(/best (\d+) tiles/);
            if (m) {
                const d = Number(m[1]);
                if (d < bestSeen - 1) { bestSeen = d; progressed = true; }
            }
            if (STALL_LOG_RE.test(l)) { stallStreak++; } else if (PROGRESS_RE.test(l)) { stallStreak = 0; }
        }
        if (progressed) { lastProgressAt = Date.now(); }
        // Early STUCK exit: a long run of stall-logs with no progress is the
        // regression signature — fail fast instead of burning the full deadline.
        if (stallStreak >= 40 && Date.now() - lastProgressAt > 90_000) {
            const at0 = await page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
            return { ok: false, verdict: 'stuck', ms: Date.now() - started, reason: `wedged at (${at0?.x},${at0?.z},${at0?.level}) — ${stallStreak} stall-logs, no progress`, tail: all.slice(-16) };
        }
    }
    const tail: string[] = await page.evaluate(n => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).slice(n).map(l => l.msg), logsBefore);
    const at = await page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());
    // Deadline hit. Progress within the last 2 min => SLOW (long walk, not a
    // product failure); otherwise STUCK.
    const recentlyProgressed = Date.now() - lastProgressAt < 120_000;
    return {
        ok: false,
        verdict: recentlyProgressed ? 'slow' : 'stuck',
        ms: Date.now() - started,
        reason: `${recentlyProgressed ? 'still-walking' : 'wedged'} at (${at?.x},${at?.z},${at?.level})`,
        tail: tail.slice(-16)
    };
}

const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
    args: ['--no-sandbox']
});
try {
    const workers = Array.from({ length: WORKERS }, async (_, w) => {
        let page: Page | null = null;
        let reboots = 0;
        while (queue.length > 0) {
            const id = queue.shift()!;
            const row = CLUE_DB[id];
            try {
                page = page ?? (await bootWorker(browser, w));
                const r = await testClue(page, id);
                results.push({ id, obj: row.obj, type: row.type, expected: EXPECTED_ABANDON.has(id) || undefined, ...r });
                log(`w${w} ${r.verdict.toUpperCase()} [${id}] ${row.obj} (${Math.round(r.ms / 1000)}s)${r.reason ? ` — ${r.reason}` : ''}`);
            } catch (e) {
                log(`w${w} worker error on [${id}]: ${e}`);
                try { await page?.close(); } catch { /* gone */ }
                page = null;
                if (reboots++ < 4) {
                    queue.unshift(id); // retry this clue on a fresh client
                } else {
                    results.push({ id, obj: row.obj, type: row.type, ok: false, verdict: 'stuck', ms: 0, reason: `worker crash: ${e}` });
                }
            }
        }
    });
    await Promise.all(workers);

    const rank: Record<Verdict, number> = { stuck: 0, abandon: 1, slow: 2, pass: 3 };
    results.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.id - b.id);
    fs.writeFileSync('/Users/elliottriplett/code/rs2b0t/out/clue-sweep.json', JSON.stringify(results, null, 1));
    const by = (v: Verdict) => results.filter(r => r.verdict === v);
    console.log('\n==== LIVE CLUE SWEEP ====');
    for (const r of results) {
        const tag = r.verdict === 'pass' ? 'PASS' : r.expected ? `${r.verdict.toUpperCase()} (expected)` : r.verdict.toUpperCase();
        console.log(`${tag.padEnd(17)} [${r.id}] ${r.obj} (${r.type}) ${Math.round(r.ms / 1000)}s${r.reason ? ` — ${r.reason}` : ''}`);
    }
    const badStuck = by('stuck').filter(r => !r.expected);
    const badAbandon = by('abandon').filter(r => !r.expected);
    console.log(`\n${by('pass').length} PASS · ${by('slow').length} SLOW (long walk, likely-pass) · ${badAbandon.length} ABANDON · ${badStuck.length} STUCK${(by('abandon').length - badAbandon.length) + (by('stuck').length - badStuck.length) > 0 ? ` · ${(by('abandon').length - badAbandon.length) + (by('stuck').length - badStuck.length)} expected-abandon` : ''}`);
    console.log(`Regression suspects (STUCK, unexpected): ${badStuck.length ? badStuck.map(r => r.id).join(', ') : 'none'}`);
    console.log(`Details: out/clue-sweep.json`);
} finally {
    await browser.close();
}
