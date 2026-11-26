/** Live Ernest the Chicken harness (#229), using the content world at :8890. */
// Why: stage jumps relog; level 70 keeps combat meaningful and quest items stay unseeded.

//   HEADED=1 bun e2e/ernest-chicken-229-live.ts --stage 0 --until 3 --minutes 90
//   HEADED=1 bun e2e/ernest-chicken-229-live.ts --stage 2 --until 3 --minutes 60
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
    user: `ec${Date.now().toString(36).slice(-7)}`,
    stage: 0,
    until: 3,
    minutes: 90,
    tickMs: 300,
    food: 'Lobster',
    stats: 70,
    poisoned: false,
    deploy: true
}, {
    switches: { '--poisoned': { poisoned: true } }
});

const QUEST = 'Ernest the Chicken';
const DRAYNOR_BANK = { x: 3093, z: 3243, level: 0 };

/**
 * Coins and food only. Every other item this quest needs has a source in the
 * world, and banking one would hide whether the bot can find it.
 */
const BANK_SEED: BankSeedItem[] = [
    { debugName: 'coins', displayName: 'Coins', qty: 2_000_000 },
    { debugName: 'lobster', displayName: 'Lobster', qty: 40 }
];

/** The quest is one town, so every stage starts at Draynor bank. */
const STAGE_START: Record<number, { x: number; z: number; level: number }> = {
    0: DRAYNOR_BANK,
    1: DRAYNOR_BANK,
    2: DRAYNOR_BANK
};

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

    console.log(`seeding ${BANK_SEED.length} item type(s) into the Draynor bank`);
    await seedItemsToBank(page, BANK_SEED, DRAYNOR_BANK);

    if (args.stage > 0) {
        await cheatQuiet(page, `setvar haunted ${args.stage}`);
        const set = await getServerVarQuiet(page, 'haunted');
        console.log(`haunted=${set}`);
        if (set !== args.stage) {
            fail(`setvar haunted ${args.stage} did not take (read back ${set})`);
        }
        await relog(page, args.user);
        await clearChatDialogs(page, 'post-relog dialog(s)');
    }

    // Why: the stage setvar relogs and a cheat-set perm varp does not reliably survive that round trip.
    // A fountain poisoned on an earlier run is the one piece of quest state a fresh account cannot reach; it exercises the Search-first branch.
    if (args.poisoned) {
        await cheatQuiet(page, 'setvar haunted_manor_fountain_poisoned 1');
        const set = await getServerVarQuiet(page, 'haunted_manor_fountain_poisoned');
        console.log(`haunted_manor_fountain_poisoned=${set}`);
        if (set !== 1) {
            fail('setvar haunted_manor_fountain_poisoned 1 did not take');
        }
    }

    const start = STAGE_START[args.stage] ?? DRAYNOR_BANK;
    await teleportToQuestStart(page, start);
    console.log(`start tile → ${start.x},${start.z},${start.level}`);

    await page.evaluate(() => sessionStorage.setItem('rs2b0t:set:AIOQuester:quests', 'haunted'));
    await page.evaluate(f => sessionStorage.setItem('rs2b0t:set:AIOQuester:food', f), args.food);
    await startScript(page, 'AIOQuester');
    console.log(`started AIOQuester — watching for haunted >= ${args.until}`);

    const deadline = Date.now() + args.minutes * 60_000;
    let lastLogTime = 0;
    let reached = 0;
    while (Date.now() < deadline) {
        const last = await questSnapshot(page, QUEST);
        const stage = (await getServerVarQuiet(page, 'haunted')) ?? -1;
        reached = Math.max(reached, stage);
        const t = Math.round((Date.now() - t0) / 1000);
        console.log(
            `  t=${t}s pos=${last.pos ? `${last.pos.x},${last.pos.z},${last.pos.level}` : '?'}`
            + ` haunted=${stage} journal=${last.status} qp=${last.qp} runner=${last.runner}`
        );
        lastLogTime = printQuestLogs(last.logs, lastLogTime);

        // A full run waits for the journal to go green, not the varp: the
        // quest-complete recolour and the QP award land a tick behind %haunted.
        const done = args.until >= 3 ? last.status === 'complete' : stage >= args.until;
        if (done) {
            console.log(`PASS (haunted=${stage}, journal=${last.status}, QP=${last.qp}, ${Math.round(t / 60)}min)`);
            process.exit(0);
        }
        if (last.runner === 'stopped') {
            fail(`script stopped at haunted=${stage} (journal=${last.status})`);
        }
        await page.waitForTimeout(10_000);
    }
    fail(`haunted reached ${reached}, wanted ${args.until}, within ${args.minutes}min`);
} finally {
    await browser.close();
}
