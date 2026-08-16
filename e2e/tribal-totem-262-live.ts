/** Live Tribal Totem harness (#262): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` is `%totemquest` itself (0 not started … 4 teleported inside, 5 complete), because every stage of this quest is one server varp and the journal renders straight off it; it relogs after a jump since update_questlist only recolours the list at login.
 *  Why: `--combo` sets bit 0 of `%handelmort_traps_disabled` to skip the KURT lock, and the stairs trap bit is deliberately never seeded — a run that does not Investigate them falls into the Ardougne sewers, which is the thing worth proving.
 *  Why: stats are 70 across the board rather than max, and the bank holds coins and lobsters alone — the label, the totem and the ferry fare all have to be sourced by the bot. */

//   HEADED=1 bun e2e/tribal-totem-262-live.ts --stage 0 --until 5 --minutes 60 --tick 200
//   HEADED=1 bun e2e/tribal-totem-262-live.ts --stage 4 --until 5 --minutes 20 --tick 200
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
    combo: boolean;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `tt${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 5,
        minutes: 60,
        tickMs: 300,
        food: 'Lobster',
        stats: 70,
        combo: false,
        deploy: true
    };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        if (flag === '--no-deploy') { out.deploy = false; continue; }
        if (flag === '--combo') { out.combo = true; continue; }
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

const QUEST = 'Tribal Totem';
const ARDOUGNE_BANK = { x: 2655, z: 3283, level: 0 };
/** Cromperty's block lands here once the R.P.D.T. have delivered the crate. */
const MANSION_LANDING = { x: 2638, z: 3321, level: 0 };

/**
 * Coins and food only. The address label comes off a crate the bot has to find,
 * and the ferry fare comes out of the engine's own coin float.
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
 *  Why: the transport graph compiles into navworker.js, a separate entrypoint — deploying only botclient.js leaves the navigator on the old edges, and this quest ships a new one for the mansion door. */
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
    fail('--stage is %totemquest and runs 0 to 4');
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

    if (args.stage > 0 || args.combo) {
        const traps = args.combo ? 1 : 0;
        await cheatQuiet(page, `setvar totemquest ${args.stage}`);
        await cheatQuiet(page, `setvar handelmort_traps_disabled ${traps}`);
        const readQuest = await getServerVarQuiet(page, 'totemquest');
        const readTraps = await getServerVarQuiet(page, 'handelmort_traps_disabled');
        console.log(`totemquest=${readQuest} handelmort_traps_disabled=${readTraps}`);
        if (readQuest !== args.stage || readTraps !== traps) {
            fail(`setvar did not take (totemquest ${readQuest}/${args.stage}, traps ${readTraps}/${traps})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    // Why: nothing walks into the mansion, so a stage-4 resume has to start inside it — every earlier stage starts at the bank the module provisions from.
    const start = args.stage >= 4 ? MANSION_LANDING : ARDOUGNE_BANK;
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'totem'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for ${args.until >= 5 ? 'the journal to go green' : `%totemquest ${args.until}`}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        // Why: the engine serves one bundle to everyone, so a session that deploys between this deploy and the page load hands the run its own branch — and a queue without Tribal Totem in it spends the budget on somebody else's quest.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the loaded bundle has no ${QUEST} — another session redeployed over it (${queue.msg})`);
            }
        }
        const totemquest = (await getServerVarQuiet(page, 'totemquest')) ?? 0;
        const traps = (await getServerVarQuiet(page, 'handelmort_traps_disabled')) ?? 0;
        reached = Math.max(reached, totemquest);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` totemquest=${totemquest}/5 door=${(traps & 1) !== 0 ? 'open' : 'locked'}`
            + ` trap=${(traps & (1 << 21)) !== 0 ? 'noted' : 'live'}`
            + ` journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // Why: a full run waits for the list to go green rather than the varp — the recolour and the QP award land a tick behind %totemquest.
        const done = args.until >= 5 ? last.status === 'complete' : totemquest >= args.until;
        if (done) {
            console.log(`PASS (totemquest=${totemquest}/5, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at %totemquest ${totemquest} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`%totemquest reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
