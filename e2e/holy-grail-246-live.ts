/** Live Holy Grail harness (#246), using the members world at :8890. */
// Why: stage jumps relog; quest items must be sourced except the unrecoverable napkin after stage 8.

//   HEADED=1 bun e2e/holy-grail-246-live.ts --stage 0 --until 10 --minutes 120 --tick 200
//   HEADED=1 bun e2e/holy-grail-246-live.ts --stage 4 --until 8 --minutes 45 --tick 200
import { parseQuestArgs } from './lib/questArgs.js';
import { printQuestLogs, questSnapshot, setQuestStats, teleportToQuestStart } from './lib/questHarness.js';
import { deploySharedBundles, fail, launchBrowser, logBotConsole } from './lib/harness.js';
import {
    cheatQuiet,
    clearChatDialogs,
    getServerVarQuiet,
    mainlandAccount,
    relog,
    seedItemsToBank,
    startScript,
    type BankSeedItem
} from './tutorial/harness.js';

const args = parseQuestArgs(process.argv.slice(2), {
    base: process.env.BASE ?? 'http://localhost:8890',
    user: `hg${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    until: 10,
    minutes: 120,
    tickMs: 300,
    food: 'Lobster',
    stats: 70,
    deploy: true
});

const QUEST = 'Holy Grail';
/** `^arthur_complete`, Merlin's Crystal, the quest's only prerequisite. */
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

if (!STAGES.includes(args.stage)) {
    fail(`--stage must be one of ${STAGES.join(', ')} (the values quest_grail.constant uses)`);
}

if (args.deploy) {
    deploySharedBundles(args.base);
}

const browser = await launchBrowser({ swiftshader: true });
try {
    const page = await browser.newPage();
    const t0 = Date.now();
    logBotConsole(page, t0);

    await mainlandAccount(page, args.base, args.user);
    console.log(`mainland-ready as '${args.user}'`);

    await cheatQuiet(page, `speed ${args.tickMs}`);
    console.log(`tick rate: ${args.tickMs}ms`);

    await setQuestStats(page, args.stats);
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
    await teleportToQuestStart(page, start);
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
        const last = await questSnapshot(page, QUEST);
        // Why: reject a shared bundle replaced by another session during boot.
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
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

        // Why: a full run waits for the list to go green as well, the recolour and the QP award land a tick behind %grail.
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
