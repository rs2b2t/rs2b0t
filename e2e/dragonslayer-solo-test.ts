// Dragon Slayer, one quest at a time: --stage N --var N --oracle N --shield N --goblin N --give --speed 300.
// Why: `~update_questlist` recounts %qp from completed quests at login, so `qp` is set after the last relog; --give is for wedges, since seeding a stage's items proves nothing about the stages before it.

//   bun e2e/dragonslayer-solo-test.ts                     uncheated 0 -> complete
//   bun e2e/dragonslayer-solo-test.ts --stage 2           jump to "spoken to Oziach"
//   bun e2e/dragonslayer-solo-test.ts --stage 3 --var 2   ... with 2 of 3 hull holes patched
//   bun e2e/dragonslayer-solo-test.ts --stage 2 --oracle 3 --shield 1 --goblin 1
//   bun e2e/dragonslayer-solo-test.ts --speed 100         server ms/tick, default 300
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
const user = opt('--user') ?? `ds${Date.now().toString(36).slice(-7)}`;
const give = opt('--give') ?? '';
const bankGive = opt('--bank') ?? '';
const bankCoins = Number(opt('--bank-coins') ?? 2_000_000);
const questPoints = Number(opt('--qp') ?? 40);
const minutes = Number(opt('--minutes') ?? 90);
const tele = opt('--tele');
const food = opt('--food') ?? 'Lobster';
const speed = Number(opt('--speed') ?? 300);

/** Every dragon-slayer server varp the harness can jump. */
const VARS: Record<string, string> = {
    '--stage': 'dragonquest',
    '--var': 'dragonquestvar',
    '--oracle': 'dragon_oracle',
    '--shield': 'dragon_shield',
    '--goblin': 'dragon_goblin',
    '--ned': 'dragon_ned_hired',
    '--wall': 'dragon_wall'
};

const FALADOR_BANK = { x: 3013, z: 3355, level: 0 };
const COINS_ID = 995;

/** Quests marked complete so ~count_questpoints returns 36 on its own, which is what opens the Champions' Guild door.
 *  Each pair is the varp and its `_complete` value; the trailing comment is the points it is worth. */
const EARNED_QP: readonly [string, number][] = [
    ['arthur', 7],       // Merlin's Crystal, 6
    ['goblinquest', 6],  // Goblin Diplomacy, 5
    ['rjquest', 100],    // Romeo & Juliet, 5
    ['haunted', 3],      // Ernest the Chicken, 4
    ['druidquest', 4],   // Druidic Ritual, 4
    ['princequest', 110],// Prince Ali Rescue, 3
    ['demonstart', 30],  // Demon Slayer, 3
    ['vampire', 3],      // Vampire Slayer, 3
    ['spy', 4]           // Black Knights' Fortress, 3
];

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

/** The server rejects anything under 20ms and ignores junk, so confirm from chat rather than assume. */
async function setSpeed(page: Page, ms: number): Promise<void> {
    if (!Number.isInteger(ms) || ms < 20) {
        fail(`--speed must be an integer >= 20 (got ${opt('--speed')})`);
    }
    await cheat(page, `speed ${ms}`);
    const confirmed = await page.evaluate(
        expected =>
            (globalThis as never as { rs2b0t: { reader: { chat(n: number): { text: string }[] } } }).rs2b0t.reader
                .chat(8)
                .some(line => line.text.includes(`World speed was changed to ${expected}ms`)),
        ms
    );
    if (!confirmed) {
        fail(`server did not confirm the ${ms}ms tick rate`);
    }
    console.log(`tick rate → ${ms}ms`);
}

// The page loads the BUILT bundle, so a source edit is invisible until it is rebuilt
// and copied into the engine's public/bot/.
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

    await setSpeed(page, speed);
    if (!(await cheatQuiet(page, '~maxme'))) {
        fail('could not max stats');
    }

    let jumped = false;
    for (const [flag, varp] of Object.entries(VARS)) {
        const value = opt(flag);
        if (value === undefined) {
            continue;
        }
        if (!(await cheatQuiet(page, `setvar ${varp} ${Number(value)}`))) {
            fail(`could not set ${varp}`);
        }
        console.log(`setvar ${varp} ${value}`);
        jumped = true;
    }
    if (jumped) {
        // The quest-tab colour is pushed by if_setcolour; only the login script's
        // ~update_questlist re-derives it after a setvar.
        await relog(page, user);
        console.log(`relogged at dragonquest=${await getServerVarQuiet(page, 'dragonquest')}`);
    }

    await seedBank(page, bankCoins, bankGive);

    // After the relog and the bank trip, so nothing is lost in either.
    for (const pair of give.split(',').map(s => s.trim()).filter(Boolean)) {
        const [obj, n] = pair.split(':');
        if (!(await cheatQuiet(page, `give ${obj} ${Number(n) || 1}`))) {
            fail(`could not give ${pair}`);
        }
        console.log(`gave ${pair}`);
    }

    // Why: ~send_quest_progress recounts %qp the moment the Guild master starts Dragon Slayer, so a cheated value collapses mid-run and drops the bot for failing its own entry requirement.
    // Why: ~completequests opens two choice dialogs nothing here answers (a gang for Shield of Arrav, a side for Temple of Ikov) and completes nothing, so these nine varps worth 36 are set one at a time.
    if (questPoints > 0) {
        for (const [varp, value] of EARNED_QP) {
            if (!(await cheatQuiet(page, `setvar ${varp} ${value}`))) {
                fail(`could not complete ${varp} for the point gate`);
            }
        }
        await relog(page, user);
    }
    const earned = await getServerVarQuiet(page, 'qp');
    console.log(`qp=${earned} (earned, survives the recount)`);
    if ((earned ?? 0) < 32) {
        fail(`only ${earned} quest points — the Champions' Guild needs 32`);
    }

    if (tele) {
        if (!(await cheatQuiet(page, `tele ${tele}`))) {
            fail(`could not tele ${tele}`);
        }
        console.log(`teleported to ${tele}`);
        await page.waitForTimeout(3000);
    }

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'dragon'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), food);
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
                status: g.__rs2b0t.Quests.status('Dragon Slayer'),
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
    const finalStage = await getServerVarQuiet(page, 'dragonquest');
    console.log(`END status=${last.status} dragonquest=${finalStage} qp=${last.qp} runner=${last.runner}`);
    if (last.status !== 'complete') {
        fail(`Dragon Slayer not complete (status=${last.status}, dragonquest=${finalStage})`);
    }
    console.log('PASS');
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

/** Coins plus anything --bank asked for, banked at Falador so the quest starts from the bank. */
async function seedBank(page: Page, coins: number, extras: string): Promise<void> {
    const gives = extras.split(',').map(s => s.trim()).filter(Boolean);
    if (coins <= 0 && gives.length === 0) {
        return;
    }
    const cheatTele = `tele 0,${FALADOR_BANK.x >> 6},${FALADOR_BANK.z >> 6},${FALADOR_BANK.x & 63},${FALADOR_BANK.z & 63}`;
    if (!(await cheatQuiet(page, cheatTele))) {
        fail('seedBank: tele to the Falador bank failed');
    }
    await page.waitForTimeout(2000);
    if (coins > 0 && !(await cheatQuiet(page, `give coins ${coins}`))) {
        fail('seedBank: give coins failed');
    }
    for (const pair of gives) {
        const [obj, n] = pair.split(':');
        if (!(await cheatQuiet(page, `give ${obj} ${Number(n) || 1}`))) {
            fail(`seedBank: give ${pair} failed`);
        }
        console.log(`bank-seed: ${pair}`);
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
                __dsSeed?: SeedResult;
            };
            const abi = g.__rs2b0t;
            g.__dsSeed = { done: false, ok: false, reason: '', banked: 0 };

            class SeedBankBot extends abi.LoopingBot {
                private ran = false;

                async loop(): Promise<number> {
                    if (this.ran) {
                        return 5000;
                    }
                    this.ran = true;
                    const res = g.__dsSeed!;
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
                        await Bank.depositAllMatching(() => true);
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

            abi.registerScript({ name: 'DsSeedBank', create: () => new SeedBankBot() });
            g.rs2b0t.runner.start(g.rs2b0t.registry.get('DsSeedBank'));
        },
        [FALADOR_BANK, COINS_ID] as const
    );

    await page
        .waitForFunction(() => (globalThis as never as { __dsSeed?: SeedResult }).__dsSeed?.done === true, undefined, {
            timeout: 60_000
        })
        .catch(() => undefined);
    const res = await page.evaluate(() => (globalThis as never as { __dsSeed?: SeedResult }).__dsSeed ?? null);
    await page.evaluate(() => {
        try {
            (globalThis as never as { rs2b0t: { runner: { stop(reason: string): void } } }).rs2b0t.runner.stop('harness stop');
        } catch {
            // the seed bot may already have stopped itself
        }
    });
    await page.waitForTimeout(1500);
    if (!res?.ok) {
        fail(`seedBank: ${res?.reason ?? 'no result'}`);
    }
    console.log(`bank seeded: ${res.banked} coins`);
}
