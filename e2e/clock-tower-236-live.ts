/** Live Clock Tower harness (#236): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` counts cogs already on their spindles rather than the raw varp, because `%cogquest` and `%cog_bits` have to move together or the journal and the world disagree; it relogs since update_questlist only recolours the list at login.
 *  Why: stats are max — ogres stand over the red cog and turn aggressive under 106 combat — and the bank holds coins and food alone, so the bucket, the water and the poison are all sourced in the world. */

//   HEADED=1 bun e2e/clock-tower-236-live.ts --stage 0 --until 5 --minutes 60 --tick 200
//   HEADED=1 bun e2e/clock-tower-236-live.ts --stage 3 --until 4 --minutes 25 --tick 200
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
        user: `ct${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 5,
        minutes: 60,
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

const QUEST = 'Clock Tower';
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };

/**
 * Coins and food only. The bucket, its water and the rat poison all have a
 * source in the world, and banking one would hide whether the bot can find it.
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

/** `%cog_bits`: bit 0 is the black cog cooled, bits 1-4 are blue, black, white, red. */
const COG_BIT: Record<string, number> = { blue: 1, black: 2, white: 3, red: 4 };
/** The module's own fetch order, so a jumped stage matches what an uncheated run would have done by then. */
const PLACED_ORDER = ['black', 'red', 'blue', 'white'];

function cogBitsFor(placed: number): number {
    // Why: seeding black as placed implies the cog was cooled, and a bot that finds the bit clear pours a second bucket.
    let bits = placed > 0 ? 1 : 0;
    for (const colour of PLACED_ORDER.slice(0, placed)) {
        bits |= 1 << COG_BIT[colour];
    }
    return bits;
}

function placedCount(cogquest: number): number {
    const step = cogquest & 0xf;
    return step <= 1 ? 0 : Math.min(step - 1, 4);
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

if (args.stage < 0 || args.stage > 4) {
    fail('--stage counts placed cogs and runs 0 to 4');
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
        const cogquest = 1 + args.stage;
        const bits = cogBitsFor(args.stage);
        await cheatQuiet(page, `setvar cogquest ${cogquest}`);
        await cheatQuiet(page, `setvar cog_bits ${bits}`);
        const readQuest = await getServerVarQuiet(page, 'cogquest');
        const readBits = await getServerVarQuiet(page, 'cog_bits');
        console.log(`cogquest=${readQuest} cog_bits=${readBits} (${args.stage} cog(s) placed)`);
        if (readQuest !== cogquest || readBits !== bits) {
            fail(`setvar did not take (cogquest ${readQuest}/${cogquest}, cog_bits ${readBits}/${bits})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    if (!(await teleTo(page, ARDOUGNE_BANK, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, ARDOUGNE_BANK, 10, 25_000))) {
            fail(`tele to ${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z} did not arrive`);
        }
    }
    console.log(`start tile → ${ARDOUGNE_BANK.x},${ARDOUGNE_BANK.z},${ARDOUGNE_BANK.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'cog'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ${args.until >= 5 ? 'the journal to go green' : `${args.until} cog(s) placed`}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        // Why: the engine serves one bundle to everyone, so a session that deploys between this deploy and the page load hands the run its own branch — and a queue without Clock Tower in it spends the budget on somebody else's quest.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the loaded bundle has no ${QUEST} — another session redeployed over it (${queue.msg})`);
            }
        }
        const cogquest = (await getServerVarQuiet(page, 'cogquest')) ?? 0;
        const placed = placedCount(cogquest);
        reached = Math.max(reached, placed);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` placed=${placed}/4 rats=${(cogquest & 0x10) !== 0 ? 'dead' : 'alive'}`
            + ` journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // Why: a full run waits for the list to go green rather than the varp — the recolour and the QP award land a tick behind %cogquest.
        const done = args.until >= 5 ? last.status === 'complete' : placed >= args.until;
        if (done) {
            console.log(`PASS (placed=${placed}/4, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped with ${placed}/4 placed (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`placed reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
