/** Live Biohazard harness (#234): --stage N --until N --minutes N, base :8890.
 *  Why: `--stage` relogs because update_questlist only recolours the journal at login, and the run
 *  needs Plague City complete as well; the bank holds coins and food alone so the bird feed, the
 *  pigeons, the apples, the gown, the key and the priest suit are all sourced in the world.
 *  Why: the quest is members-only, so the :8888 sim answers neither the dialogue nor `~bankitem`. */

//   HEADED=1 bun e2e/biohazard-234-live.ts --stage 0 --until 16 --minutes 90 --tick 100
//   HEADED=1 bun e2e/biohazard-234-live.ts --stage 5 --until 7 --minutes 25 --tick 100
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
    level: number;
    food: string;
    deploy: boolean;
}

function parse(argv: string[]): Args {
    const out: Args = {
        base: process.env.BASE ?? 'http://localhost:8890',
        user: `bh${Date.now().toString(36).slice(-7)}`,
        stage: 0,
        until: 16,
        minutes: 150,
        tickMs: 300,
        level: 70,
        food: 'Lobster',
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
        else if (flag === '--level') { out.level = Number(value); }
        else if (flag === '--food') { out.food = value; }
    }
    return out;
}

const args = parse(process.argv.slice(2));

function fail(msg: string): never {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
}

const QUEST = 'Biohazard';
const PLAGUE_CITY_COMPLETE = 29;
const BIOHAZARD_COMPLETE = 16;

const ARDOUGNE_BANK = { x: 2616, z: 3332, level: 0 };
const WEST_ARDOUGNE = { x: 2529, z: 3304, level: 0 };
const RIMMINGTON = { x: 2934, z: 3211, level: 0 };

/**
 * Coins and food only. Everything else this quest carries has a source in the
 * world, and banking one hides whether the bot can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 20 }
];

const SKILLS = [
    'attack', 'defence', 'strength', 'hitpoints', 'ranged', 'prayer', 'magic',
    'cooking', 'woodcutting', 'fletching', 'fishing', 'firemaking', 'crafting',
    'smithing', 'mining', 'herblore', 'agility', 'thieving', 'runecraft'
];

/** Stages 5 to 7 are lived on the far side of the wall; 12 starts at the chemist. */
const STAGE_START: Record<number, { x: number; z: number; level: number }> = {
    5: WEST_ARDOUGNE,
    6: WEST_ARDOUGNE,
    7: WEST_ARDOUGNE,
    12: RIMMINGTON
};

// Why: a stage is seeded with what that stage produced and never with its tools — a seeded gown or
// bag of bird feed hides whether the bot can find one, and the cupboards check the bank.
const HANDED_OVER: Record<number, string[]> = {
    7: ['distillator'],
    10: ['ethenea', 'liquid_honey', 'sulphuric_broline', 'plaguesample'],
    12: ['ethenea', 'liquid_honey', 'sulphuric_broline', 'plaguesample', 'touch_paper']
};

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

// Why: `public/bot` is shared by every worktree, and a concurrent deploy landing in the boot window
// replaces navworker.js as well as botclient.js — the client still prints this quest's queue while
// routing on somebody else's transport graph, which reads as a bug in this quest's own new edge.
// Why: an isolated copy removes that race rather than detecting it.
const client = args.deploy ? deployIsolatedClient(args.user) : null;
const clientPage = client?.page ?? '/bot.html';

process.on('exit', () => client?.cleanup());

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
    console.log(`mainland-ready as '${args.user}' on ${clientPage}`);

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    // Why: `setstat` is a built-in branch with no level-up cascade, so it leaves the player
    // undelayed — unlike `~maxme`, which swallows the next typed command.
    for (const skill of SKILLS) {
        await cheatQuiet(page, `setstat ${skill} ${args.level}`, 120);
    }
    console.log(`stats: ${args.level} across ${SKILLS.length} skills`);

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Ardougne bank`);
    await seedItemsToBank(page, BANK_SEED, ARDOUGNE_BANK);

    await cheatQuiet(page, `setvar elenaquest ${PLAGUE_CITY_COMPLETE}`);
    if (args.stage > 0) {
        await cheatQuiet(page, `setvar biohazard ${args.stage}`);
    }
    await relog(page, args.user);
    await clearChatDialogs(page, 'post-relog dialog(s)');

    const plague = await getServerVarQuiet(page, 'elenaquest');
    if (plague !== PLAGUE_CITY_COMPLETE) {
        fail(`setvar elenaquest ${PLAGUE_CITY_COMPLETE} did not take (read back ${plague})`);
    }
    const set = (await getServerVarQuiet(page, 'biohazard')) ?? 0;
    console.log(`elenaquest=${plague} biohazard=${set}`);
    if (set !== args.stage) {
        fail(`setvar biohazard ${args.stage} did not take (read back ${set})`);
    }
    for (const item of HANDED_OVER[args.stage] ?? []) {
        await cheatQuiet(page, `give ${item} 1`);
        console.log(`  gave ${item}`);
    }

    const start = STAGE_START[args.stage] ?? ARDOUGNE_BANK;
    if (!(await teleTo(page, start, 10, 25_000))) {
        await clearChatDialogs(page, 'pre-tele dialog(s)');
        if (!(await teleTo(page, start, 10, 25_000))) {
            fail(`tele to ${start.x},${start.z} did not arrive`);
        }
    }
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'biohazard'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for biohazard >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    let queueChecked = false;
    while (Date.now() < deadline) {
        const last = await snapshot(page);
        const stage = (await getServerVarQuiet(page, 'biohazard')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` biohazard=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        for (const l of last.logs) {
            if (l.time > lastLogTime) { console.log(`      · [${l.level}] ${l.msg}`); }
        }
        if (last.logs.length > 0) { lastLogTime = Math.max(lastLogTime, ...last.logs.map(l => l.time)); }

        // Why: one engine serves every worktree, so a concurrent session's deploy silently
        // replaces this bundle and the queue line is the first place it shows.
        // Why: this runs after the log dump so the failure prints the queue it read.
        const queue = last.logs.find(l => l.msg.startsWith('AIOQuester — queue:'));
        if (!queueChecked && queue) {
            queueChecked = true;
            if (!queue.msg.includes(QUEST)) {
                fail(`the client at ${clientPage} has no ${QUEST} ('${queue.msg}') — this run's deploy did not land`);
            }
        }

        // A full run waits for the journal to go green: the quest-complete recolour
        // and the QP award land a tick behind %biohazard.
        const done = args.until >= BIOHAZARD_COMPLETE ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (biohazard=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at biohazard=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`biohazard reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
