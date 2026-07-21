// Headless live smoke for ArdyFighter's SolveClue wiring — the full RockCrab-
// style chain: a clue scroll ON THE GROUND near the anchor gets looted by
// LootDrops ('clue scroll' leads DEFAULT_LOOT), and the held clue then
// preempts fighting into bank-first + the trail. Clue drops are 1/128, so a
// second client stages one: it ::give's itself the clue and drops it at the
// fighter's anchor (player drops go public after 100 ticks ≈ 60s).
//
// Requires the local engine running + the local build deployed (same as smokes).
// Usage: bun tools/ardyfighter-clue-test.ts [base-url]

import { launchBrowser } from './lib/harness.js';
import { type Page } from 'playwright-core';

const base = process.argv[2] || 'http://localhost:8890';
const ts = Date.now().toString(36).slice(-6);
const CLUE_OBJ = 'trail_clue_easy_map001';

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

type R = {
    rs2b0t: {
        client: { ingame: boolean; sceneState: number; loginUser: string; loginPass: string; login(u: string, p: string, r: boolean): Promise<void> };
        runner: { state: string; start(meta: unknown): void; stop?(): void; ctx: { log: { msg: string }[] } | null };
        reader: { worldTile(): { x: number; z: number; level: number } | null };
        registry: { get(name: string): unknown };
        actions?: { continueDialog?: () => boolean };
    };
    __probeResult?: { done: boolean; err?: string; log: string[] };
};

const browser = await launchBrowser({ swiftshader: true });

async function bootClient(label: string, username: string, maxme: boolean): Promise<Page> {
    const page = await browser.newPage();
    page.on('pageerror', e => console.log(`[${label}] pageerror: ${e}`));
    const boot = () => page.waitForFunction(() => ((globalThis as never as { rs2b0t?: { client: { constructor: { loopCycle: number } } } }).rs2b0t?.client.constructor.loopCycle ?? 0) > 10, undefined, { timeout: 60000 });
    const login = async () => {
        await page.evaluate(([u, p]) => { const c = (globalThis as never as R).rs2b0t.client; c.loginUser = u; c.loginPass = p; void c.login(u, p, false); }, [username, 'test']);
        return page.waitForFunction(() => (globalThis as never as R).rs2b0t.client.ingame && (globalThis as never as R).rs2b0t.client.sceneState === 2, undefined, { timeout: 12000 }).then(() => true).catch(() => false);
    };
    const type = async (t: string) => {
        await page.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await page.waitForTimeout(400);
        await page.keyboard.type(t, { delay: 30 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
    };
    const clearDialogs = () => page.evaluate(async () => {
        const a = (globalThis as never as R).rs2b0t.actions;
        for (let i = 0; i < 30; i++) { a?.continueDialog?.(); await new Promise(r => setTimeout(r, 250)); }
    });
    const tile = () => page.evaluate(() => (globalThis as never as R).rs2b0t.reader.worldTile());

    await page.goto(`${base}/bot.html`);
    await boot();
    for (let i = 0; i < 6 && !(await login()); i++) { await page.waitForTimeout(3000); }
    await type('::tele 0,50,50,20,20');
    await page.reload();
    await boot();
    let backIn = false;
    for (let i = 0; i < 8 && !backIn; i++) { await page.waitForTimeout(5000); backIn = await login(); }
    if (!backIn) { fail(`[${label}] relogin failed`); }
    if (maxme) {
        await type('::~maxme');
        await clearDialogs();
    }
    let at = null as { x: number; z: number; level: number } | null;
    for (let attempt = 0; attempt < 4; attempt++) {
        await type('::tele 0,41,51,37,42'); // the fighter anchor (2661,3306)
        await page.waitForTimeout(2000);
        at = await tile();
        if (at && Math.abs(at.x - 2661) <= 8 && Math.abs(at.z - 3306) <= 8) { break; }
        await clearDialogs();
    }
    if (!at || Math.abs(at.x - 2661) > 8 || Math.abs(at.z - 3306) > 8) { fail(`[${label}] market tele failed`); }
    console.log(`[${label}] ${username} at market (${at.x},${at.z})`);
    return page;
}

const logLines = (page: Page) => page.evaluate(() => ((globalThis as never as R).rs2b0t.runner.ctx?.log ?? []).map(l => l.msg));

try {
    // ---- A: the fighter ----
    const A = await bootClient('A', `af${ts}`, true);
    await A.evaluate(() => { const r = (globalThis as never as R).rs2b0t; r.runner.start(r.registry.get('ArdyFighter')); });
    console.log('started ArdyFighter — letting the fight/steal loop run');
    await A.waitForTimeout(15000);

    // ---- B: the dropper ----
    const B = await bootClient('B', `bf${ts}`, false);
    const typeB = async (t: string) => {
        await B.locator('#canvas').click({ position: { x: 380, y: 250 } });
        await B.waitForTimeout(400);
        await B.keyboard.type(t, { delay: 30 });
        await B.keyboard.press('Enter');
        await B.waitForTimeout(1500);
    };
    await typeB(`::give ${CLUE_OBJ}`);
    await B.evaluate(() => {
        const g = globalThis as never as R & Record<string, unknown>;
        const abi = g.__rs2b0t as never as {
            LoopingBot: new () => { loop(): Promise<number | void> };
            Execution: { delayTicks(n: number): Promise<void> };
            Inventory: { items(): { name: string | null; interact(op: string): Promise<boolean> | boolean }[] };
            registerScript(m: { name: string; create(): unknown }): void;
        };
        const res: NonNullable<R['__probeResult']> = { done: false, log: [] };
        g.__probeResult = res;
        class ProbeDrop extends abi.LoopingBot {
            private ran = false;
            override async loop(): Promise<number> {
                if (!this.ran) {
                    this.ran = true;
                    const clue = abi.Inventory.items().find(i => (i.name ?? '').toLowerCase().includes('clue'));
                    if (!clue) {
                        res.err = 'no clue in pack';
                    } else {
                        await clue.interact('Drop');
                        await abi.Execution.delayTicks(2);
                        res.log.push('dropped');
                    }
                    res.done = true;
                }
                return 5000;
            }
        }
        abi.registerScript({ name: 'ProbeDrop', create: () => new ProbeDrop() });
        g.rs2b0t.runner.start(g.rs2b0t.registry.get('ProbeDrop'));
    });
    await B.waitForFunction(() => (globalThis as never as R).__probeResult?.done === true, undefined, { timeout: 20000 }).catch(() => undefined);
    const dropRes = await B.evaluate(() => (globalThis as never as R).__probeResult);
    if (dropRes?.err) { fail(`dropper: ${dropRes.err}`); }
    console.log('B dropped the clue at the anchor — goes public in ~60s; watching the fighter');

    const before = (await logLines(A)).length;
    const seen = { banked: false, trail: false };
    for (let i = 0; i < 180; i++) { // 6 min: reveal ≈60s + loot + bank walk + trail
        await A.waitForTimeout(2000);
        const lines = (await logLines(A)).slice(before);
        for (const l of lines) {
            if (/\[clue\] banking loot at the/.test(l)) { seen.banked = true; }
            if (/\[clue\] leg \d+ — solving/.test(l)) { seen.trail = true; }
        }
        if (seen.banked && seen.trail) { break; }
        if (i > 0 && i % 30 === 0) { console.log(`  t+${i * 2}s ${JSON.stringify(seen)}`); }
    }

    console.log('--- fighter log tail ---');
    for (const l of (await logLines(A)).slice(-30)) { console.log(`  ${l}`); }
    console.log(`seen: ${JSON.stringify(seen)}`);
    if (!seen.banked) { fail('the looted clue never preempted into bank-first — loot->solve chain broken'); }
    if (!seen.trail) { fail('trail never started after bank-first'); }
    console.log('PASS: ArdyFighter loots a ground clue and solves it (LootDrops -> SolveClue preemption -> bank-first -> trail)');
} finally {
    await browser.close();
}
