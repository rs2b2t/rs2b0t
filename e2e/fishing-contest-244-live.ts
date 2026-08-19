/** Live Fishing Contest harness (#244): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` writes `%fishingcompo` and the two companion varps together — the contest stage and the fee/catch counter have to agree or Bonzo re-seats a contest the journal says is already under way — then relogs, since update_questlist only recolours the list at login.
 *  Why: the bank holds coins and food alone, so the garlic, the spade, the rod and the worms are all sourced in the world; stats are max because the road crosses White Wolf Mountain.
 *  Why: it deploys its own copy of the client through `deployIsolatedClient`, so a neighbouring harness cannot decide mid-boot which branch this run exercises. */

//   HEADED=1 bun e2e/fishing-contest-244-live.ts --stage 0 --until 5 --minutes 90 --tick 150
//   HEADED=1 bun e2e/fishing-contest-244-live.ts --stage 2 --until 4 --minutes 20 --tick 150
//   HEADED=1 bun e2e/fishing-contest-244-live.ts --stage 3 --until 4 --minutes 30 --tick 150
import type { Page } from 'playwright-core';

import { deployIsolatedClient, launchBrowser } from './lib/harness.js';
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
        user: `fc${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 5,
        minutes: 75,
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

const QUEST = 'Fishing Contest';
const DRAYNOR_BANK = { x: 3093, z: 3243, level: 0 };
const CATHERBY_BANK = { x: 2809, z: 3441, level: 0 };

/**
 * Coins and food only. Every quest item has a source in the world — the clove in
 * Draynor, the spade in Falador, the rod at Harry's and the worms in McGrubor's
 * Wood — and banking one would hide whether the bot can find it.
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

/** `%hemenster_comp_stage`: 0 not entered, 1 fee paid, 4 three fish caught. */
const COMP_PAID = 1;

/** The varps a jumped stage has to write together, and what the pack needs to match. */
function seedFor(stage: number): { vars: [string, number][]; items: [string, number][] } {
    if (stage <= 0) {
        return { vars: [], items: [] };
    }
    const vars: [string, number][] = [['fishingcompo', stage]];
    const items: [string, number][] = [['fishing_competition_pass', 1]];
    if (stage === 2 || stage === 3) {
        vars.push(['hemenster_comp_stage', COMP_PAID]);
    }
    // Why: a character at this stage has paid the fee and is standing in the contest holding
    // its kit — sourcing that kit is stage 0 and 1's job, and making this leg walk to Draynor
    // for a clove buries the stash it exists to test under a fifteen-minute round trip.
    if (stage === 2) {
        items.push(['garlic', 1], ['fishing_rod', 1], ['red_vine_worm', 5]);
    }
    // Why: the pipe flag is what makes Bonzo re-seat a re-entry beside the pipes, so a stage-3 jump that omits it cannot recover from a lost round.
    if (stage === 3) {
        vars.push(['hemenster_pipe_stashed', 1]);
    }
    if (stage >= 4) {
        items.push(['hemenster_fishing_trophy', 1]);
    }
    return { vars, items };
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

if (args.stage < 0 || args.stage > 4) {
    fail('--stage is the %fishingcompo value and runs 0 to 4');
}

// Why: this run gets its own copy of the client — all of `out/`, so the navworker and the collision pack travel with it — and a neighbouring harness deploying mid-boot cannot decide which branch this one exercises.
const client = args.deploy ? deployIsolatedClient(args.user) : null;
const clientPage = client?.page ?? '/bot.html';
// Why: a PASS leaves through `process.exit`, which skips `finally`, so the sweep hangs off the exit itself.
process.on('exit', () => client?.cleanup());

// Why: past the entry fee the quest never leaves Kandarin, so a jumped run starts at the bank it would have used.
const START = args.stage >= 2 ? CATHERBY_BANK : DRAYNOR_BANK;

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

    await mainlandAccount(page, args.base, args.user, clientPage);
    console.log(`mainland-ready as '${args.user}'`);

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    await setStats(page, args.stats);
    console.log(`stats: ${args.stats} across the board`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the bank at ${START.x},${START.z}`);
    await seedItemsToBank(page, BANK_SEED, START);

    const { vars, items } = seedFor(args.stage);
    if (vars.length > 0) {
        for (const [name, value] of vars) {
            await cheatQuiet(page, `setvar ${name} ${value}`);
        }
        for (const [debugName, qty] of items) {
            await cheatQuiet(page, `give ${debugName} ${qty}`);
        }
        for (const [name, value] of vars) {
            const read = await getServerVarQuiet(page, name);
            console.log(`${name}=${read}`);
            if (read !== value) {
                fail(`setvar did not take (${name} ${read}/${value})`);
            }
        }
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

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'fishingcompo'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for %fishingcompo to reach ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = args.stage;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        // Why: this should not fire now that the client is per-run, so if it ever does the isolation broke rather than a neighbour winning a race.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the loaded bundle has no ${QUEST} — the per-run client isolation broke (${queue.msg})`);
            }
        }
        const stage = (await getServerVarQuiet(page, 'fishingcompo')) ?? 0;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` fishingcompo=${stage}/${args.until} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // Why: a full run waits for the list to go green rather than the varp — the recolour and the QP award land a tick behind %fishingcompo.
        const done = args.until >= 5 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (fishingcompo=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at %fishingcompo=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`%fishingcompo reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
