/** Live Pirate's Treasure harness (#231): --stage/--employed/--crate-rum/--crate-bananas, base :8890.
 *  Why: the smuggle state lives in three varps the client cannot read, so a stage number alone reaches only a third of the quest; every seed relogs because update_questlist recolours the journal at login only; the bank holds coins and food alone so the rum, apron and spade are sourced in the world; the :8888 sim answers neither `givebank` nor `~bankitem`. */

//   HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 0 --until 4 --minutes 120
//   HEADED=1 bun e2e/piratestreasure-231-live.ts --stage 1 --employed 2 --crate-rum 2 --until 2
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import type { Page } from 'playwright-core';

import { launchBrowser } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    getServerVarQuiet,
    mainlandAccount,
    relog,
    seedItemsToBank,
    startScript,
    teleTo,
    type BankSeedItem
} from './tutorial/harness.js';

interface Args {
    base: string;
    user: string;
    stage: number;
    employed: number;
    crateRum: number;
    crateBananas: number;
    until: number;
    minutes: number;
    tickMs: number;
    food: string;
    stats: number;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `pt${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        employed: 0,
        crateRum: 0,
        crateBananas: 0,
        until: 4,
        minutes: 120,
        tickMs: 300,
        food: 'Lobster',
        stats: 99,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        const value = argv[++i];
        if (value === undefined) { break; }
        if (flag === '--base') { out.base = value; }
        else if (flag === '--user') { out.user = value; }
        else if (flag === '--stage') { out.stage = Number(value); }
        else if (flag === '--employed') { out.employed = Number(value); }
        else if (flag === '--crate-rum') { out.crateRum = Number(value); }
        else if (flag === '--crate-bananas') { out.crateBananas = Number(value); }
        else if (flag === '--until') { out.until = Number(value); }
        else if (flag === '--minutes') { out.minutes = Number(value); }
        else if (flag === '--tick') { out.tickMs = Number(value); }
        else if (flag === '--food') { out.food = value; }
        else if (flag === '--stats') { out.stats = Number(value); }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = "Pirate's Treasure";
const DRAYNOR_BANK = { x: 3093, z: 3243, level: 0 };

/**
 * Coins and food only. The rum, the white apron and the spade all have sources in
 * the world, and banking one would hide whether the bot can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

const STATS = [
    'attack', 'strength', 'defence', 'hitpoints', 'ranged', 'magic', 'prayer',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

async function setStats(page: Page, level: number): Promise<void> {
    for (const skill of STATS) {
        await cheatQuiet(page, `setstat ${skill} ${level}`);
    }
    await clearChatDialogs(page, 'level-up dialog(s)');
    await page.waitForTimeout(1500);
    await clearChatDialogs(page, 'straggler dialog(s)');
}

/** Every seeded state starts at Draynor bank, the nearest booth to Port Sarim. */
const START = DRAYNOR_BANK;

interface Snapshot {
    pos: { x: number; z: number; level: number } | null;
    status: string;
    qp: number;
    runner: string;
    logs: { time: number; level: string; msg: string }[];
}

async function snapshot(page: Page): Promise<Snapshot> {
    return page.evaluate(quest => {
        const g = globalThis as never as {
            __rs2b0t: {
                reader: { worldTile(): { x: number; z: number; level: number } | null };
                Quests: { status(n: string): string; points(): number };
            };
            rs2b0t: { runner: { state: string; ctx?: { log?: { time: number; level: string; msg: string }[] } } };
        };
        const ring = g.rs2b0t.runner.ctx?.log ?? [];
        return {
            pos: g.__rs2b0t.reader.worldTile(),
            status: g.__rs2b0t.Quests.status(quest),
            qp: g.__rs2b0t.Quests.points(),
            runner: g.rs2b0t.runner.state,
            logs: ring.slice(-80).map(l => ({ time: l.time, level: l.level, msg: l.msg }))
        };
    }, QUEST);
}

/** A live run loads the deployed bundles, never the working tree.
 *  Why: the transport graph compiles into navworker.js, a separate entrypoint — deploying only botclient.js leaves the navigator on the old edges and every route reports "unreachable". */
const DEPLOYED = ['botclient.js', 'botclient.js.map', 'navworker.js', 'navworker.js.map'];

function deployBundle(): void {
    const engine = process.env.ENGINE_DIR ?? `${homedir()}/code/rs2b2t-engine`;
    const botDir = `${engine}/public/bot`;
    if (!existsSync(botDir)) {
        fail(`deploy: ${botDir} not found — set ENGINE_DIR to the engine serving ${args.base}`);
    }
    const build = Bun.spawnSync(['bun', 'run', 'build:bot'], { stdout: 'pipe', stderr: 'pipe' });
    if (build.exitCode !== 0) {
        fail(`deploy: build:bot failed\n${build.stderr.toString()}`);
    }
    const files = DEPLOYED.map(f => `out/${f}`).join(' ');
    const copy = Bun.spawnSync(['sh', '-c', `cp ${files} "${botDir}/"`]);
    if (copy.exitCode !== 0) {
        fail(`deploy: could not copy the bundles into ${botDir}`);
    }
    console.log(`deploy: fresh ${DEPLOYED.join(', ')} -> ${botDir}`);
}

async function seedVar(page: Page, name: string, want: number): Promise<void> {
    await cheatQuiet(page, `setvar ${name} ${want}`);
    const set = await getServerVarQuiet(page, name);
    console.log(`${name}=${set}`);
    if (set !== want) {
        fail(`setvar ${name} ${want} did not take (read back ${set})`);
    }
}

if (args.deploy) {
    deployBundle();
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    page.on('pageerror', e => console.log(`pageerror: ${e}`));
    page.on('console', m => {
        const txt = m.text();
        if (txt.startsWith('[bot]')) {
            console.log(`  [${Math.round((Date.now() - t0) / 1000)}s] ${txt}`);
        }
    });

    await mainlandAccount(page, args.base, args.user);
    console.log(`mainland-ready as '${args.user}'`);

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    await setStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Draynor bank`);
    await seedItemsToBank(page, BANK_SEED, DRAYNOR_BANK);

    // Why: the smuggle sub-state is three varps, and a stage jump that leaves them at zero seeds a state the server can never reach — %crate_rum = 2 with %hunt = 1 is the shipped crate, and nothing else says so.
    if (args.stage > 0 || args.employed > 0 || args.crateRum > 0 || args.crateBananas > 0) {
        await seedVar(page, 'hunt', args.stage);
        await seedVar(page, 'hunt_store_employed', args.employed);
        await seedVar(page, 'crate_rum', args.crateRum);
        await seedVar(page, 'crate_bananas', args.crateBananas);
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    if (!(await teleTo(page, START, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, START, 10, 25_000))) {
            fail(`tele to ${START.x},${START.z} did not arrive`);
        }
    }
    console.log(`start tile → ${START.x},${START.z},${START.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'hunt'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for hunt >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'hunt')) ?? -1;
        const employed = (await getServerVarQuiet(page, 'hunt_store_employed')) ?? -1;
        const crateRum = (await getServerVarQuiet(page, 'crate_rum')) ?? -1;
        const bananas = (await getServerVarQuiet(page, 'crate_bananas')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` hunt=${stage} employed=${employed} rum=${crateRum} bananas=${bananas}`
            + ` journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // A full run waits for the journal to go green, not the varp: the
        // quest-complete recolour and the QP award land a tick behind %hunt.
        const done = args.until >= 4 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (hunt=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at hunt=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`hunt reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
