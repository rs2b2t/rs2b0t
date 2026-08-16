/** Live Monk's Friend harness (#240): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` is the raw `%drunkmonkquest` value and relogs after seeding it, because `update_questlist` only recolours the list at login — and the same login script re-arms the `blanket_ladder` timer, which is what puts the hidden ladder back inside the ring of stones.
 *  Why: stats are 70 and the bank holds coins and food alone, so the jug, the sink, the axe and the logs are all sourced in the world. */

//   HEADED=1 bun e2e/monks-friend-240-live.ts --stage 0 --until 80 --minutes 45 --tick 200
//   HEADED=1 bun e2e/monks-friend-240-live.ts --stage 40 --until 70 --minutes 20 --tick 200
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
        user: `mf${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 80,
        minutes: 45,
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

const QUEST = "Monk's Friend";
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };
/** `%drunkmonkquest` values from quest_drunkmonk.constant, plus complete. */
const STAGES = [0, 10, 20, 30, 40, 50, 60, 70, 80];

/**
 * Coins and food only. The jug comes from Port Khazard's general store, the water
 * from the guardhouse sink, the axe from Aemad's and the logs from a forest tree —
 * banking any of them would hide whether the bot can find its own.
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

if (!STAGES.includes(args.stage) || args.stage === 80) {
    fail(`--stage is a %drunkmonkquest value: ${STAGES.filter(s => s !== 80).join(', ')}`);
}
if (!STAGES.includes(args.until) || args.until <= args.stage) {
    fail(`--until is a %drunkmonkquest value above --stage: ${STAGES.join(', ')}`);
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

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Ardougne East bank`);
    await seedItemsToBank(page, BANK_SEED, ARDOUGNE_BANK);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar drunkmonkquest ${args.stage}`);
        const read = await getServerVarQuiet(page, 'drunkmonkquest');
        if (read !== args.stage) {
            fail(`setvar did not take (drunkmonkquest ${read}/${args.stage})`);
        }
        console.log(`drunkmonkquest=${read}`);
        // Why: the login script recolours the quest list AND re-arms `blanket_ladder`, so a seeded stage 10 has no hidden ladder until the relog.
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
        await cheatQuiet(page, `speed ${args.tickMs}`);
    }

    if (!(await teleTo(page, ARDOUGNE_BANK, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, ARDOUGNE_BANK, 10, 25_000))) {
            fail(`tele to ${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z} did not arrive`);
        }
    }
    console.log(`start tile → ${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z},${ARDOUGNE_BANK.level}`);

    // The setting is the record id; an unknown entry is filtered out and the queue silently becomes every quest.
    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'drunkmonk'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ${args.until >= 80 ? 'the journal to go green' : `stage ${args.until}`}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        // Why: the engine serves one bundle to everyone, so a session that deploys between this deploy and the page load hands the run its own branch — and a queue without Monk's Friend in it spends the budget on somebody else's quest.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the loaded bundle has no ${QUEST} — another session redeployed over it (${queue.msg})`);
            }
        }
        const stage = (await getServerVarQuiet(page, 'drunkmonkquest')) ?? 0;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` stage=${stage}/${args.until} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // Why: a full run waits for the list to go green rather than the varp — the recolour and the QP award land a tick behind %drunkmonkquest.
        const done = args.until >= 80 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (stage=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at stage ${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`stage reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
