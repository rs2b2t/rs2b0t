// Prince Ali Rescue, one quest at a time: --stage 30 --give beer:3 --keystatus 1.
// Why: the bank is seeded with coins alone — seeding a stage with the tools that stage needs is what let every Watch Tower stage-10 test pass while the quest could not mine.

//   bun e2e/princeali-solo-test.ts                          uncheated 0 -> 110
//   bun e2e/princeali-solo-test.ts --stage 30 --give beer:3  from a jumped stage
//   bun e2e/princeali-solo-test.ts --stage 20 --keystatus 1  the already-forged wedge
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import type { Page } from 'playwright-core';

import { fail, launchBrowser } from './lib/harness.js';
import { cheat, cheatQuiet, getServerVarQuiet, mainlandAccount, relog, startScript } from './tutorial/harness.js';

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};

const base = opt('--base') ?? 'http://localhost:8888';
const user = opt('--user') ?? `pa${Date.now().toString(36).slice(-7)}`;
const stage = opt('--stage');
const keystatus = opt('--keystatus');
const give = opt('--give') ?? '';
const bankCoins = Number(opt('--bank-coins') ?? 2_000_000);
const minutes = Number(opt('--minutes') ?? 75);

const DRAYNOR_BANK = { x: 3093, z: 3243, level: 0 };
const COINS_ID = 995;

interface SoloSnapshot {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

interface SeedResult {
    done: boolean;
    ok: boolean;
    reason: string;
    banked: number;
}

// Why: the page loads the built bundle, so a source edit is invisible until it is rebuilt and copied into the engine's public/bot/ — skipping this silently tests the old code.
if (!argv.includes('--no-deploy')) {
    deployBundle();
}

const browser = await launchBrowser();
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    const stamp = (): string => `[${Math.round((Date.now() - t0) / 1000)}s]`;
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) {
            console.log(`  ${stamp()} ${txt}`);
        }
    });

    await mainlandAccount(page, base, user);
    console.log(`mainland-ready as '${user}'`);

    await cheat(page, 'speed 300');
    if (!(await cheatQuiet(page, '~maxme'))) {
        fail('could not max stats');
    }

    if (stage !== undefined && !(await cheatQuiet(page, `setvar princequest ${stage}`))) {
        fail('could not set princequest');
    }
    if (keystatus !== undefined && !(await cheatQuiet(page, `setvar prince_keystatus ${keystatus}`))) {
        fail('could not set prince_keystatus');
    }
    if (stage !== undefined || keystatus !== undefined) {
        // The quest-tab colour is pushed by if_setcolour; only the login script's
        // ~update_questlist re-derives it after a setvar.
        await relog(page, user);
        const got = await getServerVarQuiet(page, 'princequest');
        console.log(`jumped to princequest=${got} keystatus=${keystatus ?? '(unset)'} and relogged`);
    }

    await seedBank(page, bankCoins);

    // After the relog and the bank trip, so nothing is lost in either.
    for (const pair of give.split(',').map(s => s.trim()).filter(Boolean)) {
        const [obj, n] = pair.split(':');
        if (!(await cheatQuiet(page, `give ${obj} ${Number(n) || 1}`))) {
            fail(`could not give ${pair}`);
        }
        console.log(`gave ${pair}`);
    }

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'prince'));
    await startScript(page, 'AIOQuester');
    console.log('started AIOQuester — watching');

    const deadline = Date.now() + minutes * 60_000;
    let lastLogTime = 0;
    let last: SoloSnapshot | null = null;
    while (Date.now() < deadline) {
        last = await page.evaluate((): SoloSnapshot => {
            const g = globalThis as never as {
                __rs2b0t: {
                    reader: { worldTile(): { x: number; z: number; level: number } | null };
                    Quests: { status(n: string): string; points(): number };
                };
                rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
            };
            return {
                pos: g.__rs2b0t.reader.worldTile(),
                status: g.__rs2b0t.Quests.status('Prince Ali Rescue'),
                qp: g.__rs2b0t.Quests.points(),
                runner: g.rs2b0t.runner.state,
                logs: (g.rs2b0t.runner.ctx?.log ?? []).slice(-60)
            };
        });
        const pos = last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?';
        console.log(`  t=${stamp()} pos=${pos} status=${last.status} qp=${last.qp} runner=${last.runner}`);
        for (const line of last.logs) {
            if (line.time > lastLogTime) {
                console.log(`      · [${line.level}] ${line.msg}`);
            }
        }
        if (last.logs.length > 0) {
            lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time));
        }
        if (last.status === 'complete' || last.runner !== 'running') {
            break;
        }
        await page.waitForTimeout(10_000);
    }

    if (!last) {
        fail('no snapshot');
    }
    const finalStage = await getServerVarQuiet(page, 'princequest');
    console.log(`END status=${last.status} princequest=${finalStage} qp=${last.qp} runner=${last.runner}`);
} finally {
    await browser.close();
}

function deployBundle(): void {
    const engine = process.env.ENGINE_DIR ?? `${homedir()}/code/lostcity-dev/engine`;
    const botDir = `${engine}/public/bot`;
    if (!existsSync(botDir)) {
        fail(`deploy: ${botDir} not found — set ENGINE_DIR to the engine serving ${base}`);
    }
    const build = Bun.spawnSync(['bun', 'run', 'build:bot'], { stdout: 'pipe', stderr: 'pipe' });
    if (build.exitCode !== 0) {
        fail(`deploy: build:bot failed\n${build.stderr.toString()}`);
    }
    const copy = Bun.spawnSync(['sh', '-c', `cp out/botclient.js out/botclient.js.map "${botDir}/"`]);
    if (copy.exitCode !== 0) {
        fail(`deploy: could not copy the bundle into ${botDir}`);
    }
    console.log(`deploy: fresh botclient.js -> ${botDir}`);
}

async function seedBank(page: Page, coins: number): Promise<void> {
    if (coins <= 0) {
        return;
    }
    const cheatTele = `tele 0,${DRAYNOR_BANK.x >> 6},${DRAYNOR_BANK.z >> 6},${DRAYNOR_BANK.x & 63},${DRAYNOR_BANK.z & 63}`;
    if (!(await cheatQuiet(page, cheatTele))) {
        fail('seedBank: tele to the Draynor bank failed');
    }
    await page.waitForTimeout(2000);
    if (!(await cheatQuiet(page, `give coins ${coins}`))) {
        fail('seedBank: give coins failed');
    }

    // Execution.* throws outside a running script, so the deposit runs as a bot.
    await page.evaluate(
        ([stand, id]) => {
            const g = globalThis as never as {
                __rs2b0t: {
                    LoopingBot: new () => object;
                    registerScript(meta: { name: string; create: () => unknown }): void;
                    Bank: {
                        isOpen(): boolean;
                        loaded(): boolean;
                        openBooth(t: unknown, name: string, op: string, log?: (m: string) => void): Promise<boolean>;
                        openNearest(name: string, op: string, log?: (m: string) => void): Promise<boolean>;
                        depositAllMatching(m: (name: string, id: number) => boolean): Promise<void>;
                        close(): Promise<boolean>;
                        countById(i: number): number;
                    };
                    Execution: { delayUntil(c: () => boolean, ms: number): Promise<boolean>; delayTicks(n: number): Promise<void> };
                };
                rs2b0t: { runner: { start(meta: unknown): void }; registry: { get(name: string): unknown } };
                __paSeed?: SeedResult;
            };
            const abi = g.__rs2b0t;
            g.__paSeed = { done: false, ok: false, reason: '', banked: 0 };

            class SeedBankBot extends abi.LoopingBot {
                private ran = false;

                async loop(): Promise<number> {
                    if (this.ran) {
                        return 5000;
                    }
                    this.ran = true;
                    const res = g.__paSeed!;
                    try {
                        const { Bank, Execution } = abi;
                        const opened =
                            (await Bank.openBooth(stand, 'Bank booth', 'Use-quickly'))
                            || (await Bank.openNearest('Bank booth', 'Use-quickly'));
                        if (!opened) {
                            res.reason = 'could not open the bank';
                            res.done = true;
                            return 5000;
                        }
                        await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 5000);
                        await Execution.delayTicks(1);
                        await Bank.depositAllMatching((_name, objId) => objId === id);
                        await Execution.delayUntil(() => Bank.loaded() || !Bank.isOpen(), 4000);
                        await Execution.delayTicks(1);
                        res.banked = Bank.countById(id);
                        await Bank.close();
                        res.ok = res.banked > 0;
                        res.reason = res.ok ? '' : 'coins never landed in the bank';
                    } catch (e) {
                        res.reason = `threw: ${String(e)}`;
                    }
                    res.done = true;
                    return 5000;
                }
            }

            abi.registerScript({ name: 'PaSeedBank', create: () => new SeedBankBot() });
            g.rs2b0t.runner.start(g.rs2b0t.registry.get('PaSeedBank'));
        },
        [DRAYNOR_BANK, COINS_ID] as const
    );

    await page
        .waitForFunction(() => (globalThis as never as { __paSeed?: SeedResult }).__paSeed?.done === true, undefined, {
            timeout: 60_000
        })
        .catch(() => undefined);
    const res = await page.evaluate(() => (globalThis as never as { __paSeed?: SeedResult }).__paSeed ?? null);
    // The seed bot keeps looping, and the runner refuses to start a second script.
    await page.evaluate(() => {
        try {
            (globalThis as never as { rs2b0t: { runner: { stop(reason: string): void } } }).rs2b0t.runner.stop('harness stop');
        } catch {
            /* already stopped */
        }
    });
    await page.waitForTimeout(600);
    if (!res?.ok) {
        fail(`seedBank: ${res?.reason ?? 'no result'}`);
    }
    console.log(`seedBank: ${res.banked} coins in the bank, nothing else`);
}
