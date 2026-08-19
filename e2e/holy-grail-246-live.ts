/** Live Holy Grail harness (#246): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` writes `%grail` and relogs, since `update_questlist` only recolours the list at login and the module reads the list before the journal.
 *  Why: the bank holds coins, food and a melee kit and nothing else — Excalibur is bought back from the Lady of the Lake, the napkin comes from Galahad and the whistles from Draynor Manor, so a pass proves the bot can find all three.
 *  Why: stages from 8 up seed the napkin, as neither Galahad branch hands out a replacement once Percival is the errand. */

//   HEADED=1 bun e2e/holy-grail-246-live.ts --stage 0 --until 10 --minutes 120 --tick 200
//   HEADED=1 bun e2e/holy-grail-246-live.ts --stage 4 --until 8 --minutes 45 --tick 200
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
        user: `hg${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 10,
        minutes: 120,
        tickMs: 300,
        food: 'Lobster',
        stats: 70,
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

const QUEST = 'Holy Grail';
/** `^arthur_complete` — Merlin's Crystal, the quest's only prerequisite. */
const ARTHUR_COMPLETE = 7;
/** `%grail` values from quest_grail.constant; 1, 5 and 6 are unused. */
const STAGES = [0, 2, 3, 4, 7, 8, 9, 10];

const CATHERBY_BANK = { x: 2809, z: 3441, level: 0 };
const DRAYNOR_BANK = { x: 3093, z: 3243, level: 0 };
const SEERS_BANK = { x: 2725, z: 3491, level: 0 };
const FALADOR_WEST_BANK = { x: 2946, z: 3369, level: 0 };

/** Where each stage's first errand is, so the walk under test is the short one. */
const STAGE_START: Record<number, { x: number; z: number; level: number }> = {
    0: CATHERBY_BANK,
    2: CATHERBY_BANK,
    3: DRAYNOR_BANK,
    4: SEERS_BANK,
    7: SEERS_BANK,
    8: FALADOR_WEST_BANK,
    9: FALADOR_WEST_BANK
};

/**
 * Coins, food and a melee kit. Excalibur, the napkin, the whistles and the bell
 * all have a source in the world, and banking one would hide whether the bot
 * can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 },
    // Why: rune platebody wants Dragon Slayer complete, and the refusal is a bare false.
    { debugName: 'rune_chainbody', displayName: 'Rune chainbody', qty: 1 },
    { debugName: 'rune_platelegs', displayName: 'Rune platelegs', qty: 1 },
    { debugName: 'rune_full_helm', displayName: 'Rune full helm', qty: 1 },
    { debugName: 'rune_kiteshield', displayName: 'Rune kiteshield', qty: 1 }
];

/** Past stage 7 no Galahad branch replaces a lost napkin, so a jumped run is handed one. */
const NAPKIN_SEED: BankSeedItem = { debugName: 'holy_table_napkin', displayName: 'Holy table napkin', qty: 1 };

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

if (!STAGES.includes(args.stage)) {
    fail(`--stage must be one of ${STAGES.join(', ')} (the values quest_grail.constant uses)`);
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

    const seed = args.stage >= 8 ? [...BANK_SEED, NAPKIN_SEED] : BANK_SEED;
    console.log(`seeding ${seed.length} item type(s) into the Catherby bank`);
    await seedItemsToBank(page, seed, CATHERBY_BANK);

    await cheatQuiet(page, `setvar arthur ${ARTHUR_COMPLETE}`);
    const arthur = await getServerVarQuiet(page, 'arthur');
    if (arthur !== ARTHUR_COMPLETE) {
        fail(`setvar arthur did not take (${arthur}/${ARTHUR_COMPLETE}) — Holy Grail cannot start without Merlin's Crystal`);
    }
    if (args.stage > 0) {
        await cheatQuiet(page, `setvar grail ${args.stage}`);
        const grail = await getServerVarQuiet(page, 'grail');
        if (grail !== args.stage) {
            fail(`setvar grail did not take (${grail}/${args.stage})`);
        }
    }
    console.log(`%arthur=${arthur} %grail=${args.stage}`);
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');

    const start = STAGE_START[args.stage] ?? CATHERBY_BANK;
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'grail'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for %grail to reach ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        // Why: the engine serves one bundle to everyone, so a session that deploys between this deploy and the page load hands the run its own branch — and a queue without Holy Grail in it spends the budget on somebody else's quest.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the loaded bundle has no ${QUEST} — another session redeployed over it (${queue.msg})`);
            }
        }
        const grail = (await getServerVarQuiet(page, 'grail')) ?? 0;
        reached = Math.max(reached, grail);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` %grail=${grail} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // Why: a full run waits for the list to go green as well — the recolour and the QP award land a tick behind %grail.
        const done = args.until >= 10 ? last.status === 'complete' : grail >= args.until;
        if (done) {
            console.log(`PASS (%grail=${grail}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at %grail=${grail} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`%grail reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
